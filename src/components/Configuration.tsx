import React, { useState, useEffect } from "react";
import { User, DropdownOption, CONFIGURABLE_LISTS, Brand, Branch, Category } from "../types.js";
import { apiFetch } from "../lib/api.ts";
import { Settings, Plus, Trash, Pencil, Check, X, ChevronUp, ChevronDown, Eye, EyeOff, RefreshCw, ListChecks, AlertCircle } from "lucide-react";

interface ConfigurationProps {
  currentUser: User;
}

// ---- Generic option list card (add / edit / delete / disable / reorder) ----
interface OptionListCardProps {
  meta: { key: string; title: string; description: string };
  items: DropdownOption[];
  onChange: () => void;
}
const OptionListCard: React.FC<OptionListCardProps> = ({ meta, items, onChange }) => {
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);

  const refresh = () => onChange();

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setBusy(true);
    await apiFetch("/api/options", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list_key: meta.key, label: newLabel.trim() }) });
    setNewLabel(""); setBusy(false); refresh();
  };

  const saveEdit = async (id: string) => {
    if (!editLabel.trim()) return;
    await apiFetch(`/api/options/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: editLabel.trim() }) });
    setEditingId(null); refresh();
  };

  const toggleActive = async (o: DropdownOption) => {
    await apiFetch(`/api/options/${o.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !o.active }) });
    refresh();
  };

  const remove = async (o: DropdownOption) => {
    if (!confirm(`Delete option "${o.label}" from ${meta.title}?`)) return;
    await apiFetch(`/api/options/${o.id}`, { method: "DELETE" });
    refresh();
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sorted.length) return;
    const ids = sorted.map((o) => o.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await apiFetch("/api/options/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list_key: meta.key, ids }) });
    refresh();
  };

  return (
    <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl space-y-4">
      <div>
        <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2"><ListChecks className="w-4 h-4 text-blue-400" /> {meta.title}</h3>
        <p className="text-[11px] text-[var(--muted)] mt-0.5 font-light">{meta.description}</p>
      </div>

      <div className="space-y-1.5">
        {sorted.map((o, i) => (
          <div key={o.id} className={`flex items-center gap-2 p-2 pl-3 bg-[var(--bg)] border border-[var(--border)]/70 rounded-xl text-xs ${!o.active ? "opacity-50" : ""}`}>
            <div className="flex flex-col">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-[var(--muted)] hover:text-[var(--heading)] disabled:opacity-20"><ChevronUp className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === sorted.length - 1} className="text-[var(--muted)] hover:text-[var(--heading)] disabled:opacity-20"><ChevronDown className="w-3.5 h-3.5" /></button>
            </div>
            {editingId === o.id ? (
              <input autoFocus value={editLabel} onChange={(e) => setEditLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit(o.id)}
                className="flex-1 px-2 py-1 bg-[var(--surface-2)] text-[var(--heading)] border border-blue-500/40 rounded-lg text-xs focus:outline-none" />
            ) : (
              <span className="flex-1 font-bold text-[var(--heading)]">{o.label}{!o.active && <span className="ml-2 text-[9px] text-[var(--muted)] font-normal">(disabled)</span>}</span>
            )}
            {editingId === o.id ? (
              <>
                <button type="button" onClick={() => saveEdit(o.id)} className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded-lg"><Check className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => setEditingId(null)} className="p-1 text-[var(--muted)] hover:bg-zinc-700/40 rounded-lg"><X className="w-3.5 h-3.5" /></button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setEditingId(o.id); setEditLabel(o.label); }} className="p-1 text-[var(--muted)] hover:text-blue-400 hover:bg-blue-500/10 rounded-lg" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => toggleActive(o)} className="p-1 text-[var(--muted)] hover:text-amber-400 hover:bg-amber-500/10 rounded-lg" title={o.active ? "Disable" : "Enable"}>{o.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</button>
                <button type="button" onClick={() => remove(o)} className="p-1 text-[var(--muted)] hover:text-rose-400 hover:bg-rose-500/10 rounded-lg" title="Delete"><Trash className="w-3.5 h-3.5" /></button>
              </>
            )}
          </div>
        ))}
        {sorted.length === 0 && <div className="text-center py-4 text-[var(--muted)] text-xs">No options yet.</div>}
      </div>

      <form onSubmit={add} className="flex gap-2">
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Add new option…" className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-bold text-[var(--heading)] placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <button type="submit" disabled={busy} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1 shrink-0 active:scale-95"><Plus className="w-4 h-4" /></button>
      </form>
    </div>
  );
};

