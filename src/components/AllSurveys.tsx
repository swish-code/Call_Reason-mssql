import { useState, useEffect, useCallback } from "react";
import { User, SURVEY_SEGMENTS } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { LayoutList, RefreshCw, Users, CheckCircle2, PhoneOff, Clock, ListChecks, RotateCcw, UserX } from "lucide-react";

interface AllSurveysProps { currentUser: User; }

interface Brand { id: string; brand_name: string; }
interface Agent { id: string; full_name: string; open_tasks?: number; total_tasks?: number; }
interface SurveyRow {
  id: string;
  customer_phone: string;
  brand_name?: string;
  template_name?: string;
  assigned_agent_id?: string | null;
  agent_name?: string | null;
  status: string;
  action_type?: string | null;
  reachability?: string | null;
  attempt_count?: number;
  scheduled_date?: string;
  completed_at?: string | null;
  assignment_mode?: string;
  survey_type?: string;
  segment?: string | null;
  task_no?: number;
}

interface Overview {
  summary: { total: number; reached: number; not_reached: number; refused_not_interested: number; pending: number };
  byTemplate: { template_name: string; total: number; reached: number; not_reached: number; refused_not_interested: number; pending: number }[];
  byAgent: { agent_id: string | null; agent_name: string; assigned: number; completed: number; reached: number; not_reached: number; refused_not_interested: number; pending: number }[];
}

const KW_MS = 3 * 60 * 60 * 1000;
const fmtDateTime = (ts?: string | null) => {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (isNaN(t)) return String(ts);
  return new Date(t + KW_MS).toISOString().replace('T', ' ').slice(0, 16);
};

