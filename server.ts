import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { DB } from "./server/db.js";
import { roleDefaultLevel, EXECUTIVE_LEVEL, USER_TYPES } from "./src/types.js";

dotenv.config();

// Cross-department (management) roles see everything; below that is department-scoped.
const isExecutive = (u: any) => u.role === "admin" || u.role === "owner" || (Number(u.level ?? roleDefaultLevel(u.role)) >= EXECUTIVE_LEVEL);
const userLevel = (u: any) => Number(u.level ?? roleDefaultLevel(u.role));
// Strict chain of command: each role assigns only to the tier directly below it
// (direct reports). The level ladder is contiguous (1..6), so that tier = level-1.
// Department-scoped roles stay within their department; management is org-wide.
// The Call Center Manager heads operations across these departments
const OPS_DEPTS = ["Call Center", "Technical", "Complaints"];
const canAssignTo = (actor: any, target: any): boolean => {
  if (actor.role === "admin") return true; // System Admin: unrestricted
  if (!target || target.status === "Inactive") return false;
  // The Owner's only direct report is the Call Center Manager.
  if (actor.role === "owner") return target.job_title === "Call Center Manager";
  // The Call Center Manager & Assistant Manager oversee everyone in the operations departments.
  if (actor.job_title === "Call Center Manager" || actor.job_title === "Assistant Manager") {
    return userLevel(target) < userLevel(actor) && OPS_DEPTS.includes(target.department || "");
  }
  if (userLevel(target) >= userLevel(actor)) return false; // must be lower level
  if (isExecutive(actor)) return true; // management: any department
  return (target.department || "") === (actor.department || ""); // dept-scoped
};

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Increase request size limit for base64 file uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ----------------------------------------------------
// Universal action log — every add/edit/delete, for every endpoint,
// forever. This is deliberately generic rather than a per-route call
// (the codebase already had ~15 hand-placed DB.addAuditLog calls, which only
// covers a fraction of what mutates data — any endpoint someone forgets to
// instrument is invisible). A single request-level hook can't be forgotten:
// it fires for every successful POST/PUT/PATCH/DELETE regardless of which
// route handled it, including ones added after this was written.
//
// It is registered before any route, but the actual logging happens on
// res.on('finish') — by then the route's own middleware (authenticateJWT)
// has already run on this same `req` object and set req.user, and the
// response body/status are known. GET requests are not logged (pure reads
// are not "actions"), and failed requests (4xx/5xx) are not logged (nothing
// was actually written).
const AUDIT_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SENSITIVE_BODY_KEYS = new Set([
  "password", "password_hash", "current_password", "new_password", "token",
]);

function summarizeBody(body: any): string {
  if (!body || typeof body !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE_BODY_KEYS.has(k)) { parts.push(`${k}=***`); continue; }
    if (v == null) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    // Base64 file uploads and long blobs would otherwise flood every entry.
    parts.push(`${k}=${s.length > 120 ? s.slice(0, 120) + "…" : s}`);
  }
  return parts.join(", ");
}

// First path segment after /api/ — a stable, low-maintenance category that
// covers every current and future route without a lookup table to keep in sync.
function categoryFromPath(p: string): string {
  const m = p.match(/^\/api\/([^/]+)/);
  if (!m) return "System";
  return m[1].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

app.use((req: any, res: any, next: any) => {
  res.on("finish", () => {
    try {
      if (!AUDIT_METHODS.has(req.method)) return;
      if (res.statusCode >= 400) return; // failed writes changed nothing
      if (!req.user) return; // unauthenticated route (e.g. login itself)
      void DB.addAuditLog({
        operator_id: req.user.id,
        operator_name: req.user.full_name,
        operator_role: req.user.role,
        department: req.user.department || undefined,
        category: categoryFromPath(req.path),
        action: `${req.method} ${req.path}`,
        details: summarizeBody(req.body),
        related_ref: req.params?.id || undefined,
        ip_address: req.ip,
      }).catch(() => {});
    } catch { /* logging must never affect the real request */ }
  });
  next();
});

// ----------------------------------------------------
// Authentication & JWT Security Support
// ----------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET || "crm-system-super-secret-key-2026";

const authenticateJWT = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(" ")[1];
    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) {
        return res.status(403).json({ error: "Work session is expired or invalid. Please log in again." });
      }
      req.user = decoded;
      next();
    });
  } else {
    res.status(401).json({ error: "Valid access credentials are required to view this page." });
  }
};

// Role Access Control Middlewares
const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ error: "Sorry, this action requires System Administrator (Admin) privileges." });
  }
};

const requireLeaderOrAdmin = (req: any, res: any, next: any) => {
  if (req.user && (req.user.role === "admin" || req.user.role === "leader")) {
    next();
  } else {
    res.status(403).json({ error: "Sorry, this action is restricted to Team Leaders or Admins." });
  }
};

const requireManagerOrAdmin = (req: any, res: any, next: any) => {
  if (req.user && (req.user.role === "admin" || req.user.role === "manager")) {
    next();
  } else {
    res.status(403).json({ error: "This action requires Manager or Admin privileges." });
  }
};

// GET /api/users: leaders, supervisors, managers, admins (agents and marketing excluded)
const requireLeaderManagerOrAdmin = (req: any, res: any, next: any) => {
  const r = req.user?.role;
  if (r && r !== "agent" && r !== "marketing") {
    next();
  } else {
    res.status(403).json({ error: "Access denied." });
  }
};

// Any manager (Team Leader, Supervisor, or Admin) — i.e. not an agent or marketing (view-only)
const requireManager = (req: any, res: any, next: any) => {
  if (req.user && req.user.role !== "agent" && req.user.role !== "marketing") {
    next();
  } else {
    res.status(403).json({ error: "Sorry, this action is restricted to Team Leaders, Supervisors, or Admins." });
  }
};

// Wrap async route handlers so rejected promises become 500s instead of
// crashing the process with an unhandled rejection.
const asyncHandler = (fn: (req: any, res: any) => Promise<any>) => (req: any, res: any) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error("[CRM Server] Unhandled route error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error. Please try again." });
    }
  });
};

// ----------------------------------------------------
// Authentication API
// ----------------------------------------------------
app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body; // Represents either email or username input
  if (!email || !password) {
    return res.status(400).json({ error: "Please enter your email/username and password." });
  }

  const user = await DB.getUserByUsernameOrEmail(email);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials. Please try again." });
  }

  if (user.status === "Inactive") {
    return res.status(403).json({ error: "This account has been deactivated by the system administrator. Please contact management." });
  }

  const isPasswordMatch = bcrypt.compareSync(password, user.password_hash);
  if (!isPasswordMatch) {
    return res.status(401).json({ error: "Invalid credentials. Please try again." });
  }

  // Generate JWT token containing key user properties
  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      level: user.level ?? roleDefaultLevel(user.role),
      job_title: user.job_title,
      team: user.team,
      department: user.department,
      full_name: user.full_name
    },
    JWT_SECRET,
    { expiresIn: "24h" }
  );

  // Success login log
  await DB.addAuditLog({
    operator_id: user.id,
    operator_name: user.full_name,
    operator_role: user.role,
    category: user.team || "Call Center",
    action: "User Login",
    details: `User ${user.username} successfully logged in`
  });

  const userData = {
    id: user.id,
    full_name: user.full_name,
    name: user.full_name, // fallback helper
    username: user.username,
    email: user.email,
    role: user.role,
    level: user.level ?? roleDefaultLevel(user.role),
    job_title: user.job_title,
    team: user.team,
    department: user.department,
    status: user.status,
    token
  };

  res.json(userData);
}));

// ----------------------------------------------------
// Users Management API (Requires Admin)
// ----------------------------------------------------
app.get("/api/users", authenticateJWT, requireLeaderManagerOrAdmin, asyncHandler(async (req, res) => {
  const users = (await DB.getUsers()).map(({ password_hash, ...u }) => u);
  res.json(users);
}));

app.post("/api/users", authenticateJWT, requireManagerOrAdmin, asyncHandler(async (req, res) => {
  const { full_name, username, password, role, status, team, department } = req.body;

  if (!full_name || !username || !password || !role || !status) {
    return res.status(400).json({ error: "Please fill in all required fields to create the account." });
  }

  // Non-admin managers can only create users at a lower level than themselves
  if (req.user.role !== "admin") {
    const ut2 = USER_TYPES.find((t) => t.label === req.body.job_title);
    const targetLevel = req.body.level != null ? Number(req.body.level) : (ut2 ? ut2.level : roleDefaultLevel(role));
    if (targetLevel >= userLevel(req.user)) {
      return res.status(403).json({ error: "You can only create users at a lower level than your own." });
    }
  }

  // Email is optional now — derive a stable internal address from the username
  const email = (req.body.email && String(req.body.email).trim()) ? String(req.body.email).trim() : `${username}@local`;

  // Conflict validation
  const existingEmail = await DB.getUserByEmail(email);
  const existingUsername = (await DB.getUsers()).find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );

  if (existingEmail) {
    return res.status(400).json({ error: "The entered email is already in use by another account." });
  }
  if (existingUsername) {
    return res.status(400).json({ error: "This username is already taken by another account." });
  }

  const saltRounds = 10;
  const password_hash = bcrypt.hashSync(password, saltRounds);
  const nowString = new Date().toISOString();

  // Resolve hierarchy level + job title (from the account type, with fallbacks)
  const ut = USER_TYPES.find((t) => t.label === req.body.job_title);
  const level = req.body.level != null ? Number(req.body.level) : (ut ? ut.level : roleDefaultLevel(role));
  const job_title = req.body.job_title || (ut ? ut.label : null);

  const newUser = await DB.addUser({
    id: "user-" + Date.now(),
    full_name,
    name: full_name,
    username,
    email,
    password_hash,
    role,
    level,
    job_title,
    team,
    // Management roles (Assistant Manager and up) are org-wide → no department
    department: (level >= EXECUTIVE_LEVEL) ? null : (department || (ut ? ut.department : null) || "Call Center"),
    status,
    created_at: nowString,
    updated_at: nowString,
    created_by: req.user.id
  });

  // Safe logging
  await DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    operator_role: req.user.role,
    category: "Team Leader",
    action: "Create User",
    details: `A new user account was created: ${username} (${role})`
  });

  const { password_hash: _, ...safeUser } = newUser;
  res.status(201).json(safeUser);
}));

app.put("/api/users/:id", authenticateJWT, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { full_name, username, email, role, status, password, team, department, level, job_title } = req.body;

  const targetUser = await DB.getUserById(id);
  if (!targetUser) {
    return res.status(404).json({ error: "The user requested for update does not exist in the system." });
  }

  // Match conflicts
  if (email && email !== targetUser.email) {
    if (await DB.getUserByEmail(email)) {
      return res.status(400).json({ error: "The new email is already in use by another account." });
    }
  }
  if (username && username !== targetUser.username) {
    const conflicts = (await DB.getUsers()).find(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );
    if (conflicts) {
      return res.status(400).json({ error: "The new username is already taken by another account." });
    }
  }

  const updates: any = {
    full_name: full_name || targetUser.full_name,
    name: full_name || targetUser.full_name,
    username: username || targetUser.username,
    email: email || targetUser.email,
    role: role || targetUser.role,
    team: team || targetUser.team,
    department: department !== undefined ? department : targetUser.department,
    status: status || targetUser.status,
    level: level !== undefined ? level : (targetUser as any).level,
    job_title: job_title !== undefined ? job_title : (targetUser as any).job_title,
  };

  if (password && password.trim() !== "") {
    updates.password_hash = bcrypt.hashSync(password, 10);
  }

  const updatedUser = await DB.updateUser(id, updates);

  // Safe logging
  await DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    operator_role: req.user.role,
    category: "Team Leader",
    action: "Edit User",
    details: `User data updated: ${updates.username} (status: ${updates.status})`
  });

  const { password_hash: _, ...safeUser } = updatedUser!;
  res.json(safeUser);
}));

app.delete("/api/users/:id", authenticateJWT, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ error: "You cannot delete your own logged-in account." });
  }

  const targetUser = await DB.getUserById(id);
  if (!targetUser) {
    return res.status(404).json({ error: "User not found for deletion." });
  }

  await DB.deleteUser(id);

  // Safe logging
  await DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    operator_role: req.user.role,
    category: "Team Leader",
    action: "Delete User",
    details: `User account permanently deleted: ${targetUser.username}`
  });

  res.json({ message: "User account deleted successfully." });
}));

app.put("/api/users/:id/reset-password", authenticateJWT, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.trim() === "") {
    return res.status(400).json({ error: "New password is required." });
  }

  const targetUser = await DB.getUserById(id);
  if (!targetUser) {
    return res.status(404).json({ error: "User not found for password reset." });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  await DB.updateUser(id, { password_hash });

  // Safe logging
  await DB.addAuditLog({
    operator_id: req.user.id,
    operator_name: req.user.full_name,
    operator_role: req.user.role,
    category: "Team Leader",
    action: "Password Reset",
    details: `A new password was successfully reset for user: ${targetUser.username}`
  });

  res.json({ message: "Password reset successfully." });
}));

/**
 * Self-service password change — any signed-in user, for their own account only.
 *
 * The current password is required and verified server-side: the JWT alone is
 * not sufficient proof, since a token left behind on an unattended machine
 * would otherwise be enough to lock the real owner out of their account.
 */
app.post("/api/me/change-password", authenticateJWT, asyncHandler(async (req: any, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: "Current and new password are both required." });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters." });
  }
  if (current_password === new_password) {
    return res.status(400).json({ error: "The new password must be different from the current one." });
  }

  // Always read the stored hash fresh — never trust a password state carried in the token.
  const user = await DB.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found." });

  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).json({ error: "Your current password is incorrect." });
  }

  await DB.updateUser(req.user.id, { password_hash: bcrypt.hashSync(new_password, 10) });

  // Record that it happened, but never the password itself.
  await DB.addAuditLog({
    operator_id: user.id,
    operator_name: user.full_name,
    operator_role: user.role,
    category: "Account",
    action: "Password Changed",
    details: `${user.username} changed their own password.`,
  });

  res.json({ message: "Password changed successfully." });
}));

