/**
 * @file auth/modal-styles.js
 * @description The sign-in modal's stylesheet, in the poster face the home, the front page and the
 *   profile wear: the wordmark and the node's domain as a crumb, the sentence as a masthead in the
 *   poster face, a 3px ink frame with the sun's offset shadow, underlined fields, small coral labels,
 *   the open tab on the sun, one ink slab for the loud action and an underlined word for the quiet
 *   one. Every colour and face is a page token with a fallback, the same rule the pill follows in
 *   theme.js, so the modal is ink on paper in the shell, light on a dark page, and whatever a
 *   palette says on an app origin. Class-based: nothing in modal.js is styled inline.
 * @structure MODAL_CSS (one string, injected by modal.js into its own <style>).
 * @usage import { MODAL_CSS } from './modal-styles.js';
 * @version-history
 *   v1.2.0 — 2026-08-29 — The wordmark reads --font-wordmark (Archivo Black) rather than the headline
 *     face, and the headline reads the poster tracking and leading tokens, so Fjalla One is set with
 *     the room it needs.
 *   v1.1.1 — 2026-08-29 — A hint and the username rules show only while the field has focus; leaving
 *     the field folds them away, so the form stays as short as its labels.
 *   v1.1.0 — 2026-08-29 — The close control (.aimeat-close): a 26px ink-framed X beside the language switch.
 *   v1.0.2 — 2026-08-29 — A field's hint waits for focus or a value (.has-value), so the create form is
 *     not a wall of small print.
 *   v1.0.1 — 2026-08-29 — Ink and paper through ink.js, so the fallback follows the theme on an app
 *     page that named --text but not --bg.
 *   v1.0.0 — 2026-08-29 — Extracted from modal.js and redrawn on the design canvas "AIMEAT Sign-in
 *     Dialog" (headline-led): replaces the DM Sans, 10px radii and coral-gradient skin.
 */
import { inkVarsCss } from './ink.js';

// Ink and paper are defined on the scrim by ink.js: the page's --text / --bg first, then a
// fallback that follows the theme, so the dialog is never pale-on-pale on a dark app page.
var ink = 'var(--aimeat-ink)';
var paper = 'var(--aimeat-paper)';
var dim = 'var(--text-dim,#6B7280)';
var line = 'var(--border,#E5E7EB)';
var accent = 'var(--accent,#E8564A)';
var sun = 'var(--sun,#FFB52E)';
var onSun = 'var(--on-sun,#1A1A2E)';
var okc = 'var(--success-fg,#047857)';
var font = "var(--font-showroom-body,'Archivo','DM Sans',system-ui,sans-serif)";
var poster = "var(--font-poster,'Archivo Black','Archivo',system-ui,sans-serif)";
// The wordmark is a mark, not a headline: it keeps Archivo Black whatever face the headlines wear.
var wordmark = "var(--font-wordmark,'Archivo Black','Archivo',system-ui,sans-serif)";
var section = "var(--font-poster-section,'Archivo','DM Sans',system-ui,sans-serif)";
var mono = "var(--font-mono,'JetBrains Mono','SF Mono',monospace)";

