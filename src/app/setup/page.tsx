import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function SetupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Setup</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The stepped setup flow lands in milestone 3. This placeholder just
          proves the landing CTA routes correctly.
        </p>
        <Button asChild variant="outline" className="mt-8">
          <Link href="/">Back to landing</Link>
        </Button>
      </div>
    </main>
  );
}
