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
 *   v1.4.1 — 2026-11-24 — `server-side`: over MCP the extension skill is the specification; the HTTP
 *     address carries the whole text, longer than one tool result.
 *   v1.4.0 — 2026-11-21 — The section `verify` (builtin-skills.app-builder-common.ts VERIFY_SECTION):
 *     one checklist for checking an app in a browser, folded from six learned pitfalls. `from-classic`
 *     carries the five migration traps itself instead of sending every builder to a private entry.
 *   v1.3.0 — 2026-11-20 — The platform index points at the node's capability list (`aimeat_handbook_get
 *     { tier: "features" }`, /v1/everything), which check:feature-reach holds whole.
 *   v1.2.0 — 2026-11-20 — The sections `ai-path` and `app-tools` (atelier-ai-path.ts): the path the
 *     person's own AI takes into the app, and an action it calls, backed by an extension, with the
 *     space it guards closed.
 *   v1.1.0 — 2026-11-19 — The section `other-owners` (atelier-other-owners.ts): an app whose shared
 *     data other accounts' AI agents read and write. The served `group` and `row-spaces` end with a
 *     line pointing at it.
 *   v1.0.0 — 2026-11-19 — Initial, with `server-side`, `from-classic`, the paste delivery, and three
 *     sections from the retired Classic skill (`dates-numbers`, `publish-checks`, `after-publish`).
 */
import { buildAppPrompt } from './app-prompt.js';
import { splitBuildAppSpec } from './app-layers.js';
import { AFTER_PUBLISH_SECTION, DATES_NUMBERS_SECTION, PUBLISH_CHECKS_SECTION, VERIFY_SECTION } from '../../data/builtin-skills.app-builder-common.js';
import { buildCapabilityPackLines } from '../../data/library-packs.js';
import { OTHER_OWNERS_SECTION, OTHER_OWNERS_POINTER } from './atelier-other-owners.js';
import { AI_PATH_SECTION, APP_TOOLS_SECTION } from './atelier-ai-path.js';

/** The cut sections that end with the pointer to `other-owners`: the two a shared app is built from. */
const POINTS_TO_OTHER_OWNERS = new Set(['group', 'row-spaces']);

/** The sections that lived in the retired Classic skill and hold on any track (builtin-skills.app-builder-common.ts). */
const MOVED_FROM_CLASSIC_SKILL: Record<string, string> = {
  'dates-numbers': DATES_NUMBERS_SECTION,
  'publish-checks': PUBLISH_CHECKS_SECTION,
  'after-publish': AFTER_PUBLISH_SECTION,
};

/**
 * The platform sections in the order the index lists them. `from` is the section's id in the build
 * text (app-layers.ts SECTION_TABLE); `when` is the situation, in the builder's terms, in which it
 * is read. A section the build text no longer carries makes test/unit/build-atelier-platform.test.ts
 * fail, so nothing goes missing quietly.
 */
export const ATELIER_PLATFORM: Array<{ id: string; from?: string; when: string }> = [
  { id: 'research', when: 'Connected over MCP, before you frame the build: what already exists on this node to start from, and when to skip straight to building.' },
  { id: 'engines', when: 'The app needs a third-party engine: charts, maps, 3D, a game engine, PDF, video, a database in the browser. Each is hosted on this node, with how to load it and what breaks.' },
  { id: 'calling-the-node', when: 'The app calls the node itself (`session.fetch`) for something the kit\'s blocks and `AIMEAT.data` do not cover. Every answer is read `ok` first.' },
  { id: 'scopes', when: 'The app needs more than reading and writing its own records: deleting keys, files, AI, organisms, agents or extensions.' },
  { id: 'data-storage', when: 'The app keeps more than one record per person: entries other people read, a shared feed, comments, a journal, a public profile.' },
  { id: 'data-map', when: 'Before you publish: how to write the data map, the record the next AI reads to find where this app keeps what.' },
  { id: 'group', when: 'Several people use the same data: a team, a club, a class, members with roles.' },
  { id: 'row-spaces', when: 'The app keeps a growing log, an audit trail or measurements for a group.' },
  { id: 'other-owners', when: "People of other accounts, and their own AI agents, read and write the app's shared data: a situation room, a project several people share. Read it before the first publish." },
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
  { id: 'ai-path', when: 'Every AI-accelerated app (the default build style): how the person\'s own AI works in the app, what people keep doing themselves, and what the bound skill holds.' },
  { id: 'app-tools', when: 'The person\'s AI or an agent should act in the app through a rule the app enforces (a calculation, a limit, money, a permission), on data several people share, or on content the app produces: an app tool backed by an extension action.' },
  { id: 'agent-face', when: 'Other AI agents should be able to read or operate the published app.' },
  { id: 'install', when: 'The app is installed on a phone: the home-screen icon.' },
  { id: 'dates-numbers', when: 'The app shows a date, a time, a number, money or morsels: they follow the person\'s own format and clock, never the app\'s language.' },
  { id: 'verify', when: 'Before you say the app works: the one checklist for checking it in a browser (which browser, the visible path, the whole console, sign-up, what automation cannot do, driving an app with Playwright).' },
  { id: 'publish-checks', when: 'Before you publish: check the script so a parse error is not what the node refuses, and send a file over about 1 KB by presigned upload.' },
  { id: 'after-publish', when: 'After the publish: the template and the pitfall the next build starts from, the bound skill\'s reader, and the workstation for an app past about 300 kB.' },
  { id: 'publish-by-hand', from: 'publish', when: 'You cannot publish over MCP: you give the person one HTML file and tell them how to put it on the node.' },
  { id: 'from-classic', when: 'The app you change was built on the retired Classic track: it loads daisyUI, writes its own sign-in, or declares `aimeat-track` `classic`.' },
];

/** The edit path for an app built on the retired Classic track (decision of 2026-11-19, point 2). */
export const FROM_CLASSIC_SECTION = '## An app built on the retired Classic track\n'
  + 'Until November 2026 an app could be built on the Classic track: a page that loads daisyUI and Tailwind (`/lib/aimeat-daisyui-bridge.css`), '
  + 'boots its own sign-in with `AIMEAT.auth.onSession`, contains the theme-restore snippet, and declares `<meta name="aimeat-track" content="classic">` or no track at all. '
  + 'Classic is retired and has no guide of its own any more. Such an app is changed with THIS specification, in one of two ways, and the owner chooses:\n\n'
  + '1. **Move it now.** Start from `shell-atelier`, or from the genre the owner picks on the level `fine`, and move the logic, the dictionary and the data over unchanged. '
  + 'The hand-made screens become the kit\'s components; the hand-written sign-in and the theme snippet go, because the shell does both and gives you the session in `onReady`.\n'
  + '2. **Change only what was asked.** Put the page inside the Atelier shell (`AIMEAT.atelier.app(...)`) and keep the old markup in one section body '
  + '(`var s = AIMEAT.atelier.section({ target: a.main, title: \'…\' }); s.body.appendChild(oldMarkup);`). daisyUI and Tailwind classes are allowed there and nowhere else, '
  + 'so the page keeps loading their stylesheet until the section is rebuilt with the kit. The sign-in still moves to the shell. Move the rest when the owner asks.\n\n'
  + 'Either way: keep the filename and every memory key, so the published address and the person\'s data stay where they are; read the app\'s data map first (`aimeat_datamap_get`); '
  + 'declare `<meta name="aimeat-track" content="atelier">`; and publish with this specification\'s `spec_token`. '
  + 'Five traps have each broken a moved app (recorded as atelier-kit-migration-traps), and all five are here: '
  + '(1) `AIMEAT.atelier.app({ nav: "side" })` builds the side column only when `navItems` is non-empty when the app is made; `a.nav.set({ items })` later cannot create it, so pass the whole list up front and filter what each page shows. '
  + '(2) The phone\'s bottom bar shows only the items with `bottom: true` or no group, and the kit adds a Menu entry that opens every page in a sheet; test the navigation at the phone size, not only that nothing overflows. '
  + '(3) A workspace created with a strict schema refuses a record with fields the schema does not name, whatever its `additionalProperties` says; give such a schema `patternProperties: { "^.*$": {} }`. '
  + '(4) `AIMEAT.atelier.kanban` has no card-open callback, and its cards take focus only when `onMove` is set; make each `[data-card]` pressable yourself after it renders. '
  + '(5) An old stylesheet kept for one section outranks the kit: a later `.btn` rule beats the kit\'s fill, `.input { width: auto }` beats a full-width class, and a wrapper reset such as `.x h1, .x p { margin: 0 }` beats spacing classes. '
  + 'Put the old class names on the kit\'s `--ak-*` tokens once in the page\'s own sheet, scope the page\'s own variables to a wrapper inside the frame\'s main area (not `:root`), and write every reset as `:where(...)`. '
  + 'The frame\'s main area is the scroller, so `window.scrollTo(0, 0)` does nothing: reset the main area too. '
  + 'Compare the old and the new screen with the same steps before you publish.\n';

/** The one line part `start` gives this index (atelier-layers.ts partsIndex). Keep it short: `start` is near MAX_PART_CHARS. */
export const ATELIER_PLATFORM_PART_LINE = '- `platform` — the sections only some apps need (a team, files, AI, intake, outside users, payments, server-side work), each with when to read it. Read the index, then the ones this app is in.\n';

/** Classic taught this as tier T3. Written for Atelier on 2026-11-19; the how lives in skill node:aimeat-extension-builder. */
export const SERVER_SIDE_SECTION = '## Server-side work: an extension, and when that is not enough\n'
  + 'A page runs in the person\'s browser, and three kinds of work cannot happen there. A call to another service with a key: the browser cannot keep a secret. '
  + 'A rule that must hold whatever the browser sends: only the author deletes an entry, one vote per person, a price nobody else changes. '
  + 'Work that runs while nobody has the page open: a fetch every morning, a reminder. Each of these is a server extension: a small sandboxed program the node runs, '
  + 'which keeps its own data in `ext:<name>`, calls outside services with `ctx.fetch`, and names a key in an outbound header as `{{secret:NAME}}`, which the node fills '
  + 'from the signed-in person\'s secret store. The page never holds the key and never asks for one: it tells the person the name and the host to store it for.\n\n'
  + 'The page does not call the extension\'s address itself. It calls the cortex library that wraps the extension, or the kit block that already does, and the cortex calls the extension. '
  + 'Before you write one, look for one: `aimeat_appdev_overview` lists the person\'s extensions, `aimeat_extension_list` what is installed, and the exchange what somebody already offers. '
  + 'Build it with skill `node:aimeat-extension-builder` (`aimeat_skill_get`), which covers the manifest, the scripts, the install and the checks; over MCP the skill is the specification. '
  + 'Over HTTP the whole specification is `GET /v1/prompts/build-extension?format=txt`, which is longer than one tool result.\n\n'
  + 'When even an extension is not enough (a run longer than its time limit, a connection that stays open, Python or a native library, a database of its own), the work goes to a service on a Microservices Central. '
  + '`aimeat_appdev_overview` answers `microservices` with the Central this person may use, if any, and the criteria; section 11 of `node:aimeat-extension-builder` says how. '
  + 'The app still calls the cortex, the cortex the extension, and the extension the service. Suggest a service in one sentence with the reason, and build it only on the person\'s yes.\n';

/** Every id the platform answers to, the index first. */
export function atelierPlatformIds(): string[] {
  return ['platform', ...ATELIER_PLATFORM.map(s => s.id)];
}

function platformIndex(nodeUrl: string): string {
  let out = '## The platform: sections only some apps need\n';
  out += 'Each section below covers one situation. They belong to this specification and have the same authority as its parts: '
    + 'read the ones this app is in BEFORE you write that part of it, and leave the others. '
    + 'Over MCP: `aimeat_handbook_get { tier: "build-app-atelier/<id>" }`. Over HTTP: `GET ' + nodeUrl + '/v1/prompts/build-app-atelier/sections/<id>?format=txt`.\n';
  for (const s of ATELIER_PLATFORM) out += '- `' + s.id + '` — ' + s.when + '\n';
  // The capability list (docs/AIMEAT-Feature-List.md, held whole by check:feature-reach): what the node
  // does beyond these sections, so an app hands a job to the node instead of rebuilding it in the page.
  out += 'Beyond these sections, the node itself does more: `aimeat_handbook_get { tier: "features" }` lists every capability by area '
    + '(agents that work on a schedule, workflows, mail, payments, signing, receivers, data packages, what the owner lets every AI do without asking), '
    + 'and `GET ' + nodeUrl + '/v1/everything` is the same list. Read it before you design a feature, give a job to the node when it already does it, '
    + 'and tell the person which capability the app uses, in plain words.\n';
  return out;
}

/** The section text cut from the build text, re-headed to the Atelier level. Null when it is gone. */
function cutSection(from: string, baseUrl: string): string | null {
  const full = buildAppPrompt({ baseUrl } as never, { mode: 'new', lang: 'en' }).full;
  const section = splitBuildAppSpec(full).find(s => s.id === from);
  return section ? section.text.replace(/^#{2,3} /, '## ') : null;
}

/**
 * What an AI that cannot connect to the node reads before the Atelier text. The text is written for
 * an AI connected over MCP: it calls tools for the structure page and the publish. Pasted into a
 * chat with no connection, those steps cannot run, and until 2026-11-19 nothing told that AI how the
 * finished file reaches the node.
 */
export const PASTE_PREFACE = '## Before you start: you are not connected to this node\n'
  + 'The person pasted this into a chat that is not connected to their AIMEAT. Follow the specification below with three changes. '
  + 'Skip every step that calls an `aimeat_*` tool (the structure page, the audit, the publish): you cannot call them. '
  + 'Open the addresses it names (the genres, the shell, the platform sections) if you can read web pages; if you cannot, build on the level `proto`, which uses the kit\'s components as they come and needs nothing but this text. '
  + 'When the app is built, give the person ONE complete HTML file, and end your reply as the section "When the app is ready" in this text says.\n\n';

/** The Atelier text for an AI that cannot connect: the preface, the text, and how the person publishes the file. */
export function atelierPasteDelivery(full: string, baseUrl: string): string {
  const publish = atelierPlatformPiece('publish-by-hand', baseUrl);
  return PASTE_PREFACE + full + (publish ? '\n' + publish.text : '');
}

/** The index (`platform`) or one section by id. Null for an id the platform does not have. */
export function atelierPlatformPiece(id: string, baseUrl: string): { id: string; text: string } | null {
  const nodeUrl = baseUrl.replace(/\/+$/, '');
  if (id === 'platform') return { id, text: platformIndex(nodeUrl) };
  if (id === 'server-side') return { id, text: SERVER_SIDE_SECTION };
  if (id === 'app-tools') return { id, text: APP_TOOLS_SECTION };
  if (id === 'ai-path') return { id, text: AI_PATH_SECTION };
  if (id === 'from-classic') return { id, text: FROM_CLASSIC_SECTION };
  if (id === 'verify') return { id, text: VERIFY_SECTION };
  if (id === 'other-owners') return { id, text: OTHER_OWNERS_SECTION };
  const moved = MOVED_FROM_CLASSIC_SKILL[id];
  if (moved) return { id, text: moved };
  // The engines the Classic library list carried and the Atelier one only pointed at, without the
  // Classic styling pack (daisyUI), which an Atelier page uses inside a section at most.
  if (id === 'engines') return { id, text: '## Third-party engines this node hosts\n' + buildCapabilityPackLines(nodeUrl, ['styling']) };
  const entry = ATELIER_PLATFORM.find(s => s.id === id);
  if (!entry) return null;
  const text = cutSection(entry.from ?? entry.id, nodeUrl);
  if (!text) return null;
  // Appended to the served copy only: the cut text stays as it was written (no prompt rewrite).
  return { id, text: POINTS_TO_OTHER_OWNERS.has(id) ? text.replace(/\s*$/, '\n') + OTHER_OWNERS_POINTER : text };
}
