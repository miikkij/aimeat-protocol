/**
 * @file build-app-layers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The build specification in two layers: what every app needs, and the parts only
 *   some apps need, each fetched when the app calls for it.
 *
 *   WHY. The full specification is about 95 000 characters. GET /v1/prompts/build-app serves all of
 *   it and keeps doing so, unchanged. An AI connected over MCP could not read it at all: the
 *   handbook tool answered "Prompt not found" for `build-app` (measured 2026-09-18, in every one of
 *   six cold-agent build runs), and 95 000 characters is more than one tool result carries in
 *   several clients. A third of the text covers cases most apps do not have: a group application,
 *   a shop's legal pages, multiplayer rooms, anonymous intake.
 *
 *   WHY IN PARTS. The first version served the whole core, 66 000 characters, as one tool result.
 *   The first cold-agent run on it (Opus, 2026-09-18) never saw it: the Claude client keeps a tool
 *   result of that size out of the conversation, writes it to a file and hands the model a 2 kB
 *   preview, and a chat has nothing to read a file with. The agent then fetched ten sections one
 *   at a time, 38 calls where 13 had done. Results of 18 000 characters arrived whole in the same
 *   run, so the core is served in four parts, each held under MAX_PART_CHARS by the unit test.
 *
 *   HOW. The finished prompt text is CUT at its own headings, never rewritten, so a section read
 *   on its own is byte for byte what the full specification says and carries the same spec token.
 *   Putting the sections back in order gives the full text again; the unit test holds that.
 *   Every heading is classified below. A heading this table does not know is served in the core,
 *   so nothing can go missing, and the unit test fails until somebody decides where it belongs.
 * @structure
 *   - SECTION_TABLE — heading → id, layer; the part of a core section; when to read an on-demand one
 *   - SPEC_PARTS, MAX_PART_CHARS — the four parts of the core and the size each stays under
 *   - splitBuildAppSpec() — cut the finished prompt at its headings
 *   - layeredBuildAppPrompt() — the whole core in one piece, for a reader over HTTP
 *   - buildAppPiece() — one part or one section by id, which is what the MCP door serves
 * @usage
 *   import { buildAppPiece } from './build-app-layers.js';
 *   const first = buildAppPiece(buildAppPrompt(config).full, 'start', config.baseUrl);
 * @version-history
 *   2026-09-19 — Part `start` opens by saying this is the CLASSIC specification and that a new app
 *     is built on Atelier. Nothing in it said another track existed.
 *   v1.1.0 — 2026-09-19 — The decision model's section is on demand (TARGET-080).
 *   v1.0.0 — 2026-09-18 — Initial creation.
 */

export type SpecLayer = 'core' | 'on-demand';
export type SpecPartId = 'start' | 'libraries' | 'data' | 'look';

/**
 * A tool result longer than this may not reach the model. Measured, not read from a document:
 * 18 071 characters arrived whole in the Claude client and 66 174 did not. The margin is on purpose.
 */
export const MAX_PART_CHARS = 24_000;

/** The core in reading order. `what` is the line the index shows for the part. */
export const SPEC_PARTS: Array<{ id: SpecPartId; what: string }> = [
  { id: 'start', what: 'How to go about it, the shape of the app, signing in, calling the node, language, permissions, the rules, and how to publish.' },
  { id: 'libraries', what: 'Every script and style address an app may load, and what each library is for. An address that is not in it does not exist.' },
  { id: 'data', what: 'Where the app keeps its data and in what shape, the data map every app writes, and the one call that says an AI made it.' },
  { id: 'look', what: 'Design, mobile safety and input, and how to check what the app looks like before you call it done.' },
];

export interface SpecSection {
  id: string;
  /** The heading without its `#` marks; `''` for the text before the first heading. */
  title: string;
  /** The section exactly as the full specification carries it, heading line included. */
  text: string;
  layer: SpecLayer;
  /** Core sections only: which of the four parts carries it. */
  part?: SpecPartId;
  /** On-demand sections only: the situation in which a builder reads this one. */
  when?: string;
}

interface SectionRule { id: string; layer: SpecLayer; part?: SpecPartId; when?: string }

