/**
 * @file public/js/services/html-pages.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The HTML pages of a workspace, as the member's view uses them: write one as a draft
 *   (POST /v1/organisms/:id/workspace/drafts, the route the MCP tool aimeat_workspace_write runs,
 *   which checks the page and writes its text), ask for its frame address (POST …/documents/:space/
 *   :docId/frame), and record that a page was opened (…/opened). The ready-made prompt for an AI that
 *   cannot connect over MCP lives here too: its words are the rules a page follows to work in the
 *   frame, the same rules skill aimeat-html-page gives a connected AI.
 * @structure writeHtmlPage · getPageFrame · markPageOpened · htmlPagePrompt · HTML_PAGE_MAX_BYTES
 * @usage import * as htmlPages from '/js/services/html-pages.js';
 * @version-history
 *   v1.1.0 — 2026-10-16 — writeHtmlPage takes the person's `aiProvenance` declaration.
 *   v1.0.0 — 2026-10-16 — Initial (HTML pages in workspaces).
 */
import { apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** The most a page's HTML may hold: one memory value. */
export const HTML_PAGE_MAX_BYTES = 1024 * 1024;

const docPath = (orgId, space, docId) =>
  `/v1/organisms/${encodeURIComponent(orgId)}/workspace/documents/${encodeURIComponent(space)}/${encodeURIComponent(docId)}`;

/**
 * Write an HTML page as a draft. `value` is { title, html, files? }; the node writes its text.
 * `aiProvenance`, when given, is the person's declaration of how the page was made.
 * @param {{ aiProvenance?: Record<string, unknown> }} [opts]
 */
export async function writeHtmlPage(orgId, ws, space, id, value, opts = {}) {
  const { aiProvenance } = opts;
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/drafts`,
    { ws, space, id, value, ...(aiProvenance ? { ai_provenance: aiProvenance } : {}) });
}

/** The frame address of a page, its published copy or the draft: { frame_url, reason? }. */
export async function getPageFrame(orgId, ws, space, docId, version = 'latest') {
  const resp = await apiPost(`${docPath(orgId, space, docId)}/frame?ws=${encodeURIComponent(ws)}`, { version });
  return resp?.data || { frame_url: null };
}

/** Record that this page was opened today. Best-effort: a page is never kept from showing by it. */
export function markPageOpened(orgId, ws, space, docId) {
  apiPost(`${docPath(orgId, space, docId)}/opened?ws=${encodeURIComponent(ws)}`, {})
    .catch(err => swallowed('html-pages: markPageOpened', err));
}

/**
 * The prompt a person runs in an AI chat that cannot reach this node, to get a page that works in
 * the frame. English, as every prompt of this project is; the page's own words follow the person.
 */
export function htmlPagePrompt(topic) {
  return [
    `Make me ONE self-contained HTML file: ${topic || 'a short presentation about the topic I describe next'}.`,
    'Write the visible text in the language I use in this conversation.',
    'Rules, because the page runs in an isolated frame with no network:',
    '- One complete HTML document. CSS and JavaScript inline, in <style> and <script>.',
    '- No fetch, XMLHttpRequest, WebSocket, forms that submit, or iframes: none of them can reach anything.',
    '- Libraries only from https://cdnjs.cloudflare.com, https://cdn.jsdelivr.net or https://unpkg.com, and fonts only from Google Fonts.',
    '- Pictures inline as data: URLs or as SVG, or by a plain file name (photo.png) that I upload beside the page.',
    '- localStorage works but is forgotten when the page closes; keep everything the page needs in the page.',
    '- Links to sources open in a new tab after the reader confirms them.',
    '- Make it work on a phone and a wide screen, with keyboard arrows for slides if it is a presentation.',
    'Answer with the HTML file only, in one code block.',
  ].join('\n');
}
