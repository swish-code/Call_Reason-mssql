import { useState, useEffect } from "react";
import { User, AuditLog } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { History, Search, Download, RefreshCw, AlertCircle } from "lucide-react";

interface HistoryLogsProps {
  currentUser: User;
}

export default function HistoryLogs({ currentUser }: HistoryLogsProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const fetchLogs = async () => {
    try {
      setLoading(true); setError("");
      const res = await apiFetch("/api/logs/history");
      if (!res.ok) throw new Error("Failed to load history.");
      setLogs(await res.json());
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  useEffect(() => { fetchLogs(); }, []);

  const actions = Array.from(new Set(logs.map((l) => l.action).filter(Boolean)));
  const q = search.trim().toLowerCase();
  const filtered = logs.filter((l) => {
    if (actionFilter && l.action !== actionFilter) return false;
    if (q) {
      const hay = [l.operator_name, l.action, l.details, l.department, l.previous_value, l.new_value, l.related_ref].map((x) => (x || "").toLowerCase()).join(" ");
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const fmt = (ts?: string) => (ts ? ts.replace("T", " ").slice(0, 19) : "");
  const pretty = (v?: string) => {
    if (!v) return "—";
    try { const o = JSON.parse(v); return Object.entries(o).map(([k, val]) => `${k}: ${val}`).join(", ") || "—"; } catch { return v; }
  };

  const exportCsv = () => {
    const headers = ["User Name", "Role", "Department", "Action", "Previous Value", "New Value", "Date & Time", "Comments / Reference"];
    const rows = filtered.map((l) => [l.operator_name, l.operator_role || "", l.department || "", l.action, pretty(l.previous_value), pretty(l.new_value), fmt(l.timestamp), l.details || l.related_ref || ""]);
    downloadCSV(headers, rows, `History_Logs_${new Date().toISOString().split("T")[0]}`);
  };

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl"><History className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">History Logs — Audit Trail</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">Every system change with previous and new values.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchLogs} className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={exportCsv} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 active:scale-95 transition"><Download className="w-4 h-4" /> Export CSV</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-[var(--muted)] absolute left-3.5 top-3.5" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, action, value, reference..." className="w-full pl-10 pr-4 py-3 bg-[var(--surface)] text-[var(--heading)] border border-[var(--border)] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition" />
        </div>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="px-3 py-3 bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-2xl text-xs font-bold [&>option]:bg-[var(--surface)]">
          <option value="">All Actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {error && <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>}

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[200px]"><div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg)] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                <tr>
                  <th className="p-3">User Name</th><th className="p-3">Role</th><th className="p-3">Department</th><th className="p-3">Action</th>
                  <th className="p-3">Previous Value</th><th className="p-3">New Value</th><th className="p-3">Date &amp; Time</th><th className="p-3">Comments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-[var(--surface-2)]/40 transition align-top">
                    <td className="p-3 font-bold text-[var(--heading)]">{l.operator_name}</td>
                    <td className="p-3 text-[var(--muted)]">{l.operator_role || "—"}</td>
                    <td className="p-3 text-[var(--muted)]">{l.department || "—"}</td>
                    <td className="p-3 font-bold text-blue-400">{l.action}</td>
                    <td className="p-3 text-rose-300 max-w-[160px]">{pretty(l.previous_value)}</td>
                    <td className="p-3 text-emerald-300 max-w-[160px]">{pretty(l.new_value)}</td>
                    <td className="p-3 font-mono text-[10px] text-[var(--muted)] whitespace-nowrap">{fmt(l.timestamp)}</td>
                    <td className="p-3 text-[var(--muted)] max-w-[220px]">{l.details || l.related_ref || "—"}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-[var(--muted)]">No history entries.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="p-4 bg-[var(--bg)] text-[11px] text-[var(--muted)] border-t border-[var(--border)]">{filtered.length} entries</div>
        </div>
      )}
    </div>
  );
}
