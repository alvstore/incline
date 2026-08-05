import { useLocation, useNavigate } from "react-router-dom";
import { Sparkles, Library, Users, UtensilsCrossed, Dumbbell } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type TabKey = "create" | "templates" | "member-plans" | "meal-catalog";

interface TabDef {
  key: TabKey;
  label: string;
  shortLabel: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  matchPaths: string[];
  adminOnly?: boolean;
}

const TABS: TabDef[] = [
  {
    key: "create",
    label: "Create Plan",
    shortLabel: "Create",
    href: "/fitness/create",
    icon: Sparkles,
    matchPaths: ["/fitness/create", "/fitness/preview"],
  },
  {
    key: "templates",
    label: "Plan Templates",
    shortLabel: "Templates",
    href: "/fitness/templates",
    icon: Library,
    matchPaths: ["/fitness/templates"],
  },
  {
    key: "member-plans",
    label: "Member Plans",
    shortLabel: "Members",
    href: "/fitness/member-plans",
    icon: Users,
    matchPaths: ["/fitness/member-plans"],
  },
  {
    key: "meal-catalog",
    label: "Meal Catalog",
    shortLabel: "Meals",
    href: "/fitness/meal-catalog",
    icon: UtensilsCrossed,
    matchPaths: ["/fitness/meal-catalog", "/meal-catalog"],
    adminOnly: true,
  },
];

export function FitnessHubTabs({ compact = false }: { compact?: boolean } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasAnyRole } = useAuth();
  const canSeeCatalog = hasAnyRole(["owner", "admin", "manager"]);

  const visibleTabs = TABS.filter((t) => !t.adminOnly || canSeeCatalog);

  const activeKey: TabKey =
    visibleTabs.find((t) =>
      t.matchPaths.some((p) => location.pathname.startsWith(p))
    )?.key ?? "create";

  // Compact mode is used inside the builder shell, where the page already has
  // its own title bar — a single breadcrumb row avoids stacked headers.
  if (compact) {
    const activeTab = visibleTabs.find((t) => t.key === activeKey);
    return (
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Dumbbell className="h-3.5 w-3.5 text-primary" />
        <button
          type="button"
          onClick={() => navigate("/fitness/create")}
          className="cursor-pointer rounded transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          Diet &amp; Workout
        </button>
        {activeTab && (
          <>
            <span aria-hidden>/</span>
            <span className="font-medium text-foreground">{activeTab.label}</span>
          </>
        )}
      </nav>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <Dumbbell className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight leading-none">
            Diet &amp; Workout
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Create, manage and assign fitness &amp; nutrition plans
          </p>
        </div>
      </div>


      <div className="border-b">
        <nav
          className="flex gap-1 overflow-x-auto -mb-px scrollbar-none"
          role="tablist"
          aria-label="Diet and Workout sections"
        >
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === activeKey;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => navigate(tab.href)}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
