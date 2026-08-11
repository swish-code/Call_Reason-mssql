import React, { useState, useEffect, useRef } from "react";
import { User, UserRole } from "./types.js";
import UsersManagement from "./components/UsersManagement.tsx";
import Configuration from "./components/Configuration.tsx";
import OpsLogForm from "./components/OpsLogForm.tsx";
import OpsLogsList from "./components/OpsLogsList.tsx";
import OpsDashboard from "./components/OpsDashboard.tsx";
import OpsReports from "./components/OpsReports.tsx";
import PerformanceReport from "./components/PerformanceReport.tsx";
import HistoryLogs from "./components/HistoryLogs.tsx";
import Tasks from "./components/Tasks.tsx";
import RecurringTasks from "./components/RecurringTasks.tsx";
import TaskPool from "./components/TaskPool.tsx";
import Reviews from "./components/Reviews.tsx";
import Surveys from "./components/Surveys.tsx";
import FeedbackDashboard from "./components/FeedbackDashboard.tsx";
import { apiFetch } from "./lib/api.ts";
import {
  Phone,
  PhoneCall,
  ClipboardList,
  FilePlus2,
  SlidersHorizontal,
  BarChart3,
  History,
  FileText,
  Settings,
  LogOut,
  User as UserIcon,
  Lock,
  Building2,
  HelpCircle,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  ShieldAlert,
  Loader2,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Zap,
  BarChart2,
  Sun,
  Moon,
  Bell,
  ClipboardCheck,
  Repeat,
  Inbox,
  Power,
  Send,
  Star,
  MessageSquare
} from "lucide-react";

type ActivePage = "dashboard" | "reports" | "performance" | "users" | "configuration" | "newlog" | "logs" | "history" | "tasks" | "tracker" | "recurring" | "pool" | "mytasks" | "reviews" | "surveys" | "feedbackdash";

