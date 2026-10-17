/**
 * @file src/utils/app-info-badge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app-info mark on a served app: a round 34px button on the node's row of marks
 *   that opens a panel above itself with which version runs, when it was last updated, what the
 *   latest versions changed and a link to the app in the catalogue. For the people who build the
 *   app, public/js/app-news.js adds the draft under way to the same panel. Jouni's request of
 *   2026-10-18: a person should learn these things on the app itself, not by going to the catalogue.
 *
 *   Drawn like the "Use with your AI" mark (utils/app-ai-use-badge.ts): static markup and a scoped
 *   `<style>`, every declaration `!important`, a hidden checkbox so a tap opens the panel on a touch
 *   screen, an opaque surface. The mark works without its script. The script (public/js/app-news.js,
 *   loaded from the block) does three things the markup cannot: it follows the app's live stream and
 *   reloads the page when a new version is published, it shows a builder the draft, and it tucks the
 *   optional marks away when the owner or the visitor chose so.
 *
 *   TUCKED. The CSS for the tucked row lives here, because this block is the one that ships the
 *   script that sets it: `html.aimeat-marks-tucked` makes the attribution bolt, the "Use with your
 *   AI" mark, the install button and this mark transparent and unclickable until
 *   `html.aimeat-marks-peek` (the pointer near the corner, the keyboard on a mark, a panel open). They
 *   stay in their places, so nothing on the row moves when they come back. The AI label and the
 *   cookie mark are never tucked. On a touch screen this mark's button stays in view as the handle.
 *
 *   ITS PLACE ON THE ROW. After the AI label, the bolt and the "Use with your AI" mark; it declares
 *   its own room as --aimeat-mark-info-w, which the cookie mark (middleware/cookie-consent.ts) and the
 *   install button (public/js/install-chip.js) add to their positions.
 * @structure APP_INFO_MARK; APP_INFO_WIDTH_VAR; AppInfoBadgeSpec; appInfoBadgeSnippet(spec)
 * @usage parts.push(appInfoBadgeSnippet({ ... }));  // via applyServeMarks({ info })
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish-p-ivitysmerkki-ja-tietomerkki-sovelluksen-p-lle-merkkien-pii).
 */
import { escapeHtml } from './html-escape.js';

/** The idempotency marker, and the opening the publish strip recognises (app-serve-marks-strip.ts). */
export const APP_INFO_MARK = 'id="aimeat-app-info"';

/** The room this mark takes on the row, for the cookie mark and the install button after it. */
export const APP_INFO_WIDTH_VAR = '--aimeat-mark-info-w';

/** 34px button plus the 8px gap to the next mark. */
const ROW_PX = 42;

/** The manifest facts the two owner switches read. */
type MarksFacts = { marks?: { info?: boolean; tucked?: boolean } } | undefined | null;

/**
 * The owner's switch for this mark (manifest.marks.info, services/app-marks.ts). Absent = on. Declared
 * beside the mark, as appAiUseOn is, so services/app-news.ts reads it without importing app-marks.ts
 * and closing an import cycle through the publish path.
 */
export function appInfoMarkOn(m: MarksFacts): boolean {
  return m?.marks?.info !== false;
}

/** The row's starting state for a visitor who has not chosen (manifest.marks.tucked). Absent = in view. */
export function appMarksTucked(m: MarksFacts): boolean {
  return m?.marks?.tucked === true;
}

/** The words the script needs, in the visitor's language. `{{x}}` marks a value it fills in. */
export interface AppInfoScriptWords {
  /** "A new version is being made". */
  draft: string;
  /** "{{who}} wrote this {{date}}". */
  draftBy: string;
  /** "The working copy was saved {{date}}." */
  draftSaved: string;
  /** "Nobody has worked on the working copy for two weeks." */
  draftStale: string;
  /** "Open the working copy". */
  draftOpen: string;
  /** "Tuck the marks away". */
  tuck: string;
  /** "Keep the marks in view". */
  untuck: string;
  /** "Updated to version {{v}}". */
  reloaded: string;
}

export interface AppInfoBadgeSpec {
  /** `owner/filename`, what the script asks the live stream to follow. */
  appId: string;
  /** The live version number, which a `version` event is compared with. */
  version: number;
  /** The owner's starting state for the row (manifest.marks.tucked). */
  tucked: boolean;
  /** The app in the catalogue, the panel's link. */
  moreUrl: string;
  /** The button's accessible name: "About this app: version and what changed". */
  open: string;
  /** "About this app". */
  title: string;
  /** "Version 1.4 (update 12) · Updated 18 Oct 2026". */
  versionLine: string;
  /** "What changed", shown when there are changes. */
  changesTitle: string;
  /** The latest roadmap lines, already worded ("The score board fits a phone (12)"). */
  changes: string[];
  /** "More about this app". */
  more: string;
  words: AppInfoScriptWords;
}

/** Every character outside printable ASCII as a numeric entity, after HTML escaping. */
function entities(s: string): string {
  return escapeHtml(s).replace(/[^ -~]/g, (c) => `&#${c.codePointAt(0)};`);
}

/** JSON that cannot end the script element it sits in. */
function scriptSafeJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/** An "i" in a circle, drawn. A graphic owes 3:1, and the house rule is no emoji in the interface. */
const INFO = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" '
  + 'stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false">'
  + '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.01"/></svg>';

/** The marks the tucked row hides: their visible parts, since the wrappers are display:contents. */
const TUCKABLE = [
  '#aimeat-app-badge>label', '#aimeat-app-badge>a',
  '#aimeat-ai-use>label', '#aimeat-ai-use>span',
  '#aimeat-install-chip',
  '#aimeat-app-info>label', '#aimeat-app-info>span',
];

