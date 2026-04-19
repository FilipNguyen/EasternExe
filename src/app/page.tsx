import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { JoinTripForm } from "@/components/landing/JoinTripForm";

export default function LandingPage() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-blue-100 px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,hsl(var(--muted))_0%,transparent_70%)]"
      />
      <div className="mx-auto flex max-w-xl flex-col items-center text-center animate-fade-in">
        <span className="mb-6 inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
          Group trip workspace · v0.1
        </span>
        <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
          EasternExe
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground sm:text-xl">
          The AI workspace for group trips.
        </p>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          Upload your chat, docs, and voice intros. EasternExe reads everything
          and opens a group chat, a private assistant, and a live map — all
          grounded in what your group actually said.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="group">
            <Link href="/setup">
              Create a trip
              <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
          <span className="text-xs text-muted-foreground">
            No sign-up. Your trip lives at its own URL.
          </span>
        </div>

        <JoinTripForm />
      </div>
    </main>
  );
}
