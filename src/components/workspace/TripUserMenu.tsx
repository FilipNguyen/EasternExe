"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, LogOut, UserCog } from "lucide-react";

interface Props {
  tripId: string;
  displayName: string;
  color: string;
}

/**
 * Avatar in the trip header, with a dropdown for:
 *   - Switching participant on this trip (keep URL, forget localStorage)
 *   - Opening a different trip (go home where the Join form lives)
 *   - Signing out of this trip entirely (clear + home)
 */
export function TripUserMenu({ tripId, displayName, color }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const clearThisTrip = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(`participantId_${tripId}`);
    }
  };

  const switchParticipant = () => {
    clearThisTrip();
    router.push(`/trip/${tripId}/join`);
  };

  const openAnotherTrip = () => {
    router.push("/");
  };

  const signOutOfThisTrip = () => {
    clearThisTrip();
    router.push("/");
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full py-0.5 pr-0.5 pl-2 text-xs transition-colors hover:bg-muted"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="text-muted-foreground">{displayName}</span>
        <div
          className="flex size-7 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: color }}
          aria-hidden
        >
          {displayName.charAt(0).toUpperCase()}
        </div>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-20 w-56 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="border-b px-3 py-2 text-[11px] text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{displayName}</span>
          </div>
          <div className="py-1">
            <MenuItem onClick={switchParticipant} icon={<UserCog className="size-3.5" />}>
              Switch participant
            </MenuItem>
            <MenuItem
              onClick={openAnotherTrip}
              icon={<ArrowRightLeft className="size-3.5" />}
            >
              Open another trip
            </MenuItem>
            <div className="my-1 border-t" />
            <MenuItem
              onClick={signOutOfThisTrip}
              icon={<LogOut className="size-3.5" />}
              variant="destructive"
            >
              Sign out of this trip
            </MenuItem>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  onClick,
  icon,
  children,
  variant = "default",
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  variant?: "default" | "destructive";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted ${
        variant === "destructive" ? "text-red-600 hover:text-red-700" : ""
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
