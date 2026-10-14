/**
 * @file src/services/home-ideas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ideas the home offers a person who does not yet know what to ask for: agents
 *   made from one sentence, and apps paired with the agent that works through them. One list, read
 *   by the new-agent page, by the home's "Make an agent" and "Make an app" tasks, by an agent's
 *   "Make an app of its work", and by a connected AI (aimeat_handbook_get { tier: "home-ideas" }).
 *
 *   WHERE IT LIVES. The managed prompt `home-ideas` (services/prompt-defaults/home-ideas.ts seeds
 *   it): a JSON document in `content` (English) and one per language in `locales`. The operator
 *   edits it on the Prompts page like any managed prompt, and after the first seed the seeder never
 *   writes over the operator's text. Ruled by Jouni on 2026-10-14: "Mistä lista luetaan? Suositus:
 *   solmulla on yksi tietue, jota ylläpitäjä voi muokata" → "suosituksen mukaan".
 *
 *   AN OPERATOR'S MISTAKE COSTS ONE ENTRY, NOT THE LIST. A document that is not JSON gives an empty
 *   list and says why; an entry that lacks a field the page needs is left out and named in
 *   `problems`, so the rest still shows and the operator reads what to fix.
 * @structure HOME_IDEAS_PROMPT_ID · IDEA_WHEN · AgentIdea · AppIdea · IdeaGroup · HomeIdeas ·
 *   parseHomeIdeas(text) · readHomeIdeas(storage, lang)
 * @usage const { ideas, problems } = await readHomeIdeas(storage, 'fi');
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (wish-esimerkit-agenteista-ja-sovelluksista-kotiruudulle-mielikuvi).
 */
import type { Storage } from '../storage/interface.js';
import { resolvePromptContent } from './prompt-variables.js';

/** The managed prompt that holds the list. */
export const HOME_IDEAS_PROMPT_ID = 'home-ideas';

/** When an agent idea works: the new-agent page's answers to "When it works". */
export const IDEA_WHEN = ['ask', 'clock', 'talk', 'records'] as const;
export type IdeaWhen = typeof IDEA_WHEN[number];

/** One group the agent ideas are filed under. */
export interface IdeaGroup { id: string; name: string }

/** An agent made from one sentence. `say` is the sentence the person starts from. */
export interface AgentIdea {
  id: string;
  group: string;
  name: string;
  /** What the person gets, in one or two sentences. */
  gets: string;
  say: string;
  when: IdeaWhen;
  /** The app the agent works through, as the person knows it, or null. */
  app: string | null;
}

/** An app and the agent that works through it, in both directions. */
export interface AppIdea {
  id: string;
  name: string;
  /** The app on this node that does it, as the person knows it; null for an idea not built yet. */
  ready_app: string | null;
  /** The id of the agent idea that goes with it, or null. */
  agent: string | null;
  /** What the person does. */
  you: string;
  /** What the agent does with the app's tools. */
  agent_uses: string;
  /** What the app shows of the agent's work. */
  app_shows: string;
}

export interface HomeIdeas {
  /** Written to an AI that reads the list: how to use it. */
  about: string;
  groups: IdeaGroup[];
  agents: AgentIdea[];
  apps: AppIdea[];
}

const EMPTY: HomeIdeas = { about: '', groups: [], agents: [], apps: [] };
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const textOrNull = (v: unknown): string | null => (isText(v) ? v.trim() : null);
const listOf = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)) : []);

/** The fields an entry lacks, by name. */
function missing(entry: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields.filter((f) => !isText(entry[f]));
}

/**
 * The list from the prompt's text. Never throws: what cannot be used is left out and said in
 * `problems`, in words an operator acts on.
 */
export function parseHomeIdeas(text: string): { ideas: HomeIdeas; problems: string[] } {
  let doc: unknown;
  try { doc = JSON.parse(text); }
  catch (err) {
    return { ideas: EMPTY, problems: [`The home-ideas prompt is not JSON (${(err as Error).message}). Correct it on the Prompts page.`] };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ideas: EMPTY, problems: ['The home-ideas prompt is not a JSON object with groups, agents and apps.'] };
  }
  const d = doc as Record<string, unknown>;
  const problems: string[] = [];

  const groups: IdeaGroup[] = [];
  for (const g of listOf(d.groups)) {
    const lacks = missing(g, ['id', 'name']);
    if (lacks.length) { problems.push(`A group lacks ${lacks.join(', ')}.`); continue; }
    groups.push({ id: String(g.id).trim(), name: String(g.name).trim() });
  }

  const agents: AgentIdea[] = [];
  for (const a of listOf(d.agents)) {
    const lacks = missing(a, ['id', 'group', 'name', 'gets', 'say', 'when']);
    if (lacks.length) { problems.push(`Agent idea ${isText(a.id) ? `"${a.id}"` : '(no id)'} lacks ${lacks.join(', ')}.`); continue; }
    const when = String(a.when).trim() as IdeaWhen;
    if (!IDEA_WHEN.includes(when)) { problems.push(`Agent idea "${a.id}": when is "${when}"; use one of ${IDEA_WHEN.join(', ')}.`); continue; }
    if (agents.some((x) => x.id === String(a.id).trim())) { problems.push(`Agent idea "${a.id}" appears twice; the second is left out.`); continue; }
    agents.push({
      id: String(a.id).trim(), group: String(a.group).trim(), name: String(a.name).trim(), gets: String(a.gets).trim(),
      say: String(a.say).trim(), when, app: textOrNull(a.app),
    });
  }

  const apps: AppIdea[] = [];
  for (const p of listOf(d.apps)) {
    const lacks = missing(p, ['id', 'name', 'you', 'agent_uses', 'app_shows']);
    if (lacks.length) { problems.push(`App idea ${isText(p.id) ? `"${p.id}"` : '(no id)'} lacks ${lacks.join(', ')}.`); continue; }
    const agent = textOrNull(p.agent);
    if (agent && !agents.some((a) => a.id === agent)) problems.push(`App idea "${p.id}" names the agent idea "${agent}", which the list does not have.`);
    apps.push({
      id: String(p.id).trim(), name: String(p.name).trim(), ready_app: textOrNull(p.ready_app),
      agent: agent && agents.some((a) => a.id === agent) ? agent : null,
      you: String(p.you).trim(), agent_uses: String(p.agent_uses).trim(), app_shows: String(p.app_shows).trim(),
    });
  }

  return { ideas: { about: isText(d.about) ? d.about.trim() : '', groups, agents, apps }, problems };
}

/**
 * The list in a language, from the managed prompt: the language's own text when the operator or
 * the seed gave one, English otherwise. An inactive or missing prompt is an empty list.
 */
export async function readHomeIdeas(storage: Storage, lang: string): Promise<{ ideas: HomeIdeas; problems: string[]; lang: string }> {
  const record = await storage.getSystemPrompt(HOME_IDEAS_PROMPT_ID);
  if (!record || !record.active) return { ideas: EMPTY, problems: [], lang: 'en' };
  // A bare tag ("fi") or an Accept-Language header ("fi-FI,fi;q=0.9,en;q=0.8"): its first language.
  const wanted = (lang || 'en').split(',')[0].split(';')[0].trim().toLowerCase().split(/[-_]/)[0] || 'en';
  const text = resolvePromptContent(record, wanted);
  const served = text === record.content ? 'en' : wanted;
  return { ...parseHomeIdeas(text), lang: served };
}
