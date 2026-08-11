import { useState, useEffect, useCallback } from "react";
import { User, SurveyRecord, SurveyRecordType, Brand } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Database, RefreshCw, AlertCircle, Copy, Trash2, Download } from "lucide-react";
import SurveyDataUploadButton from "./SurveyDataUploadButton.tsx";

interface SurveysDataProps { currentUser: User; }

const KW_MS = 3 * 60 * 60 * 1000;
const fmtDate = (ts?: string) => {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (isNaN(t)) return String(ts);
  return new Date(t + KW_MS).toISOString().replace('T', ' ').slice(0, 16);
};

const feedbackColor = (f?: string) => {
  const v = (f || '').toLowerCase();
  if (v === 'positive') return 'text-emerald-400';
  if (v === 'negative') return 'text-rose-400';
  if (v === 'neutral') return 'text-amber-400';
  return 'text-[var(--muted)]';
};

const Stars = ({ n }: { n: number }) => (
  <span className="flex gap-0.5 text-sm">
    {[1, 2, 3, 4, 5].map(i => (
      <span key={i} className={i <= n ? (n <= 3 ? 'text-rose-400' : 'text-amber-400') : 'text-[var(--border)]'}>★</span>
    ))}
  </span>
);

const inputCls = "px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none";
const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";

