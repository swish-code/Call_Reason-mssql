import { useState, useEffect, useCallback, type ReactNode } from "react";
import { User, SurveyAssignment, SurveyQuestion, SurveyCallAttempt, DailyCapacity, SURVEY_SEGMENTS } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import {
  ListChecks, RefreshCw, X, AlertCircle, Phone, CheckCircle2, Target, Inbox,
} from "lucide-react";

interface SurveyQueueProps { currentUser: User; }

const KW_MS = 3 * 60 * 60 * 1000;
const fmtDate = (ts?: string) => {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (isNaN(t)) return String(ts);
  return new Date(t + KW_MS).toISOString().replace('T', ' ').slice(0, 16);
};
const fmtDay = (ts?: string) => {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (isNaN(t)) return String(ts);
  return new Date(t + KW_MS).toISOString().slice(0, 10);
};

const outcomeLabel = (o: string) =>
  o === 'no_answer' ? 'No Answer'
  : o === 'answered' ? 'Answered'
  : o === 'wrong_number' ? 'Wrong Number'
  : o === 'busy' ? 'Busy'
  : 'Declined';

const outcomeColor = (o: string) =>
  o === 'answered' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  : o === 'declined' || o === 'wrong_number' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
  : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20';

const statusLabel = (s: string) =>
  s === 'in_progress' ? 'In Progress'
  : s === 'no_answer' ? 'No Answer'
  : s.charAt(0).toUpperCase() + s.slice(1);

const statusColor = (s: string) =>
  s === 'successful' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  : s === 'in_progress' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
  : s === 'declined' || s === 'unreachable' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
  : s === 'no_answer' ? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
  : 'bg-amber-500/10 text-amber-400 border-amber-500/20';

const inputCls = "px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none";
const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";

interface AnswerState { question_id: string; answer_value: string; answered: boolean; }