/**
 * Every heading of the specification, in both modes. Keyed by the heading text, because that is
 * what a person editing build-app-prompt.ts sees and changes.
 */
export const SECTION_TABLE: Record<string, SectionRule> = {
  '': { id: 'opening', layer: 'core', part: 'start' },
  'Step 0 — Research first (agents with AIMEAT MCP tools)': { id: 'research', layer: 'core', part: 'start' },
  'Step 1 — Interview me first': { id: 'interview', layer: 'core', part: 'start' },
  'Step 2 — Build it (once I have answered)': { id: 'build', layer: 'core', part: 'start' },
  'AIMEAT Platform Instructions': { id: 'build', layer: 'core', part: 'start' },
  "Choose the app's shape (T1/T2/T3)": { id: 'shape', layer: 'core', part: 'start' },
  'Auth Pattern': { id: 'auth', layer: 'core', part: 'start' },
  'Calling the node: read `ok` before `data`': { id: 'calling-the-node', layer: 'core', part: 'start' },
  'Language: declare it, never build the switch': { id: 'language', layer: 'core', part: 'start' },
  'App permissions (scopes)': { id: 'scopes', layer: 'core', part: 'start' },
  'Data Storage': { id: 'data-storage', layer: 'core', part: 'data' },
  'Write the data map — the next AI to open this app has nothing else': { id: 'data-map', layer: 'core', part: 'data' },
  'Say that the AI made it (one call, and the app is compliant)': { id: 'ai-disclosure', layer: 'core', part: 'data' },
  'Design Guidelines': { id: 'design', layer: 'core', part: 'look' },
  'Surfaces — which base is which': { id: 'surfaces', layer: 'core', part: 'look' },
  'Visual design — components are not a design': { id: 'visual-design', layer: 'core', part: 'look' },
  'Mobile safety checklist (do these — they prevent the #1 phone bug)': { id: 'mobile-safety', layer: 'core', part: 'look' },
  'Mobile input — make a control answer a finger, a mouse and a keyboard': { id: 'mobile-input', layer: 'core', part: 'look' },
  "The node's bottom chrome strip — lift your bottom UI clear of it": { id: 'bottom-strip', layer: 'core', part: 'look' },
  'Verify what it LOOKS like, not just that it works': { id: 'verify-look', layer: 'core', part: 'look' },
  'Before you call it done: measure it, do not glance at it': { id: 'measure', layer: 'core', part: 'look' },
  'Important Rules': { id: 'rules', layer: 'core', part: 'start' },
  'If you are an agentic coder with AIMEAT MCP tools': { id: 'agentic-coder', layer: 'core', part: 'start' },
  'When the app is ready — tell me how to publish it': { id: 'publish', layer: 'core', part: 'start' },

  // Core although it is the longest section: it is the list of script addresses an app may load,
  // and the styling pack every design starts from is in it. An app built without it invents URLs.
  'Available Client Libraries': { id: 'libraries', layer: 'core', part: 'libraries' },

  'If several people share it: a GROUP application': {
    id: 'group', layer: 'on-demand',
    when: 'Several people use the same data: a team, a club, a class, members with roles.',
  },
  'An event log or audit trail the app keeps on a group: organism row spaces': {
    id: 'row-spaces', layer: 'on-demand',
    when: 'The app keeps a growing log, an audit trail or measurements for a group.',
  },
  'Reading data your AGENTS produced (not your own keys)': {
    id: 'agent-data', layer: 'on-demand',
    when: "The app shows data that the person's AI agents wrote. A plain list returns nothing for it.",
  },
  'Collecting input from anonymous visitors (Public Intake)': {
    id: 'public-intake', layer: 'on-demand',
    when: 'People who are not signed in send something in: a form, a vote, feedback, a booking.',
  },
  'Images & files (cross-user display)': {
    id: 'files', layer: 'on-demand',
    when: 'The app uploads images or files, or shows them to other people.',
  },
  "AI work in the person's own chat: the prompt-driven workflow (aimeat-prompt.js)": {
    id: 'prompt-driven', layer: 'on-demand',
    when: "The app needs AI work done and should cost nothing to run, or the person's AI cannot connect to this node: they run a prompt in their own chat and paste the answer back.",
  },
  'AI (prompt-driven)': {
    id: 'ai', layer: 'on-demand',
    when: 'The app itself calls a language model while it runs.',
  },
  'Decisions without text: the decision model (aimeat-decide.js)': {
    id: 'decide', layer: 'on-demand',
    when: 'The app classifies, screens, routes, scores or gates something (which folder, is it urgent, which candidate) rather than writing text, and the owner can use the decision model.',
  },
  'Tell the person when something happened (one call)': {
    id: 'notify', layer: 'on-demand',
    when: 'The app finishes something the person waits for and should tell them.',
  },
  'If the app sells something, or handles personal data — its own legal pages': {
    id: 'legal', layer: 'on-demand',
    when: "The app sells something or handles other people's personal data.",
  },
  "Spending the user's money (AI calls and agent commissions)": {
    id: 'spending', layer: 'on-demand',
    when: 'A control in the app starts a model call or commissions an agent: both spend the signed-in person\'s own money.',
  },
  'Real-time / multiplayer (optional)': {
    id: 'realtime', layer: 'on-demand',
    when: 'People see each other live: presence, a shared board, a two-player game.',
  },
  'Live updates without a firehose (aimeat-live.js)': {
    id: 'live-updates', layer: 'on-demand',
    when: 'The screen refreshes on its own when data changes on the node.',
  },
  'Agent face (markdown read-surface for agents)': {
    id: 'agent-face', layer: 'on-demand',
    when: 'Other AI agents should be able to read or operate the published app.',
  },
  'Game / playful look — form language, not just palette': {
    id: 'game-look', layer: 'on-demand',
    when: 'The app is a game or should look playful.',
  },
  'Library packs in the app you are improving': {
    id: 'library-packs-improve', layer: 'on-demand',
    when: 'You are improving an existing app that may already load library packs.',
  },
};

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'section';
}

