import { useState, useEffect } from "react";
import { User, OpsLog, Brand, Branch, LogType, LOG_TYPE_CONFIG, DEPARTMENTS } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { FileText, Filter, Download, Printer, AlertCircle } from "lucide-react";

interface OpsReportsProps {
  currentUser: User;
}

const PAGE_SIZE = 20;

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null;
  const pages: (number | "…")[] = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(total - 1, page + 1); i++) pages.push(i);
    if (page < total - 2) pages.push("…");
    pages.push(total);
  }
  const btn = "w-8 h-8 flex items-center justify-center rounded-xl text-xs font-bold transition";
  return (
    <div className="flex items-center justify-center gap-1 pt-4 pb-1 print:hidden">
      <button disabled={page === 1} onClick={() => onChange(page - 1)} className={btn + " border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)] disabled:opacity-30"}>‹</button>
      {pages.map((p, i) =>
        p === "…" ? <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-[var(--muted)] text-xs">…</span>
        : <button key={p} onClick={() => onChange(p as number)} className={btn + (p === page ? " bg-blue-600 text-white shadow" : " border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-2)]")}>{p}</button>
      )}
      <button disabled={page === total} onClick={() => onChange(page + 1)} className={btn + " border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)] disabled:opacity-30"}>›</button>
    </div>
  );
}

