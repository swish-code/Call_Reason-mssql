import { useState, useEffect } from "react";
import { User, SurveyRecordType } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Upload, FileDown, X, AlertCircle } from "lucide-react";

interface Props { currentUser: User; onUploaded?: () => void; }
interface UploadResult {
  total: number; inserted: number; answered: number;
  no_answer: number; invalid: number; errors: { row: number; message: string }[];
}

const inputCls = "px-3 py-2.5 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-xl text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none";
const selCls = inputCls + " font-bold [&>option]:bg-[var(--surface)]";
const LEADER_ROLES = ['admin', 'owner', 'manager', 'supervisor', 'leader'];

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

// Self-contained "Upload Survey Data" button + modal, reusable across tabs.
export default function SurveyDataUploadButton({ currentUser, onUploaded }: Props) {
  const [types, setTypes] = useState<SurveyRecordType[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadType, setUploadType] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState("");

  const canUpload = LEADER_ROLES.includes(currentUser.role) || (currentUser as any).can_upload === true;

  useEffect(() => {
    apiFetch('/api/survey-records/types').then(r => r.ok ? r.json() : []).then(setTypes).catch(() => {});
  }, []);

  const openUpload = () => {
    setShowUpload(true);
    setUploadType(types[0]?.key || "");
    setUploadFile(null);
    setUploadResult(null);
    setUploadError("");
  };

  const handleTemplate = async () => {
    if (!uploadType) return;
    const res = await apiFetch(`/api/survey-records/${uploadType}/template`);
    if (!res.ok) return;
    const data = await res.json();
    downloadBase64(data.file, data.filename);
  };

  const handleUpload = async () => {
    if (!uploadType || !uploadFile) return;
    setUploading(true);
    setUploadError("");
    setUploadResult(null);
    try {
      const b64 = await readFileBase64(uploadFile);
      const res = await apiFetch(`/api/survey-records/${uploadType}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: b64 }),
      });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error || "Upload failed."); return; }
      setUploadResult(data);
      onUploaded?.();
    } catch (e: any) {
      setUploadError(e.message || "Upload error.");
    } finally {
      setUploading(false);
    }
  };

  if (!canUpload) return null;

  return (
    <>
      <button
        onClick={openUpload}
        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-2xl text-xs flex items-center gap-1.5 transition"
      >
        <Upload className="w-4 h-4" /> Upload Survey Data
      </button>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2">
                <Upload className="w-4 h-4 text-blue-400" /> Upload Survey Data
              </h3>
              <button onClick={() => setShowUpload(false)} className="p-1.5 hover:bg-[var(--surface-2)] text-[var(--muted)] rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--text)]">Type</label>
              <select value={uploadType} onChange={e => { setUploadType(e.target.value); setUploadResult(null); }} className={`w-full ${selCls}`}>
                <option value="">— Select Type —</option>
                {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>

            <button
              onClick={handleTemplate}
              disabled={!uploadType}
              className="w-full px-4 py-2.5 bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95 disabled:opacity-50"
            >
              <FileDown className="w-4 h-4" /> Download Template
            </button>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--text)]">File (.xlsx / .xls)</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-[var(--text)] file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-700 file:cursor-pointer"
              />
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
                  <span className="text-[var(--muted)]">Answered:</span><span className="font-bold">{uploadResult.answered}</span>
                  <span className="text-[var(--muted)]">No answer:</span><span className="font-bold">{uploadResult.no_answer}</span>
                  <span className="text-[var(--muted)]">Invalid:</span><span className="font-bold">{uploadResult.invalid}</span>
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
                disabled={!uploadType || !uploadFile || uploading}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
