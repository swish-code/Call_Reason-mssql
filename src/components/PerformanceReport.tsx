import { useState, useEffect } from "react";
import { User, DEPARTMENTS } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { downloadCSV } from "../utils.js";
import { TrendingUp, Clock, CheckCircle, ClipboardList, Download, AlertCircle } from "lucide-react";

interface AgentStat {
  agent_id: string;
  agent_name: string;
  department: string;
  total_logs: number;
  completed_logs: number;
  completion_rate: number;
  total_duration: number;
  avg_duration: number;
}

interface ShiftAgent {
  name: string;
  today: number;
  week: number;
  days: { date: string; seconds: number }[];
}

type SortKey = keyof Pick<AgentStat, "total_logs" | "completed_logs" | "completion_rate" | "total_duration" | "avg_duration">;

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

function fmtDur(s: number): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function RateBar({ rate }: { rate: number }) {
  const color = rate >= 80 ? "bg-emerald-500" : rate >= 60 ? "bg-amber-500" : "bg-rose-500";
  const text = rate >= 80 ? "text-emerald-400 bg-emerald-500/10" : rate >= 60 ? "text-amber-400 bg-amber-500/10" : "text-rose-400 bg-rose-500/10";
  return (
    <div className="flex items-center gap-2">
      <span className={`px-2 py-0.5 rounded-lg text-[11px] font-extrabold ${text}`}>{rate}%</span>
      <div className="w-16 h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${rate}%` }} />
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center font-extrabold text-[11px] shrink-0">
      {initials}
    </div>
  );
}

