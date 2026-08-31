import React, { useState } from "react";
import { apiFetch } from "../lib/api.ts";
import { KeyRound, X, Eye, EyeOff, AlertCircle, Check, Loader2 } from "lucide-react";

interface Props { onClose: () => void; }

const inputCls =
  "w-full px-4 py-3 bg-[var(--bg)] text-[var(--heading)] border border-[var(--border)] rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none transition pr-11";

// Defined at module scope (not inside ChangePassword) so its identity is
// stable across renders — an inline component redefined on every keystroke
// makes React remount the DOM node each time, which drops input focus.
const Field = ({ label, value, onChange, show, onToggleShow, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void;
  show: boolean; onToggleShow: () => void; autoFocus?: boolean;
}) => (
  <div className="space-y-1.5">
    <label className="text-xs font-bold text-[var(--text)]">{label}</label>
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
        autoComplete={label.startsWith("Current") ? "current-password" : "new-password"}
      />
      <button
        type="button"
        onClick={onToggleShow}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--heading)] transition"
        title={show ? "Hide passwords" : "Show passwords"}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  </div>
);

/**
 * Self-service password change. The current password is required — the server
 * verifies it, so simply being signed in is not enough to replace it.
 */
export default function ChangePassword({ onClose }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Mirror the server's rules so mistakes are caught before a round trip.
    if (!current || !next || !confirm) return setError("Please fill in all three fields.");
    if (next.length < 6) return setError("The new password must be at least 6 characters.");
    if (next !== confirm) return setError("The new password and its confirmation do not match.");
    if (next === current) return setError("The new password must be different from your current one.");

    setSaving(true);
    try {
      const res = await apiFetch("/api/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Could not change the password."); return; }
      setDone(true);
      setTimeout(onClose, 1600);
    } catch (err: any) {
      setError(err.message || "Connection error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl shadow-2xl w-full max-w-md relative overflow-hidden">
        {done && (
          <div className="absolute inset-0 bg-[var(--surface)]/95 backdrop-blur-sm z-10 flex flex-col items-center justify-center text-center p-6">
            <div className="w-16 h-16 bg-emerald-900/30 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center mb-4">
              <Check className="w-8 h-8 stroke-[3]" />
            </div>
            <h3 className="text-lg font-extrabold text-[var(--heading)]">Password Changed</h3>
            <p className="text-xs text-[var(--muted)] mt-1">Use your new password the next time you sign in.</p>
          </div>
        )}

        <div className="flex items-center justify-between p-6 border-b border-[var(--border)]">
          <h2 className="text-md font-extrabold text-[var(--heading)] flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-blue-400" /> Change Password
          </h2>
          <button onClick={onClose} className="p-2 text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)] rounded-xl transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {error && (
            <div className="flex bg-rose-500/10 border border-rose-500/20 text-rose-300 p-3 rounded-2xl text-xs gap-2 items-center">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="font-bold">{error}</p>
            </div>
          )}

          <Field label="Current Password" value={current} onChange={setCurrent} show={show} onToggleShow={() => setShow((s) => !s)} autoFocus />
          <Field label="New Password" value={next} onChange={setNext} show={show} onToggleShow={() => setShow((s) => !s)} />
          <Field label="Confirm New Password" value={confirm} onChange={setConfirm} show={show} onToggleShow={() => setShow((s) => !s)} />

          <p className="text-[11px] text-[var(--muted)]">At least 6 characters.</p>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-[var(--bg)] hover:bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] font-bold rounded-2xl text-xs transition active:scale-95"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-extrabold rounded-2xl text-xs transition active:scale-95 flex items-center justify-center gap-2"
            >
              {saving ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>) : "Change Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
