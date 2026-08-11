# Call_Reason — SQL Server edition · setup guide

This is a port of the Call_Reason operations system from PostgreSQL to
Microsoft SQL Server, for deployment on company infrastructure.

It is the **same application** as the original — same screens, same data model,
same behaviour. Only the database layer changed.

---

## What you need on the server

| Requirement | Notes |
|---|---|
| Microsoft SQL Server | 2016 or newer (tested against SQL Server 2022). |
| Node.js 20 or newer | The app is a Node.js web server; it does **not** run inside SQL Server. |
| A database | Created in step 1 below. |

---

## 1. Create the database and schema

In SSMS, connected to the target server:

```sql
CREATE DATABASE Call_Reason;
```

Then open `sql/schema.sql` from this repository, **select the `Call_Reason`
database in the toolbar dropdown** (not `master`), and Execute (F5).

You should see:

```
Call_Reason schema created (23 tables).
```

The script is idempotent — re-running it is safe and will not drop or
duplicate anything.

## 2. Configure the application

Copy `.env.example` to `.env` and fill in the real values:

```
PORT=6004
SQLSERVER_HOST=<server ip or hostname>
SQLSERVER_DB=Call_Reason
SQLSERVER_USER=<sql login>
SQLSERVER_PASSWORD=<password>
SQLSERVER_PORT=1433
JWT_SECRET=<a long random string>
```

`PORT` is the port **users browse to** (6004 as specified).
`SQLSERVER_PORT` is the port SQL Server itself listens on (usually 1433).

> **Change `JWT_SECRET`.** It signs login sessions; leaving the default would
> let anyone who knows it forge a login.

## 3. Install and build

```bash
npm install
npm run build
```

## 4. Run

```bash
npm start
```

The app will be available at `http://<server>:6004`.

On first start it verifies the schema exists, seeds reference data (brands,
branches, dropdown lists, platforms) and creates the default users if the
`users` table is empty.

---

## Notes for whoever maintains this

**The schema lives in `sql/schema.sql`, not in the application code.** Unlike
the PostgreSQL original — which created and migrated its own tables at
startup — this edition issues no DDL. If a future change needs a new column,
add it to `sql/schema.sql` and run it; the app will not create it for you.

**`server/sqlserver.ts`** is a small adapter that gives the rest of the code a
`pg`-shaped query API over the `mssql` driver. It translates only mechanical
things (positional `$1` parameters → named `@p1`, array parameters → `IN`
lists, transactions). It deliberately does **not** rewrite SQL dialect — every
T-SQL construct is written explicitly in `server/db.ts`, so the SQL you read
there is the SQL that runs.

**Behaviour differences that were handled explicitly during the port** (listed
so they are not "fixed" back by accident):

| PostgreSQL | SQL Server | Why it mattered |
|---|---|---|
| `AVG(rating)` on an integer column | `AVG(CAST(rating AS FLOAT))` | SQL Server does integer division and would truncate averages (4.7 → 4). |
| `BOOLEAN` | `BIT` | A `BIT` cannot stand alone as a predicate; `CASE WHEN answered` became `CASE WHEN answered = 1`. |
| `UNIQUE (brand_id, phone_number)` | filtered unique index | Postgres treats each `NULL` as distinct; SQL Server treats NULLs as equal and would reject valid rows. |
| `ON CONFLICT` | guarded `IF EXISTS` / `IF NOT EXISTS` | No direct equivalent; written out explicitly. |
| `RETURNING *` | `OUTPUT INSERTED.*` | Same purpose, different placement in the statement. |
| `LIMIT n` / `LIMIT..OFFSET` | `TOP (n)` / `OFFSET..FETCH NEXT` | — |
| `generate_series` | computed in JS | No SQL Server equivalent in the supported versions. |

---

## Data migration

This sets up an **empty** database. Moving the existing production data from
PostgreSQL to SQL Server is a separate step and is not covered by this guide.
