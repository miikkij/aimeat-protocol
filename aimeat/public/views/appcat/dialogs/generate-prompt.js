/**
 * @file public/views/appcat/dialogs/generate-prompt.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The prompts the "Generate App with AI" dialog and the front page's builder compose.
 *   connectedPrompt is the one both lead with: a short prompt for an AI connected to this node over
 *   MCP, which reads the Atelier build spec itself, interviews the owner, waits for a yes, and
 *   publishes the app on the owner's account (the brief the front page's four prompt cards proved,
 *   landing-v2-cards.js PREAMBLE). buildPrompt is the long one for an AI that cannot connect (Microsoft
 *   365 Copilot, for one): the idea or the change in the owner's words, the node's Atelier
 *   specification for pasting (GET /v1/prompts/build-app-atelier?delivery=paste, which carries how the
 *   person publishes the file by hand), the section that moves an app built on the retired Classic
 *   track when the app is one, and the source under "## The app to improve"; until the specification
 *   arrives, the line that says it is being fetched. The prompt's own words stay English on purpose:
 *   they tell the AI which language to talk and build in.
 * @structure connectedPrompt(opts) · buildPrompt(opts) · PB_LANGS
 * @usage connectedPrompt({ description, lang, app })
 *        buildPrompt({ app, description, core, move, atelierLoading })
 * @version-history
 *   v2.0.0 — 2026-11-19 — Atelier is the only build guide (decision-atelier-is-the-only-app-build-
 *     guide-classic-and-t1-t2-t3-are). connectedPrompt reads the Atelier specification for every app;
 *     an app built on the Classic track is changed with its section `from-classic`. buildPrompt
 *     composes the Atelier text for pasting and nothing else: the Classic language line, interview,
 *     inline fallback, starting template and capability packs are gone with the Classic guide.
 *   v1.1.0 — 2026-10-25 — connectedPrompt: the connected AI is the road for every new app, on the
 *     Atelier track only; Classic stays for an AI that cannot connect and for improving a Classic app
 *     (Jouni). buildPrompt is unchanged.
 *   v1.0.2 — 2026-09-29 — The publish walkthrough's first step opens /v1/appcat instead of
 *     /app-catalog.html (Jouni). The address only.
 *   v1.0.1 — 2026-09-28 — The aimeat-ai line says the user's own AI providers and capabilities() first
 *     (System 2 plan, V5), as the library pack's promptLine does.
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), moved from the old cortex.js with its
 *     words unchanged; Spanish joins the language line because appcat shows Spanish.
 */

/** The language the AI is asked to talk and build the interface in. */
export const PB_LANGS = { en: 'English', fi: 'Finnish (Suomi)', es: 'Spanish (Español)' };

/**
 * The prompt for an AI connected to this node over MCP. Short on purpose: the AI reads the build
 * spec, the skill and the pitfalls from the node itself, so nothing here can fall behind them.
 * Every app is built and changed with the Atelier specification; an app built on the retired
 * Classic track is moved with its section `from-classic`. Somebody else's app is forked first,
 * because only its owner can publish it.
 * @param {{ description?: string, lang?: string, nodeUrl?: string,
 *   app?: { name?: string, filename?: string, owner?: string, own?: boolean, track?: string,
 *     html?: string }|null }} o
 */
export function connectedPrompt(o) {
  const nodeUrl = o.nodeUrl || location.origin;
  const host = nodeUrl.replace(/^https?:\/\//, '');
  const pbLang = PB_LANGS[o.lang] || 'English';
  const description = String(o.description || '').trim();
  const app = o.app || null;
  const spec = 'the Atelier build spec (aimeat_handbook_get { tier: "build-app-atelier" }, then the parts it names and the platform sections this app needs) and the skill node:aimeat-app-builder-atelier with aimeat_skill_get';
  const read = 'call aimeat_appdev_overview, read ' + spec + ', read aimeat_appdev_pitfall_list, and search the Design Book with aimeat_designbook_search for the parts you will use.';
  const finish = 'run aimeat_app_manage with action "audit" and fix everything it names, take the screenshot (action "screenshot"), set the legal pages when the app keeps anything about people (action "legal"), ask me whether search engines may list it (action "seo"), and hand me the address.';
  let p = 'You are connected to ' + host + ' over MCP as my AI. ';
  if (!app) {
    p += 'Build a new app with me and publish it on my account.\n\n';
    p += 'Talk to me in ' + pbLang + '.\n\n';
    p += 'Before you write a line: ' + read + ' Then do what the spec asks before any code: interview me, show me what you will build, and wait for my yes. Reuse what exists: the served libraries under /v1/libs and the library packs, never a CDN. The app must work on a phone first, in light and dark.\n\n';
    p += 'When it is built: publish it with aimeat_app_publish, ' + finish + '\n\n';
    p += 'THE APP: ' + (description || 'I have not described it yet. Ask me what to build.');
    return p;
  }
  const name = app.name || app.filename || 'Untitled';
  const where = app.owner && app.filename ? ' (' + app.owner + '/' + app.filename + ')' : '';
  const onNode = !!(app.owner && app.filename);
  const fromClassic = app.track !== 'atelier';
  if (onNode && app.own === false) {
    p += 'Make a copy of the app "' + name + '"' + where + ' on my account with aimeat_app_fork, and change the copy.\n\n';
  } else {
    p += 'Change my app "' + name + '"' + where + ' and publish the new version.\n\n';
  }
  p += 'Talk to me in ' + pbLang + '.\n\n';
  p += 'Before you change a line: ' + (onNode ? 'read the app with aimeat_app_get and its design spec (aimeat_app_manage action "spec"), ' : '') + read;
  p += fromClassic
    ? ' This app was built on the retired Classic track: read section from-classic (aimeat_handbook_get { tier: "build-app-atelier/from-classic" }) and ask me which of its two ways I want.'
    : '';
  p += ' If the change is not clear, ask me first, and wait for my yes before you publish.\n\n';
  p += 'When it is done: publish it with aimeat_app_publish, ' + finish + ' Tell me in two lines what changed.\n\n';
  p += 'THE CHANGE: ' + (description || 'I have not described it yet. Ask me what to change.');
  if (!onNode && typeof app.html === 'string') p += '\n\n## The app\'s source\n' + app.html;
  return p;
}

/**
 * The long prompt for an AI that cannot connect.
 * @param {{ app?: { name?: string, html?: string }|null, description: string,
 *   core: string|null, move?: string, atelierLoading: string }} o
 *   core: the Atelier specification for pasting, in the dialog's mode; move: the section
 *   `from-classic`, given only for an app built on the Classic track.
 */
export function buildPrompt(o) {
  if (!o.core) return o.atelierLoading;
  const isImprove = !!o.app;
  const description = String(o.description || '').trim();
  const source = isImprove && typeof o.app.html === 'string' ? o.app.html : null;
  const lead = isImprove ? "The change, in the owner's words: " : "The app idea, in the owner's words: ";
  let out = description ? lead + description + '\n\n' + o.core : o.core;
  if (o.move) out += '\n' + o.move;
  if (source !== null) out += '\n## The app to improve\n--- Source Code ---\n' + source;
  return out;
}
