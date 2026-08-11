import { useState, useEffect, useCallback } from "react";
import { User, SurveyCampaign, SurveyTemplate, Brand } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import SurveyDataUploadButton from "./SurveyDataUploadButton.tsx";
import {
  Megaphone, RefreshCw, Plus, X, AlertCircle, Upload, FileDown, Users, Ban, RotateCcw,
} from "lucide-react";

interface SurveyCampaignsProps { currentUser: User; }
interface Agent { id: string; full_name: string; role: string; }
interface NumbersResult {
  total: number; inserted: number; duplicates_file: number;
  duplicates_10day: number; already_queued: number;
  scheduled?: { date: string; count: number }[]; first_date?: string; today_full?: boolean; daily_limit?: number;
  errors: { row: number; message: string }[];
}

const KW_MS = 3 * 60 * 60 * 1000;
const fmtDate = (ts?: string) => {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (isNaN(t)) return String(ts);
  return new Date(t + KW_MS).toISOString().replace('T', ' ').slice(0, 16);
};

const statusLabel = (s: string) =>
  s === 'full_today' ? 'Full Today'
  : s.charAt(0).toUpperCase() + s.slice(1);

const statusColor = (s: string) =>
  s === 'pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  : s === 'active' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
  : s === 'full_today' ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
  : s === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  : 'bg-rose-500/10 text-rose-400 border-rose-500/20';

const downloadBase64 = (b64: string, filename: string) => {
  const a = document.createElement('a');
  a.href = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + b64;
  a.download = filename;
  a.click();
};

const readFileBase64 = (file: File): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

const inputCls = "px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none";
const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";

const LEADER_ROLES = ['admin', 'owner', 'manager', 'supervisor', 'leader'];

