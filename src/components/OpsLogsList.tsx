import { useState, useEffect } from "react";
import { User, OpsLog, LogType, LOG_TYPE_CONFIG } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { ClipboardList, RefreshCw, Download, Search, Pencil, Trash2, X, AlertCircle, Timer, CheckCircle2 } from "lucide-react";
import OpsLogForm from "./OpsLogForm.tsx";

interface OpsLogsListProps {
  currentUser: User;
}

export default function OpsLogsList({ currentUser }: OpsLogsListProps) {
  const [logs, setLogs] = useState<OpsLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [editLog, setEditLog] = useState<OpsLog | null>(null);
  // Owner progress update (status + time) for Open/In Progress tasks
  const [progressLog, setProgressLog] = useState<OpsLog | null>(null);
  const [pStatus, setPStatus] = useState("");
  const [pMinutes, setPMinutes] = useState("");
  const [pSaving, setPSaving] = useState(false);

  // Pagination — easily tunable; change PAGE_SIZE to adjust rows per page
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);

  const isAgent = currentUser.role === "agent";
  // Only cross-department roles can pick a log type; department-scoped users (agents,
  // team leaders, supervisors) only ever see their own department's single log type.
  const canFilterType = ["admin", "manager", "owner"].includes(currentUser.role);

  // Editable while not in a final state. Complaint logs use Not Solved / Waiting Feedback as in-progress.
  const canProgress = (l: OpsLog) => l.agent_id === currentUser.id && ["Open", "In Progress", "Not Solved", "Waiting Feedback"].includes(l.status || "");
  // Status options offered in the modal depend on the log type
  const progressStatusOptions = (l: OpsLog | null) =>
    l && l.log_type === "complaint" ? ["Not Solved", "Waiting Feedback", "Solved"] : ["Open", "In Progress", "Completed"];
  const isFinalStatus = (s: string) => ["Completed", "Solved"].includes(s);
  const openProgress = (l: OpsLog) => {
    setProgressLog(l);
    setPStatus(l.status || progressStatusOptions(l)[0]);
    setPMinutes(l.duration_seconds ? String(Math.round(l.duration_seconds / 60)) : "");
  };
  const saveProgress = async () => {
    if (!progressLog) return;
    if (isFinalStatus(pStatus) && (!pMinutes || Number(pMinutes) <= 0)) {
      alert("Please enter the time spent before completing the task.");
      return;
    }
    setPSaving(true);
    const res = await apiFetch(`/api/logs/${progressLog.id}/progress`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: pStatus, duration_seconds: pMinutes ? Math.max(0, Math.round(Number(pMinutes) * 60)) : 0 }),
    });
    setPSaving(false);
    if (res.ok) { setProgressLog(null); fetchLogs(); } else { const d = await res.json(); alert(d.error || "Update failed."); }
  };

  const elapsedSeconds = (l: OpsLog) => Number(l.duration_seconds || 0);
  // Quality daily log: average review minutes per call (null if not applicable)
  const avgPerCall = (l: OpsLog): number | null =>
    (l.calls_reviewed && l.calls_reviewed > 0) ? elapsedSeconds(l) / 60 / l.calls_reviewed : null;
  const fmtDur = (s: number) => {
    if (!s) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const fetchLogs = async () => {
    try {
      setLoading(true); setError("");
      const res = await apiFetch("/api/logs");
      if (!res.ok) throw new Error("Failed to load logs.");
      setLogs(await res.json());
    } catch (err: any) {
      setError(err.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  // Agent names filtered by selected log type (or all if no type selected)
  const agentNames = Array.from(
    new Set((typeFilter ? logs.filter((l) => l.log_type === typeFilter) : logs).map((l) => l.agent_name).filter(Boolean))
  ).sort() as string[];

  const q = search.trim().toLowerCase();
  const filtered = logs.filter((l) => {
    if (typeFilter && l.log_type !== typeFilter) return false;
    if (statusFilter && l.status !== statusFilter) return false;
    if (agentFilter && l.agent_name !== agentFilter) return false;
    if (q) {
      const hay = [l.activity_type, l.agent_name, l.branch, l.brand, l.order_number, l.customer_name, l.complaint_id, l.target_agent_name, l.notes].map((x) => (x || "").toLowerCase()).join(" ");
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Pagination over the filtered set
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { setPage(1); setAgentFilter(""); }, [typeFilter]); // reset agent when type changes
  useEffect(() => { setPage(1); }, [search, statusFilter, agentFilter]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]); // clamp (e.g. after delete)
  const pageStart = (page - 1) * PAGE_SIZE;
  const paged = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  // Page-number buttons with ellipsis (scales to any number of pages)
  const pageItems: (number | "…")[] = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const items: (number | "…")[] = [1];
    const lo = Math.max(2, page - 1), hi = Math.min(totalPages - 1, page + 1);
    if (lo > 2) items.push("…");
    for (let i = lo; i <= hi; i++) items.push(i);
    if (hi < totalPages - 1) items.push("…");
    items.push(totalPages);
    return items;
  })();

  // Editing/deleting logs is restricted to Admin only
  const canModify = (_l: OpsLog) => currentUser.role === "admin";

  const remove = async (l: OpsLog) => {
    if (!confirm(`Delete this ${LOG_TYPE_CONFIG[l.log_type as LogType]?.title || "log"}?`)) return;
    const res = await apiFetch(`/api/logs/${l.id}`, { method: "DELETE" });
    if (res.ok) fetchLogs(); else alert("Failed to delete.");
  };

  const exportCsv = () => {
    const headers = ["Date & Time", "Type", "Department", "Activity", "Status", "Time Spent", "Calls Reviewed", "Avg min/call", "Agent", "Branch", "Brand", "Order #", "Customer", "Complaint ID", "Target Agent", "Notes"];
    const rows = filtered.map((l) => [
      fmt(l.created_at), l.log_type, l.department || "", l.activity_type || "", l.status || "", fmtDur(elapsedSeconds(l)),
      l.calls_reviewed ?? "", avgPerCall(l) !== null ? avgPerCall(l)!.toFixed(1) : "",
      l.agent_name || "", l.branch || "", l.brand || "", l.order_number || "", l.customer_name || "", l.complaint_id || "", l.target_agent_name || "", l.notes || l.action_taken || "",
    ]);
    downloadCSV(headers, rows, `Logs_${new Date().toISOString().split("T")[0]}`);
  };

  const title = isAgent ? "My Logs" : currentUser.role === "admin" ? "All Logs" : "Team Logs";
  const statusBadge = (s?: string) => {
    if (s === "Completed" || s === "Solved") return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    if (s === "In Progress" || s === "Waiting Feedback") return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    if (s === "Not Solved") return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    return "bg-blue-500/10 text-blue-400 border border-blue-500/20";
  };
  const KW_MS = 3 * 60 * 60 * 1000;
  const fmt = (ts?: string) => {
    if (!ts) return "";
    return new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16);
  };

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl"><ClipboardList className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">{title}</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">{currentUser.department ? currentUser.department + " · " : ""}{filtered.length} record(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchLogs} className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={exportCsv} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 transition"><Download className="w-4 h-4" /> Export CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-[var(--muted)] absolute left-3.5 top-3.5" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search activity, agent, branch, order..." className="w-full pl-10 pr-4 py-3 bg-[var(--surface)] text-[var(--heading)] border border-[var(--border)] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition" />
        </div>
        {canFilterType && (
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-3 bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-2xl text-xs font-bold [&>option]:bg-[var(--surface)]">
            <option value="">All Types</option>
            {(Object.keys(LOG_TYPE_CONFIG) as LogType[]).map((t) => <option key={t} value={t}>{LOG_TYPE_CONFIG[t].title}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-3 bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-2xl text-xs font-bold [&>option]:bg-[var(--surface)]">
          <option value="">All Statuses</option>
          {["Open", "In Progress", "Completed", "Solved", "Not Solved", "Waiting Feedback"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {!isAgent && agentNames.length > 0 && (
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="px-3 py-3 bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-2xl text-xs font-bold [&>option]:bg-[var(--surface)]">
            <option value="">All Agents</option>
            {agentNames.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
      </div>

      {error && (<div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>)}

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[240px]"><div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg)] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                <tr>
                  <th className="p-4">Date &amp; Time</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Activity</th>
                  <th className="p-4">Details</th>
                  <th className="p-4">Agent</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Time</th>
                  <th className="p-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {paged.map((l) => (
                  <tr key={l.id} className="hover:bg-[var(--surface-2)]/40 transition align-top">
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{fmt(l.created_at)}</td>
                    <td className="p-4"><span className="text-[10px] font-bold text-[var(--muted)]">{LOG_TYPE_CONFIG[l.log_type as LogType]?.title || l.log_type}</span></td>
                    <td className="p-4 font-bold text-blue-400">{l.activity_type}</td>
                    <td className="p-4 text-[var(--text)]">
                      <div className="space-y-0.5">
                        {l.branch && <div>🏠 {l.branch}{l.brand ? " · " + l.brand : ""}</div>}
                        {l.order_number && <div className="font-mono text-[10px] text-[var(--muted)]">Order #{l.order_number}</div>}
                        {l.customer_name && <div>👤 {l.customer_name}</div>}
                        {l.complaint_id && <div className="font-mono text-[10px] text-[var(--muted)]">CID {l.complaint_id}</div>}
                        {l.target_agent_name && <div>🎯 {l.target_agent_name}</div>}
                        {l.aggregator && <div className="text-[10px] text-[var(--muted)]">{l.aggregator}</div>}
                        {l.log_type === "quality" && avgPerCall(l) !== null && (
                          <div className="text-[10px] font-bold text-emerald-500">📞 {l.calls_reviewed} calls · avg {avgPerCall(l)!.toFixed(1)} min/call</div>
                        )}
                        {(l.notes || l.action_taken) && <div className="text-[10px] text-[var(--muted)] line-clamp-2 max-w-xs">{l.notes || l.action_taken}</div>}
                      </div>
                    </td>
                    <td className="p-4 text-[var(--muted)]">{l.agent_name}</td>
                    <td className="p-4">{l.status ? <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold ${statusBadge(l.status)}`}>{l.status}</span> : <span className="text-zinc-600">—</span>}</td>
                    <td className="p-4">
                      <span className="font-mono text-[11px] font-bold flex items-center gap-1 text-[var(--text)]">
                        <Timer className="w-3.5 h-3.5" />{fmtDur(elapsedSeconds(l))}
                      </span>
                      {l.log_type === "quality" && avgPerCall(l) !== null && (
                        <div className="text-[9px] font-mono text-emerald-500 mt-0.5">{avgPerCall(l)!.toFixed(1)} min/call</div>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-1.5">
                        {!canModify(l) && canProgress(l) && <button onClick={() => openProgress(l)} className="px-2.5 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-lg transition text-[11px] font-bold flex items-center gap-1" title="Update status & time"><CheckCircle2 className="w-3.5 h-3.5" /> Update</button>}
                        {canModify(l) && <button onClick={() => setEditLog(l)} className="p-1.5 bg-[var(--surface-2)] hover:bg-blue-500/10 hover:text-blue-400 text-[var(--text)] border border-[var(--border)] rounded-lg transition" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>}
                        {canModify(l) && <button onClick={() => remove(l)} className="p-1.5 bg-[var(--surface-2)] hover:bg-rose-500/10 hover:text-rose-400 text-[var(--text)] border border-[var(--border)] rounded-lg transition" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}
                        {!canModify(l) && !canProgress(l) && <span className="text-[var(--muted)] text-[10px]">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (<tr><td colSpan={8} className="p-8 text-center text-[var(--muted)]">No logs found.</td></tr>)}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {filtered.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border)] bg-[var(--bg)]">
              <span className="text-[11px] text-[var(--muted)] font-medium">
                Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:pointer-events-none transition"
                >Prev</button>
                {pageItems.map((it, i) => it === "…" ? (
                  <span key={`e${i}`} className="px-2 text-[11px] text-[var(--muted)]">…</span>
                ) : (
                  <button
                    key={it}
                    onClick={() => setPage(it)}
                    className={`min-w-[32px] px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                      it === page
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-900/30"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)]"
                    }`}
                  >{it}</button>
                ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:pointer-events-none transition"
                >Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit modal */}
      {editLog && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl my-8 relative">
            <button onClick={() => setEditLog(null)} className="absolute -top-2 -right-2 z-10 p-2 bg-[var(--surface-2)] text-[var(--text)] hover:text-[var(--heading)] border border-[var(--border)] rounded-full"><X className="w-4 h-4" /></button>
            <OpsLogForm currentUser={currentUser} editLog={editLog} onDone={() => { setEditLog(null); fetchLogs(); }} />
          </div>
        </div>
      )}

      {/* Progress update modal (owner, Open/In Progress tasks) */}
      {progressLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h3 className="text-sm font-bold text-[var(--heading)] flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-400" /> Update Task</h3>
              <button onClick={() => setProgressLog(null)} className="p-1.5 hover:bg-[var(--surface-2)] text-[var(--muted)] rounded-lg transition"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[11px] text-[var(--muted)]">{progressLog.activity_type}{progressLog.brand ? " · " + progressLog.brand : ""}</p>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text)]">Status:</label>
              <select value={pStatus} onChange={(e) => setPStatus(e.target.value)} className="w-full px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs font-bold focus:ring-1 focus:ring-blue-500 focus:outline-none [&>option]:bg-[var(--surface)]">
                {progressStatusOptions(progressLog).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text)]">Time Spent (minutes):</label>
              <input type="number" min={0} value={pMinutes} onChange={(e) => setPMinutes(e.target.value)} placeholder="e.g. 15" className="w-full px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setProgressLog(null)} className="px-4 py-2 bg-[var(--surface-2)] text-[var(--text)] rounded-xl text-xs font-bold transition">Cancel</button>
              <button onClick={saveProgress} disabled={pSaving} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition">{pSaving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
