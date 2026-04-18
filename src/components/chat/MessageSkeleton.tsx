export function MessageSkeleton() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-6">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`flex items-end gap-2 ${i % 2 === 0 ? "flex-row" : "flex-row-reverse"}`}
        >
          <div className="size-7 shrink-0 animate-pulse rounded-full bg-muted" />
          <div
            className={`flex max-w-[78%] flex-col gap-1 ${i % 2 === 0 ? "items-start" : "items-end"}`}
          >
            <div className="h-2.5 w-16 animate-pulse rounded bg-muted/70" />
            <div
              className={`h-8 animate-pulse rounded-2xl bg-muted ${
                i === 0 ? "w-56" : i === 1 ? "w-40" : "w-64"
              }`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
