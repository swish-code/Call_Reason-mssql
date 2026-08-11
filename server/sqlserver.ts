/**
 * Minimal `pg`-compatible adapter over Microsoft SQL Server (mssql/tedious).
 *
 * WHY THIS EXISTS
 * ---------------
 * db.ts contains ~170 call sites written against node-postgres' API:
 *
 *     const { rows } = await pool.query<T>("... WHERE id = $1", [id]);
 *     const res = await pool.query("UPDATE ...");   // res.rowCount
 *     const client = await pool.connect();          // BEGIN / COMMIT / ROLLBACK
 *
 * Rewriting every one of those call sites by hand would be a large, purely
 * mechanical diff with a lot of room for transcription mistakes. This adapter
 * keeps that calling convention intact so the port can focus on the part that
 * genuinely needs judgement: the SQL dialect itself (which is translated
 * explicitly in db.ts, NOT hidden in here).
 *
 * WHAT THIS TRANSLATES (mechanical only — no SQL dialect guessing)
 *   1. Positional placeholders  $1, $2 ...      -> named parameters @p1, @p2 ...
 *   2. `col = ANY($n)` with an array value      -> `col IN (@pn_0, @pn_1, ...)`
 *      (an empty array becomes a guaranteed-false predicate, matching
 *      Postgres' behaviour of `= ANY('{}')` never matching a row)
 *   3. Result shape                             -> { rows, rowCount }
 *   4. BEGIN / COMMIT / ROLLBACK on a client    -> mssql Transaction API
 *
 * WHAT THIS DELIBERATELY DOES **NOT** DO
 *   It does not rewrite RETURNING, ON CONFLICT, LIMIT, ::casts, now(),
 *   CURRENT_DATE or any other dialect construct. Those are translated
 *   explicitly in db.ts so that the SQL you read there is the SQL that runs —
 *   silent query rewriting is exactly how a port grows undebuggable
 *   behaviour differences.
 */
import sql from "mssql";

const server = process.env.SQLSERVER_HOST;
const database = process.env.SQLSERVER_DB;
const user = process.env.SQLSERVER_USER;
const password = process.env.SQLSERVER_PASSWORD;

if (!server || !database || !user || !password) {
  throw new Error(
    "SQL Server connection is not configured. Set SQLSERVER_HOST, SQLSERVER_DB, " +
      "SQLSERVER_USER and SQLSERVER_PASSWORD (see .env.example)."
  );
}

const config: sql.config = {
  server,
  database,
  user,
  password,
  port: Number(process.env.SQLSERVER_PORT) || 1433,
  options: {
    // Company SQL Server instances commonly use a self-signed certificate.
    trustServerCertificate: process.env.SQLSERVER_TRUST_CERT !== "false",
    encrypt: process.env.SQLSERVER_ENCRYPT === "true",
    // Keep DATETIMEOFFSET/DATETIME2 values as JS Dates in UTC, so the app's
    // existing date handling behaves the same as it did under Postgres.
    useUTC: true,
  },
  pool: {
    max: Number(process.env.SQLSERVER_POOL_MAX) || 10,
    min: 0,
    idleTimeoutMillis: 30_000,
  },
  requestTimeout: Number(process.env.SQLSERVER_REQUEST_TIMEOUT) || 60_000,
};

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

/** Lazily-created shared connection pool (mssql connects asynchronously). */
let poolPromise: Promise<sql.ConnectionPool> | null = null;

function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .catch((err) => {
        // Let a later call retry instead of caching a permanently failed pool.
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

/**
 * Rewrite Postgres positional placeholders into SQL Server named parameters
 * and bind the values onto the request.
 *
 * Handles `= ANY($n)` array parameters by expanding them into an IN list,
 * since SQL Server has no array type.
 */
function bind(request: sql.Request, text: string, values: any[]): string {
  if (!values.length) return text;

  // Which parameters are consumed by an ANY(...) expansion — those are bound
  // as individual scalars instead of a single value.
  const expanded = new Set<number>();

  // `col = ANY($2)` / `col=ANY( $2 )` -> `col IN (@p2_0, @p2_1, ...)`
  let out = text.replace(/=\s*ANY\s*\(\s*\$(\d+)\s*\)/gi, (_m, num: string) => {
    const i = Number(num) - 1;
    const arr = values[i];
    if (!Array.isArray(arr)) return `= @p${num}`; // not actually an array; leave as scalar
    expanded.add(i);
    if (arr.length === 0) {
      // Postgres: `x = ANY('{}')` matches nothing. Reproduce that exactly.
      return "IN (SELECT TOP 0 NULL)";
    }
    const names = arr.map((v, j) => {
      const name = `p${num}_${j}`;
      request.input(name, v);
      return `@${name}`;
    });
    return `IN (${names.join(", ")})`;
  });

  // Remaining scalar placeholders. Longest-first so $10 is not matched as $1.
  for (let i = values.length - 1; i >= 0; i--) {
    if (expanded.has(i)) continue;
    const n = i + 1;
    const name = `p${n}`;
    if (new RegExp(`\\$${n}(?!\\d)`).test(out)) {
      request.input(name, values[i] === undefined ? null : values[i]);
      out = out.replace(new RegExp(`\\$${n}(?!\\d)`, "g"), `@${name}`);
    }
  }

  return out;
}

function toResult<T>(result: sql.IResult<any>): QueryResult<T> {
  const rows = (result.recordset ?? []) as T[];
  // mssql reports affected rows per statement; the callers that read rowCount
  // all run single-statement DML, and for SELECTs pg reports the row count.
  const affected = Array.isArray(result.rowsAffected)
    ? result.rowsAffected.reduce((a, b) => a + b, 0)
    : 0;
  return { rows, rowCount: rows.length > 0 ? rows.length : affected };
}

/**
 * A `pg`-style client bound to a single connection, supporting the
 * BEGIN / COMMIT / ROLLBACK strings db.ts already issues.
 */
export class PoolClient {
  private tx: sql.Transaction | null = null;

  constructor(private pool: sql.ConnectionPool) {}

  async query<T = any>(text: string, values: any[] = []): Promise<QueryResult<T>> {
    const trimmed = text.trim().toUpperCase();

    if (trimmed === "BEGIN") {
      this.tx = new sql.Transaction(this.pool);
      await this.tx.begin();
      return { rows: [], rowCount: 0 };
    }
    if (trimmed === "COMMIT") {
      if (this.tx) { await this.tx.commit(); this.tx = null; }
      return { rows: [], rowCount: 0 };
    }
    if (trimmed === "ROLLBACK") {
      if (this.tx) {
        // A transaction aborted by SQL Server itself is already rolled back;
        // swallowing that keeps the original error surfacing to the caller.
        try { await this.tx.rollback(); } catch { /* already aborted */ }
        this.tx = null;
      }
      return { rows: [], rowCount: 0 };
    }

    const request = this.tx ? new sql.Request(this.tx) : this.pool.request();
    const sqlText = bind(request, text, values);
    return toResult<T>(await request.query(sqlText));
  }

  /** Present for API parity with pg; the mssql pool reclaims connections itself. */
  release(): void {
    this.tx = null;
  }
}

export const pool = {
  async query<T = any>(text: string, values: any[] = []): Promise<QueryResult<T>> {
    const p = await getPool();
    const request = p.request();
    const sqlText = bind(request, text, values);
    return toResult<T>(await request.query(sqlText));
  },

  async connect(): Promise<PoolClient> {
    return new PoolClient(await getPool());
  },

  async end(): Promise<void> {
    if (poolPromise) {
      const p = await poolPromise;
      poolPromise = null;
      await p.close();
    }
  },
};