// ---- Simple entity card for Brands / Branches / Categories (add / delete) ----
interface SimpleEntityCardProps {
  title: string; description: string; items: any[]; labelField: string; base: string; onChange: () => void;
}
const SimpleEntityCard: React.FC<SimpleEntityCardProps> = ({ title, description, items, labelField, base, onChange }) => {
  const [name, setName] = useState("");
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await apiFetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
    setName(""); onChange();
  };
  const remove = async (id: string, label: string) => {
    if (!confirm(`Delete "${label}"?`)) return;
    await apiFetch(`${base}/${id}`, { method: "DELETE" });
    onChange();
  };
  return (
    <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl space-y-4">
      <div>
        <h3 className="text-sm font-extrabold text-[var(--heading)] flex items-center gap-2"><ListChecks className="w-4 h-4 text-emerald-400" /> {title}</h3>
        <p className="text-[11px] text-[var(--muted)] mt-0.5 font-light">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <span key={it.id} className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 bg-[var(--bg)] border border-[var(--border)]/70 rounded-xl text-xs font-bold text-[var(--heading)]">
            {it[labelField]}
            <button type="button" onClick={() => remove(it.id, it[labelField])} className="p-0.5 text-[var(--muted)] hover:text-rose-400 rounded"><X className="w-3.5 h-3.5" /></button>
          </span>
        ))}
        {items.length === 0 && <span className="text-[var(--muted)] text-xs">None defined.</span>}
      </div>
      <form onSubmit={add} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Add new ${title.slice(0, -1).toLowerCase()}…`} className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-bold text-[var(--heading)] placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <button type="submit" className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shrink-0 active:scale-95"><Plus className="w-4 h-4" /></button>
      </form>
    </div>
  );
};

export default function Configuration({ currentUser }: ConfigurationProps) {
  const [options, setOptions] = useState<DropdownOption[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAll = async () => {
    try {
      setLoading(true); setError("");
      const [ro, rb, rbr, rc] = await Promise.all([
        apiFetch("/api/options"), apiFetch("/api/brands"), apiFetch("/api/branches"), apiFetch("/api/categories"),
      ]);
      if (!ro.ok) throw new Error("Failed to load configuration options.");
      setOptions(await ro.json());
      if (rb.ok) setBrands(await rb.json());
      if (rbr.ok) setBranches(await rbr.json());
      if (rc.ok) setCategories(await rc.json());
    } catch (err: any) {
      setError(err.message || "Connection error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      <div className="bg-[var(--surface)] p-5 border border-[var(--border)] shadow-lg rounded-3xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl"><Settings className="w-6 h-6" /></div>
          <div>
            <h2 className="text-md font-extrabold text-[var(--heading)]">System Configuration</h2>
            <p className="text-xs text-[var(--muted)] font-light mt-0.5">Manage every dropdown list used across the system. Changes apply to all forms on their next load.</p>
          </div>
        </div>
        <button onClick={fetchAll} className="p-3 text-[var(--muted)] hover:text-[var(--heading)] bg-[var(--bg)] hover:bg-[var(--surface)] border border-[var(--border)] rounded-2xl active:scale-95 transition" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[260px]">
          <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-3 text-xs text-[var(--muted)]">Loading configuration...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {CONFIGURABLE_LISTS.map((meta) => (
            <OptionListCard key={meta.key} meta={meta} items={options.filter((o) => o.list_key === meta.key)} onChange={fetchAll} />
          ))}
          <SimpleEntityCard title="Brands" description="Brand options used across the system" items={brands} labelField="brand_name" base="/api/brands" onChange={fetchAll} />
          <SimpleEntityCard title="Branches" description="Branch options (shown for Complaints)" items={branches} labelField="branch_name" base="/api/branches" onChange={fetchAll} />
          <SimpleEntityCard title="Categories" description="Case category options" items={categories} labelField="category_name" base="/api/categories" onChange={fetchAll} />
        </div>
      )}
    </div>
  );
}