export default function SurveyQueue({ currentUser: _currentUser }: SurveyQueueProps) {
  const [queue, setQueue] = useState<SurveyAssignment[]>([]);
  const [todaySuccess, setTodaySuccess] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(0);
  const [capacity, setCapacity] = useState<DailyCapacity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Work modal
  const [workId, setWorkId] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<SurveyAssignment | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [attempts, setAttempts] = useState<SurveyCallAttempt[]>([]);
  const [attemptCount, setAttemptCount] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);

  const [attemptOutcome, setAttemptOutcome] = useState('no_answer');
  const [attemptNote, setAttemptNote] = useState("");
  const [attemptSaving, setAttemptSaving] = useState(false);

  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [responseSaving, setResponseSaving] = useState(false);
  const [actionType, setActionType] = useState<'no_action' | 'complaint'>('no_action');
  const [notReachedSaving, setNotReachedSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const [segment, setSegment] = useState(""); // agent-chosen customer segment
  // Questions shown = shared (no segment) + the chosen segment's questions
  const visibleQuestions = questions.filter(q => !q.segment || q.segment === segment);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch('/api/surveys/queue');
      if (!res.ok) throw new Error("Failed to load queue.");
      const data = await res.json();
      setQueue(data.queue || []);
      setTodaySuccess(data.todaySuccess ?? 0);
      setDailyLimit(data.dailyLimit ?? 0);
    } catch (e: any) {
      setError(e.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCapacity = useCallback(async () => {
    try {
      const res = await apiFetch('/api/surveys/capacity');
      if (res.ok) setCapacity(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchQueue(); fetchCapacity(); }, [fetchQueue, fetchCapacity]);

  const openWork = async (a: SurveyAssignment) => {
    setWorkId(a.id);
    setAssignment(a);
    setQuestions([]);
    setAttempts([]);
    setAttemptCount(a.attempt_count || 0);
    setAttemptOutcome('no_answer');
    setAttemptNote("");
    setAnswers({});
    setSegment("");
    setActionType('no_action');
    setModalError("");
    setDetailLoading(true);
    try {
      const res = await apiFetch(`/api/surveys/assignments/${a.id}`);
      if (res.ok) {
        const data: SurveyAssignment = await res.json();
        setAssignment(data);
        // Auto-select the customer's segment (from the uploaded number) so the right questions load
        if (data.segment) setSegment(data.segment);
        const qs = data.questions || [];
        setQuestions(qs);
        setAttempts(data.attempts || []);
        setAttemptCount(data.attempt_count ?? (data.attempts || []).length);
        const init: Record<string, AnswerState> = {};
        qs.forEach(q => { init[q.id] = { question_id: q.id, answer_value: "", answered: false }; });
        setAnswers(init);
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const closeWork = () => {
    setWorkId(null);
    setAssignment(null);
  };

  const setAnswerValue = (qid: string, value: string) =>
    setAnswers(a => ({ ...a, [qid]: { question_id: qid, answer_value: value, answered: value !== "" } }));

  const logAttempt = async () => {
    if (!workId) return;
    setAttemptSaving(true);
    setModalError("");
    try {
      const res = await apiFetch(`/api/surveys/assignments/${workId}/attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: attemptOutcome, note: attemptNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setModalError(data.error || "Failed to log attempt."); return; }
      // refresh detail
      const detRes = await apiFetch(`/api/surveys/assignments/${workId}`);
      if (detRes.ok) {
        const det: SurveyAssignment = await detRes.json();
        setAttempts(det.attempts || []);
        setAttemptCount(det.attempt_count ?? (det.attempts || []).length);
      }
      setAttemptNote("");
      fetchQueue();
    } catch (e: any) {
      setModalError(e.message || "Attempt error.");
    } finally {
      setAttemptSaving(false);
    }
  };

  const saveResponse = async () => {
    if (!workId) return;
    setModalError("");
    const list = visibleQuestions.map(q => answers[q.id] || { question_id: q.id, answer_value: "", answered: false });
    const hasAnswered = list.some(a => a.answered && a.answer_value.trim() !== "");
    if (!hasAnswered) { setModalError("Answer at least one question."); return; }
    setResponseSaving(true);
    try {
      const res = await apiFetch(`/api/surveys/assignments/${workId}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: list, reachability: 'reached', action_type: actionType, segment: segment || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setModalError(data.error || "Failed to save response."); return; }
      closeWork();
      fetchQueue();
      fetchCapacity();
    } catch (e: any) {
      setModalError(e.message || "Response error.");
    } finally {
      setResponseSaving(false);
    }
  };

  // Close the survey as Not Reached (No Action) — no answers required
  const markNotReached = async () => {
    if (!workId) return;
    if (!window.confirm("Mark this survey as Not Reached (No Action)?\nIt will stay available for reporting.")) return;
    setModalError("");
    setNotReachedSaving(true);
    try {
      const res = await apiFetch(`/api/surveys/assignments/${workId}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reachability: 'not_reached', action_type: 'no_action' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setModalError(data.error || "Failed to update."); return; }
      closeWork();
      fetchQueue();
      fetchCapacity();
    } catch (e: any) {
      setModalError(e.message || "Update error.");
    } finally {
      setNotReachedSaving(false);
    }
  };

  const StatCard = ({ icon, label, value, color }: { icon: ReactNode; label: string; value: number; color: string }) => (
    <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex items-center gap-4">
      <div className={`p-3 rounded-2xl ${color}`}>{icon}</div>
      <div>
        <p className="text-2xl font-extrabold text-[var(--heading)]">{value}</p>
        <p className="text-xs text-[var(--muted)] font-light mt-0.5">{label}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      {/* Header */}
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl">
            <ListChecks className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Survey Queue</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">{queue.length} in queue</p>
          </div>
        </div>
        <button
          onClick={() => { fetchQueue(); fetchCapacity(); }}
          className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={<CheckCircle2 className="w-6 h-6" />} label="Today's Successes" value={todaySuccess} color="bg-emerald-500/10 text-emerald-400" />
        <StatCard icon={<Target className="w-6 h-6" />} label="Daily Limit" value={dailyLimit} color="bg-blue-500/10 text-blue-400" />
        <StatCard icon={<Inbox className="w-6 h-6" />} label="My Queue" value={queue.length} color="bg-violet-500/10 text-violet-400" />
      </div>

      {/* Capacity strip */}
      {capacity.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-4 shadow-lg">
          <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide mb-3">7-Day Capacity</p>
          <div className="flex flex-wrap gap-2">
            {capacity.slice(0, 7).map(c => (
              <div key={c.date} className="flex-1 min-w-[90px] p-3 bg-[var(--bg)] border border-[var(--border)] rounded-2xl text-center">
                <p className="text-[10px] text-[var(--muted)] font-mono">{fmtDay(c.date)}</p>
                <p className="text-sm font-extrabold text-[var(--heading)] mt-1">
                  {c.used}<span className="text-[var(--muted)] font-normal">/{c.limit}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <th className="p-4">Phone</th>
                  <th className="p-4">Brand</th>
                  <th className="p-4">Template</th>
                  <th className="p-4">Scheduled</th>
                  <th className="p-4 text-center">Attempts</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-center">Work</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {queue.map(q => (
                  <tr key={q.id} className="hover:bg-[var(--surface-2)]/40 transition align-middle">
                    <td className="p-4 font-mono text-[var(--heading)] font-bold">{q.customer_phone}</td>
                    <td className="p-4 text-[var(--text)]">{q.brand_name || <span className="text-[var(--muted)]">—</span>}</td>
                    <td className="p-4 text-[var(--text)]">{q.template_name || '—'}</td>
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{fmtDay(q.scheduled_date)}</td>
                    <td className="p-4 text-center font-bold">{q.attempt_count}/3</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${statusColor(q.status)}`}>
                        {statusLabel(q.status)}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <button
                        onClick={() => openWork(q)}
                        className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-xl text-[11px] font-bold transition"
                      >
                        Work
                      </button>
                    </td>
                  </tr>
                ))}
                {queue.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-[var(--muted)]">Your queue is empty.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Work Modal */}
      {workId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-y-auto p-4">
          <div className="min-h-full flex items-start justify-center">
            <div className="w-full max-w-2xl my-6 bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg)]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl"><ListChecks className="w-5 h-5" /></div>
                  <div>
                    <h3 className="text-sm font-extrabold text-[var(--heading)]">Work Survey</h3>
                    <p className="text-[11px] text-[var(--muted)]">
                      {assignment?.customer_phone}{assignment?.brand_name ? ` · ${assignment.brand_name}` : ''}
                      {assignment?.template_name ? ` · ${assignment.template_name}` : ''}
                    </p>
                  </div>
                </div>
                <button onClick={closeWork} className="p-2 hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--heading)] rounded-xl transition">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {detailLoading ? (
                <div className="flex items-center justify-center h-48">
                  <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="p-6 space-y-6">
                  {/* Section A: Log Attempt */}
                  <div className="space-y-3">
                    <p className="text-xs font-extrabold text-[var(--heading)] flex items-center gap-2">
                      <Phone className="w-4 h-4 text-blue-400" /> Log Attempt
                      <span className="text-[var(--muted)] font-normal">({attemptCount}/3)</span>
                    </p>

                    {attempts.length > 0 && (
                      <div className="space-y-2">
                        {attempts.map(a => (
                          <div key={a.id} className="flex items-start gap-3 p-3 bg-[var(--bg)] border border-[var(--border)] rounded-2xl">
                            <span className="text-[11px] font-extrabold text-[var(--muted)] min-w-[20px]">#{a.attempt_number}</span>
                            <div className="flex-1 space-y-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${outcomeColor(a.outcome)}`}>
                                  {outcomeLabel(a.outcome)}
                                </span>
                                <span className="text-[10px] text-[var(--muted)] font-mono">{fmtDate(a.created_at)}</span>
                                {a.agent_name && <span className="text-[10px] text-[var(--muted)]">{a.agent_name}</span>}
                              </div>
                              {a.note && <p className="text-[11px] text-[var(--text)]">{a.note}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="p-4 bg-[var(--bg)] border border-[var(--border)] rounded-2xl space-y-3">
                      <select
                        value={attemptOutcome}
                        onChange={e => setAttemptOutcome(e.target.value)}
                        disabled={attemptCount >= 3}
                        className={`w-full ${selCls} disabled:opacity-50`}
                      >
                        <option value="no_answer">No Answer</option>
                        <option value="answered">Answered</option>
                        <option value="wrong_number">Wrong Number</option>
                        <option value="busy">Busy</option>
                        <option value="declined">Declined</option>
                      </select>
                      <textarea
                        value={attemptNote}
                        onChange={e => setAttemptNote(e.target.value)}
                        rows={2}
                        placeholder="Optional note…"
                        disabled={attemptCount >= 3}
                        className={`w-full resize-none ${inputCls} disabled:opacity-50`}
                      />
                      <button
                        onClick={logAttempt}
                        disabled={attemptSaving || attemptCount >= 3}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition"
                      >
                        {attemptSaving ? 'Saving…' : attemptCount >= 3 ? 'Max attempts reached' : 'Log Attempt'}
                      </button>
                    </div>
                  </div>

                  {/* Section B: Answers */}
                  <div className="space-y-3 border-t border-[var(--border)] pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-extrabold text-[var(--heading)]">Answers</p>
                      {questions.some(q => q.segment) && (
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] font-bold text-[var(--muted)]">Customer Segment:</label>
                          <select value={segment} onChange={e => setSegment(e.target.value)} className="px-3 py-1.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs font-bold focus:ring-1 focus:ring-blue-500 focus:outline-none [&>option]:bg-[var(--surface)]">
                            <option value="">— Select —</option>
                            {SURVEY_SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                          {assignment?.segment && (
                            <span className="text-[10px] font-bold text-emerald-400" title="Detected from the uploaded customer segment">● Auto</span>
                          )}
                        </div>
                      )}
                    </div>

                    {visibleQuestions.length === 0 ? (
                      <p className="text-[11px] text-[var(--muted)]">{questions.some(q => q.segment) ? "Select the customer segment to load its questions." : "No questions defined for this survey."}</p>
                    ) : (
                      <div className="space-y-4">
                        {visibleQuestions.map((q, i) => {
                          const val = answers[q.id]?.answer_value || "";
                          return (
                            <div key={q.id} className="p-4 bg-[var(--bg)] border border-[var(--border)] rounded-2xl space-y-3">
                              <p className="text-xs font-bold text-[var(--text)]">
                                <span className="text-[var(--muted)]">#{i + 1}</span> {q.text}
                              </p>

                              {q.answer_type === 'rating_1_5' && (
                                <div className="flex gap-2">
                                  {[1, 2, 3, 4, 5].map(n => (
                                    <button
                                      key={n}
                                      onClick={() => setAnswerValue(q.id, String(n))}
                                      className={`w-10 h-10 rounded-xl text-sm font-extrabold border transition ${
                                        val === String(n)
                                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                                          : 'bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--surface-2)]'
                                      }`}
                                    >
                                      {n}
                                    </button>
                                  ))}
                                </div>
                              )}

                              {q.answer_type === 'rating_1_10' && (
                                <div className="flex flex-wrap gap-2">
                                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                    <button
                                      key={n}
                                      onClick={() => setAnswerValue(q.id, String(n))}
                                      className={`w-10 h-10 rounded-xl text-sm font-extrabold border transition ${
                                        val === String(n)
                                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                                          : 'bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--surface-2)]'
                                      }`}
                                    >
                                      {n}
                                    </button>
                                  ))}
                                </div>
                              )}

                              {q.answer_type === 'yes_no' && (
                                <div className="flex gap-2">
                                  {['Yes', 'No'].map(opt => (
                                    <button
                                      key={opt}
                                      onClick={() => setAnswerValue(q.id, opt)}
                                      className={`px-5 py-2 rounded-xl text-xs font-extrabold border transition ${
                                        val === opt
                                          ? (opt === 'Yes'
                                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                            : 'bg-rose-500/20 text-rose-400 border-rose-500/40')
                                          : 'bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--surface-2)]'
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  ))}
                                </div>
                              )}

                              {q.answer_type === 'multiple_choice' && (
                                <select
                                  value={val}
                                  onChange={e => setAnswerValue(q.id, e.target.value)}
                                  className={`w-full ${selCls}`}
                                >
                                  <option value="">— Select —</option>
                                  {(q.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                              )}

                              {q.answer_type === 'free_text' && (
                                <textarea
                                  value={val}
                                  onChange={e => setAnswerValue(q.id, e.target.value)}
                                  rows={2}
                                  placeholder="Answer…"
                                  className={`w-full resize-none ${inputCls}`}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Action type for a reached/completed survey */}
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wide">Action</span>
                    <select value={actionType} onChange={e => setActionType(e.target.value as 'no_action' | 'complaint')} className={selCls}>
                      <option value="no_action">No Action</option>
                      <option value="complaint">Complaint</option>
                    </select>
                  </div>

                  {modalError && (
                    <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {modalError}
                    </div>
                  )}

                  <div className="flex justify-between gap-2 pt-1">
                    <button
                      onClick={markNotReached}
                      disabled={notReachedSaving || responseSaving}
                      className="px-4 py-2 bg-rose-600/90 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition"
                      title="Customer did not answer — mark as Not Reached (No Action)"
                    >
                      {notReachedSaving ? 'Saving…' : 'Not Reached (No Action)'}
                    </button>
                    <div className="flex gap-2">
                      <button onClick={closeWork} className="px-4 py-2 bg-[var(--surface-2)] text-[var(--text)] rounded-xl text-xs font-bold transition">
                        Close
                      </button>
                      <button
                        onClick={saveResponse}
                        disabled={responseSaving || questions.length === 0}
                        className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition"
                      >
                        {responseSaving ? 'Saving…' : 'Reached — Save Response'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