// Map raw assignment status into the reporting buckets the business cares about
const statusView = (s: string): { label: string; cls: string } => {
  if (s === 'successful') return { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
  if (s === 'unreachable' || s === 'declined') return { label: 'Not Reached', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/20' };
  if (s === 'refused') return { label: 'Refused to Complete', cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' };
  if (s === 'not_interested') return { label: 'Not Interested', cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' };
  if (s === 'in_progress') return { label: 'In Progress', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
  return { label: 'Pending', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
};

const surveyTypeLabel = (t?: string) =>
  t === 'daily_normal' ? 'Daily / Normal'
  : t === 'marketing_general' ? 'Marketing (General)'
  : t === 'marketing_item' ? 'Marketing (Item)'
  : '—';

// "Name — N open" so the assigner sees each agent's live workload in the picker.
const agentOptionLabel = (a: Agent) =>
  a.open_tasks == null ? a.full_name : `${a.full_name} — ${a.open_tasks} open`;

const actionView = (a?: string | null) =>
  a === 'complaint'
    ? <span className="font-bold text-rose-400">Complaint</span>
    : <span className="text-[var(--muted)]">No Action</span>;

const selCls = "px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs font-bold focus:ring-1 focus:ring-blue-500 focus:outline-none [&>option]:bg-[var(--surface)]";

export default function AllSurveys({ currentUser }: AllSurveysProps) {
  const canAssign = ['admin', 'owner', 'manager', 'supervisor', 'leader'].includes(currentUser.role);

  const [rows, setRows] = useState<SurveyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [brands, setBrands] = useState<Brand[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  // Filters
  const [brandId, setBrandId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [status, setStatus] = useState("");
  const [actionType, setActionType] = useState("");
  const [surveyType, setSurveyType] = useState("");
  const [segment, setSegment] = useState("");

  const [savingId, setSavingId] = useState<string | null>(null);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (brandId) p.set('brand_id', brandId);
    if (agentId) p.set('agent_id', agentId);
    if (status) p.set('status', status);
    if (actionType) p.set('action_type', actionType);
    if (surveyType) p.set('survey_type', surveyType);
    if (segment) p.set('segment', segment);
    return p.toString();
  }, [brandId, agentId, status, actionType, surveyType, segment]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = buildQuery();
      // The overview takes the same filters, so its numbers always describe
      // exactly the rows listed below it.
      const [res, ovRes] = await Promise.all([
        apiFetch(`/api/surveys/all?${q}`),
        apiFetch(`/api/surveys/overview?${q}`),
      ]);
      if (!res.ok) throw new Error("Failed to load surveys.");
      const data = await res.json();
      setRows(data.records || []);
      setTotal(data.total ?? (data.records?.length || 0));
      setOverview(ovRes.ok ? await ovRes.json() : null);
    } catch (e: any) {
      setError(e.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    apiFetch('/api/brands').then(r => r.ok ? r.json() : []).then(setBrands).catch(() => {});
    if (canAssign) apiFetch('/api/surveys/agents/workload').then(r => r.ok ? r.json() : []).then(setAgents).catch(() => {});
  }, [canAssign]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const reassign = async (id: string, newAgentId: string) => {
    setSavingId(id);
    try {
      const res = await apiFetch(`/api/surveys/assignments/${id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: newAgentId || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Failed to assign."); return; }
      // Update the row in place
      const updated = await res.json();
      setRows(rs => rs.map(r => r.id === id ? { ...r, assigned_agent_id: updated.assigned_agent_id, agent_name: updated.agent_name } : r));
    } catch (e: any) {
      setError(e.message || "Assign error.");
    } finally {
      setSavingId(null);
    }
  };

  // Team-leader edit of a survey's outcome (status / action), and the
  // "return to Pending" path for reworking a finished survey.
  const patchRow = async (id: string, body: Record<string, string>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setSavingId(id);
    try {
      const res = await apiFetch(`/api/surveys/assignments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Failed to update."); return; }
      // Counts shift with every outcome change, so refresh list + overview together.
      await fetchRows();
    } catch (e: any) {
      setError(e.message || "Update error.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      {/* Header */}
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl"><LayoutList className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">All Surveys</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">
              {total.toLocaleString()} survey(s)
              {total > rows.length && <span className="text-amber-400"> — showing latest {rows.length.toLocaleString()}</span>}
            </p>
          </div>
        </div>
        <button onClick={fetchRows} className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={brandId} onChange={e => setBrandId(e.target.value)} className={selCls}>
          <option value="">All Brands</option>
          {brands.map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
        </select>
        <select value={agentId} onChange={e => setAgentId(e.target.value)} className={selCls}>
          <option value="">All Agents</option>
          <option value="unassigned">Unassigned</option>
          {agents.length > 0 && <option disabled>──────────</option>}
          {agents.map(a => <option key={a.id} value={a.id}>{agentOptionLabel(a)}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className={selCls}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed — Reached</option>
          <option value="not_reached">Completed — Not Reached</option>
          <option value="refused">Refused to Complete</option>
          <option value="not_interested">Not Interested</option>
        </select>
        <select value={actionType} onChange={e => setActionType(e.target.value)} className={selCls}>
          <option value="">All Actions</option>
          <option value="no_action">No Action</option>
          <option value="complaint">Complaint</option>
        </select>
        <select value={surveyType} onChange={e => setSurveyType(e.target.value)} className={selCls} title="Survey type">
          <option value="">All Survey Types</option>
          <option value="daily_normal">Daily / Normal</option>
          <option value="marketing_general">Marketing (General)</option>
          <option value="marketing_item">Marketing (Item)</option>
        </select>
        <select value={segment} onChange={e => setSegment(e.target.value)} className={selCls} title="Customer segment">
          <option value="">All Segments</option>
          {SURVEY_SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
          <option value="none">— No segment —</option>
        </select>
      </div>

      {error && <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400">{error}</div>}

      {/* Overview — headline counts for whatever the filters currently select */}
      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: 'Total Surveys', value: overview.summary.total, icon: ListChecks, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
            { label: 'Completed — Reached', value: overview.summary.reached, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            { label: 'Completed — Not Reached', value: overview.summary.not_reached, icon: PhoneOff, color: 'text-rose-400', bg: 'bg-rose-500/10' },
            { label: 'Refused / Not Interested', value: overview.summary.refused_not_interested, icon: UserX, color: 'text-orange-400', bg: 'bg-orange-500/10' },
            { label: 'Pending', value: overview.summary.pending, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          ].map(c => (
            <div key={c.label} className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex items-center gap-4">
              <div className={`p-3 ${c.bg} ${c.color} rounded-2xl`}><c.icon className="w-5 h-5" /></div>
              <div className="min-w-0">
                <p className="text-2xl font-extrabold text-[var(--heading)] leading-none">{c.value.toLocaleString()}</p>
                <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide mt-1.5">{c.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Per-survey (template) breakdown */}
      {overview && overview.byTemplate.length > 0 && (
        <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-3xl">
          <h3 className="text-sm font-bold text-[var(--heading)] mb-4 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-indigo-400" /> Surveys by Name
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] uppercase tracking-wide">
                  <th className="text-left py-2 px-2">Survey Name</th>
                  <th className="text-center py-2 px-2">Total</th>
                  <th className="text-center py-2 px-2">Reached</th>
                  <th className="text-center py-2 px-2">Not Reached</th>
                  <th className="text-center py-2 px-2">Refused/NI</th>
                  <th className="text-center py-2 px-2">Pending</th>
                </tr>
              </thead>
              <tbody>
                {overview.byTemplate.map(t => (
                  <tr key={t.template_name} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30 transition">
                    <td className="py-2 px-2 font-bold text-[var(--heading)]">{t.template_name}</td>
                    <td className="py-2 px-2 text-center font-mono text-[var(--text)]">{t.total}</td>
                    <td className="py-2 px-2 text-center font-mono text-emerald-400">{t.reached}</td>
                    <td className="py-2 px-2 text-center font-mono text-rose-400">{t.not_reached}</td>
                    <td className="py-2 px-2 text-center font-mono text-orange-400">{t.refused_not_interested}</td>
                    <td className="py-2 px-2 text-center font-mono text-amber-400">{t.pending}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-agent performance */}
      {overview && overview.byAgent.length > 0 && (
        <div className="bg-[var(--surface)] p-6 border border-[var(--border)] shadow-lg rounded-3xl">
          <h3 className="text-sm font-bold text-[var(--heading)] mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-400" /> Agent Performance
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] uppercase tracking-wide">
                  <th className="text-left py-2 px-2">Agent</th>
                  <th className="text-center py-2 px-2">Assigned</th>
                  <th className="text-center py-2 px-2">Completed</th>
                  <th className="text-center py-2 px-2">Reached</th>
                  <th className="text-center py-2 px-2">Not Reached</th>
                  <th className="text-center py-2 px-2">Refused/NI</th>
                  <th className="text-center py-2 px-2">Pending</th>
                </tr>
              </thead>
              <tbody>
                {overview.byAgent.map(a => (
                  <tr key={a.agent_id ?? 'unassigned'} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--surface-2)]/30 transition">
                    <td className="py-2 px-2 font-bold text-[var(--heading)]">{a.agent_name}</td>
                    <td className="py-2 px-2 text-center font-mono text-blue-400">{a.assigned}</td>
                    <td className="py-2 px-2 text-center font-mono text-[var(--text)]">{a.completed}</td>
                    <td className="py-2 px-2 text-center font-mono text-emerald-400">{a.reached}</td>
                    <td className="py-2 px-2 text-center font-mono text-rose-400">{a.not_reached}</td>
                    <td className="py-2 px-2 text-center font-mono text-orange-400">{a.refused_not_interested}</td>
                    <td className="py-2 px-2 text-center font-mono text-amber-400">{a.pending}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-[var(--surface)] border border-[var(--border)] shadow-lg rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] uppercase tracking-wide">
                <th className="text-left p-4">Task #</th>
                <th className="text-left p-4">Phone</th>
                <th className="text-left p-4">Brand</th>
                <th className="text-left p-4">Type</th>
                <th className="text-left p-4">Template</th>
                <th className="text-left p-4">Segment</th>
                <th className="text-left p-4">Assigned Agent</th>
                <th className="text-center p-4">Status</th>
                <th className="text-center p-4">Reachability</th>
                <th className="text-center p-4">Action</th>
                <th className="text-center p-4">Attempts</th>
                <th className="text-left p-4">Scheduled</th>
                <th className="text-left p-4">Completed</th>
                {canAssign && <th className="text-center p-4">Reopen</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? (
                <tr><td colSpan={canAssign ? 14 : 13} className="p-8 text-center text-[var(--muted)]">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={canAssign ? 14 : 13} className="p-8 text-center text-[var(--muted)]">No surveys found.</td></tr>
              ) : rows.map(r => {
                const sv = statusView(r.status);
                return (
                  <tr key={r.id} className="hover:bg-[var(--surface-2)]/40 transition align-middle">
                    <td className="p-4 font-mono text-[11px] font-bold text-indigo-400 whitespace-nowrap">
                      {r.task_no != null ? `#${r.task_no}` : '—'}
                    </td>
                    <td className="p-4 font-mono text-[11px] text-[var(--heading)]">{r.customer_phone || '—'}</td>
                    <td className="p-4 text-[var(--text)]">{r.brand_name || '—'}</td>
                    <td className="p-4 text-[var(--muted)] text-[11px]">{surveyTypeLabel(r.survey_type)}</td>
                    <td className="p-4 text-[var(--muted)]">{r.template_name || '—'}</td>
                    <td className="p-4">
                      {r.segment
                        ? <span className="px-2 py-1 bg-indigo-500/10 text-indigo-400 rounded-lg text-[10px] font-bold">{r.segment}</span>
                        : <span className="text-[var(--muted)]">—</span>}
                    </td>
                    <td className="p-4">
                      {canAssign ? (
                        <select
                          value={r.assigned_agent_id || ""}
                          disabled={savingId === r.id}
                          onChange={e => reassign(r.id, e.target.value)}
                          className={selCls + " min-w-[9rem]"}
                          title="Assign / reassign to an active agent"
                        >
                          <option value="">— Unassigned —</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{agentOptionLabel(a)}</option>)}
                        </select>
                      ) : (
                        r.agent_name
                          ? <span className="inline-flex items-center gap-1 px-2 py-1 bg-violet-500/10 text-violet-400 rounded-lg font-bold"><Users className="w-3 h-3" />{r.agent_name}</span>
                          : <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      {canAssign ? (
                        <select
                          value={r.status}
                          disabled={savingId === r.id}
                          onChange={e => patchRow(r.id, { status: e.target.value })}
                          className={selCls + " min-w-[10rem]"}
                          title="Change this survey's status"
                        >
                          <option value="pending">Pending</option>
                          {r.status === 'in_progress' && <option value="in_progress">In Progress</option>}
                          <option value="successful">Completed — Reached</option>
                          <option value="unreachable">Completed — Not Reached</option>
                          <option value="refused">Refused to Complete</option>
                          <option value="not_interested">Not Interested</option>
                        </select>
                      ) : (
                        <span className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${sv.cls}`}>{sv.label}</span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      {r.reachability === 'reached' ? <span className="text-emerald-400 font-bold">Reached</span>
                        : r.reachability === 'not_reached' ? <span className="text-rose-400 font-bold">Not Reached</span>
                        : <span className="text-[var(--muted)]">—</span>}
                    </td>
                    <td className="p-4 text-center">
                      {canAssign ? (
                        <select
                          value={r.action_type || 'no_action'}
                          disabled={savingId === r.id}
                          onChange={e => patchRow(r.id, { action_type: e.target.value })}
                          className={selCls + " min-w-[7rem]"}
                          title="Change this survey's action"
                        >
                          <option value="no_action">No Action</option>
                          <option value="complaint">Complaint</option>
                        </select>
                      ) : actionView(r.action_type)}
                    </td>
                    <td className="p-4 text-center font-mono text-[var(--muted)]">{r.attempt_count ?? 0}/3</td>
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{r.scheduled_date || '—'}</td>
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{fmtDateTime(r.completed_at)}</td>
                    {canAssign && (
                      <td className="p-4 text-center">
                        {['successful', 'unreachable', 'declined', 'refused', 'not_interested'].includes(r.status) ? (
                          <button
                            onClick={() => patchRow(r.id, { status: 'pending' },
                              "Return this survey to Pending?\nIts outcome and call attempts will be cleared so it can be worked again.")}
                            disabled={savingId === r.id}
                            className="px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 transition disabled:opacity-50"
                            title="Send back to Pending for rework"
                          >
                            <RotateCcw className="w-3 h-3" /> Reopen
                          </button>
                        ) : <span className="text-[var(--muted)]">—</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
