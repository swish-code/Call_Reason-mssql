import { useEffect, useState, Fragment } from "react";
import * as XLSX from "xlsx";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { ClipboardList, CheckCircle2, Clock, FolderOpen, CalendarDays, TrendingUp, Users, Award, MessageSquareWarning, Wrench, GraduationCap, AlertCircle, Timer, Filter, X, Download, ChevronLeft, ChevronRight } from "lucide-react";

interface OpsDashboardProps {
  currentUser: User;
}

interface DashData {
  role: string;
  department: string | null;
  totalLogs: number;
  avgHandlingSeconds: number;
  totalHandlingSeconds: number;
  open: number;
  pending: number;
  completed: number;
  daily: number;
  weekly: number;
  monthly: number;
  todayTasks: number;
  weekTasks: number;
  todaySeconds: number;
  weekSeconds: number;
  byActivity: { name: string; count: number }[];
  byDepartment: { name: string; count: number }[];
  deptPerformance: { name: string; count: number; avgToDateSeconds: number; avgWeekSeconds: number; totalSeconds: number }[];
  agentProductivity: { name: string; count: number }[];
  complaintResolutionRate: number;
  technicalStatus: { name: string; count: number }[];
  coachingSessions: number;
  trend: { date: string; count: number }[];
  shiftByAgent: { name: string; today: number; week: number; days: { date: string; seconds: number; count: number }[] }[];
}