// Audit Logs list API
app.get("/api/audit-logs", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  res.json(await DB.getAuditLogs());
}));

// ----------------------------------------------------
// Brands API (Protected)
// ----------------------------------------------------
app.get("/api/brands", authenticateJWT, asyncHandler(async (req, res) => {
  res.json(await DB.getBrands());
}));

app.post("/api/brands", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Brand name is required" });
  }
  const brand = await DB.addBrand(name.trim());
  res.status(201).json(brand);
}));

app.delete("/api/brands/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const success = await DB.deleteBrand(req.params.id);
  if (success) {
    res.json({ message: "Brand deleted successfully" });
  } else {
    res.status(404).json({ error: "Brand not found" });
  }
}));

// ----------------------------------------------------
// Categories API (Protected)
// ----------------------------------------------------
app.get("/api/categories", authenticateJWT, asyncHandler(async (req, res) => {
  res.json(await DB.getCategories());
}));

app.post("/api/categories", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Category name is required" });
  }
  const category = await DB.addCategory(name.trim());
  res.status(201).json(category);
}));

app.delete("/api/categories/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const success = await DB.deleteCategory(req.params.id);
  if (success) {
    res.json({ message: "Category deleted successfully" });
  } else {
    res.status(404).json({ error: "Category not found" });
  }
}));

// ----------------------------------------------------
// Branches API (stores shown for Complaint call reasons)
// ----------------------------------------------------
app.get("/api/branches", authenticateJWT, asyncHandler(async (req, res) => {
  res.json(await DB.getBranches());
}));

app.post("/api/branches", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Branch name is required" });
  }
  const branch = await DB.addBranch(name.trim());
  res.status(201).json(branch);
}));

app.delete("/api/branches/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const success = await DB.deleteBranch(req.params.id);
  if (success) {
    res.json({ message: "Branch deleted successfully" });
  } else {
    res.status(404).json({ error: "Branch not found" });
  }
}));

// ----------------------------------------------------
// Dropdown Options API (Configuration page)
// ----------------------------------------------------
// Full list (incl. inactive) for the Configuration screen
app.get("/api/options", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  res.json(await DB.getAllOptions());
}));

// Reorder a list — defined before "/:id" routes (POST, distinct path)
app.post("/api/options/reorder", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { list_key, ids } = req.body;
  if (!list_key || !Array.isArray(ids)) {
    return res.status(400).json({ error: "list_key and ids[] are required." });
  }
  await DB.reorderOptions(list_key, ids);
  res.json({ message: "Reordered successfully" });
}));

// Active options for one list — used by the forms (any authenticated user)
app.get("/api/options/:key", authenticateJWT, asyncHandler(async (req, res) => {
  res.json(await DB.getOptionsByKey(req.params.key, true));
}));

app.post("/api/options", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { list_key, label } = req.body;
  if (!list_key || !label || !label.trim()) {
    return res.status(400).json({ error: "list_key and a non-empty label are required." });
  }
  const option = await DB.addOption(list_key, label.trim());
  res.status(201).json(option);
}));

app.put("/api/options/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const { label, active, sort_order } = req.body;
  const updated = await DB.updateOption(req.params.id, {
    ...(label !== undefined ? { label: String(label).trim() } : {}),
    ...(active !== undefined ? { active: !!active } : {}),
    ...(sort_order !== undefined ? { sort_order } : {}),
  });
  if (!updated) return res.status(404).json({ error: "Option not found or no changes provided." });
  res.json(updated);
}));

app.delete("/api/options/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const success = await DB.deleteOption(req.params.id);
  if (success) {
    res.json({ message: "Option deleted successfully" });
  } else {
    res.status(404).json({ error: "Option not found" });
  }
}));

// ----------------------------------------------------
// Operations & Logs API (Agent / Team Leader, department-scoped)
// ----------------------------------------------------
const DEPT_TO_LOGTYPE: Record<string, string> = {
  "Call Center": "call_center",
  "Technical": "technical",
  "Complaints": "complaint",
  "Quality": "quality",
};
const LOG_FIELDS = ["department", "activity_type", "status", "branch", "brand", "order_number", "aggregator", "customer_name", "complaint_id", "target_agent_name", "notes", "action_taken", "resolution_notes", "action_plan", "follow_up_date"];

// ----------------------------------------------------
// Recurring tasks — date helpers & lazy daily generation (Kuwait time, UTC+3)
// ----------------------------------------------------
const KW_OFFSET_MS = 3 * 3600 * 1000;
function kuwaitToday(): { date: string; weekday: number } {
  const kw = new Date(Date.now() + KW_OFFSET_MS);
  const date = kw.toISOString().slice(0, 10); // YYYY-MM-DD in Kuwait local
  const weekday = new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
  return { date, weekday };
}
function templateFiresOn(tpl: any, weekday: number): boolean {
  if (!tpl.active) return false;
  if (tpl.recurrence_type === "daily") return true;
  const days = String(tpl.days_of_week || "").split(",").map((d: string) => Number(d.trim())).filter((n: number) => !isNaN(n));
  return days.includes(weekday); // covers "weekly" (single day) & "weekdays" (multiple)
}

// Ensure today's instances exist for active templates (optionally a single department).
// Idempotent via the unique (template_id, task_date) index.
async function ensureTodayInstances(department?: string): Promise<void> {
  const { date, weekday } = kuwaitToday();
  const templates = await DB.getRecurringTemplates(department ? { department } : {});
  for (const tpl of templates) {
    if (!templateFiresOn(tpl, weekday)) continue;
    if (await DB.recurringInstanceExists(tpl.id, date)) continue;
    const due_date = tpl.due_time ? `${date}T${tpl.due_time}` : `${date}T23:59`;
    let assigned_to: string | null = null;
    let assigned_to_name: string | null = null;
    let status = "Available";
    if (tpl.assign_mode === "auto") {
      const onShift = await DB.getOnShiftAgents(tpl.department);
      if (onShift.length) {
        const counts = await DB.getOpenTaskCounts(tpl.department);
        onShift.sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0));
        assigned_to = onShift[0].id; assigned_to_name = onShift[0].full_name; status = "New";
      } // else: no one on shift → falls back to the pool
    }
    await DB.addRecurringInstance({
      id: "rtask-" + tpl.id.slice(-6) + "-" + date,
      title: tpl.title, description: tpl.description || undefined,
      assigned_by: tpl.created_by || "system", assigned_by_name: tpl.created_by_name || "Recurring",
      assigned_to, assigned_to_name, department: tpl.department,
      priority: tpl.priority || "Medium", due_date, status,
      template_id: tpl.id, task_date: date, created_at: new Date().toISOString(),
    } as any);
  }
}

// List logs (scoped by role/department)
// Agent ids of everyone currently assigned to a department (member-based scope)
const departmentMemberIds = async (department: string): Promise<string[]> =>
  (await DB.getUsers())
    .filter((u: any) => u.department === department)
    .map((u: any) => u.id);

app.get("/api/logs", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const { role, id, department } = req.user;
  const typeFilter = (req.query.type as string) || undefined;
  let logs;
  if (isExecutive(req.user)) {
    logs = await DB.getLogs({ log_type: typeFilter, department: (req.query.department as string) || undefined });
  } else if (role === "supervisor") {
    // Supervisors see ALL logs of their department MEMBERS (agents + team leaders),
    // even when a member's logs are stamped under another dept (e.g. FM → Call Center).
    logs = await DB.getLogs({ agent_ids: await departmentMemberIds(department) });
  } else if (role === "leader") {
    const deptLogType = DEPT_TO_LOGTYPE[department];
    logs = await DB.getLogs({ department, log_type: deptLogType || typeFilter });
  } else {
    logs = await DB.getLogs({ agent_id: id, log_type: typeFilter });
  }
  res.json(logs);
}));

// Performance stats per agent (scoped by role/department)
app.get("/api/performance", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const { role, id, department } = req.user;
  const period = (req.query.period as string) || "month";
  const deptFilter = (req.query.department as string) || undefined;

  let logs;
  if (isExecutive(req.user)) {
    logs = await DB.getLogs({ department: deptFilter });
  } else if (role === "supervisor" || role === "leader") {
    // Scope by department MEMBERS (not the log's department/type stamp) so staff
    // whose logs carry another type — e.g. FM in Quality logging call_center —
    // still appear with their real numbers.
    logs = await DB.getLogs({ agent_ids: await departmentMemberIds(department) });
  } else {
    logs = await DB.getLogs({ agent_id: id });
  }

  // Team Performance covers AGENTS only — drop logs written by leaders /
  // supervisors / managers / admins so they don't appear as team members.
  const perfUsers = await DB.getUsers();
  const agentIdSet = new Set(perfUsers.filter((u: any) => u.role === "agent").map((u: any) => u.id));
  logs = logs.filter((l: any) => agentIdSet.has(l.agent_id));

  // Date range filter
  const now = new Date();
  let fromDate: Date | null = null;
  if (period === "today") fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (period === "week") fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  else if (period === "month") fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
  if (fromDate) logs = logs.filter((l: any) => l.created_at && new Date(l.created_at) >= fromDate!);

  // Aggregate by agent
  const agentMap = new Map<string, any>();
  for (const log of logs) {
    const key = (log as any).agent_id || (log as any).agent_name || "unknown";
    if (!agentMap.has(key)) {
      agentMap.set(key, {
        agent_id: (log as any).agent_id,
        agent_name: (log as any).agent_name || "Unknown",
        department: (log as any).department,
        total_logs: 0,
        completed_logs: 0,
        total_duration: 0,
        counted_durations: 0,
      });
    }
    const e = agentMap.get(key)!;
    e.total_logs++;
    if (["Completed", "Solved"].includes((log as any).status || "")) e.completed_logs++;
    const dur = Number((log as any).duration_seconds || 0);
    if (dur > 0) { e.total_duration += dur; e.counted_durations++; }
  }

  const stats = Array.from(agentMap.values()).map((e) => ({
    agent_id: e.agent_id,
    agent_name: e.agent_name,
    department: e.department,
    total_logs: e.total_logs,
    completed_logs: e.completed_logs,
    completion_rate: e.total_logs > 0 ? Math.round((e.completed_logs / e.total_logs) * 100) : 0,
    total_duration: e.total_duration,
    avg_duration: e.counted_durations > 0 ? Math.round(e.total_duration / e.counted_durations) : 0,
  })).sort((a, b) => b.total_logs - a.total_logs);

  res.json(stats);
}));

