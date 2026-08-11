import React, { useState, useEffect } from "react";
import { User, AssignedTask } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { ClipboardCheck, Send, RefreshCw, AlertCircle, Trash2, Clock, User as UserIcon, CalendarClock, Loader2, Check, Pencil, Save, X, StickyNote } from "lucide-react";

type TaskMode = "assign" | "tracker" | "mine";

interface TasksProps {
  currentUser: User;
  onSeen?: () => void;
  mode?: TaskMode;
}

// Each department's task options come from its own activity list
const DEPT_ACTIVITY_KEY: Record<string, string> = {
  "Call Center": "cc_activity",
  "Technical": "tech_activity",
  "Complaints": "complaint_activity",
  "Quality": "quality_activity",
};

export default function Tasks({ currentUser, onSeen, mode }: TasksProps) {
  const isAgent = currentUser.role === "agent";
  const view: TaskMode = mode || (isAgent ? "mine" : "assign");
  const isManager = view !== "mine"; // assign / tracker are the management views
  // Management (no fixed department) resolves task activities from the chosen assignee
  const orgWide = !currentUser.department;

  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [agents, setAgents] = useState<{ id: string; full_name: string; department?: string; job_title?: string }[]>([]);
  const [taskTypes, setTaskTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form (managers, assign view)
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [requireTimeEntry, setRequireTimeEntry] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formMsg, setFormMsg] = useState("");

  const fetchTasks = async () => {
    try {
      setLoading(true); setError("");
      const res = await apiFetch(view === "mine" ? "/api/tasks/mine" : "/api/tasks");
      if (!res.ok) throw new Error("Failed to load tasks.");
      setTasks(await res.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const loadActivities = (dept?: string) => {
    const key = DEPT_ACTIVITY_KEY[dept || ""];
    if (!key) { setTaskTypes([]); return; }
    apiFetch(`/api/options/${key}`).then((r) => r.ok ? r.json() : []).then((opts: any[]) => setTaskTypes(opts.map((o) => o.label))).catch(() => setTaskTypes([]));
  };

  useEffect(() => {
    fetchTasks();
    if (isManager) {
      apiFetch("/api/tasks/agents").then((r) => r.ok ? r.json() : []).then(setAgents).catch(() => {});
      // Department-scoped managers load their own activities; org-wide managers
      // default to Call Center tasks and refine to the chosen assignee's department.
      loadActivities(currentUser.department || "Call Center");
    } else {
      // My Tasks: clear the unseen notifications
      apiFetch("/api/tasks/mark-seen", { method: "POST" }).then(() => onSeen && onSeen()).catch(() => {});
    }
  }, []);

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormMsg("");
    if (!title.trim()) return setFormMsg("Please choose a task.");
    if (!assignTo) return setFormMsg("Please choose an agent.");
    setSaving(true);
    const res = await apiFetch("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), description: desc, assigned_to: assignTo, due_date: due || undefined, priority, require_time_entry: requireTimeEntry }),
    });
    setSaving(false);
    if (res.ok) { setTitle(""); setDesc(""); setAssignTo(""); setDue(""); setPriority("Medium"); setRequireTimeEntry(true); setFormMsg(""); }
    else { const d = await res.json(); setFormMsg(d.error || "Failed to assign task."); }
  };

  // ---- Agent: progress / complete ----
  const [timeInputs, setTimeInputs] = useState<Record<string, string>>({});
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  const setStatus = async (t: AssignedTask, status: string) => {
    const res = await apiFetch(`/api/tasks/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (res.ok) fetchTasks();
  };
  const complete = async (t: AssignedTask) => {
    const m = timeInputs[t.id];
    if (t.require_time_entry !== false && (!m || Number(m) <= 0)) { alert("Please enter the time spent (minutes) before completing the task."); return; }
    // Early-completion warning: due date not reached yet
    if (t.due_date && new Date(t.due_date).getTime() > Date.now()) {
      if (!confirm(`This task is not due yet (Due: ${fmt(t.due_date)}). Are you sure you want to complete it now?`)) return;
    }
    const res = await apiFetch(`/api/tasks/${t.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Completed", duration_seconds: Math.round(Number(m) * 60), note: (noteInputs[t.id] || "").trim() }),
    });
    if (res.ok) fetchTasks(); else { const d = await res.json(); alert(d.error || "Failed."); }
  };

  // ---- Manager: edit / delete ----
  const [editing, setEditing] = useState<string>("");
  const [ed, setEd] = useState<{ title: string; assigned_to: string; due: string; priority: string; desc: string }>({ title: "", assigned_to: "", due: "", priority: "Medium", desc: "" });

  const openEdit = (t: AssignedTask) => {
    setEditing(t.id);
    setEd({ title: t.title, assigned_to: t.assigned_to, due: t.due_date ? t.due_date.slice(0, 16) : "", priority: t.priority || "Medium", desc: t.description || "" });
    if (currentUser.role === "admin") loadActivities(t.department);
  };
  const saveEdit = async (t: AssignedTask) => {
    const res = await apiFetch(`/api/tasks/${t.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: ed.title, description: ed.desc, due_date: ed.due || undefined, priority: ed.priority, assigned_to: ed.assigned_to }),
    });
    if (res.ok) { setEditing(""); fetchTasks(); } else { const d = await res.json(); alert(d.error || "Failed to update task."); }
  };
  const remove = async (t: AssignedTask) => {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    const res = await apiFetch(`/api/tasks/${t.id}`, { method: "DELETE" });
    if (res.ok) fetchTasks();
  };

  const fmtDur = (s?: number) => { const x = Number(s || 0); if (!x) return "—"; const h = Math.floor(x / 3600), m = Math.round((x % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
  const statusBadge = (s: string) => s === "Completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
    : s === "In Progress" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
    : s === "Available" ? "bg-violet-500/10 text-violet-400 border border-violet-500/20"
    : "bg-blue-500/10 text-blue-400 border border-blue-500/20";
  const prioBadge = (p?: string) => p === "High" ? "text-rose-400" : p === "Low" ? "text-[var(--muted)]" : "text-amber-400";
  const KW_MS = 3 * 60 * 60 * 1000;
  const fmt = (d?: string) => d ? new Date(new Date(d).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16) : "—";
  const overdue = (t: AssignedTask) => t.due_date && t.status !== "Completed" && new Date(t.due_date).getTime() < Date.now();
  const inputCls = "w-full px-4 py-3 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition";
  const smallCls = "px-2.5 py-1.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-lg text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500 [&>option]:bg-[var(--surface)]";

  // My Tasks: only active tasks (completed move to My Logs). Manager tracker: all.
  const visibleTasks = view === "mine" ? tasks.filter((t) => t.status !== "Completed") : tasks;
  // Employees eligible for reassign = subordinates in the edited task's department
  const editDept = tasks.find((t) => t.id === editing)?.department;
  const editAgents = editDept ? agents.filter((a) => a.department === editDept) : agents;

  const headerTitle = view === "assign" ? "Assign Tasks" : view === "tracker" ? "Task Tracker" : "My Tasks";
  const headerSub = view === "assign" ? "Create tasks for your team." : view === "tracker" ? "Track and manage your team's tasks." : "Tasks assigned to you.";

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl"><ClipboardCheck className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">{headerTitle}</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">{headerSub}{view !== "assign" ? ` · ${visibleTasks.length} task(s)` : ""}</p>
          </div>
        </div>
        <button onClick={fetchTasks} className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* Create form — assign view only */}
      {view === "assign" && (
        <form onSubmit={createTask} className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-lg space-y-4">
          <h3 className="text-sm font-extrabold text-[var(--heading)]">New Task</h3>
          {formMsg && <div className="text-xs text-rose-400 font-bold flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {formMsg}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text)]">Assign To (employee):</label>
              <select value={assignTo} onChange={(e) => { const v = e.target.value; setAssignTo(v); if (orgWide) { setTitle(""); loadActivities(agents.find((x) => x.id === v)?.department); } }} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
                <option value="">— Select employee —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}{a.job_title ? ` — ${a.job_title}` : ""}{a.department ? ` (${a.department})` : ""}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text)]">Task:</label>
              <select value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
                <option value="">— Select a task —</option>
                {taskTypes.map((tt) => <option key={tt} value={tt}>{tt}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text)]">Due Date &amp; Time:</label>
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text)]">Priority:</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
                {["Low", "Medium", "High"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[var(--text)]">Description:</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Task details..." className={inputCls + " leading-relaxed"} />
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={requireTimeEntry} onChange={(e) => setRequireTimeEntry(e.target.checked)} className="w-4 h-4 accent-blue-500 rounded" />
            <span className="text-xs font-bold text-[var(--text)]">Require agent to enter time spent when completing this task</span>
          </label>
          <button type="submit" disabled={saving} className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 text-white font-extrabold rounded-2xl text-sm transition flex items-center justify-center gap-2">
            {saving ? (<><Loader2 className="w-4 h-4 animate-spin" /> Assigning...</>) : (<><Send className="w-4 h-4" /> Assign Task</>)}
          </button>
        </form>
      )}

      {error && <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>}

      {/* Tasks list — tracker (managers) & agent views */}
      {view !== "assign" && (
        loading ? (
          <div className="flex flex-col items-center justify-center min-h-[160px]"><div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>
        ) : visibleTasks.length === 0 ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-10 text-center text-[var(--muted)] text-sm">{view === "mine" ? "No tasks assigned to you yet." : "No tasks yet."}</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visibleTasks.map((t) => (
              <div key={t.id} className={`bg-[var(--surface)] border rounded-3xl p-5 shadow-lg space-y-3 ${overdue(t) ? "border-rose-500/40" : "border-[var(--border)]"}`}>
                {editing === t.id ? (
                  /* ---- Manager edit form ---- */
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <select value={ed.title} onChange={(e) => setEd((p) => ({ ...p, title: e.target.value }))} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
                        <option value="">— Select a task —</option>
                        {taskTypes.map((tt) => <option key={tt} value={tt}>{tt}</option>)}
                        {ed.title && !taskTypes.includes(ed.title) && <option value={ed.title}>{ed.title}</option>}
                      </select>
                      <select value={ed.assigned_to} onChange={(e) => setEd((p) => ({ ...p, assigned_to: e.target.value }))} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
                        {editAgents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                      </select>
                      <input type="datetime-local" value={ed.due} onChange={(e) => setEd((p) => ({ ...p, due: e.target.value }))} className={inputCls} />
                      <select value={ed.priority} onChange={(e) => setEd((p) => ({ ...p, priority: e.target.value }))} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
                        {["Low", "Medium", "High"].map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <textarea value={ed.desc} onChange={(e) => setEd((p) => ({ ...p, desc: e.target.value }))} rows={2} placeholder="Description..." className={inputCls} />
                    <div className="flex items-center gap-2">
                      <button onClick={() => saveEdit(t)} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-bold flex items-center gap-1 active:scale-95"><Save className="w-3.5 h-3.5" /> Save</button>
                      <button onClick={() => setEditing("")} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded-xl text-[11px] font-bold flex items-center gap-1 active:scale-95"><X className="w-3.5 h-3.5" /> Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-extrabold text-[var(--heading)]">{t.title}</h4>
                        {t.description && <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">{t.description}</p>}
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold shrink-0 ${statusBadge(t.status)}`}>{t.status}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[var(--muted)]">
                      {isManager ? (
                        <span className="flex items-center gap-1"><UserIcon className="w-3.5 h-3.5" /> {t.assigned_to_name || "Unassigned (Pool)"}</span>
                      ) : (
                        <span className="flex items-center gap-1"><UserIcon className="w-3.5 h-3.5" /> by {t.assigned_by_name}</span>
                      )}
                      <span className={`flex items-center gap-1 ${overdue(t) ? "text-rose-400 font-bold" : ""}`}><CalendarClock className="w-3.5 h-3.5" /> Due: {fmt(t.due_date)}{overdue(t) ? " (overdue)" : ""}</span>
                      <span className={`font-bold ${prioBadge(t.priority)}`}>{t.priority}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {fmt(t.created_at)}</span>
                    </div>
                    {/* Completion note (shown to managers in tracker) */}
                    {isManager && t.note && <p className="text-[11px] text-[var(--text)] bg-[var(--bg)] border border-[var(--border)] rounded-xl px-3 py-2 flex items-start gap-1.5"><StickyNote className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" /> {t.note}</p>}

                    <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]/60 gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Assignee: progress + complete with time & note */}
                        {view === "mine" && t.status !== "Completed" && (
                          <>
                            <select value={t.status} onChange={(e) => e.target.value !== "Completed" && setStatus(t, e.target.value)} className={smallCls + " font-bold"}>
                              <option value="New">New</option>
                              <option value="In Progress">In Progress</option>
                            </select>
                            {t.require_time_entry !== false && (
                              <input type="number" min={1} value={timeInputs[t.id] || ""} onChange={(e) => setTimeInputs((p) => ({ ...p, [t.id]: e.target.value }))} placeholder="min" className={smallCls + " w-16"} title="Time spent (minutes)" />
                            )}
                            <input type="text" value={noteInputs[t.id] || ""} onChange={(e) => setNoteInputs((p) => ({ ...p, [t.id]: e.target.value }))} placeholder="Note (optional)" className={smallCls + " w-40"} title="Completion note" />
                            <button onClick={() => complete(t)} className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 active:scale-95"><Check className="w-3.5 h-3.5" /> Complete</button>
                          </>
                        )}
                        {t.status === "Completed" && <span className="text-[11px] text-emerald-400 font-bold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Done · {fmtDur(t.duration_seconds)}</span>}
                      </div>
                      {/* Manager (tracker): edit + delete (creator/admin), no complete */}
                      {view === "tracker" && (currentUser.role === "admin" || t.assigned_by === currentUser.id) && (
                        <div className="flex items-center gap-1">
                          {t.status !== "Completed" && <button onClick={() => openEdit(t)} className="p-1.5 text-[var(--muted)] hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>}
                          <button onClick={() => remove(t)} className="p-1.5 text-[var(--muted)] hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
