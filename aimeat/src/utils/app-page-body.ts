/**
 * @file app-page-body.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app's own name and description, written by the server into the document it sends,
 *   so a reader that does not run JavaScript learns what the app is.
 *
 *   The failure this fixes was measured on aimeat.io on 2026-11-06 (TARGET-089, event
 *   evt-t089-v0-20261106). Of the 35 apps a search engine may index, 20 sent 0 words of their own
 *   HTML text and 26 had no `<h1>`: a single-file app is a script that draws its view, and the
 *   document as sent holds the node's marks and nothing of the app. The median app gave a crawler
 *   32 words of its own, against about 250 words of the node's marks and the agent block. Bing reads
 *   a page like that as low-value content, and seo.announce_apps has been off since 2026-10-01 for
 *   that reason (Platform Development Notes doc-mus9ip9musb4).
 *
 *   The words already exist: the owner wrote the app's name and its description when they
 *   published it. This block puts them in the document as a visible `<h1>` and paragraph, the same
 *   way utils/page-body.ts puts a node page's own text into the SPA shell. NOTHING HERE IS HIDDEN.
 *   A person sees the block while the document loads, and /js/app-body.js (deferred, so it runs
 *   once the document is parsed, just before DOMContentLoaded) removes it then.
 *   A reader without JavaScript, a person or a crawler, sees it and keeps it. An app whose own CSP
 *   refuses the script keeps the block as a header above its view, which is still the same text
 *   for everybody.
 *
 *   It is written at the start of the body, in normal flow and without positioning, so it can never
 *   cover the app. Only on an app a search engine may index: an app nobody may find gets the same
 *   bytes it got before.
 * @structure
 *   - APP_BODY_MARK                — the idempotency and strip marker
 *   - appPageBodySnippet(spec)     — the markup
 * @usage
 *   parts.push(appPageBodySnippet({ name: 'Noste', description: 'Lift calculator for …', lang: 'fi' }));
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial (TARGET-089 V1).
 */
import { escapeHtml } from './html-escape.js';

/** The attribute the block is recognised by, on serve (idempotency) and on publish (the strip). */
export const APP_BODY_MARK = 'id="aimeat-app-body"';

/** What the block says. */
export interface AppPageBodySpec {
  /** The app's name as its owner wrote it. */
  name: string;
  /** The app's description as its owner wrote it. An empty one writes no paragraph. */
  description: string;
  /** The language the description is written in, when the app declares one. */
  lang?: string;
}

/**
 * The block. Its style sits inside it, so removing the block removes its style too, and every rule
 * is scoped to the block's id, so it cannot restyle the app. The words are escaped before any markup
 * is written, so an owner's name cannot open an element.
 */
export function appPageBodySnippet(spec: AppPageBodySpec): string {
  const lang = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(spec.lang ?? '') ? ` lang="${spec.lang}"` : '';
  const description = spec.description.trim();
  return `<div ${APP_BODY_MARK}${lang}>`
    + '<style>#aimeat-app-body{display:block;box-sizing:border-box;max-width:44rem;margin:24px auto;'
    + 'padding:0 16px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}'
    + '#aimeat-app-body h1{font-size:28px;line-height:1.2;margin:0 0 8px}'
    + '#aimeat-app-body p{margin:0}</style>'
    + `<h1>${escapeHtml(spec.name.trim())}</h1>`
    + (description ? `<p>${escapeHtml(description)}</p>` : '')
    + '<script src="/js/app-body.js" defer></script>'
    + '</div>';
}