// Role-aware dashboard metrics (computed from the scoped logs)
app.get("/api/logs/dashboard", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const { role, id, department } = req.user;
  let logs;
  if (isExecutive(req.user)) logs = await DB.getLogs({});
  else if (role === "supervisor") {
    // Scope by department MEMBERS (not the log's department stamp) so staff whose
    // logs are stamped under another dept — e.g. FM working call-center — still show.
    logs = await DB.getLogs({ agent_ids: await departmentMemberIds(department) });
  } else if (role === "leader") {
    const deptLogType = DEPT_TO_LOGTYPE[department];
    logs = await DB.getLogs({ department, log_type: deptLogType || undefined });
  } else logs = await DB.getLogs({ agent_id: id });

  // Keep the full scoped set for the Shift Hours table so its own week
  // navigation is independent of the KPI date filter below.
  const shiftLogs = logs;

  // Optional date + time range filter (dates: YYYY-MM-DD, times: HH:MM in Kuwait UTC+3)
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const fromTime = typeof req.query.from_time === "string" ? req.query.from_time : "";
  const toTime = typeof req.query.to_time === "string" ? req.query.to_time : "";
  // Convert Kuwait HH:MM on a given YYYY-MM-DD to a UTC ISO string
  const kwToUtcISO = (dateStr: string, timeStr: string, endOfMinute = false) => {
    const [y, mo, d] = dateStr.split("-").map(Number);
    const [h, m] = timeStr.split(":").map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h, m, endOfMinute ? 59 : 0) - KW_OFFSET_MS).toISOString();
  };
  // Date-only filters are interpreted as full Kuwait calendar days
  // (00:00 → 23:59 Kuwait), so "Today" means Kuwait midnight-to-midnight.
  if (from) {
    const fromISO = kwToUtcISO(from, fromTime || "00:00");
    logs = logs.filter((l) => (l.created_at || "") >= fromISO);
  }
  if (to) {
    const toISO = kwToUtcISO(to, toTime || "23:59", true);
    logs = logs.filter((l) => (l.created_at || "") <= toISO);
  }

  const OPEN = ["Open"];
  const PENDING = ["In Progress", "Waiting Feedback", "Not Solved"];
  const DONE = ["Completed", "Solved"];
  const inSet = (s: string | undefined, set: string[]) => !!s && set.includes(s);

  const now = Date.now();
  const since = (days: number) => now - days * 24 * 60 * 60 * 1000;
  const ts = (l: any) => new Date(l.created_at).getTime();

  const group = (keyFn: (l: any) => string | undefined) => {
    const m: Record<string, number> = {};
    logs.forEach((l) => { const k = keyFn(l); if (k) m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map((name) => ({ name, count: m[name] })).sort((a, b) => b.count - a.count);
  };

  // 7-day trend
  const trendMap: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) trendMap[new Date(now - i * 864e5).toISOString().split("T")[0]] = 0;
  logs.forEach((l) => { const d = (l.created_at || "").split("T")[0]; if (trendMap[d] !== undefined) trendMap[d]++; });
  const trend = Object.keys(trendMap).map((d) => ({ date: d, count: trendMap[d] }));

  const complaintLogs = logs.filter((l) => l.log_type === "complaint");
  const solved = complaintLogs.filter((l) => l.status === "Solved").length;
  const notSolved = complaintLogs.filter((l) => l.status === "Not Solved").length;
  const complaintResolutionRate = solved + notSolved ? Math.round((solved / (solved + notSolved)) * 100) : 0;

  const technicalLogs = logs.filter((l) => l.log_type === "technical");
  const technicalStatus = (() => {
    const m: Record<string, number> = {};
    technicalLogs.forEach((l) => { const k = l.status || "—"; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map((name) => ({ name, count: m[name] }));
  })();

  // Handling time metrics (from the logged time spent)
  const dur = (l: any) => Number(l.duration_seconds || 0);
  const timed = logs.filter((l) => dur(l) > 0);
  const totalHandlingSeconds = timed.reduce((a, l) => a + dur(l), 0);
  const avgHandlingSeconds = timed.length ? Math.round(totalHandlingSeconds / timed.length) : 0;

  // Productivity windows — COMPLETED tasks only (open / in-progress don't count
  // toward performance until the agent completes them)
  const todayStr = new Date(now).toISOString().split("T")[0];
  const todayLogs = logs.filter((l) => (l.created_at || "").split("T")[0] === todayStr && inSet(l.status, DONE));
  const weekLogs = logs.filter((l) => ts(l) >= since(7) && inSet(l.status, DONE));
  const todayTasks = todayLogs.length;
  const weekTasks = weekLogs.length;
  const todaySeconds = todayLogs.reduce((a, l) => a + dur(l), 0);
  const weekSeconds = weekLogs.reduce((a, l) => a + dur(l), 0);

  // Per-agent logged time — dynamic business day grouping.
  // Consecutive logs with gap < GAP_THRESHOLD belong to the same business day
  // (the date of the FIRST log in that streak). Handles agents who work past midnight.
  let shiftByAgent: { name: string; today: number; week: number; days: { date: string; seconds: number; count: number }[] }[] = [];
  if (role !== "agent") {
    const GAP_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4-hour gap = new business day
    const kwDate = (iso: string) => new Date(new Date(iso).getTime() + KW_OFFSET_MS).toISOString().slice(0, 10);
    const kwTodayStr = kuwaitToday().date;
    // Shift the 7-day window back by whole weeks (0 = current week)
    const weeksAgo = Math.max(0, Math.floor(Number(req.query.shift_weeks_ago) || 0));
    // Calendar week starting on SUNDAY (Kuwait), shifted back by whole weeks.
    const wkStart = new Date(now + KW_OFFSET_MS);
    wkStart.setUTCHours(0, 0, 0, 0);
    wkStart.setUTCDate(wkStart.getUTCDate() - wkStart.getUTCDay() - weeksAgo * 7); // back to Sunday
    const last7: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dd = new Date(wkStart);
      dd.setUTCDate(wkStart.getUTCDate() + i);
      last7.push(dd.toISOString().slice(0, 10));
    }
    const last7Set = new Set(last7);

    // Group logs by agent, keeping all (even zero-duration) for gap detection.
    // Uses the unfiltered scoped logs so week navigation works regardless of filter.
    const byAgent: Record<string, any[]> = {};
    shiftLogs.forEach((l: any) => {
      if (!l.created_at) return;
      const name = l.agent_name || "—";
      if (!byAgent[name]) byAgent[name] = [];
      byAgent[name].push(l);
    });

    // Seed the table with every active agent in scope so that agents who have
    // not logged anything still appear (as a full row of zeros).
    const allUsers = await DB.getUsers();
    const scopedAgents = allUsers.filter((u: any) =>
      (u.role === "agent" || u.role === "leader") && u.status === "Active" &&
      (isExecutive(req.user) || !department || u.department === department)
    );
    const agentNames = new Set(scopedAgents.map((u: any) => u.full_name));

    const map: Record<string, { name: string; today: number; week: number; dayMap: Record<string, number>; dayCount: Record<string, number> }> = {};
    for (const u of scopedAgents) map[u.full_name] = { name: u.full_name, today: 0, week: 0, dayMap: {}, dayCount: {} };

    for (const [name, agLogs] of Object.entries(byAgent)) {
      agLogs.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      if (!map[name]) map[name] = { name, today: 0, week: 0, dayMap: {}, dayCount: {} };
      let prevTime: number | null = null;
      let sessionDate: string = "";
      for (const l of agLogs) {
        const logTime = new Date(l.created_at).getTime();
        // New session if first log or gap exceeds threshold
        if (prevTime === null || logTime - prevTime > GAP_THRESHOLD_MS) {
          sessionDate = kwDate(l.created_at);
        }
        prevTime = logTime;
        const secs = Number(l.duration_seconds || 0);
        if (!secs) continue;
        if (sessionDate === kwTodayStr) map[name].today += secs;
        if (last7Set.has(sessionDate)) {
          map[name].week += secs;
          map[name].dayMap[sessionDate] = (map[name].dayMap[sessionDate] || 0) + secs;
          map[name].dayCount[sessionDate] = (map[name].dayCount[sessionDate] || 0) + 1;
        }
      }
    }

    shiftByAgent = Object.values(map)
      // Keep every in-scope agent (even with zero hours); drop incidental
      // non-agent names only when they have no hours in the window.
      .filter((e) => agentNames.has(e.name) || e.week > 0 || e.today > 0)
      .map((e) => ({
        name: e.name,
        today: e.today,
        week: e.week,
        days: last7.map((date) => ({ date, seconds: e.dayMap[date] || 0, count: e.dayCount[date] || 0 })),
      })).sort((a, b) => b.week - a.week || a.name.localeCompare(b.name));
  }

  // Department performance — count + avg worked hours (to-date and last week) per group.
  // FM is split out from Quality via job_title; uses unfiltered scoped logs.
  const deptUsers = await DB.getUsers();
  const groupOf = (u: any): string | null => {
    if (u.job_title === "FM" || u.job_title === "FM Team Leader") return "FM";
    if (u.department === "Quality") return "QA";
    if (u.department === "Call Center" || u.department === "Technical" || u.department === "Complaints") return u.department;
    return null;
  };
  const scopedDeptUsers = isExecutive(req.user)
    ? deptUsers
    : (role === "supervisor" || role === "leader")
      ? deptUsers.filter((u: any) => u.department === department)
      : deptUsers.filter((u: any) => u.id === id);
  const GKEYS = ["Technical", "Complaints", "Call Center", "QA", "FM"] as const;
  const userGroup = new Map<string, string>();
  const deptCount: Record<string, number> = { Technical: 0, Complaints: 0, "Call Center": 0, QA: 0, FM: 0 };
  for (const u of scopedDeptUsers) {
    const g = groupOf(u);
    if (!g) continue;
    userGroup.set(u.id, g);
    if ((u.role === "agent" || u.role === "leader") && u.status === "Active") deptCount[g]++;
  }
  const totalSec: Record<string, number> = { Technical: 0, Complaints: 0, "Call Center": 0, QA: 0, FM: 0 };
  const weekSec: Record<string, number> = { Technical: 0, Complaints: 0, "Call Center": 0, QA: 0, FM: 0 };
  const weekCutoff = now - 7 * 86400000;
  shiftLogs.forEach((l: any) => {
    const g = userGroup.get(l.agent_id);
    if (!g) return;
    const secs = Number(l.duration_seconds || 0);
    if (!secs) return;
    totalSec[g] += secs;
    if (new Date(l.created_at).getTime() >= weekCutoff) weekSec[g] += secs;
  });
  const deptPerformance = GKEYS.map((name) => ({
    name,
    count: deptCount[name],
    avgToDateSeconds: deptCount[name] ? Math.round(totalSec[name] / deptCount[name]) : 0,
    avgWeekSeconds: deptCount[name] ? Math.round(weekSec[name] / deptCount[name]) : 0,
    totalSeconds: totalSec[name],
  }));

  res.json({
    shiftByAgent,
    role,
    department: department || null,
    totalLogs: logs.length,
    totalHandlingSeconds,
    avgHandlingSeconds,
    todayTasks,
    weekTasks,
    todaySeconds,
    weekSeconds,
    open: logs.filter((l) => inSet(l.status, OPEN)).length,
    pending: logs.filter((l) => inSet(l.status, PENDING)).length,
    completed: logs.filter((l) => inSet(l.status, DONE)).length,
    daily: logs.filter((l) => ts(l) >= since(1)).length,
    weekly: logs.filter((l) => ts(l) >= since(7)).length,
    monthly: logs.filter((l) => ts(l) >= since(30)).length,
    byActivity: group((l) => l.activity_type).slice(0, 12),
    byDepartment: group((l) => l.department),
    deptPerformance,
    agentProductivity: group((l) => l.agent_name).slice(0, 15),
    complaintResolutionRate,
    technicalStatus,
    coachingSessions: logs.filter((l) => l.log_type === "team_leader").length,
    trend,
  });
}));

// History / audit trail (Team Leaders + Admin)
app.get("/api/logs/history", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req: any, res: any) => {
  let logs = await DB.getAuditLogs();
  if (req.user.role === "leader") {
    logs = logs.filter((l) => !l.department || l.department === req.user.department);
  }
  res.json(logs);
}));

app.post("/api/logs", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role === "marketing") return res.status(403).json({ error: "Access denied." });
  const { role, id, full_name, department } = req.user;
  const body = req.body;
  if (!body.activity_type) return res.status(400).json({ error: "Activity type is required." });
  if (["Completed", "Solved"].includes(body.status) && Number(body.duration_seconds) <= 0) {
    return res.status(400).json({ error: "Time spent is required to complete a task." });
  }

  // Log routing by role:
  //  - Agent / Supervisor: a log in their own department
  //  - Team Leader: a coaching (team_leader) log
  //  - Management (manager / owner / admin): choose log type + department
  // FM staff sit in the Quality department for supervision but do call-center work,
  // so their operational log type is call_center (not quality).
  const isFM = req.user.job_title === "FM" || req.user.job_title === "FM Team Leader";
  const myDeptType = isFM ? "call_center" : DEPT_TO_LOGTYPE[department];
  let log_type: string, dept: string, agent_id: string, agent_name: string;
  if (role === "agent" || role === "supervisor") {
    log_type = myDeptType;
    if (!log_type) return res.status(400).json({ error: "Your account is not assigned to a valid department." });
    dept = department; agent_id = id; agent_name = full_name;
  } else if (role === "leader") {
    // Leaders may log their department type OR a Team Leader (coaching) log.
    const allowed = ["team_leader", ...(myDeptType ? [myDeptType] : [])];
    const requested = body.log_type;
    log_type = (requested && allowed.includes(requested))
      ? requested
      : (department === "Call Center" || isFM ? "team_leader" : (myDeptType || "team_leader"));
    dept = department || "Call Center"; agent_id = id; agent_name = full_name;
  } else {
    log_type = body.log_type || "call_center";
    dept = body.department || department || "Call Center";
    agent_id = body.agent_id || id; agent_name = body.agent_name || full_name;
  }

  const now = new Date().toISOString();
  const newLog = await DB.addLog({
    log_type: log_type as any, department: dept, activity_type: body.activity_type, status: body.status,
    agent_id, agent_name,
    branch: body.branch, brand: body.brand, order_number: body.order_number, aggregator: body.aggregator,
    customer_name: body.customer_name, complaint_id: body.complaint_id, target_agent_name: body.target_agent_name,
    notes: body.notes, action_taken: body.action_taken, resolution_notes: body.resolution_notes,
    action_plan: body.action_plan, follow_up_date: body.follow_up_date,
    duration_seconds: Number(body.duration_seconds) > 0 ? Math.round(Number(body.duration_seconds)) : 0,
    calls_reviewed: Number(body.calls_reviewed) > 0 ? Math.round(Number(body.calls_reviewed)) : null,
    created_at: now, updated_at: now, created_by: id,
  });

  await DB.addAuditLog({
    operator_id: id, operator_name: full_name, operator_role: role, category: dept, department: dept,
    action: "Create Log", related_ref: newLog.id,
    details: `${log_type} · ${body.activity_type}${body.branch ? " · " + body.branch : ""}`,
    new_value: JSON.stringify({ activity_type: body.activity_type, status: body.status ?? null }),
  });
  res.status(201).json(newLog);
}));

app.put("/api/logs/:id", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const log = await DB.getLogById(req.params.id);
  if (!log) return res.status(404).json({ error: "Log not found." });
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only an administrator can edit logs." });
  }

  // Diff changed fields for the audit trail
  const prev: any = {}, next: any = {};
  for (const f of LOG_FIELDS) {
    if (f in req.body && req.body[f] !== (log as any)[f]) { prev[f] = (log as any)[f] ?? null; next[f] = req.body[f]; }
  }
  const updated = await DB.updateLog(req.params.id, req.body);

  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: log.department, department: log.department, action: "Edit Log", related_ref: log.id,
    details: `${log.log_type} · ${log.activity_type}`,
    previous_value: JSON.stringify(prev), new_value: JSON.stringify(next),
  });
  res.json(updated);
}));

app.delete("/api/logs/:id", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const log = await DB.getLogById(req.params.id);
  if (!log) return res.status(404).json({ error: "Log not found." });
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only an administrator can delete logs." });
  }
  await DB.deleteLog(req.params.id);
  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: log.department, department: log.department, action: "Delete Log", related_ref: log.id,
    details: `${log.log_type} · ${log.activity_type}`, previous_value: JSON.stringify({ activity_type: log.activity_type, status: log.status }),
  });
  res.json({ message: "Log deleted successfully" });
}));

