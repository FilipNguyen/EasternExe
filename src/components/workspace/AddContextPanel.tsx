"use client";

import { useCallback, useRef, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Plus,
  Upload as UploadIcon,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Kind = "whatsapp_zip" | "doc" | "image" | "other";

interface FileEntry {
  file: File;
  kind: Kind;
  uploading: boolean;
  storage_path?: string;
  error?: string;
}

interface AddItem {
  url?: string;
  text?: string;
  title?: string;
  storage_path?: string;
  filename?: string;
}

function classify(name: string): Kind {
  const n = name.toLowerCase();
  if (n.endsWith(".zip")) return "whatsapp_zip";
  if (n.endsWith(".pdf") || n.endsWith(".txt") || n.endsWith(".md"))
    return "doc";
  if (
    n.endsWith(".png") ||
    n.endsWith(".jpg") ||
    n.endsWith(".jpeg") ||
    n.endsWith(".webp")
  )
    return "image";
  return "other";
}

function kindLabel(k: Kind): string {
  switch (k) {
    case "whatsapp_zip":
      return "WhatsApp export";
    case "doc":
      return "Document";
    case "image":
      return "Image";
    default:
      return "File";
  }
}

interface Props {
  tripId: string;
  onClose: () => void;
}

export function AddContextPanel({ tripId, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | {
        queued: number;
        detected: Array<{ source: string; kind: string; filename: string }>;
      }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const arr = Array.from(fileList);
      const withMeta: FileEntry[] = arr.map((file) => ({
        file,
        kind: classify(file.name),
        uploading: true,
      }));
      setFiles((prev) => [...prev, ...withMeta]);

      const supabase = getSupabaseBrowserClient();
      for (const entry of withMeta) {
        const path = `${tripId}/add-${Date.now()}-${entry.file.name}`;
        const { error: upErr } = await supabase.storage
          .from("trip-uploads")
          .upload(path, entry.file, {
            upsert: false,
            contentType: entry.file.type,
          });
        setFiles((prev) =>
          prev.map((f) =>
            f.file === entry.file
              ? {
                  ...f,
                  uploading: false,
                  storage_path: upErr ? undefined : path,
                  error: upErr ? upErr.message : undefined,
                }
              : f
          )
        );
      }
    },
    [tripId]
  );

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) {
      void addFiles(e.dataTransfer.files);
    }
  };

  const removeFile = (f: File) => {
    setFiles((prev) => prev.filter((x) => x.file !== f));
  };

  const canSubmit =
    !submitting &&
    (url.trim().length > 0 ||
      pasteText.trim().length > 0 ||
      files.some((f) => f.storage_path));

  const submit = async () => {
    setSubmitting(true);
    setError(null);

    const items: AddItem[] = [];
    if (url.trim()) {
      for (const u of url.split(/\s+/)) {
        if (u.trim()) items.push({ url: u.trim() });
      }
    }
    if (pasteText.trim()) {
      items.push({
        text: pasteText.trim(),
        title: pasteTitle.trim() || undefined,
      });
    }
    for (const f of files) {
      if (f.storage_path) {
        items.push({ storage_path: f.storage_path, filename: f.file.name });
      }
    }

    try {
      const res = await fetch(`/api/ingest/${tripId}/add`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        queued: number;
        detected: Array<{ source: string; kind: string; filename: string }>;
      };
      setResult(body);
      setUrl("");
      setPasteText("");
      setPasteTitle("");
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Add context</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Drop files, paste a link, or paste text — Quorum auto-detects
              the type and pulls places + context into the trip brain.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          <section>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
              <LinkIcon className="size-3.5" /> Links
            </label>
            <Input
              placeholder="https://… (paste one or more, space-separated)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={submitting}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              The link is fetched server-side and its text is added to the
              brain.
            </p>
          </section>

          <section>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
              <FileText className="size-3.5" /> Paste a note
            </label>
            <Input
              placeholder="Title (optional)"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              disabled={submitting}
              className="mb-1.5"
            />
            <textarea
              placeholder="Paste a Google Maps list, a restaurant rec from a friend, notes, anything…"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              disabled={submitting}
              rows={5}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </section>

          <section>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
              <UploadIcon className="size-3.5" /> Files
            </label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed bg-muted/30 p-5 text-center text-xs text-muted-foreground transition-colors hover:bg-muted/60"
            >
              <UploadIcon className="mb-1.5 size-4" />
              Drop .zip (WhatsApp), .pdf, .txt, .md, .png/.jpg here — or click
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".zip,.pdf,.txt,.md,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {files.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {files.map((f) => (
                  <li
                    key={f.file.name + f.file.size}
                    className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {f.kind === "image" ? (
                        <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{f.file.name}</span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {kindLabel(f.kind)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {f.uploading ? (
                        <Loader2 className="size-3 animate-spin text-muted-foreground" />
                      ) : f.error ? (
                        <span className="text-destructive">{f.error}</span>
                      ) : (
                        <span className="text-green-600">ready</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFile(f.file)}
                        className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {error ? (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          {result ? (
            <div className="rounded-md border border-green-500/40 bg-green-500/10 p-2.5 text-xs">
              <p className="font-medium text-green-700 dark:text-green-400">
                Queued {result.queued} item{result.queued === 1 ? "" : "s"}.
                Chunks + places are being added in the background.
              </p>
              {result.detected.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                  {result.detected.map((d, i) => (
                    <li key={i} className="truncate">
                      <span className="font-medium text-foreground">
                        {d.filename}
                      </span>{" "}
                      · detected as {d.kind}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
          <span className="text-[11px] text-muted-foreground">
            Places and context appear on the map + in the brain as they land.
          </span>
          <Button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            size="sm"
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" /> Adding…
              </>
            ) : (
              <>
                <Plus /> Add to trip
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
