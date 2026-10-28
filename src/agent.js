// Turn a character bible into a voice agent: the same persona, canon and record as the bible,
// with a prompt written for speaking aloud, and the production voice from voice/voice.json.
//
// Optional voice/agent.json in the dressing room tunes the agent and remembers where it lives:
//   { "firstMessage": "...", "llm": "claude-sonnet-5-5", "temperature": 0.7, "language": "en",
//     "elevenlabs": { "agentId": "agent_..." } }
//
// `character-bible agent <dir>` prints the agent as JSON. With ELEVENLABS_API_KEY set,
// `--create` makes it in ElevenLabs and `--update` pushes a rebuilt prompt to it.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load, model, renderSystemPrompt } from "./bible.js";

export const DEFAULT_AGENT_LLM = "claude-sonnet-5-5";

function repoUrl(dir) {
  try {
    const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const m = url.match(/github\.com[:/](.+?)(\.git)?$/);
    return m ? `https://github.com/${m[1]}` : null;
  } catch {
    return null;
  }
}

/** The spoken-conversation section of an agent prompt. */
export function voiceConversation(name, repo) {
  return [
    `You are on a live voice call with a listener, outside the writers' room. Everything you say is spoken aloud.`,
    `- Talk in plain spoken sentences, two to four at a time, then let them answer. No lists, headings, markdown, emoji or stage directions; say what you would say.`,
    `- Stay in character as ${name}. Your job above is how you think; in this call you are talking, not filing work.`,
    `- The canon above is what is true. If they ask about something it doesn't cover, say it hasn't happened yet, or that you don't know, rather than inventing history.`,
    `- Nothing said on this call becomes canon. If they want something to be true about you from now on, tell them they can propose it as a viewer note${repo ? ` on your dressing room, ${repo.replace(/^https:\/\//, "")}` : " in your dressing room"}, and the producer decides.`,
    `- If they want to pitch an idea for the show, tell them the writers' room is open at writers dot story dot markets.`,
    `- Spell out numbers and money the way you'd say them.`,
  ].join("\n");
}

/** Render the voice agent for a dressing room (or an extra's folder). Pure apart from reading the repo. */
export function renderAgent(dir) {
  const input = load(dir);
  const m = model(input);
  const cfg = input.agent ?? {};
  const repo = repoUrl(dir);
  const voiceId = input.voice?.provider === "elevenlabs" ? input.voice.id ?? null : null;
  return {
    character: m.character,
    name: `${m.name} — Future Radio`,
    voiceId,
    voiceName: input.voice?.name ?? input.voice?.voice ?? null,
    firstMessage: cfg.firstMessage ?? `${m.name} here. What would you like to talk about?`,
    language: cfg.language ?? "en",
    llm: cfg.llm ?? DEFAULT_AGENT_LLM,
    temperature: cfg.temperature ?? 0.7,
    tags: ["Future Radio", "character", m.character],
    prompt: renderSystemPrompt(m, input.showBible, { conversation: voiceConversation(m.name, repo) }),
    bibleInputs: m.inputsHash,
    agentId: cfg.elevenlabs?.agentId ?? null,
  };
}

/** Remember the ElevenLabs agent id in voice/agent.json. */
export function saveAgentId(dir, agentId) {
  const path = join(dir, "voice/agent.json");
  const cfg = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  cfg.elevenlabs = { ...(cfg.elevenlabs ?? {}), agentId };
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
}

const API = "https://api.elevenlabs.io/v1/convai/agents";

/** The ElevenLabs agent body for an agent from renderAgent. */
export function elevenLabsBody(a) {
  if (!a.voiceId) throw new Error(`${a.name} has no ElevenLabs voice in voice/voice.json ("provider": "elevenlabs", "id": "<voice id>").`);
  return {
    name: a.name,
    tags: a.tags,
    conversation_config: {
      agent: { first_message: a.firstMessage, language: a.language, prompt: { prompt: a.prompt, llm: a.llm, temperature: a.temperature } },
      tts: { voice_id: a.voiceId },
    },
  };
}

/** Create the agent in ElevenLabs, or update it if voice/agent.json already names one. */
export async function publishAgent(dir, { apiKey = process.env.ELEVENLABS_API_KEY, fetchImpl = globalThis.fetch, create = false } = {}) {
  if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY to create or update agents.");
  const a = renderAgent(dir);
  const body = elevenLabsBody(a);
  const headers = { "xi-api-key": apiKey, "content-type": "application/json" };
  if (a.agentId && !create) {
    const res = await fetchImpl(`${API}/${a.agentId}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    return { agentId: a.agentId, created: false };
  }
  const res = await fetchImpl(`${API}/create`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const { agent_id } = await res.json();
  saveAgentId(dir, agent_id);
  return { agentId: agent_id, created: true };
}