// Owner progress update — change status + time spent on an Open/In Progress task
app.put("/api/logs/:id/progress", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const log = await DB.getLogById(req.params.id);
  if (!log) return res.status(404).json({ error: "Log not found." });
  const isOwner = log.agent_id === req.user.id;
  if (req.user.role !== "admin" && !isOwner) {
    return res.status(403).json({ error: "You can only update your own tasks." });
  }
  // Editable while not in a final state. Final = Completed / Solved.
  // Complaint logs use Not Solved / Waiting Feedback as in-progress states.
  if (req.user.role !== "admin" && !["Open", "In Progress", "Not Solved", "Waiting Feedback"].includes(log.status || "")) {
    return res.status(403).json({ error: "This task is already closed and can no longer be updated." });
  }
  const fields: any = {};
  if (req.body.status !== undefined) fields.status = req.body.status;
  if (req.body.duration_seconds !== undefined) fields.duration_seconds = Math.max(0, Math.round(Number(req.body.duration_seconds) || 0));
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: "Nothing to update." });

  const finalStatus = fields.status ?? log.status;
  const finalDuration = fields.duration_seconds ?? log.duration_seconds ?? 0;
  if (["Completed", "Solved"].includes(finalStatus || "") && Number(finalDuration) <= 0) {
    return res.status(400).json({ error: "Time spent is required to complete a task." });
  }

  const updated = await DB.updateLog(req.params.id, fields);
  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: log.department, department: log.department, action: "Update Task Progress", related_ref: log.id,
    details: `${log.log_type} · ${log.activity_type}`,
    previous_value: JSON.stringify({ status: log.status, duration_seconds: log.duration_seconds ?? 0 }),
    new_value: JSON.stringify(fields),
  });
  res.json(updated);
}));

// Task timer — start / pause / complete (accumulates active handling time)
app.post("/api/logs/:id/timer", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const log = await DB.getLogById(req.params.id);
  if (!log) return res.status(404).json({ error: "Log not found." });
  if (req.user.role !== "admin" && log.agent_id !== req.user.id) {
    return res.status(403).json({ error: "You can only time your own tasks." });
  }
  const action = req.body.action;
  if (!["start", "pause", "complete"].includes(action)) {
    return res.status(400).json({ error: "action must be start, pause or complete." });
  }
  const completeStatus = log.log_type === "complaint" ? "Solved" : "Completed";
  const updated = await DB.controlTimer(req.params.id, action, completeStatus);
  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: log.department, department: log.department, action: `Timer ${action}`, related_ref: log.id,
    details: `${log.log_type} · ${log.activity_type}`,
    new_value: JSON.stringify({ duration_seconds: (updated as any)?.duration_seconds ?? 0 }),
  });
  res.json(updated);
}));

// ----------------------------------------------------
// Assigned Tasks API (manager assigns to agent)
// ----------------------------------------------------
// Create & assign — any non-agent (leader/supervisor/admin)
app.post("/api/tasks", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role === "agent") return res.status(403).json({ error: "Agents cannot assign tasks." });
  const { title, description, assigned_to, due_date, priority, require_time_entry } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Task title is required." });
  if (!assigned_to) return res.status(400).json({ error: "Please choose an employee to assign the task to." });

  const target = await DB.getUserById(assigned_to);
  if (!target) return res.status(400).json({ error: "Selected employee was not found." });
  if (!canAssignTo(req.user, target)) {
    return res.status(403).json({ error: "You can only assign tasks to your direct reports (the level immediately below you, in your department)." });
  }

  const now = new Date().toISOString();
  const task = await DB.addAssignedTask({
    id: "task-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
    title: title.trim(),
    description: description || undefined,
    assigned_by: req.user.id,
    assigned_by_name: req.user.full_name,
    assigned_to: target.id,
    assigned_to_name: target.full_name,
    department: target.department,
    priority: priority || "Medium",
    due_date: due_date || undefined,
    status: "New",
    created_at: now,
    require_time_entry: require_time_entry !== false,
  } as any);
  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: target.department, department: target.department, action: "Assign Task", related_ref: task.id,
    details: `${title.trim()} → ${target.full_name}`,
  });
  res.status(201).json(task);
}));

// List tasks in the caller's management scope (for the Task Tracker)
app.get("/api/tasks", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const { role, id, department } = req.user;
  // Make sure today's recurring instances exist before listing
  await ensureTodayInstances(isExecutive(req.user) ? undefined : department);
  let tasks;
  if (isExecutive(req.user)) tasks = await DB.getAssignedTasks({});
  else if (role === "agent") tasks = await DB.getAssignedTasks({ assigned_to: id });
  else tasks = await DB.getAssignedTasks({ department });
  res.json(tasks);
}));

// Tasks assigned to me personally (the "My Tasks" page — available to every role)
app.get("/api/tasks/mine", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.department) await ensureTodayInstances(req.user.department);
  res.json(await DB.getAssignedTasks({ assigned_to: req.user.id }));
}));

// ---- Pool: available (unclaimed) recurring tasks for on-shift agents ----
app.get("/api/tasks/pool", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const { role, department } = req.user;
  if (role !== "agent") {
    // Managers can view their department's pool (admin: all)
    if (role === "admin") {
      let all: any[] = [];
      for (const d of ["Call Center", "Technical", "Complaints", "Quality"]) { await ensureTodayInstances(d); all = all.concat(await DB.getPoolTasks(d)); }
      return res.json(all);
    }
    await ensureTodayInstances(department);
    return res.json(await DB.getPoolTasks(department));
  }
  await ensureTodayInstances(department);
  res.json(await DB.getPoolTasks(department));
}));

// ---- Claim a pool task (agent must be on shift) ----
app.post("/api/tasks/:id/claim", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== "agent") return res.status(403).json({ error: "Only agents can claim tasks." });
  const me = await DB.getUserById(req.user.id);
  if (!me || me.shift_status !== "on") return res.status(400).json({ error: "You must be On Shift to claim tasks." });
  const task = await DB.getAssignedTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found." });
  if (task.department !== me.department) return res.status(403).json({ error: "This task is not for your department." });
  const claimed = await DB.claimTask(req.params.id, me.id, me.full_name);
  if (!claimed) return res.status(409).json({ error: "This task was already claimed by someone else." });
  res.json(claimed);
}));

// Notification badge — my unseen assigned tasks (every role can receive tasks)
app.get("/api/tasks/unseen-count", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  res.json({ count: await DB.countUnseenTasks(req.user.id) });
}));

// Mark all of my assigned tasks as seen
app.post("/api/tasks/mark-seen", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  await DB.markTasksSeen(req.user.id);
  res.json({ message: "ok" });
}));

// Employees the caller can assign to — anyone strictly below them
// (department-scoped for supervisors/leaders; cross-department for management)
app.get("/api/tasks/agents", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role === "agent") return res.status(403).json({ error: "Forbidden" });
  const subs = (await DB.getUsers())
    .filter((u) => u.id !== req.user.id && u.status !== "Inactive" && canAssignTo(req.user, u));
  res.json(subs.map((u) => ({ id: u.id, full_name: u.full_name, department: u.department, job_title: u.job_title, level: u.level })));
}));

// Update a task (agent owner updates status; manager/admin can update)
app.put("/api/tasks/:id", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const task = await DB.getAssignedTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found." });
  const { role, id, department } = req.user;
  // The person the task is assigned to can progress it (any role can be an assignee).
  const isAssignee = task.assigned_to === id;
  // A manager can edit/reassign tasks they created, or within their scope.
  const canManage = role === "admin" || task.assigned_by === id
    || (role !== "agent" && (isExecutive(req.user) || task.department === department));
  if (!isAssignee && !canManage) return res.status(403).json({ error: "Not authorized to update this task." });

  const fields: any = {};

  if (isAssignee) {
    // Assignee: progress the task (status / time / note). Only the assignee completes.
    if (req.body.status !== undefined) fields.status = req.body.status;
    if (req.body.duration_seconds !== undefined) fields.duration_seconds = Math.max(0, Math.round(Number(req.body.duration_seconds) || 0));
    if (req.body.note !== undefined) fields.note = req.body.note;
  }
  if (canManage && !isAssignee) {
    // Manager: edit details + reassign (NOT complete)
    ["title", "description", "priority", "due_date"].forEach((k) => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
    if (req.body.assigned_to !== undefined && req.body.assigned_to !== task.assigned_to) {
      const target = await DB.getUserById(req.body.assigned_to);
      if (!target) return res.status(400).json({ error: "Selected employee was not found." });
      if (!canAssignTo(req.user, target)) return res.status(403).json({ error: "You can only reassign to your direct reports (the level immediately below you, in your department)." });
      fields.assigned_to = target.id; fields.assigned_to_name = target.full_name; fields.department = target.department; fields.seen = false;
    }
  }

  // Completing a task requires the time spent (unless supervisor disabled it)
  const finalDuration = fields.duration_seconds ?? task.duration_seconds ?? 0;
  if (fields.status === "Completed" && task.require_time_entry !== false && Number(finalDuration) <= 0) {
    return res.status(400).json({ error: "Time spent is required to complete the task." });
  }
  const newlyCompleted = fields.status === "Completed" && task.status !== "Completed";
  if (newlyCompleted && !task.completed_at) fields.completed_at = new Date().toISOString();
  const updated = await DB.updateAssignedTask(req.params.id, fields);

  // On completion, record a Log for the assigned agent (shows in My Logs + Dashboard)
  if (newlyCompleted) {
    const logType = DEPT_TO_LOGTYPE[task.department || ""] || "call_center";
    const now = new Date().toISOString();
    const note = fields.note ?? task.note;
    await DB.addLog({
      log_type: logType as any, department: task.department, activity_type: task.title,
      status: logType === "complaint" ? "Solved" : "Completed",
      agent_id: task.assigned_to, agent_name: task.assigned_to_name,
      notes: `[Assigned task] ${task.title}${task.description ? " — " + task.description : ""}${note ? " | Note: " + note : ""}`,
      duration_seconds: Number(finalDuration), created_at: now, updated_at: now, created_by: id,
    });
  }

  await DB.addAuditLog({
    operator_id: id, operator_name: req.user.full_name, operator_role: role,
    category: task.department, department: task.department, action: "Update Task", related_ref: task.id,
    details: task.title, previous_value: JSON.stringify({ status: task.status }), new_value: JSON.stringify(fields),
  });
  res.json(updated);
}));

// Delete a task (assigner or admin)
app.delete("/api/tasks/:id", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const task = await DB.getAssignedTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found." });
  if (req.user.role !== "admin" && task.assigned_by !== req.user.id) {
    return res.status(403).json({ error: "Only the assigner or an admin can delete this task." });
  }
  // Recurring instances must be soft-deleted (status=Cancelled) so ensureTodayInstances
  // doesn't regenerate them — the row must remain to satisfy the unique(template_id, task_date) guard.
  if ((task as any).template_id) {
    await DB.updateAssignedTask(req.params.id, { status: "Cancelled" } as any);
  } else {
    await DB.deleteAssignedTask(req.params.id);
  }
  res.json({ message: "Task deleted." });
}));

// ----------------------------------------------------
// Recurring task templates (managers; department-scoped)
// ----------------------------------------------------
app.get("/api/recurring", authenticateJWT, requireManager, asyncHandler(async (req: any, res: any) => {
  const tpls = req.user.role === "admin" ? await DB.getRecurringTemplates({}) : await DB.getRecurringTemplates({ department: req.user.department });
  res.json(tpls);
}));

app.post("/api/recurring", authenticateJWT, requireManager, asyncHandler(async (req: any, res: any) => {
  const { title, description, priority, recurrence_type, days_of_week, due_time, assign_mode } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Task is required." });
  let department = req.user.department;
  if (req.user.role === "admin" && req.body.department) department = req.body.department;
  if (!department) return res.status(400).json({ error: "Department is required." });
  if ((recurrence_type === "weekly" || recurrence_type === "weekdays") && !String(days_of_week || "").trim()) {
    return res.status(400).json({ error: "Please choose at least one day of the week." });
  }
  const tpl = await DB.addRecurringTemplate({
    id: "tpl-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
    title: title.trim(), description: description || undefined, department,
    priority: priority || "Medium", recurrence_type: recurrence_type || "daily",
    days_of_week: days_of_week || null, due_time: due_time || null,
    assign_mode: assign_mode === "auto" ? "auto" : "pool", active: true,
    created_by: req.user.id, created_by_name: req.user.full_name, created_at: new Date().toISOString(),
  });
  await DB.addAuditLog({
    operator_id: req.user.id, operator_name: req.user.full_name, operator_role: req.user.role,
    category: department, department, action: "Create Recurring Task", related_ref: tpl.id, details: title.trim(),
  });
  res.status(201).json(tpl);
}));

app.put("/api/recurring/:id", authenticateJWT, requireManager, asyncHandler(async (req: any, res: any) => {
  const tpl = await DB.getRecurringTemplateById(req.params.id);
  if (!tpl) return res.status(404).json({ error: "Template not found." });
  if (req.user.role !== "admin" && tpl.department !== req.user.department) return res.status(403).json({ error: "Not authorized." });
  const fields: any = {};
  ["title", "description", "priority", "recurrence_type", "days_of_week", "due_time", "assign_mode", "active"].forEach((k) => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
  if (req.user.role === "admin" && req.body.department !== undefined) fields.department = req.body.department;
  const updated = await DB.updateRecurringTemplate(req.params.id, fields);
  res.json(updated);
}));

app.delete("/api/recurring/:id", authenticateJWT, requireManager, asyncHandler(async (req: any, res: any) => {
  const tpl = await DB.getRecurringTemplateById(req.params.id);
  if (!tpl) return res.status(404).json({ error: "Template not found." });
  if (req.user.role !== "admin" && tpl.department !== req.user.department) return res.status(403).json({ error: "Not authorized." });
  await DB.deleteRecurringTemplate(req.params.id);
  res.json({ message: "Template deleted." });
}));

// ----------------------------------------------------
// Shift presence (On Shift / Out of Shift) + sessions for reports
// ----------------------------------------------------
app.get("/api/shift/status", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  const me = await DB.getUserById(req.user.id);
  res.json({ status: me?.shift_status || "off", since: (me as any)?.shift_started_at || null });
}));

