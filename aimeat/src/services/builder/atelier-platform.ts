/**
 * @file src/services/builder/atelier-platform.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier build specification's platform sections: what only some apps need (a
 *   team, files, AI, intake, payments, server-side work), each read on its own when the app needs
 *   it. Served as `build-app-atelier/platform` (the index) and `build-app-atelier/<section id>`.
 *
 *   WHY. Until 2026-11-19 these instructions existed only in the Classic specification, and the
 *   Atelier text said of data "in short" what Classic said in twenty sections. A builder on Atelier
 *   who needed a group app, anonymous intake or an outside key either went without or opened the
 *   Classic guide, which describes a different way of making a page. Atelier is now the one build
 *   guide (decision-atelier-is-the-only-app-build-guide-classic-and-t1-t2-t3-are, plan
 *   doc-mwnnroacarhc), and the platform knowledge comes with it.
 *
 *   HOW. The sections are CUT from the existing build text (builder/app-prompt.ts) by their ids, as
 *   build-app-layers.ts cuts them, and never rewritten: the text that worked stays the text that is
 *   served. Each is re-headed from `###` to `##`, because the Atelier text is cut at `## `. They are
 *   NOT part of the Atelier full text (GET /v1/prompts/build-app-atelier): the main text stays one
 *   argument about how a page is made, and a builder reads a platform section only when the app is
 *   in its situation. The one section written here is `server-side`: Classic taught server-side work
 *   as its tier T3, a rung on a ladder Atelier does not have.
 * @structure ATELIER_PLATFORM · SERVER_SIDE_SECTION · atelierPlatformPiece(id, baseUrl) ·
 *   atelierPlatformIds() · ATELIER_PLATFORM_PART_LINE
 * @usage const piece = atelierPlatformPiece('group', config.baseUrl);   // null for an unknown id
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
import { buildAppPrompt } from './app-prompt.js';
import { splitBuildAppSpec } from './app-layers.js';

/**
 * The platform sections in the order the index lists them. `from` is the section's id in the build
 * text (app-layers.ts SECTION_TABLE); `when` is the situation, in the builder's terms, in which it
 * is read. A section the build text no longer carries makes test/unit/build-atelier-platform.test.ts
 * fail, so nothing goes missing quietly.
 */
export const ATELIER_PLATFORM: Array<{ id: string; from?: string; when: string }> = [
  { id: 'calling-the-node', when: 'The app calls the node itself (`session.fetch`) for something the kit\'s blocks and `AIMEAT.data` do not cover. Every answer is read `ok` first.' },
  { id: 'scopes', when: 'The app needs more than reading and writing its own records: deleting keys, files, AI, organisms, agents or extensions.' },
  { id: 'data-storage', when: 'The app keeps more than one record per person: entries other people read, a shared feed, comments, a journal, a public profile.' },
  { id: 'data-map', when: 'Before you publish: how to write the data map, the record the next AI reads to find where this app keeps what.' },
  { id: 'group', when: 'Several people use the same data: a team, a club, a class, members with roles.' },
  { id: 'row-spaces', when: 'The app keeps a growing log, an audit trail or measurements for a group.' },
  { id: 'agent-data', when: "The app shows data that the person's AI agents wrote. A plain list returns nothing for it." },
  { id: 'outside-users', when: 'The app is for people who have no account on this node: the buyers of a shop, the members of a club, a market place.' },
  { id: 'public-intake', when: 'People who are not signed in send something in: a form, a vote, feedback, a booking.' },
  { id: 'files', when: 'The app uploads images or files, or shows them to other people.' },
  { id: 'server-side', when: 'The app calls another service with a key, needs a rule the browser cannot break (only the author deletes, one vote per person), or works on a schedule.' },
  { id: 'prompt-driven', when: "AI work done in the person's own chat: the app composes a prompt, they run it in any AI and paste the answer back. It costs the app nothing." },
  { id: 'ai', when: 'The app itself calls a language model while it runs, outside the `aide` block.' },
  { id: 'ai-disclosure', when: 'The app shows text, images, audio or video that a model made: the label it owes, in one call.' },
  { id: 'decide', when: 'The app classifies, screens, routes, scores or gates something rather than writing text, and the owner can use the decision model.' },
  { id: 'spending', when: 'A control starts a model call or commissions an agent: both spend the signed-in person\'s own money.' },
  { id: 'notify', when: 'The app finishes something the person waits for and should tell them.' },
  { id: 'legal', when: "The app sells something or handles other people's personal data." },
  { id: 'realtime', when: 'People see each other live: presence, a shared board, a two-player game.' },
  { id: 'agent-face', when: 'Other AI agents should be able to read or operate the published app.' },
  { id: 'install', when: 'The app is installed on a phone: the home-screen icon.' },
  { id: 'publish-by-hand', from: 'publish', when: 'You cannot publish over MCP: you hand the person one HTML file and tell them how to put it on the node.' },
];

