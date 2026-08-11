import React, { useState, useEffect } from "react";
import { User, LogType, LOG_TYPE_CONFIG, OpsLog, Brand, Branch } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Check, Loader2, Send, AlertCircle, ClipboardList } from "lucide-react";

interface OpsLogFormProps {
  currentUser: User;
  editLog?: OpsLog | null;
  onDone: () => void;
}

const DEPT_TO_LOGTYPE: Record<string, LogType> = {
  "Call Center": "call_center",
  "Technical": "technical",
  "Complaints": "complaint",
  "Quality": "quality",
};

const FIELD_META: Record<string, { label: string; type: "text" | "textarea" | "date" | "brand" | "branch" | "aggregator" | "agent" }> = {
  branch: { label: "Branch", type: "branch" },
  brand: { label: "Brand", type: "brand" },
  order_number: { label: "Order Number", type: "text" },
  aggregator: { label: "Aggregator", type: "aggregator" },
  customer_name: { label: "Customer Name", type: "text" },
  complaint_id: { label: "Complaint ID", type: "text" },
  target_agent_name: { label: "Agent Name", type: "agent" },
  notes: { label: "Notes", type: "textarea" },
  action_taken: { label: "Action Taken", type: "textarea" },
  resolution_notes: { label: "Resolution Notes", type: "textarea" },
  action_plan: { label: "Action Plan", type: "textarea" },
  follow_up_date: { label: "Follow-up Date", type: "date" },
};

