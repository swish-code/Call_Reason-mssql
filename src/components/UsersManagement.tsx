import React, { useState, useEffect } from "react";
import { User, USER_TYPES, UserType, roleDefaultLevel } from "../types.js";
import { apiFetch } from "../lib/api.ts";

// Map a stored user back to its account-type label (for the edit form)
const userTypeLabel = (u: User): string => {
  if (u.job_title) return u.job_title;
  const m = USER_TYPES.find((t) => t.role === u.role && (t.department || null) === (u.department || null));
  return m ? m.label : "Call Center Agent";
};

// Resolve an account-type label to the fields the API expects
const resolveUserType = (label: string): { role: string; department: string | null; level: number; job_title: string; team: string } => {
  const t: UserType = USER_TYPES.find((x) => x.label === label) || USER_TYPES[0];
  const team = t.role === "leader" ? "Team Leader" : t.department === "Complaints" ? "Complain Team" : t.department === "Technical" ? "Technical Team" : "Call Center";
  return { role: t.role, department: t.department, level: t.level, job_title: t.label, team };
};
import { 
  User as UserIcon, 
  Plus, 
  Trash2, 
  Edit, 
  Lock, 
  UserCheck, 
  UserX,
  X, 
  Shield, 
  Save, 
  Key,
  FileCheck2,
  Download
} from "lucide-react";

interface UsersManagementProps {
  currentUser: User;
}