export default function SurveysData({ currentUser }: SurveysDataProps) {
  const [types, setTypes] = useState<SurveyRecordType[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [records, setRecords] = useState<SurveyRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [type, setType] = useState("");
  const [brandId, setBrandId] = useState("");
  const [answered, setAnswered] = useState(""); // "", "answered", "no_answer"
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const typeLabel = useCallback((key?: string) => {
    if (key === 'survey_live') return 'Survey (Live)';
    const t = types.find(x => x.key === key);
    return t?.label || key || '—';
  }, [types]);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (type) p.set('type', type);
    if (brandId) p.set('brand_id', brandId);
    if (answered === 'answered') p.set('answered', 'true');
    else if (answered === 'no_answer') p.set('answered', 'false');
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p.toString();
  }, [type, brandId, answered, from, to]);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/survey-records?${buildQuery()}`);
      if (!res.ok) throw new Error("Failed to load survey data.");
      const data = await res.json();
      // Endpoint now returns { records, total, cap }; keep back-compat with a bare array.
      if (Array.isArray(data)) { setRecords(data); setTotal(data.length); }
      else { setRecords(data.records || []); setTotal(data.total ?? (data.records?.length || 0)); }
    } catch (e: any) {
      setError(e.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    apiFetch('/api/survey-records/types').then(r => r.ok ? r.json() : []).then(setTypes).catch(() => {});
    apiFetch('/api/brands').then(r => r.ok ? r.json() : []).then(setBrands).catch(() => {});
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const isAdmin = currentUser.role === 'admin';
  const dedupe = async () => {
    if (!window.confirm("Remove duplicate survey records?\nKeeps one row per order (same type + order id).")) return;
    const res = await apiFetch('/api/survey-records/dedupe', { method: 'POST' });
    if (res.ok) { const d = await res.json(); fetchRecords(); alert(`${d.removed} duplicate record(s) removed.`); }
    else { const d = await res.json().catch(() => ({})); setError(d.error || "Failed."); }
  };
  const anyFilter = !!(type || brandId || answered || from || to);
  const deleteData = async () => {
    const msg = anyFilter
      ? "Delete the FILTERED survey records? This cannot be undone."
      : "Delete ALL survey data? This cannot be undone.";
    if (!window.confirm(msg)) return;
    const res = await apiFetch('/api/survey-records/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: type || undefined,
        brand_id: brandId || undefined,
        answered: answered === 'answered' ? true : answered === 'no_answer' ? false : undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    });
    if (res.ok) { const d = await res.json(); fetchRecords(); alert(`${d.deleted} record(s) deleted.`); }
    else { const d = await res.json().catch(() => ({})); setError(d.error || "Failed."); }
  };

  // Export the currently loaded (filtered) survey records to CSV — includes every field + Segment
  const exportCsv = () => {
    if (!records.length) { alert("No records to export."); return; }
    const cols: { key: string; label: string; val: (r: SurveyRecord) => any }[] = [
      { key: 'type', label: 'Type', val: r => typeLabel(r.record_type) },
      { key: 'brand', label: 'Brand', val: r => r.brand_name || r.brand_label || '' },
      { key: 'platform', label: 'Platform', val: r => r.platform_name || r.platform_label || '' },
      { key: 'order', label: 'Order ID', val: r => r.order_id || '' },
      { key: 'item', label: 'Item', val: r => r.item_name || '' },
      { key: 'phone', label: 'Phone', val: r => r.phone || '' },
      { key: 'customer', label: 'Customer Name', val: r => r.customer_name || '' },
      { key: 'rate', label: 'Rate', val: r => (r.rate ?? '') },
      { key: 'feedback', label: 'Feedback', val: r => r.product_feedback || '' },
      { key: 'segment', label: 'Segment', val: r => r.segment || '' },
      { key: 'served', label: 'Served By', val: r => r.served_by || '' },
      { key: 'answered', label: 'Answered', val: r => (r.answered ? 'Yes' : 'No') },
      { key: 'comment', label: 'Comment', val: r => r.comment || '' },
      { key: 'complaint', label: 'Complaint', val: r => r.complaint || '' },
      { key: 'note', label: 'Note', val: r => r.note || '' },
      { key: 'record_date', label: 'Record Date', val: r => r.record_date || '' },
      { key: 'uploaded_by', label: 'Uploaded By', val: r => r.uploaded_by_name || '' },
      { key: 'created_at', label: 'Created At', val: r => r.created_at || '' },
    ];
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.map(c => c.label).join(',')];
    for (const r of records) lines.push(cols.map(c => esc(c.val(r))).join(','));
    const blob = new Blob(["﻿" + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `survey-data-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      {/* Header */}
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-500/10 text-teal-400 rounded-2xl">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Survey Data</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">
              {total.toLocaleString()} record(s)
              {total > records.length && <span className="text-amber-400"> — showing latest {records.length.toLocaleString()}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchRecords}
            className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={exportCsv}
            title="Export the current (filtered) records to CSV"
            className="px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 font-bold rounded-2xl text-xs flex items-center gap-1.5 transition active:scale-95"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          {isAdmin && (
            <button
              onClick={dedupe}
              title="Remove duplicate records"
              className="px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-500 font-bold rounded-2xl text-xs flex items-center gap-1.5 transition active:scale-95"
            >
              <Copy className="w-4 h-4" /> Remove duplicates
            </button>
          )}
          {isAdmin && (
            <button
              onClick={deleteData}
              title={anyFilter ? "Delete filtered records" : "Delete all survey data"}
              className="px-4 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 font-bold rounded-2xl text-xs flex items-center gap-1.5 transition active:scale-95"
            >
              <Trash2 className="w-4 h-4" /> {anyFilter ? "Delete filtered" : "Delete all"}
            </button>
          )}
          <SurveyDataUploadButton currentUser={currentUser} onUploaded={fetchRecords} />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={type} onChange={e => setType(e.target.value)} className={selCls}>
          <option value="">All Types</option>
          {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={brandId} onChange={e => setBrandId(e.target.value)} className={selCls}>
          <option value="">All Brands</option>
          {brands.map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
        </select>
        <select value={answered} onChange={e => setAnswered(e.target.value)} className={selCls}>
          <option value="">All</option>
          <option value="answered">Answered</option>
          <option value="no_answer">No Answer</option>
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} title="From" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} title="To" />
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
                  <th className="p-4">Type</th>
                  <th className="p-4">Brand</th>
                  <th className="p-4">Item / Order</th>
                  <th className="p-4">Phone</th>
                  <th className="p-4">Rate</th>
                  <th className="p-4">Feedback</th>
                  <th className="p-4">Segment</th>
                  <th className="p-4">Served By</th>
                  <th className="p-4 text-center">Answered</th>
                  <th className="p-4">Uploaded By</th>
                  <th className="p-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {records.map(r => (
                  <tr key={r.id} className="hover:bg-[var(--surface-2)]/40 transition align-middle">
                    <td className="p-4 font-bold text-[var(--heading)]">{typeLabel(r.record_type)}</td>
                    <td className="p-4 text-[var(--text)]">{r.brand_name || r.brand_label || '—'}</td>
                    <td className="p-4 text-[var(--text)]">{r.item_name || r.order_id || '—'}</td>
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)]">{r.phone || '—'}</td>
                    <td className="p-4">
                      {typeof r.rate === 'number' && r.rate > 0 ? <Stars n={r.rate} /> : <span className="text-[var(--muted)]">—</span>}
                    </td>
                    <td className="p-4">
                      {r.product_feedback
                        ? <span className={`font-bold ${feedbackColor(r.product_feedback)}`}>{r.product_feedback}</span>
                        : <span className="text-[var(--muted)]">—</span>}
                    </td>
                    <td className="p-4">
                      {r.segment
                        ? <span className="px-2 py-1 bg-indigo-500/10 text-indigo-400 rounded-lg text-[10px] font-bold">{r.segment}</span>
                        : <span className="text-[var(--muted)]">—</span>}
                    </td>
                    <td className="p-4 text-[var(--muted)]">{r.served_by || '—'}</td>
                    <td className="p-4 text-center">
                      {r.answered
                        ? <span className="text-emerald-400 font-bold">Yes</span>
                        : <span className="text-[var(--muted)]">No</span>}
                    </td>
                    <td className="p-4 text-[var(--muted)] text-[11px]">{r.uploaded_by_name || '—'}</td>
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-[var(--muted)]">No survey data found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