export default function OpsLogForm({ currentUser, editLog, onDone }: OpsLogFormProps) {
  const isAdmin = currentUser.role === "admin";
  const isLeader = currentUser.role === "leader";
  // Management (admin / owner / manager) can choose log type + department
  const canChoose = currentUser.role === "admin" || currentUser.role === "owner" || currentUser.role === "manager";
  const editing = !!editLog;

  // FM staff live in the Quality department for supervision but do call-center
  // work, so their operational log type is call_center (not quality).
  const isFM = currentUser.job_title === "FM" || currentUser.job_title === "FM Team Leader";
  const myDeptType: LogType = isFM
    ? "call_center"
    : ((DEPT_TO_LOGTYPE[currentUser.department || ""] as LogType) || "call_center");

  // Determine the log type
  const leaderLogType: LogType = (currentUser.department === "Call Center" || isFM) ? "team_leader" : myDeptType;
  const initialType: LogType = editLog?.log_type as LogType
    || (isLeader ? leaderLogType : canChoose ? "call_center" : myDeptType);
  const [logType, setLogType] = useState<LogType>(initialType);
  const cfg = LOG_TYPE_CONFIG[logType];

  // Leaders may switch between their department log and the Team Leader (coaching) log
  const leaderChoices: LogType[] = isLeader
    ? (Array.from(new Set([myDeptType, "team_leader"])) as LogType[])
    : [];
  const canPickType = (canChoose || (isLeader && leaderChoices.length > 1)) && !editing;

  const isQuality = logType === "quality";
  const [activity, setActivity] = useState(editLog?.activity_type || "");
  const [status, setStatus] = useState(editLog?.status || "");
  const [durationMin, setDurationMin] = useState(editLog?.duration_seconds ? String(Math.round(editLog.duration_seconds / 60)) : "");
  // Quality daily log: calls reviewed + total listening hours (avg computed)
  const [callsReviewed, setCallsReviewed] = useState(editLog && (editLog as any).calls_reviewed ? String((editLog as any).calls_reviewed) : "");
  const [listeningHours, setListeningHours] = useState(
    editLog && editLog.log_type === "quality" && editLog.duration_seconds
      ? String(+(editLog.duration_seconds / 3600).toFixed(2)) : ""
  );
  const avgMinutes = (Number(callsReviewed) > 0 && Number(listeningHours) > 0)
    ? ((Number(listeningHours) * 60) / Number(callsReviewed)).toFixed(1) : "";
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    if (editLog) Object.keys(FIELD_META).forEach((k) => { v[k] = (editLog as any)[k] || ""; });
    return v;
  });

  const [activityOpts, setActivityOpts] = useState<string[]>([]);
  const [statusOpts, setStatusOpts] = useState<string[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [agents, setAgents] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Load option lists whenever the log type changes
  useEffect(() => {
    const load = async () => {
      const getLabels = async (key?: string) => {
        if (!key) return [];
        try { const r = await apiFetch(`/api/options/${key}`); if (r.ok) return (await r.json()).map((o: any) => o.label); } catch (e) {}
        return [];
      };
      const [act, st] = await Promise.all([getLabels(cfg.activityKey), getLabels(cfg.statusKey)]);
      setActivityOpts(act);
      setStatusOpts(st);
      if (!editing) {
        setActivity(act[0] || "");
        setStatus(st[0] || "");
      }
    };
    load();
  }, [logType]);

  useEffect(() => {
    const load = async () => {
      try {
        const [rb, rbr] = await Promise.all([apiFetch("/api/brands"), apiFetch("/api/branches")]);
        if (rb.ok) setBrands(await rb.json());
        if (rbr.ok) setBranches(await rbr.json());
        // Agents in the relevant department (for Team Leader target selection)
        const ru = await apiFetch("/api/users");
        if (ru.ok) {
          const users: User[] = await ru.json();
          const dept = currentUser.department;
          setAgents(users.filter((u) => u.role === "agent" && (!dept || u.department === dept)).map((u) => u.full_name));
        }
      } catch (e) { /* ignore */ }
    };
    load();
  }, []);

  const setVal = (k: string, v: string) =>
    setValues((p) => (k === "brand" ? { ...p, brand: v, branch: "" } : { ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!activity) return setError("Please select an activity type.");
    if (cfg.statusKey && !status) return setError("Please select a status.");
    if (isQuality) {
      if (!callsReviewed || Number(callsReviewed) <= 0) return setError("Please enter the number of calls reviewed.");
      if (!listeningHours || Number(listeningHours) <= 0) return setError("Please enter the total listening time (hours).");
    } else if (!durationMin || Number(durationMin) <= 0) {
      return setError("Please enter the time spent.");
    }

    const payload: any = { activity_type: activity };
    if (cfg.statusKey) payload.status = status;
    payload.duration_seconds = isQuality
      ? Math.round(Number(listeningHours) * 3600)
      : (durationMin ? Math.max(0, Math.round(Number(durationMin) * 60)) : 0);
    if (isQuality) payload.calls_reviewed = Math.round(Number(callsReviewed));
    cfg.fields.forEach((f) => { if (isQuality && f === "brand") return; if (values[f]) payload[f] = values[f]; });
    if (canChoose || isLeader) { payload.log_type = logType; payload.department = cfg.department || currentUser.department; }

    try {
      setLoading(true);
      const res = await apiFetch(editing ? `/api/logs/${editLog!.id}` : "/api/logs", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to save log."); }
      setSuccess(true);
      setTimeout(() => onDone(), 1100);
    } catch (err: any) {
      setError(err.message || "Network error.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full px-4 py-3 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition";
  const selectCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";

  const renderField = (f: string) => {
    const meta = FIELD_META[f];
    if (!meta) return null;
    const common = { value: values[f] || "", onChange: (e: any) => setVal(f, e.target.value) };
    let control: React.ReactNode;
    if (meta.type === "textarea") control = <textarea {...common} rows={f === "notes" ? 3 : 2} className={inputCls + " leading-relaxed"} placeholder={meta.label + "..."} />;
    else if (meta.type === "date") control = <input type="date" {...common} className={inputCls} />;
    else if (meta.type === "brand") control = <select {...common} className={selectCls}><option value="">— Select —</option>{brands.map((b) => <option key={b.id} value={b.brand_name}>{b.brand_name}</option>)}</select>;
    else if (meta.type === "branch") {
      const brandSel = values["brand"];
      const branchOpts = brandSel ? branches.filter((b) => b.brand === brandSel) : (cfg.fields.includes("brand") ? [] : branches);
      control = (
        <select {...common} className={selectCls}>
          <option value="">{cfg.fields.includes("brand") && !brandSel ? "— Select a brand first —" : "— Select —"}</option>
          {branchOpts.map((b) => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
        </select>
      );
    }
    else if (meta.type === "aggregator") control = <select {...common} className={selectCls}><option value="">— Select —</option>{["Talabat", "Keeta", "Other Aggregators"].map((a) => <option key={a} value={a}>{a}</option>)}</select>;
    else if (meta.type === "agent") control = <select {...common} className={selectCls}><option value="">— Select agent —</option>{agents.map((a) => <option key={a} value={a}>{a}</option>)}</select>;
    else control = <input type="text" {...common} className={inputCls} placeholder={meta.label} />;
    const full = meta.type === "textarea";
    return (
      <div key={f} className={`space-y-1.5 ${full ? "md:col-span-2" : ""}`}>
        <label className="text-xs font-bold text-[var(--text)]">{meta.label}:</label>
        {control}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 md:p-8 shadow-xl space-y-6 relative overflow-hidden text-[var(--text)]">
      {success && (
        <div className="absolute inset-0 bg-[var(--surface)]/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-emerald-900/30 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center mb-4"><Check className="w-8 h-8 stroke-[3]" /></div>
          <h3 className="text-lg font-extrabold text-[var(--heading)]">{editing ? "Log Updated!" : "Log Saved!"}</h3>
        </div>
      )}

      <div>
        <h2 className="text-lg font-extrabold text-[var(--heading)] flex items-center gap-2"><ClipboardList className="w-5 h-5 text-blue-400" /> {editing ? "Edit" : "New"} {cfg.title}</h2>
        <p className="text-xs text-[var(--muted)] mt-1 font-light">Date &amp; time are recorded automatically.</p>
      </div>

      {error && (<div className="flex bg-rose-500/10 border border-rose-500/20 text-rose-300 p-4 rounded-2xl text-xs gap-2 items-center"><AlertCircle className="w-5 h-5 shrink-0" /><p className="font-bold">{error}</p></div>)}

      {/* Admin picks any log type; leaders switch between their dept log and Team Leader log */}
      {canPickType && (
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-[var(--text)]">Log Type:</label>
          <select value={logType} onChange={(e) => setLogType(e.target.value as LogType)} className={selectCls}>
            {(canChoose ? (Object.keys(LOG_TYPE_CONFIG) as LogType[]) : leaderChoices).map((t) => <option key={t} value={t}>{LOG_TYPE_CONFIG[t].title}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-[var(--text)]">{cfg.activityLabel}:</label>
          <select value={activity} onChange={(e) => setActivity(e.target.value)} className={selectCls}>
            <option value="">— Select —</option>
            {activityOpts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {cfg.statusKey && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[var(--text)]">Status:</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
              <option value="">— Select —</option>
              {statusOpts.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        {isQuality ? (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text)]">Calls Reviewed (today):</label>
              <input type="number" min={0} value={callsReviewed} onChange={(e) => setCallsReviewed(e.target.value)} placeholder="e.g. 40" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text)]">Total Listening Time (hours):</label>
              <input type="number" min={0} step="0.25" value={listeningHours} onChange={(e) => setListeningHours(e.target.value)} placeholder="e.g. 3.5" className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs font-bold text-emerald-500 flex items-center justify-between">
                <span>Avg review time per call</span>
                <span className="font-mono text-sm">{avgMinutes ? `${avgMinutes} min` : "—"}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[var(--text)]">Time Spent (minutes):</label>
            <input type="number" min={0} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="e.g. 15" className={inputCls} />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[5, 10, 15, 30, 45, 60].map((m) => (
                <button type="button" key={m} onClick={() => setDurationMin(String(m))}
                  className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition ${durationMin === String(m) ? "bg-blue-600 text-white border-blue-600" : "bg-[var(--bg)] text-[var(--muted)] border-[var(--border)] hover:text-white hover:border-blue-500/40"}`}>
                  {m}m
                </button>
              ))}
            </div>
          </div>
        )}
        {(isQuality ? cfg.fields.filter((f) => f !== "brand") : cfg.fields).map(renderField)}
      </div>

      <button type="submit" disabled={loading} className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 text-white font-extrabold rounded-2xl shadow-lg shadow-blue-600/10 transition flex items-center justify-center gap-2 text-sm">
        {loading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>) : (<><Send className="w-4 h-4" /> {editing ? "Update Log" : "Save Log"}</>)}
      </button>
    </form>
  );
}
