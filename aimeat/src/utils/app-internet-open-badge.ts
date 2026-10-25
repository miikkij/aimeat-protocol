/**
 * @file app-internet-open-badge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The line at the end of an app that a node which shows its content to signed-in
 *   accounts only has opened to everyone on the internet (services/internet-opening/): "This page is
 *   open to everyone on the internet", and the organisation and node it belongs to. Every visitor
 *   reads the same words, because the app origin carries no session; who opened it and why stays on
 *   the operators' and the owner's pages.
 *
 *   It is a block at the end of the page, in the flow, never fixed: a landing page reads it where a
 *   footer stands, and it covers nothing the app drew. Its bottom margin is the strip the node's fixed
 *   marks take (utils/app-chrome-reserve.ts), so those never cover it either.
 *
 *   Same mechanics as the other marks: pure static markup with a scoped `<style>`, idempotent via
 *   INTERNET_OPEN_MARK, put in the page by the one pass in services/app-serve-marks.ts, and taken out
 *   again on a republish by services/app-serve-marks-strip.ts. One `<div>` with no nested `<div>`.
 * @structure INTERNET_OPEN_MARK · internetOpenSnippet()
 * @usage via applyServeMarks({ internetOpen: { text, who } })
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { escapeHtml } from './html-escape.js';

/** The idempotency marker, and the opening the publish strip recognises. */
export const INTERNET_OPEN_MARK = 'id="aimeat-internet-open"';

/** Every character outside printable ASCII as a numeric entity, after HTML escaping. */
function entities(s: string): string {
  return escapeHtml(s).replace(/[^ -~]/g, (c) => `&#${c.codePointAt(0)};`);
}

export interface InternetOpenBadgeSpec {
  /** "This page is open to everyone on the internet." */
  text: string;
  /** "Innokas Oy · innokas.aimeat.io" */
  who: string;
}

export function internetOpenSnippet(spec: InternetOpenBadgeSpec): string {
  const id = 'aimeat-internet-open';
  const css =
    `#${id}{display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:6px 14px!important;`
    + 'box-sizing:border-box!important;width:100%!important;margin:0 0 var(--aimeat-chrome-bottom,46px)!important;'
    + 'padding:10px 16px!important;background:#1A1A2E!important;color:#FAFAF8!important;clear:both!important;'
    + 'font:400 14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;text-align:left!important;'
    + 'position:relative!important;z-index:2147483000!important}'
    + `#${id} b{font-weight:600!important;color:#FAFAF8!important}`
    + `#${id} span{color:#C9CBD3!important}`
    + `#${id} i{display:inline-block!important;width:10px!important;height:10px!important;background:#6EE7B7!important;flex:none!important}`;
  return `<div ${INTERNET_OPEN_MARK}><style>${css}</style>`
    + `<i aria-hidden="true"></i><b>${entities(spec.text)}</b><span>${entities(spec.who)}</span></div>`;
}