// Which collapsible sidebar group each page belongs to (standalone pages omitted)
const PAGE_GROUP: Record<string, string> = {
  newlog: "logs", logs: "logs", history: "logs",
  mytasks: "tasks", tasks: "tasks", pool: "tasks", tracker: "tasks", recurring: "tasks",
  reports: "insights", performance: "insights",
  reviews: "feedback", surveys: "feedback", feedbackdash: "feedback",
  users: "admin", configuration: "admin",
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activePage, setActivePage] = useState<ActivePage>("dashboard");
  // Open by default on desktop, closed (drawer) on mobile
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth >= 768 : true));
  const closeSidebarOnMobile = () => { if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false); };

  // Theme (Light is the default)
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try { return (localStorage.getItem("swish-theme") as "light" | "dark") || "light"; } catch { return "light"; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark"); else root.classList.remove("dark");
    try { localStorage.setItem("swish-theme", theme); } catch {}
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  // Assigned-task notifications (agent): badge + sound + browser/in-app alert
  const [unseenTasks, setUnseenTasks] = useState(0);
  const [taskToast, setTaskToast] = useState("");
  const prevUnseenRef = useRef(0);
  // Which sidebar groups are expanded (collapsible nav sections)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ tasks: true });
  const toggleGroup = (key: string) => setOpenGroups((g) => ({ ...g, [key]: !g[key] }));

  const playBeep = () => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      o.start(); o.stop(ctx.currentTime + 0.46);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    if (!currentUser) { prevUnseenRef.current = 0; return; }
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    const load = async () => {
      try {
        const r = await apiFetch("/api/tasks/unseen-count");
        if (!r.ok) return;
        const { count } = await r.json();
        const c = count || 0;
        if (c > prevUnseenRef.current) {
          playBeep();
          setTaskToast("ðŸ”” You have a new task assigned");
          setTimeout(() => setTaskToast(""), 6000);
          if ("Notification" in window && Notification.permission === "granted") {
            try { new Notification("Swish Tasks", { body: "You have a new task assigned to you." }); } catch (e) {}
          }
        }
        prevUnseenRef.current = c;
        setUnseenTasks(c);
      } catch (e) { /* ignore */ }
    };
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [currentUser]);

  const openTasks = () => { setActivePage("mytasks"); setUnseenTasks(0); prevUnseenRef.current = 0; };

  // The Owner has no Dashboard / New Log / Team Logs / My Tasks â€” keep them off those pages
  useEffect(() => {
    if (currentUser?.role === "owner" && ["dashboard", "newlog", "logs", "mytasks"].includes(activePage)) {
      setActivePage("tracker");
    }
  }, [currentUser, activePage]);

  // Keep the group that owns the active page expanded
  useEffect(() => {
    const g = PAGE_GROUP[activePage];
    if (g) setOpenGroups((prev) => (prev[g] ? prev : { ...prev, [g]: true }));
  }, [activePage]);

  // Shift presence (agents): On Shift / Out of Shift
  const [shiftStatus, setShiftStatus] = useState<"on" | "off">("off");
  const [shiftBusy, setShiftBusy] = useState(false);
  useEffect(() => {
    if (!currentUser || currentUser.role !== "agent") return;
    apiFetch("/api/shift/status").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setShiftStatus(d.status === "on" ? "on" : "off"); }).catch(() => {});
  }, [currentUser]);
  const toggleShift = async () => {
    if (shiftBusy) return;
    setShiftBusy(true);
    const next = shiftStatus === "on" ? "off" : "on";
    const r = await apiFetch(`/api/shift/${next === "on" ? "start" : "end"}`, { method: "POST" });
    setShiftBusy(false);
    if (r.ok) setShiftStatus(next);
  };

  // Login inputs
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Check if session exists in localStorage
  useEffect(() => {
    const saved = localStorage.getItem("crm-user-session");
    if (saved) {
      try {
        setCurrentUser(JSON.parse(saved));
      } catch (e) {
        localStorage.removeItem("crm-user-session");
      }
    }
  }, []);

  // Submit log in authentication
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setLoginError("Please enter your email or username and password.");
      return;
    }

    try {
      setLoginLoading(true);
      setLoginError("");

      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to connect to the authentication server.");
      }

      const userData: User = await res.json();
      setCurrentUser(userData);
      localStorage.setItem("crm-user-session", JSON.stringify(userData));
      setActivePage("dashboard");
    } catch (err: any) {
      setLoginError(err.message || "Sorry, a network error occurred during login.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem("crm-user-session");
  };

  // Render Login page if not authenticated
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden font-sans select-none text-[var(--text)]">

        {/* Animated ambient background */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 -right-24 w-[34rem] h-[34rem] bg-blue-600 rounded-full filter blur-[140px] opacity-20 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-24 w-[34rem] h-[34rem] bg-indigo-700 rounded-full filter blur-[140px] opacity-15 animate-pulse" style={{ animationDelay: "1.2s" }}></div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] bg-sky-500 rounded-full filter blur-[160px] opacity-[0.07]"></div>
          {/* subtle grid */}
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "44px 44px" }}></div>
        </div>

        <button
          onClick={toggleTheme}
          className="absolute top-5 right-5 z-20 p-2.5 bg-[var(--surface)]/80 backdrop-blur border border-[var(--border)] text-[var(--muted)] hover:text-[var(--heading)] rounded-xl transition active:scale-95"
          title={theme === "dark" ? "Switch to Light mode" : "Switch to Dark mode"}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <div className="w-full max-w-5xl grid lg:grid-cols-2 bg-[var(--surface)]/80 backdrop-blur-2xl border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl shadow-black/60 relative z-10 animate-fade-in">

          {/* Left â€” brand / marketing panel */}
          <div className="hidden lg:flex flex-col justify-between p-10 relative bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-900 overflow-hidden">
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, #fff 1px, transparent 1px)", backgroundSize: "26px 26px" }}></div>
            <div className="absolute -bottom-20 -right-20 w-72 h-72 bg-white/10 rounded-full blur-2xl"></div>

            <div className="relative z-10">
              <div className="w-14 h-14 bg-white/15 backdrop-blur rounded-2xl flex items-center justify-center border border-white/20 shadow-lg">
                <Building2 className="w-7 h-7 text-white stroke-[2.2]" />
              </div>
              <h2 className="text-3xl font-black text-white mt-8 leading-tight tracking-tight">Swish Tasks</h2>
              <p className="text-blue-100/80 text-sm mt-4 font-light leading-relaxed max-w-xs">
                One workspace for your call center, technical and complaints teams â€” log activities, track performance, and stay in control.
              </p>
            </div>

            <div className="relative z-10 space-y-4 mt-10">
              {[
                { icon: Zap, t: "Fast department-scoped logging" },
                { icon: BarChart2, t: "Live dashboards & KPIs" },
                { icon: ShieldCheck, t: "Full audit trail & role access" },
              ].map((f) => (
                <div key={f.t} className="flex items-center gap-3 text-white/90">
                  <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0"><f.icon className="w-4.5 h-4.5" /></div>
                  <span className="text-sm font-medium">{f.t}</span>
                </div>
              ))}
            </div>

            <div className="relative z-10 text-[11px] text-blue-100/50 font-medium mt-10">Â© {new Date().getFullYear()} Swish Tasks Â· Secure Access</div>
          </div>

          {/* Right â€” login form */}
          <div className="p-8 sm:p-10 md:p-12 flex flex-col justify-center">
            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-3 mb-8">
              <div className="w-12 h-12 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Building2 className="w-6 h-6 text-[var(--heading)] stroke-[2.2]" />
              </div>
              <span className="text-lg font-black text-[var(--heading)] tracking-tight">Swish Tasks</span>
            </div>

            <div className="mb-8">
              <h1 className="text-2xl font-black text-[var(--heading)] tracking-tight">Welcome back</h1>
              <p className="text-sm text-[var(--muted)] mt-1.5 font-light">Sign in to continue to your workspace.</p>
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-5">
              {loginError && (
                <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-xs text-rose-300 font-bold flex items-center gap-2 animate-fade-in">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <p>{loginError}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--text)] block">Username</label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-[var(--muted)] absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your username"
                    className="w-full pl-11 pr-4 py-3.5 bg-[var(--surface-2)] text-[var(--heading)] placeholder:text-zinc-600 border border-[var(--border)] rounded-2xl text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none transition"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--text)] block">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[var(--muted)] absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPwd ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                    className="w-full pl-11 pr-11 py-3.5 bg-[var(--surface-2)] text-[var(--heading)] placeholder:text-zinc-600 border border-[var(--border)] rounded-2xl text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none transition"
                    dir="ltr"
                  />
                  <button type="button" onClick={() => setShowPwd((s) => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition" tabIndex={-1}>
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="group w-full py-3.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:opacity-60 text-white font-extrabold rounded-2xl text-sm transition duration-150 active:scale-[0.98] shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2"
              >
                {loginLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</>
                ) : (
                  <>Log In to System <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" /></>
                )}
              </button>
            </form>

            <p className="text-[11px] text-zinc-600 mt-8 text-center">Protected system Â· authorized personnel only</p>
          </div>
        </div>
      </div>
    );
  }

  // Get localized role string
  const getLocalizedRole = (role: UserRole) => {
    // Prefer the specific account-type label when available
    if (currentUser?.job_title) return currentUser.job_title;
    switch (role) {
      case "admin": return "System Admin (Admin)";
      case "owner": return "Owner";
      case "manager": return "Manager";
      case "leader": return "Team Leader (TL)";
      case "supervisor": return "Supervisor";
      default: return "Support Agent (Agent)";
    }
  };

  // ----------------------------------------------------
  // Sidebar navigation â€” config-driven, collapsible groups
  // ----------------------------------------------------
  const role = currentUser.role;
  const notOwner = role !== "owner";
  const notAgent = role !== "agent";
  const isAgent = role === "agent";
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const isLeader = role === "leader";
  const logsLabel = isAgent ? "My Logs" : isAdmin ? "All Logs" : "Team Logs";

  type NavItem = { page: ActivePage; label: string; icon: any; visible: boolean; onClick?: () => void; badge?: number; accent?: "amber" };
  type NavEntry =
    | { type: "item"; item: NavItem }
    | { type: "group"; key: string; label: string; icon: any; items: NavItem[] };

  const navGroups: NavEntry[] = [
    { type: "item", item: { page: "dashboard", label: "Dashboard", icon: BarChart3, visible: notOwner } },
    { type: "group", key: "logs", label: "Logs", icon: ClipboardList, items: [
      { page: "newlog", label: "New Log", icon: FilePlus2, visible: notOwner },
      { page: "logs", label: logsLabel, icon: ClipboardList, visible: notOwner },
      { page: "history", label: "History Logs", icon: History, visible: isAdmin || isLeader },
    ] },
    { type: "group", key: "tasks", label: "Tasks", icon: ClipboardCheck, items: [
      { page: "mytasks", label: "My Tasks", icon: ClipboardCheck, visible: notOwner, onClick: openTasks, badge: unseenTasks },
      { page: "tasks", label: "Assign Task", icon: Send, visible: notAgent },
      { page: "pool", label: "Available Tasks", icon: Inbox, visible: isAgent },
      { page: "tracker", label: "Task Tracker", icon: ClipboardList, visible: notAgent },
      { page: "recurring", label: "Recurring Tasks", icon: Repeat, visible: notAgent },
    ] },
    { type: "group", key: "insights", label: "Reports", icon: BarChart2, items: [
      { page: "reports", label: "Reports & Export", icon: FileText, visible: notAgent },
      { page: "performance", label: "Team Performance", icon: BarChart2, visible: notAgent },
    ] },
    { type: "group", key: "feedback", label: "Feedback", icon: Star, items: [
      { page: "feedbackdash", label: "Feedback Dashboard", icon: BarChart2, visible: notAgent },
      { page: "reviews", label: "Ratings & Reviews", icon: Star, visible: true },
      { page: "surveys", label: "Surveys", icon: MessageSquare, visible: true },
    ] },
    { type: "group", key: "admin", label: "Administration", icon: ShieldAlert, items: [
      { page: "users", label: "User Management", icon: ShieldAlert, visible: isAdmin || isManager, accent: "amber" },
      { page: "configuration", label: "Configuration", icon: SlidersHorizontal, visible: isAdmin },
    ] },
  ];

  const renderNavItem = (it: NavItem) => {
    const active = activePage === it.page;
    const Icon = it.icon;
    return (
      <button
        key={it.page}
        onClick={() => { if (it.onClick) it.onClick(); else setActivePage(it.page); closeSidebarOnMobile(); }}
        className={`w-full py-2.5 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
          active
            ? "bg-blue-600 text-white shadow-lg shadow-blue-950/40"
            : it.accent === "amber"
              ? "text-amber-300 hover:text-amber-200 hover:bg-[var(--surface-2)]"
              : "text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]"
        }`}
      >
        <Icon className={`w-4 h-4 shrink-0 ${it.accent === "amber" && !active ? "text-amber-400" : ""}`} />
        {sidebarOpen && (
          <span className="truncate flex items-center gap-2">
            {it.label}
            {it.badge && it.badge > 0
              ? <span className="bg-rose-500 text-white text-[9px] font-extrabold rounded-full px-1.5 py-0.5 leading-none">{it.badge}</span>
              : null}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col md:flex-row relative font-sans text-[var(--text)]">
      {taskToast && (
        <div onClick={openTasks} className="fixed top-5 right-5 z-[100] bg-blue-600 text-white px-5 py-3 rounded-2xl shadow-2xl shadow-blue-900/40 text-sm font-bold cursor-pointer animate-fade-in flex items-center gap-2">
          <Bell className="w-4 h-4" /> {taskToast}
        </div>
      )}
      
      {/* Mobile backdrop â€” closes the drawer when tapped */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 bg-black/50 z-30 md:hidden" aria-hidden="true" />
      )}

      {/* ----------------------------------------------------
          Sidebar Menu navigation
          - Mobile: off-canvas drawer (slides in/out, overlays content)
          - Desktop: sticky column, collapsible to a 20-wide rail
          ---------------------------------------------------- */}
      <aside
        className={`bg-[var(--surface)] text-[var(--text)] z-40 flex flex-col justify-between border-r border-[var(--border)] h-screen overflow-hidden
          fixed top-0 left-0 w-64 transition-transform duration-300 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          md:sticky md:translate-x-0 md:transition-all ${sidebarOpen ? "md:w-64" : "md:w-20"}`}
      >
        <div className="flex flex-col space-y-8 p-4">
          
          {/* Logo banner */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600/20 text-blue-400 border border-blue-500/20 rounded-xl flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            {sidebarOpen && (
              <div className="truncate">
                <h2 className="text-xs font-extrabold text-[var(--heading)] leading-tight truncate">Swish Tasks</h2>
                <span className="text-[10px] text-blue-400 font-bold block mt-0.5 leading-none">Operations & Logs</span>
              </div>
            )}
          </div>

          {/* User Session Profile Card */}
          <div className="bg-[var(--surface-2)] border border-[var(--border)] p-3 rounded-2xl flex items-center gap-2.5 overflow-hidden shrink-0">
            <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow shadow-blue-500/10">
              {currentUser.name.substring(0, 2)}
            </div>
            {sidebarOpen && (
              <div className="truncate text-left">
                <h4 className="text-[11px] font-bold text-[var(--heading)] truncate leading-tight">{currentUser.name}</h4>
                <span className="text-[10px] text-emerald-400 font-bold block mt-0.5 leading-none">{getLocalizedRole(currentUser.role)}</span>
              </div>
            )}
          </div>

          {/* Nav Buttons links */}
          <nav className="flex flex-col gap-1">
            {navGroups.map((entry) => {
              if (entry.type === "item") {
                return entry.item.visible ? renderNavItem(entry.item) : null;
              }
              const items = entry.items.filter((it) => it.visible);
              if (!items.length) return null;
              if (!sidebarOpen) {
                return (
                  <div key={entry.key} className="flex flex-col gap-1">
                    {items.map(renderNavItem)}
                  </div>
                );
              }
              const open = !!openGroups[entry.key];
              const hasActive = items.some((it) => it.page === activePage);
              const GIcon = entry.icon;
              return (
                <div key={entry.key} className="flex flex-col">
                  <button
                    onClick={() => toggleGroup(entry.key)}
                    className={`w-full py-3 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-3 ${
                      hasActive && !open
                        ? "text-[var(--heading)] bg-[var(--surface-2)]"
                        : "text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    <GIcon className="w-4 h-4 shrink-0" />
                    <span className="truncate flex-1 text-left">{entry.label}</span>
                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                  </button>
                  {open && (
                    <div className="flex flex-col gap-1 mt-1 ml-3.5 pl-2.5 border-l border-[var(--border)]">
                      {items.map(renderNavItem)}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Logout bottom */}
        <div className="p-4 border-t border-[var(--border)]">
          <button
            onClick={handleLogout}
            className="w-full py-3 px-3.5 rounded-xl text-xs font-bold text-[var(--muted)] hover:text-rose-400 hover:bg-rose-500/10 transition flex items-center gap-3 active:scale-95"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span className="truncate">Log Out</span>}
          </button>
        </div>
      </aside>

      {/* ----------------------------------------------------
          Main Page Content area
          ---------------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        
        {/* Top Navbar Header */}
        <header className="sticky top-0 bg-[var(--bg)]/85 backdrop-blur-md border-b border-[var(--border)] p-4 flex items-center justify-between z-30 print:hidden shadow-xs">
          
          <div className="flex items-center gap-3">
            {/* Toggle sidebar button */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-[var(--surface-2)] rounded-xl transition active:scale-90"
            >
              <Menu className="w-4 h-4 text-[var(--text)]" />
            </button>

            <h1 className="text-xs md:text-sm font-extrabold text-[var(--text)]">
              {activePage === "dashboard" && "Dashboard Overview"}
              {activePage === "reports" && "Reports & Export"}
              {activePage === "performance" && "Team Performance"}
              {activePage === "users" && "User and Access Role Management"}
              {activePage === "configuration" && "System Configuration"}
              {activePage === "newlog" && "New Log"}
              {activePage === "logs" && "Operations Logs"}
              {activePage === "history" && "History Logs â€” Audit Trail"}
              {activePage === "mytasks" && "My Tasks"}
              {activePage === "tasks" && "Assign Tasks"}
              {activePage === "tracker" && "Task Tracker"}
              {activePage === "recurring" && "Recurring Tasks"}
              {activePage === "pool" && "Available Tasks"}
              {activePage === "reviews" && "Ratings & Reviews"}
              {activePage === "surveys" && "Surveys"}
              {activePage === "feedbackdash" && "Feedback Dashboard"}
            </h1>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* Role indicator banner */}
            <div className="hidden sm:flex items-center gap-1.5 bg-[var(--surface)] text-blue-400 px-3.5 py-1.5 rounded-2xl border border-[var(--border)]/80 font-bold">
              <UserCheck className="w-3.5 h-3.5" />
              <span>Logged in as: <strong>{getLocalizedRole(currentUser.role)}</strong></span>
            </div>

            {currentUser.role === "agent" && (
              <button
                onClick={toggleShift}
                disabled={shiftBusy}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-[11px] font-extrabold border transition active:scale-95 disabled:opacity-60 ${
                  shiftStatus === "on"
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : "bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--heading)]"
                }`}
                title={shiftStatus === "on" ? "You are On Shift â€” click to end" : "You are Out of Shift â€” click to start"}
              >
                <Power className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{shiftStatus === "on" ? "On Shift" : "Out of Shift"}</span>
                <span className={`w-2 h-2 rounded-full ${shiftStatus === "on" ? "bg-emerald-400 animate-pulse" : "bg-[var(--muted)]"}`}></span>
              </button>
            )}

            {currentUser.role !== "owner" && (
              <button
                onClick={openTasks}
                className="relative p-2 bg-[var(--surface)] hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--heading)] border border-[var(--border)] rounded-xl transition active:scale-95"
                title="My Tasks"
              >
                <Bell className="w-4 h-4" />
                {unseenTasks > 0 && <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[9px] font-extrabold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{unseenTasks}</span>}
              </button>
            )}

            <button
              onClick={toggleTheme}
              className="p-2 bg-[var(--surface)] hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--heading)] border border-[var(--border)] rounded-xl transition active:scale-95"
              title={theme === "dark" ? "Switch to Light mode" : "Switch to Dark mode"}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              onClick={handleLogout}
              className="p-2 bg-[var(--surface)] hover:bg-rose-500/10 text-[var(--muted)] hover:text-rose-400 border border-[var(--border)] rounded-xl transition active:scale-95"
              title="Quick Log Out"
            >
              <LogOut className="w-4.5 h-4.5 md:w-3.5 md:h-3.5" />
            </button>
          </div>
        </header>

        {/* Dynamic Main view switcher */}
        <main className="p-4 md:p-8 flex-1 max-w-7xl mx-auto w-full">
          {activePage === "dashboard" && (
            <OpsDashboard currentUser={currentUser} />
          )}
          {activePage === "reports" && (
            <OpsReports currentUser={currentUser} />
          )}
          {activePage === "history" && (
            <HistoryLogs currentUser={currentUser} />
          )}
          {activePage === "mytasks" && (
            <Tasks currentUser={currentUser} mode="mine" onSeen={() => setUnseenTasks(0)} />
          )}
          {activePage === "tasks" && currentUser.role !== "agent" && (
            <Tasks currentUser={currentUser} mode="assign" />
          )}
          {activePage === "tracker" && currentUser.role !== "agent" && (
            <Tasks currentUser={currentUser} mode="tracker" />
          )}
          {activePage === "recurring" && currentUser.role !== "agent" && (
            <RecurringTasks currentUser={currentUser} />
          )}
          {activePage === "pool" && currentUser.role === "agent" && (
            <TaskPool currentUser={currentUser} shiftStatus={shiftStatus} />
          )}
          {activePage === "users" && (
            <UsersManagement currentUser={currentUser} />
          )}
          {activePage === "configuration" && (
            <Configuration currentUser={currentUser} />
          )}
          {activePage === "newlog" && (
            <OpsLogForm currentUser={currentUser} onDone={() => setActivePage("logs")} />
          )}
          {activePage === "logs" && (
            <OpsLogsList currentUser={currentUser} />
          )}
          {activePage === "performance" && currentUser.role !== "agent" && (
            <PerformanceReport currentUser={currentUser} />
          )}
          {activePage === "reviews" && (
            <Reviews currentUser={currentUser} />
          )}
          {activePage === "surveys" && (
            <Surveys currentUser={currentUser} />
          )}
          {activePage === "feedbackdash" && currentUser.role !== "agent" && (
            <FeedbackDashboard currentUser={currentUser} />
          )}
        </main>
      </div>

    </div>
  );
}