export default function SurveyCampaigns({ currentUser }: SurveyCampaignsProps) {
  const [campaigns, setCampaigns] = useState<SurveyCampaign[]>([]);
  const [templates, setTemplates] = useState<SurveyTemplate[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isLeader = LEADER_ROLES.includes(currentUser.role);

  // Request modal
  const [showRequest, setShowRequest] = useState(false);
  const [reqBrand, setReqBrand] = useState("");
  const [reqTemplate, setReqTemplate] = useState("");
  const [reqType, setReqType] = useState("daily_normal");
  const [reqMode, setReqMode] = useState("open");
  const [reqContinuity, setReqContinuity] = useState("one_time_slot");
  const [reqCount, setReqCount] = useState(50);
  const [reqDuration, setReqDuration] = useState(7);
  const [reqAgent, setReqAgent] = useState("");
  const [reqSaving, setReqSaving] = useState(false);
  const [reqError, setReqError] = useState("");

  // Numbers modal
  const [numbersFor, setNumbersFor] = useState<SurveyCampaign | null>(null);
  const [numbersFile, setNumbersFile] = useState<File | null>(null);
  const [numbersUploading, setNumbersUploading] = useState(false);
  const [numbersResult, setNumbersResult] = useState<NumbersResult | null>(null);
  const [numbersError, setNumbersError] = useState("");

  // Assign modal
  const [assignFor, setAssignFor] = useState<SurveyCampaign | null>(null);
  const [assignAgent, setAssignAgent] = useState("");
  const [assignCount, setAssignCount] = useState(10);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [assignResult, setAssignResult] = useState<number | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch('/api/survey-campaigns');
      if (!res.ok) throw new Error("Failed to load campaigns.");
      setCampaigns(await res.json());
    } catch (e: any) {
      setError(e.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    apiFetch('/api/brands').then(r => r.ok ? r.json() : []).then(setBrands).catch(() => {});
    apiFetch('/api/survey-templates').then(r => r.ok ? r.json() : []).then((t: SurveyTemplate[]) =>
      setTemplates(t.filter(x => x.active))).catch(() => {});
    apiFetch('/api/surveys/agents').then(r => r.ok ? r.json() : []).then(setAgents).catch(() => {});
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const submitRequest = async () => {
    setReqError("");
    if (reqMode === 'assigned' && !reqAgent) { setReqError("Select an agent for assigned mode."); return; }
    const body: any = {
      brand_id: reqBrand || null,
      template_id: reqTemplate || null,
      survey_type: reqType,
      assignment_mode: reqMode,
      continuity_type: reqContinuity,
      requested_count: Number(reqCount),
      duration_days: Number(reqDuration),
    };
    if (reqMode === 'assigned') body.default_agent_id = reqAgent;
    setReqSaving(true);
    try {
      const res = await apiFetch('/api/survey-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setReqError(data.error || "Request failed."); return; }
      setShowRequest(false);
      fetchCampaigns();
    } catch (e: any) {
      setReqError(e.message || "Request error.");
    } finally {
      setReqSaving(false);
    }
  };

  const openNumbers = (c: SurveyCampaign) => {
    setNumbersFor(c);
    setNumbersFile(null);
    setNumbersResult(null);
    setNumbersError("");
  };

  const handleNumbersTemplate = async () => {
    const res = await apiFetch('/api/survey-campaigns/numbers/template');
    if (!res.ok) return;
    const data = await res.json();
    downloadBase64(data.file, data.filename);
  };

  const handleNumbersUpload = async () => {
    if (!numbersFor || !numbersFile) return;
    setNumbersUploading(true);
    setNumbersError("");
    setNumbersResult(null);
    try {
      const b64 = await readFileBase64(numbersFile);
      const res = await apiFetch(`/api/survey-campaigns/${numbersFor.id}/numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: b64 }),
      });
      const data = await res.json();
      if (!res.ok) { setNumbersError(data.error || "Upload failed."); return; }
      setNumbersResult(data);
      fetchCampaigns();
    } catch (e: any) {
      setNumbersError(e.message || "Upload error.");
    } finally {
      setNumbersUploading(false);
    }
  };

  const openAssign = (c: SurveyCampaign) => {
    setAssignFor(c);
    setAssignAgent("");
    setAssignCount(10);
    setAssignError("");
    setAssignResult(null);
  };

  const handleAssign = async () => {
    if (!assignFor) return;
    setAssignError("");
    if (!assignAgent) { setAssignError("Select an agent."); return; }
    setAssigning(true);
    setAssignResult(null);
    try {
      const res = await apiFetch(`/api/surveys/campaigns/${assignFor.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: assignAgent, count: Number(assignCount) }),
      });
      const data = await res.json();
      if (!res.ok) { setAssignError(data.error || "Assignment failed."); return; }
      setAssignResult(data.assigned ?? 0);
      fetchCampaigns();
    } catch (e: any) {
      setAssignError(e.message || "Assignment error.");
    } finally {
      setAssigning(false);
    }
  };

  const cancelCampaign = async (c: SurveyCampaign) => {
    const res = await apiFetch(`/api/survey-campaigns/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    if (res.ok) fetchCampaigns();
  };

  // Un-cancel a campaign — its pending numbers stay in survey_assignments while
  // cancelled (they're just hidden from the live queue), so reactivating makes
  // them reappear without needing to re-upload anything.
  const reactivateCampaign = async (c: SurveyCampaign) => {
    const res = await apiFetch(`/api/survey-campaigns/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    if (res.ok) fetchCampaigns();
  };

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      {/* Header */}
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl">
            <Megaphone className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Survey Campaigns</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">{campaigns.length} campaign(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchCampaigns}
            className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <SurveyDataUploadButton currentUser={currentUser} />
          {isLeader && (
            <button
              onClick={() => { setShowRequest(true); setReqError(""); }}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" /> Request Survey
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[240px]">
          <div className="w-10 h-10 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg)] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                <tr>
                  <th className="p-4">Brand</th>
                  <th className="p-4">Template</th>
                  <th className="p-4">Mode</th>
                  <th className="p-4">Continuity</th>
                  <th className="p-4">Progress</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Requested By</th>
                  <th className="p-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {campaigns.map(c => (
                  <tr key={c.id} className="hover:bg-[var(--surface-2)]/40 transition align-middle">
                    <td className="p-4 font-bold text-[var(--heading)]">{c.brand_name || <span className="text-[var(--muted)] font-normal">General</span>}</td>
                    <td className="p-4 text-[var(--text)]">{c.template_name || '—'}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        c.assignment_mode === 'assigned'
                          ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                          : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      }`}>
                        {c.assignment_mode === 'assigned' ? 'Assigned' : 'Open'}
                      </span>
                    </td>
                    <td className="p-4 text-[var(--muted)] text-[11px]">
                      {c.continuity_type === 'continuous' ? 'Continuous' : 'One-time'}
                    </td>
                    <td className="p-4 font-mono text-[11px] text-[var(--text)]">
                      {c.done_numbers ?? 0}/{c.total_numbers ?? 0}
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${statusColor(c.status)}`}>
                        {statusLabel(c.status)}
                      </span>
                    </td>
                    <td className="p-4 text-[var(--muted)] text-[11px]">{c.requested_by_name || '—'}</td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => openNumbers(c)}
                          className="px-2.5 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition"
                        >
                          <Upload className="w-3 h-3" /> Numbers
                        </button>
                        {isLeader && (
                          <button
                            onClick={() => openAssign(c)}
                            className="px-2.5 py-1.5 bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition"
                          >
                            <Users className="w-3 h-3" /> Assign
                          </button>
                        )}
                        {c.status !== 'cancelled' && c.status !== 'completed' && (
                          <button
                            onClick={() => cancelCampaign(c)}
                            className="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition"
                          >
                            <Ban className="w-3 h-3" /> Cancel
                          </button>
                        )}
                        {c.status === 'cancelled' && (
                          <button
                            onClick={() => reactivateCampaign(c)}
                            title="Reactivate — its pending numbers reappear in the Survey Queue"
                            className="px-2.5 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition"
                          >
                            <RotateCcw className="w-3 h-3" /> Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {campaigns.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-[var(--muted)]">No campaigns found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Request Modal */}
      {showRequest && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-y-auto p-4">
          <div className="min-h-full flex items-start justify-center">
            <div className="w-full max-w-lg my-6 bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg)]">
                <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2">
                  <Plus className="w-4 h-4 text-blue-400" /> Request Survey
                </h3>
                <button onClick={() => setShowRequest(false)} className="p-2 hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--heading)] rounded-xl transition">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text)]">Brand (optional)</label>
                    <select value={reqBrand} onChange={e => setReqBrand(e.target.value)} className={`w-full ${selCls}`}>
                      <option value="">General</option>
                      {brands.map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text)]">Template</label>
                    <select value={reqTemplate} onChange={e => setReqTemplate(e.target.value)} className={`w-full ${selCls}`}>
                      <option value="">— None —</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text)]">Survey Type</label>
                    <select value={reqType} onChange={e => setReqType(e.target.value)} className={`w-full ${selCls}`}>
                      <option value="daily_normal">Daily Normal</option>
                      <option value="marketing_item">Marketing (Item)</option>
                      <option value="marketing_general">Marketing (General)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text)]">Assignment Mode</label>
                    <select value={reqMode} onChange={e => setReqMode(e.target.value)} className={`w-full ${selCls}`}>
                      <option value="open">Open</option>
                      <option value="assigned">Assigned</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text)]">Continuity</label>
                    <select value={reqContinuity} onChange={e => setReqContinuity(e.target.value)} className={`w-full ${selCls}`}>
                      <option value="one_time_slot">One-time Slot</option>
                      <option value="continuous">Continuous</option>
                    </select>
                  </div>
                  {reqMode === 'assigned' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--text)]">Agent</label>
                      <select value={reqAgent} onChange={e => setReqAgent(e.target.value)} className={`w-full ${selCls}`}>
                        <option value="">— Select —</option>
                        {agents.map(a => <option key={a.id} value={a.id}>{a.full_name} ({a.role})</option>)}
                      </select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text)]">Requested Count</label>
                    <input type="number" min={1} value={reqCount} onChange={e => setReqCount(Number(e.target.value))} className={`w-full ${inputCls}`} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text)]">Duration (days)</label>
                    <input type="number" min={1} value={reqDuration} onChange={e => setReqDuration(Number(e.target.value))} className={`w-full ${inputCls}`} />
                  </div>
                </div>

                {reqError && (
                  <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {reqError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setShowRequest(false)} className="px-4 py-2 bg-[var(--surface-2)] text-[var(--text)] rounded-xl text-xs font-bold transition">
                    Cancel
                  </button>
                  <button
                    onClick={submitRequest}
                    disabled={reqSaving}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition"
                  >
                    {reqSaving ? 'Submitting…' : 'Submit Request'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Numbers Modal */}
      {numbersFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2">
                <Upload className="w-4 h-4 text-blue-400" /> Upload Numbers
              </h3>
              <button onClick={() => setNumbersFor(null)} className="p-1.5 hover:bg-[var(--surface-2)] text-[var(--muted)] rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={handleNumbersTemplate}
              className="w-full px-4 py-2.5 bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95"
            >
              <FileDown className="w-4 h-4" /> Download Template
            </button>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--text)]">File (.xlsx / .xls)</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={e => setNumbersFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-[var(--text)] file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-700 file:cursor-pointer"
              />
            </div>

            {numbersError && (
              <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {numbersError}
              </div>
            )}

            {numbersResult && (
              <div className="p-4 bg-emerald-950/20 border border-emerald-500/20 rounded-xl space-y-2">
                <p className="text-xs font-extrabold text-emerald-400">Upload Complete</p>
                <div className="grid grid-cols-2 gap-1 text-[11px] text-[var(--text)]">
                  <span className="text-[var(--muted)]">Total rows:</span><span className="font-bold">{numbersResult.total}</span>
                  <span className="text-[var(--muted)]">Inserted:</span><span className="font-bold text-emerald-400">{numbersResult.inserted}</span>
                  <span className="text-[var(--muted)]">Dup (file):</span><span className="font-bold">{numbersResult.duplicates_file}</span>
                  <span className="text-[var(--muted)]">Dup (10-day):</span><span className="font-bold">{numbersResult.duplicates_10day}</span>
                  <span className="text-[var(--muted)]">Already queued:</span><span className="font-bold">{numbersResult.already_queued}</span>
                </div>
                {numbersResult.today_full && (
                  <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[11px] text-amber-400 font-bold">
                    Today is full ({numbersResult.daily_limit}/day). Numbers start on {numbersResult.first_date}.
                  </div>
                )}
                {numbersResult.scheduled && numbersResult.scheduled.length > 0 && (
                  <div className="mt-1 space-y-1">
                    <p className="text-[11px] font-bold text-[var(--muted)]">Scheduled across days</p>
                    <div className="flex flex-wrap gap-1.5">
                      {numbersResult.scheduled.map(s => (
                        <span key={s.date} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          {s.date.slice(5)}: {s.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {numbersResult.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[11px] font-bold text-rose-400">Errors ({numbersResult.errors.length})</p>
                    <div className="max-h-28 overflow-y-auto space-y-1">
                      {numbersResult.errors.map((e, i) => (
                        <div key={i} className="text-[11px] text-rose-300">Row {e.row}: {e.message}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setNumbersFor(null)} className="px-4 py-2 bg-[var(--surface-2)] text-[var(--text)] rounded-xl text-xs font-bold transition">
                Close
              </button>
              <button
                onClick={handleNumbersUpload}
                disabled={!numbersFile || numbersUploading}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition"
              >
                {numbersUploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Modal */}
      {assignFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-400" /> Assign Numbers
              </h3>
              <button onClick={() => setAssignFor(null)} className="p-1.5 hover:bg-[var(--surface-2)] text-[var(--muted)] rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--text)]">Agent</label>
              <select value={assignAgent} onChange={e => setAssignAgent(e.target.value)} className={`w-full ${selCls}`}>
                <option value="">— Select —</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.full_name} ({a.role})</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--text)]">Count</label>
              <input type="number" min={1} value={assignCount} onChange={e => setAssignCount(Number(e.target.value))} className={`w-full ${inputCls}`} />
            </div>

            {assignError && (
              <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {assignError}
              </div>
            )}

            {assignResult !== null && (
              <div className="p-3 bg-emerald-950/20 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 font-bold">
                Assigned {assignResult} number(s).
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setAssignFor(null)} className="px-4 py-2 bg-[var(--surface-2)] text-[var(--text)] rounded-xl text-xs font-bold transition">
                Close
              </button>
              <button
                onClick={handleAssign}
                disabled={assigning}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition"
              >
                {assigning ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