export var MODAL_CSS = [
  inkVarsCss(['.aimeat-scrim']),
  '.aimeat-scrim{position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;',
    'align-items:flex-start;justify-content:center;overflow-y:auto;z-index:99999;padding:24px;font-family:' + font + '}',
  '.aimeat-dlg{background:' + paper + ';color:' + ink + ';border:3px solid ' + ink + ';box-shadow:12px 12px 0 ' + sun + ';',
    'max-width:420px;width:100%;margin:auto;box-sizing:border-box}',
  '.aimeat-dlg.aimeat-in{animation:aimeatModalIn .3s ease}',
  '@keyframes aimeatModalIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}',
  /* The head: the crumb, the masthead, the tabs. */
  '.aimeat-head{padding:22px 28px 0}',
  '.aimeat-crumb{display:flex;align-items:center;justify-content:space-between;gap:12px}',
  '.aimeat-brand{display:flex;align-items:baseline;gap:10px;min-width:0}',
  '.aimeat-mark{display:inline-flex;align-items:center;gap:1px;font-family:' + wordmark + ';font-weight:400;',
    'font-size:15px;letter-spacing:-.01em;line-height:1;color:' + ink + '}',
  '.aimeat-mark svg{width:13px;height:13px;fill:' + accent + '}',
  '.aimeat-mark b{font-weight:inherit;color:' + accent + '}',
  '.aimeat-host{font:400 12px/1 ' + mono + ';color:' + dim + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.aimeat-crumb-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}',
  '.aimeat-close{appearance:none;width:26px;height:26px;padding:0;margin:0;display:inline-flex;align-items:center;justify-content:center;',
    'border:2px solid ' + ink + ';background:transparent;color:' + ink + ';cursor:pointer;transition:color .12s,border-color .12s}',
  '.aimeat-close svg{width:12px;height:12px;stroke:currentColor;stroke-width:2.5;fill:none;stroke-linecap:square}',
  '.aimeat-close:hover{color:' + accent + ';border-color:' + accent + '}',
  '.aimeat-langsw{display:inline-flex;align-items:stretch;height:26px;flex:0 0 auto;border:2px solid ' + ink + '}',
  '.aimeat-lang{appearance:none;border:0;background:transparent;color:' + ink + ';opacity:.6;font:700 11px/1 ' + font + ';',
    'letter-spacing:.4px;padding:0 10px;margin:0;cursor:pointer;display:inline-flex;align-items:center;transition:opacity .12s}',
  '.aimeat-lang:hover{opacity:.9}',
  '.aimeat-lang.active{opacity:1;background:' + ink + ';color:' + paper + ';cursor:default}',
  '.aimeat-headline{margin:18px 0 0;font-family:' + poster + ';font-weight:var(--font-poster-weight,400);font-size:34px;',
    'line-height:var(--font-poster-leading,1);letter-spacing:var(--font-poster-tracking,.01em);color:' + ink + ';text-wrap:pretty}',
  '.aimeat-line{margin:10px 0 0;font-size:14px;line-height:1.5;font-weight:400;color:' + dim + '}',
  '.aimeat-tabs{display:flex;margin-top:18px;border-top:3px solid ' + ink + '}',
  '.aimeat-tab{appearance:none;flex:1;background:none;border:0;border-bottom:2px solid transparent;border-radius:0;padding:10px 12px;',
    'cursor:pointer;font:600 13px/1.4 ' + font + ';text-transform:uppercase;letter-spacing:.04em;color:' + dim + ';transition:color .15s}',
  '.aimeat-tab:hover{color:' + ink + '}',
  '.aimeat-tab.active{background:' + sun + ';color:' + onSun + ';border-bottom-color:' + ink + ';cursor:default}',
  /* The body and the sub-views share one padding; fields are underlines. */
  '.aimeat-body{padding:22px 28px 26px}',
  '.aimeat-field{margin-bottom:18px}',
  '.aimeat-label{display:flex;align-items:baseline;gap:8px;margin:0 0 2px;font:700 11.5px/1.4 ' + font + ';',
    'letter-spacing:.1em;text-transform:uppercase;color:' + accent + '}',
  '.aimeat-opt{font:400 11px/1.4 ' + mono + ';letter-spacing:0;text-transform:none;color:' + dim + '}',
  '.aimeat-inp{display:block;width:100%;box-sizing:border-box;background:transparent;border:0;border-bottom:3px solid ' + ink + ';',
    'border-radius:0;padding:9px 0;font:400 16px/1.4 ' + font + ';color:' + ink + ';outline:none;transition:border-color .15s}',
  '.aimeat-inp:focus{border-bottom-color:' + accent + '}',
  '.aimeat-inp::placeholder{color:' + dim + ';font-weight:600}',
  /* A field's hint waits until the person is in that field or has written in it, so the form
     reads as four labels and four lines until one of them is being filled. */
  '.aimeat-hint{margin:7px 0 0;font:400 12.5px/1.45 ' + font + ';color:' + dim + '}',
  '.aimeat-field .aimeat-hint{display:none}',
  '.aimeat-field:focus-within .aimeat-hint{display:block}',
  /* The username rules: shown only while the person is in the field and has typed something,
     each turning green as it is met; leaving the field folds them away again. */
  '.aimeat-rules{display:none;margin-top:8px;flex-direction:column;gap:3px}',
  '.aimeat-field:focus-within .aimeat-rules.on{display:flex}',
  '.aimeat-rule{display:flex;align-items:center;gap:7px;font:400 12.5px/1.45 ' + font + ';color:' + dim + '}',
  '.aimeat-rule svg{width:12px;height:12px;flex:0 0 auto}',
  '.aimeat-rule .r-ok{display:none}',
  '.aimeat-rule.ok{color:' + okc + '}',
  '.aimeat-rule.ok .r-ok{display:block}',
  '.aimeat-rule.ok .r-no{display:none}',
  /* The loud action is an ink slab; the quiet ones are underlined words. */
  '.aimeat-actions{display:flex;align-items:center;gap:22px;margin-top:4px}',
  '.aimeat-go{appearance:none;background:' + ink + ';color:' + paper + ';border:0;border-radius:0;padding:13px 20px;cursor:pointer;',
    'font:600 13px/1.4 ' + font + ';text-transform:uppercase;letter-spacing:.04em;box-shadow:4px 4px 0 ' + sun + ';',
    'transition:transform .12s,box-shadow .12s}',
  '.aimeat-go:hover{transform:translate(2px,2px);box-shadow:2px 2px 0 ' + sun + '}',
  '.aimeat-go:disabled{opacity:.45;transform:none;cursor:default}',
  '.aimeat-cancel{appearance:none;background:none;border:0;border-bottom:2px solid ' + ink + ';border-radius:0;padding:0 0 1px;',
    'cursor:pointer;font:600 12.5px/1.5 ' + font + ';text-transform:uppercase;letter-spacing:.04em;color:' + ink + '}',
  '.aimeat-cancel:hover{color:' + accent + ';border-bottom-color:' + accent + '}',
  '.aimeat-links{display:flex;align-items:center;gap:18px;margin-top:16px}',
  '.aimeat-link{font:600 11.5px/1.5 ' + font + ';text-transform:uppercase;letter-spacing:.04em;color:' + dim + ';',
    'text-decoration:none;border-bottom:2px solid ' + dim + ';padding-bottom:1px;cursor:pointer}',
  '.aimeat-link:hover{color:' + accent + ';border-bottom-color:' + accent + '}',
  '.aimeat-err{margin:10px 0 0;font:600 13px/1.45 ' + font + ';color:' + accent + ';display:none}',
  '.aimeat-msg{margin:10px 0 0;font:600 13px/1.45 ' + font + ';color:' + okc + ';display:none}',
  /* Social sign-in: a mono "or" between hairlines, then ink-framed boxes. */
  '.aimeat-or{display:flex;align-items:center;gap:12px;margin:22px 0 18px}',
  '.aimeat-or span{flex:1;height:1px;background:' + line + '}',
  '.aimeat-or b{flex:0 0 auto;font:500 11px/1 ' + mono + ';letter-spacing:.1em;text-transform:uppercase;color:' + accent + '}',
  '.aimeat-oauth-btn{appearance:none;width:100%;box-sizing:border-box;min-height:44px;display:flex;align-items:center;justify-content:center;',
    'gap:10px;margin-bottom:8px;padding:8px 12px;background:transparent;border:2px solid ' + ink + ';border-radius:0;color:' + ink + ';',
    'cursor:pointer;font:600 14px/1.2 ' + font + ';transition:border-color .15s,color .15s}',
  '.aimeat-oauth-btn:hover{border-color:' + accent + ';color:' + accent + '}',
  /* The sub-views (reset, recover, email code) open with a section headline. */
  '.aimeat-sub-title{margin:0 0 8px;font-family:' + section + ';font-weight:var(--font-poster-section-weight,400);font-size:21px;',
    'line-height:.95;text-transform:uppercase;letter-spacing:-.02em;color:' + ink + '}',
  '.aimeat-sub-desc{margin:0 0 16px;font:400 13.5px/1.5 ' + font + ';color:' + dim + '}',
  /* What you get: a numbered index under an ink rule, the last line in bold. */
  '.aimeat-why{padding:18px 28px 22px;border-top:3px solid ' + ink + '}',
  '.aimeat-why-title{margin:0 0 6px;font-family:' + section + ';font-weight:var(--font-poster-section-weight,400);font-size:21px;',
    'line-height:.95;text-transform:uppercase;letter-spacing:-.02em;color:' + ink + '}',
  '.aimeat-why-row{display:grid;grid-template-columns:28px minmax(0,1fr);gap:0 8px;align-items:baseline;padding:9px 0;',
    'border-bottom:1px solid ' + line + ';font:400 13.5px/1.45 ' + font + ';color:' + ink + '}',
  '.aimeat-why-row:last-child{border-bottom:0}',
  '.aimeat-why-row.strong{font-weight:600}',
  '.aimeat-why-num{font:400 12px/1.45 ' + mono + ';color:' + accent + '}',
].join('');
