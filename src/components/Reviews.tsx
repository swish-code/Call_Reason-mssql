import { useState, useEffect, useCallback } from "react";
import { User } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import {
  Star, RefreshCw, Upload, FileDown, X, AlertCircle, Flag, ChevronLeft, ChevronRight, Phone, Trash2,
} from "lucide-react";

interface Platform { id: string; name: string; }
interface Rating {
  id: string;
  brand_id: string; brand_name: string;
  platform_id: string; platform_name: string;
  order_id: string;
  rating: number;
  review_text?: string;
  customer_phone?: string;
  requires_action: boolean;
  action_status: 'pending' | 'in_progress' | 'resolved' | 'unreachable' | 'no_action_needed';
  assigned_agent_id?: string; agent_name?: string;
  action_note?: string;
  uploaded_by?: string; uploaded_by_name?: string; uploaded_at?: string;
  resolved_at?: string; recorded_by?: string; recorded_by_name?: string; recorded_at?: string;
  order_date?: string; customer_name?: string; branch?: string;
  filled_by?: string; following_date?: string; surveyed_by?: string;
  complaint_type?: string; complaint_cases?: string; complaint_status?: string;
  served_by?: string; note?: string;
  attempts?: CallAttempt[];
}
interface CallAttempt {
  id: string; rating_id: string; agent_id?: string; agent_name?: string;
  attempt_number: number;
  outcome: 'no_answer' | 'answered' | 'wrong_number' | 'busy' | 'declined';
  note?: string; created_at: string;
}
interface UploadResult {
  total: number; inserted: number; duplicates: number; overwritten: number;
  tasks?: number; auto_closed?: number;
  errors: { row: number; message: string }[];
}

interface ReviewsProps { currentUser: User; }

const PAGE_SIZE = 20;
const KW_MS = 3 * 60 * 60 * 1000;
const fmtDate = (ts?: string) => {
  if (!ts) return '—';
  const s = String(ts).trim();
  // Excel serial date stored as a bare number (days since 1899-12-30)
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 90000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      return new Date(ms + KW_MS).toISOString().replace('T', ' ').slice(0, 16);
    }
  }
  const t = new Date(s).getTime();
  if (isNaN(t)) return s;
  const y = new Date(t).getUTCFullYear();
  if (y < 1990 || y > 2100) return s; // absurd parse → show raw
  return new Date(t + KW_MS).toISOString().replace('T', ' ').slice(0, 16);
};

const statusLabel = (s: string) =>
  s === 'resolved' ? 'Complaint Recorded'
  : s === 'no_action_needed' ? 'No Action Required'
  : s === 'in_progress' ? 'In Progress'
  : s === 'unreachable' ? 'Unreachable'
  : 'Pending';

const statusColor = (s: string) =>
  s === 'resolved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  : s === 'no_action_needed' ? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
  : s === 'in_progress' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
  : s === 'unreachable' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
  : 'bg-amber-500/10 text-amber-400 border-amber-500/20';

const Stars = ({ n, large }: { n: number; large?: boolean }) => (
  <span className={`flex gap-0.5 ${large ? 'text-xl' : 'text-sm'}`}>
    {[1, 2, 3, 4, 5].map(i => (
      <span key={i} className={i <= n ? (n <= 3 ? 'text-rose-400' : 'text-amber-400') : 'text-[var(--border)]'}>★</span>
    ))}
  </span>
);

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