export default function PerformanceReport({ currentUser }: { currentUser: User }) {
  const [stats, setStats] = useState<AgentStat[]>([]);
  const [shiftAgents, setShiftAgents] = useState<ShiftAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("month");
  const [deptFilter, setDeptFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("total_logs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const isAdmin = ["admin", "manager", "owner"].includes(currentUser.role);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");
        const params = new URLSearchParams({ period });
        if (isAdmin && deptFilter) params.set("department", deptFilter);
        const [rPerf, rDash] = await Promise.all([
          apiFetch(`/api/performance?${params}`),
          apiFetch("/api/logs/dashboard"),
        ]);
        if (!rPerf.ok) throw new Error("Failed to load performance data.");
        setStats(await rPerf.json());
        if (rDash.ok) {
          const dash = await rDash.json();
          setShiftAgents(dash.shiftByAgent || []);
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [period, deptFilter]);

  const toggleSort = (col: SortKey) => {
    if (sortBy === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortBy(col); setSortDir("desc"); }
  };

  const sorted = [...stats].sort((a, b) =>
    sortDir === "desc" ? b[sortBy] - a[sortBy] : a[sortBy] - b[sortBy]
  );

  const totalLogs = stats.reduce((s, a) => s + a.total_logs, 0);
  const totalCompleted = stats.reduce((s, a) => s + a.completed_logs, 0);
  const avgRate = stats.length > 0
    ? Math.round(stats.reduce((s, a) => s + a.completion_rate, 0) / stats.length)
    : 0;
  const totalTime = stats.reduce((s, a) => s + a.total_duration, 0);

  const exportCsv = () => {
    const headers = ["Rank", "Agent", "Department", "Total Logs", "Completed", "Completion Rate", "Total Time", "Avg per Log"];
    const rows = sorted.map((s, i) => [
      i + 1, s.agent_name, s.department || "", s.total_logs, s.completed_logs,
      `${s.completion_rate}%`, fmtDur(s.total_duration), fmtDur(s.avg_duration),
    ]);
    downloadCSV(headers, rows, `Performance_${period}_${new Date().toISOString().split("T")[0]}`);
  };

  const thCls = "p-3 cursor-pointer select-none hover:text-[var(--heading)] transition whitespace-nowrap";
  const sortIcon = (col: SortKey) => sortBy === col ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  const summaryCards = [
    { label: "Total Logs", value: totalLogs, icon: <ClipboardList className="w-5 h-5" />, color: "blue" },
    { label: "Completed", value: totalCompleted, icon: <CheckCircle className="w-5 h-5" />, color: "emerald" },
    { label: "Avg Completion", value: `${avgRate}%`, icon: <TrendingUp className="w-5 h-5" />, color: "purple" },
    { label: "Total Time", value: fmtDur(totalTime), icon: <Clock className="w-5 h-5" />, color: "amber" },
  ];

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      {/* Header */}
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Team Performance</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">
              {currentUser.department ? `${currentUser.department} · ` : ""}{stats.length} member(s)
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="px-3 py-1.5 bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] rounded-xl text-xs font-bold focus:outline-none [&>option]:bg-[var(--surface)]"
            >
              <option value="">All Departments</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  period === p.key
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={exportCsv}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 active:scale-95 transition"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {!loading && !error && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {summaryCards.map((c) => (
            <div key={c.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-4 flex items-center gap-3 shadow-sm">
              <div className={`p-2.5 rounded-2xl shrink-0 ${
                c.color === "blue" ? "bg-blue-500/10 text-blue-400" :
                c.color === "emerald" ? "bg-emerald-500/10 text-emerald-400" :
                c.color === "purple" ? "bg-purple-500/10 text-purple-400" :
                "bg-amber-500/10 text-amber-400"
              }`}>
                {c.icon}
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wide">{c.label}</p>
                <p className="text-lg font-extrabold text-[var(--heading)]">{c.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="w-10 h-10 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />{error}
        </div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg)] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                <tr>
                  <th className="p-3 w-8">#</th>
                  <th className="p-3">Agent</th>
                  {isAdmin && <th className="p-3">Department</th>}
                  <th className={thCls} onClick={() => toggleSort("total_logs")}>Logs{sortIcon("total_logs")}</th>
                  <th className={thCls} onClick={() => toggleSort("completed_logs")}>Completed{sortIcon("completed_logs")}</th>
                  <th className={thCls} onClick={() => toggleSort("completion_rate")}>Rate{sortIcon("completion_rate")}</th>
                  <th className={thCls} onClick={() => toggleSort("total_duration")}>Total Time{sortIcon("total_duration")}</th>
                  <th className={thCls} onClick={() => toggleSort("avg_duration")}>Avg / Log{sortIcon("avg_duration")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {sorted.map((s, i) => (
                  <tr key={s.agent_id} className="hover:bg-[var(--surface-2)]/40 transition">
                    <td className="p-3 text-[var(--muted)] font-mono text-center">{i + 1}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={s.agent_name} />
                        <span className="font-bold text-[var(--heading)]">{s.agent_name}</span>
                      </div>
                    </td>
                    {isAdmin && <td className="p-3 text-[var(--muted)]">{s.department || "—"}</td>}
                    <td className="p-3 font-bold text-[var(--heading)]">{s.total_logs}</td>
                    <td className="p-3 font-bold text-emerald-400">{s.completed_logs}</td>
                    <td className="p-3"><RateBar rate={s.completion_rate} /></td>
                    <td className="p-3 font-mono text-[var(--text)]">{fmtDur(s.total_duration)}</td>
                    <td className="p-3 font-mono text-[var(--muted)]">{fmtDur(s.avg_duration)}</td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 7} className="p-10 text-center text-[var(--muted)]">
                      No data for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Shift Hours per Agent — daily breakdown */}
      {!loading && shiftAgents.length > 0 && (() => {
        const days = shiftAgents[0]?.days || [];
        const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const todayStr = days.length > 0 ? days[days.length - 1].date : "";
        return (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-sm">
            <div className="p-5 border-b border-[var(--border)] flex items-center gap-3">
              <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-2xl"><Clock className="w-5 h-5" /></div>
              <div>
                <h3 className="text-sm font-extrabold text-[var(--heading)]">Logged Time per Agent</h3>
                <p className="text-xs text-[var(--muted)] font-light mt-0.5">Sum of minutes entered in log forms — last 7 days</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[var(--bg)] border-b border-[var(--border)]">
                  <tr className="text-[10px] text-[var(--muted)] font-bold">
                    <th className="text-left py-2 px-4 min-w-[140px]">Agent</th>
                    {days.map((day) => {
                      const isToday = day.date === todayStr;
                      const dow = new Date(day.date + "T00:00:00").getDay();
                      return (
                        <th key={day.date} className={`text-center py-2 px-2 min-w-[68px] ${isToday ? "text-blue-400" : ""}`}>
                          <div className="font-extrabold">{DAY_LABELS[dow]}</div>
                          <div className="text-[9px] font-normal opacity-70">{day.date.slice(5).replace("-", "/")}</div>
                        </th>
                      );
                    })}
                    <th className="text-center py-2 px-4 min-w-[80px] text-blue-300">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {shiftAgents.map((a) => (
                    <tr key={a.name} className="hover:bg-[var(--surface-2)]/40 transition">
                      <td className="py-2.5 px-4 font-bold text-[var(--heading)] truncate max-w-[160px]">{a.name}</td>
                      {a.days.map((day) => {
                        const isToday = day.date === todayStr;
                        const hrs = day.seconds / 3600;
                        const color = day.seconds === 0
                          ? "text-[var(--border)]"
                          : hrs >= 7 ? "text-emerald-400"
                          : hrs >= 4 ? "text-amber-400"
                          : "text-rose-400";
                        return (
                          <td key={day.date} className={`py-2.5 px-2 text-center font-mono font-bold ${color} ${isToday ? "bg-blue-500/5" : ""}`}>
                            {day.seconds > 0 ? fmtDur(day.seconds) : <span className="text-[var(--border)]">—</span>}
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-4 text-center font-mono font-extrabold text-blue-400">{fmtDur(a.week)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
