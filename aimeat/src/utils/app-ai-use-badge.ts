/**
 * @file src/utils/app-ai-use-badge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "Use with your AI" mark on a served app: a round 34px button on the node's row of
 *   marks, after the AI label and the attribution bolt, that opens a panel above itself with what a
 *   person's own AI can use on this app (how many app tools, how many skills) and a link to the
 *   app's guide page. Jouni's request of 2026-10-09: the tools and skills were findable only by a
 *   machine, and a person had no way to learn their AI could work the app.
 *
 *   Drawn like the attribution bolt (utils/app-badge.ts): static markup and a scoped `<style>`,
 *   every declaration `!important` so app CSS cannot restyle it, a hidden checkbox so a tap opens
 *   the panel on a touch screen, and an opaque surface so its contrast is the same on every app.
 *   It adds a few lines of script that the bolt does not have: opening this panel closes the AI
 *   label's and the bolt's, opening one of theirs closes this one, and a tap anywhere else closes
 *   it. The mark works without the script; the script only tidies the row.
 *
 *   ITS PLACE ON THE ROW. Third, after the AI label (--aimeat-mark-ai-w) and the bolt
 *   (--aimeat-mark-badge-w); it declares its own room as --aimeat-mark-aiuse-w, which the install
 *   button (public/js/install-chip.js) adds to its own position.
 *
 *   The words come in translated (services/app-serve-marks.ts asks the locale), and every
 *   non-ASCII character is written as an entity, because a served app often declares no charset.
 * @structure AI_USE_MARK; AI_USE_WIDTH_VAR; appAiUseOn; AppAiUse; AiUseBadgeSpec; aiUseBadgeSnippet(spec)
 * @usage parts.push(aiUseBadgeSnippet({ guideUrl, title, counts, link, open }));  // via applyServeMarks
 * @version-history
 *   v1.0.0 -- 2026-10-09 -- Initial (wish-ai-skill-and-ai-app-tool-badges-on-a-published-app-with-a-pa).
 */
import { escapeHtml } from './html-escape.js';

/** The idempotency marker, and the opening the publish strip recognises (app-serve-marks-strip.ts). */
export const AI_USE_MARK = 'id="aimeat-ai-use"';

/** The room this mark takes on the row, for the install button after it. */
export const AI_USE_WIDTH_VAR = '--aimeat-mark-aiuse-w';

/** 34px button plus the 8px gap to the next mark. */
const ROW_PX = 42;

/** The owner's switch for this mark (manifest.marks.aiUse, services/app-marks.ts). Absent = on. */
export function appAiUseOn(m: { marks?: { aiUse?: boolean } } | undefined | null): boolean {
  return m?.marks?.aiUse !== false;
}

/**
 * What services/app-ai-use.ts counted for one app. Declared here, beside the markup that shows it,
 * so the serve pass (services/app-serve-marks.ts) takes it without importing the service, whose
 * imports lead back to the serve pass (app-marks → app-audit → app-lifecycle → the publish strip).
 */
export interface AppAiUse {
  /** Public tools in the app's tool manifest. */
  tools: number;
  /** Public skills bound to the app (the owner's own, and the node's). */
  skills: number;
  /** The guide page. */
  guideUrl: string;
}

export interface AiUseBadgeSpec {
  /** The app's guide page (services/app-ai-use.ts aiUseGuideUrl). */
  guideUrl: string;
  /** The panel's first line: "Use this app with your AI". */
  title: string;
  /** What there is: "2 app tools · 1 skill". */
  counts: string;
  /** The link's words: "How to connect your AI". */
  link: string;
  /** The button's accessible name: "Use this app with your AI: show". */
  open: string;
}

/** Every character outside printable ASCII as a numeric entity, after HTML escaping. */
function entities(s: string): string {
  return escapeHtml(s).replace(/[^ -~]/g, (c) => `&#${c.codePointAt(0)};`);
}

/**
 * A plug, drawn: two prongs and a cord. Sized in ems so the button's font-size sets it. The house
 * rule is no emoji in the interface, and an inline SVG is a graphic, which owes 3:1 rather than 4.5.
 */
const PLUG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" '
  + 'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
  + '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/></svg>';

