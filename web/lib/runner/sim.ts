// Multi-turn conversation driver with an LLM caller-simulator.
//
// A single-turn variant only sends the caller's opening line, which a multi-turn
// troubleshooting agent answers with a clarifying question — so it never gets to
// deliver its steps and looks broken. This drives a real conversation: an LLM
// role-plays the caller, answering the agent's questions until the agent resolves
// or escalates (or a turn cap is hit), and the full transcript is graded.
//
// The simulator is deliberately NOT given the KB's expected steps — a real caller
// does not know the fix — so it cannot coach the agent into passing.

import { Exchange } from "../types";
import { openPathwayChat, post, sendPathwayTurn } from "./bland";
import { TestCase } from "./judge";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

/** OpenRouter spend for the caller-simulator on one variant, summed across its
 * turns. Folded into the run's grading cost by the caller. */
export interface SimUsage {
  cost: number;
  prompt_tokens: number;
  completion_tokens: number;
}

// The call is wrapping up when the agent's NODE or its wording signals closure
// or a handoff. Driving off the AGENT (not a caller-emitted token) keeps a flaky
// simulator from ending the conversation before the agent has done its job.
const ENDING_NODE = /resolv|route|transfer|escalat|ticket|goodbye|wrap|end call|hand ?off/i;
const ENDING_TEXT =
  /\b(?:raise|create|open|log|put in|submit)(?: a| an)? (?:support )?ticket|transfer(?:ring)? you|connect(?:ing)? you (?:to|with)|stay on the line|reach out to (?:our )?IT|our IT team will|is (?:now )?resolved|you'?re (?:all set|good to go)|glad (?:that|it) (?:worked|fixed)|that should (?:fix|resolve|do it|sort|take care)|is there anything else|anything else (?:I can help|you need)/i;

const isEnding = (assistant: string, node: string | null | undefined): boolean =>
  (!!node && ENDING_NODE.test(node)) || ENDING_TEXT.test(assistant ?? "");

/** The caller-simulator prompt for the next turn, given the conversation so far.
 * Exported so the pre-run cost estimate can size it exactly as the runner sends
 * it, keeping the two from drifting. */
export function buildCallerPrompt(testCase: TestCase, exchanges: Exchange[]): string {
  const transcript = exchanges
    .map((e) => `${e.user ? `Caller: ${e.user}\n` : ""}Agent: ${e.assistant}`)
    .join("\n");
  return `You are role-playing a non-technical employee who called IT support. Your problem, in your own words: "${testCase.name}". You already opened with: "${exchanges[0].user}".

Rules for your reply:
- Speak as the caller, first person, 1-2 short sentences. Never speak or think for the agent.
- Answer ONLY what the agent actually asked in their last message. Do not volunteer steps you have supposedly already tried, and do not name folders, menus, settings, or fixes yourself — you are not technical and do not know them. Wait for the agent to walk you through each step.
- When the agent tells you to check or do something, do exactly that and report a realistic result: if their step would plausibly fix your specific problem, say it worked; otherwise say it didn't help, so they keep going.
- You are a standard user with NO admin rights. If asked to install/uninstall/reset software, edit the registry, enter safe mode, or anything admin-gated, say you're not able to do that.
- Keep cooperating for as long as the agent is still working the problem. If the agent has clearly finished — they confirmed it's resolved, or said they're raising an IT ticket or transferring you to a person — just thank them briefly.

Conversation so far:
${transcript}

Your next reply as the caller:`;
}

/** One caller turn from the simulator, given the conversation so far. Accumulates
 * its OpenRouter usage into `usage`. */
async function callerReply(
  testCase: TestCase,
  exchanges: Exchange[],
  openrouterKey: string,
  model: string,
  usage: SimUsage
): Promise<string> {
  const prompt = buildCallerPrompt(testCase, exchanges);
  const d = await post(
    OPENROUTER_API,
    {
      model,
      temperature: 0,
      reasoning: { enabled: false },
      max_tokens: 120,
      messages: [{ role: "user", content: prompt }],
      usage: { include: true },
    },
    { authorization: `Bearer ${openrouterKey}` }
  );
  const u = d?.usage ?? {};
  usage.cost += Number(u.cost ?? 0) || 0;
  usage.prompt_tokens += Number(u.prompt_tokens ?? 0) || 0;
  usage.completion_tokens += Number(u.completion_tokens ?? 0) || 0;
  return (d?.choices?.[0]?.message?.content ?? "").trim();
}

/** Drive a full conversation: opener, then up to `maxFollowups` simulator turns,
 * stopping early once the agent wraps up or hands off. Returns the transcript and
 * the simulator's OpenRouter spend. */
export async function pathwaySim(
  pathwayId: string,
  testCase: TestCase,
  opening: string,
  apiKey: string,
  openrouterKey: string,
  model: string,
  maxFollowups: number
): Promise<{ chatId: string; exchanges: Exchange[]; simUsage: SimUsage }> {
  const chatId = await openPathwayChat(pathwayId, apiKey);
  const simUsage: SimUsage = { cost: 0, prompt_tokens: 0, completion_tokens: 0 };
  const exchanges: Exchange[] = [await sendPathwayTurn(chatId, opening, apiKey)];

  for (let i = 0; i < maxFollowups; i++) {
    const last = exchanges[exchanges.length - 1];
    if (isEnding(last.assistant, last.node)) break;
    const reply = await callerReply(testCase, exchanges, openrouterKey, model, simUsage);
    if (!reply) break;
    exchanges.push(await sendPathwayTurn(chatId, reply, apiKey));
  }
  return { chatId, exchanges, simUsage };
}
