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
 *   v1.1.0 — 2026-11-06 — The owner's text about the app (AppManifest.about) under the description, as
 *     a section headed "About this app" in the text's language, its markdown rendered by
 *     utils/page-body.ts. The block's `lang` is the about text's language, and absent without one: the
 *     language an app declares was written there before, and lattice's English description was marked
 *     Finnish (TARGET-093).
 *   v1.0.0 — 2026-11-06 — Initial (TARGET-089 V1).
 */
import { escapeHtml } from './html-escape.js';
import { renderMarkdownBody } from './page-body.js';
import { createT, type Locale } from '../i18n.js';

/** The attribute the block is recognised by, on serve (idempotency) and on publish (the strip). */
export const APP_BODY_MARK = 'id="aimeat-app-body"';

/** What the block says. */
export interface AppPageBodySpec {
  /** The app's name as its owner wrote it. */
  name: string;
  /** The app's description as its owner wrote it. An empty one writes no paragraph. */
  description: string;
  /**
   * Kept for callers; no longer written as the block's `lang`. The language an app DECLARES is not
   * the language its owner wrote the description in (lattice declared Finnish over an English
   * description), and a wrong `lang` tells a search engine something false (TARGET-093).
   */
  lang?: string;
  /** The owner's longer text about the app: markdown and the language it is written in. */
  about?: { text: string; lang: string };
}

/** The node's locales: the about heading is in the text's language when the node speaks it. */
const LOCALES: readonly Locale[] = ['en', 'fi', 'es'];

/**
 * The block. Its style sits inside it, so removing the block removes its style too, and every rule
 * is scoped to the block's id, so it cannot restyle the app. The words are escaped before any markup
 * is written, so an owner's name cannot open an element.
 */
export function appPageBodySnippet(spec: AppPageBodySpec): string {
  const description = spec.description.trim();
  const aboutText = spec.about?.text.trim() ?? '';
  const aboutLang = spec.about && LANG_TAG.test(spec.about.lang) ? spec.about.lang : '';
  // The block's `lang` is the language of the owner's text about the app, the one place the owner
  // says which language they wrote in. Without it the block states no language rather than a guess.
  const lang = aboutText && aboutLang ? ` lang="${aboutLang}"` : '';
  const base = aboutLang.split('-')[0] as Locale;
  const heading = createT(LOCALES.includes(base) ? base : 'en')('appBody.about');
  return `<div ${APP_BODY_MARK}${lang}>`
    + '<style>#aimeat-app-body{display:block;box-sizing:border-box;max-width:44rem;margin:24px auto;'
    + 'padding:0 16px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}'
    + '#aimeat-app-body h1{font-size:28px;line-height:1.2;margin:0 0 8px}'
    + '#aimeat-app-body h2,#aimeat-app-body h3{font-size:20px;line-height:1.3;margin:20px 0 8px}'
    + '#aimeat-app-body p,#aimeat-app-body ul,#aimeat-app-body ol{margin:0 0 12px}</style>'
    + `<h1>${escapeHtml(spec.name.trim())}</h1>`
    + (description ? `<p>${escapeHtml(description)}</p>` : '')
    // The markdown renderer escapes every character before it writes a tag, emits a fixed tag set
    // (headings from h2 down, paragraphs, lists, quotes, code, bold, links on http, https, mailto or
    // a path) and never a <div>, so the strip on publish still ends the block at its first </div>.
    + (aboutText ? `<section><h2>${escapeHtml(heading)}</h2>${renderMarkdownBody(aboutText)}</section>` : '')
    + '<script src="/js/app-body.js" defer></script>'
    + '</div>';
}

/** A BCP 47 tag such as `fi`, `en` or `pt-BR`; anything else is not written into the page. */
const LANG_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