export default function OpsReports({ currentUser }: OpsReportsProps) {
  const [logs, setLogs] = useState<OpsLog[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [fStartTime, setFStartTime] = useState("");
  const [fEndTime, setFEndTime] = useState("");
  const [fDept, setFDept] = useState("");
  const [fType, setFType] = useState("");
  const [fAgent, setFAgent] = useState("");
  const [fBranch, setFBranch] = useState("");
  const [fBrand, setFBrand] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fActivity, setFActivity] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true); setError("");
        const [rl, rb, rbr] = await Promise.all([apiFetch("/api/logs"), apiFetch("/api/brands"), apiFetch("/api/branches")]);
        if (!rl.ok) throw new Error("Failed to load logs.");
        setLogs(await rl.json());
        if (rb.ok) setBrands(await rb.json());
        if (rbr.ok) setBranches(await rbr.json());
      } catch (err: any) { setError(err.message); } finally { setLoading(false); }
    })();
  }, []);

  const KW_OFFSET_MS = 3 * 60 * 60 * 1000;
  const kwToUtcISO = (dateStr: string, timeStr: string, endOfMinute = false) => {
    const [y, mo, d] = dateStr.split("-").map(Number);
    const [h, m] = timeStr.split(":").map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h, m, endOfMinute ? 59 : 0) - KW_OFFSET_MS).toISOString();
  };
  const dateOf = (l: OpsLog) => (l.created_at || "").split("T")[0];
  const filtered = logs.filter((l) => {
    const ca = l.created_at || "";
    if (fStart && fStartTime) { if (ca < kwToUtcISO(fStart, fStartTime)) return false; }
    else if (fStart && dateOf(l) < fStart) return false;
    if (fEnd && fEndTime) { if (ca > kwToUtcISO(fEnd, fEndTime, true)) return false; }
    else if (fEnd && dateOf(l) > fEnd) return false;
    if (fDept && l.department !== fDept) return false;
    if (fType && l.log_type !== fType) return false;
    if (fAgent && l.agent_name !== fAgent) return false;
    if (fBranch && l.branch !== fBranch) return false;
    if (fBrand && l.brand !== fBrand) return false;
    if (fStatus && l.status !== fStatus) return false;
    if (fActivity && l.activity_type !== fActivity) return false;
    return true;
  });

  const agents = Array.from(new Set(logs.map((l) => l.agent_name).filter(Boolean)));
  const activities = Array.from(new Set(logs.map((l) => l.activity_type).filter(Boolean)));

  // Reset to page 1 whenever any filter changes
  useEffect(() => { setPage(1); }, [fStart, fEnd, fStartTime, fEndTime, fDept, fType, fAgent, fBranch, fBrand, fStatus, fActivity]);

  const reset = () => { setFStart(""); setFEnd(""); setFStartTime(""); setFEndTime(""); setFDept(""); setFType(""); setFAgent(""); setFBranch(""); setFBrand(""); setFStatus(""); setFActivity(""); setPage(1); };

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportCsv = () => {
    const headers = ["Date & Time", "Type", "Department", "Activity", "Status", "Time Spent", "Agent", "Branch", "Brand", "Order #", "Customer", "Complaint ID", "Target Agent", "Notes"];
    const rows = filtered.map((l) => [
      fmt(l.created_at), LOG_TYPE_CONFIG[l.log_type as LogType]?.title || l.log_type, l.department || "", l.activity_type || "", l.status || "", dur(l),
      l.agent_name || "", l.branch || "", l.brand || "", l.order_number || "", l.customer_name || "", l.complaint_id || "", l.target_agent_name || "", (l.notes || l.action_taken || "").replace(/\n/g, " "),
    ]);
    downloadCSV(headers, rows, `Operations_Report_${new Date().toISOString().split("T")[0]}`);
  };

  const selCls = "px-3 py-2 bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] rounded-xl text-xs font-bold focus:outline-none focus:ring-1 focus:ring-blue-500 [&>option]:bg-[var(--surface)]";
  const KW_MS = 3 * 60 * 60 * 1000;
  const fmt = (ts?: string) => ts ? new Date(new Date(ts).getTime() + KW_MS).toISOString().replace("T", " ").slice(0, 16) : "";
  const dur = (l: OpsLog) => {
    let s = Number(l.duration_seconds || 0);
    if (l.running_since) s += Math.max(0, Math.round((Date.now() - new Date(l.running_since).getTime()) / 1000));
    if (!s) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)] print:text-black">
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl"><FileText className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Reports &amp; Export</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">Filter operations logs and export to Excel or PDF.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 active:scale-95 transition"><Download className="w-4 h-4" /> Export to Excel (CSV)</button>
          <button onClick={() => window.print()} className="px-4 py-2.5 bg-[var(--bg)] hover:bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] font-bold rounded-2xl text-xs flex items-center gap-1.5 active:scale-95 transition"><Printer className="w-4 h-4" /> Export to PDF</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] rounded-3xl shadow-sm space-y-3 print:hidden">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-extrabold text-[var(--heading)] flex items-center gap-1.5"><Filter className="w-4 h-4 text-blue-400" /> Filters</h3>
          <button onClick={reset} className="px-3 py-1.5 text-[11px] font-bold text-rose-400 bg-rose-500/5 border border-rose-500/20 hover:bg-rose-500/10 rounded-xl">Reset</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-[var(--muted)]">From Date</label>
            <input type="date" value={fStart} onChange={(e) => setFStart(e.target.value)} className={selCls + " w-full"} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-[var(--muted)]">From Time <span className="opacity-50">(opt)</span></label>
            <input type="time" value={fStartTime} onChange={(e) => setFStartTime(e.target.value)} disabled={!fStart} className={selCls + " w-full disabled:opacity-40"} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-[var(--muted)]">To Date</label>
            <input type="date" value={fEnd} onChange={(e) => setFEnd(e.target.value)} className={selCls + " w-full"} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-[var(--muted)]">To Time <span className="opacity-50">(opt)</span></label>
            <input type="time" value={fEndTime} onChange={(e) => setFEndTime(e.target.value)} disabled={!fEnd} className={selCls + " w-full disabled:opacity-40"} />
          </div>
          {currentUser.role === "admin" && <div className="space-y-1"><label className="text-[10px] font-bold text-[var(--muted)]">Department</label><select value={fDept} onChange={(e) => setFDept(e.target.value)} className={selCls + " w-full"}><option value="">All</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>}
          <div className="space-y-1"><label className="text-[10px] font-bold text-[var(--muted)]">Log Type</label><select value={fType} onChange={(e) => setFType(e.target.value)} className={selCls + " w-full"}><option value="">All</option>{(Object.keys(LOG_TYPE_CONFIG) as LogType[]).map((t) => <option key={t} value={t}>{LOG_TYPE_CONFIG[t].title}</option>)}</select></div>
          <div className="space-y-1"><label className="text-[10px] font-bold text-[var(--muted)]">Agent</label><select value={fAgent} onChange={(e) => setFAgent(e.target.value)} className={selCls + " w-full"}><option value="">All</option>{agents.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
          <div className="space-y-1"><label className="text-[10px] font-bold text-[var(--muted)]">Branch</label><select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className={selCls + " w-full"}><option value="">All</option>{branches.map((b) => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}</select></div>
          <div className="space-y-1"><label className="text-[10px] font-bold text-[var(--muted)]">Brand</label><select value={fBrand} onChange={(e) => setFBrand(e.target.value)} className={selCls + " w-full"}><option value="">All</option>{brands.map((b) => <option key={b.id} value={b.brand_name}>{b.brand_name}</option>)}</select></div>
          <div className="space-y-1"><label className="text-[10px] font-bold text-[var(--muted)]">Status</label><select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selCls + " w-full"}><option value="">All</option>{["Open", "In Progress", "Completed", "Solved", "Not Solved", "Waiting Feedback"].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          <div className="space-y-1"><label className="text-[10px] font-bold text-[var(--muted)]">Activity</label><select value={fActivity} onChange={(e) => setFActivity(e.target.value)} className={selCls + " w-full"}><option value="">All</option>{activities.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block text-center space-y-1 border-b pb-4 mb-4">
        <h1 className="text-xl font-bold">Operations Logs Report</h1>
        <p className="text-xs">{filtered.length} records · generated {new Date().toISOString().split("T")[0]}</p>
      </div>

      {error && <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2 print:hidden"><AlertCircle className="w-5 h-5" /> {error}</div>}

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[200px]"><div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-sm print:border print:bg-white">
          <div className="p-4 bg-[var(--bg)] border-b border-[var(--border)] text-xs font-bold text-[var(--muted)] print:hidden">
            {filtered.length} record(s){filtered.length > PAGE_SIZE && ` · Page ${page} of ${totalPages}`}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg)] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                <tr>
                  <th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3">Dept</th><th className="p-3">Activity</th>
                  <th className="p-3">Agent</th><th className="p-3">Branch/Brand</th><th className="p-3">Order/Customer</th><th className="p-3">Status</th><th className="p-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {paginated.map((l) => (
                  <tr key={l.id} className="hover:bg-[var(--surface-2)]/40 transition">
                    <td className="p-3 font-mono text-[10px] text-[var(--muted)] whitespace-nowrap">{fmt(l.created_at)}</td>
                    <td className="p-3 text-[var(--muted)]">{LOG_TYPE_CONFIG[l.log_type as LogType]?.title || l.log_type}</td>
                    <td className="p-3 text-[var(--muted)]">{l.department}</td>
                    <td className="p-3 font-bold text-blue-400">{l.activity_type}</td>
                    <td className="p-3 text-[var(--text)]">{l.agent_name}</td>
                    <td className="p-3 text-[var(--text)]">{l.branch || "—"}{l.brand ? " / " + l.brand : ""}</td>
                    <td className="p-3 text-[var(--text)]">{l.order_number ? "#" + l.order_number : ""}{l.customer_name ? " " + l.customer_name : ""}{!l.order_number && !l.customer_name ? "—" : ""}</td>
                    <td className="p-3 text-[var(--text)]">{l.status || "—"}</td>
                    <td className="p-3 font-mono text-[11px] text-[var(--text)]">{dur(l)}</td>
                  </tr>
                ))}
                {paginated.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-[var(--muted)]">No records match the filters.</td></tr>}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="px-4 pb-3 border-t border-[var(--border)]">
              <Pagination page={page} total={totalPages} onChange={setPage} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