export function aiUseBadgeSnippet(spec: AiUseBadgeSpec): string {
  const id = 'aimeat-ai-use';
  const left = 'calc(12px + var(--aimeat-mark-ai-w,0px) + var(--aimeat-mark-badge-w,0px))';
  const surface = 'background:#14141c!important;box-shadow:0 4px 16px rgba(0,0,0,.28)!important;'
    + 'border:1px solid rgba(255,255,255,.14)!important;';
  const font = 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;';
  const css =
    `:root{${AI_USE_WIDTH_VAR}:${ROW_PX}px}`
    + `#${id}{display:contents!important}`
    // The toggle: visually hidden, never display:none, so the keyboard reaches it.
    + `#${id} input{position:fixed!important;left:${left}!important;right:auto!important;bottom:20px!important;`
    + 'width:1px!important;height:1px!important;margin:0!important;opacity:0!important;'
    + 'pointer-events:none!important;z-index:2147483647!important}'
    + `#${id} svg{width:1em!important;height:1em!important;display:block!important;flex:none!important}`
    // The round button.
    + `#${id} label{display:flex!important;position:fixed!important;left:${left}!important;right:auto!important;`
    + 'bottom:12px!important;top:auto!important;z-index:2147483647!important;width:34px!important;height:34px!important;'
    + 'box-sizing:border-box!important;margin:0!important;padding:0!important;align-items:center!important;'
    + 'justify-content:center!important;border-radius:50%!important;color:#FFB52E!important;'
    + `font:600 17px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;cursor:pointer!important;`
    + `user-select:none!important;-webkit-user-select:none!important;${surface}}`
    // The panel opens above the button, left edges in line; the button never moves.
    + `#${id}>span{display:none!important;position:fixed!important;left:${left}!important;right:auto!important;`
    + 'bottom:52px!important;top:auto!important;z-index:2147483647!important;flex-direction:column!important;'
    + 'gap:4px!important;box-sizing:border-box!important;margin:0!important;padding:10px 14px!important;'
    + `max-width:min(320px,calc(100vw - 24px))!important;border-radius:14px!important;color:#fff!important;${surface}`
    + `font-size:13px!important;line-height:1.35!important;${font}text-align:left!important}`
    // The 8px between panel and button, made hoverable, so the pointer reaches the link.
    + `#${id}>span::after{content:""!important;position:absolute!important;left:0!important;right:0!important;`
    + 'top:100%!important;height:10px!important}'
    + `#${id}:hover>span,#${id}:focus-within>span,#${id} input:checked~span{display:flex!important}`
    + `#${id} b{font-weight:600!important;color:#fff!important}`
    + `#${id} small{font-size:12px!important;opacity:.75!important;font-weight:500!important}`
    + `#${id} a{color:#FFB52E!important;text-decoration:underline!important;font-weight:600!important;font-size:13px!important}`
    + `#${id} input:focus-visible~label{outline:2px solid #FFB52E!important;outline-offset:2px!important}`;

  // Opening this panel closes the other two on the row, opening one of them closes this one, and a
  // tap outside closes this one. Only checkboxes change, so nothing re-renders.
  const script = '(function(){var M="aimeat-ai-use-open",O=["aimeat-ai-label-open","aimeat-app-badge-open"];'
    + 'function g(i){return document.getElementById(i);}'
    + 'document.addEventListener("change",function(v){var t=v.target;if(!t||!t.checked)return;'
    + 'if(t.id===M){O.forEach(function(i){var x=g(i);if(x)x.checked=false;});}'
    + 'else if(O.indexOf(t.id)>=0){var m=g(M);if(m)m.checked=false;}},true);'
    + 'document.addEventListener("pointerdown",function(v){var m=g(M),w=g("aimeat-ai-use");'
    + 'if(m&&m.checked&&w&&!w.contains(v.target))m.checked=false;},true);})();';

  // A span, never a div, inside the block: the publish strip ends this block at its first `</div>`.
  return `<div ${AI_USE_MARK}>`
    + `<style>${css}</style>`
    + `<input type="checkbox" id="${id}-open">`
    + `<label for="${id}-open" aria-label="${entities(spec.open)}">${PLUG}</label>`
    + `<span role="group"><b>${entities(spec.title)}</b><small>${entities(spec.counts)}</small>`
    + `<a href="${escapeHtml(spec.guideUrl)}" target="_blank" rel="noopener">${entities(spec.link)}</a></span>`
    + `<script>${script}</script>`
    + '</div>';
}
