import { NextResponse } from "next/server";

import { callLlm, getZaiClient, getZaiModel } from "@/lib/llm";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { googlePlacesTextSearch } from "@/lib/places";

export const runtime = "nodejs";

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
  tookMs: number;
};

async function timed<T>(fn: () => Promise<T>): Promise<{ result?: T; error?: string; tookMs: number }> {
  const t0 = Date.now();
  try {
    const result = await fn();
    return { result, tookMs: Date.now() - t0 };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), tookMs: Date.now() - t0 };
  }
}

export async function GET() {
  const checks: Check[] = [];

  // 1. Supabase — can we read trips?
  {
    const r = await timed(async () => {
      const supabase = getSupabaseServerClient();
      const { error } = await supabase.from("trips").select("id").limit(1);
      if (error) throw new Error(error.message);
      return true;
    });
    checks.push({
      name: "supabase.read",
      ok: !r.error,
      detail: r.error ?? "ok",
      tookMs: r.tookMs,
    });
  }

  // 2. Supabase storage — can we list the trip-uploads bucket?
  {
    const r = await timed(async () => {
      const supabase = getSupabaseServerClient();
      const { error } = await supabase.storage.from("trip-uploads").list("", { limit: 1 });
      if (error) throw new Error(error.message);
      return true;
    });
    checks.push({
      name: "supabase.storage.trip-uploads",
      ok: !r.error,
      detail: r.error ?? "ok",
      tookMs: r.tookMs,
    });
  }

  // 3. Z.ai — simple chat completion
  {
    const r = await timed(async () => {
      const res = await callLlm({
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        maxTokens: 20,
      });
      if (!res.content.trim()) throw new Error("empty response");
      return res.content.trim().slice(0, 80);
    });
    checks.push({
      name: `zai.chat (${safeModel()})`,
      ok: !r.error,
      detail: r.error ?? r.result ?? "ok",
      tookMs: r.tookMs,
    });
  }

  // 4. Z.ai — tool calling smoke test
  {
    const r = await timed(async () => {
      const client = getZaiClient();
      const res = await client.chat.completions.create({
        model: safeModel() ?? "GLM-5.1",
        messages: [{ role: "user", content: "Use the ping tool." }],
        tools: [
          {
            type: "function",
            function: {
              name: "ping",
              description: "Always call this.",
              parameters: { type: "object", properties: {}, additionalProperties: false },
            },
          },
        ],
        // @ts-expect-error Z.ai-specific
        thinking: { type: "disabled" },
      });
      const tc = res.choices[0].message.tool_calls?.[0];
      if (!tc) throw new Error("no tool call returned");
      const name = tc.type === "function" ? tc.function.name : tc.type;
      return `called ${name}`;
    });
    checks.push({
      name: "zai.tools",
      ok: !r.error,
      detail: r.error ?? r.result ?? "ok",
      tookMs: r.tookMs,
    });
  }

  // 5. Google Places (New)
  {
    const r = await timed(async () => {
      const results = await googlePlacesTextSearch("Shibuya", "Tokyo, Japan");
      if (results.length === 0) throw new Error("zero results — API key or API enablement?");
      return `${results.length} results; top=${results[0].name}`;
    });
    checks.push({
      name: "google.places",
      ok: !r.error,
      detail: r.error ?? r.result ?? "ok",
      tookMs: r.tookMs,
    });
  }

  const allOk = checks.every((c) => c.ok);
  return NextResponse.json(
    { ok: allOk, checks, summary: `${checks.filter((c) => c.ok).length}/${checks.length} services healthy` },
    { status: allOk ? 200 : 503 }
  );
}

function safeModel(): string | null {
  try {
    return getZaiModel();
  } catch {
    return null;
  }
}
