import { useState, useEffect, useCallback } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { LayoutList, RefreshCw, Users } from "lucide-react";

interface AllSurveysProps { currentUser: User; }

interface Brand { id: string; brand_name: string; }
interface Agent { id: string; full_name: string; }
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
}

const KW_MS = 3 * 60 * 60 * 1000;
const fmtDateTime = (ts?: string | null) => {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (isNaN(t)) return String(ts);
  return new Date(t + KW_MS).toISOString().replace('T', ' ').slice(0, 16);
};

// Map raw assignment status into the three reporting buckets the business cares about
const statusView = (s: string): { label: string; cls: string } => {
  if (s === 'successful') return { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
  if (s === 'unreachable' || s === 'declined') return { label: 'Not Reached', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/20' };
  if (s === 'in_progress') return { label: 'In Progress', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
  return { label: 'Pending', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
};

const actionView = (a?: string | null) =>
  a === 'complaint'
    ? <span className="font-bold text-rose-400">Complaint</span>
    : <span className="text-[var(--muted)]">No Action</span>;

const selCls = "px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs font-bold focus:ring-1 focus:ring-blue-500 focus:outline-none [&>option]:bg-[var(--surface)]";

export default function AllSurveys({ currentUser }: AllSurveysProps) {
  const canAssign = ['admin', 'owner', 'manager', 'supervisor', 'leader'].includes(currentUser.role);

  const [rows, setRows] = useState<SurveyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [brands, setBrands] = useState<Brand[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  // Filters
  const [brandId, setBrandId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [status, setStatus] = useState("");
  const [actionType, setActionType] = useState("");

  const [savingId, setSavingId] = useState<string | null>(null);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (brandId) p.set('brand_id', brandId);
    if (agentId) p.set('agent_id', agentId);
    if (status) p.set('status', status);
    if (actionType) p.set('action_type', actionType);
    return p.toString();
  }, [brandId, agentId, status, actionType]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/surveys/all?${buildQuery()}`);
      if (!res.ok) throw new Error("Failed to load surveys.");
      const data = await res.json();
      setRows(data.records || []);
      setTotal(data.total ?? (data.records?.length || 0));
    } catch (e: any) {
      setError(e.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    apiFetch('/api/brands').then(r => r.ok ? r.json() : []).then(setBrands).catch(() => {});
    if (canAssign) apiFetch('/api/surveys/agents').then(r => r.ok ? r.json() : []).then(setAgents).catch(() => {});
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
          {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className={selCls}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="not_reached">Not Reached</option>
        </select>
        <select value={actionType} onChange={e => setActionType(e.target.value)} className={selCls}>
          <option value="">All Actions</option>
          <option value="no_action">No Action</option>
          <option value="complaint">Complaint</option>
        </select>
      </div>

      {error && <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400">{error}</div>}

      {/* Table */}
      <div className="bg-[var(--surface)] border border-[var(--border)] shadow-lg rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-[var(--muted)] font-bold border-b border-[var(--border)] uppercase tracking-wide">
                <th className="text-left p-4">Phone</th>
                <th className="text-left p-4">Brand</th>
                <th className="text-left p-4">Template</th>
                <th className="text-left p-4">Assigned Agent</th>
                <th className="text-center p-4">Status</th>
                <th className="text-center p-4">Reachability</th>
                <th className="text-center p-4">Action</th>
                <th className="text-center p-4">Attempts</th>
                <th className="text-left p-4">Scheduled</th>
                <th className="text-left p-4">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? (
                <tr><td colSpan={10} className="p-8 text-center text-[var(--muted)]">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="p-8 text-center text-[var(--muted)]">No surveys found.</td></tr>
              ) : rows.map(r => {
                const sv = statusView(r.status);
                return (
                  <tr key={r.id} className="hover:bg-[var(--surface-2)]/40 transition align-middle">
                    <td className="p-4 font-mono text-[11px] text-[var(--heading)]">{r.customer_phone || '—'}</td>
                    <td className="p-4 text-[var(--text)]">{r.brand_name || '—'}</td>
                    <td className="p-4 text-[var(--muted)]">{r.template_name || '—'}</td>
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
                          {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                        </select>
                      ) : (
                        r.agent_name
                          ? <span className="inline-flex items-center gap-1 px-2 py-1 bg-violet-500/10 text-violet-400 rounded-lg font-bold"><Users className="w-3 h-3" />{r.agent_name}</span>
                          : <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="p-4 text-center"><span className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${sv.cls}`}>{sv.label}</span></td>
                    <td className="p-4 text-center">
                      {r.reachability === 'reached' ? <span className="text-emerald-400 font-bold">Reached</span>
                        : r.reachability === 'not_reached' ? <span className="text-rose-400 font-bold">Not Reached</span>
                        : <span className="text-[var(--muted)]">—</span>}
                    </td>
                    <td className="p-4 text-center">{actionView(r.action_type)}</td>
                    <td className="p-4 text-center font-mono text-[var(--muted)]">{r.attempt_count ?? 0}/3</td>
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{r.scheduled_date || '—'}</td>
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{fmtDateTime(r.completed_at)}</td>
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