export default function UsersManagement({ currentUser }: UsersManagementProps) {
  const isAdmin = currentUser.role === "admin";
  const myLevel = currentUser.level ?? roleDefaultLevel(currentUser.role);
  // Managers can only create users at levels below their own
  const creatableTypes = isAdmin ? USER_TYPES : USER_TYPES.filter((t) => t.level < myLevel);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Create/Edit states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [userType, setUserType] = useState<string>("Call Center Agent");
  const [status, setStatus] = useState<"Active" | "Inactive">("Active");

  // Reset password states
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/api/users");
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to load users roster checklist.");
      }
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleOpenAdd = () => {
    setEditingUser(null);
    setFullName("");
    setUsername("");
    setPassword("");
    setUserType("Call Center Agent");
    setStatus("Active");
    setError("");
    setIsModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setFullName(user.full_name || user.name || "");
    setUsername(user.username);
    setPassword(""); // don't fill password
    setUserType(userTypeLabel(user));
    setStatus(user.status || "Active");
    setError("");
    setIsModalOpen(true);
  };

  const handleOpenReset = (user: User) => {
    setResettingUser(user);
    setNewPassword("");
    setError("");
    setIsResetOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    const { role, department, level, job_title, team } = resolveUserType(userType);
    const payload = {
      full_name: fullName,
      username,
      role,
      level,
      job_title,
      team,
      department,
      status,
      ...(password && { password })
    };

    try {
      let res;
      if (editingUser) {
        res = await apiFetch(`/api/users/${editingUser.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        if (!password) {
          setError("A primary password is required for new users.");
          return;
        }
        res = await apiFetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, password })
        });
      }

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "An unexpected database execution error occurred.");
      }

      setSuccessMsg(editingUser ? "Account settings modified successfully." : "User record created successfully.");
      setIsModalOpen(false);
      fetchUsers();
      
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.trim() === "") {
      setError("Please specify a valid, secure password.");
      return;
    }

    try {
      setError("");
      const res = await apiFetch(`/api/users/${resettingUser?.id}/reset-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to modify pass-credentials.");
      }

      setSuccessMsg(`Password reset completed successfully for user: ${resettingUser?.username}.`);
      setIsResetOpen(false);
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to permanently delete user account "${name}"?`)) {
      return;
    }

    try {
      setError("");
      setSuccessMsg("");
      const res = await apiFetch(`/api/users/${id}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to drop the user record.");
      }

      setSuccessMsg("User repository record dropped successfully.");
      fetchUsers();
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const getRoleBadgeColor = (r: string) => {
    if (r === "admin") return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    if (r === "owner") return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    if (r === "manager") return "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20";
    if (r === "leader") return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    if (r === "supervisor") return "bg-purple-500/10 text-purple-400 border border-purple-500/20";
    return "bg-blue-500/10 text-blue-400 border border-blue-500/20";
  };

  // Export the roster to CSV — all users, or Call Center agents only
  const exportCsv = (ccAgentsOnly: boolean) => {
    const list = ccAgentsOnly
      ? users.filter((u) => u.role === "agent" && (u.department || "") === "Call Center")
      : users;
    const headers = ["Full Name", "Username", "Account Type", "Role", "Department", "Status"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = list.map((u) => [u.full_name || u.name || "", u.username || "", userTypeLabel(u), u.role, u.department || "", u.status].map(esc).join(","));
    const csv = "﻿" + [headers.map(esc).join(","), ...rows].join("\r\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `${ccAgentsOnly ? "call_center_agents" : "users"}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6 font-sans select-none animate-fadeIn" id="users-management-root">
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[var(--heading)] flex items-center gap-3">
            <Shield className="w-6 h-6 text-blue-500" />
            User Directory & Access Authorization
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            Provision employee profiles, define security clearance ranks, suspend/activate records, and enforce credential resets.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => exportCsv(true)}
            title="Export Call Center agents to CSV"
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Export CC Agents
          </button>
          <button
            onClick={() => exportCsv(false)}
            title="Export all users to CSV"
            className="px-4 py-2.5 bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] font-bold rounded-xl text-xs transition flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Export All
          </button>
          <button
            onClick={handleOpenAdd}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition duration-150 flex items-center gap-2 shadow-lg shadow-blue-900/10"
          >
            <Plus className="w-4 h-4" />
            Create New User
          </button>
        </div>
      </div>

      {/* Notifications banner */}
      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-xs text-emerald-400 font-bold flex items-center gap-2">
          <FileCheck2 className="w-5 h-5" />
          <p>{successMsg}</p>
        </div>
      )}

      {error && !isModalOpen && !isResetOpen && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-xs text-rose-400 font-bold flex items-center gap-2 animate-pulse">
          <X className="w-5 h-5" />
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-12 text-center text-[var(--muted)] text-xs font-medium space-y-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p>Fetching security roster records...</p>
        </div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/50">
                  <th className="px-6 py-4 text-xs font-bold text-[var(--muted)]">Legal Identity</th>
                  <th className="px-6 py-4 text-xs font-bold text-[var(--muted)]">Username</th>
                  <th className="px-6 py-4 text-xs font-bold text-[var(--muted)]">Email Address</th>
                  <th className="px-6 py-4 text-xs font-bold text-[var(--muted)]">System Role</th>
                  <th className="px-6 py-4 text-xs font-bold text-[var(--muted)]">Access Status</th>
                  <th className="px-6 py-4 text-xs font-bold text-[var(--muted)] text-center">Administrative Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/40">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-[var(--surface-2)]/20 transition duration-100">
                    <td className="px-6 py-4 text-xs font-medium text-[var(--heading)] flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-bold shrink-0">
                        {(user.full_name || user.name || "?").substring(0, 2)}
                      </div>
                      <div>
                        <div className="font-bold text-[var(--heading)]">{user.full_name || user.name}</div>
                        <div className="text-[10px] text-[var(--muted)] mt-0.5">UID: {user.id}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-[var(--text)] font-mono" dir="ltr">{user.username}</td>
                    <td className="px-6 py-4 text-xs text-[var(--text)] font-mono" dir="ltr">{user.email}</td>
                    <td className="px-6 py-4 text-xs">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${getRoleBadgeColor(user.role)}`}>
                        {userTypeLabel(user)}
                      </span>
                      {user.department && <div className="text-[10px] text-blue-400 mt-1 font-bold">{user.department}</div>}
                    </td>
                    <td className="px-6 py-4 text-xs">
                      {user.status === "Inactive" ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--border)] flex items-center gap-1 w-max">
                          <UserX className="w-3 h-3" />
                          Inactive
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-max">
                          <UserCheck className="w-3 h-3" />
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs">
                      <div className="flex items-center justify-center gap-2">
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => handleOpenEdit(user)}
                              className="p-1 px-2.5 py-1.5 bg-[var(--surface-2)] hover:bg-zinc-700 text-[var(--text)] border border-[var(--border)] rounded-lg transition text-xs flex items-center gap-1"
                              title="Modify Profile"
                            >
                              <Edit className="w-3.5 h-3.5" />
                              Edit
                            </button>

                            <button
                              onClick={() => handleOpenReset(user)}
                              className="p-1 px-2.5 py-1.5 bg-[var(--surface-2)] hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/20 text-[var(--text)] border border-[var(--border)] rounded-lg transition text-xs flex items-center gap-1"
                              title="Reset Credentials"
                            >
                              <Key className="w-3.5 h-3.5" />
                              Password
                            </button>

                            <button
                              onClick={() => handleDeleteUser(user.id, user.username)}
                              disabled={user.id === currentUser.id}
                              className="p-1 px-2.5 py-1.5 bg-[var(--surface-2)] hover:bg-rose-500/10 text-[var(--text)] hover:text-rose-400 hover:border-rose-500/20 border border-[var(--border)] rounded-lg transition text-xs flex items-center gap-1 disabled:opacity-30 disabled:pointer-events-none"
                              title="Permanently Drop Record"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          </>
                        )}
                        {!isAdmin && <span className="text-[10px] text-[var(--muted)]">View only</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREATE & EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-2xl relative p-6 space-y-4">
            
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h3 className="text-sm font-bold text-[var(--heading)]">
                {editingUser ? `Edit Profile: ${editingUser.username}` : "Create New User Account"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1.5 hover:bg-[var(--surface-2)] text-[var(--muted)] rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 font-bold flex items-center gap-2">
                <X className="w-4 h-4 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={handleSaveUser} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[var(--muted)] block">Full Legal Name:</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full px-3 py-2 bg-[var(--surface-2)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[var(--muted)] block">Username:</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="sales_agent"
                  className="w-full px-3 py-2 bg-[var(--surface-2)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono text-left"
                  dir="ltr"
                />
              </div>

              {!editingUser && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[var(--muted)] block">Default Password:</label>
                  <input
                    type="password"
                    required={!editingUser}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 bg-[var(--surface-2)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-left"
                    dir="ltr"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[var(--muted)] block">User Type:</label>
                <select
                  value={userType}
                  onChange={(e) => setUserType(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--surface-2)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                >
                  {creatableTypes.map((t) => (<option key={t.label} value={t.label}>{t.label}</option>))}
                </select>
              </div>

              {isAdmin && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[var(--muted)] block">Status:</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as "Active" | "Inactive")}
                    className="w-full px-3 py-2 bg-[var(--surface-2)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              )}

              <div className="pt-4 border-t border-[var(--border)] flex items-center justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-[var(--surface-2)] hover:bg-zinc-700 text-[var(--text)] rounded-xl transition font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {isResetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans">
          <div className="w-full max-w-sm bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-2xl relative p-6 space-y-4">
            
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h3 className="text-sm font-bold text-[var(--heading)] flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                Change Password credentials: {resettingUser?.username}
              </h3>
              <button onClick={() => setIsResetOpen(false)} className="p-1.5 hover:bg-[var(--surface-2)] text-[var(--muted)] rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 font-bold flex items-center gap-2">
                <X className="w-4 h-4 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[var(--muted)] block">Specified Pass-Credential:</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Type a highly secure complex phrase"
                  className="w-full px-3 py-2.5 bg-[var(--surface-2)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-left"
                  dir="ltr"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setIsResetOpen(false)}
                  className="px-4 py-2 bg-[var(--surface-2)] hover:bg-zinc-700 text-[var(--text)] rounded-xl transition font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-[#0f0f10] font-extrabold rounded-xl transition"
                >
                  Enforce Reset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
