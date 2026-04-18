import "server-only";

import OpenAI from "openai";

/**
 * Z.ai LLM client (OpenAI-compatible).
 *
 * GLM-5.1 is a reasoning model: by default it burns completion tokens in its
 * hidden reasoning phase and returns empty content when max_tokens is tight.
 * We disable reasoning (`thinking: { type: "disabled" }`) for every call so
 * tokens go directly into the visible response. Re-enable per-call by passing
 * `reasoning: true` through the options.
 */

let zaiClient: OpenAI | undefined;

export function getZaiClient(): OpenAI {
  if (zaiClient) return zaiClient;
  const apiKey = process.env.ZAI_API_KEY;
  const baseURL = process.env.ZAI_BASE_URL;
  if (!apiKey || !baseURL) {
    throw new Error("Missing ZAI_API_KEY or ZAI_BASE_URL — check .env.local");
  }
  zaiClient = new OpenAI({ apiKey, baseURL });
  return zaiClient;
}

export function getZaiModel(): string {
  const model = process.env.ZAI_MODEL;
  if (!model) throw new Error("Missing ZAI_MODEL — check .env.local");
  return model;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface LlmCallOptions {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  model?: string;
  /** Opt in to GLM's hidden reasoning phase. Off by default. */
  reasoning?: boolean;
}

export interface LlmCallResult {
  content: string;
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  raw: OpenAI.Chat.Completions.ChatCompletion;
  usage?: OpenAI.Completions.CompletionUsage;
}

export async function callLlm(opts: LlmCallOptions): Promise<LlmCallResult> {
  const client = getZaiClient();
  const model = opts.model ?? getZaiModel();

  const completion = await client.chat.completions.create({
    model,
    messages: opts.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens,
    response_format: opts.jsonMode ? { type: "json_object" } : undefined,
    tools: opts.tools,
    tool_choice: opts.toolChoice,
    // Z.ai-specific: toggle GLM's reasoning phase. Passed through since the
    // OpenAI SDK forwards unknown body keys.
    // @ts-expect-error — not in OpenAI SDK types
    thinking: { type: opts.reasoning ? "enabled" : "disabled" },
  });

  const choice = completion.choices[0];
  return {
    content: choice.message.content ?? "",
    toolCalls: choice.message.tool_calls ?? [],
    raw: completion,
    usage: completion.usage,
  };
}

/**
 * Parse strict JSON from an LLM response. Retries once with a repair prompt
 * if the first attempt isn't valid JSON.
 */
export async function callLlmJson<T = unknown>(
  opts: LlmCallOptions
): Promise<T> {
  const first = await callLlm({ ...opts, jsonMode: true });
  try {
    return JSON.parse(first.content) as T;
  } catch {
    const repaired = await callLlm({
      ...opts,
      jsonMode: true,
      messages: [
        ...opts.messages,
        { role: "assistant", content: first.content },
        {
          role: "user",
          content:
            "Your previous response was invalid JSON. Return ONLY valid JSON matching the expected schema. No prose, no markdown, no code fences.",
        },
      ],
    });
    return JSON.parse(repaired.content) as T;
  }
}
