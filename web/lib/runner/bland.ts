// TypeScript port of the Bland transport + tier calls from eval.py.
// The comments carried over are load-bearing — they document API behavior
// that cost debugging time to learn. Keep them in sync with eval.py.

import { Exchange } from "../types";

export const BLAND_API = "https://api.bland.ai/v1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST JSON with retry on transient failures (429/5xx/timeouts). */
export async function post(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = 120_000,
  retries = 4
): Promise<any> {
  let last = "";
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // A real UA matters: Cloudflare 403s bare HTTP-client defaults.
          "user-agent": "qa-eval/1.0",
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res.json();
      const text = (await res.text()).slice(0, 300);
      last = `HTTP ${res.status}: ${text}`;
      if (![429, 500, 502, 503, 504].includes(res.status)) {
        throw new Error(last);
      }
    } catch (e: any) {
      if (e instanceof Error && e.message.startsWith("HTTP")) throw e;
      last = `${e?.name ?? "Error"}: ${e?.message ?? e}`;
    }
    // Bland sits behind Cloudflare, which returns 429 "error code: 1015" under
    // concurrency. Back off hard -- 1015 is a rate gate, not a transient blip.
    await sleep(3 * 2 ** attempt * 1000);
  }
  throw new Error(`failed after ${retries} attempts -- ${last}`);
}

/** Current local time as 'Wed, Jul 22, 2026, 2:28 PM' -- no zero-padding on the
 * day or hour, which is how a person says a date and how the node prompt reads it. */
export function nowString(): string {
  const d = new Date();
  const date = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date}, ${time}`;
}

// --- tier 1: knowledge base --------------------------------------------------

export async function kbChat(
  kbId: string,
  question: string,
  apiKey: string
): Promise<string> {
  const d = await post(
    `${BLAND_API}/knowledge/chat`,
    { knowledge_base_id: kbId, messages: [{ role: "user", content: question }] },
    { authorization: apiKey }
  );
  return ((d?.data?.result as string) ?? "").trim();
}

// --- tier 2: pathway chat ----------------------------------------------------

export async function pathwayRun(
  pathwayId: string,
  turns: string[],
  apiKey: string
): Promise<{ chatId: string; exchanges: Exchange[] }> {
  // Prime the greeting, then send the real turns.
  //
  // Turn 1 is ALWAYS consumed by the pathway's Greeting node -- it replies with
  // the scripted greeting regardless of what you send. So we burn one turn on
  // "hello" and grade only what comes after. A harness that skips this grades
  // the greeting and fails every case.
  //
  // {{now}} must be supplied or the node's payment-date arithmetic has no anchor.
  // On a real call Bland injects {{now}} itself; the chat API does not, so we
  // pass it. The parameter is `request_data`, NOT `variables`. A `variables`
  // payload is silently ignored here -- accepted without error, never bound, no
  // warning. That silence is what made this look like a broken agent rather
  // than a missing input, so don't "simplify" this key.
  const created = await post(
    `${BLAND_API}/pathway/chat/create`,
    { pathway_id: pathwayId, request_data: { now: nowString() } },
    { authorization: apiKey }
  );
  const chatId = created.data.chat_id as string;

  await post(
    `${BLAND_API}/pathway/chat/${chatId}`,
    { message: "hello" },
    { authorization: apiKey }
  );

  const exchanges: Exchange[] = [];
  for (const turn of turns) {
    // NOTE: the send route is /pathway/chat/{chat_id}, NOT /pathway/chat.
    // Posting to the bare path returns "Error checking pathway ownership",
    // which reads like an auth failure but is really a wrong-route error.
    const d = (
      await post(
        `${BLAND_API}/pathway/chat/${chatId}`,
        { message: turn },
        { authorization: apiKey }
      )
    ).data;
    exchanges.push({
      user: turn,
      assistant: ((d.assistant_responses as string[]) ?? []).join(" ").trim(),
      node: d.current_node_name ?? null,
    });
  }
  return { chatId, exchanges };
}