export default function OpsDashboard({ currentUser }: OpsDashboardProps) {
  const [d, setD] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [activePeriod, setActivePeriod] = useState<"today" | "week" | "month" | "">("");
  const [shiftWeeksAgo, setShiftWeeksAgo] = useState(0); // 0 = current week

  // Kuwait time helpers (UTC+3)
  const kwToday = () => {
    const kw = new Date(Date.now() + 3 * 60 * 60 * 1000);
    return kw.toISOString().slice(0, 10);
  };
  const kwWeekStart = () => {
    const kw = new Date(Date.now() + 3 * 60 * 60 * 1000);
    kw.setUTCDate(kw.getUTCDate() - kw.getUTCDay()); // back to Sunday
    return kw.toISOString().slice(0, 10);
  };
  const kwMonthStart = () => {
    const kw = new Date(Date.now() + 3 * 60 * 60 * 1000);
    return kw.toISOString().slice(0, 7) + "-01";
  };

  const applyPeriod = (p: "today" | "week" | "month") => {
    const today = kwToday();
    const f = p === "today" ? today : p === "week" ? kwWeekStart() : kwMonthStart();
    setFrom(f); setTo(today); setFromTime(""); setToTime(""); setActivePeriod(p);
    load(f, today, "", "");
  };

  const load = async (f = from, t = to, ft = fromTime, tt = toTime, sw = shiftWeeksAgo) => {
    try {
      setLoading(true); setError("");
      const qs = new URLSearchParams();
      if (f) qs.set("from", f);
      if (t) qs.set("to", t);
      if (f && ft) qs.set("from_time", ft);
      if (t && tt) qs.set("to_time", tt);
      if (sw) qs.set("shift_weeks_ago", String(sw));
      const res = await apiFetch(`/api/logs/dashboard${qs.toString() ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to load dashboard.");
      setD(await res.json());
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  useEffect(() => { load("", "", "", ""); }, []);

  const clearFilter = () => { setFrom(""); setTo(""); setFromTime(""); setToTime(""); setActivePeriod(""); load("", "", "", ""); };

  // Shift Hours table week navigation (independent of the KPI date filter)
  const changeWeek = (delta: number) => {
    const nw = Math.max(0, shiftWeeksAgo + delta);
    if (nw === shiftWeeksAgo) return;
    setShiftWeeksAgo(nw);
    load(from, to, fromTime, toTime, nw);
  };

  if (loading && !d) return <div className="flex flex-col items-center justify-center min-h-[400px]"><div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div><p className="mt-4 text-[var(--muted)]">Loading dashboard...</p></div>;
  if (error) return <div className="p-6 bg-rose-950/20 border border-rose-500/30 rounded-2xl text-center text-rose-300"><AlertCircle className="w-10 h-10 mx-auto text-rose-500" /><p className="mt-2 text-sm">{error}</p></div>;
  if (!d) return null;

  const isAgent = currentUser.role === "agent";
  const fmtDur = (s: number) => {
    if (!s) return "0m";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : `${s}s`;
  };

  // Export the dashboard to Excel — always fetches fresh data for the CURRENT
  // filter inputs, so the sheet reflects the filter even if Apply wasn't clicked.
  const exportExcel = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (from && fromTime) qs.set("from_time", fromTime);
      if (to && toTime) qs.set("to_time", toTime);
      if (shiftWeeksAgo) qs.set("shift_weeks_ago", String(shiftWeeksAgo));
      const res = await apiFetch(`/api/logs/dashboard${qs.toString() ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Export failed.");
      const ex: DashData = await res.json();

      const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const rangeLabel = (from || to)
        ? `${from || "start"}${fromTime ? " " + fromTime : ""} -> ${to || "today"}${toTime ? " " + toTime : ""}`
        : "All time";
      const wb = XLSX.utils.book_new();

      const summary = [
        ["Dashboard Export"],
        ["Department", ex.department || "All departments"],
        ["Filter range", rangeLabel],
        ["Generated", new Date().toLocaleString()],
        [],
        ["Metric", "Value"],
        ["Total Logs", ex.totalLogs],
        ["Open Tasks", ex.open],
        ["Pending", ex.pending],
        ["Closed Tasks", ex.completed],
        ["Complaint Resolution %", ex.complaintResolutionRate],
        ["Coaching Sessions", ex.coachingSessions],
        ["Avg Handling Time", fmtDur(ex.avgHandlingSeconds)],
        ["Total Time Logged", fmtDur(ex.totalHandlingSeconds)],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

      const addBar = (name: string, rows: { name: string; count: number }[]) => {
        const aoa: any[][] = [["Name", "Count"], ...rows.map((r) => [r.name, r.count])];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
      };
      addBar("Agent Productivity", ex.agentProductivity);
      addBar("Logs by Activity", ex.byActivity);
      addBar("Technical Status", ex.technicalStatus);

      const deptAoa: any[][] = [["Department", "Staff", "Avg to date", "Avg / week"],
        ...ex.deptPerformance.map((dp) => [dp.name, dp.count, dp.count ? fmtDur(dp.avgToDateSeconds) : "—", dp.count ? fmtDur(dp.avgWeekSeconds) : "—"])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(deptAoa), "Department Perf");

      const trend: any[][] = [["Date", "Logs"], ...ex.trend.map((t) => [t.date, t.count])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(trend), "7-Day Trend");

      if (ex.shiftByAgent && ex.shiftByAgent.length) {
        const days = ex.shiftByAgent[0].days;
        const header = ["Agent", ...days.map((dd) => `${dayLabels[new Date(dd.date + "T00:00:00").getDay()]} ${dd.date.slice(5)}`), "Total"];
        const body = ex.shiftByAgent.map((a) => [a.name, ...a.days.map((dd) => dd.seconds > 0 ? `${fmtDur(dd.seconds)} (${dd.count})` : ""), fmtDur(a.week)]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), "Shift Hours");
      }

      XLSX.writeFile(wb, `dashboard_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      setError(e.message || "Export failed.");
    } finally {
      setLoading(false);
    }
  };
  const Card = ({ label, value, icon: Icon, tone }: { label: string; value: any; icon: any; tone: string }) => (
    <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-2xl flex items-center gap-4">
      <div className={`p-3 rounded-xl bg-opacity-10 ${tone} bg-current/10`}><Icon className={`w-6 h-6 ${tone}`} /></div>
      <div>
        <p className="text-[10px] text-[var(--muted)] font-bold uppercase">{label}</p>
        <h3 className="text-2xl font-bold text-[var(--heading)] tracking-tight font-mono">{value}</h3>
      </div>
    </div>
  );

  const BarList = ({ title, data, color, icon: Icon }: { title: string; data: { name: string; count: number }[]; color: string; icon: any }) => {
    const total = data.reduce((a, c) => a + c.count, 0) || 1;
    return (
      <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
        <h2 className="text-md font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Icon className="w-5 h-5 text-blue-400" /> {title}</h2>
        <div className="space-y-3">
          {data.map((x) => {
            const pct = Math.round((x.count / total) * 100);
            return (
              <div key={x.name} className="space-y-1">
                <div className="flex justify-between items-center text-xs font-bold"><span className="text-[var(--heading)] truncate pr-2">{x.name}</span><span className="text-[var(--muted)] font-mono shrink-0">{x.count}</span></div>
                <div className="w-full bg-[var(--surface-2)] border border-[var(--border)]/60 h-2 rounded-full overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }}></div></div>
              </div>
            );
          })}
          {data.length === 0 && <div className="text-center py-6 text-[var(--muted)] text-xs">No data yet.</div>}
        </div>
      </div>
    );
  };

  const Trend = () => {
    const max = Math.max(...d.trend.map((t) => t.count), 1);
    return (
      <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
        <h2 className="text-md font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-blue-400" /> Activity — last 7 days</h2>
        <div className="flex items-end justify-between gap-2 h-40">
          {d.trend.map((t) => {
            const p = t.date.split("-");
            return (
              <div key={t.date} className="flex-1 flex flex-col items-center justify-end gap-2 h-full">
                <span className="text-[10px] font-mono text-blue-300">{t.count}</span>
                <div className="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-lg" style={{ height: `${Math.max((t.count / max) * 100, 3)}%` }}></div>
                <span className="text-[9px] font-mono text-[var(--muted)]">{p[2]}/{p[1]}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const ProductivityBar = ({ seconds, capacity, label }: { seconds: number; capacity: number; label: string }) => {
    const pct = capacity ? Math.round((seconds / capacity) * 100) : 0;
    const tone = pct >= 85 ? "from-emerald-500 to-emerald-400" : pct >= 50 ? "from-blue-600 to-blue-400" : "from-amber-500 to-amber-400";
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-baseline text-xs font-bold">
          <span className="text-[var(--text)]">{label}</span>
          <span className="text-[var(--heading)] font-mono">{fmtDur(seconds)} / {fmtDur(capacity)} · {pct}%</span>
        </div>
        <div className="w-full bg-[var(--surface-2)] border border-[var(--border)] h-3 rounded-full overflow-hidden">
          <div className={`h-full rounded-full bg-gradient-to-r ${tone}`} style={{ width: `${Math.min(pct, 100)}%` }}></div>
        </div>
      </div>
    );
  };

  const DAY_CAP = 8 * 3600; // 8 working hours/day
  const WEEK_CAP = 6 * 8 * 3600; // 6 working days/week

  return (
    <div className="space-y-8 animate-fade-in text-[var(--text)]">
      {/* Banner */}
      <div className="bg-gradient-to-r from-[var(--surface)] via-[var(--surface-2)] to-[var(--bg)] border border-[var(--border)] p-6 md:p-8 rounded-3xl shadow-xl">
        <span className="bg-blue-950/45 text-blue-400 text-xs font-bold px-3 py-1 rounded-full border border-blue-500/30">{isAgent ? "Agent Dashboard" : currentUser.role === "leader" ? "Team Leader Dashboard" : currentUser.role === "supervisor" ? "Supervisor Dashboard" : "Admin Dashboard"}</span>
        <h1 className="text-2xl md:text-3xl font-extrabold text-[var(--heading)] tracking-tight mt-2">Welcome, {currentUser.name || currentUser.full_name}</h1>
        <p className="text-[var(--muted)] text-sm mt-1 font-light">{d.department ? `Department: ${d.department}` : "All departments"}</p>
      </div>

      {isAgent ? (
        <>
          {/* Today */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-lg space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-md font-extrabold text-[var(--heading)] flex items-center gap-2"><CalendarDays className="w-5 h-5 text-blue-400" /> Today</h2>
              <span className="text-[11px] text-[var(--muted)] font-bold">Working day · 8h</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Card label="Tasks" value={d.todayTasks} icon={CheckCircle2} tone="text-blue-400" />
              <Card label="Time Worked" value={fmtDur(d.todaySeconds)} icon={Clock} tone="text-emerald-400" />
            </div>
            <ProductivityBar seconds={d.todaySeconds} capacity={DAY_CAP} label="Productivity (worked / 8h)" />
          </div>

          {/* This week */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-lg space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-md font-extrabold text-[var(--heading)] flex items-center gap-2"><CalendarDays className="w-5 h-5 text-purple-400" /> This Week</h2>
              <span className="text-[11px] text-[var(--muted)] font-bold">6 working days · 48h</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Card label="Tasks" value={d.weekTasks} icon={CheckCircle2} tone="text-blue-400" />
              <Card label="Time Worked" value={fmtDur(d.weekSeconds)} icon={Clock} tone="text-emerald-400" />
            </div>
            <ProductivityBar seconds={d.weekSeconds} capacity={WEEK_CAP} label="Productivity (worked / 48h)" />
          </div>
        </>
      ) : (
        <>
          {/* Date-range filter */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 shadow-lg flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2 text-[var(--heading)] font-bold text-sm mr-1"><Filter className="w-4 h-4 text-blue-400" /> Filter by date</div>
            {/* Quick period buttons */}
            {(["today", "week", "month"] as const).map((p) => (
              <button key={p} onClick={() => applyPeriod(p)}
                className={`px-3 py-2 text-xs font-bold rounded-xl border transition active:scale-95 ${activePeriod === p ? "bg-blue-600 text-white border-blue-600" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)] hover:border-blue-500/40"}`}>
                {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
              </button>
            ))}
            <div className="w-px h-6 bg-[var(--border)] mx-1 self-center" />
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">From Date</label>
              <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setActivePeriod(""); }} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">From Time <span className="text-[9px] opacity-60">(optional)</span></label>
              <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} disabled={!from} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-40" />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">To Date</label>
              <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setActivePeriod(""); }} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--muted)] uppercase">To Time <span className="text-[9px] opacity-60">(optional)</span></label>
              <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} disabled={!to} className="px-3 py-2 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-40" />
            </div>
            <button onClick={() => load()} disabled={loading} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" /> Apply</button>
            <button onClick={exportExcel} disabled={loading} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Export Excel</button>
            {(from || to) && <button onClick={clearFilter} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-rose-400 font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Clear</button>}
            {(from || to) && <span className="text-[11px] text-[var(--muted)] font-medium ml-auto">Showing {from}{fromTime ? ` ${fromTime}` : ""} → {to || "today"}{toTime ? ` ${toTime}` : ""}</span>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card label="Total Logs" value={d.totalLogs} icon={ClipboardList} tone="text-[var(--heading)]" />
            <Card label="Open Tasks" value={d.open} icon={FolderOpen} tone="text-blue-400" />
            <Card label="Pending" value={d.pending} icon={Clock} tone="text-amber-400" />
            <Card label="Closed Tasks" value={d.completed} icon={CheckCircle2} tone="text-emerald-400" />
            <Card label="Complaint Resolution" value={`${d.complaintResolutionRate}%`} icon={MessageSquareWarning} tone="text-rose-400" />
            <Card label="Coaching Sessions" value={d.coachingSessions} icon={GraduationCap} tone="text-purple-400" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <Card label="Avg Handling Time / Task" value={fmtDur(d.avgHandlingSeconds)} icon={Timer} tone="text-emerald-400" />
            <Card label="Total Time Logged" value={fmtDur(d.totalHandlingSeconds)} icon={Clock} tone="text-sky-400" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <BarList title="Agent Productivity" data={d.agentProductivity} color="bg-blue-500" icon={Users} />
            {/* Department performance — staff count + avg worked hours */}
            <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
              <h2 className="text-md font-bold text-[var(--heading)] mb-4 flex items-center gap-2"><Award className="w-5 h-5 text-emerald-400" /> Department Performance</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                      <th className="text-left py-2 px-2">Department</th>
                      <th className="text-center py-2 px-2">Staff</th>
                      <th className="text-center py-2 px-2">Avg · to date</th>
                      <th className="text-center py-2 px-2">Avg · week</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.deptPerformance.map((dp) => (
                      <tr key={dp.name} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30 transition">
                        <td className="py-2.5 px-2 font-bold text-[var(--heading)]">{dp.name}</td>
                        <td className="py-2.5 px-2 text-center font-mono text-blue-400">{dp.count}</td>
                        <td className="py-2.5 px-2 text-center font-mono text-emerald-400">{dp.count ? fmtDur(dp.avgToDateSeconds) : "—"}</td>
                        <td className="py-2.5 px-2 text-center font-mono text-amber-400">{dp.count ? fmtDur(dp.avgWeekSeconds) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Trend />
            <BarList title="Technical Tasks Status" data={d.technicalStatus} color="bg-amber-500" icon={Wrench} />
          </div>
          <BarList title="Logs by Activity Type" data={d.byActivity} color="bg-purple-500" icon={ClipboardList} />

          {/* Shift hours per agent — daily breakdown */}
          <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-md font-bold text-[var(--heading)] flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-400" /> Shift Hours per Agent
              </h2>
              <div className="flex items-center gap-2">
                <button onClick={() => changeWeek(1)} disabled={loading} title="Older week"
                  className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 transition"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-[11px] font-bold text-[var(--muted)] min-w-[110px] text-center">
                  {(() => {
                    const dys = d.shiftByAgent?.[0]?.days || [];
                    if (!dys.length) return shiftWeeksAgo === 0 ? "This Week" : `${shiftWeeksAgo}w ago`;
                    const a = dys[0].date.slice(5).replace("-", "/"), b = dys[dys.length - 1].date.slice(5).replace("-", "/");
                    return `${a} – ${b}`;
                  })()}
                </span>
                <button onClick={() => changeWeek(-1)} disabled={loading || shiftWeeksAgo === 0} title="Newer week"
                  className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 transition"><ChevronRight className="w-4 h-4" /></button>
                {shiftWeeksAgo !== 0 && (
                  <button onClick={() => changeWeek(-shiftWeeksAgo)} disabled={loading}
                    className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[11px] font-bold text-[var(--muted)] hover:text-[var(--heading)] transition">This Week</button>
                )}
              </div>
            </div>
            {(!d.shiftByAgent || d.shiftByAgent.length === 0) ? (
              <div className="text-center py-6 text-[var(--muted)] text-xs">No shift activity yet.</div>
            ) : (() => {
              const days = d.shiftByAgent[0]?.days || [];
              const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
              const todayStr = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      {/* Row 1: day name + date, spanning the Time/Count pair */}
                      <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)]/60">
                        <th rowSpan={2} className="text-left py-2 px-3 min-w-[120px] align-bottom border-b border-[var(--border)]">Agent</th>
                        {days.map((day) => {
                          const isToday = day.date === todayStr;
                          const d2 = new Date(day.date + "T00:00:00");
                          return (
                            <th key={day.date} colSpan={2} className={`text-center py-2 px-2 border-l border-[var(--border)]/50 ${isToday ? "text-blue-400 bg-blue-500/5" : ""}`}>
                              <div className="font-extrabold">{DAY_LABELS[d2.getDay()]}</div>
                              <div className="font-normal opacity-70 text-[9px]">{day.date.slice(5).replace("-", "/")}</div>
                            </th>
                          );
                        })}
                        <th rowSpan={2} className="text-center py-2 px-3 min-w-[72px] text-blue-300 align-bottom border-b border-[var(--border)] border-l border-[var(--border)]/50">Total</th>
                      </tr>
                      {/* Row 2: Time / Count sub-headers */}
                      <tr className="text-[9px] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                        {days.map((day) => {
                          const isToday = day.date === todayStr;
                          return (
                            <Fragment key={day.date}>
                              <th className={`text-center py-1 px-2 font-semibold border-l border-[var(--border)]/50 ${isToday ? "bg-blue-500/5" : ""}`}>Time</th>
                              <th className={`text-center py-1 px-2 font-semibold ${isToday ? "bg-blue-500/5" : ""}`}>Count</th>
                            </Fragment>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {d.shiftByAgent.map((a) => (
                        <tr key={a.name} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30 transition">
                          <td className="py-2.5 px-3 font-bold text-[var(--heading)] truncate max-w-[140px]">{a.name}</td>
                          {a.days.map((day) => {
                            const isToday = day.date === todayStr;
                            const hrs = day.seconds / 3600;
                            const cellColor = day.seconds === 0 ? "text-[var(--border)]" : hrs >= 7 ? "text-emerald-400" : hrs >= 4 ? "text-amber-400" : "text-rose-400";
                            return (
                              <Fragment key={day.date}>
                                <td className={`py-2.5 px-2 text-center font-mono font-bold border-l border-[var(--border)]/40 ${cellColor} ${isToday ? "bg-blue-500/5" : ""}`}>
                                  {day.seconds > 0 ? fmtDur(day.seconds) : <span className="text-[var(--border)]">—</span>}
                                </td>
                                <td className={`py-2.5 px-2 text-center font-mono text-[11px] ${day.count > 0 ? "text-[var(--muted)]" : "text-[var(--border)]"} ${isToday ? "bg-blue-500/5" : ""}`}>
                                  {day.count > 0 ? day.count : "—"}
                                </td>
                              </Fragment>
                            );
                          })}
                          <td className="py-2.5 px-3 text-center font-mono font-extrabold text-blue-400 border-l border-[var(--border)]/40">{fmtDur(a.week)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