app.post("/api/shift/start", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== "agent") return res.status(403).json({ error: "Only agents have shifts." });
  const me = await DB.getUserById(req.user.id);
  if (!me) return res.status(404).json({ error: "User not found." });
  const now = new Date().toISOString();
  if (me.shift_status === "on") return res.json({ status: "on", since: (me as any).shift_started_at });
  await DB.setShiftStatus(me.id, "on", now);
  await DB.startShiftSession({ id: "sh-" + Date.now() + "-" + Math.floor(Math.random() * 1000), user_id: me.id, user_name: me.full_name, department: me.department || "", started_at: now });
  // Auto-assign any unassigned auto-mode tasks waiting in the pool to this newcomer if appropriate is left to next generation; just return.
  res.json({ status: "on", since: now });
}));

app.post("/api/shift/end", authenticateJWT, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== "agent") return res.status(403).json({ error: "Only agents have shifts." });
  const me = await DB.getUserById(req.user.id);
  if (!me) return res.status(404).json({ error: "User not found." });
  const now = new Date().toISOString();
  if (me.shift_status === "on") await DB.endShiftSession(me.id, now);
  await DB.setShiftStatus(me.id, "off", null);
  res.json({ status: "off" });
}));

app.get("/api/shift/sessions", authenticateJWT, requireManager, asyncHandler(async (req: any, res: any) => {
  const sessions = req.user.role === "admin" ? await DB.getShiftSessions({}) : await DB.getShiftSessions({ department: req.user.department });
  res.json(sessions);
}));

// ----------------------------------------------------
// Interactions API (Secure & Role-Filtered)
// ----------------------------------------------------
app.get("/api/interactions", authenticateJWT, asyncHandler(async (req, res) => {
  const list = await DB.getInteractions();
  if (req.user.role === "agent") {
    // Agents only see tickets they created/assigned
    const filtered = list.filter((i) => i.agent_id === req.user.id);
    return res.json(filtered);
  }
  res.json(list);
}));

// Agent History lookup for the Call Reason screen (by customer phone and/or order number)
app.get("/api/interactions/history", authenticateJWT, asyncHandler(async (req, res) => {
  const phone = (req.query.phone as string) || "";
  const order = (req.query.order as string) || "";
  if (!phone && !order) return res.json([]);
  let history = await DB.getInteractionHistory({ phone: phone || undefined, order: order || undefined });
  if (req.user.role === "agent") {
    history = history.filter((i) => i.agent_id === req.user.id);
  }
  res.json(history);
}));

app.get("/api/interactions/:id", authenticateJWT, asyncHandler(async (req, res) => {
  const interaction = await DB.getInteractionById(req.params.id);
  if (interaction) {
    if (req.user.role === "agent" && interaction.agent_id !== req.user.id) {
      return res.status(403).json({ error: "Sorry, you are not authorized to view other agents' logs." });
    }
    res.json(interaction);
  } else {
    res.status(404).json({ error: "Interaction not found" });
  }
}));

app.post("/api/interactions", authenticateJWT, asyncHandler(async (req, res) => {
  const {
    customer_name,
    customer_phone,
    interaction_type,
    communication_type,
    call_direction,
    brand,
    category,
    call_reason,
    order_number,
    branch,
    team,
    customer_type,
    call_from,
    aggregator_name,
    comments,
    complaint_reason,
    fcr,
    priority,
    status,
    summary,
    action_taken,
    follow_up_required,
    follow_up_date,
    follow_up_notes,
    attachments, // Array of { file_name, mime_type, file_data }
  } = req.body;

  // Basic validation
  if (!customer_name || !customer_phone || !interaction_type || !communication_type || !call_direction) {
    return res.status(400).json({ error: "Please fill in all required fields." });
  }

  // Force secure session-based injection of Agent details
  const agent_id = req.user.id;
  const agent_name = req.user.full_name;

  // Team defaults to the logged-in operator's own team when not provided
  const operator = await DB.getUserById(agent_id);
  const resolvedTeam = team || operator?.team || "Call Center";

  // Parse attachments
  const parsedAttachments = Array.isArray(attachments)
    ? attachments.map((att: any, idx: number) => ({
        id: `att-${Date.now()}-${idx}`,
        file_name: att.file_name,
        mime_type: att.mime_type,
        file_data: att.file_data,
      }))
    : [];

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toTimeString().split(" ")[0].substring(0, 5); // HH:MM

  const newInteraction = await DB.addInteraction({
    interaction_date: dateStr,
    interaction_time: timeStr,
    agent_id,
    agent_name,
    customer_name,
    customer_phone,
    interaction_type,
    communication_type,
    call_direction,
    brand: brand || "Talabat",
    category: category || "Other",
    call_reason: call_reason || undefined,
    order_number: order_number || undefined,
    branch: branch || undefined,
    team: resolvedTeam,
    customer_type: customer_type || undefined,
    call_from: call_from || undefined,
    aggregator_name: aggregator_name || undefined,
    comments: comments || undefined,
    complaint_reason: call_reason === "Complaint" ? (complaint_reason || undefined) : undefined,
    fcr: call_reason === "Complaint" ? (fcr || undefined) : undefined,
    priority: priority || "Medium",
    status: status || "Open",
    summary: summary || "",
    action_taken: action_taken || "",
    follow_up_required: !!follow_up_required,
    follow_up_date: follow_up_required ? follow_up_date : undefined,
    follow_up_notes: follow_up_required ? follow_up_notes : undefined,
    attachments: parsedAttachments,
    created_at: now.toISOString(),
  });

  // Activity log for the Agent Logs module
  await DB.addAuditLog({
    operator_id: agent_id,
    operator_name: agent_name,
    operator_role: req.user.role,
    category: resolvedTeam,
    action: `Logged Call — ${call_reason || newInteraction.interaction_type}`,
    details: `${newInteraction.brand}${newInteraction.branch ? " / " + newInteraction.branch : ""} · ${newInteraction.customer_phone}${newInteraction.complaint_reason ? " · " + newInteraction.complaint_reason : ""}${newInteraction.fcr ? " · FCR: " + newInteraction.fcr : ""}`,
    related_ref: newInteraction.id,
  });

  res.status(201).json(newInteraction);
}));

app.put("/api/interactions/:id", authenticateJWT, asyncHandler(async (req, res) => {
  const interaction = await DB.getInteractionById(req.params.id);
  if (!interaction) {
    return res.status(404).json({ error: "Interaction not found for editing" });
  }

  if (req.user.role === "agent" && interaction.agent_id !== req.user.id) {
    return res.status(403).json({ error: "Sorry, you are not authorized to update other agents' logs." });
  }

  const updated = await DB.updateInteraction(req.params.id, req.body);
  res.json(updated);
}));

app.delete("/api/interactions/:id", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const success = await DB.deleteInteraction(req.params.id);
  if (success) {
    res.json({ message: "Interaction deleted successfully" });
  } else {
    res.status(404).json({ error: "Interaction not found for deletion" });
  }
}));

// ----------------------------------------------------
// Dashboard & Analytics Stats API (Protected)
// ----------------------------------------------------
app.get("/api/dashboard/stats", authenticateJWT, asyncHandler(async (req, res) => {
  let interactions = await DB.getInteractions();
  const brands = await DB.getBrands();
  const users = await DB.getUsers();

  const todayStr = new Date().toISOString().split("T")[0];

  // RBAC scope limiting for basic agents
  if (req.user.role === "agent") {
    interactions = interactions.filter((i) => i.agent_id === req.user.id);
  }

  // Filters
  const todayInteractions = interactions.filter((i) => i.interaction_date === todayStr);

  const totalCallsToday = todayInteractions.filter((i) => i.communication_type === "Call").length;
  const totalSRs = todayInteractions.filter((i) => i.interaction_type === "SR").length;
  const totalTasks = todayInteractions.filter((i) => i.communication_type === "Task").length;
  const totalInbound = todayInteractions.filter((i) => i.call_direction === "Inbound").length;
  const totalOutbound = todayInteractions.filter((i) => i.call_direction === "Outbound").length;

  // Brand Performance
  const brandPerfMap: Record<string, number> = {};
  brands.forEach((b) => {
    brandPerfMap[b.brand_name] = 0;
  });
  interactions.forEach((i) => {
    if (brandPerfMap[i.brand] !== undefined) {
      brandPerfMap[i.brand]++;
    } else {
      brandPerfMap[i.brand] = 1;
    }
  });
  const brandPerformance = Object.keys(brandPerfMap).map((k) => ({
    name: k,
    count: brandPerfMap[k],
  }));

  // Agent Performance (total)
  const agentPerfMap: Record<string, number> = {};
  users.forEach((u) => {
    if (u.role === "agent") {
      agentPerfMap[u.full_name] = 0;
    }
  });
  interactions.forEach((i) => {
    if (agentPerfMap[i.agent_name] !== undefined) {
      agentPerfMap[i.agent_name]++;
    } else {
      agentPerfMap[i.agent_name] = 1;
    }
  });
  let agentPerformance = Object.keys(agentPerfMap).map((k) => ({
    name: k,
    count: agentPerfMap[k],
  }));

  if (req.user.role === "agent") {
    agentPerformance = agentPerformance.filter((x) => x.name === req.user.full_name);
  }

  // Daily Reports graph (compiled from past 7 days)
  const dailyGraph: Record<string, { calls: number; srs: number; tasks: number }> = {};
  for (let i = 6; i >= 0; i--) {
    const dStr = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    dailyGraph[dStr] = { calls: 0, srs: 0, tasks: 0 };
  }

  interactions.forEach((i) => {
    if (dailyGraph[i.interaction_date]) {
      if (i.communication_type === "Call") {
        dailyGraph[i.interaction_date].calls++;
      }
      if (i.interaction_type === "SR") {
        dailyGraph[i.interaction_date].srs++;
      }
      if (i.communication_type === "Task") {
        dailyGraph[i.interaction_date].tasks++;
      }
    }
  });

  const dailyReports = Object.keys(dailyGraph).map((d) => ({
    date: d,
    calls: dailyGraph[d].calls,
    srs: dailyGraph[d].srs,
    tasks: dailyGraph[d].tasks,
  }));

  // ---- Extended metrics (call center spec) ----
  const isComplaint = (i: any) => i.interaction_type === "Complaint" || i.call_reason === "Complaint";
  const totalCalls = interactions.filter((i) => i.communication_type === "Call").length;
  const complaints = interactions.filter(isComplaint);
  const totalComplaints = complaints.length;
  const solvedCases = complaints.filter((i) => i.fcr === "Solved").length;
  const unsolvedCases = complaints.filter((i) => i.fcr === "Not Solved").length;
  const fcrDenom = solvedCases + unsolvedCases;
  const fcrRate = fcrDenom ? Math.round((solvedCases / fcrDenom) * 100) : 0;

  const groupCount = (keyFn: (i: any) => string) => {
    const m: Record<string, number> = {};
    interactions.forEach((i) => { const k = keyFn(i) || "Unspecified"; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map((name) => ({ name, count: m[name] })).sort((a, b) => b.count - a.count);
  };
  const callsByType = groupCount((i) => i.call_reason || i.interaction_type);
  const callsByBranch = groupCount((i) => i.branch);

  // Complaint trends over the past 7 days
  const trendMap: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const dStr = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    trendMap[dStr] = 0;
  }
  complaints.forEach((i) => { if (trendMap[i.interaction_date] !== undefined) trendMap[i.interaction_date]++; });
  const complaintTrends = Object.keys(trendMap).map((d) => ({ date: d, count: trendMap[d] }));

  res.json({
    totalCallsToday,
    totalSRs,
    totalTasks,
    totalInbound,
    totalOutbound,
    brandPerformance,
    agentPerformance,
    dailyReports,
    // extended
    totalCalls,
    totalComplaints,
    solvedCases,
    unsolvedCases,
    fcrRate,
    callsByType,
    callsByBranch,
    complaintTrends,
  });
}));

// ----------------------------------------------------
// Reports PDF/CSV Export Generation API (Protected to TL/Admin)
// ----------------------------------------------------
app.get("/api/reports/daily", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const interactions = await DB.getInteractions();
  const users = await DB.getUsers();

  const targetDate = (req.query.date as string) || new Date().toISOString().split("T")[0];
  const dailyLogs = interactions.filter((i) => i.interaction_date === targetDate);

  const totalCalls = dailyLogs.filter((i) => i.communication_type === "Call").length;
  const totalSRs = dailyLogs.filter((i) => i.interaction_type === "SR").length;
  const totalTasks = dailyLogs.filter((i) => i.communication_type === "Task").length;
  const inboundCount = dailyLogs.filter((i) => i.call_direction === "Inbound").length;
  const outboundCount = dailyLogs.filter((i) => i.call_direction === "Outbound").length;

  // Agent productivity
  const productivityMap: Record<string, { calls: number; srs: number; tasks: number }> = {};
  users.forEach((u) => {
    if (u.role === "agent") {
      productivityMap[u.full_name] = { calls: 0, srs: 0, tasks: 0 };
    }
  });

  dailyLogs.forEach((i) => {
    if (!productivityMap[i.agent_name]) {
      productivityMap[i.agent_name] = { calls: 0, srs: 0, tasks: 0 };
    }
    if (i.communication_type === "Call") productivityMap[i.agent_name].calls++;
    if (i.interaction_type === "SR") productivityMap[i.agent_name].srs++;
    if (i.communication_type === "Task") productivityMap[i.agent_name].tasks++;
  });

  const agentProductivity = Object.keys(productivityMap).map((k) => ({
    name: k,
    calls: productivityMap[k].calls,
    srs: productivityMap[k].srs,
    tasks: productivityMap[k].tasks,
  }));

  res.json({
    totalCalls,
    totalSRs,
    totalTasks,
    inboundCount,
    outboundCount,
    agentProductivity,
  });
}));

