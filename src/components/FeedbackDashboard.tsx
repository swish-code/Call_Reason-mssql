import { useEffect, useState } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Star, MessageSquare, ClipboardList, CheckCircle2, AlertCircle, Users, Filter, X, PhoneCall, Flag, Megaphone, ThumbsUp } from "lucide-react";

interface Props { currentUser: User; }
type NC = { name: string; count: number };

interface FeedbackData {
  ratings: {
    total: number; avgRating: number; needsAction: number; resolved: number; unreachable: number; resolutionRate: number;
    byStatus: NC[]; byRating: NC[]; byBrand: NC[]; byPlatform: NC[];
    platformPerf: { name: string; count: number; avg: number }[];
    brandPerf: { name: string; count: number; avg: number }[];
    byAgent: { name: string; assigned: number; done: number }[];
  };
  surveys: {
    campaigns: { total: number; byStatus: NC[] };
    assignments: { total: number; successful: number; successRate: number; byStatus: NC[] };
    records: { total: number; answered: number; noAnswer: number; byType: NC[]; byBrand: NC[];
      byAgent: { name: string; count: number; answered: number; avg: number }[] };
    topAgents: { name: string; successful: number }[];
  };
}

const ratingStatusLabel = (s: string) =>
  s === 'resolved' ? 'Complaint Recorded' : s === 'no_action_needed' ? 'No Action Required'
  : s === 'in_progress' ? 'In Progress' : s === 'unreachable' ? 'Unreachable' : 'Pending';
const surveyStatusLabel = (s: string) =>
  s === 'successful' ? 'Successful' : s === 'in_progress' ? 'In Progress' : s === 'no_answer' ? 'No Answer'
  : s === 'unreachable' ? 'Unreachable' : s === 'declined' ? 'Declined' : s === 'full_today' ? 'Full Today'
  : s === 'active' ? 'Active' : s === 'completed' ? 'Completed' : s === 'cancelled' ? 'Cancelled' : 'Pending';

