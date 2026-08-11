import { useState, type ReactNode } from "react";
import { User } from "../types.js";
import { Megaphone, ListChecks, ClipboardList, Database, LayoutList } from "lucide-react";
import SurveyCampaigns from "./SurveyCampaigns.tsx";
import SurveyQueue from "./SurveyQueue.tsx";
import SurveyTemplates from "./SurveyTemplates.tsx";
import SurveysData from "./SurveysData.tsx";
import AllSurveys from "./AllSurveys.tsx";

interface SurveysProps { currentUser: User; }

type Tab = "campaigns" | "queue" | "all" | "templates" | "data";

export default function Surveys({ currentUser }: SurveysProps) {
  const role = currentUser.role;
  const isAgent = role === "agent";

  const tabs: { key: Tab; label: string; icon: ReactNode; visible: boolean }[] = [
    { key: "campaigns", label: "Campaigns", icon: <Megaphone className="w-4 h-4" />, visible: !isAgent },
    { key: "queue", label: "Survey Queue", icon: <ListChecks className="w-4 h-4" />, visible: true },
    { key: "all", label: "All Surveys", icon: <LayoutList className="w-4 h-4" />, visible: !isAgent },
    { key: "templates", label: "Templates", icon: <ClipboardList className="w-4 h-4" />, visible: ["admin", "manager", "supervisor", "leader"].includes(role) },
    { key: "data", label: "Survey Data", icon: <Database className="w-4 h-4" />, visible: !isAgent },
  ];

  const visibleTabs = tabs.filter(t => t.visible);
  const [active, setActive] = useState<Tab>(isAgent ? "queue" : "campaigns");

  // Guard: if the current tab is not visible for this role, fall back to the first visible one.
  const activeTab = visibleTabs.some(t => t.key === active) ? active : (visibleTabs[0]?.key || "queue");

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text)]">
      {/* Sub-tab bar */}
      <div className="flex flex-wrap items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-2 shadow-lg">
        {visibleTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 transition active:scale-95 ${
              activeTab === t.key
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                : 'text-[var(--text)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "campaigns" && <SurveyCampaigns currentUser={currentUser} />}
      {activeTab === "queue" && <SurveyQueue currentUser={currentUser} />}
      {activeTab === "all" && <AllSurveys currentUser={currentUser} />}
      {activeTab === "templates" && <SurveyTemplates currentUser={currentUser} />}
      {activeTab === "data" && <SurveysData currentUser={currentUser} />}
    </div>
  );
}
