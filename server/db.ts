import bcrypt from "bcryptjs";
import { User, Interaction, Brand, Category, Branch, AuditLog, DropdownOption, OpsLog, AssignedTask } from "../src/types.js";
import { pool } from "./sqlserver.js";

// ----------------------------------------------------
// Microsoft SQL Server connection
// ----------------------------------------------------
// The pool lives in ./sqlserver.ts, which exposes a `pg`-shaped query API
// (pool.query -> { rows, rowCount }; pool.connect -> a client understanding
// BEGIN/COMMIT/ROLLBACK). Connection settings come from SQLSERVER_* env vars.

// Helper to format ISO dates relative to today (used only for seed data)
function getDateRelative(daysOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().split("T")[0];
}

// ----------------------------------------------------
// Seed data (inserted only when tables are empty)
// ----------------------------------------------------
const SEED_USERS: User[] = [
  { id: "u-admin", full_name: "Ahmed Kamal (System Admin)", name: "Ahmed Kamal (System Admin)", username: "admin", email: "admin@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "admin", team: "Team Leader", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-leader", full_name: "Sarah Mahmoud (Team Leader)", name: "Sarah Mahmoud (Team Leader)", username: "leader", email: "leader@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "leader", team: "Team Leader", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-agent1", full_name: "Mohamed Ali (Support Agent)", name: "Mohamed Ali (Support Agent)", username: "agent1", email: "agent1@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "agent", team: "Call Center", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-agent2", full_name: "Mariam Hassan (Support Agent)", name: "Mariam Hassan (Support Agent)", username: "agent2", email: "agent2@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "agent", team: "Complain Team", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
  { id: "u-agent3", full_name: "Omar Khaled (Support Agent)", name: "Omar Khaled (Support Agent)", username: "agent3", email: "agent3@crm.com", password_hash: bcrypt.hashSync("password", 10), role: "agent", team: "Technical Team", status: "Active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "system" },
];

// Company brands and the branches that belong to each (branches are per-brand)
const BRAND_BRANCHES: Record<string, string[]> = {
  "Yelo Pizza": ["Adaliya", "Khairan", "Jaber Al Ahmed", "Sabah Al Salem", "Vibes", "Qortuba", "Abdullah Al Salem (Dahiya)", "Fahaheel", "Jleeb Al Shuyoukh", "Egaila", "Salmiya", "Jabriya", "Ishbiliya", "Sabah Al Ahmed", "Ardhiya", "Maidan Hawally", "Yard", "Jahra", "Salwa", "Zahra", "Saad Al Abdullah", "Qurain", "Andalous"],
  "Shawarma Shakir": ["Rai", "Qurain", "Salmiya", "Kuwait City", "Jahra", "Ardhiya", "Egaila", "Hawally", "Sabah Al Ahmed", "Bayan"],
  "BBT": ["Shamiya", "Hilltop", "West Mishref", "Yard", "Salmiya", "Ardhiya", "Jahra", "Adaliya", "Shuhada", "Mangaf", "Saad Al Abdullah", "Sabah Al Ahmed", "Bayan", "Khairan", "Um Al Hyman"],
  "Slice": ["Mishref", "Kuwait City", "Yard", "Adaliya", "Jabriya", "Ardhiya", "Jahra", "Salmiya"],
  "Pattie Pattie": ["Adaliya", "Mishref", "Ardhiya", "Jahra", "Salmiya", "Yard", "Hawally"],
  "Just C": ["Qortuba", "Yard"],
  "Chili Pepper": ["Qortuba", "Yard", "Hawally"],
  "Mishmash": ["Ardhiya", "Kaifan", "Mahboula", "Jabriya", "Sabah Al Salem", "Saad Al Abdullah", "Salmiya", "Khaithan", "Mangaf", "West Abdullah Al Mubarak", "Salwa", "Qadsiya", "Qurain", "Khairan"],
  "Tabel": ["Ardhiya", "Qortuba", "Hawally", "Sabah Al Salem", "Salmiya", "Bneid Al Qar", "Mahboula", "Jahra", "Ahmadi", "Khairan"],
  "FM": ["Yard", "Kuwait City", "Hawally", "Khaithan"],
};

const SEED_BRANDS: Brand[] = Object.keys(BRAND_BRANCHES).map((name, i) => ({ id: `b-${i + 1}`, brand_name: name }));

// Flattened per-brand branches with deterministic ids (idempotent re-seed)
const SEED_BRANCHES: Branch[] = (() => {
  const out: Branch[] = [];
  let i = 0;
  for (const [brand, list] of Object.entries(BRAND_BRANCHES)) {
    for (const bn of list) out.push({ id: `br-${++i}`, branch_name: bn, brand });
  }
  return out;
})();

// Default values for the admin-managed dropdown lists (Configuration page).
// Each list is seeded once (only if it has no rows yet).
const DEFAULT_OPTIONS: Record<string, string[]> = {
  call_type: ["New Order", "Follow Up", "Complaint", "Inquiry", "Additional Request"],
  customer_type: ["Customer", "Aggregator", "Driver"],
  call_from: ["Customer", "Aggregator", "Driver"],
  aggregator: ["Talabat", "Keeta", "Other Aggregators"],
  complaint_reason: ["Late Delivery", "Late Preparation", "Missing Items", "Wrong Order", "Other"],
  fcr: ["Solved", "Not Solved"],
  priority: ["Low", "Medium", "High", "Critical"],
  status: ["Open", "Pending", "Resolved", "Closed"],
  team: ["Complain Team", "Call Center", "Technical Team", "Team Leader"],
  call_direction: ["Inbound", "Outbound"],
  department: ["Call Center", "Technical", "Complaints", "Quality"],
  cc_activity: ["Survey", "Review", "Follow-up CST", "Handle Customer Issue", "Handle Complaint", "Follow-up Orders", "Open Branch", "Close Branch", "Floor Tasks", "Previous Tasks Follow-up", "Other"],
  tech_activity: ["Delayed Orders Follow-up", "Aggregator Follow-up", "Missing Item Cases", "Wrong Dispatch Cases", "Big Order Confirmation", "Order Assignment", "Aggregator Comments", "Punch Orders", "Open Branch", "Busy Branch", "Close Branch", "Hide Item", "Unhide Item", "Follow-up Groups", "Cancellation Request", "Foodics / POS Issues", "Other"],
  complaint_activity: ["Validation", "Escalation", "Coupon Request", "Email Complaint", "Social Media Complaint", "Agent Inquiry", "Customer Review", "Survey Result", "Follow-up Store", "Other"],
  quality_activity: ["Call Monitoring & Evaluation", "Review Escalated Complaints", "Root Cause Analysis", "SOP & Policy Compliance", "Operational Accuracy", "QA Documentation", "Quality Reporting", "Calibration Management", "Coaching & Performance Follow-up", "Quality Improvement & Special Projects"],
  tl_activity: ["Agent Coaching", "One-to-One Session", "Monthly Meeting", "Floor Task", "Validation Quality Review", "Agent Mistake Review", "Performance Feedback", "Other"],
  cc_status: ["Open", "In Progress", "Completed"],
  complaint_status: ["Solved", "Not Solved", "Waiting Feedback"],
};

const SEED_CATEGORIES: Category[] = [
  { id: "c1", category_name: "Refund" },
  { id: "c2", category_name: "Order Issue" },
  { id: "c3", category_name: "Delivery Delay" },
  { id: "c4", category_name: "Account Issue" },
  { id: "c5", category_name: "Technical Issue" },
  { id: "c6", category_name: "Payment Issue" },
  { id: "c7", category_name: "Complaint" },
  { id: "c8", category_name: "Other" },
];

const SEED_INTERACTIONS: Interaction[] = [
  { id: "int-1", interaction_date: getDateRelative(0), interaction_time: "09:15", agent_id: "u-agent1", agent_name: "Mohamed Ali (Support Agent)", customer_name: "Yasser Farag", customer_phone: "+201011223344", interaction_type: "SR", communication_type: "Call", call_direction: "Inbound", brand: "Talabat", category: "Order Issue", call_reason: "Follow Up", team: "Call Center", priority: "High", status: "Resolved", summary: "Customer is complaining that order #4432 has not arrived and is delayed by more than an hour, despite the money being deducted from the electronic account.", action_taken: "Called driver and updated delivery location. Delivered order successfully and provided a compensatory voucher worth 50 EGP.", follow_up_required: false, created_at: new Date().toISOString() },
  { id: "int-2", interaction_date: getDateRelative(0), interaction_time: "10:30", agent_id: "u-agent2", agent_name: "Mariam Hassan (Support Agent)", customer_name: "Rana Ahmed", customer_phone: "+201288776655", interaction_type: "Complaint", communication_type: "Call", call_direction: "Inbound", brand: "Amazon", category: "Refund", call_reason: "Complaint", branch: "Cairo - Nasr City", team: "Complain Team", priority: "Critical", status: "Pending", summary: "Customer complained about receiving a damaged product (broken phone screen), requesting an immediate refund.", action_taken: "Created refund request #RET-990 and updated shipment status to replacement. Awaiting courier pickup of damaged item tomorrow.", follow_up_required: true, follow_up_date: getDateRelative(1), follow_up_notes: "Follow up with courier to ensure pickup of the damaged item and issue cash refund to customer.", created_at: new Date().toISOString() },
  { id: "int-3", interaction_date: getDateRelative(-1), interaction_time: "14:10", agent_id: "u-agent1", agent_name: "Mohamed Ali (Support Agent)", customer_name: "Khaled Saeed", customer_phone: "+201144556677", interaction_type: "Inquiry", communication_type: "Call", call_direction: "Inbound", brand: "Noon", category: "Account Issue", call_reason: "Inquiry", team: "Call Center", priority: "Low", status: "Closed", summary: "Customer asked about how to activate the e-wallet and use their refunded Noon balance.", action_taken: "Explained double-verification setup steps to fully activate the wallet and verified balance appeared successfully.", follow_up_required: false, created_at: new Date(new Date().setDate(new Date().getDate() - 1)).toISOString() },
  { id: "int-4", interaction_date: getDateRelative(-2), interaction_time: "11:00", agent_id: "u-agent2", agent_name: "Mariam Hassan (Support Agent)", customer_name: "Hany Youssef", customer_phone: "+201555432101", interaction_type: "Escalation", communication_type: "Call", call_direction: "Outbound", brand: "Carrefour", category: "Delivery Delay", call_reason: "Complaint", branch: "Giza - Dokki", team: "Complain Team", priority: "High", status: "Open", summary: "Customer requested escalation for delayed groceries order since morning and wants supermarket to call them immediately.", action_taken: "Assigned order to delivery team leader and escalated ticket to regional team.", follow_up_required: true, follow_up_date: getDateRelative(1), follow_up_notes: "Call customer to confirm courier arrival.", created_at: new Date(new Date().setDate(new Date().getDate() - 2)).toISOString() },
  { id: "int-5", interaction_date: getDateRelative(-3), interaction_time: "16:45", agent_id: "u-agent3", agent_name: "Omar Khaled (Support Agent)", customer_name: "Dina Ali", customer_phone: "+201099887766", interaction_type: "SR", communication_type: "Task", call_direction: "Inbound", brand: "Amazon", category: "Technical Issue", call_reason: "Follow Up", team: "Technical Team", priority: "Medium", status: "Resolved", summary: "Customer is facing technical issue with credit card declining during instant shipping payment.", action_taken: "Guided customer to update app, clear cache, and try alternative payment gateway; transaction completed successfully.", follow_up_required: false, created_at: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString() },
  { id: "int-6", interaction_date: getDateRelative(-4), interaction_time: "13:30", agent_id: "u-agent3", agent_name: "Omar Khaled (Support Agent)", customer_name: "Sherif Monir", customer_phone: "+201201928374", interaction_type: "Feedback", communication_type: "Call", call_direction: "Outbound", brand: "Talabat", category: "Other", call_reason: "Follow Up", team: "Technical Team", priority: "Low", status: "Closed", summary: "Welcome call and customer satisfaction survey regarding drivers and speed in Tagamoa.", action_taken: "Customer expressed complete satisfaction, rated 5 stars, and requested more weekend offers.", follow_up_required: false, created_at: new Date(new Date().setDate(new Date().getDate() - 4)).toISOString() },
];

// Columns that may be updated through the API (whitelist guards against
// arbitrary fields in request bodies being written to the table).
const USER_UPDATE_COLS = ["full_name", "name", "username", "email", "password_hash", "role", "level", "job_title", "team", "department", "status", "created_by"] as const;
const INTERACTION_UPDATE_COLS = ["interaction_date", "interaction_time", "agent_id", "agent_name", "customer_name", "customer_phone", "interaction_type", "communication_type", "call_direction", "brand", "category", "call_reason", "order_number", "branch", "team", "customer_type", "call_from", "aggregator_name", "comments", "complaint_reason", "fcr", "priority", "status", "summary", "action_taken", "follow_up_required", "follow_up_date", "follow_up_notes", "attachments", "created_at"] as const;

const LOG_COLS = ["log_type", "department", "activity_type", "status", "agent_id", "agent_name", "branch", "brand", "order_number", "aggregator", "customer_name", "complaint_id", "target_agent_name", "notes", "action_taken", "resolution_notes", "action_plan", "follow_up_date", "duration_seconds", "calls_reviewed", "created_at", "updated_at", "created_by"] as const;
const LOG_UPDATE_COLS = ["department", "activity_type", "status", "branch", "brand", "order_number", "aggregator", "customer_name", "complaint_id", "target_agent_name", "notes", "action_taken", "resolution_notes", "action_plan", "follow_up_date", "duration_seconds", "calls_reviewed"] as const;

export class DB {
  // ----------------------------------------------------
  // Schema creation + one-time seeding
  // ----------------------------------------------------
  static async init(): Promise<void> {
    // Tables are created by sql/schema.sql, run once against the database via
    // SSMS — this file issues no DDL. One source of truth for the schema means
    // the DBA-run script and the application cannot drift apart.
    // Fail fast with an actionable message if it has not been applied yet.
    const { rows: present } = await pool.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sys.tables WHERE name IN ('users','brands','logs','ratings','survey_records')"
    );
    if (Number(present[0]?.n ?? 0) < 5) {
      throw new Error(
        "SQL Server schema is missing. Run sql/schema.sql against the target database " +
          "(SSMS: open the file, pick the database, Execute) before starting the app."
      );
    }

    // Seed default platforms (idempotent). Fixed ids so re-seeding never
    // collides on the UNIQUE name after a platform is removed from this list.
    for (const [id, name] of [["plat-1", "Talabat"], ["plat-2", "Keeta"], ["plat-5", "TripAdvisor"],
      ["plat-6", "Deliveroo"], ["plat-7", "Ordable"], ["plat-8", "Jahez"], ["plat-9", "Snoonu"]]) {
      await pool.query(
        "IF NOT EXISTS (SELECT 1 FROM platforms WHERE id = $1) INSERT INTO platforms (id, name) VALUES ($1,$2)",
        [id, name]
      );
    }
    // Remove platforms that were seeded before but are no longer wanted,
    // only if no rating/survey record references them.
    await pool.query(`
      DELETE FROM platforms WHERE name IN ('Google','Instagram')
        AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.platform_id = platforms.id)
        AND NOT EXISTS (SELECT 1 FROM survey_records sr WHERE sr.platform_id = platforms.id)
    `);

    // FM staff are supervised by Quality — move any existing FM accounts there
    await pool.query(
      "UPDATE users SET department = 'Quality' WHERE job_title IN ('FM', 'FM Team Leader') AND (department IS NULL OR department <> 'Quality')"
    );

    // Backfill hierarchy level from the coarse role for legacy accounts
    await pool.query(`
      UPDATE users SET level = CASE
        WHEN role = 'owner' THEN 6
        WHEN role = 'admin' THEN 99
        WHEN role = 'manager' THEN 5
        WHEN role = 'supervisor' THEN 3
        WHEN role = 'leader' THEN 2
        ELSE 1 END
      WHERE level IS NULL
    `);

    // Replace quality_activity options with the updated list
    {
      const newQualityActivities = ["Call Monitoring & Evaluation", "Review Escalated Complaints", "Root Cause Analysis", "SOP & Policy Compliance", "Operational Accuracy", "QA Documentation", "Quality Reporting", "Calibration Management", "Coaching & Performance Follow-up", "Quality Improvement & Special Projects"];
      const existing = await pool.query<{ label: string }>("SELECT label FROM options WHERE list_key = 'quality_activity'");
      const existingLabels = existing.rows.map((r) => r.label);
      const isOldSet = existingLabels.some((l) => ["Call Evaluation", "Order Audit", "Compliance Check", "Calibration Session", "Mystery Shopper"].includes(l));
      if (isOldSet) {
        await pool.query("DELETE FROM options WHERE list_key = 'quality_activity'");
        for (let i = 0; i < newQualityActivities.length; i++) {
          await pool.query(
            "IF NOT EXISTS (SELECT 1 FROM options WHERE id = $1) INSERT INTO options (id, list_key, label, sort_order, active) VALUES ($1,'quality_activity',$2,$3,1)",
            [`opt-quality_activity-${i}`, newQualityActivities[i], i]
          );
        }
      }
    }

    // Ensure the "Quality" department option exists even on databases whose
    // department list was seeded before Quality was added
    await pool.query(
      "INSERT INTO options (id, list_key, label, sort_order, active) SELECT 'opt-department-quality', 'department', 'Quality', 99, 1 WHERE NOT EXISTS (SELECT 1 FROM options WHERE list_key = 'department' AND label = 'Quality')"
    );

    // Backfill teams for rows created before the feature existed
    await pool.query(
      "UPDATE users SET team = CASE WHEN role IN ('admin','leader') THEN 'Team Leader' ELSE 'Call Center' END WHERE team IS NULL OR team = ''"
    );
    await pool.query(
      "UPDATE i SET i.team = u.team FROM interactions i JOIN users u ON i.agent_id = u.id WHERE (i.team IS NULL OR i.team = '')"
    );
    await pool.query("UPDATE interactions SET team = 'Call Center' WHERE team IS NULL OR team = ''");

    // Backfill department from the legacy team value — only for department-scoped
    // roles. Management roles (manager / owner / admin) are org-wide (no department).
    await pool.query(`
      UPDATE users SET department = CASE
        WHEN team = 'Complain Team' THEN 'Complaints'
        WHEN team = 'Technical Team' THEN 'Technical'
        WHEN team = 'Call Center' THEN 'Call Center'
        ELSE 'Call Center' END
      WHERE (department IS NULL OR department = '')
        AND role NOT IN ('manager','owner','admin')
    `);

    // One-time: install the real company brands + per-brand branches.
    // Runs once (guarded by the presence of any branded branch), and replaces
    // the earlier demo brands/branches on existing databases.
    const branded = await pool.query("SELECT 1 FROM branches WHERE brand IS NOT NULL ");
    if (branded.rowCount === 0) {
      await pool.query("DELETE FROM brands WHERE brand_name IN ('Talabat','Noon','Amazon','Carrefour')");
      await pool.query("DELETE FROM branches WHERE brand IS NULL");
      for (const b of SEED_BRANDS) {
        await pool.query("IF NOT EXISTS (SELECT 1 FROM brands WHERE id = $1) INSERT INTO brands (id, brand_name) VALUES ($1,$2)", [b.id, b.brand_name]);
      }
      for (const br of SEED_BRANCHES) {
        await pool.query("IF NOT EXISTS (SELECT 1 FROM branches WHERE id = $1) INSERT INTO branches (id, branch_name, brand) VALUES ($1,$2,$3)", [br.id, br.branch_name, br.brand ?? null]);
      }
    }

    // Rename brands to their full names (match the source review files). Safe:
    // ratings/logs reference brands by id, so only the display name changes.
    const brandRenames: [string, string][] = [
      ["Shakir", "Shawarma Shakir"],
      ["Yelo", "Yelo Pizza"],
      ["Pattie", "Pattie Pattie"],
      ["Chili", "Chili Pepper"],
      ["Table", "Tabel"],
    ];
    for (const [oldName, newName] of brandRenames) {
      await pool.query(
        "UPDATE brands SET brand_name = $1 WHERE brand_name = $2 AND NOT EXISTS (SELECT 1 FROM brands WHERE brand_name = $1)",
        [newName, oldName]
      );
    }

    // Seed each dropdown list once (idempotent per list_key, so new lists added
    // in code get seeded on the next boot without touching existing edits)
    for (const [key, labels] of Object.entries(DEFAULT_OPTIONS)) {
      const c = await pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM options WHERE list_key = $1", [key]);
      if (Number(c.rows[0].count) === 0) {
        for (let idx = 0; idx < labels.length; idx++) {
          await pool.query(
            "IF NOT EXISTS (SELECT 1 FROM options WHERE id = $1) INSERT INTO options (id, list_key, label, sort_order, active) VALUES ($1,$2,$3,$4,1)",
            [`opt-${key}-${idx}`, key, labels[idx], idx]
          );
        }
      }
    }

    const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM users");
    if (Number(rows[0].count) === 0) {
      await DB.seed();
    }
  }

  private static async seed(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const u of SEED_USERS) {
        await client.query(
          `IF NOT EXISTS (SELECT 1 FROM users WHERE id = $1) INSERT INTO users (id, full_name, name, username, email, password_hash, role, team, status, created_at, updated_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [u.id, u.full_name, u.name, u.username, u.email, u.password_hash, u.role, u.team ?? null, u.status, u.created_at, u.updated_at, u.created_by]
        );
      }
      for (const b of SEED_BRANDS) {
        await client.query("IF NOT EXISTS (SELECT 1 FROM brands WHERE id = $1) INSERT INTO brands (id, brand_name) VALUES ($1,$2)", [b.id, b.brand_name]);
      }
      for (const c of SEED_CATEGORIES) {
        await client.query("IF NOT EXISTS (SELECT 1 FROM categories WHERE id = $1) INSERT INTO categories (id, category_name) VALUES ($1,$2)", [c.id, c.category_name]);
      }
      for (const b of SEED_BRANCHES) {
        await client.query("IF NOT EXISTS (SELECT 1 FROM branches WHERE id = $1) INSERT INTO branches (id, branch_name, brand) VALUES ($1,$2,$3)", [b.id, b.branch_name, b.brand ?? null]);
      }
      for (const i of SEED_INTERACTIONS) {
        await client.query(
          `IF NOT EXISTS (SELECT 1 FROM interactions WHERE id = $1) INSERT INTO interactions (id, interaction_date, interaction_time, agent_id, agent_name, customer_name, customer_phone, interaction_type, communication_type, call_direction, brand, category, call_reason, branch, team, priority, status, summary, action_taken, follow_up_required, follow_up_date, follow_up_notes, attachments, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
          [i.id, i.interaction_date, i.interaction_time, i.agent_id, i.agent_name, i.customer_name, i.customer_phone, i.interaction_type, i.communication_type, i.call_direction, i.brand, i.category, i.call_reason ?? null, i.branch ?? null, i.team ?? null, i.priority, i.status, i.summary, i.action_taken, i.follow_up_required, i.follow_up_date ?? null, i.follow_up_notes ?? null, JSON.stringify(i.attachments ?? []), i.created_at]
        );
      }

      await client.query("COMMIT");
      console.log("[CRM DB] Seed data inserted into SQL Server.");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ----------------------------------------------------
  // User methods
  // ----------------------------------------------------
  static async getUsers(): Promise<User[]> {
    const { rows } = await pool.query<User>("SELECT * FROM users ORDER BY created_at ASC");
    return rows;
  }

  static async getUserByEmail(email: string): Promise<User | undefined> {
    const { rows } = await pool.query<User>("SELECT * FROM users WHERE LOWER(email) = LOWER($1) ", [email]);
    return rows[0];
  }

  static async getUserByUsernameOrEmail(identifier: string): Promise<User | undefined> {
    const { rows } = await pool.query<User>(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1) ",
      [identifier]
    );
    return rows[0];
  }

  static async getUserById(id: string): Promise<User | undefined> {
    const { rows } = await pool.query<User>("SELECT * FROM users WHERE id = $1 ", [id]);
    return rows[0];
  }

  static async addUser(user: User): Promise<User> {
    const { rows } = await pool.query<User>(
      `INSERT INTO users (id, full_name, name, username, email, password_hash, role, level, job_title, team, department, status, created_at, updated_at, created_by) OUTPUT INSERTED.*
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [user.id, user.full_name, user.name ?? user.full_name, user.username, user.email, user.password_hash, user.role, user.level ?? null, user.job_title ?? null, user.team ?? "Call Center", user.department ?? null, user.status, user.created_at, user.updated_at, user.created_by ?? null]
    );
    return rows[0];
  }

  static async updateUser(id: string, updatedFields: Partial<User>): Promise<User | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const col of USER_UPDATE_COLS) {
      if (col in updatedFields && (updatedFields as any)[col] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        values.push((updatedFields as any)[col]);
      }
    }
    // Keep compat name field in sync when full_name changes
    if (updatedFields.full_name && !("name" in updatedFields)) {
      sets.push(`name = $${idx++}`);
      values.push(updatedFields.full_name);
    }
    sets.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());

    values.push(id);
    const { rows } = await pool.query<User>(
      `UPDATE users SET ${sets.join(", ")} OUTPUT INSERTED.* WHERE id = $${idx}`,
      values
    );
    return rows[0];
  }

  static async deleteUser(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM users WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------
  // Audit Logs methods
  // ----------------------------------------------------
  static async getAuditLogs(): Promise<AuditLog[]> {
    const { rows } = await pool.query<AuditLog>("SELECT * FROM audit_logs ORDER BY timestamp DESC");
    return rows;
  }

  static async addAuditLog(log: Omit<AuditLog, "id" | "timestamp">): Promise<AuditLog> {
    const newLog: AuditLog = {
      ...log,
      id: "log-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
    };
    await pool.query(
      `INSERT INTO audit_logs (id, timestamp, operator_id, operator_name, operator_role, category, action, details, related_ref, ip_address, department, previous_value, new_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [newLog.id, newLog.timestamp, newLog.operator_id, newLog.operator_name, newLog.operator_role ?? null, newLog.category ?? null, newLog.action, newLog.details, newLog.related_ref ?? null, newLog.ip_address ?? null, (newLog as any).department ?? null, (newLog as any).previous_value ?? null, (newLog as any).new_value ?? null]
    );
    return newLog;
  }

  // ----------------------------------------------------
  // Brand methods
  // ----------------------------------------------------
  static async getBrands(): Promise<Brand[]> {
    const { rows } = await pool.query<Brand>("SELECT * FROM brands ORDER BY brand_name ASC");
    return rows;
  }

  static async addBrand(name: string): Promise<Brand> {
    const newBrand: Brand = { id: "brand-" + Date.now(), brand_name: name };
    await pool.query("INSERT INTO brands (id, brand_name) VALUES ($1,$2)", [newBrand.id, newBrand.brand_name]);
    return newBrand;
  }

  static async deleteBrand(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM brands WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------
  // Category methods
  // ----------------------------------------------------
  static async getCategories(): Promise<Category[]> {
    const { rows } = await pool.query<Category>("SELECT * FROM categories ORDER BY category_name ASC");
    return rows;
  }

  static async addCategory(name: string): Promise<Category> {
    const newCat: Category = { id: "cat-" + Date.now(), category_name: name };
    await pool.query("INSERT INTO categories (id, category_name) VALUES ($1,$2)", [newCat.id, newCat.category_name]);
    return newCat;
  }

  static async deleteCategory(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM categories WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------
  // Branch methods (stores/branches shown for Complaint call reasons)
  // ----------------------------------------------------
  static async getBranches(): Promise<Branch[]> {
    const { rows } = await pool.query<Branch>("SELECT * FROM branches ORDER BY branch_name ASC");
    return rows;
  }

  static async addBranch(name: string): Promise<Branch> {
    const newBranch: Branch = { id: "br-" + Date.now(), branch_name: name };
    await pool.query("INSERT INTO branches (id, branch_name) VALUES ($1,$2)", [newBranch.id, newBranch.branch_name]);
    return newBranch;
  }

  static async deleteBranch(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM branches WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------
  // Dropdown options (Configuration page)
  // ----------------------------------------------------
  static async getAllOptions(): Promise<DropdownOption[]> {
    const { rows } = await pool.query<DropdownOption>("SELECT * FROM options ORDER BY list_key ASC, sort_order ASC, label ASC");
    return rows;
  }

  static async getOptionsByKey(listKey: string, activeOnly = true): Promise<DropdownOption[]> {
    const { rows } = await pool.query<DropdownOption>(
      `SELECT * FROM options WHERE list_key = $1 ${activeOnly ? "AND active = 1" : ""} ORDER BY sort_order ASC, label ASC`,
      [listKey]
    );
    return rows;
  }

  static async addOption(listKey: string, label: string): Promise<DropdownOption> {
    const m = await pool.query<{ max: number | null }>("SELECT MAX(sort_order) AS max FROM options WHERE list_key = $1", [listKey]);
    const nextOrder = (m.rows[0].max ?? -1) + 1;
    const id = "opt-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    const { rows } = await pool.query<DropdownOption>(
      "INSERT INTO options (id, list_key, label, sort_order, active) OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,1)",
      [id, listKey, label, nextOrder]
    );
    return rows[0];
  }

  static async updateOption(id: string, fields: Partial<Pick<DropdownOption, "label" | "active" | "sort_order">>): Promise<DropdownOption | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;
    (["label", "active", "sort_order"] as const).forEach((col) => {
      if (col in fields && (fields as any)[col] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        values.push((fields as any)[col]);
      }
    });
    if (sets.length === 0) return undefined;
    values.push(id);
    const { rows } = await pool.query<DropdownOption>(`UPDATE options SET ${sets.join(", ")} OUTPUT INSERTED.* WHERE id = $${idx}`, values);
    return rows[0];
  }

  static async deleteOption(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM options WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  static async reorderOptions(listKey: string, orderedIds: string[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < orderedIds.length; i++) {
        await client.query("UPDATE options SET sort_order = $1 WHERE id = $2 AND list_key = $3", [i, orderedIds[i], listKey]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ----------------------------------------------------
  // Operations & Logs (Agent / Team Leader logs)
  // ----------------------------------------------------
  static async getLogs(filter: { log_type?: string; department?: string; agent_id?: string; agent_ids?: string[] } = {}): Promise<OpsLog[]> {
    const clauses: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (filter.log_type) { clauses.push(`log_type = $${idx++}`); values.push(filter.log_type); }
    if (filter.department) { clauses.push(`department = $${idx++}`); values.push(filter.department); }
    if (filter.agent_id) { clauses.push(`agent_id = $${idx++}`); values.push(filter.agent_id); }
    if (filter.agent_ids) {
      if (!filter.agent_ids.length) return []; // scoped to nobody
      clauses.push(`agent_id = ANY($${idx++})`); values.push(filter.agent_ids);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await pool.query<OpsLog>(`SELECT * FROM logs ${where} ORDER BY created_at DESC`, values);
    return rows;
  }

  static async getLogById(id: string): Promise<OpsLog | undefined> {
    const { rows } = await pool.query<OpsLog>("SELECT * FROM logs WHERE id = $1 ", [id]);
    return rows[0];
  }

  static async addLog(log: Omit<OpsLog, "id"> & { id?: string }): Promise<OpsLog> {
    const id = log.id || "log-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    const cols = ["id", ...LOG_COLS];
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
    const values = [id, ...LOG_COLS.map((c) => (log as any)[c] ?? null)];
    const { rows } = await pool.query<OpsLog>(
      `INSERT INTO logs (${cols.join(",")}) OUTPUT INSERTED.* VALUES (${placeholders})`,
      values
    );
    return rows[0];
  }

  static async updateLog(id: string, fields: Partial<OpsLog>): Promise<OpsLog | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const col of LOG_UPDATE_COLS) {
      if (col in fields && (fields as any)[col] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        values.push((fields as any)[col]);
      }
    }
    sets.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());
    if (sets.length === 1) return DB.getLogById(id); // only updated_at → nothing to change
    values.push(id);
    const { rows } = await pool.query<OpsLog>(`UPDATE logs SET ${sets.join(", ")} OUTPUT INSERTED.* WHERE id = $${idx}`, values);
    return rows[0];
  }

  static async deleteLog(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM logs WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // Live task timer: start / pause / complete (accumulates active seconds)
  static async controlTimer(id: string, action: "start" | "pause" | "complete", completeStatus: string): Promise<OpsLog | undefined> {
    const log = await DB.getLogById(id);
    if (!log) return undefined;
    const now = new Date();
    const nowIso = now.toISOString();
    let duration = Number((log as any).duration_seconds || 0);
    let running_since: string | null = (log as any).running_since || null;
    let started_at: string | null = (log as any).started_at || null;
    let status = log.status;

    const flush = () => {
      if (running_since) {
        duration += Math.max(0, Math.round((now.getTime() - new Date(running_since).getTime()) / 1000));
        running_since = null;
      }
    };

    if (action === "start") {
      if (!running_since) running_since = nowIso;
      if (!started_at) started_at = nowIso;
      if (!["Completed", "Solved", "Closed"].includes(status || "")) status = "In Progress";
    } else if (action === "pause") {
      flush();
    } else if (action === "complete") {
      flush();
      status = completeStatus;
    }

    const { rows } = await pool.query<OpsLog>(
      "UPDATE logs SET duration_seconds = $1, running_since = $2, started_at = $3, status = $4, updated_at = $5 OUTPUT INSERTED.* WHERE id = $6",
      [duration, running_since, started_at, status, nowIso, id]
    );
    return rows[0];
  }

  // ----------------------------------------------------
  // Assigned tasks (manager -> agent)
  // ----------------------------------------------------
  static async getAssignedTasks(filter: { assigned_to?: string; department?: string } = {}): Promise<AssignedTask[]> {
    const clauses: string[] = ["status != 'Cancelled'"];
    const values: any[] = [];
    let idx = 1;
    if (filter.assigned_to) { clauses.push(`assigned_to = $${idx++}`); values.push(filter.assigned_to); }
    if (filter.department) { clauses.push(`department = $${idx++}`); values.push(filter.department); }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const { rows } = await pool.query<AssignedTask>(`SELECT * FROM assigned_tasks ${where} ORDER BY created_at DESC`, values);
    return rows;
  }

  static async getAssignedTaskById(id: string): Promise<AssignedTask | undefined> {
    const { rows } = await pool.query<AssignedTask>("SELECT * FROM assigned_tasks WHERE id = $1 ", [id]);
    return rows[0];
  }

  static async addAssignedTask(t: AssignedTask): Promise<AssignedTask> {
    const { rows } = await pool.query<AssignedTask>(
      `INSERT INTO assigned_tasks (id, title, description, assigned_by, assigned_by_name, assigned_to, assigned_to_name, department, priority, due_date, status, seen, require_time_entry, created_at, updated_at) OUTPUT INSERTED.*
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,$13)`,
      [t.id, t.title, t.description ?? null, t.assigned_by, t.assigned_by_name, t.assigned_to, t.assigned_to_name, t.department ?? null, t.priority ?? null, t.due_date ?? null, t.status || "New", (t as any).require_time_entry !== false, t.created_at]
    );
    return rows[0];
  }

  static async updateAssignedTask(id: string, fields: Partial<AssignedTask>): Promise<AssignedTask | undefined> {
    const cols = ["title", "description", "priority", "due_date", "status", "seen", "completed_at", "assigned_to", "assigned_to_name", "department", "duration_seconds", "note", "require_time_entry"] as const;
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const c of cols) {
      if (c in fields && (fields as any)[c] !== undefined) { sets.push(`${c} = $${idx++}`); values.push((fields as any)[c]); }
    }
    sets.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());
    if (sets.length === 1) return DB.getAssignedTaskById(id);
    values.push(id);
    const { rows } = await pool.query<AssignedTask>(`UPDATE assigned_tasks SET ${sets.join(", ")} OUTPUT INSERTED.* WHERE id = $${idx}`, values);
    return rows[0];
  }

  static async countUnseenTasks(assignedTo: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM assigned_tasks WHERE assigned_to = $1 AND seen = 0", [assignedTo]);
    return Number(rows[0].count);
  }

  static async markTasksSeen(assignedTo: string): Promise<void> {
    await pool.query("UPDATE assigned_tasks SET seen = 1 WHERE assigned_to = $1 AND seen = 0", [assignedTo]);
  }

  static async deleteAssignedTask(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM assigned_tasks WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------
  // Recurring task templates
  // ----------------------------------------------------
  static async getRecurringTemplates(filter: { department?: string } = {}): Promise<any[]> {
    const where = filter.department ? "WHERE department = $1" : "";
    const values = filter.department ? [filter.department] : [];
    const { rows } = await pool.query(`SELECT * FROM recurring_templates ${where} ORDER BY created_at DESC`, values);
    return rows;
  }
  static async getRecurringTemplateById(id: string): Promise<any | undefined> {
    const { rows } = await pool.query("SELECT * FROM recurring_templates WHERE id = $1 ", [id]);
    return rows[0];
  }
  static async addRecurringTemplate(t: any): Promise<any> {
    const { rows } = await pool.query(
      `INSERT INTO recurring_templates (id, title, description, department, priority, recurrence_type, days_of_week, due_time, assign_mode, active, created_by, created_by_name, created_at) OUTPUT INSERTED.*
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [t.id, t.title, t.description ?? null, t.department ?? null, t.priority ?? "Medium", t.recurrence_type ?? "daily", t.days_of_week ?? null, t.due_time ?? null, t.assign_mode ?? "pool", t.active ?? true, t.created_by ?? null, t.created_by_name ?? null, t.created_at]
    );
    return rows[0];
  }
  static async updateRecurringTemplate(id: string, fields: any): Promise<any | undefined> {
    const cols = ["title", "description", "department", "priority", "recurrence_type", "days_of_week", "due_time", "assign_mode", "active"];
    const sets: string[] = []; const values: any[] = []; let idx = 1;
    for (const c of cols) { if (c in fields && fields[c] !== undefined) { sets.push(`${c} = $${idx++}`); values.push(fields[c]); } }
    if (!sets.length) return DB.getRecurringTemplateById(id);
    values.push(id);
    const { rows } = await pool.query(`UPDATE recurring_templates SET ${sets.join(", ")} OUTPUT INSERTED.* WHERE id = $${idx}`, values);
    return rows[0];
  }
  static async deleteRecurringTemplate(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM recurring_templates WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // Insert a generated recurring instance; idempotent on (template_id, task_date)
  static async addRecurringInstance(t: AssignedTask & { template_id: string; task_date: string }): Promise<AssignedTask | undefined> {
    // Postgres used `ON CONFLICT (template_id, task_date) DO NOTHING` against a
    // partial unique index. SQL Server has no ON CONFLICT, so the same
    // idempotency is expressed as a guarded INSERT. The unique filtered index
    // (uq_assigned_tasks_template_date in schema.sql) still backstops races: a
    // concurrent duplicate raises a unique-violation rather than double-inserting.
    const { rows } = await pool.query<AssignedTask>(
      `IF NOT EXISTS (SELECT 1 FROM assigned_tasks WHERE template_id = $12 AND task_date = $13)
       INSERT INTO assigned_tasks (id, title, description, assigned_by, assigned_by_name, assigned_to, assigned_to_name, department, priority, due_date, status, seen, template_id, task_date, created_at, updated_at) OUTPUT INSERTED.*
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,$14,$14)`,
      [t.id, t.title, t.description ?? null, t.assigned_by, t.assigned_by_name, t.assigned_to ?? null, t.assigned_to_name ?? null, t.department ?? null, t.priority ?? null, t.due_date ?? null, t.status || "Available", t.template_id, t.task_date, t.created_at]
    );
    return rows[0];
  }
  static async recurringInstanceExists(templateId: string, taskDate: string): Promise<boolean> {
    const { rows } = await pool.query("SELECT 1 FROM assigned_tasks WHERE template_id = $1 AND task_date = $2 ", [templateId, taskDate]);
    return rows.length > 0;
  }

  // Pool: unclaimed available tasks for a department
  static async getPoolTasks(department: string): Promise<AssignedTask[]> {
    const { rows } = await pool.query<AssignedTask>(
      "SELECT * FROM assigned_tasks WHERE department = $1 AND assigned_to IS NULL AND status = 'Available' ORDER BY due_date ASC NULLS LAST, created_at ASC",
      [department]
    );
    return rows;
  }
  // Claim a pool task atomically (returns the task if claim succeeded)
  static async claimTask(id: string, userId: string, userName: string): Promise<AssignedTask | undefined> {
    const { rows } = await pool.query<AssignedTask>(
      "UPDATE assigned_tasks SET assigned_to = $2, assigned_to_name = $3, status = 'New', seen = 1, updated_at = $4 OUTPUT INSERTED.* WHERE id = $1 AND assigned_to IS NULL",
      [id, userId, userName, new Date().toISOString()]
    );
    return rows[0];
  }
  // Count active (non-completed) tasks per agent — for round-robin auto-assign
  static async getOpenTaskCounts(department: string): Promise<Record<string, number>> {
    const { rows } = await pool.query<{ assigned_to: string; c: string }>(
      "SELECT assigned_to, COUNT(*) AS c FROM assigned_tasks WHERE department = $1 AND assigned_to IS NOT NULL AND status <> 'Completed' GROUP BY assigned_to",
      [department]
    );
    const map: Record<string, number> = {};
    rows.forEach((r) => { map[r.assigned_to] = Number(r.c); });
    return map;
  }

  // ----------------------------------------------------
  // Shift presence
  // ----------------------------------------------------
  static async getOnShiftAgents(department: string): Promise<{ id: string; full_name: string }[]> {
    const { rows } = await pool.query<{ id: string; full_name: string }>(
      "SELECT id, full_name FROM users WHERE role = 'agent' AND status = 'Active' AND shift_status = 'on' AND department = $1",
      [department]
    );
    return rows;
  }
  static async setShiftStatus(userId: string, status: "on" | "off", startedAt: string | null): Promise<void> {
    await pool.query("UPDATE users SET shift_status = $2, shift_started_at = $3 WHERE id = $1", [userId, status, startedAt]);
  }
  static async startShiftSession(s: { id: string; user_id: string; user_name: string; department: string; started_at: string }): Promise<void> {
    await pool.query(
      "INSERT INTO shift_sessions (id, user_id, user_name, department, started_at) VALUES ($1,$2,$3,$4,$5)",
      [s.id, s.user_id, s.user_name, s.department, s.started_at]
    );
  }
  static async endShiftSession(userId: string, endedAt: string): Promise<void> {
    const { rows } = await pool.query<{ id: string; started_at: string }>(
      "SELECT id, started_at FROM shift_sessions WHERE user_id = $1 AND ended_at IS NULL ORDER BY started_at DESC ",
      [userId]
    );
    if (!rows.length) return;
    const dur = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(rows[0].started_at).getTime()) / 1000));
    await pool.query("UPDATE shift_sessions SET ended_at = $2, duration_seconds = $3 WHERE id = $1", [rows[0].id, endedAt, dur]);
  }
  static async getShiftSessions(filter: { department?: string; user_id?: string } = {}): Promise<any[]> {
    const clauses: string[] = []; const values: any[] = []; let idx = 1;
    if (filter.department) { clauses.push(`department = $${idx++}`); values.push(filter.department); }
    if (filter.user_id) { clauses.push(`user_id = $${idx++}`); values.push(filter.user_id); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await pool.query(`SELECT * FROM shift_sessions ${where} ORDER BY started_at DESC `, values);
    return rows;
  }

  // ----------------------------------------------------
  // Interaction methods
  // ----------------------------------------------------
  static async getInteractions(): Promise<Interaction[]> {
    const { rows } = await pool.query<Interaction>("SELECT * FROM interactions ORDER BY created_at DESC");
    return rows;
  }

  static async getInteractionById(id: string): Promise<Interaction | undefined> {
    const { rows } = await pool.query<Interaction>("SELECT * FROM interactions WHERE id = $1 ", [id]);
    return rows[0];
  }

  // History lookup for the Call Reason screen (by customer phone and/or order number)
  static async getInteractionHistory(opts: { phone?: string; order?: string }): Promise<Interaction[]> {
    const clauses: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (opts.phone) {
      clauses.push(`customer_phone = $${idx++}`);
      values.push(opts.phone);
    }
    if (opts.order) {
      clauses.push(`order_number = $${idx++}`);
      values.push(opts.order);
    }
    if (clauses.length === 0) return [];
    const { rows } = await pool.query<Interaction>(
      `SELECT * FROM interactions WHERE ${clauses.join(" OR ")} ORDER BY created_at DESC `,
      values
    );
    return rows;
  }

  static async addInteraction(interaction: Omit<Interaction, "id"> & { id?: string }): Promise<Interaction> {
    const id = interaction.id || "int-" + Date.now();
    const { rows } = await pool.query<Interaction>(
      `INSERT INTO interactions (id, interaction_date, interaction_time, agent_id, agent_name, customer_name, customer_phone, interaction_type, communication_type, call_direction, brand, category, call_reason, order_number, branch, team, customer_type, call_from, aggregator_name, comments, complaint_reason, fcr, priority, status, summary, action_taken, follow_up_required, follow_up_date, follow_up_notes, attachments, created_at) OUTPUT INSERTED.*
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)`,
      [id, interaction.interaction_date, interaction.interaction_time, interaction.agent_id, interaction.agent_name, interaction.customer_name, interaction.customer_phone, interaction.interaction_type, interaction.communication_type, interaction.call_direction, interaction.brand, interaction.category, interaction.call_reason ?? null, interaction.order_number ?? null, interaction.branch ?? null, interaction.team ?? null, interaction.customer_type ?? null, interaction.call_from ?? null, interaction.aggregator_name ?? null, interaction.comments ?? null, interaction.complaint_reason ?? null, interaction.fcr ?? null, interaction.priority, interaction.status, interaction.summary, interaction.action_taken, interaction.follow_up_required, interaction.follow_up_date ?? null, interaction.follow_up_notes ?? null, JSON.stringify(interaction.attachments ?? []), interaction.created_at]
    );
    return rows[0];
  }

  static async updateInteraction(id: string, updatedFields: Partial<Interaction>): Promise<Interaction | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const col of INTERACTION_UPDATE_COLS) {
      if (col in updatedFields && (updatedFields as any)[col] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        const raw = (updatedFields as any)[col];
        values.push(col === "attachments" ? JSON.stringify(raw ?? []) : raw);
      }
    }

    if (sets.length === 0) {
      return DB.getInteractionById(id);
    }

    values.push(id);
    const { rows } = await pool.query<Interaction>(
      `UPDATE interactions SET ${sets.join(", ")} OUTPUT INSERTED.* WHERE id = $${idx}`,
      values
    );
    return rows[0];
  }

  static async deleteInteraction(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM interactions WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------
  // Platforms
  // ----------------------------------------------------
  static async getPlatforms(): Promise<{ id: string; name: string }[]> {
    const { rows } = await pool.query("SELECT * FROM platforms ORDER BY name ASC");
    return rows;
  }

  // ----------------------------------------------------
  // Ratings / Reviews
  // ----------------------------------------------------
  static async getRatings(filter: {
    brand_id?: string; platform_id?: string; action_status?: string;
    requires_action?: boolean; assigned?: string; assigned_agent_id?: string;
    min_rating?: number; max_rating?: number; has_comment?: boolean;
    from?: string; to?: string; limit?: number; offset?: number;
  } = {}): Promise<any[]> {
    const clauses: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (filter.brand_id) { clauses.push(`r.brand_id = $${idx++}`); values.push(filter.brand_id); }
    if (filter.platform_id) { clauses.push(`r.platform_id = $${idx++}`); values.push(filter.platform_id); }
    if (filter.action_status) { clauses.push(`r.action_status = $${idx++}`); values.push(filter.action_status); }
    // Auto-closed rows are report-only — they must never surface in the Reviews list for any role.
    clauses.push(`r.action_status <> 'no_action_needed'`);
    if (filter.requires_action === true) { clauses.push(`r.requires_action = 1`); }
    if (filter.assigned === "me" && filter.assigned_agent_id) { clauses.push(`r.assigned_agent_id = $${idx++}`); values.push(filter.assigned_agent_id); }
    else if (filter.assigned === "unassigned") { clauses.push(`r.assigned_agent_id IS NULL`); }
    else if (filter.assigned_agent_id) { clauses.push(`r.assigned_agent_id = $${idx++}`); values.push(filter.assigned_agent_id); }
    if (filter.min_rating != null) { clauses.push(`r.rating >= $${idx++}`); values.push(filter.min_rating); }
    if (filter.max_rating != null) { clauses.push(`r.rating <= $${idx++}`); values.push(filter.max_rating); }
    if (filter.has_comment === true) { clauses.push(`(r.review_text IS NOT NULL AND LTRIM(RTRIM(r.review_text)) <> '')`); }
    else if (filter.has_comment === false) { clauses.push(`(r.review_text IS NULL OR LTRIM(RTRIM(r.review_text)) = '')`); }
    // Filter on the review's own date (order_date, normalised to YYYY-MM-DD on
    // upload), not uploaded_at — a whole batch shares one upload timestamp, so
    // filtering by that would be useless for narrowing down reviews.
    if (filter.from) { clauses.push(`r.order_date >= $${idx++}`); values.push(filter.from); }
    if (filter.to) { clauses.push(`r.order_date <= $${idx++}`); values.push(filter.to); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const lim = filter.limit || 100;
    const off = filter.offset || 0;
    const { rows } = await pool.query(`
      SELECT r.*,
        b.brand_name, p.name AS platform_name,
        ua.full_name AS agent_name,
        uu.full_name AS uploaded_by_name,
        ur.full_name AS recorded_by_name
      FROM ratings r
      LEFT JOIN brands b ON b.id = r.brand_id
      LEFT JOIN platforms p ON p.id = r.platform_id
      LEFT JOIN users ua ON ua.id = r.assigned_agent_id
      LEFT JOIN users uu ON uu.id = r.uploaded_by
      LEFT JOIN users ur ON ur.id = r.recorded_by
      ${where}
      ORDER BY r.uploaded_at DESC
      OFFSET $${idx++} ROWS FETCH NEXT $${idx++} ROWS ONLY
    `, [...values, off, lim]);
    return rows;
  }

  static async getRatingById(id: string): Promise<any | undefined> {
    const { rows } = await pool.query(`
      SELECT TOP (1) r.*,
        b.brand_name, p.name AS platform_name,
        ua.full_name AS agent_name,
        uu.full_name AS uploaded_by_name,
        ur.full_name AS recorded_by_name
      FROM ratings r
      LEFT JOIN brands b ON b.id = r.brand_id
      LEFT JOIN platforms p ON p.id = r.platform_id
      LEFT JOIN users ua ON ua.id = r.assigned_agent_id
      LEFT JOIN users uu ON uu.id = r.uploaded_by
      LEFT JOIN users ur ON ur.id = r.recorded_by
      WHERE r.id = $1
    `, [id]);
    if (!rows[0]) return undefined;
    const attempts = await pool.query(`
      SELECT a.*, u.full_name AS agent_name FROM rating_call_attempts a
      LEFT JOIN users u ON u.id = a.agent_id
      WHERE a.rating_id = $1 ORDER BY a.attempt_number ASC
    `, [id]);
    return { ...rows[0], attempts: attempts.rows };
  }

  static async upsertRating(data: {
    brand_id: string; platform_id: string; order_id: string; rating: number;
    review_text?: string; customer_phone?: string; requires_action: boolean;
    action_status: string; uploaded_by: string;
    order_date?: string; customer_name?: string; branch?: string;
    filled_by?: string; following_date?: string; surveyed_by?: string;
    complaint_type?: string; complaint_cases?: string; complaint_status?: string;
    served_by?: string; note?: string; assigned_agent_id?: string | null;
  }, mode: "skip" | "overwrite"): Promise<"inserted" | "skipped" | "overwritten"> {
    const id = "rat-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
    // The natural key is (brand_id, platform_id, order_id) — enforced by
    // uq_ratings_brand_platform_order in schema.sql. SQL Server has no
    // ON CONFLICT, so both branches are written as an explicit existence check.
    const params = [id,data.brand_id,data.platform_id,data.order_id,data.rating,data.review_text||null,data.customer_phone||null,data.requires_action,data.action_status,data.uploaded_by,data.order_date||null,data.customer_name||null,data.branch||null,data.filled_by||null,data.following_date||null,data.surveyed_by||null,data.complaint_type||null,data.complaint_cases||null,data.complaint_status||null,data.served_by||null,data.note||null,data.assigned_agent_id??null];

    if (mode === "skip") {
      const res = await pool.query(`
        IF NOT EXISTS (SELECT 1 FROM ratings WHERE brand_id = $2 AND platform_id = $3 AND order_id = $4)
        INSERT INTO ratings (id,brand_id,platform_id,order_id,rating,review_text,customer_phone,requires_action,action_status,uploaded_by,uploaded_at,order_date,customer_name,branch,filled_by,following_date,surveyed_by,complaint_type,complaint_cases,complaint_status,served_by,note,assigned_agent_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,SYSDATETIMEOFFSET(),$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      `, params);
      return (res.rowCount ?? 0) > 0 ? "inserted" : "skipped";
    } else {
      // Mirrors the Postgres DO UPDATE list exactly — note assigned_agent_id is
      // deliberately NOT overwritten, so a re-upload never unassigns an agent.
      const res = await pool.query<{ inserted: number }>(`
        IF EXISTS (SELECT 1 FROM ratings WHERE brand_id = $2 AND platform_id = $3 AND order_id = $4)
        BEGIN
          UPDATE ratings SET
            rating=$5,review_text=$6,customer_phone=$7,
            requires_action=$8,action_status=$9,
            uploaded_by=$10,uploaded_at=SYSDATETIMEOFFSET(),
            order_date=$11,customer_name=$12,branch=$13,
            filled_by=$14,following_date=$15,surveyed_by=$16,
            complaint_type=$17,complaint_cases=$18,
            complaint_status=$19,served_by=$20,note=$21
          WHERE brand_id = $2 AND platform_id = $3 AND order_id = $4;
          SELECT 0 AS inserted;
        END
        ELSE
        BEGIN
          INSERT INTO ratings (id,brand_id,platform_id,order_id,rating,review_text,customer_phone,requires_action,action_status,uploaded_by,uploaded_at,order_date,customer_name,branch,filled_by,following_date,surveyed_by,complaint_type,complaint_cases,complaint_status,served_by,note,assigned_agent_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,SYSDATETIMEOFFSET(),$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22);
          SELECT 1 AS inserted;
        END
      `, params);
      return res.rows[0]?.inserted ? "inserted" : "overwritten";
    }
  }

  static async updateRating(id: string, fields: {
    action_status?: string; action_note?: string; assigned_agent_id?: string | null;
    resolved_at?: string | null; recorded_by?: string | null; recorded_at?: string | null;
    customer_phone?: string | null; customer_name?: string | null;
  }): Promise<any | undefined> {
    const cols = ["action_status","action_note","assigned_agent_id","resolved_at","recorded_by","recorded_at","customer_phone","customer_name"] as const;
    const sets: string[] = []; const values: any[] = []; let idx = 1;
    for (const c of cols) {
      if (c in fields) { sets.push(`${c} = $${idx++}`); values.push((fields as any)[c]); }
    }
    if (!sets.length) return DB.getRatingById(id);
    values.push(id);
    await pool.query(`UPDATE ratings SET ${sets.join(",")} WHERE id = $${idx}`, values);
    return DB.getRatingById(id);
  }

  static async bulkAssignRatings(ids: string[], agentId: string | null): Promise<number> {
    if (!ids.length) return 0;
    const res = await pool.query("UPDATE ratings SET assigned_agent_id = $1 WHERE id = ANY($2)", [agentId, ids]);
    return res.rowCount ?? 0;
  }

  static async bulkSetRatingStatus(ids: string[], actionStatus: string): Promise<number> {
    if (!ids.length) return 0;
    const closingStatuses = ["resolved", "no_action_needed", "unreachable"];
    const res = await pool.query(
      closingStatuses.includes(actionStatus)
        ? `UPDATE ratings SET action_status = $1, resolved_at = COALESCE(resolved_at, SYSDATETIMEOFFSET()) WHERE id = ANY($2)`
        : `UPDATE ratings SET action_status = $1 WHERE id = ANY($2)`,
      [actionStatus, ids]
    );
    return res.rowCount ?? 0;
  }

  static async deleteRatings(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const res = await pool.query("DELETE FROM ratings WHERE id = ANY($1)", [ids]);
    return res.rowCount ?? 0;
  }

  static async countRatingsUploadedBetween(fromISO: string, toISO: string): Promise<number> {
    const { rows } = await pool.query<{ c: string }>(
      "SELECT COUNT(*) AS c FROM ratings WHERE uploaded_at >= $1 AND uploaded_at <= $2", [fromISO, toISO]);
    return Number(rows[0]?.c || 0);
  }

  static async deleteRatingsUploadedBetween(fromISO: string, toISO: string): Promise<number> {
    const res = await pool.query(
      "DELETE FROM ratings WHERE uploaded_at >= $1 AND uploaded_at <= $2", [fromISO, toISO]);
    return res.rowCount ?? 0;
  }

  static async addCallAttempt(data: {
    rating_id: string; agent_id: string; agent_name: string; outcome: string; note?: string;
  }): Promise<any> {
    const cnt = await pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM rating_call_attempts WHERE rating_id = $1", [data.rating_id]);
    const n = Number(cnt.rows[0].count) + 1;
    const id = "att-" + Date.now() + "-" + Math.floor(Math.random() * 999);
    const { rows } = await pool.query(`
      INSERT INTO rating_call_attempts (id,rating_id,agent_id,agent_name,attempt_number,outcome,note,created_at) OUTPUT INSERTED.*
      VALUES ($1,$2,$3,$4,$5,$6,$7,SYSDATETIMEOFFSET())
    `, [id, data.rating_id, data.agent_id, data.agent_name, n, data.outcome, data.note || null]);
    return rows[0];
  }

  // ----------------------------------------------------
  // Surveys — Templates
  // ----------------------------------------------------
  static async getSurveyTemplates(): Promise<any[]> {
    const { rows } = await pool.query(`
      SELECT t.*, b.brand_name, u.full_name AS created_by_name,
        (SELECT COUNT(*) FROM survey_questions q WHERE q.template_id = t.id) AS question_count,
        CASE WHEN EXISTS (
          SELECT 1 FROM survey_answers a
          JOIN survey_questions q ON q.id = a.question_id
          WHERE q.template_id = t.id
        ) THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS has_data
      FROM survey_templates t
      LEFT JOIN brands b ON b.id = t.brand_id
      LEFT JOIN users u ON u.id = t.created_by
      ORDER BY t.created_at DESC
    `);
    return rows;
  }

  static async getSurveyTemplateById(id: string): Promise<any | undefined> {
    const { rows } = await pool.query(`
      SELECT TOP (1) t.*, b.brand_name, u.full_name AS created_by_name,
        CASE WHEN EXISTS (
          SELECT 1 FROM survey_answers a
          JOIN survey_questions q ON q.id = a.question_id
          WHERE q.template_id = t.id
        ) THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS has_data
      FROM survey_templates t
      LEFT JOIN brands b ON b.id = t.brand_id
      LEFT JOIN users u ON u.id = t.created_by
      WHERE t.id = $1
    `, [id]);
    if (!rows[0]) return undefined;
    const q = await pool.query("SELECT * FROM survey_questions WHERE template_id = $1 ORDER BY q_order ASC", [id]);
    return { ...rows[0], questions: q.rows };
  }

  /**
   * True once any of a template's questions have a recorded answer. Used to
   * lock editing entirely — a fresh template can be edited freely, but once
   * real survey results exist under it, it is frozen and a new template is
   * made instead (see updateSurveyTemplate).
   */
  static async templateHasRecordedData(templateId: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT CASE WHEN EXISTS (
         SELECT 1 FROM survey_answers a
         JOIN survey_questions q ON q.id = a.question_id
         WHERE q.template_id = $1
       ) THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS has_data`,
      [templateId]
    );
    return !!rows[0]?.has_data;
  }

  /**
   * Every completed answer for a template's questions, one flat row per
   * (response, question) — the shape the frontend pivots into one row per
   * respondent / one column per question for the export.
   */
  static async getTemplateExportRows(templateId: string): Promise<{
    template: any; questions: any[];
    answers: { response_id: string; customer_phone: string; agent_name: string | null;
      answered_at: string; brand_name: string | null; segment: string | null;
      question_id: string; answer_value: string | null }[];
  }> {
    const template = await DB.getSurveyTemplateById(templateId);
    if (!template) throw new Error("Template not found.");

    const { rows: answers } = await pool.query(`
      SELECT r.id AS response_id, asg.customer_phone, u.full_name AS agent_name,
        r.answered_at, b.brand_name, asg.segment,
        a.question_id, a.answer_value
      FROM survey_answers a
      JOIN survey_questions q ON q.id = a.question_id
      JOIN survey_responses r ON r.id = a.response_id
      JOIN survey_assignments asg ON asg.id = r.assignment_id
      LEFT JOIN users u ON u.id = r.agent_id
      LEFT JOIN brands b ON b.id = asg.brand_id
      WHERE q.template_id = $1
      ORDER BY r.answered_at ASC
    `, [templateId]);

    return { template, questions: template.questions, answers };
  }

  static async createSurveyTemplate(data: {
    name: string; brand_id?: string | null; created_by: string; active?: boolean;
    questions: { text: string; answer_type: string; options?: any; q_order?: number; segment?: string | null }[];
  }): Promise<any> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const id = "st-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
      await client.query(
        "INSERT INTO survey_templates (id,name,brand_id,created_by,active,created_at) VALUES ($1,$2,$3,$4,$5,SYSDATETIMEOFFSET())",
        [id, data.name, data.brand_id || null, data.created_by, data.active !== false]
      );
      for (let i = 0; i < data.questions.length; i++) {
        const q = data.questions[i];
        const qid = "sq-" + Date.now() + "-" + i + "-" + Math.floor(Math.random() * 999);
        await client.query(
          "INSERT INTO survey_questions (id,template_id,text,answer_type,options,q_order,segment) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [qid, id, q.text, q.answer_type || "free_text", q.options ? JSON.stringify(q.options) : null, q.q_order ?? i, q.segment || null]
        );
      }
      await client.query("COMMIT");
      return DB.getSurveyTemplateById(id);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  static async updateSurveyTemplate(id: string, data: {
    name?: string; brand_id?: string | null; active?: boolean;
    questions?: { id?: string; text: string; answer_type: string; options?: any; q_order?: number; segment?: string | null }[];
  }): Promise<any | undefined> {
    // A template with recorded answers is frozen entirely — not just its
    // questions. No edit path can ever touch a template real survey results
    // already exist under. Create a new template instead.
    if (await DB.templateHasRecordedData(id)) {
      throw new Error("This template already has recorded survey answers and can no longer be edited. Create a new template instead.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sets: string[] = []; const vals: any[] = []; let idx = 1;
      if (data.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(data.name); }
      if (data.brand_id !== undefined) { sets.push(`brand_id = $${idx++}`); vals.push(data.brand_id || null); }
      if (data.active !== undefined) { sets.push(`active = $${idx++}`); vals.push(data.active); }
      if (sets.length) { vals.push(id); await client.query(`UPDATE survey_templates SET ${sets.join(",")} WHERE id = $${idx}`, vals); }
      if (data.questions) {
        // Upsert by id instead of delete-all-then-reinsert: recreating every
        // question on every edit gave each one a fresh id, which would sever
        // the FK on any already-recorded survey_answers row (ON DELETE SET
        // NULL). Existing rows are updated in place (same id, so past
        // answers stay linked); only questions the caller genuinely removed
        // are deleted, and only new ones (no id, or an id that isn't a real
        // existing question here) are inserted. The freeze guard above means
        // this path only ever runs on a template with zero recorded answers,
        // but the upsert stays as a second layer of protection.
        const { rows: existing } = await client.query(
          "SELECT id FROM survey_questions WHERE template_id = $1", [id]
        );
        const existingIds = new Set(existing.map((r: any) => r.id));
        const keptIds = new Set<string>();

        for (let i = 0; i < data.questions.length; i++) {
          const q = data.questions[i];
          const optionsJson = q.options ? JSON.stringify(q.options) : null;
          if (q.id && existingIds.has(q.id)) {
            await client.query(
              `UPDATE survey_questions SET text=$1, answer_type=$2, options=$3, q_order=$4, segment=$5 WHERE id=$6`,
              [q.text, q.answer_type || "free_text", optionsJson, q.q_order ?? i, q.segment || null, q.id]
            );
            keptIds.add(q.id);
          } else {
            const qid = "sq-" + Date.now() + "-" + i + "-" + Math.floor(Math.random() * 999);
            await client.query(
              "INSERT INTO survey_questions (id,template_id,text,answer_type,options,q_order,segment) VALUES ($1,$2,$3,$4,$5,$6,$7)",
              [qid, id, q.text, q.answer_type || "free_text", optionsJson, q.q_order ?? i, q.segment || null]
            );
            keptIds.add(qid);
          }
        }

        const removedIds = [...existingIds].filter((eid) => !keptIds.has(eid));
        if (removedIds.length) {
          await client.query("DELETE FROM survey_questions WHERE id = ANY($1)", [removedIds]);
        }
      }
      await client.query("COMMIT");
      return DB.getSurveyTemplateById(id);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ----------------------------------------------------
  // Surveys — Campaigns
  // ----------------------------------------------------
  static async getSurveyCampaigns(): Promise<any[]> {
    const { rows } = await pool.query(`
      SELECT c.*, b.brand_name, t.name AS template_name, u.full_name AS requested_by_name,
        da.full_name AS default_agent_name,
        (SELECT COUNT(*) FROM survey_assignments a WHERE a.campaign_id = c.id) AS total_numbers,
        (SELECT COUNT(*) FROM survey_assignments a WHERE a.campaign_id = c.id AND a.status = 'successful') AS done_numbers
      FROM survey_campaigns c
      LEFT JOIN brands b ON b.id = c.brand_id
      LEFT JOIN survey_templates t ON t.id = c.template_id
      LEFT JOIN users u ON u.id = c.requested_by
      LEFT JOIN users da ON da.id = c.default_agent_id
      ORDER BY c.created_at DESC
    `);
    return rows;
  }

  static async getSurveyCampaignById(id: string): Promise<any | undefined> {
    const { rows } = await pool.query(`
      SELECT TOP (1) c.*, b.brand_name, t.name AS template_name, u.full_name AS requested_by_name,
        da.full_name AS default_agent_name
      FROM survey_campaigns c
      LEFT JOIN brands b ON b.id = c.brand_id
      LEFT JOIN survey_templates t ON t.id = c.template_id
      LEFT JOIN users u ON u.id = c.requested_by
      LEFT JOIN users da ON da.id = c.default_agent_id
      WHERE c.id = $1
    `, [id]);
    return rows[0];
  }

  static async createSurveyCampaign(data: {
    brand_id?: string | null; requested_by: string; requester_role?: string;
    template_id?: string | null; survey_type: string; assignment_mode: string;
    continuity_type: string; requested_count: number; duration_days: number;
    default_agent_id?: string | null;
  }): Promise<any> {
    const id = "sc-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
    await pool.query(`
      INSERT INTO survey_campaigns (id,brand_id,requested_by,requester_role,template_id,survey_type,assignment_mode,continuity_type,requested_count,duration_days,status,default_agent_id,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,SYSDATETIMEOFFSET())
    `, [id, data.brand_id || null, data.requested_by, data.requester_role || null, data.template_id || null, data.survey_type, data.assignment_mode, data.continuity_type, data.requested_count, data.duration_days, data.default_agent_id || null]);
    return DB.getSurveyCampaignById(id);
  }

  static async setSurveyCampaignStatus(id: string, status: string): Promise<any | undefined> {
    await pool.query("UPDATE survey_campaigns SET status = $1 WHERE id = $2", [status, id]);
    return DB.getSurveyCampaignById(id);
  }

  // ----------------------------------------------------
  // Surveys — Numbers / dedup / capacity
  // ----------------------------------------------------
  static async wasRecentlyContacted(brandId: string | null, phone: string, days: number): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT TOP (1) 1 FROM customer_contacts WHERE phone_number = $1 AND ($2 IS NULL OR brand_id = $2)
         AND last_contacted_at > DATEADD(day, -CAST($3 AS INT), SYSDATETIMEOFFSET()) `,
      [phone, brandId, String(days)]
    );
    return rows.length > 0;
  }

  static async isPhoneQueued(brandId: string | null, phone: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT TOP (1) 1 FROM survey_assignments WHERE customer_phone = $1 AND ($2 IS NULL OR brand_id = $2)
         AND status IN ('pending','in_progress') `,
      [phone, brandId]
    );
    return rows.length > 0;
  }

  // Current pending counts per scheduled_date from today forward
  static async getPendingCountsByDate(): Promise<Map<string, number>> {
    const { rows } = await pool.query<{ d: string; c: string }>(
      `SELECT CONVERT(varchar(10), scheduled_date, 23) AS d, COUNT(*) AS c
       FROM survey_assignments WHERE status = 'pending' AND scheduled_date >= CAST(SYSDATETIMEOFFSET() AS DATE)
       GROUP BY scheduled_date`
    );
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.d, Number(r.c));
    return m;
  }

  static async addSurveyAssignments(rows: { campaign_id: string; brand_id: string | null; customer_phone: string; assigned_agent_id: string | null; scheduled_date: string; segment?: string | null }[]): Promise<number> {
    if (!rows.length) return 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < rows.length; i++) {
        const a = rows[i];
        const id = "sasg-" + Date.now() + "-" + i + "-" + Math.floor(Math.random() * 999);
        await client.query(
          `INSERT INTO survey_assignments (id,campaign_id,brand_id,customer_phone,assigned_agent_id,attempt_count,status,scheduled_date,segment,created_at)
           VALUES ($1,$2,$3,$4,$5,0,'pending',$6,$7,SYSDATETIMEOFFSET())`,
          [id, a.campaign_id, a.brand_id, a.customer_phone, a.assigned_agent_id, a.scheduled_date, a.segment || null]
        );
      }
      await client.query("COMMIT");
      return rows.length;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  static async getToday(): Promise<string> {
    // style 23 = ISO yyyy-mm-dd, the T-SQL equivalent of to_char(…,'YYYY-MM-DD')
    const { rows } = await pool.query<{ d: string }>(
      "SELECT CONVERT(varchar(10), CAST(SYSDATETIMEOFFSET() AS DATE), 23) AS d"
    );
    return rows[0].d;
  }

  static async getDailyCapacity(days: number, limit: number): Promise<{ date: string; used: number; limit: number }[]> {
    const counts = await DB.getPendingCountsByDate();
    // SQL Server has no generate_series, so the day offsets are built in JS
    // from the server's own "today" (keeping the same timezone reference).
    const today = await DB.getToday();
    const base = new Date(today + "T00:00:00Z");
    const rows = Array.from({ length: days }, (_, g) => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + g);
      return { d: d.toISOString().slice(0, 10) };
    });
    return rows.map((r) => ({ date: r.d, used: counts.get(r.d) || 0, limit }));
  }

  // ----------------------------------------------------
  // Surveys — Queue / assignments / attempts / responses
  // ----------------------------------------------------
  /**
   * An agent's work queue for today.
   *
   * Scoping rule: once a supervisor has hand-assigned any number to this agent,
   * their queue shows ONLY their own assignments — the shared unassigned pool of
   * an 'open' campaign is hidden, so a targeted assignment is not drowned out by
   * the rest of the campaign. Agents with nothing assigned still draw from the
   * shared pool, which is what keeps 'open' campaigns self-serve.
   *
   * The check is per-campaign, not global: being assigned rows in campaign A
   * must not hide campaign B's open pool from them.
   */
  static async getSurveyQueue(userId: string): Promise<any[]> {
    const { rows } = await pool.query(`
      SELECT TOP (300) a.*, c.template_id, c.survey_type, c.assignment_mode, c.continuity_type, b.brand_name,
        t.name AS template_name
      FROM survey_assignments a
      JOIN survey_campaigns c ON c.id = a.campaign_id
      LEFT JOIN brands b ON b.id = a.brand_id
      LEFT JOIN survey_templates t ON t.id = c.template_id
      WHERE a.status = 'pending' AND a.scheduled_date <= CAST(SYSDATETIMEOFFSET() AS DATE) AND c.status = 'active'
        AND (
          a.assigned_agent_id = $1
          OR (
            c.assignment_mode = 'open' AND a.assigned_agent_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM survey_assignments mine
              WHERE mine.campaign_id = a.campaign_id
                AND mine.assigned_agent_id = $1
                AND mine.status = 'pending'
            )
          )
        )
      ORDER BY a.scheduled_date ASC, a.created_at ASC
    `, [userId]);
    return rows;
  }

  static async getSurveyAssignmentById(id: string): Promise<any | undefined> {
    const { rows } = await pool.query(`
      SELECT TOP (1) a.*, c.template_id, c.survey_type, c.assignment_mode, c.continuity_type, c.status AS campaign_status,
        b.brand_name, t.name AS template_name, ag.full_name AS agent_name
      FROM survey_assignments a
      JOIN survey_campaigns c ON c.id = a.campaign_id
      LEFT JOIN brands b ON b.id = a.brand_id
      LEFT JOIN survey_templates t ON t.id = c.template_id
      LEFT JOIN users ag ON ag.id = a.assigned_agent_id
      WHERE a.id = $1
    `, [id]);
    if (!rows[0]) return undefined;
    const questions = rows[0].template_id
      ? (await pool.query("SELECT * FROM survey_questions WHERE template_id = $1 ORDER BY q_order ASC", [rows[0].template_id])).rows
      : [];
    const attempts = (await pool.query(`
      SELECT sa.*, u.full_name AS agent_name FROM survey_call_attempts sa
      LEFT JOIN users u ON u.id = sa.agent_id WHERE sa.assignment_id = $1 ORDER BY sa.attempt_number ASC
    `, [id])).rows;
    return { ...rows[0], questions, attempts };
  }

  static async addSurveyAttempt(data: { assignment_id: string; agent_id: string; outcome: string; note?: string }): Promise<{ attempt: any; assignment: any }> {
    const asg = await DB.getSurveyAssignmentById(data.assignment_id);
    if (!asg) throw new Error("Assignment not found.");
    const n = (asg.attempt_count || 0) + 1;
    const id = "scatt-" + Date.now() + "-" + Math.floor(Math.random() * 999);
    const { rows } = await pool.query(
      `INSERT INTO survey_call_attempts (id,assignment_id,agent_id,attempt_number,outcome,note,created_at) OUTPUT INSERTED.*
       VALUES ($1,$2,$3,$4,$5,$6,SYSDATETIMEOFFSET())`,
      [id, data.assignment_id, data.agent_id, n, data.outcome, data.note || null]
    );

    // Determine new status
    const sets: string[] = ["attempt_count = $1"]; const vals: any[] = [n]; let idx = 2;
    let newStatus = "in_progress";
    let becameNotReached = 0;
    if (data.outcome === "declined") {
      newStatus = "declined";
      becameNotReached = 1;
    } else if (data.outcome !== "answered" && n >= 3) {
      if (asg.continuity_type === "continuous") {
        // Reschedule to next day, reset attempts, keep pending
        newStatus = "pending";
        sets[0] = "attempt_count = 0";
        sets.push(`scheduled_date = DATEADD(day, 1, CAST(SYSDATETIMEOFFSET() AS DATE))`);
      } else {
        newStatus = "unreachable";
        becameNotReached = 1;
      }
    }
    sets.push(`status = $${idx++}`); vals.push(newStatus);
    // When the call reaches a terminal "Not Reached (No Action)" state, stamp reachability + completion time
    if (becameNotReached) {
      sets.push(`reachability = 'not_reached'`);
      sets.push(`action_type = 'no_action'`);
      sets.push(`completed_at = SYSDATETIMEOFFSET()`);
    }
    vals.push(data.assignment_id);
    await pool.query(`UPDATE survey_assignments SET ${sets.join(",")} WHERE id = $${idx}`, vals);

    // Mirror a Not Reached (No Action) outcome into Survey Data so it stays available for reporting
    if (becameNotReached) {
      const agentName = asg.agent_name || (await pool.query("SELECT full_name FROM users WHERE id = $1", [data.agent_id])).rows[0]?.full_name || null;
      const srid = "srec-" + Date.now() + "-" + Math.floor(Math.random() * 99999);
      await pool.query(
        `INSERT INTO survey_records (id,record_type,brand_id,brand_label,phone,served_by,answered,note,extra,record_date,uploaded_by,created_at)
         VALUES ($1,'survey_live',$2,$3,$4,$5,0,'no_action',$6, CONVERT(varchar(10), DATEADD(hour, 3, SYSDATETIMEOFFSET()), 23),$7, SYSDATETIMEOFFSET())`,
        [srid, asg.brand_id || null, asg.brand_name || null, asg.customer_phone || null, agentName,
         JSON.stringify({ reachability: "not_reached", action_type: "no_action", campaign_id: asg.campaign_id, outcome: data.outcome }), data.agent_id]
      );
    }

    return { attempt: rows[0], assignment: await DB.getSurveyAssignmentById(data.assignment_id) };
  }

  static async addSurveyResponse(data: {
    assignment_id: string; agent_id: string;
    answers: { question_id: string; answer_value?: string; answered: boolean }[];
    brand_id: string | null; customer_phone: string;
    reachability?: string; action_type?: string; segment?: string;
    // "completed" (default) collects the answers below; "refused"/"not_interested"
    // record that the agent reached the customer but they declined the survey —
    // no answers are stored for those, but they are NOT bucketed with unreachable.
    outcome?: "completed" | "refused" | "not_interested";
  }): Promise<any> {
    const reachability = data.reachability === "not_reached" ? "not_reached" : "reached";
    const action_type = data.action_type === "complaint" ? "complaint" : "no_action";
    const declinedOutcome = reachability === "reached" && (data.outcome === "refused" || data.outcome === "not_interested");
    // "answered" drives whether real answers are stored/counted as a completed
    // survey; a reached-but-declined outcome collected no answers either.
    const answered = reachability === "reached" && !declinedOutcome;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const asg = await DB.getSurveyAssignmentById(data.assignment_id);
      const rid = "sresp-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
      await client.query(
        "INSERT INTO survey_responses (id,assignment_id,agent_id,answered_at) VALUES ($1,$2,$3,SYSDATETIMEOFFSET())",
        [rid, data.assignment_id, data.agent_id]
      );
      // Derive a headline rate + comment for the Survey Data record from the answers
      let rate: number | null = null;
      let comment: string | null = null;
      const answers = answered ? data.answers : [];
      for (let i = 0; i < answers.length; i++) {
        const a = answers[i];
        const aid = "sans-" + Date.now() + "-" + i + "-" + Math.floor(Math.random() * 999);
        await client.query(
          "INSERT INTO survey_answers (id,response_id,question_id,answer_value,answered) VALUES ($1,$2,$3,$4,$5)",
          [aid, rid, a.question_id, a.answer_value || null, !!a.answered]
        );
      }
      if (answered && answers.length) {
        const qids = answers.map((a) => a.question_id).filter(Boolean);
        const { rows: qs } = await client.query("SELECT id, answer_type FROM survey_questions WHERE id = ANY($1)", [qids]);
        const qtype = new Map(qs.map((q: any) => [q.id, q.answer_type]));
        for (const a of answers) {
          const t = qtype.get(a.question_id);
          if ((t === "rating_1_5" || t === "rating_1_10") && rate == null) {
            const n = parseInt(String(a.answer_value), 10);
            if (!isNaN(n)) rate = t === "rating_1_10" ? Math.max(1, Math.round(n / 2)) : n;
          } else if (t === "free_text" && a.answer_value && !comment) {
            comment = String(a.answer_value);
          }
        }
      }
      // Terminal status: successful when a real survey was collected, the
      // declined outcome when reached-but-refused, unreachable otherwise.
      const newStatus = answered ? "successful" : declinedOutcome ? (data.outcome as string) : "unreachable";
      await client.query(
        "UPDATE survey_assignments SET status = $2, reachability = $3, action_type = $4, completed_at = SYSDATETIMEOFFSET() WHERE id = $1",
        [data.assignment_id, newStatus, reachability, action_type]
      );
      // Mirror the outcome into Survey Data (survey_records) so it shows in reports/history
      const agentName = asg?.agent_name || (await client.query("SELECT full_name FROM users WHERE id = $1", [data.agent_id])).rows[0]?.full_name || null;
      const complaint = action_type === "complaint" ? (comment || "Complaint") : null;
      const srid = "srec-" + Date.now() + "-" + Math.floor(Math.random() * 99999);
      await client.query(
        `INSERT INTO survey_records (id,record_type,brand_id,brand_label,phone,served_by,rate,answered,comment,complaint,note,segment,extra,record_date,uploaded_by,created_at)
         VALUES ($1,'survey_live',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CONVERT(varchar(10), DATEADD(hour, 3, SYSDATETIMEOFFSET()), 23), $13, SYSDATETIMEOFFSET())`,
        [srid, data.brand_id, asg?.brand_name || null, data.customer_phone, agentName, rate, answered,
         comment, complaint, action_type, data.segment || null, JSON.stringify({ reachability, action_type, outcome: newStatus, segment: data.segment || null, campaign_id: asg?.campaign_id, template: asg?.template_name }), data.agent_id]
      );
      // Update contact recency
      const ccid = "cc-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
      // Upsert on (brand_id, phone_number). Written as an explicit
      // update-then-insert because SQL Server has no ON CONFLICT; the
      // uq_cc_brand_phone filtered index still guards against races.
      await client.query(
        `UPDATE customer_contacts
           SET last_contacted_at = SYSDATETIMEOFFSET(), last_contacted_brand_id = $2
         WHERE brand_id = $2 AND phone_number = $3;
         IF @@ROWCOUNT = 0
         INSERT INTO customer_contacts (id,brand_id,phone_number,last_contacted_at,last_contacted_brand_id)
         VALUES ($1,$2,$3,SYSDATETIMEOFFSET(),$2)`,
        [ccid, data.brand_id, data.customer_phone]
      );
      await client.query("COMMIT");
      return DB.getSurveyAssignmentById(data.assignment_id);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // Manually assign (or reassign, or clear) a single survey assignment
  static async assignSurveyAssignment(assignmentId: string, agentId: string | null): Promise<any> {
    await pool.query("UPDATE survey_assignments SET assigned_agent_id = $1 WHERE id = $2", [agentId, assignmentId]);
    return DB.getSurveyAssignmentById(assignmentId);
  }

  // All survey assignments across campaigns, for the "View All Surveys" page + reporting
  static async getAllSurveyAssignments(filter: {
    brand_id?: string; agent_id?: string; status?: string; action_type?: string; survey_type?: string; segment?: string; from?: string; to?: string;
  } = {}): Promise<{ records: any[]; total: number; cap: number }> {
    const { where, values } = DB.surveyFilterSql(filter);
    const CAP = 1000;
    const { rows } = await pool.query(`
      SELECT TOP (${CAP}) a.*, b.brand_name, u.full_name AS agent_name, c.assignment_mode, c.survey_type, t.name AS template_name
      FROM survey_assignments a
      LEFT JOIN brands b ON b.id = a.brand_id
      LEFT JOIN users u ON u.id = a.assigned_agent_id
      LEFT JOIN survey_campaigns c ON c.id = a.campaign_id
      LEFT JOIN survey_templates t ON t.id = c.template_id
      ${where}
      ORDER BY a.created_at DESC
    `, values);
    const { rows: cnt } = await pool.query(`SELECT COUNT(*) AS total FROM survey_assignments a ${where}`, values);
    return { records: rows, total: cnt[0]?.total ?? rows.length, cap: CAP };
  }

  /**
   * Shared WHERE builder for the All-Surveys views, so the list, the overview
   * counts and the per-agent stats can never disagree about what "the current
   * filter" means.
   */
  private static surveyFilterSql(filter: {
    brand_id?: string; agent_id?: string; status?: string; action_type?: string;
    survey_type?: string; segment?: string; from?: string; to?: string;
  }, startIdx = 1): { where: string; values: any[]; nextIdx: number } {
    const clauses: string[] = []; const values: any[] = []; let idx = startIdx;
    if (filter.brand_id) { clauses.push(`a.brand_id = $${idx++}`); values.push(filter.brand_id); }
    // survey_type lives on the campaign, so this is a correlated lookup rather
    // than a column on the assignment itself.
    if (filter.survey_type) {
      clauses.push(`EXISTS (SELECT 1 FROM survey_campaigns sc WHERE sc.id = a.campaign_id AND sc.survey_type = $${idx++})`);
      values.push(filter.survey_type);
    }
    // "none" selects rows uploaded without a segment, which is a real bucket
    // worth isolating — not the same as "no segment filter applied".
    if (filter.segment === "none") { clauses.push(`(a.segment IS NULL OR TRIM(a.segment) = '')`); }
    else if (filter.segment) { clauses.push(`a.segment = $${idx++}`); values.push(filter.segment); }
    if (filter.agent_id === "unassigned") { clauses.push(`a.assigned_agent_id IS NULL`); }
    else if (filter.agent_id) { clauses.push(`a.assigned_agent_id = $${idx++}`); values.push(filter.agent_id); }
    if (filter.status === "pending") { clauses.push(`a.status IN ('pending','in_progress')`); }
    else if (filter.status === "completed") { clauses.push(`a.status = 'successful'`); }
    else if (filter.status === "not_reached") { clauses.push(`a.status IN ('unreachable','declined')`); }
    // Reached, but the customer declined to finish or wasn't interested — distinct
    // from "not_reached" (never got the customer on the line at all).
    else if (filter.status === "refused") { clauses.push(`a.status = 'refused'`); }
    else if (filter.status === "not_interested") { clauses.push(`a.status = 'not_interested'`); }
    if (filter.action_type) { clauses.push(`a.action_type = $${idx++}`); values.push(filter.action_type); }
    if (filter.from) { clauses.push(`a.created_at >= $${idx++}`); values.push(filter.from); }
    if (filter.to) { clauses.push(`a.created_at <= $${idx++}`); values.push(filter.to); }
    return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values, nextIdx: idx };
  }

  /**
   * Headline counts, a per-survey (template) breakdown and per-agent stats for
   * the All Surveys page. Status buckets match the list view exactly:
   *   successful                  -> Completed – Reached
   *   unreachable / declined      -> Completed – Not Reached
   *   refused / not_interested    -> Reached, but declined to finish (own bucket —
   *                                  neither "collected a survey" nor "never got them")
   *   pending / in_progress       -> Pending
   *
   * SQL Server has no FILTER (WHERE ...) clause (Postgres-only), so each
   * bucket is a SUM(CASE WHEN ... THEN 1 ELSE 0 END) instead.
   */
  static async getSurveyOverview(filter: {
    brand_id?: string; agent_id?: string; status?: string; action_type?: string; survey_type?: string; segment?: string; from?: string; to?: string;
  } = {}): Promise<{
    summary: { total: number; reached: number; not_reached: number; refused_not_interested: number; pending: number };
    byTemplate: { template_name: string; total: number; reached: number; not_reached: number; refused_not_interested: number; pending: number }[];
    byAgent: { agent_id: string | null; agent_name: string; assigned: number; completed: number; reached: number; not_reached: number; refused_not_interested: number; pending: number }[];
  }> {
    const { where, values } = DB.surveyFilterSql(filter);
    const BUCKETS = `
      COUNT(*) AS total,
      SUM(CASE WHEN a.status = 'successful' THEN 1 ELSE 0 END) AS reached,
      SUM(CASE WHEN a.status IN ('unreachable','declined') THEN 1 ELSE 0 END) AS not_reached,
      SUM(CASE WHEN a.status IN ('refused','not_interested') THEN 1 ELSE 0 END) AS refused_not_interested,
      SUM(CASE WHEN a.status IN ('pending','in_progress') THEN 1 ELSE 0 END) AS pending`;

    const { rows: sum } = await pool.query(`
      SELECT ${BUCKETS} FROM survey_assignments a ${where}
    `, values);

    const { rows: byTemplate } = await pool.query(`
      SELECT COALESCE(t.name, N'— No template —') AS template_name, ${BUCKETS}
      FROM survey_assignments a
      LEFT JOIN survey_campaigns c ON c.id = a.campaign_id
      LEFT JOIN survey_templates t ON t.id = c.template_id
      ${where}
      GROUP BY COALESCE(t.name, N'— No template —')
      ORDER BY total DESC
    `, values);

    const { rows: byAgent } = await pool.query(`
      SELECT a.assigned_agent_id AS agent_id,
             COALESCE(u.full_name, N'— Unassigned —') AS agent_name,
             ${BUCKETS},
             SUM(CASE WHEN a.status IN ('successful','unreachable','declined','refused','not_interested') THEN 1 ELSE 0 END) AS completed
      FROM survey_assignments a
      LEFT JOIN users u ON u.id = a.assigned_agent_id
      ${where}
      GROUP BY a.assigned_agent_id, u.full_name
      ORDER BY total DESC
    `, values);

    const s = sum[0] || {};
    return {
      summary: {
        total: s.total ?? 0, reached: s.reached ?? 0,
        not_reached: s.not_reached ?? 0, refused_not_interested: s.refused_not_interested ?? 0,
        pending: s.pending ?? 0,
      },
      // `assigned` is the agent's whole workload; `completed` is everything that
      // reached a terminal state, whatever the outcome.
      byTemplate,
      byAgent: byAgent.map((r: any) => ({ ...r, assigned: r.total })),
    };
  }

  /**
   * Leader-level edit of a single survey's outcome.
   *
   * Returning a finished survey to Pending also clears the outcome fields and
   * resets attempt_count — otherwise the row would reappear in the queue but
   * the agent could not act on it, since three logged attempts block any
   * further call.
   */
  static async updateSurveyAssignment(id: string, fields: {
    status?: string; action_type?: string; reachability?: string;
  }): Promise<any | undefined> {
    const sets: string[] = []; const values: any[] = []; let idx = 1;

    if (fields.status === "pending") {
      sets.push(`status = 'pending'`, `reachability = NULL`, `completed_at = NULL`, `attempt_count = 0`);
    } else if (fields.status) {
      sets.push(`status = $${idx++}`); values.push(fields.status);
      // A terminal status carries its matching reachability and a completion stamp.
      // refused/not_interested are reached-but-declined outcomes, not "never got them".
      if (fields.status === "successful" || fields.status === "refused" || fields.status === "not_interested") sets.push(`reachability = 'reached'`);
      else if (fields.status === "unreachable" || fields.status === "declined") sets.push(`reachability = 'not_reached'`);
      sets.push(`completed_at = COALESCE(completed_at, SYSDATETIMEOFFSET())`);
    }
    if (fields.action_type) { sets.push(`action_type = $${idx++}`); values.push(fields.action_type); }
    if (fields.reachability) { sets.push(`reachability = $${idx++}`); values.push(fields.reachability); }
    if (!sets.length) return DB.getSurveyAssignmentById(id);

    values.push(id);
    await pool.query(`UPDATE survey_assignments SET ${sets.join(", ")} WHERE id = $${idx}`, values);
    return DB.getSurveyAssignmentById(id);
  }

  static async getCampaignAssignments(campaignId: string): Promise<any[]> {
    const { rows } = await pool.query(`
      SELECT TOP (500) a.*, u.full_name AS agent_name FROM survey_assignments a
      LEFT JOIN users u ON u.id = a.assigned_agent_id
      WHERE a.campaign_id = $1 ORDER BY a.created_at ASC
    `, [campaignId]);
    return rows;
  }

  // Manually assign N unassigned pending numbers of a campaign to an agent
  static async assignCampaignNumbers(campaignId: string, agentId: string, count: number): Promise<number> {
    const { rows } = await pool.query(
      `SELECT TOP ($2) id FROM survey_assignments WHERE campaign_id = $1 AND assigned_agent_id IS NULL AND status = 'pending'
       ORDER BY created_at ASC `,
      [campaignId, count]
    );
    if (!rows.length) return 0;
    const ids = rows.map((r) => r.id);
    await pool.query("UPDATE survey_assignments SET assigned_agent_id = $1 WHERE id = ANY($2)", [agentId, ids]);
    return ids.length;
  }

  static async getSurveyAgents(): Promise<any[]> {
    const { rows } = await pool.query(`
      SELECT id, full_name, role, work_type FROM users
      WHERE status = 'Active' AND (work_type IS NULL OR work_type IN ('survey','both'))
      ORDER BY full_name ASC
    `);
    return rows;
  }

  /**
   * Survey-capable agents with their current workload, so whoever is assigning
   * can see how loaded each agent already is instead of guessing.
   * `open_tasks` is what still needs doing; `total_tasks` is everything ever
   * assigned to them.
   */
  static async getSurveyAgentWorkload(): Promise<any[]> {
    const { rows } = await pool.query(`
      SELECT u.id, u.full_name, u.role, u.work_type,
        SUM(CASE WHEN a.status IN ('pending','in_progress') THEN 1 ELSE 0 END) AS open_tasks,
        COUNT(a.id) AS total_tasks
      FROM users u
      LEFT JOIN survey_assignments a ON a.assigned_agent_id = u.id
      WHERE u.status = 'Active' AND (u.work_type IS NULL OR u.work_type IN ('survey','both'))
      GROUP BY u.id, u.full_name, u.role, u.work_type
      ORDER BY u.full_name ASC
    `);
    return rows;
  }

  static async countTodaySuccess(userId: string): Promise<number> {
    const { rows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*) AS c FROM survey_responses WHERE agent_id = $1 AND CAST(answered_at AS DATE) = CAST(SYSDATETIMEOFFSET() AS DATE)`,
      [userId]
    );
    return Number(rows[0]?.c || 0);
  }

  // ----------------------------------------------------
  // Surveys — Records (uploaded results)
  // ----------------------------------------------------
  static async addSurveyRecords(records: any[]): Promise<number> {
    if (!records.length) return 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const id = "srec-" + Date.now() + "-" + i + "-" + Math.floor(Math.random() * 999);
        await client.query(`
          INSERT INTO survey_records (id,record_type,brand_id,brand_label,platform_id,platform_label,order_id,phone,customer_name,item_name,rate,product_feedback,served_by,answered,customer_suggestion,comment,complaint,note,trials,segment,extra,record_date,uploaded_by,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,SYSDATETIMEOFFSET())
        `, [id, r.record_type, r.brand_id || null, r.brand_label || null, r.platform_id || null, r.platform_label || null,
            r.order_id || null, r.phone || null, r.customer_name || null, r.item_name || null,
            r.rate ?? null, r.product_feedback || null, r.served_by || null, !!r.answered,
            r.customer_suggestion || null, r.comment || null, r.complaint || null, r.note || null,
            r.trials || null, r.segment || null, r.extra ? JSON.stringify(r.extra) : null, r.record_date || null, r.uploaded_by]);
      }
      await client.query("COMMIT");
      return records.length;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  static async getSurveyRecords(filter: {
    record_type?: string; brand_id?: string; answered?: boolean; from?: string; to?: string; segment?: string;
  } = {}): Promise<{ records: any[]; total: number; cap: number }> {
    const clauses: string[] = []; const values: any[] = []; let idx = 1;
    if (filter.record_type) { clauses.push(`r.record_type = $${idx++}`); values.push(filter.record_type); }
    if (filter.brand_id) { clauses.push(`r.brand_id = $${idx++}`); values.push(filter.brand_id); }
    if (filter.answered != null) { clauses.push(`r.answered = $${idx++}`); values.push(filter.answered); }
    if (filter.from) { clauses.push(`r.created_at >= $${idx++}`); values.push(filter.from); }
    if (filter.to) { clauses.push(`r.created_at <= $${idx++}`); values.push(filter.to); }
    if (filter.segment === "none") { clauses.push(`r.segment IS NULL`); }
    else if (filter.segment) { clauses.push(`r.segment = $${idx++}`); values.push(filter.segment); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const LIST_CAP = 1000;
    const { rows } = await pool.query(`
      SELECT TOP (${LIST_CAP}) r.*, b.brand_name, p.name AS platform_name, u.full_name AS uploaded_by_name
      FROM survey_records r
      LEFT JOIN brands b ON b.id = r.brand_id
      LEFT JOIN platforms p ON p.id = r.platform_id
      LEFT JOIN users u ON u.id = r.uploaded_by
      ${where}
      ORDER BY r.created_at DESC
    `, values);
    const { rows: cnt } = await pool.query(`SELECT COUNT(*) AS total FROM survey_records r ${where}`, values);
    return { records: rows, total: cnt[0]?.total ?? rows.length, cap: LIST_CAP };
  }

  // Delete survey records (optionally scoped by the same filters as the list).
  /**
   * `survey_live` rows are written automatically when an agent completes (or
   * marks Not Reached on) a live survey — they are the employee's own
   * recorded work, not an admin-uploaded file. This function must never be
   * able to delete them, regardless of what filter is passed in, so the
   * guard sits inside the query itself rather than relying on every caller
   * remembering to exclude it.
   */
  static async deleteSurveyRecords(filter: {
    record_type?: string; brand_id?: string; answered?: boolean; from?: string; to?: string;
  } = {}): Promise<number> {
    if (filter.record_type === "survey_live") {
      throw new Error("Survey responses recorded by agents cannot be deleted.");
    }
    const clauses: string[] = ["record_type <> 'survey_live'"]; const values: any[] = []; let idx = 1;
    if (filter.record_type) { clauses.push(`record_type = $${idx++}`); values.push(filter.record_type); }
    if (filter.brand_id) { clauses.push(`brand_id = $${idx++}`); values.push(filter.brand_id); }
    if (filter.answered != null) { clauses.push(`answered = $${idx++}`); values.push(filter.answered); }
    if (filter.from) { clauses.push(`created_at >= $${idx++}`); values.push(filter.from); }
    if (filter.to) { clauses.push(`created_at <= $${idx++}`); values.push(filter.to); }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const res = await pool.query(`DELETE FROM survey_records ${where}`, values);
    return res.rowCount ?? 0;
  }

  // Remove duplicate survey records — keeps the earliest row per
  // (record_type, order_id); only dedupes rows that carry an order_id.
  // Excludes survey_live for the same reason as deleteSurveyRecords above.
  //
  // NOTE: the original port of this query used Postgres' `DELETE ... USING`,
  // which SQL Server does not support at all (no such clause exists there) —
  // fixed here to the T-SQL form (`DELETE <alias> FROM ... JOIN ...`).
  static async dedupeSurveyRecords(): Promise<number> {
    const res = await pool.query(`
      DELETE a
      FROM survey_records a
      JOIN survey_records b
        ON a.record_type = b.record_type
        AND a.order_id = b.order_id
        AND COALESCE(a.phone,'') = COALESCE(b.phone,'')
      WHERE a.id > b.id
        AND a.record_type <> 'survey_live'
        AND a.order_id IS NOT NULL AND a.order_id <> ''
    `);
    return res.rowCount ?? 0;
  }

  // ----------------------------------------------------
  // Feedback dashboard — aggregated Ratings + Surveys analytics
  // fromISO/toISO are UTC ISO strings (or null for all-time).
  // ----------------------------------------------------
  static async getFeedbackDashboard(fromISO: string | null, toISO: string | null): Promise<any> {
    const dr = [fromISO, toISO];
    const q = (sql: string) => pool.query(sql, dr);
    const rW = `($1 IS NULL OR r.uploaded_at >= $1) AND ($2 IS NULL OR r.uploaded_at <= $2)`;
    const tW = `($1 IS NULL OR created_at >= $1) AND ($2 IS NULL OR created_at <= $2)`;

    // ---- Ratings / Reviews ----
    const rTot = (await q(`SELECT COUNT(*) total, COALESCE(ROUND(AVG(CAST(rating AS FLOAT)),2),0) avg_rating,
        SUM(CASE WHEN requires_action = 1 THEN 1 ELSE 0 END) needs_action,
        SUM(CASE WHEN action_status IN ('resolved','no_action_needed') THEN 1 ELSE 0 END) resolved,
        SUM(CASE WHEN action_status='unreachable' THEN 1 ELSE 0 END) unreachable
      FROM ratings r WHERE ${rW}`)).rows[0];
    const rByStatus = (await q(`SELECT action_status name, COUNT(*) count FROM ratings r WHERE ${rW} GROUP BY action_status ORDER BY count DESC`)).rows;
    const rByRating = (await q(`SELECT CAST(rating AS NVARCHAR(10)) name, COUNT(*) count FROM ratings r WHERE ${rW} GROUP BY rating ORDER BY rating`)).rows;
    const rByBrand = (await q(`SELECT COALESCE(b.brand_name,'—') name, COUNT(*) count FROM ratings r LEFT JOIN brands b ON b.id=r.brand_id WHERE ${rW} GROUP BY b.brand_name ORDER BY count DESC `)).rows;
    const rByPlatform = (await q(`SELECT COALESCE(p.name,'—') name, COUNT(*) count FROM ratings r LEFT JOIN platforms p ON p.id=r.platform_id WHERE ${rW} GROUP BY p.name ORDER BY count DESC `)).rows;
    // Avg rating per platform / per brand (spec §6)
    const platformPerf = (await q(`SELECT COALESCE(p.name,'—') name, COUNT(*) count, COALESCE(ROUND(AVG(CAST(rating AS FLOAT)),2),0) avg FROM ratings r LEFT JOIN platforms p ON p.id=r.platform_id WHERE ${rW} GROUP BY p.name ORDER BY count DESC `)).rows;
    const brandPerf = (await q(`SELECT COALESCE(b.brand_name,'—') name, COUNT(*) count, COALESCE(ROUND(AVG(CAST(rating AS FLOAT)),2),0) avg FROM ratings r LEFT JOIN brands b ON b.id=r.brand_id WHERE ${rW} GROUP BY b.brand_name ORDER BY count DESC `)).rows;
    // Per-branch detail behind each brand, so a brand row can be expanded to see
    // which branches are pulling its average up or down. Rows with no branch on
    // the source review are grouped under a single explicit bucket rather than
    // silently dropped, so the branch counts still reconcile with the brand total.
    const brandBranchPerf = (await q(`
      SELECT COALESCE(b.brand_name,'—') brand,
             COALESCE(NULLIF(TRIM(r.branch),''),'— No branch —') name,
             COUNT(*) count,
             COALESCE(ROUND(AVG(CAST(rating AS FLOAT)),2),0) avg
      FROM ratings r LEFT JOIN brands b ON b.id=r.brand_id
      WHERE ${rW}
      GROUP BY b.brand_name, COALESCE(NULLIF(TRIM(r.branch),''),'— No branch —')
      ORDER BY brand ASC, count DESC`)).rows;
    const rByAgent = (await q(`SELECT TOP (10) ua.full_name name, COUNT(*) assigned,
        SUM(CASE WHEN r.action_status IN ('resolved','no_action_needed','unreachable') THEN 1 ELSE 0 END) done
      FROM ratings r JOIN users ua ON ua.id=r.assigned_agent_id WHERE ${rW} AND r.assigned_agent_id IS NOT NULL
      GROUP BY ua.full_name ORDER BY assigned DESC `)).rows;

    // ---- Surveys ----
    const campTotal = (await q(`SELECT COUNT(*) c FROM survey_campaigns WHERE ${tW}`)).rows[0].c;
    const campByStatus = (await q(`SELECT status name, COUNT(*) count FROM survey_campaigns WHERE ${tW} GROUP BY status ORDER BY count DESC`)).rows;
    const asgTot = (await q(`SELECT COUNT(*) total,
        SUM(CASE WHEN status='successful' THEN 1 ELSE 0 END) successful
      FROM survey_assignments WHERE ${tW}`)).rows[0];
    const asgByStatus = (await q(`SELECT status name, COUNT(*) count FROM survey_assignments WHERE ${tW} GROUP BY status ORDER BY count DESC`)).rows;
    const recTot = (await q(`SELECT COUNT(*) total,
        SUM(CASE WHEN answered = 1 THEN 1 ELSE 0 END) answered,
        SUM(CASE WHEN answered = 0 THEN 1 ELSE 0 END) no_answer
      FROM survey_records WHERE ${tW}`)).rows[0];
    const recByType = (await q(`SELECT record_type name, COUNT(*) count FROM survey_records WHERE ${tW} GROUP BY record_type ORDER BY count DESC`)).rows;
    const recByBrand = (await q(`SELECT TOP (8) COALESCE(b.brand_name, sr.brand_label, '—') name, COUNT(*) count
      FROM survey_records sr LEFT JOIN brands b ON b.id=sr.brand_id
      WHERE ($1 IS NULL OR sr.created_at >= $1) AND ($2 IS NULL OR sr.created_at <= $2)
      GROUP BY COALESCE(b.brand_name, sr.brand_label, '—') ORDER BY count DESC `)).rows;
    const surveyTopAgents = (await q(`SELECT TOP (10) u.full_name name, COUNT(*) successful
      FROM survey_responses resp JOIN users u ON u.id=resp.agent_id
      WHERE ($1 IS NULL OR resp.answered_at >= $1) AND ($2 IS NULL OR resp.answered_at <= $2)
      GROUP BY u.full_name ORDER BY successful DESC `)).rows;
    // Survey records per employee (Served By) — includes historical imports.
    const recByAgent = (await q(`SELECT TOP (30) COALESCE(NULLIF(TRIM(served_by),''),'—') name,
        COUNT(*) count,
        SUM(CASE WHEN answered = 1 THEN 1 ELSE 0 END) answered,
        COALESCE(ROUND(AVG(CAST(rate AS FLOAT)),2),0) avg
      FROM survey_records WHERE ${tW} GROUP BY COALESCE(NULLIF(TRIM(served_by),''),'—')
      ORDER BY count DESC `)).rows;

    return {
      ratings: {
        total: rTot.total, avgRating: Number(rTot.avg_rating), needsAction: rTot.needs_action,
        resolved: rTot.resolved, unreachable: rTot.unreachable,
        resolutionRate: rTot.needs_action > 0 ? Math.round((rTot.resolved / rTot.needs_action) * 100) : 0,
        byStatus: rByStatus, byRating: rByRating, byBrand: rByBrand, byPlatform: rByPlatform, byAgent: rByAgent,
        platformPerf, brandPerf, brandBranchPerf,
      },
      surveys: {
        campaigns: { total: campTotal, byStatus: campByStatus },
        assignments: {
          total: asgTot.total, successful: asgTot.successful,
          successRate: asgTot.total > 0 ? Math.round((asgTot.successful / asgTot.total) * 100) : 0,
          byStatus: asgByStatus,
        },
        records: { total: recTot.total, answered: recTot.answered, noAnswer: recTot.no_answer, byType: recByType, byBrand: recByBrand, byAgent: recByAgent },
        topAgents: surveyTopAgents,
      },
    };
  }
}