export default function Reviews({ currentUser }: ReviewsProps) {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [brands, setBrands] = useState<{ id: string; brand_name: string }[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  // Filters
  const [brandId, setBrandId] = useState("");
  const [platformId, setPlatformId] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [assigned, setAssigned] = useState("");
  const [requiresAction, setRequiresAction] = useState(false);
  const [ratingFilter, setRatingFilter] = useState(""); // "", "1".."5"
  const [commentFilter, setCommentFilter] = useState(""); // "", "with", "without"
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Modals
  const [showUpload, setShowUpload] = useState(false);
  const [detail, setDetail] = useState<Rating | null>(null);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [dupMode, setDupMode] = useState<'skip' | 'overwrite'>('skip');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState("");

  // Detail state
  const [detailLoading, setDetailLoading] = useState(false);
  const [attemptOutcome, setAttemptOutcome] = useState<string>('no_answer');
  const [attemptNote, setAttemptNote] = useState("");
  const [attemptSaving, setAttemptSaving] = useState(false);
  const [actionNote, setActionNote] = useState("");
  const [patching, setPatching] = useState(false);

  // Editable customer contact
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  // Assignment state
  const [agents, setAgents] = useState<{ id: string; full_name: string }[]>([]);
  const [assignIds, setAssignIds] = useState<string[]>([]); // reviews targeted by the open assign modal
  const [selected, setSelected] = useState<string[]>([]);   // rows ticked for bulk assign
  const [assignAgentId, setAssignAgentId] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);

  const canUpload =
    ['admin', 'supervisor', 'leader'].includes(currentUser.role) ||
    (currentUser as any).can_upload === true;
  const canAssign = ['admin', 'supervisor', 'leader'].includes(currentUser.role);
  const isAgent = currentUser.role === 'agent';
  const isAdmin = currentUser.role === 'admin';

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (brandId) p.set('brand_id', brandId);
    if (platformId) p.set('platform_id', platformId);
    if (actionStatus) p.set('action_status', actionStatus);
    if (assigned) p.set('assigned', assigned);
    if (requiresAction) p.set('requires_action', 'true');
    if (ratingFilter) { p.set('min_rating', ratingFilter); p.set('max_rating', ratingFilter); }
    if (commentFilter) p.set('has_comment', commentFilter === 'with' ? 'true' : 'false');
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p.toString();
  }, [brandId, platformId, actionStatus, assigned, requiresAction, ratingFilter, commentFilter, from, to]);

  const fetchRatings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/ratings?${buildQuery()}`);
      if (!res.ok) throw new Error("Failed to load reviews.");
      setRatings(await res.json());
      setPage(1);
      setSelected([]);
    } catch (e: any) {
      setError(e.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    apiFetch('/api/brands').then(r => r.ok ? r.json() : []).then(setBrands).catch(() => {});
    apiFetch('/api/platforms').then(r => r.ok ? r.json() : []).then(setPlatforms).catch(() => {});
    if (canAssign) apiFetch('/api/agents').then(r => r.ok ? r.json() : []).then(setAgents).catch(() => {});
  }, [canAssign]);

  useEffect(() => { fetchRatings(); }, [fetchRatings]);

  const fetchDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await apiFetch(`/api/ratings/${id}`);
      if (res.ok) {
        const data: Rating = await res.json();
        setDetail(data);
        setActionNote(data.action_note || "");
        setCustName(data.customer_name || "");
        setCustPhone(data.customer_phone || "");
        setAttemptOutcome('no_answer');
        setAttemptNote("");
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetail = (r: Rating) => {
    setDetail(r);
    setActionNote(r.action_note || "");
    setCustName(r.customer_name || "");
    setCustPhone(r.customer_phone || "");
    setAttemptOutcome('no_answer');
    setAttemptNote("");
    fetchDetail(r.id);
  };

  const saveContact = async () => {
    if (!detail) return;
    setSavingContact(true);
    const res = await apiFetch(`/api/ratings/${detail.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: custName, customer_phone: custPhone }),
    });
    setSavingContact(false);
    if (res.ok) { fetchDetail(detail.id); fetchRatings(); }
  };

  const handleTemplate = async () => {
    const res = await apiFetch('/api/ratings/template');
    if (!res.ok) return;
    const data = await res.json();
    downloadBase64(data.file, data.filename);
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError("");
    setUploadResult(null);
    try {
      const b64 = await readFileBase64(uploadFile);
      const res = await apiFetch('/api/ratings/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: b64, mode: dupMode }),
      });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error || "Upload failed."); return; }
      setUploadResult(data);
      fetchRatings();
    } catch (e: any) {
      setUploadError(e.message || "Upload error.");
    } finally {
      setUploading(false);
    }
  };

  const logAttempt = async () => {
    if (!detail) return;
    setAttemptSaving(true);
    const res = await apiFetch(`/api/ratings/${detail.id}/attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: attemptOutcome, note: attemptNote }),
    });
    setAttemptSaving(false);
    if (res.ok) { fetchDetail(detail.id); fetchRatings(); }
  };

  const openAssign = (r: Rating) => { setAssignIds([r.id]); setAssignAgentId(r.assigned_agent_id || ""); };
  const openBulkAssign = () => { if (!selected.length) return; setAssignIds([...selected]); setAssignAgentId(""); };
  const saveAssign = async () => {
    if (!assignIds.length) return;
    setAssignSaving(true);
    const res = await apiFetch('/api/ratings/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: assignIds, assigned_agent_id: assignAgentId || null }),
    });
    setAssignSaving(false);
    if (res.ok) { setAssignIds([]); setSelected([]); fetchRatings(); }
  };

  const [bulkStatusSaving, setBulkStatusSaving] = useState(false);
  const bulkSetStatus = async (status: string, ids: string[]) => {
    if (!ids.length) return;
    const msg = ids.length === 1
      ? "Mark this review as No Action Required?"
      : `Mark ${ids.length} reviews as No Action Required? They will be hidden from this list and kept for reporting only.`;
    if (!window.confirm(msg)) return;
    setBulkStatusSaving(true);
    const res = await apiFetch('/api/ratings/bulk-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action_status: status }),
    });
    setBulkStatusSaving(false);
    if (res.ok) { setSelected([]); fetchRatings(); }
    else { const dt = await res.json().catch(() => ({})); setError(dt.error || "Update failed."); }
  };

  const deleteReviews = async (ids: string[]) => {
    if (!ids.length) return;
    const msg = ids.length === 1 ? "Delete this review? This cannot be undone." : `Delete ${ids.length} reviews? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    const res = await apiFetch('/api/ratings/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res.ok) { setSelected([]); fetchRatings(); }
    else { const dt = await res.json().catch(() => ({})); setError(dt.error || "Delete failed."); }
  };

  // Purge all reviews uploaded on a chosen Kuwait day (admin only)
  const kwToday = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeDate, setPurgeDate] = useState(kwToday());
  const [purgeCount, setPurgeCount] = useState<number | null>(null);
  const [purging, setPurging] = useState(false);

  const fetchPurgeCount = async (date: string) => {
    setPurgeCount(null);
    if (!date) return;
    const res = await apiFetch(`/api/ratings/uploaded-count?date=${date}`);
    if (res.ok) { const dt = await res.json(); setPurgeCount(dt.count); }
  };
  const openPurge = () => { const t = kwToday(); setPurgeDate(t); setPurgeOpen(true); fetchPurgeCount(t); };
  const doPurge = async () => {
    if (!purgeDate) return;
    setPurging(true);
    const res = await apiFetch('/api/ratings/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploaded_on: purgeDate }),
    });
    setPurging(false);
    if (res.ok) { setPurgeOpen(false); setSelected([]); fetchRatings(); }
    else { const dt = await res.json().catch(() => ({})); setError(dt.error || "Delete failed."); }
  };

  // Row selection for bulk assign
  const toggleSelect = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const selectAllFiltered = () => setSelected(ratings.map(r => r.id));

  const patchStatus = async (status: string) => {
    if (!detail) return;
    setPatching(true);
    const res = await apiFetch(`/api/ratings/${detail.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_status: status, action_note: actionNote }),
    });
    setPatching(false);
    if (res.ok) { fetchDetail(detail.id); fetchRatings(); }
  };

  // Pagination
  const totalPages = Math.max(1, Math.ceil(ratings.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const paged = ratings.slice(pageStart, pageStart + PAGE_SIZE);

  // Header checkbox selects the CURRENT page; selections persist across pages
  const pageIds = paged.map(r => r.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every(id => selected.includes(id));
  const toggleSelectPage = () => setSelected(s => pageAllSelected ? s.filter(id => !pageIds.includes(id)) : Array.from(new Set([...s, ...pageIds])));
  const pageItems: (number | '…')[] = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const items: (number | '…')[] = [1];
    const lo = Math.max(2, page - 1), hi = Math.min(totalPages - 1, page + 1);
    if (lo > 2) items.push('…');
    for (let i = lo; i <= hi; i++) items.push(i);
    if (hi < totalPages - 1) items.push('…');
    items.push(totalPages);
    return items;
  })();

  const isDone = (s: string) => s === 'resolved' || s === 'no_action_needed';

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      {/* Header */}
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-2xl">
            <Star className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">Reviews</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">{ratings.length} record(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchRatings}
            className="p-3 text-[var(--text)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl active:scale-95 transition"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {canUpload && (
            <>
              <button
                onClick={handleTemplate}
                className="px-4 py-2.5 bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] font-bold rounded-2xl text-xs flex items-center gap-1.5 transition active:scale-95"
              >
                <FileDown className="w-4 h-4" /> Template
              </button>
              <button
                onClick={() => { setShowUpload(true); setUploadResult(null); setUploadError(""); setUploadFile(null); }}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 transition"
              >
                <Upload className="w-4 h-4" /> Upload
              </button>
            </>
          )}
          {isAdmin && (
            <button
              onClick={openPurge}
              title="Delete uploads by date"
              className="px-4 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 font-bold rounded-2xl text-xs flex items-center gap-1.5 transition active:scale-95"
            >
              <Trash2 className="w-4 h-4" /> Purge by date
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={brandId} onChange={e => setBrandId(e.target.value)} className={selCls}>
          <option value="">All Brands</option>
          {brands.map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
        </select>
        <select value={platformId} onChange={e => setPlatformId(e.target.value)} className={selCls}>
          <option value="">All Platforms</option>
          {platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={actionStatus} onChange={e => setActionStatus(e.target.value)} className={selCls}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Complaint Recorded</option>
          <option value="unreachable">Unreachable</option>
        </select>
        <select value={ratingFilter} onChange={e => setRatingFilter(e.target.value)} className={selCls}>
          <option value="">All Ratings</option>
          <option value="5">★ 5</option>
          <option value="4">★ 4</option>
          <option value="3">★ 3</option>
          <option value="2">★ 2</option>
          <option value="1">★ 1</option>
        </select>
        <select value={commentFilter} onChange={e => setCommentFilter(e.target.value)} className={selCls}>
          <option value="">All Comments</option>
          <option value="with">With comment</option>
          <option value="without">Without comment</option>
        </select>
        {!isAgent && (
          <select value={assigned} onChange={e => setAssigned(e.target.value)} className={selCls}>
            <option value="">All Agents</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {agents.length > 0 && <option disabled>──────────</option>}
            {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        )}
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} title="From" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} title="To" />
        <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[var(--text)] font-bold">
          <input
            type="checkbox"
            checked={requiresAction}
            onChange={e => setRequiresAction(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-600"
          />
          Needs Action
        </label>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {/* Bulk-assign action bar */}
      {canAssign && selected.length > 0 && (
        <div className="flex items-center gap-3 p-3 px-4 bg-violet-500/10 border border-violet-500/20 rounded-2xl flex-wrap">
          <span className="text-xs font-extrabold text-violet-400">{selected.length} selected</span>
          {selected.length < ratings.length && (
            <button onClick={selectAllFiltered} className="px-2.5 py-1.5 text-[11px] font-bold text-violet-500 hover:text-violet-400 underline underline-offset-2 transition">
              Select all {ratings.length}
            </button>
          )}
          <button onClick={openBulkAssign} className="px-3.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-[11px] font-bold transition active:scale-95">
            Assign selected
          </button>
          <button
            onClick={() => bulkSetStatus('no_action_needed', selected)}
            disabled={bulkStatusSaving}
            className="px-3.5 py-1.5 bg-zinc-600 hover:bg-zinc-700 disabled:opacity-50 text-white rounded-xl text-[11px] font-bold transition active:scale-95"
          >
            {bulkStatusSaving ? 'Saving…' : 'No Action Required'}
          </button>
          {isAdmin && (
            <button onClick={() => deleteReviews(selected)} className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[11px] font-bold transition active:scale-95 flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5" /> Delete selected
            </button>
          )}
          <button onClick={() => setSelected([])} className="px-3 py-1.5 text-[var(--muted)] hover:text-[var(--heading)] text-[11px] font-bold transition">
            Clear
          </button>
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
                  {canAssign && (
                    <th className="p-4">
                      <input type="checkbox" checked={pageAllSelected} onChange={toggleSelectPage} className="w-4 h-4 rounded accent-violet-600 cursor-pointer" title="Select this page" />
                    </th>
                  )}
                  <th className="p-4">Date</th>
                  <th className="p-4">Source</th>
                  <th className="p-4">Rate</th>
                  <th className="p-4">Review</th>
                  <th className="p-4">Served By</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-center">Flag</th>
                  <th className="p-4">Uploaded By</th>
                  {!isAgent && <th className="p-4">Assigned To</th>}
                  <th className="p-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {paged.map(r => (
                  <tr key={r.id} className={`hover:bg-[var(--surface-2)]/40 transition align-middle ${selected.includes(r.id) ? 'bg-violet-500/5' : ''}`}>
                    {canAssign && (
                      <td className="p-4">
                        <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelect(r.id)} className="w-4 h-4 rounded accent-violet-600 cursor-pointer" />
                      </td>
                    )}
                    <td className="p-4 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">{fmtDate(r.order_date || r.uploaded_at)}</td>
                    <td className="p-4">
                      <div className="space-y-0.5">
                        <div className="font-bold text-[var(--heading)]">{r.brand_name}</div>
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">{r.platform_name}</span>
                        <div className="font-mono text-[10px] text-[var(--muted)]">#{r.order_id}</div>
                      </div>
                    </td>
                    <td className="p-4"><Stars n={r.rating} /></td>
                    <td className="p-4 max-w-[180px]">
                      {r.review_text ? (
                        <span title={r.review_text} className="text-[11px] text-[var(--text)] line-clamp-2">
                          {r.review_text.length > 60 ? r.review_text.slice(0, 60) + '…' : r.review_text}
                        </span>
                      ) : <span className="text-[var(--muted)]">—</span>}
                    </td>
                    <td className="p-4 text-[var(--muted)]">{r.served_by || r.filled_by || '—'}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${statusColor(r.action_status)}`}>
                        {statusLabel(r.action_status)}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      {(() => {
                        const closed = ['resolved', 'no_action_needed', 'unreachable'].includes(r.action_status);
                        if (closed) return <span className="text-emerald-400 text-base" title="Handled">✓</span>;
                        if (r.requires_action) return <span className="text-rose-400 text-base" title="Requires Action">🚩</span>;
                        return <span className="text-[var(--muted)]">—</span>;
                      })()}
                    </td>
                    <td className="p-4 text-[var(--muted)] text-[11px]">{r.uploaded_by_name || '—'}</td>
                    {!isAgent && (
                      <td className="p-4 text-[11px]">
                        {r.agent_name
                          ? <span className="inline-block px-2 py-0.5 rounded-full font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20">{r.agent_name}</span>
                          : <span className="text-[var(--muted)]">—</span>}
                      </td>
                    )}
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {canAssign && (
                          <button
                            onClick={() => openAssign(r)}
                            className="px-3 py-1.5 bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 rounded-xl text-[11px] font-bold transition"
                          >
                            Assign
                          </button>
                        )}
                        <button
                          onClick={() => openDetail(r)}
                          className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-xl text-[11px] font-bold transition"
                        >
                          Open
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => deleteReviews([r.id])}
                            title="Delete review"
                            className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {ratings.length === 0 && (
                  <tr>
                    <td colSpan={9 + (isAgent ? 0 : 1) + (canAssign ? 1 : 0)} className="p-8 text-center text-[var(--muted)]">No reviews found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {ratings.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border)] bg-[var(--bg)]">
              <span className="text-[11px] text-[var(--muted)] font-medium">
                Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, ratings.length)} of {ratings.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg text-[11px] font-bold border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:pointer-events-none transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {pageItems.map((it, i) => it === '…' ? (
                  <span key={`e${i}`} className="px-2 text-[11px] text-[var(--muted)]">…</span>
                ) : (
                  <button
                    key={it}
                    onClick={() => setPage(it as number)}
                    className={`min-w-[32px] px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                      it === page
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-900/30'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)]'
                    }`}
                  >{it}</button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded-lg text-[11px] font-bold border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:pointer-events-none transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Purge-by-date Modal (admin) */}
      {purgeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-rose-400" /> Delete Uploads by Date
              </h3>
              <button onClick={() => setPurgeOpen(false)} className="p-1.5 hover:bg-[var(--surface-2)] text-[var(--muted)] rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-[var(--muted)] uppercase">Upload date (Kuwait)</label>
              <input type="date" value={purgeDate} max={kwToday()} onChange={e => { setPurgeDate(e.target.value); fetchPurgeCount(e.target.value); }} className={inputCls + " w-full"} />
            </div>
            <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-300">
              {purgeCount === null
                ? 'Counting…'
                : purgeCount === 0
                  ? 'No reviews were uploaded on this date.'
                  : <>This will permanently delete <span className="font-extrabold">{purgeCount}</span> review(s) uploaded on {purgeDate}. This cannot be undone.</>}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setPurgeOpen(false)} className="flex-1 px-4 py-2.5 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded-xl text-xs font-bold hover:bg-[var(--surface-2)] transition">Cancel</button>
              <button onClick={doPurge} disabled={purging || !purgeCount} className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition">
                {purging ? 'Deleting…' : `Delete ${purgeCount || 0}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Modal (single or bulk) */}
      {assignIds.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2">
                <Star className="w-4 h-4 text-violet-400" /> {assignIds.length > 1 ? `Assign ${assignIds.length} Reviews` : 'Assign Review'}
              </h3>
              <button onClick={() => setAssignIds([])} className="p-1.5 hover:bg-[var(--surface-2)] text-[var(--muted)] rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>
            {assignIds.length === 1 ? (() => {
              const r = ratings.find(x => x.id === assignIds[0]);
              return r ? (
                <div className="text-xs text-[var(--muted)] space-y-1">
                  <div><span className="font-bold text-[var(--heading)]">{r.brand_name}</span> · {r.platform_name}</div>
                  <div className="font-mono">#{r.order_id}</div>
                </div>
              ) : null;
            })() : (
              <div className="text-xs text-[var(--muted)]"><span className="font-extrabold text-violet-400">{assignIds.length}</span> reviews will be assigned together.</div>
            )}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-[var(--muted)] uppercase">Agent</label>
              <select value={assignAgentId} onChange={e => setAssignAgentId(e.target.value)} className={selCls + " w-full"}>
                <option value="">— Unassigned —</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
              {agents.length === 0 && <p className="text-[10px] text-[var(--muted)]">No active agents found.</p>}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setAssignIds([])} className="flex-1 px-4 py-2.5 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded-xl text-xs font-bold hover:bg-[var(--surface-2)] transition">Cancel</button>
              <button onClick={saveAssign} disabled={assignSaving} className="flex-1 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition">
                {assignSaving ? 'Saving…' : assignAgentId ? 'Assign' : 'Unassign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2">
                <Upload className="w-4 h-4 text-blue-400" /> Upload Reviews
              </h3>
              <button onClick={() => setShowUpload(false)} className="p-1.5 hover:bg-[var(--surface-2)] text-[var(--muted)] rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--text)]">File (.xlsx / .xls)</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-[var(--text)] file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-700 file:cursor-pointer"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--text)]">Duplicate Mode</label>
              <div className="flex gap-4">
                {(['skip', 'overwrite'] as const).map(m => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer text-xs text-[var(--text)]">
                    <input
                      type="radio"
                      name="dupMode"
                      value={m}
                      checked={dupMode === m}
                      onChange={() => setDupMode(m)}
                      className="accent-blue-600"
                    />
                    <span className="font-bold capitalize">{m}</span>
                  </label>
                ))}
              </div>
            </div>

            {uploadError && (
              <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {uploadError}
              </div>
            )}

            {uploadResult && (
              <div className="p-4 bg-emerald-950/20 border border-emerald-500/20 rounded-xl space-y-2">
                <p className="text-xs font-extrabold text-emerald-400">Upload Complete</p>
                <div className="grid grid-cols-2 gap-1 text-[11px] text-[var(--text)]">
                  <span className="text-[var(--muted)]">Total rows:</span><span className="font-bold">{uploadResult.total}</span>
                  <span className="text-[var(--muted)]">Inserted:</span><span className="font-bold text-emerald-400">{uploadResult.inserted}</span>
                  <span className="text-[var(--muted)]">Duplicates:</span><span className="font-bold">{uploadResult.duplicates}</span>
                  <span className="text-[var(--muted)]">Overwritten:</span><span className="font-bold">{uploadResult.overwritten}</span>
                  <span className="text-[var(--muted)]">Tasks (assigned):</span><span className="font-bold text-amber-400">{uploadResult.tasks ?? 0}</span>
                  <span className="text-[var(--muted)]">Auto-closed:</span><span className="font-bold text-zinc-400">{uploadResult.auto_closed ?? 0}</span>
                </div>
                {uploadResult.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[11px] font-bold text-rose-400">Errors ({uploadResult.errors.length})</p>
                    <div className="max-h-28 overflow-y-auto space-y-1">
                      {uploadResult.errors.map((e, i) => (
                        <div key={i} className="text-[11px] text-rose-300">Row {e.row}: {e.message}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowUpload(false)} className="px-4 py-2 bg-[var(--surface-2)] text-[var(--text)] rounded-xl text-xs font-bold transition">
                Close
              </button>
              <button
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-y-auto p-4">
          <div className="min-h-full flex items-start justify-center">
            <div className="w-full max-w-2xl my-6 bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-2xl overflow-hidden">
              {/* Detail header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg)]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl"><Star className="w-5 h-5" /></div>
                  <div>
                    <h3 className="text-sm font-extrabold text-[var(--heading)]">Review Detail</h3>
                    <p className="text-[11px] text-[var(--muted)]">{detail.brand_name} · {detail.platform_name} · #{detail.order_id}</p>
                  </div>
                </div>
                <button onClick={() => setDetail(null)} className="p-2 hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--heading)] rounded-xl transition">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {detailLoading ? (
                <div className="flex items-center justify-center h-48">
                  <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="p-6 space-y-6">
                  {/* Rating + badges */}
                  <div className="flex flex-wrap items-center gap-3">
                    <Stars n={detail.rating} large />
                    <span className={`px-3 py-1 rounded-full text-[11px] font-extrabold border ${statusColor(detail.action_status)}`}>
                      {statusLabel(detail.action_status)}
                    </span>
                    {detail.requires_action && (
                      <span className="px-3 py-1 rounded-full text-[11px] font-extrabold bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1">
                        <Flag className="w-3 h-3" /> Requires Action
                      </span>
                    )}
                  </div>

                  {/* Editable customer contact */}
                  <div className="p-4 bg-[var(--bg)] border border-[var(--border)] rounded-2xl space-y-3">
                    <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide">Customer Contact</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] text-[var(--muted)] font-bold">Customer Name</label>
                        <input value={custName} onChange={e => setCustName(e.target.value)} placeholder="—" className={inputCls + " w-full"} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-[var(--muted)] font-bold">Phone</label>
                        <input value={custPhone} onChange={e => setCustPhone(e.target.value)} placeholder="—" className={inputCls + " w-full"} dir="ltr" />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button onClick={saveContact} disabled={savingContact} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-[11px] font-bold transition active:scale-95">
                        {savingContact ? 'Saving…' : 'Save Customer Info'}
                      </button>
                    </div>
                  </div>

                  {/* Info grid */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    {[
                      ['Date', fmtDate(detail.order_date || detail.uploaded_at)],
                      ['Branch', detail.branch],
                      ['Served By', detail.served_by || detail.filled_by],
                      ['Following Date', detail.following_date ? fmtDate(detail.following_date) : null],
                      ['Surveyed By', detail.surveyed_by],
                      ['Complaint Type', detail.complaint_type],
                      ['Complaint Cases', detail.complaint_cases],
                      ['Note', detail.note],
                    ].map(([label, val]) => val ? (
                      <div key={label as string} className="flex flex-col">
                        <span className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide">{label}</span>
                        <span className="text-xs text-[var(--text)] font-medium mt-0.5">{val}</span>
                      </div>
                    ) : null)}
                  </div>

                  {/* Uploaded / Recorded by */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 pt-2 border-t border-[var(--border)]">
                    {detail.uploaded_by_name && (
                      <div className="flex flex-col">
                        <span className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide">Uploaded By</span>
                        <span className="text-xs text-[var(--text)] mt-0.5">{detail.uploaded_by_name}</span>
                        <span className="text-[10px] text-[var(--muted)]">{fmtDate(detail.uploaded_at)}</span>
                      </div>
                    )}
                    {detail.recorded_by_name && (
                      <div className="flex flex-col">
                        <span className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide">Recorded By</span>
                        <span className="text-xs text-[var(--text)] mt-0.5">{detail.recorded_by_name}</span>
                        <span className="text-[10px] text-[var(--muted)]">{fmtDate(detail.recorded_at)}</span>
                      </div>
                    )}
                  </div>

                  {/* Review text */}
                  {detail.review_text && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide">Review</p>
                      <div className="p-3 bg-[var(--bg)] border border-[var(--border)] rounded-2xl text-xs text-[var(--text)] leading-relaxed whitespace-pre-wrap">
                        {detail.review_text}
                      </div>
                    </div>
                  )}

                  {/* Call Attempts */}
                  <div className="space-y-3 border-t border-[var(--border)] pt-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-extrabold text-[var(--heading)] flex items-center gap-2">
                        <Phone className="w-4 h-4 text-blue-400" /> Call Attempts
                        <span className="text-[var(--muted)] font-normal">({(detail.attempts || []).length}/3)</span>
                      </p>
                    </div>

                    {(detail.attempts || []).length > 0 && (
                      <div className="space-y-2">
                        {(detail.attempts || []).map(a => (
                          <div key={a.id} className="flex items-start gap-3 p-3 bg-[var(--bg)] border border-[var(--border)] rounded-2xl">
                            <span className="text-[11px] font-extrabold text-[var(--muted)] min-w-[20px]">#{a.attempt_number}</span>
                            <div className="flex-1 space-y-1 min-w-0">
                              <div className="flex items-center gap-2">
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

                    {(detail.attempts || []).length < 3 && !isDone(detail.action_status) && (
                      <div className="p-4 bg-[var(--bg)] border border-[var(--border)] rounded-2xl space-y-3">
                        <p className="text-[11px] font-bold text-[var(--text)]">Log New Attempt</p>
                        <select
                          value={attemptOutcome}
                          onChange={e => setAttemptOutcome(e.target.value)}
                          className={`w-full ${selCls}`}
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
                          className={`w-full resize-none ${inputCls}`}
                        />
                        <button
                          onClick={logAttempt}
                          disabled={attemptSaving}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition"
                        >
                          {attemptSaving ? 'Saving…' : 'Log Attempt'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Action section */}
                  {!isDone(detail.action_status) && (
                    <div className="space-y-3 border-t border-[var(--border)] pt-4">
                      <p className="text-xs font-extrabold text-[var(--heading)]">Action</p>
                      <textarea
                        value={actionNote}
                        onChange={e => setActionNote(e.target.value)}
                        rows={3}
                        placeholder="Action note…"
                        className={`w-full resize-none ${inputCls}`}
                      />
                      {detail.agent_name && (
                        <p className="text-[11px] text-[var(--muted)]">
                          Assigned to: <span className="font-bold text-[var(--text)]">{detail.agent_name}</span>
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          onClick={() => patchStatus('no_action_needed')}
                          disabled={patching}
                          className="px-4 py-2 bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-300 border border-zinc-500/20 rounded-xl text-xs font-extrabold transition disabled:opacity-50"
                        >
                          No Action Required
                        </button>
                        <button
                          onClick={() => patchStatus('resolved')}
                          disabled={patching}
                          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-extrabold transition disabled:opacity-50"
                        >
                          {patching ? 'Saving…' : 'Record Complaint'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