app.get("/api/reports/monthly", authenticateJWT, requireLeaderOrAdmin, asyncHandler(async (req, res) => {
  const interactions = await DB.getInteractions();
  const brands = await DB.getBrands();

  const resolved = interactions.filter((i) => i.status === "Resolved" || i.status === "Closed").length;
  const resolutionRate = interactions.length ? Math.round((resolved / interactions.length) * 100) : 0;

  const followUpRequiredNum = interactions.filter((i) => i.follow_up_required).length;
  const followUpRate = interactions.length ? Math.round((followUpRequiredNum / interactions.length) * 100) : 0;

  const categoryMap: Record<string, number> = {};
  interactions.forEach((i) => {
    categoryMap[i.category] = (categoryMap[i.category] || 0) + 1;
  });
  const topCategories = Object.keys(categoryMap)
    .map((k) => ({
      name: k,
      count: categoryMap[k],
    }))
    .sort((a, b) => b.count - a.count);

  const brandPerf = brands.map((b) => {
    const brandInteractions = interactions.filter((i) => i.brand === b.brand_name);
    const resolvedInBrand = brandInteractions.filter((i) => i.status === "Resolved" || i.status === "Closed").length;
    const rate = brandInteractions.length ? Math.round((resolvedInBrand / brandInteractions.length) * 100) : 100;
    return {
      name: b.brand_name,
      count: brandInteractions.length,
      resolvedRate: rate,
    };
  });

  res.json({
    brandPerformance: brandPerf,
    topCategories,
    resolutionRate,
    averageHandlingTime: "4m 12s",
    followUpRate,
  });
}));

// ----------------------------------------------------
// Ratings / Reviews Module
// ----------------------------------------------------
import * as XLSX from "xlsx";

// Excel column name fuzzy matcher (case-insensitive, accepts aliases)
const pick = (row: Record<string, any>, ...names: string[]): string => {
  for (const name of names) {
    for (const key of Object.keys(row)) {
      if (key.toLowerCase().trim() === name.toLowerCase().trim()) {
        const v = row[key]; return v != null ? String(v).trim() : "";
      }
    }
  }
  return "";
};

const normalisePhone = (p: string): string => p ? p.replace(/[\s\-\(\)\.]/g, "").replace(/^00/, "+") : "";

// Map a free-text status cell from the upload file to an action_status.
// Returns null when the cell is empty/unrecognised.
// Normalise a spreadsheet date cell to YYYY-MM-DD. Handles Excel serial
// numbers (days since 1899-12-30) and ordinary date strings; leaves other
// text untouched so free-form values survive.
const normaliseExcelDate = (v: string): string => {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 90000) {
      const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    if (y >= 1990 && y <= 2100) return d.toISOString().slice(0, 10);
  }
  return s;
};

// requireUpload: admin/supervisor/leader always; agent only if can_upload=true in DB
const requireUpload = async (req: any, res: any, next: any) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized." });
  const role = req.user.role;
  if (["admin", "supervisor", "leader"].includes(role)) return next();
  // For agents: read can_upload live from DB
  const u = await DB.getUserById(req.user.id);
  if ((u as any)?.can_upload) return next();
  return res.status(403).json({ error: "Upload permission required." });
};

// Excel template (returns base64 xlsx)
app.get("/api/ratings/template", authenticateJWT, requireUpload, asyncHandler(async (_req, res) => {
  const headers = ["Date","Restaurant","Platform","Customer Name","Phone Number","Branch","Order ID","Customer Comment","Rate","Served By","Following Date","Surveyed By","Type of Complaint","Complaint Cases","Note"];
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ratings");
  const file = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  res.json({ filename: "ratings_template.xlsx", file });
}));

// Upload ratings from Excel
app.post("/api/ratings/upload", authenticateJWT, requireUpload, asyncHandler(async (req: any, res) => {
  const { file, mode = "skip" } = req.body;
  if (!file) return res.status(400).json({ error: "No file provided." });

  const buf = Buffer.from(file, "base64");
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

  const brands = await DB.getBrands();
  const platforms = await DB.getPlatforms();
  const brandMap = new Map(brands.map((b) => [b.brand_name.toLowerCase(), b.id]));
  const platMap = new Map(platforms.map((p) => [p.name.toLowerCase(), p.id]));

  // Eligible agents for auto-assign: active Call Center agents, distributed even round-robin.
  const allUsers = await DB.getUsers();
  const ccAgentIds = allUsers
    .filter((u: any) => u.role === "agent" && u.status === "Active" && u.department === "Call Center")
    .map((u: any) => u.id);
  let rrPointer = 0;

  const result = { total: rows.length, inserted: 0, duplicates: 0, overwritten: 0, tasks: 0, auto_closed: 0, errors: [] as { row: number; message: string }[] };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lineNum = i + 2;
    try {
      const brandName = pick(r, "Restaurant", "Brand");
      const platformName = pick(r, "Platform");
      const orderId = pick(r, "Order ID", "OrderID", "Order");
      const rateRaw = pick(r, "Rate", "Rating (1-5)", "Rating");
      const ratingVal = Math.round(Number(String(rateRaw).replace(/[^0-9.]/g, "")));

      if (!brandName) { result.errors.push({ row: lineNum, message: "Missing Restaurant/Brand." }); continue; }
      if (!platformName) { result.errors.push({ row: lineNum, message: "Missing Platform." }); continue; }
      if (!orderId) { result.errors.push({ row: lineNum, message: "Missing Order ID." }); continue; }
      if (!ratingVal || ratingVal < 1 || ratingVal > 5) { result.errors.push({ row: lineNum, message: `Invalid rate: ${rateRaw}` }); continue; }

      const brand_id = brandMap.get(brandName.toLowerCase());
      if (!brand_id) { result.errors.push({ row: lineNum, message: `Unknown brand: ${brandName}` }); continue; }
      const platform_id = platMap.get(platformName.toLowerCase());
      if (!platform_id) { result.errors.push({ row: lineNum, message: `Unknown platform: ${platformName}` }); continue; }

      const review_text = pick(r, "Customer Comment");
      const phone = normalisePhone(pick(r, "Phone Number"));
      // Auto-triage (no manual Status column):
      //   TASK       = has a comment (any rating) OR (rating 1-3 AND has a phone)
      //                -> pending, auto-assigned to an agent. A commented row with no phone is
      //                   STILL a task: the agent contacts the aggregator to obtain the phone.
      //   AUTO CLOSE = everything else: 4-5 with no comment, or a 1-3 with no comment and no phone
      //                -> no_action_needed, hidden from the Reviews list, counted in reports only
      const hasComment = !!(review_text && review_text.trim());
      const isTask = hasComment || (ratingVal <= 3 && !!phone);
      const action_status = isTask ? "pending" : "no_action_needed";
      const requires_action = isTask;
      // Even round-robin across active Call Center agents (task rows only).
      let assigned_agent_id: string | null = null;
      if (isTask && ccAgentIds.length) {
        assigned_agent_id = ccAgentIds[rrPointer % ccAgentIds.length];
        rrPointer++;
      }

      const outcome = await DB.upsertRating({
        brand_id, platform_id, order_id: orderId, rating: ratingVal,
        review_text: review_text || undefined,
        customer_phone: phone || undefined,
        requires_action, action_status, assigned_agent_id, uploaded_by: req.user.id,
        order_date: normaliseExcelDate(pick(r, "Date")) || undefined,
        customer_name: pick(r, "Customer Name") || undefined,
        branch: pick(r, "Branch") || undefined,
        filled_by: pick(r, "Served By", "Filled By") || undefined,
        following_date: normaliseExcelDate(pick(r, "Following Date")) || undefined,
        surveyed_by: pick(r, "Surveyed By", "Surved by") || undefined,
        complaint_type: pick(r, "Type of Complaint", "Type of complain", "Complaint Type") || undefined,
        complaint_cases: pick(r, "Complaint Cases") || undefined,
        complaint_status: pick(r, "Note", "Complaint Status") || undefined,
        served_by: pick(r, "Served By", "Filled By") || undefined,
      }, mode as "skip" | "overwrite");

      if (outcome === "inserted") result.inserted++;
      else if (outcome === "skipped") result.duplicates++;
      else result.overwritten++;
      if (outcome !== "skipped") { if (isTask) result.tasks++; else result.auto_closed++; }
    } catch (e: any) {
      result.errors.push({ row: lineNum, message: e.message || "Unknown error." });
    }
  }
  res.json(result);
}));

// List ratings with filters. Agents only ever see ratings assigned to them.
app.get("/api/ratings", authenticateJWT, asyncHandler(async (req: any, res) => {
  const isAgent = req.user.role === "agent";
  const { brand_id, platform_id, action_status, requires_action, assigned, min_rating, max_rating, has_comment, from, to } = req.query;
  // Resolve the "assigned" filter: agents are always scoped to themselves; managers can pick
  // "me", "unassigned", or a specific agent id.
  let assignedParam: string | undefined;
  let assignedAgentId: string | undefined;
  if (isAgent) { assignedParam = "me"; assignedAgentId = req.user.id; }
  else if (assigned === "me") { assignedParam = "me"; assignedAgentId = req.user.id; }
  else if (assigned === "unassigned") { assignedParam = "unassigned"; }
  else if (assigned) { assignedAgentId = assigned as string; }
  const ratings = await DB.getRatings({
    brand_id: brand_id as string || undefined,
    platform_id: platform_id as string || undefined,
    action_status: action_status as string || undefined,
    requires_action: requires_action === "true" ? true : undefined,
    assigned: assignedParam,
    assigned_agent_id: assignedAgentId,
    min_rating: min_rating ? Number(min_rating) : undefined,
    max_rating: max_rating ? Number(max_rating) : undefined,
    has_comment: has_comment === "true" ? true : has_comment === "false" ? false : undefined,
    from: from as string || undefined,
    to: to as string || undefined,
    limit: Math.min(Number(req.query.limit) || 5000, 20000),
  });
  res.json(ratings);
}));

// Aggregated Ratings + Surveys analytics dashboard (non-agents only)
app.get("/api/feedback/dashboard", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (req.user.role === "agent") return res.status(403).json({ error: "Access denied." });
  const kwToUtc = (dateStr: string, endOfDay: boolean) => {
    const [y, mo, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0) - KW_OFFSET_MS).toISOString();
  };
  const from = typeof req.query.from === "string" && req.query.from ? req.query.from : "";
  const to = typeof req.query.to === "string" && req.query.to ? req.query.to : "";
  const fromISO = from ? kwToUtc(from, false) : null;
  const toISO = to ? kwToUtc(to, true) : null;
  res.json(await DB.getFeedbackDashboard(fromISO, toISO));
}));

// Delete reviews (admin only) — by ids, or all uploaded on a given Kuwait day
app.post("/api/ratings/delete", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Access denied." });
  const { ids, uploaded_on } = req.body;
  if (typeof uploaded_on === "string" && uploaded_on) {
    const [y, mo, d] = uploaded_on.split("-").map(Number);
    const fromISO = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - KW_OFFSET_MS).toISOString();
    const toISO = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59) - KW_OFFSET_MS).toISOString();
    const n = await DB.deleteRatingsUploadedBetween(fromISO, toISO);
    return res.json({ deleted: n });
  }
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: "No reviews selected." });
  const n = await DB.deleteRatings(ids);
  res.json({ deleted: n });
}));

// Count reviews uploaded on a given Kuwait day (admin — used to confirm bulk purge)
app.get("/api/ratings/uploaded-count", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Access denied." });
  const day = typeof req.query.date === "string" ? req.query.date : "";
  if (!day) return res.status(400).json({ error: "date is required." });
  const [y, mo, d] = day.split("-").map(Number);
  const fromISO = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - KW_OFFSET_MS).toISOString();
  const toISO = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59) - KW_OFFSET_MS).toISOString();
  res.json({ count: await DB.countRatingsUploadedBetween(fromISO, toISO) });
}));

// Bulk-assign several reviews to one agent (assigners only)
app.post("/api/ratings/assign", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (!["admin", "supervisor", "leader"].includes(req.user.role))
    return res.status(403).json({ error: "Access denied." });
  const { ids, assigned_agent_id } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: "No reviews selected." });
  const n = await DB.bulkAssignRatings(ids, assigned_agent_id || null);
  res.json({ assigned: n });
}));

// Bulk status change (e.g. mark a batch of reviews "No Action Required")
app.post("/api/ratings/bulk-status", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (!["admin", "supervisor", "leader"].includes(req.user.role))
    return res.status(403).json({ error: "Access denied." });
  const { ids, action_status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: "No reviews selected." });
  const valid = ["pending", "in_progress", "resolved", "unreachable", "no_action_needed"];
  if (!valid.includes(action_status))
    return res.status(400).json({ error: "Invalid status." });
  const n = await DB.bulkSetRatingStatus(ids, action_status);
  res.json({ updated: n });
}));

// Active Call Center agents — for the review assignment dropdown (assigners only)
app.get("/api/agents", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (!["admin", "supervisor", "leader"].includes(req.user.role))
    return res.status(403).json({ error: "Access denied." });
  const users = await DB.getUsers();
  res.json(users
    .filter((u: any) => u.role === "agent" && u.status === "Active" && u.department === "Call Center")
    .map((u: any) => ({ id: u.id, full_name: u.full_name })));
}));

// List platforms
app.get("/api/platforms", authenticateJWT, asyncHandler(async (_req, res) => {
  res.json(await DB.getPlatforms());
}));

// Get single rating with attempts. Agents may only open ratings assigned to them.
app.get("/api/ratings/:id", authenticateJWT, asyncHandler(async (req: any, res) => {
  const rating = await DB.getRatingById(req.params.id);
  if (!rating) return res.status(404).json({ error: "Rating not found." });
  if (req.user.role === "agent" && rating.assigned_agent_id !== req.user.id)
    return res.status(403).json({ error: "Access denied." });
  res.json(rating);
}));

