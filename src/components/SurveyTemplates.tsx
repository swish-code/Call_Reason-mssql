import { useState, useEffect, useCallback } from "react";
import { User, SurveyTemplate, SurveyQuestion, AnswerType, Brand, SURVEY_SEGMENTS } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import {
  ClipboardList, RefreshCw, Plus, X, AlertCircle, Trash2,
} from "lucide-react";

interface SurveyTemplatesProps { currentUser: User; }

const KW_MS = 3 * 60 * 60 * 1000;
const fmtDate = (ts?: string) => {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (isNaN(t)) return String(ts);
  return new Date(t + KW_MS).toISOString().replace('T', ' ').slice(0, 16);
};

const inputCls = "px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none";
const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";

interface QRow { text: string; answer_type: AnswerType; optionsText: string; segment: string; }

export default function SurveyTemplates({ currentUser }: SurveyTemplatesProps) {
  const [templates, setTemplates] = useState<SurveyTemplate[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState("");
  const [rows, setRows] = useState<QRow[]>([{ text: "", answer_type: "rating_1_5", optionsText: "", segment: "" }]);
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const canManage = ['admin', 'manager', 'supervisor', 'leader'].includes(currentUser.role);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch('/api/survey-templates');
      if (!res.ok) throw new Error("Failed to load templates.");
      setTemplates(await res.json());
    } catch (e: any) {
      setError(e.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    apiFetch('/api/brands').then(r => r.ok ? r.json() : []).then(setBrands).catch(() => {});
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const resetModal = () => {
    setEditId(null);
    setName("");
    setBrandId("");
    setRows([{ text: "", answer_type: "rating_1_5", optionsText: "", segment: "" }]);
    setModalError("");
  };

  const openNew = () => {
    resetModal();
    setShowModal(true);
  };

  const openEdit = async (t: SurveyTemplate) => {
    resetModal();
    setEditId(t.id);
    setName(t.name);
    setBrandId(t.brand_id || "");
    setShowModal(true);
    setModalLoading(true);
    try {
      const res = await apiFetch(`/api/survey-templates/${t.id}`);
      if (res.ok) {
        const data = await res.json();
        const qs: SurveyQuestion[] = data.questions || [];
        if (qs.length) {
          setRows(qs.map(q => ({
            text: q.text || "",
            answer_type: q.answer_type,
            optionsText: (q.options || []).join(", "),
            segment: q.segment || "",
          })));
        }
      }
    } finally {
      setModalLoading(false);
    }
  };

  const addRow = () => setRows(rs => [...rs, { text: "", answer_type: "rating_1_5", optionsText: "", segment: "" }]);
  const removeRow = (i: number) => setRows(rs => rs.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<QRow>) =>
    setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const handleSubmit = async () => {
    setModalError("");
    if (!name.trim()) { setModalError("Template name is required."); return; }
    const cleaned = rows.filter(r => r.text.trim());
    if (cleaned.length === 0) { setModalError("Add at least one question."); return; }
    const questions = cleaned.map((r, i) => {
      const q: any = { text: r.text.trim(), answer_type: r.answer_type, q_order: i + 1, segment: r.segment || null };
      if (r.answer_type === 'multiple_choice') {
        q.options = r.optionsText.split(',').map(s => s.trim()).filter(Boolean);
      }
      return q;
    });
    const body = { name: name.trim(), brand_id: brandId || null, active: true, questions };
    setSaving(true);
    try {
      const url = editId ? `/api/survey-templates/${editId}` : '/api/survey-templates';
      const res = await apiFetch(url, {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setModalError(data.error || "Save failed."); return; }
      setShowModal(false);
      fetchTemplates();
    } catch (e: any) {
      setModalError(e.message || "Save error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      {/* Header */}
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-violet-500/10 text-violet-400 rounded-2xl">
            <ClipboardList className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Survey Templates</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">{templates.length} template(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchTemplates}
            className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {canManage && (
            <button
              onClick={openNew}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" /> New Template
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
                  <th className="p-4">Name</th>
                  <th className="p-4">Brand</th>
                  <th className="p-4 text-center">Questions</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Created By</th>
                  <th className="p-4">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {templates.map(t => (
                  <tr
                    key={t.id}
                    onClick={() => canManage && openEdit(t)}
                    className={`transition align-middle ${canManage ? 'hover:bg-[var(--surface-2)]/40 cursor-pointer' : ''}`}
                  >
                    <td className="p-4 font-bold text-[var(--heading)]">{t.name}</td>
                    <td className="p-4 text-[var(--text)]">
                      {t.brand_name || <span className="text-[var(--muted)]">General</span>}
                    </td>
                    <td className="p-4 text-center font-bold">{t.question_count ?? 0}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${
                        t.active
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                      }`}>
                        {t.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-4 text-[var(--muted)]">{t.created_by_name || '—'}</td>
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{fmtDate(t.created_at)}</td>
                  </tr>
                ))}
                {templates.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-[var(--muted)]">No templates found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-y-auto p-4">
          <div className="min-h-full flex items-start justify-center">
            <div className="w-full max-w-2xl my-6 bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg)]">
                <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-violet-400" /> {editId ? 'Edit Template' : 'New Template'}
                </h3>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--heading)] rounded-xl transition">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {modalLoading ? (
                <div className="flex items-center justify-center h-48">
                  <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="p-6 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--text)]">Name</label>
                      <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Template name"
                        className={`w-full ${inputCls}`}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--text)]">Brand (optional)</label>
                      <select value={brandId} onChange={e => setBrandId(e.target.value)} className={`w-full ${selCls}`}>
                        <option value="">General</option>
                        {brands.map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Questions builder */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-extrabold text-[var(--heading)]">Questions</p>
                      <button
                        onClick={addRow}
                        className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-xl text-[11px] font-bold flex items-center gap-1 transition"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add
                      </button>
                    </div>

                    <div className="space-y-3">
                      {rows.map((r, i) => (
                        <div key={i} className="p-4 bg-[var(--bg)] border border-[var(--border)] rounded-2xl space-y-3">
                          <div className="flex items-start gap-2">
                            <span className="text-[11px] font-extrabold text-[var(--muted)] mt-3 min-w-[20px]">#{i + 1}</span>
                            <div className="flex-1 space-y-3">
                              <input
                                value={r.text}
                                onChange={e => updateRow(i, { text: e.target.value })}
                                placeholder="Question text"
                                className={`w-full ${inputCls}`}
                              />
                              <div className="flex flex-wrap items-center gap-3">
                                <select
                                  value={r.answer_type}
                                  onChange={e => updateRow(i, { answer_type: e.target.value as AnswerType })}
                                  className={selCls}
                                >
                                  <option value="rating_1_5">Rating 1–5</option>
                                  <option value="rating_1_10">Rating 1–10</option>
                                  <option value="yes_no">Yes / No</option>
                                  <option value="multiple_choice">Multiple Choice</option>
                                  <option value="free_text">Free Text</option>
                                </select>
                                <select
                                  value={r.segment}
                                  onChange={e => updateRow(i, { segment: e.target.value })}
                                  className={selCls}
                                  title="Show this question only for a customer segment"
                                >
                                  <option value="">All segments</option>
                                  {SURVEY_SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                {r.answer_type === 'multiple_choice' && (
                                  <input
                                    value={r.optionsText}
                                    onChange={e => updateRow(i, { optionsText: e.target.value })}
                                    placeholder="Options (comma separated)"
                                    className={`flex-1 min-w-[160px] ${inputCls}`}
                                  />
                                )}
                              </div>
                            </div>
                            {rows.length > 1 && (
                              <button
                                onClick={() => removeRow(i)}
                                className="p-2 mt-1 text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                                title="Remove"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {modalError && (
                    <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {modalError}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setShowModal(false)} className="px-4 py-2 bg-[var(--surface-2)] text-[var(--text)] rounded-xl text-xs font-bold transition">
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={saving}
                      className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition"
                    >
                      {saving ? 'Saving…' : editId ? 'Update Template' : 'Create Template'}
                    </button>
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
