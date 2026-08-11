import React, { useState, useEffect } from "react";
import { User, AssignedTask } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Inbox, RefreshCw, AlertCircle, Clock, CalendarClock, HandMetal, Loader2, Power } from "lucide-react";

interface Props { currentUser: User; shiftStatus: "on" | "off"; }

export default function TaskPool({ currentUser, shiftStatus }: Props) {
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState("");

  const fetchPool = async () => {
    try { setLoading(true); setError(""); const r = await apiFetch("/api/tasks/pool"); if (!r.ok) throw new Error("Failed to load."); setTasks(await r.json()); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { fetchPool(); }, []);

  const claim = async (t: AssignedTask) => {
    if (shiftStatus !== "on") { alert("You must be On Shift to pick up tasks."); return; }
    setClaiming(t.id);
    const r = await apiFetch(`/api/tasks/${t.id}/claim`, { method: "POST" });
    setClaiming("");
    if (r.ok) fetchPool(); else { const d = await r.json(); alert(d.error || "Failed to claim."); fetchPool(); }
  };

  const KW_MS = 3 * 60 * 60 * 1000;
  const fmt = (d?: string) => d ? new Date(new Date(d).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16) : "—";
  const prioBadge = (p?: string) => p === "High" ? "text-rose-400" : p === "Low" ? "text-[var(--muted)]" : "text-amber-400";

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-violet-500/10 text-violet-400 rounded-2xl"><Inbox className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Available Tasks</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">Pick up tasks for your team · {tasks.length} available</p>
          </div>
        </div>
        <button onClick={fetchPool} className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {shiftStatus !== "on" && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-3xl text-sm text-amber-400 flex items-center gap-2 font-bold">
          <Power className="w-5 h-5" /> You are Out of Shift — go On Shift (top bar) to pick up tasks.
        </div>
      )}
      {error && <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-7 h-7 animate-spin text-blue-500" /></div>
      ) : tasks.length === 0 ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-10 text-center text-[var(--muted)] text-sm">No available tasks right now. 🎉</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {tasks.map((t) => (
            <div key={t.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-5 shadow-lg space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-extrabold text-[var(--heading)]">{t.title}</h4>
                  {t.description && <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">{t.description}</p>}
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold shrink-0 bg-violet-500/10 text-violet-400 border border-violet-500/20">Available</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[var(--muted)]">
                <span className="flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> Due: {fmt(t.due_date)}</span>
                <span className={`font-bold ${prioBadge(t.priority)}`}>{t.priority}</span>
                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {fmt(t.created_at)}</span>
              </div>
              <div className="pt-2 border-t border-[var(--border)]/60">
                <button onClick={() => claim(t)} disabled={shiftStatus !== "on" || claiming === t.id} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-[11px] font-bold flex items-center gap-1.5 active:scale-95">
                  {claiming === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HandMetal className="w-3.5 h-3.5" />} Pick this task
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