// Patch rating (status / note / assignment / customer contact)
app.patch("/api/ratings/:id", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (req.user.role === "marketing") return res.status(403).json({ error: "Access denied." });
  const rating = await DB.getRatingById(req.params.id);
  if (!rating) return res.status(404).json({ error: "Rating not found." });
  // Agents may only edit reviews assigned to them
  if (req.user.role === "agent" && rating.assigned_agent_id !== req.user.id)
    return res.status(403).json({ error: "Access denied." });

  const { action_status, action_note, assigned_agent_id, customer_phone, customer_name } = req.body;
  const fields: any = {};
  if (action_note !== undefined) fields.action_note = action_note;
  if (customer_phone !== undefined) fields.customer_phone = normalisePhone(String(customer_phone)) || null;
  if (customer_name !== undefined) fields.customer_name = customer_name ? String(customer_name).trim() : null;
  if (assigned_agent_id !== undefined) {
    const canAssign = ["admin", "supervisor", "leader"].includes(req.user.role);
    if (!canAssign) return res.status(403).json({ error: "Only leaders/supervisors can assign ratings." });
    fields.assigned_agent_id = assigned_agent_id || null;
  }
  if (action_status !== undefined) {
    fields.action_status = action_status;
    const closingStatuses = ["resolved", "no_action_needed", "unreachable"];
    if (closingStatuses.includes(action_status) && !rating.resolved_at) {
      fields.resolved_at = new Date().toISOString();
      fields.recorded_by = req.user.id;
      fields.recorded_at = new Date().toISOString();
    }
  }
  const updated = await DB.updateRating(req.params.id, fields);
  res.json(updated);
}));

// Log a call attempt (max 3)
app.post("/api/ratings/:id/attempts", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (req.user.role === "marketing") return res.status(403).json({ error: "Access denied." });
  const rating = await DB.getRatingById(req.params.id);
  if (!rating) return res.status(404).json({ error: "Rating not found." });
  const attemptsCount = (rating.attempts || []).length;
  if (attemptsCount >= 3) return res.status(400).json({ error: "Maximum 3 call attempts reached." });

  const { outcome, note } = req.body;
  if (!outcome) return res.status(400).json({ error: "Outcome is required." });

  const attempt = await DB.addCallAttempt({
    rating_id: req.params.id,
    agent_id: req.user.id,
    agent_name: req.user.full_name,
    outcome,
    note: note || undefined,
  });

  // Auto-update status
  const newAttemptNumber = attemptsCount + 1;
  const fields: any = { action_status: "in_progress" };
  if (outcome !== "answered" && newAttemptNumber >= 3) {
    fields.action_status = "unreachable";
    fields.resolved_at = new Date().toISOString();
    fields.recorded_by = req.user.id;
    fields.recorded_at = new Date().toISOString();
  }
  await DB.updateRating(req.params.id, fields);
  res.json(attempt);
}));

// ----------------------------------------------------
// Surveys Module (Call Campaigns + Survey Records)
// ----------------------------------------------------
const DAILY_SURVEY_LIMIT = Number(process.env.DAILY_SURVEY_LIMIT || 150);
const SURVEY_DEDUP_DAYS = Number(process.env.SURVEY_DEDUP_DAYS || 10);

// Max numbers a role may request in one campaign
const REQUEST_CAP: Record<string, number> = {
  admin: 100000, owner: 100000, manager: 100000, supervisor: 100000, leader: 100000,
};

const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Resolve a brand label to a brand id: full name, else the part before a separator
const resolveBrand = (label: string, brandMap: Map<string, string>): string | null => {
  if (!label) return null;
  const full = brandMap.get(label.toLowerCase().trim());
  if (full) return full;
  const part = label.split(/[（(\/|\-]/)[0].trim();
  return brandMap.get(part.toLowerCase()) || null;
};

// Heuristic: a record is "answered" if it carries a real rate / feedback / comment
const isAnswered = (rate: number | null, productFeedback: string | null, comment: string | null): boolean => {
  const validRate = rate != null && rate >= 1 && rate <= 5;
  const pf = (productFeedback || "").toLowerCase().trim();
  const realPf = !!pf && pf !== "no answer" && pf !== "noanswer" && pf !== "-";
  const c = (comment || "").trim().toLowerCase();
  const realComment = !!c && c !== "no answer" && c !== "-";
  return validRate || realPf || realComment;
};

const parseRate = (raw: string): number | null => {
  if (!raw) return null;
  const n = Math.round(Number(String(raw).replace(/[^0-9.]/g, "")));
  return n >= 1 && n <= 5 ? n : null;
};

// Registry of uploadable survey-record types (extensible)
const RECORD_TYPES: Record<string, {
  label: string; columns: string[];
  map: (row: Record<string, any>, ctx: { brandMap: Map<string, string>; platMap: Map<string, string> }) => any;
}> = {
  new_items: {
    label: "New Items Survey",
    columns: ["Order Date", "OrderSource", "NewItemName", "New Order ID", "MobileNo", "Customer suggestion for the item", "Comment", "Complaint if needed", "Served By", "Product Feedback", "Rate", "trials", "Segment"],
    map: (row) => {
      const rate = parseRate(pick(row, "Rate"));
      const pf = pick(row, "Product Feedback");
      const comment = pick(row, "Comment");
      return {
        record_type: "new_items",
        brand_id: null, brand_label: "",
        platform_id: null, platform_label: pick(row, "OrderSource", "Order Source"),
        order_id: pick(row, "New Order ID", "Order ID"),
        phone: normalisePhone(pick(row, "MobileNo", "Mobile No", "Phone")),
        item_name: pick(row, "NewItemName", "New Item Name"),
        rate, product_feedback: pf || null,
        served_by: pick(row, "Served By"),
        customer_suggestion: pick(row, "Customer suggestion for the item", "Customer suggestion"),
        comment: comment || null,
        complaint: pick(row, "Complaint if needed", "Complaint"),
        trials: pick(row, "trials", "Trials"),
        segment: pick(row, "Segment") || null,
        record_date: normaliseExcelDate(pick(row, "Order Date")),
        answered: isAnswered(rate, pf, comment),
      };
    },
  },
  complaints: {
    label: "Complaints Survey",
    columns: ["Brand / Branch", "Platform", "Order ID", "Phone Number", "Rate", "Notes", "Served By", "Segment"],
    map: (row, ctx) => {
      const rate = parseRate(pick(row, "Rate"));
      const brandLabel = pick(row, "Brand / Branch", "Brand/Branch", "Brand", "Branch");
      const platLabel = pick(row, "Platform");
      const note = pick(row, "Notes", "Note");
      return {
        record_type: "complaints",
        brand_id: resolveBrand(brandLabel, ctx.brandMap), brand_label: brandLabel,
        platform_id: ctx.platMap.get(platLabel.toLowerCase()) || null, platform_label: platLabel,
        order_id: pick(row, "Order ID"),
        phone: normalisePhone(pick(row, "Phone Number", "Phone")),
        rate, note: note || null,
        served_by: pick(row, "Served By"),
        segment: pick(row, "Segment") || null,
        answered: isAnswered(rate, null, note),
      };
    },
  },
  // Historical survey import — keeps EVERY column (main fields + the rest in `extra`).
  survey_history: {
    label: "Survey (History)",
    columns: ["Order Date", "Restaurant", "Branch", "Platform", "Order ID", "Phone Number", "Customer Name", "Order time", "Completion time", "Rate", "Recommending", "Action", "Reachability", "Segment", "Comment", "Served By"],
    map: (row, ctx) => {
      const rate = parseRate(pick(row, "Rate"));
      const brandLabel = pick(row, "Restaurant", "Restaurant name", "Brand");
      const branch = pick(row, "Branch");
      const platLabel = pick(row, "Platform");
      const comment = pick(row, "Comment");
      const reach = pick(row, "Reachability");
      const action = pick(row, "Action");
      const recommending = pick(row, "Recommending", "Recomending");
      // "Reached" => answered; but "Not Reached" must NOT count as reached.
      const reached = /reach/i.test(reach) && !/not\s*reach/i.test(reach);
      return {
        record_type: "survey_history",
        brand_id: resolveBrand(brandLabel, ctx.brandMap), brand_label: brandLabel,
        platform_id: ctx.platMap.get(platLabel.toLowerCase()) || null, platform_label: platLabel,
        order_id: pick(row, "Order ID"),
        phone: normalisePhone(pick(row, "Phone Number", "Number", "Phone")),
        customer_name: pick(row, "Customer Name") || null,
        rate,
        product_feedback: recommending || null,
        served_by: pick(row, "Served By"),
        comment: comment || null,
        note: action || null,
        segment: pick(row, "Segment") || null,
        record_date: normaliseExcelDate(pick(row, "Order Date", "Date")),
        answered: reached || isAnswered(rate, recommending, comment),
        extra: {
          branch: branch || undefined,
          order_time: pick(row, "Order time") || undefined,
          completion_time: pick(row, "Completion time") || undefined,
          recommending: recommending || undefined,
          reachability: reach || undefined,
          action: action || undefined,
        },
      };
    },
  },
};

const canBuildTemplates = (role: string) => ["admin", "manager", "supervisor", "leader"].includes(role);
const isLeaderLevel = (role: string) => ["admin", "owner", "manager", "supervisor", "leader"].includes(role);

// ---- Templates ----
app.get("/api/survey-templates", authenticateJWT, asyncHandler(async (_req, res) => {
  res.json(await DB.getSurveyTemplates());
}));

app.get("/api/survey-templates/:id", authenticateJWT, asyncHandler(async (req, res) => {
  const t = await DB.getSurveyTemplateById(req.params.id);
  if (!t) return res.status(404).json({ error: "Template not found." });
  res.json(t);
}));

// Export data for a template: its questions + every recorded answer, for the
// frontend to pivot into one row per respondent / one column per question.
app.get("/api/survey-templates/:id/export", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (!canBuildTemplates(req.user.role)) return res.status(403).json({ error: "Access denied." });
  try {
    res.json(await DB.getTemplateExportRows(req.params.id));
  } catch (e: any) {
    res.status(404).json({ error: e.message || "Template not found." });
  }
}));

app.post("/api/survey-templates", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (!canBuildTemplates(req.user.role)) return res.status(403).json({ error: "Access denied." });
  const { name, brand_id, active, questions } = req.body;
  if (!name || !Array.isArray(questions) || questions.length === 0)
    return res.status(400).json({ error: "Name and at least one question are required." });
  const t = await DB.createSurveyTemplate({ name, brand_id: brand_id || null, created_by: req.user.id, active, questions });
  res.status(201).json(t);
}));

app.put("/api/survey-templates/:id", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (!canBuildTemplates(req.user.role)) return res.status(403).json({ error: "Access denied." });
  try {
    const t = await DB.updateSurveyTemplate(req.params.id, req.body);
    if (!t) return res.status(404).json({ error: "Template not found." });
    res.json(t);
  } catch (e: any) {
    // templateHasRecordedData guard throws a plain Error with a user-facing message.
    res.status(400).json({ error: e.message || "Failed to update template." });
  }
}));

// ---- Campaigns ----
app.get("/api/survey-campaigns", authenticateJWT, asyncHandler(async (_req, res) => {
  res.json(await DB.getSurveyCampaigns());
}));

app.get("/api/survey-campaigns/:id", authenticateJWT, asyncHandler(async (req, res) => {
  const c = await DB.getSurveyCampaignById(req.params.id);
  if (!c) return res.status(404).json({ error: "Campaign not found." });
  res.json(c);
}));

app.post("/api/survey-campaigns", authenticateJWT, asyncHandler(async (req: any, res) => {
  const cap = REQUEST_CAP[req.user.role];
  if (!cap) return res.status(403).json({ error: "You are not allowed to request campaigns." });
  const {
    brand_id, template_id, survey_type = "daily_normal", assignment_mode = "open",
    continuity_type = "one_time_slot", requested_count = 0, duration_days = 1, default_agent_id,
  } = req.body;
  if (Number(requested_count) > cap)
    return res.status(400).json({ error: `Requested count exceeds your cap of ${cap}.` });
  if (assignment_mode === "assigned" && !default_agent_id)
    return res.status(400).json({ error: "An agent must be selected for assigned mode." });
  const c = await DB.createSurveyCampaign({
    brand_id: brand_id || null, requested_by: req.user.id, requester_role: req.user.role,
    template_id: template_id || null, survey_type, assignment_mode, continuity_type,
    requested_count: Number(requested_count) || 0, duration_days: Number(duration_days) || 1,
    default_agent_id: assignment_mode === "assigned" ? default_agent_id : null,
  });
  res.status(201).json(c);
}));

app.patch("/api/survey-campaigns/:id", authenticateJWT, asyncHandler(async (req: any, res) => {
  const c = await DB.getSurveyCampaignById(req.params.id);
  if (!c) return res.status(404).json({ error: "Campaign not found." });
  const canManage = isLeaderLevel(req.user.role) || c.requested_by === req.user.id;
  if (!canManage) return res.status(403).json({ error: "Access denied." });
  const { status } = req.body;
  const valid = ["pending", "active", "full_today", "completed", "cancelled"];
  if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status." });
  res.json(await DB.setSurveyCampaignStatus(req.params.id, status));
}));

