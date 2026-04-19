"use client";

import { MessageSquare, User, Map, Compass, Calendar } from "lucide-react";

import { cn } from "@/lib/utils";

export type WorkspaceTab = "group" | "me" | "map" | "nearby" | "events";

const TABS: { id: WorkspaceTab; label: string; icon: React.ElementType }[] = [
  { id: "group", label: "Group", icon: MessageSquare },
  { id: "me", label: "Me", icon: User },
  { id: "map", label: "Map", icon: Map },
  { id: "nearby", label: "Nearby", icon: Compass },
  { id: "events", label: "Events", icon: Calendar },
];

interface Props {
  active: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
}

export function TabsShell({ active, onChange }: Props) {
  return (
    <>
      {/* Desktop: top tab bar */}
      <nav className="hidden border-b bg-background/80 backdrop-blur sm:block">
        <div className="mx-auto flex max-w-2xl gap-1 px-4">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange(t.id)}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile: bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-2xl">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange(t.id)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <Icon
                  className={cn(
                    "size-5",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