/** The one line part `start` gives this index (atelier-layers.ts partsIndex). Keep it short: `start` is near MAX_PART_CHARS. */
export const ATELIER_PLATFORM_PART_LINE = '- `platform` — the sections only some apps need (a team, files, AI, intake, outside users, payments, server-side work), each with when to read it. Read the index, then the ones this app is in.\n';

/** Classic taught this as tier T3. Written for Atelier on 2026-11-19; the how lives in skill node:aimeat-extension-builder. */
export const SERVER_SIDE_SECTION = '## Server-side work: an extension, and when that is not enough\n'
  + 'A page runs in the person\'s browser, and three kinds of work cannot happen there. A call to another service with a key: the browser cannot keep a secret. '
  + 'A rule that must hold whatever the browser sends: only the author deletes an entry, one vote per person, a price nobody else changes. '
  + 'Work that runs while nobody has the page open: a fetch every morning, a reminder. Each of these is a server extension: a small sandboxed program the node runs, '
  + 'which keeps its own data in `ext:<name>`, calls outside services with `ctx.fetch`, and names a key in an outbound header as `{{secret:NAME}}`, which the node fills '
  + 'from the signed-in person\'s vault. The page never holds the key and never asks for one: it tells the person the name and the host to store it for.\n\n'
  + 'The page does not call the extension\'s address itself. It calls the cortex library that wraps the extension, or the kit block that already does, and the cortex calls the extension. '
  + 'Before you write one, look for one: `aimeat_appdev_overview` lists the person\'s extensions, `aimeat_extension_list` what is installed, and the exchange what somebody already offers. '
  + 'Build it with skill `node:aimeat-extension-builder` (`aimeat_skill_get`), which carries the manifest, the scripts, the install and the checks; its canonical specification is `GET /v1/prompts/build-extension`.\n\n'
  + 'When even an extension is not enough (a run longer than its time limit, a connection that stays open, Python or a native library, a database of its own), the work goes to a service on a Microservices Central. '
  + '`aimeat_appdev_overview` answers `microservices` with the Central this person may use, if any, and the criteria; section 11 of `node:aimeat-extension-builder` says how. '
  + 'The app still calls the cortex, the cortex the extension, and the extension the service. Suggest a service in one sentence with the reason, and build it only on the person\'s yes.\n';

/** Every id the platform answers to, the index first. */
export function atelierPlatformIds(): string[] {
  return ['platform', ...ATELIER_PLATFORM.map(s => s.id)];
}

function platformIndex(nodeUrl: string): string {
  let out = '## The platform: sections only some apps need\n';
  out += 'Each section below covers one situation. They belong to this specification and carry the same authority as its parts: '
    + 'read the ones this app is in BEFORE you write that part of it, and leave the others. '
    + 'Over MCP: `aimeat_handbook_get { tier: "build-app-atelier/<id>" }`. Over HTTP: `GET ' + nodeUrl + '/v1/prompts/build-app-atelier/sections/<id>?format=txt`.\n';
  for (const s of ATELIER_PLATFORM) out += '- `' + s.id + '` — ' + s.when + '\n';
  return out;
}

/** The section text cut from the build text, re-headed to the Atelier level. Null when it is gone. */
function cutSection(from: string, baseUrl: string): string | null {
  const full = buildAppPrompt({ baseUrl } as never, { mode: 'new', lang: 'en' }).full;
  const section = splitBuildAppSpec(full).find(s => s.id === from);
  return section ? section.text.replace(/^#{2,3} /, '## ') : null;
}

/** The index (`platform`) or one section by id. Null for an id the platform does not have. */
export function atelierPlatformPiece(id: string, baseUrl: string): { id: string; text: string } | null {
  const nodeUrl = baseUrl.replace(/\/+$/, '');
  if (id === 'platform') return { id, text: platformIndex(nodeUrl) };
  if (id === 'server-side') return { id, text: SERVER_SIDE_SECTION };
  const entry = ATELIER_PLATFORM.find(s => s.id === id);
  if (!entry) return null;
  const text = cutSection(entry.from ?? entry.id, nodeUrl);
  return text ? { id, text } : null;
}
