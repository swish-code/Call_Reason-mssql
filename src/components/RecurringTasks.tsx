import React, { useState, useEffect } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Repeat, Send, RefreshCw, AlertCircle, Trash2, Loader2, ChevronLeft, ChevronRight, Power, Users, Pencil, Save, X } from "lucide-react";

interface Props { currentUser: User; }

const DEPT_ACTIVITY_KEY: Record<string, string> = {
  "Call Center": "cc_activity",
  "Technical": "tech_activity",
  "Complaints": "complaint_activity",
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function firesOn(tpl: any, weekday: number): boolean {
  if (tpl.recurrence_type === "daily") return true;
  return String(tpl.days_of_week || "").split(",").map((d: string) => Number(d.trim())).includes(weekday);
}

export default function RecurringTasks({ currentUser }: Props) {
  const isAdmin = currentUser.role === "admin";
  const [templates, setTemplates] = useState<any[]>([]);
  const [taskTypes, setTaskTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formMsg, setFormMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string>("");

  // Form
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [department, setDepartment] = useState(isAdmin ? "Call Center" : (currentUser.department || "Call Center"));
  const [recurrence, setRecurrence] = useState("daily");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [dueTime, setDueTime] = useState("17:00");
  const [assignMode, setAssignMode] = useState("pool");
  const [priority, setPriority] = useState("Medium");

  // Calendar month nav (offset from current month)
  const now = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });

  const loadActivities = (dept: string) => {
    const key = DEPT_ACTIVITY_KEY[dept];
    if (!key) { setTaskTypes([]); return; }
    apiFetch(`/api/options/${key}`).then((r) => r.ok ? r.json() : []).then((o: any[]) => setTaskTypes(o.map((x) => x.label))).catch(() => setTaskTypes([]));
  };
  const fetchTemplates = async () => {
    try { setLoading(true); const r = await apiFetch("/api/recurring"); if (!r.ok) throw new Error("Failed to load."); setTemplates(await r.json()); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { fetchTemplates(); loadActivities(department); }, []);
  useEffect(() => { loadActivities(department); }, [department]);

  const toggleDay = (d: number) => setDays((p) => p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort());

  const resetForm = () => { setTitle(""); setDesc(""); setRecurrence("daily"); setDays([0, 1, 2, 3, 4]); setDueTime("17:00"); setAssignMode("pool"); setPriority("Medium"); setEditing(""); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormMsg("");
    if (!title.trim()) return setFormMsg("Please choose a task.");
    if (recurrence !== "daily" && days.length === 0) return setFormMsg("Please choose at least one day.");
    setSaving(true);
    const body = JSON.stringify({ title: title.trim(), description: desc, department, recurrence_type: recurrence, days_of_week: recurrence === "daily" ? null : days.join(","), due_time: dueTime, assign_mode: assignMode, priority });
    const r = editing
      ? await apiFetch(`/api/recurring/${editing}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body })
      : await apiFetch("/api/recurring", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    setSaving(false);
    if (r.ok) { resetForm(); fetchTemplates(); } else { const d = await r.json(); setFormMsg(d.error || "Failed."); }
  };

  const openEdit = (t: any) => {
    setEditing(t.id); setTitle(t.title); setDesc(t.description || ""); setDepartment(t.department); setRecurrence(t.recurrence_type);
    setDays(String(t.days_of_week || "").split(",").map(Number).filter((n) => !isNaN(n))); setDueTime(t.due_time || "17:00"); setAssignMode(t.assign_mode); setPriority(t.priority || "Medium");
    loadActivities(t.department);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const toggleActive = async (t: any) => { await apiFetch(`/api/recurring/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !t.active }) }); fetchTemplates(); };
  const remove = async (t: any) => { if (!confirm(`Delete recurring task "${t.title}"?`)) return; await apiFetch(`/api/recurring/${t.id}`, { method: "DELETE" }); fetchTemplates(); };

  const recurrenceLabel = (t: any) => t.recurrence_type === "daily" ? "Daily" : String(t.days_of_week || "").split(",").map((d: string) => DAYS[Number(d)]).join(", ");

  // Build calendar grid
  const first = new Date(ym.y, ym.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

  const inputCls = "w-full px-4 py-3 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition";

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-violet-500/10 text-violet-400 rounded-2xl"><Repeat className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Recurring Tasks</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">Daily / weekly tasks auto-generated for your team · {templates.length} template(s)</p>
          </div>
        </div>
        <button onClick={fetchTemplates} className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* Create / Edit form */}
      <form onSubmit={submit} className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-[var(--heading)]">{editing ? "Edit Recurring Task" : "New Recurring Task"}</h3>
          {editing && <button type="button" onClick={resetForm} className="text-xs text-[var(--muted)] hover:text-rose-400 flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel edit</button>}
        </div>
        {formMsg && <div className="text-xs text-rose-400 font-bold flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {formMsg}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isAdmin && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold">Department:</label>
              <select value={department} onChange={(e) => { setDepartment(e.target.value); setTitle(""); }} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
                {["Call Center", "Technical", "Complaints"].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-bold">Task:</label>
            <select value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
              <option value="">— Select a task —</option>
              {taskTypes.map((tt) => <option key={tt} value={tt}>{tt}</option>)}
              {title && !taskTypes.includes(title) && <option value={title}>{title}</option>}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold">Recurrence:</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
              <option value="daily">Daily</option>
              <option value="weekdays">Specific days</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold">Due time:</label>
            <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold">Assignment:</label>
            <select value={assignMode} onChange={(e) => setAssignMode(e.target.value)} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
              <option value="pool">Open pool (agents self-claim)</option>
              <option value="auto">Auto-assign (available agent)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold">Priority:</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls + " font-bold [&>option]:bg-[var(--surface)]"}>
              {["Low", "Medium", "High"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        {recurrence !== "daily" && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold">Days of week:</label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => (
                <button type="button" key={d} onClick={() => toggleDay(i)} className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition ${days.includes(i) ? "bg-blue-600 text-white border-blue-600" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)]"}`}>{d}</button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-xs font-bold">Description:</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Optional details..." className={inputCls + " leading-relaxed"} />
        </div>
        <button type="submit" disabled={saving} className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 text-white font-extrabold rounded-2xl text-sm transition flex items-center justify-center gap-2">
          {saving ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>) : editing ? (<><Save className="w-4 h-4" /> Save Changes</>) : (<><Send className="w-4 h-4" /> Create Recurring Task</>)}
        </button>
      </form>

      {error && <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>}

      {/* Calendar */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-5 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-[var(--heading)]">{MONTHS[ym.m]} {ym.y}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setYm((p) => { const d = new Date(p.y, p.m - 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })} className="p-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl hover:bg-[var(--surface-2)]"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })} className="px-3 py-2 text-[11px] font-bold bg-[var(--bg)] border border-[var(--border)] rounded-xl hover:bg-[var(--surface-2)]">Today</button>
            <button onClick={() => setYm((p) => { const d = new Date(p.y, p.m + 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })} className="p-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl hover:bg-[var(--surface-2)]"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {DAYS.map((d) => <div key={d} className="text-center text-[10px] font-extrabold text-[var(--muted)] uppercase py-1">{d}</div>)}
          {cells.map((d, idx) => {
            if (d === null) return <div key={idx} />;
            const weekday = new Date(ym.y, ym.m, d).getDay();
            const todays = templates.filter((t) => t.active && firesOn(t, weekday));
            const isToday = `${ym.y}-${ym.m}-${d}` === todayKey;
            return (
              <div key={idx} className={`min-h-[68px] rounded-xl border p-1.5 text-left ${isToday ? "border-blue-500 bg-blue-500/5" : "border-[var(--border)] bg-[var(--bg)]"}`}>
                <div className={`text-[11px] font-bold mb-1 ${isToday ? "text-blue-400" : "text-[var(--muted)]"}`}>{d}</div>
                <div className="space-y-0.5">
                  {todays.slice(0, 3).map((t) => (
                    <div key={t.id} className={`text-[9px] font-bold px-1 py-0.5 rounded truncate ${t.assign_mode === "auto" ? "bg-emerald-500/15 text-emerald-400" : "bg-violet-500/15 text-violet-400"}`} title={`${t.title} · ${t.department}`}>{t.title}</div>
                  ))}
                  {todays.length > 3 && <div className="text-[9px] text-[var(--muted)] px-1">+{todays.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3 text-[10px] text-[var(--muted)]">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-violet-500/40"></span> Pool</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-500/40"></span> Auto-assign</span>
        </div>
      </div>

      {/* Templates list */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-7 h-7 animate-spin text-blue-500" /></div>
      ) : templates.length === 0 ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-10 text-center text-[var(--muted)] text-sm">No recurring tasks yet.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {templates.map((t) => (
            <div key={t.id} className={`bg-[var(--surface)] border rounded-3xl p-5 shadow-lg space-y-2 ${t.active ? "border-[var(--border)]" : "border-[var(--border)] opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-extrabold text-[var(--heading)]">{t.title}</h4>
                  {t.description && <p className="text-xs text-[var(--muted)] mt-1">{t.description}</p>}
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold shrink-0 ${t.assign_mode === "auto" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-violet-500/10 text-violet-400 border border-violet-500/20"}`}>{t.assign_mode === "auto" ? "Auto" : "Pool"}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
                <span className="flex items-center gap-1"><Repeat className="w-3.5 h-3.5" /> {recurrenceLabel(t)}</span>
                {t.due_time && <span>Due {t.due_time}</span>}
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {t.department}</span>
                <span className={`font-bold ${t.priority === "High" ? "text-rose-400" : t.priority === "Low" ? "" : "text-amber-400"}`}>{t.priority}</span>
              </div>
              <div className="flex items-center gap-1.5 pt-2 border-t border-[var(--border)]/60">
                <button onClick={() => toggleActive(t)} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 ${t.active ? "bg-emerald-500/10 text-emerald-400" : "bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)]"}`}><Power className="w-3.5 h-3.5" /> {t.active ? "Active" : "Paused"}</button>
                <button onClick={() => openEdit(t)} className="p-1.5 text-[var(--muted)] hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition ml-auto" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => remove(t)} className="p-1.5 text-[var(--muted)] hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