export default function FeedbackDashboard({ currentUser }: Props) {
  const [d, setD] = useState<FeedbackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [activePeriod, setActivePeriod] = useState<"today" | "week" | "month" | "">("");

  const kwToday = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const kwWeekStart = () => { const k = new Date(Date.now() + 3 * 3600 * 1000); k.setUTCDate(k.getUTCDate() - k.getUTCDay()); return k.toISOString().slice(0, 10); };
  const kwMonthStart = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 7) + "-01";

  const load = async (f = from, t = to) => {
    try {
      setLoading(true); setError("");
      const qs = new URLSearchParams();
      if (f) qs.set("from", f);
      if (t) qs.set("to", t);
      const res = await apiFetch(`/api/feedback/dashboard${qs.toString() ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to load dashboard.");
      setD(await res.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load("", ""); }, []);

  const applyPeriod = (p: "today" | "week" | "month") => {
    const today = kwToday();
    const f = p === "today" ? today : p === "week" ? kwWeekStart() : kwMonthStart();
    setFrom(f); setTo(today); setActivePeriod(p); load(f, today);
  };
  const clearFilter = () => { setFrom(""); setTo(""); setActivePeriod(""); load("", ""); };

  if (loading && !d) return <div className="flex flex-col items-center justify-center min-h-[400px]"><div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /><p className="mt-4 text-[var(--muted)]">Loading dashboard…</p></div>;
  if (error) return <div className="p-6 bg-rose-950/20 border border-rose-500/30 rounded-2xl text-center text-rose-300"><AlertCircle className="w-10 h-10 mx-auto text-rose-500" /><p className="mt-2 text-sm">{error}</p></div>;
  if (!d) return null;

  const Card = ({ label, value, icon: Icon, tone }: { label: string; value: any; icon: any; tone: string }) => (
    <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl flex items-center gap-4">
      <div className={`p-3 rounded-xl bg-current/10 ${tone}`}><Icon className={`w-6 h-6 ${tone}`} /></div>
      <div>
        <p className="text-[10px] text-[var(--muted)] font-bold uppercase">{label}</p>
        <h3 className="text-2xl font-bold text-[var(--heading)] tracking-tight font-mono">{value}</h3>
      </div>
    </div>
  );

  const Bar = ({ title, data, color, icon: Icon, label }: { title: string; data: NC[]; color: string; icon: any; label?: (s: string) => string }) => {
    const total = data.reduce((a, c) => a + c.count, 0) || 1;
    return (
      <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
        <h3 className="text-sm font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Icon className="w-4 h-4 text-blue-400" /> {title}</h3>
        <div className="space-y-3">
          {data.map((x) => {
            const pct = Math.round((x.count / total) * 100);
            return (
              <div key={x.name} className="space-y-1">
                <div className="flex justify-between items-center text-xs font-bold"><span className="text-[var(--heading)] truncate pr-2">{label ? label(x.name) : x.name}</span><span className="text-[var(--muted)] font-mono shrink-0">{x.count}</span></div>
                <div className="w-full bg-[var(--surface-2)] border border-[var(--border)]/60 h-2 rounded-full overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
          {data.length === 0 && <div className="text-center py-6 text-[var(--muted)] text-xs">No data yet.</div>}
        </div>
      </div>
    );
  };

  const PerfTable = ({ title, icon: Icon, rows }: { title: string; icon: any; rows: { name: string; count: number; avg: number }[] }) => {
    const starColor = (a: number) => a >= 4 ? 'text-emerald-400' : a >= 3 ? 'text-amber-400' : 'text-rose-400';
    return (
      <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
        <h3 className="text-sm font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Icon className="w-4 h-4 text-blue-400" /> {title}</h3>
        {rows.length === 0 ? <div className="text-center py-6 text-[var(--muted)] text-xs">No data yet.</div> : (
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]"><th className="text-left py-2">Name</th><th className="text-center py-2">Reviews</th><th className="text-center py-2">Avg</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.name} className="border-b border-[var(--border)]/40 last:border-0">
                  <td className="py-2 font-bold text-[var(--heading)] truncate max-w-[160px]">{x.name}</td>
                  <td className="py-2 text-center font-mono text-[var(--muted)]">{x.count}</td>
                  <td className={`py-2 text-center font-mono font-bold ${starColor(x.avg)}`}>{x.avg ? `${x.avg.toFixed(1)} ★` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  const r = d.ratings, s = d.surveys;

  return (
    <div className="space-y-8 animate-fade-in text-[var(--text)]">
      {/* Banner */}
      <div className="bg-gradient-to-r from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] border border-[var(--border)] p-6 md:p-8 rounded-3xl shadow-xl">
        <span className="bg-blue-950/45 text-blue-400 text-xs font-bold px-3 py-1 rounded-full border border-blue-500/30">Feedback Analytics</span>
        <h1 className="text-2xl md:text-3xl font-extrabold text-[var(--heading)] tracking-tight mt-2">Ratings, Reviews &amp; Surveys</h1>
        <p className="text-[var(--muted)] text-sm mt-1 font-light">Consolidated performance across all feedback channels</p>
      </div>

      {/* Date filter */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-lg flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><Filter className="w-4 h-4 text-blue-400" /> Filter by date</div>
        {(["today", "week", "month"] as const).map((p) => (
          <button key={p} onClick={() => applyPeriod(p)}
            className={`px-3 py-2 text-xs font-bold rounded-xl border transition active:scale-95 ${activePeriod === p ? "bg-blue-600 text-white border-blue-600" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)] hover:border-blue-500/40"}`}>
            {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
          </button>
        ))}
        <div className="w-px h-6 bg-[var(--border)] mx-1 self-center" />
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">From</label>
          <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setActivePeriod(""); }} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none" />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">To</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setActivePeriod(""); }} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none" />
        </div>
        <button onClick={() => load()} disabled={loading} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" /> Apply</button>
        {(from || to) && <button onClick={clearFilter} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-rose-400 font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Clear</button>}
        {(from || to) && <span className="text-[11px] text-[var(--muted)] font-medium ml-auto">Showing {from || "start"} → {to || "today"}</span>}
      </div>

      {/* ================= RATINGS & REVIEWS ================= */}
      <div className="space-y-5">
        <h2 className="text-lg font-extrabold text-[var(--heading)] flex items-center gap-2"><Star className="w-5 h-5 text-amber-400" /> Ratings &amp; Reviews</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <Card label="Total Reviews" value={r.total} icon={Star} tone="text-amber-400" />
          <Card label="Avg Rating" value={r.avgRating.toFixed(1)} icon={Star} tone="text-yellow-400" />
          <Card label="Needs Action" value={r.needsAction} icon={Flag} tone="text-rose-400" />
          <Card label="Resolution Rate" value={`${r.resolutionRate}%`} icon={CheckCircle2} tone="text-emerald-400" />
          <Card label="Unreachable" value={r.unreachable} icon={PhoneCall} tone="text-zinc-400" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Bar title="By Status" data={r.byStatus} color="bg-blue-500" icon={ClipboardList} label={ratingStatusLabel} />
          <Bar title="By Rating (stars)" data={r.byRating} color="bg-amber-500" icon={Star} label={(n) => `${n} ★`} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PerfTable title="Avg Rating by Brand" icon={Megaphone} rows={r.brandPerf} />
          <PerfTable title="Avg Rating by Platform" icon={MessageSquare} rows={r.platformPerf} />
        </div>
        {/* Agent workload */}
        <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
          <h3 className="text-sm font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Users className="w-4 h-4 text-blue-400" /> Agent Workload (assigned reviews)</h3>
          {r.byAgent.length === 0 ? <div className="text-center py-6 text-[var(--muted)] text-xs">No reviews assigned yet.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]"><th className="text-left py-2 px-3">Agent</th><th className="text-center py-2 px-3">Assigned</th><th className="text-center py-2 px-3">Closed</th><th className="text-center py-2 px-3">Progress</th></tr></thead>
                <tbody>
                  {r.byAgent.map((a) => {
                    const pct = a.assigned > 0 ? Math.round((a.done / a.assigned) * 100) : 0;
                    return (
                      <tr key={a.name} className="border-b border-[var(--border)]/40 last:border-0">
                        <td className="py-2.5 px-3 font-bold text-[var(--heading)]">{a.name}</td>
                        <td className="py-2.5 px-3 text-center font-mono text-blue-400">{a.assigned}</td>
                        <td className="py-2.5 px-3 text-center font-mono text-emerald-400">{a.done}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-[var(--surface-2)] h-2 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                            <span className="font-mono text-[10px] text-[var(--muted)] w-8 text-right">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ================= SURVEYS ================= */}
      <div className="space-y-5">
        <h2 className="text-lg font-extrabold text-[var(--heading)] flex items-center gap-2"><MessageSquare className="w-5 h-5 text-violet-400" /> Surveys</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card label="Campaigns" value={s.campaigns.total} icon={Megaphone} tone="text-violet-400" />
          <Card label="Numbers" value={s.assignments.total} icon={PhoneCall} tone="text-blue-400" />
          <Card label="Successful" value={s.assignments.successful} icon={CheckCircle2} tone="text-emerald-400" />
          <Card label="Success Rate" value={`${s.assignments.successRate}%`} icon={ThumbsUp} tone="text-emerald-400" />
          <Card label="Records" value={s.records.total} icon={ClipboardList} tone="text-sky-400" />
          <Card label="Answered" value={s.records.answered} icon={CheckCircle2} tone="text-emerald-400" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Bar title="Campaigns by Status" data={s.campaigns.byStatus} color="bg-violet-500" icon={Megaphone} label={surveyStatusLabel} />
          <Bar title="Call Numbers by Status" data={s.assignments.byStatus} color="bg-blue-500" icon={PhoneCall} label={surveyStatusLabel} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Bar title="Survey Records by Type" data={s.records.byType} color="bg-sky-500" icon={ClipboardList} />
          <Bar title="Survey Records by Brand" data={s.records.byBrand} color="bg-emerald-500" icon={Megaphone} />
        </div>
        {/* Top survey agents */}
        <Bar title="Top Survey Agents (successful calls)" data={s.topAgents.map((a) => ({ name: a.name, count: a.successful }))} color="bg-violet-500" icon={Users} />

        {/* Survey records per employee (Served By) — includes historical imports */}
        <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
          <h3 className="text-sm font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Users className="w-4 h-4 text-violet-400" /> Survey Records by Employee (Served By)</h3>
          {(!s.records.byAgent || s.records.byAgent.length === 0) ? <div className="text-center py-6 text-[var(--muted)] text-xs">No survey records yet.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                  <th className="text-left py-2 px-2">Employee</th>
                  <th className="text-center py-2 px-2">Records</th>
                  <th className="text-center py-2 px-2">Answered</th>
                  <th className="text-center py-2 px-2">Avg Rate</th>
                </tr></thead>
                <tbody>
                  {s.records.byAgent.map((a) => (
                    <tr key={a.name} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30 transition">
                      <td className="py-2 px-2 font-bold text-[var(--heading)]">{a.name}</td>
                      <td className="py-2 px-2 text-center font-mono text-blue-400">{a.count}</td>
                      <td className="py-2 px-2 text-center font-mono text-emerald-400">{a.answered}</td>
                      <td className="py-2 px-2 text-center font-mono text-amber-400">{a.avg ? a.avg.toFixed(1) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