/** Cut the finished prompt at its `##` and `###` headings. A heading inside a code fence is code. */
export function splitBuildAppSpec(full: string): SpecSection[] {
  const sections: SpecSection[] = [];
  let title = '';
  let lines: string[] = [];
  let inFence = false;
  const close = () => {
    if (!lines.length) return;
    const rule: SectionRule = SECTION_TABLE[title] ?? { id: slug(title), layer: 'core', part: 'start' };
    sections.push({
      id: rule.id, title, text: lines.join('\n'), layer: rule.layer,
      ...(rule.layer === 'core' ? { part: rule.part ?? 'start' } : {}),
      ...(rule.when ? { when: rule.when } : {}),
    });
  };
  for (const line of full.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const heading = !inFence && /^#{2,3} /.test(line);
    if (heading) {
      close();
      title = line.replace(/^#{2,3} /, '');
      lines = [];
    }
    lines.push(line);
  }
  close();
  return sections;
}

export interface SectionPointer { id: string; title: string; when: string; chars: number; url: string }

/**
 * How a builder reads the rest, for both doors. `paged` is the index of part `start`, which also
 * has to name the three parts that follow it; the whole core in one piece names only the sections
 * it left out.
 */
function sectionIndex(pointers: SectionPointer[], nodeUrl: string, paged: boolean): string {
  const how = 'Over MCP: `aimeat_handbook_get { tier: "build-app/<id>" }`. Over HTTP: `GET ' + nodeUrl + '/v1/prompts/build-app/sections/<id>?format=txt`. '
    + 'The whole specification in one piece: `GET ' + nodeUrl + '/v1/prompts/build-app?format=txt`.\n';
  let out = '';
  if (paged) {
    out += '### This specification comes in parts\n';
    out += 'You are reading part `start`. Every app needs the three parts after it as well, so read them before you write code, in this order. ' + how;
    for (const p of SPEC_PARTS.filter(x => x.id !== 'start')) out += '- `' + p.id + '` — ' + p.what + '\n';
    out += '\nThen the sections below, each of which covers one situation. They belong to the same specification and carry the same authority: read the ones this app is in BEFORE you write that part of it, and leave the others.\n';
  } else {
    out += '### More of this specification, read when the app needs it\n';
    out += 'What you are reading is the part every app needs. The sections below belong to the same specification and carry the same authority; each covers one situation, so read the ones this app is in BEFORE you write that part of it, and leave the others. ' + how;
  }
  for (const p of pointers) out += '- `' + p.id + '` — ' + p.when + '\n';
  return out;
}

function pointersOf(all: SpecSection[], nodeUrl: string): SectionPointer[] {
  return all.filter(s => s.layer === 'on-demand').map(s => ({
    id: s.id,
    title: s.title,
    when: s.when ?? s.title,
    chars: s.text.length,
    url: nodeUrl + '/v1/prompts/build-app/sections/' + s.id,
  }));
}

/**
 * The given core sections in order, with the index after the shape decision: that is where a
 * builder works out what kind of app this is, and so which situations it is in. Without a shape
 * section the index comes last. Joined the way the full text joins its sections.
 */
function withIndex(sections: SpecSection[], index: string): string {
  const out: string[] = [];
  let indexed = !index;
  for (const s of sections) {
    out.push(s.text);
    if (!indexed && s.id === 'shape') { out.push(index); indexed = true; }
  }
  if (!indexed) out.push(index);
  return out.join('\n');
}

/**
 * The whole core in one piece, with an index of the sections it leaves out. For a reader over
 * HTTP, where size is no obstacle. `sections` names what it left out.
 */
export function layeredBuildAppPrompt(full: string, baseUrl: string): { prompt: string; sections: SectionPointer[] } {
  const nodeUrl = baseUrl.replace(/\/+$/, '');
  const all = splitBuildAppSpec(full);
  const pointers = pointersOf(all, nodeUrl);
  const index = pointers.length ? sectionIndex(pointers, nodeUrl, false) : '';
  return { prompt: withIndex(all.filter(s => s.layer === 'core'), index), sections: pointers };
}

/**
 * What a builder who opened the Classic specification first is told before anything else. Added to
 * part `start` only, which is the door a chat uses: the whole-document prompt a person copies from
 * the app catalogue is chosen by that person, on a screen that offers both tracks. Until
 * 2026-09-19 nothing in this specification said another track existed.
 */
export const CLASSIC_TRACK_NOTICE = '### Which track this is\n'
  + 'This is the CLASSIC build specification. A NEW app is built on the Atelier track instead: forked from a genre, with the served component kit carrying the header, the sign-in and the loading, empty and error states. Its specification is `aimeat_handbook_get { tier: "build-app-atelier" }`, and its skill is `node:aimeat-app-builder-atelier`. '
  + 'Read on here only if you are improving an app that is already Classic, or the owner asked for the Classic track by name. If you began on Atelier, stay on it: the two guides do not describe each other, and changing over in the middle means starting again.\n\n';

export interface SpecPiece { id: string; kind: 'part' | 'section'; text: string }

/**
 * One piece by id: a part of the core (`start`, `libraries`, `data`, `look`) or a single section.
 * A part wins when both carry the id, and `libraries` is both, with the same text. Null when the
 * specification has neither.
 */
export function buildAppPiece(full: string, id: string, baseUrl: string): SpecPiece | null {
  const nodeUrl = baseUrl.replace(/\/+$/, '');
  const all = splitBuildAppSpec(full);
  if (SPEC_PARTS.some(p => p.id === id)) {
    const mine = all.filter(s => s.part === id);
    if (!mine.length) return null;
    const pointers = pointersOf(all, nodeUrl);
    const text = id === 'start' ? CLASSIC_TRACK_NOTICE + withIndex(mine, sectionIndex(pointers, nodeUrl, true)) : mine.map(s => s.text).join('\n');
    return { id, kind: 'part', text };
  }
  const section = all.find(s => s.id === id);
  return section ? { id, kind: 'section', text: section.text } : null;
}

/** Every id buildAppPiece answers to, parts first, for an error that has to name them. */
export function buildAppPieceIds(full: string): string[] {
  const sections = splitBuildAppSpec(full).map(s => s.id);
  return [...new Set([...SPEC_PARTS.map(p => p.id as string), ...sections])];
}
