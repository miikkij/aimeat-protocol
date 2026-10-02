/**
 * @file public/views/profile/apps/design-spec.prompt.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two prompts of the design spec's "Ask your AI" part, and the reader of the AI's
 *   answer. The first prompt is for an AI connected to this AIMEAT over MCP: it reads the spec with
 *   the app tools, writes it, and keeps it current after each publish. The second is for any other
 *   AI: it carries the spec as it stands (or the outline), asks for the whole updated document in
 *   one fenced block, and the paste box saves what comes back. Pure functions with no imports, so a
 *   unit test runs them as they are.
 * @structure buildSpecMcpPrompt({ url, owner, filename, name, stale, present }) ·
 *   buildSpecPastePrompt({ name, current }) · readSpecAnswer(text)
 * @usage import { buildSpecMcpPrompt, buildSpecPastePrompt, readSpecAnswer } from './design-spec.prompt.js';
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (wish-sovelluksen-design-speksi-sovelluksen-l-helle-settings-contr).
 */

/**
 * The prompt for an AI connected over MCP. It names the tools, the order, and what to report.
 * @param {{ url: string, owner: string, filename: string, name: string, present: boolean, stale: boolean }} p
 * @returns {string}
 */
export function buildSpecMcpPrompt({ url, owner, filename, name, present, stale }) {
  const state = !present
    ? 'Nobody has written it yet.'
    : stale
      ? 'It was written against an older version than the app is at now.'
      : 'It describes the app as it is now.';
  return `Keep the design spec of my AIMEAT app "${name}" (${owner}/${filename}, on ${url}) current. ${state}

1. Read it: aimeat_app_manage { action: "spec", owner: "${owner}", filename: "${filename}" }. The answer carries the document, whether it is stale, and an outline to start from when there is none.
2. Read the app: aimeat_app_get { owner: "${owner}", filename: "${filename}" }, and when the spec is missing or stale, the source too (aimeat_app_draft_read, or the download URL), so the spec says what the app does today.
3. Write it back: aimeat_app_manage { action: "spec_set", owner: "${owner}", filename: "${filename}", markdown, expected_revision }, the whole document: what the app is for, its screens, where its data lives (memory keys, workspaces, contracts), the decisions made and why, the AI and agents it uses, what is open, and what bit a builder. Keep what is still true, change what is not. A refusal naming the revision means somebody wrote in between: read again and write from that.
4. From now on, read the spec before every change to this app, and after every publish write it back with what changed. The publish answer tells you when it has fallen behind.

Tell me in plain words what the spec now says the app is, and what you changed in it.`;
}

/**
 * The prompt for an AI with no MCP connection. It carries the current document (or the outline)
 * and asks for the whole updated one in one fenced block, which readSpecAnswer() picks out.
 * @param {{ name: string, current: string }} p
 * @returns {string}
 */
export function buildSpecPastePrompt({ name, current }) {
  return `Help me keep the design spec of my web app "${name}" current. Below is the document as it stands; when it is only an outline, nobody has written it yet. I will tell you what the app does and what changed. Rewrite the whole document so it describes the app as it is now: keep every section heading, keep what is still true, change what is not, and put one line at the top saying when it was last checked. Answer with the complete document in one fenced \`\`\`markdown block and nothing else outside it.

What the app does, and what changed: (write it here)

--- the document as it stands ---
${String(current || '').trim()}`;
}

/**
 * The document in a chatty answer. A fenced markdown block wins (the last closing fence ends it,
 * so fences inside the document do not cut it short); a bare answer is taken whole.
 * @param {string} text
 * @returns {{ ok: true, markdown: string } | { ok: false, error: 'empty' }}
 */
export function readSpecAnswer(text) {
  const s = String(text || '').replace(/\r\n?/g, '\n');
  let body = s;
  const open = s.search(/```(?:markdown|md)?[ \t]*\n/);
  if (open >= 0) {
    const start = s.indexOf('\n', open) + 1;
    const end = s.lastIndexOf('\n```');
    body = end >= start ? s.slice(start, end) : s.slice(start);
  }
  const markdown = body.replace(/[ \t]+$/gm, '').trim();
  if (markdown.length < 3) return { ok: false, error: 'empty' };
  return { ok: true, markdown: markdown + '\n' };
}