export function appInfoBadgeSnippet(spec: AppInfoBadgeSpec): string {
  const id = 'aimeat-app-info';
  const left = 'calc(12px + var(--aimeat-mark-ai-w,0px) + var(--aimeat-mark-badge-w,0px) + var(--aimeat-mark-aiuse-w,0px))';
  const surface = 'background:#14141c!important;box-shadow:0 4px 16px rgba(0,0,0,.28)!important;'
    + 'border:1px solid rgba(255,255,255,.14)!important;';
  const font = 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;';
  const tucked = 'html.aimeat-marks-tucked:not(.aimeat-marks-peek) ';
  const css =
    `:root{${APP_INFO_WIDTH_VAR}:${ROW_PX}px}`
    + `#${id}{display:contents!important}`
    + `#${id} input{position:fixed!important;left:${left}!important;right:auto!important;bottom:20px!important;`
    + 'width:1px!important;height:1px!important;margin:0!important;opacity:0!important;'
    + 'pointer-events:none!important;z-index:2147483647!important}'
    + `#${id} svg{width:1em!important;height:1em!important;display:block!important;flex:none!important}`
    + `#${id} label{display:flex!important;position:fixed!important;left:${left}!important;right:auto!important;`
    + 'bottom:12px!important;top:auto!important;z-index:2147483647!important;width:34px!important;height:34px!important;'
    + 'box-sizing:border-box!important;margin:0!important;padding:0!important;align-items:center!important;'
    + 'justify-content:center!important;border-radius:50%!important;color:#8FD3FF!important;'
    + 'font:600 18px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;cursor:pointer!important;'
    + `user-select:none!important;-webkit-user-select:none!important;${surface}}`
    // A builder's draft under way: a dot on the button (public/js/app-news.js sets the class).
    + `#${id}.aimeat-has-draft label::after{content:""!important;position:absolute!important;top:3px!important;right:3px!important;`
    + 'width:9px!important;height:9px!important;border-radius:50%!important;background:#FFB52E!important;'
    + 'border:2px solid #14141c!important}'
    + `#${id}>span{display:none!important;position:fixed!important;left:${left}!important;right:auto!important;`
    + 'bottom:52px!important;top:auto!important;z-index:2147483647!important;flex-direction:column!important;'
    + 'gap:5px!important;box-sizing:border-box!important;margin:0!important;padding:10px 14px!important;'
    + `max-width:min(340px,calc(100vw - 24px))!important;border-radius:14px!important;color:#fff!important;${surface}`
    + `font-size:13px!important;line-height:1.35!important;${font}text-align:left!important}`
    + `#${id}>span::after{content:""!important;position:absolute!important;left:0!important;right:0!important;`
    + 'top:100%!important;height:10px!important}'
    + `#${id}:hover>span,#${id}:focus-within>span,#${id} input:checked~span{display:flex!important}`
    + `#${id} b{font-weight:600!important;color:#fff!important}`
    + `#${id} small{font-size:12px!important;opacity:.78!important;font-weight:500!important}`
    + `#${id} ul{margin:0!important;padding:0 0 0 16px!important;font-size:12px!important;list-style:disc!important}`
    + `#${id} li{margin:2px 0!important;padding:0!important}`
    + `#${id} [data-draft]{display:flex!important;flex-direction:column!important;gap:2px!important;`
    + 'padding:6px 8px!important;border-radius:8px!important;background:rgba(255,181,46,.14)!important}'
    + `#${id} [data-draft][hidden]{display:none!important}`
    + `#${id} a{color:#8FD3FF!important;text-decoration:underline!important;font-weight:600!important;font-size:13px!important}`
    + `#${id} button{all:unset!important;cursor:pointer!important;color:#fff!important;opacity:.8!important;`
    + 'font-size:12px!important;text-decoration:underline!important}'
    + `#${id} button[hidden]{display:none!important}`
    + `#${id} input:focus-visible~label{outline:2px solid #8FD3FF!important;outline-offset:2px!important}`
    // The tucked row: transparent and out of the pointer's way, in place, until it peeks.
    + TUCKABLE.map((s) => tucked + s).join(',') + '{opacity:0!important;pointer-events:none!important}'
    + TUCKABLE.map((s) => 'html.aimeat-marks-tucked ' + s).join(',') + '{transition:opacity .18s ease!important}'
    // A touch screen has no pointer to bring the row back, so this button stays as the handle.
    + `@media (hover:none){${tucked}#${id}>label{opacity:1!important;pointer-events:auto!important}}`;

  const changes = spec.changes.length
    ? `<small>${entities(spec.changesTitle)}</small><ul>${spec.changes.map((c) => `<li>${entities(c)}</li>`).join('')}</ul>`
    : '';
  const data = { app: spec.appId, v: spec.version, tucked: spec.tucked, more: spec.moreUrl, words: spec.words };

  // Spans and a list, never a div, inside the block: the publish strip ends this block at its first `</div>`.
  return `<div ${APP_INFO_MARK}>`
    + `<style>${css}</style>`
    + `<input type="checkbox" id="${id}-open">`
    + `<label for="${id}-open" aria-label="${entities(spec.open)}">${INFO}</label>`
    + `<span role="group"><b>${entities(spec.title)}</b><small>${entities(spec.versionLine)}</small>`
    + changes
    + '<span data-draft hidden></span>'
    + `<a href="${escapeHtml(spec.moreUrl)}" target="_blank" rel="noopener">${entities(spec.more)}</a>`
    + '<button type="button" data-tuck hidden></button></span>'
    + `<script type="application/json" id="${id}-data">${scriptSafeJson(data)}</script>`
    // Same origin as the page, on every serving path: the app's own origin serves /js and /v1 too.
    + '<script src="/js/app-news.js" defer></script>'
    + '</div>';
}