// Numbers upload template
app.get("/api/survey-campaigns/numbers/template", authenticateJWT, asyncHandler(async (_req, res) => {
  const ws = XLSX.utils.aoa_to_sheet([["Brand", "Customer Phone", "Segment"]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Numbers");
  res.json({ filename: "campaign_numbers_template.xlsx", file: XLSX.write(wb, { type: "base64", bookType: "xlsx" }) });
}));

// Upload numbers into a campaign (dedup + daily capacity)
app.post("/api/survey-campaigns/:id/numbers", authenticateJWT, asyncHandler(async (req: any, res) => {
  const campaign = await DB.getSurveyCampaignById(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Campaign not found." });
  if (["completed", "cancelled"].includes(campaign.status))
    return res.status(400).json({ error: "Campaign is closed." });
  const canManage = isLeaderLevel(req.user.role) || campaign.requested_by === req.user.id;
  if (!canManage) return res.status(403).json({ error: "Access denied." });

  const { file } = req.body;
  if (!file) return res.status(400).json({ error: "No file provided." });
  const wb = XLSX.read(Buffer.from(file, "base64"), { type: "buffer" });
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });

  const result = {
    total: rows.length, inserted: 0, duplicates_file: 0, duplicates_10day: 0, already_queued: 0,
    scheduled: [] as { date: string; count: number }[], first_date: "", today_full: false, daily_limit: DAILY_SURVEY_LIMIT,
    errors: [] as { row: number; message: string }[],
  };
  const seen = new Set<string>();
  const candidates: { phone: string; segment: string | null }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const phone = normalisePhone(pick(rows[i], "Customer Phone", "Phone", "Phone Number", "Mobile"));
    if (!phone) { result.errors.push({ row: i + 2, message: "Missing phone." }); continue; }
    if (seen.has(phone)) { result.duplicates_file++; continue; }
    seen.add(phone);
    if (await DB.wasRecentlyContacted(campaign.brand_id, phone, SURVEY_DEDUP_DAYS)) { result.duplicates_10day++; continue; }
    if (await DB.isPhoneQueued(campaign.brand_id, phone)) { result.already_queued++; continue; }
    const segment = pick(rows[i], "Segment", "Customer Segment") || null;
    candidates.push({ phone, segment });
  }

  // Distribute across days honouring the global daily capacity
  const today = await DB.getToday();
  const counts = await DB.getPendingCountsByDate();
  const assignedAgent = campaign.assignment_mode === "assigned" ? (campaign.default_agent_id || null) : null;
  const toInsert: { campaign_id: string; brand_id: string | null; customer_phone: string; assigned_agent_id: string | null; scheduled_date: string; segment: string | null }[] = [];
  let offset = 0;
  const byDay = new Map<string, number>();
  for (const cand of candidates) {
    let date = addDays(today, offset);
    while ((counts.get(date) || 0) >= DAILY_SURVEY_LIMIT) { offset++; date = addDays(today, offset); }
    counts.set(date, (counts.get(date) || 0) + 1);
    byDay.set(date, (byDay.get(date) || 0) + 1);
    toInsert.push({ campaign_id: campaign.id, brand_id: campaign.brand_id, customer_phone: cand.phone, assigned_agent_id: assignedAgent, scheduled_date: date, segment: cand.segment });
  }
  result.inserted = await DB.addSurveyAssignments(toInsert);
  result.scheduled = Array.from(byDay.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
  result.first_date = result.scheduled[0]?.date || "";
  // Today already at/over the limit → new numbers start on a later day (spec §5.2)
  result.today_full = candidates.length > 0 && (byDay.get(today) || 0) === 0;
  if (result.inserted > 0 && campaign.status === "pending") await DB.setSurveyCampaignStatus(campaign.id, "active");
  res.json(result);
}));

// Daily capacity for the next 7 days
app.get("/api/surveys/capacity", authenticateJWT, asyncHandler(async (_req, res) => {
  res.json(await DB.getDailyCapacity(7, DAILY_SURVEY_LIMIT));
}));

// Survey-capable agents
app.get("/api/surveys/agents", authenticateJWT, asyncHandler(async (_req, res) => {
  res.json(await DB.getSurveyAgents());
}));

// Survey agents with their current workload — lets whoever is assigning see how
// loaded each agent already is, instead of distributing blind.
app.get("/api/surveys/agents/workload", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (!isLeaderLevel(req.user.role)) return res.status(403).json({ error: "Access denied." });
  res.json(await DB.getSurveyAgentWorkload());
}));

// The current user's work queue for today
app.get("/api/surveys/queue", authenticateJWT, asyncHandler(async (req: any, res) => {
  const queue = await DB.getSurveyQueue(req.user.id);
  const todaySuccess = await DB.countTodaySuccess(req.user.id);
  res.json({ queue, todaySuccess, dailyLimit: DAILY_SURVEY_LIMIT });
}));

// Assignment detail (with template questions + attempts)
app.get("/api/surveys/assignments/:id", authenticateJWT, asyncHandler(async (req, res) => {
  const a = await DB.getSurveyAssignmentById(req.params.id);
  if (!a) return res.status(404).json({ error: "Assignment not found." });
  res.json(a);
}));

// Log a call attempt on an assignment (max 3)
app.post("/api/surveys/assignments/:id/attempt", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (req.user.role === "marketing") return res.status(403).json({ error: "Access denied." });
  const a = await DB.getSurveyAssignmentById(req.params.id);
  if (!a) return res.status(404).json({ error: "Assignment not found." });
  if ((a.attempt_count || 0) >= 3) return res.status(400).json({ error: "Maximum 3 attempts reached." });
  const { outcome, note } = req.body;
  if (!outcome) return res.status(400).json({ error: "Outcome is required." });
  const out = await DB.addSurveyAttempt({ assignment_id: req.params.id, agent_id: req.user.id, outcome, note });
  res.json(out);
}));

// Record an outcome: Reached + completed (with answers), Reached but declined
// (Refused to Complete / Not Interested — no answers needed), or Not Reached (No Action)
app.post("/api/surveys/assignments/:id/response", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (req.user.role === "marketing") return res.status(403).json({ error: "Access denied." });
  const a = await DB.getSurveyAssignmentById(req.params.id);
  if (!a) return res.status(404).json({ error: "Assignment not found." });
  const { answers, reachability, action_type, segment, outcome } = req.body;
  const notReached = reachability === "not_reached";
  const declined = !notReached && (outcome === "refused" || outcome === "not_interested");
  // Only a genuine completed survey requires actual answers — a customer who
  // refused or wasn't interested was reached, but has nothing to answer.
  if (!notReached && !declined) {
    if (!Array.isArray(answers) || answers.length === 0) return res.status(400).json({ error: "Answers are required." });
    const anyAnswered = answers.some((x: any) => x.answered && String(x.answer_value ?? "").trim() !== "");
    if (!anyAnswered) return res.status(400).json({ error: "At least one question must be answered." });
  }
  const updated = await DB.addSurveyResponse({
    assignment_id: req.params.id, agent_id: req.user.id,
    answers: (notReached || declined) ? [] : answers.map((x: any) => ({ question_id: x.question_id, answer_value: x.answer_value, answered: !!x.answered })),
    brand_id: a.brand_id, customer_phone: a.customer_phone,
    reachability: notReached ? "not_reached" : "reached",
    action_type: action_type === "complaint" ? "complaint" : "no_action",
    segment: segment || undefined,
    outcome: declined ? outcome : "completed",
  });
  res.json(updated);
}));

// View All Surveys — every assignment across campaigns, with filters (for reporting + supervision)
app.get("/api/surveys/all", authenticateJWT, asyncHandler(async (req: any, res) => {
  const { brand_id, agent_id, status, action_type, survey_type, segment, from, to } = req.query;
  res.json(await DB.getAllSurveyAssignments({
    brand_id: brand_id as string || undefined,
    agent_id: agent_id as string || undefined,
    status: status as string || undefined,
    action_type: action_type as string || undefined,
    survey_type: survey_type as string || undefined,
    segment: segment as string || undefined,
    from: from as string || undefined,
    to: to as string || undefined,
  }));
}));

// Survey overview: headline counts, per-survey breakdown and per-agent stats.
// Takes the same filters as /api/surveys/all so the numbers always match the list.
app.get("/api/surveys/overview", authenticateJWT, asyncHandler(async (req: any, res) => {
  const { brand_id, agent_id, status, action_type, survey_type, segment, from, to } = req.query;
  res.json(await DB.getSurveyOverview({
    brand_id: brand_id as string || undefined,
    agent_id: agent_id as string || undefined,
    status: status as string || undefined,
    action_type: action_type as string || undefined,
    survey_type: survey_type as string || undefined,
    segment: segment as string || undefined,
    from: from as string || undefined,
    to: to as string || undefined,
  }));
}));

// Manually assign / reassign / unassign a single survey to any active agent (supervisors+)
app.post("/api/surveys/assignments/:id/assign", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (!isLeaderLevel(req.user.role)) return res.status(403).json({ error: "Access denied." });
  const a = await DB.getSurveyAssignmentById(req.params.id);
  if (!a) return res.status(404).json({ error: "Assignment not found." });
  const { agent_id } = req.body;
  res.json(await DB.assignSurveyAssignment(req.params.id, agent_id || null));
}));

// Team-leader edit of a survey's outcome: change status/action, or send a
// finished survey back to Pending for rework.
app.patch("/api/surveys/assignments/:id", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (!isLeaderLevel(req.user.role)) return res.status(403).json({ error: "Access denied." });
  const a = await DB.getSurveyAssignmentById(req.params.id);
  if (!a) return res.status(404).json({ error: "Assignment not found." });
  const { status, action_type, reachability } = req.body;
  const validStatus = ["pending", "in_progress", "successful", "unreachable", "declined", "refused", "not_interested"];
  if (status !== undefined && !validStatus.includes(status))
    return res.status(400).json({ error: "Invalid status." });
  if (action_type !== undefined && !["no_action", "complaint"].includes(action_type))
    return res.status(400).json({ error: "Invalid action." });
  if (reachability !== undefined && !["reached", "not_reached"].includes(reachability))
    return res.status(400).json({ error: "Invalid reachability." });
  res.json(await DB.updateSurveyAssignment(req.params.id, { status, action_type, reachability }));
}));

// Campaign assignments + manual distribution
app.get("/api/surveys/campaigns/:id/assignments", authenticateJWT, asyncHandler(async (req, res) => {
  res.json(await DB.getCampaignAssignments(req.params.id));
}));

app.post("/api/surveys/campaigns/:id/assign", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (!isLeaderLevel(req.user.role)) return res.status(403).json({ error: "Access denied." });
  const { agent_id, count } = req.body;
  if (!agent_id || !count) return res.status(400).json({ error: "agent_id and count are required." });
  const n = await DB.assignCampaignNumbers(req.params.id, agent_id, Number(count));
  res.json({ assigned: n });
}));

// ---- Survey Records (uploaded results) ----
app.get("/api/survey-records/types", authenticateJWT, asyncHandler(async (_req, res) => {
  res.json(Object.entries(RECORD_TYPES).map(([key, v]) => ({ key, label: v.label, columns: v.columns })));
}));

app.get("/api/survey-records/:type/template", authenticateJWT, requireUpload, asyncHandler(async (req, res) => {
  const t = RECORD_TYPES[req.params.type];
  if (!t) return res.status(404).json({ error: "Unknown survey type." });
  const ws = XLSX.utils.aoa_to_sheet([t.columns]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Survey");
  res.json({ filename: `${req.params.type}_template.xlsx`, file: XLSX.write(wb, { type: "base64", bookType: "xlsx" }) });
}));

app.post("/api/survey-records/:type/upload", authenticateJWT, requireUpload, asyncHandler(async (req: any, res) => {
  const t = RECORD_TYPES[req.params.type];
  if (!t) return res.status(404).json({ error: "Unknown survey type." });
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: "No file provided." });

  const wb = XLSX.read(Buffer.from(file, "base64"), { type: "buffer" });
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const brands = await DB.getBrands();
  const platforms = await DB.getPlatforms();
  const ctx = {
    brandMap: new Map(brands.map((b) => [b.brand_name.toLowerCase(), b.id])),
    platMap: new Map(platforms.map((p) => [p.name.toLowerCase(), p.id])),
  };

  const result = { total: rows.length, inserted: 0, answered: 0, no_answer: 0, invalid: 0, errors: [] as { row: number; message: string }[] };
  const records: any[] = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const rec = t.map(rows[i], ctx);
      const hasData = rec.order_id || rec.phone || rec.item_name || rec.brand_label || rec.rate != null;
      if (!hasData) { result.invalid++; continue; }
      rec.uploaded_by = req.user.id;
      records.push(rec);
      if (rec.answered) result.answered++; else result.no_answer++;
    } catch (e: any) {
      result.errors.push({ row: i + 2, message: e.message || "Unknown error." });
    }
  }
  result.inserted = await DB.addSurveyRecords(records);
  res.json(result);
}));

app.get("/api/survey-records", authenticateJWT, asyncHandler(async (req: any, res) => {
  const { type, brand_id, answered, from, to, segment } = req.query;
  res.json(await DB.getSurveyRecords({
    record_type: type || undefined,
    brand_id: brand_id || undefined,
    answered: answered === "true" ? true : answered === "false" ? false : undefined,
    from: from || undefined,
    to: to || undefined,
    segment: segment || undefined,
  }));
}));

// Remove duplicate survey records (admin only)
app.post("/api/survey-records/dedupe", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Access denied." });
  const removed = await DB.dedupeSurveyRecords();
  res.json({ removed });
}));

// Delete survey records — all, or scoped by current filters (admin only)
app.post("/api/survey-records/delete", authenticateJWT, asyncHandler(async (req: any, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Access denied." });
  const { type, brand_id, answered, from, to } = req.body;
  const deleted = await DB.deleteSurveyRecords({
    record_type: type || undefined,
    brand_id: brand_id || undefined,
    answered: answered === true ? true : answered === false ? false : undefined,
    from: from || undefined,
    to: to || undefined,
  });
  res.json({ deleted });
}));

// ----------------------------------------------------
// Mounting Vite Server Middleware
// ----------------------------------------------------
async function startServer() {
  // Ensure database schema exists and is seeded before serving traffic
  await DB.init();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serving built production static assets
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[CRM Server] Running successfully on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("[CRM Server] Failed to start:", err);
  process.exit(1);
});
