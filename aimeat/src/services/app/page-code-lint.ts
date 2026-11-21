/**
 * @file src/services/app/page-code-lint.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Publish warnings for six page-code traps that app builders met and the appdev KB
 *   carried as advice, each read from the bytes at publish (pitfall round 2026-11-21, A8):
 *
 *     html-comment-closes-early      a `-->` inside a comment closes it, and the rest shows as text
 *     offline-parts-other-origin     an offline app loads a script, sheet or font from another address
 *     leaflet-l-shadowed             a page that loads Leaflet declares its own `L`
 *     keyframe-hides-under-less-motion  a kit page's keyframe ends hidden and holds its last frame
 *     body-first-child-is-node-block the page finds its root by position among the body's children
 *     session-fetch-parsed           session.fetch's answer read with `.json()`
 *
 *   ALL WARN, NONE BLOCKS, for the reason the artifact lint gives: each one has a page where it is
 *   right, and a publish that fails is a publish that gets worked around. Every reader scans with
 *   indexOf or a bounded pattern, never an unbounded one over the uploaded bytes (CodeQL
 *   js/polynomial-redos, the reason utils/html-blocks.ts exists).
 * @structure pageCodeFindings(html) · commentCloseFindings · offlineOriginFindings · leafletFindings ·
 *   keyframeHideFindings · bodyPositionFindings · sessionFetchFindings
 * @usage warnings.push(...pageCodeFindings(html));
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import type { AppArtifactFinding } from './artifact-lint.js';
import { elementBodies, withoutBlockComments } from '../../utils/html-blocks.js';

function finding(pitfall: string, message: string): AppArtifactFinding {
  return { pitfall, severity: 'warn', message, url: `/v1/appdev/pitfalls/${pitfall}` };
}

/** The page with every `<script>` and `<style>` body cut out, in one pass per tag. */
function withoutCodeBlocks(html: string): string {
  let out = html;
  for (const tag of ['script', 'style']) {
    const lower = out.toLowerCase();
    let kept = '';
    let at = 0;
    for (;;) {
      const open = lower.indexOf(`<${tag}`, at);
      if (open === -1) { kept += out.slice(at); break; }
      const gt = lower.indexOf('>', open);
      const close = gt === -1 ? -1 : lower.indexOf(`</${tag}`, gt + 1);
      if (close === -1) { kept += out.slice(at, open); break; }
      kept += out.slice(at, gt + 1);
      at = close;
    }
    out = kept;
  }
  return out;
}

/** The inline scripts' code, block comments blanked. */
function inlineCode(html: string): string {
  return withoutBlockComments(elementBodies(html, 'script', attrs => !/\bsrc\s*=/i.test(attrs)).join('\n'));
}

/**
 * A `-->` the page shows as text: what is left after every whole comment `<!-- … -->` is removed,
 * outside scripts and styles. A comment closes at its FIRST `-->`, so an arrow written inside one
 * ("draft-->review") ends it early and the rest of the comment reaches the page.
 */
export function commentCloseFindings(html: string): AppArtifactFinding[] {
  const text = withoutCodeBlocks(html);
  let rest = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('<!--', at);
    if (open === -1) { rest += text.slice(at); break; }
    rest += text.slice(at, open);
    const close = text.indexOf('-->', open + 4);
    if (close === -1) break;
    at = close + 3;
  }
  const stray = rest.indexOf('-->');
  if (stray === -1) return [];
  const before = rest.slice(Math.max(0, stray - 60), stray).replace(/\s+/g, ' ').trim();
  return [finding('html-comment-closes-early',
    `An HTML comment closes early: the page has a stray \`-->\` after "${before}". A comment ends at its FIRST \`-->\`, so an arrow `
    + 'written inside one (a relation such as draft-->review) closes it there, and everything after it shows on the live page as text. '
    + 'Write the relation in words inside a comment, and open the app signed out to read its body text once.')];
}

/** True when the head declares `<meta name="aimeat-offline">`. */
function declaresOffline(html: string): boolean {
  return /<meta\b[^>]{0,200}name\s*=\s*["']aimeat-offline["']/i.test(html.slice(0, 64 * 1024));
}

/**
 * An app that opens with no connection keeps only the parts served from its own address. A script,
 * a stylesheet or a font from anywhere else is left to the browser and is missing offline.
 */
export function offlineOriginFindings(html: string): AppArtifactFinding[] {
  if (!declaresOffline(html)) return [];
  const hosts = new Set<string>();
  const absolute = /^(?:https?:)?\/\//i;
  const tagRe = /<(script|link)\b([^>]{0,1000})>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = m[2];
    const isLink = m[1].toLowerCase() === 'link';
    if (isLink && !/\brel\s*=\s*["']?(?:stylesheet|preload|modulepreload)/i.test(attrs)) continue;
    const url = (isLink ? /\bhref\s*=\s*["']([^"']{1,500})["']/i : /\bsrc\s*=\s*["']([^"']{1,500})["']/i).exec(attrs)?.[1];
    if (url && absolute.test(url)) hosts.add(hostOf(url));
  }
  const css = elementBodies(html, 'style').join('\n');
  const urlRe = /url\(\s*["']?((?:https?:)?\/\/[^"')\s]{1,500})/gi;
  while ((m = urlRe.exec(css)) !== null) hosts.add(hostOf(m[1]));
  if (!hosts.size) return [];
  return [finding('offline-parts-other-origin',
    `This app declares \`aimeat-offline\` and loads parts from another address (${[...hosts].slice(0, 5).join(', ')}). `
    + 'The offline worker keeps only what is served from the app\'s own address, so those parts are missing when the app opens with no '
    + 'connection. Load every library, stylesheet and font with a path on this node (/lib/…, /v1/libs/…), never a full address.')];
}

function hostOf(url: string): string {
  return URL.canParse(url, 'https://x.invalid') ? new URL(url, 'https://x.invalid').host : url.slice(0, 60);
}

/**
 * A page that loads Leaflet and declares `L` of its own replaces the library's global, and every
 * `L.map` after it fails. Also a popup built from a template string with values in it.
 */
export function leafletFindings(html: string): AppArtifactFinding[] {
  if (!/\/lib\/leaflet@?\d*\//i.test(html)) return [];
  const code = inlineCode(html);
  const out: string[] = [];
  if (/(?:^|[\s;{(,])(?:var|let|const)\s+L\s*(?:=|;|,)/.test(code) || /\bfunction\s+L\s*\(/.test(code)) {
    out.push('the page declares a variable or function named `L`, which replaces Leaflet\'s own `L`: name yours anything else');
  }
  if (/\.bindPopup\s*\(\s*`[^`]{0,2000}\$\{/.test(code)) {
    out.push('a popup is built from a template string with values in it: escape each value with AIMEAT.escapeHtml or pass a DOM element, because a popup renders HTML');
  }
  if (!out.length) return [];
  return [finding('leaflet-l-shadowed', `This page loads Leaflet and ${out.join('; and ')}.`)];
}

/**
 * Under reduced motion or the kit's Less-motion switch every kit animation runs in 1 ms and holds
 * its last frame. A keyframe whose last frame hides the element (opacity 0, visibility hidden),
 * used with fill forwards or both, keeps that element hidden for its whole life.
 */
export function keyframeHideFindings(html: string): AppArtifactFinding[] {
  if (!/\/v1\/libs\/aimeat-atelier(?:\.js|\?)/.test(html)) return [];
  const css = elementBodies(html, 'style').join('\n');
  const hiding: string[] = [];
  const kfRe = /@keyframes\s+([\w-]{1,80})\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = kfRe.exec(css)) !== null) {
    const frame = lastFrame(blockAt(css, m.index + m[0].length));
    if (/opacity\s*:\s*0(?:\.0+)?\s*(?:;|$|!)/.test(frame) || /visibility\s*:\s*hidden/.test(frame)) hiding.push(m[1]);
  }
  if (!hiding.length) return [];
  const held = hiding.filter(name => ruleBodies(css).some(b =>
    new RegExp(`animation(?:-name)?\\s*:[^;}]{0,300}\\b${name.replace(/[-]/g, '\\-')}\\b`).test(b) && /\b(?:forwards|both)\b/.test(b)));
  if (!held.length) return [];
  return [finding('keyframe-hides-under-less-motion',
    `The keyframe${held.length > 1 ? 's' : ''} ${held.map(n => '`' + n + '`').join(', ')} end${held.length > 1 ? '' : 's'} hidden and `
    + 'hold their last frame (fill forwards or both). Under reduced motion, or the kit\'s Less-motion switch, the kit runs every animation in 1 ms, '
    + 'so the element is hidden at once and never seen. Keep the element visible in its own rule, let the keyframe only bring it in '
    + '(fill backwards), and take it away with a class and a transition. Check with reduced motion emulated and with '
    + 'document.documentElement.dataset.akMotion = "less".')];
}

/** The text of the block that starts at `from` (just after its `{`), braces balanced. */
function blockAt(css: string, from: number): string {
  let depth = 1;
  for (let i = from; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(from, i);
  }
  return css.slice(from);
}

/** The declarations of a keyframe's end state: the last frame whose selector names `to` or `100%`. */
function lastFrame(body: string): string {
  let found = '';
  let at = 0;
  for (;;) {
    const open = body.indexOf('{', at);
    if (open === -1) return found;
    const close = body.indexOf('}', open);
    if (close === -1) return found;
    const selectors = body.slice(at, open).split(',').map(s => s.trim().toLowerCase());
    if (selectors.includes('to') || selectors.includes('100%')) found = body.slice(open + 1, close);
    at = close + 1;
  }
}

/** Every innermost `{ … }` body of the stylesheet. */
function ruleBodies(css: string): string[] {
  const out: string[] = [];
  let open = -1;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') open = i;
    else if (css[i] === '}' && open !== -1) { out.push(css.slice(open + 1, i)); open = -1; }
  }
  return out;
}

/**
 * While a search-visible app's page loads, the node's name-and-description block is the body's
 * first child (utils/app-page-body.ts). Code that finds its root by position meets that block.
 */
export function bodyPositionFindings(html: string): AppArtifactFinding[] {
  const code = inlineCode(html);
  const css = elementBodies(html, 'style').join('\n');
  const byPosition = /document\.body\.(?:firstElementChild|firstChild|children\s*\[\s*0\s*\]|childNodes\s*\[\s*0\s*\])/.test(code)
    || /\bbody\s*>\s*(?:\*\s*)?:first-(?:child|of-type)/.test(css);
  if (!byPosition) return [];
  return [finding('body-first-child-is-node-block',
    'This page finds an element by its position among the body\'s children (document.body.firstElementChild, children[0] or '
    + 'body > :first-child). When the app\'s search visibility is on, the node opens the body with the app\'s name and description '
    + '(#aimeat-app-body) while the page loads, and removes it just before DOMContentLoaded: code that runs before then, and that CSS, '
    + 'meet the node\'s block. Find your root by id (document.getElementById("app")).')];
}

/**
 * session.fetch resolves to the node's parsed envelope ({ ok, data, error }), not a Response, so
 * `.json()` on it throws "json is not a function". Only a call to a node path on a variable other
 * than window counts: the browser's own fetch is a Response.
 */
export function sessionFetchFindings(html: string): AppArtifactFinding[] {
  const code = inlineCode(html);
  const hits = new Set<string>();
  const chained = /\b([A-Za-z_$][\w$]{0,40})\s*\.\s*fetch\s*\(\s*["'`]\/v1\/[^"'`\n]{0,200}["'`][^;]{0,300}?\.json\s*\(\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = chained.exec(code)) !== null) if (!GLOBAL_FETCH.has(m[1])) hits.add(m[1]);
  const assigned = /(?:const|let|var)\s+([A-Za-z_$][\w$]{0,40})\s*=\s*await\s+([A-Za-z_$][\w$]{0,40})\s*\.\s*fetch\s*\(\s*["'`]\/v1\//g;
  while ((m = assigned.exec(code)) !== null) {
    if (GLOBAL_FETCH.has(m[2])) continue;
    if (new RegExp(`\\b${m[1].replace(/\$/g, '\\$')}\\s*\\.\\s*json\\s*\\(`).test(code)) hits.add(m[2]);
  }
  if (!hits.size) return [];
  return [finding('session-fetch-parsed',
    `\`.json()\` is called on what ${[...hits].map(h => '`' + h + '.fetch`').join(', ')} answered. session.fetch resolves to the node's `
    + 'parsed envelope { ok, data, error }, not a Response, so .json() throws "json is not a function". Use the value as it is: check '
    + 'res.ok, read res.data, and show res.error.message when ok is false; a refusal does not throw.')];
}

const GLOBAL_FETCH = new Set(['window', 'self', 'globalThis']);

/** Every warning of this module, in one call for the artifact lint. */
export function pageCodeFindings(html: string): AppArtifactFinding[] {
  return [
    ...commentCloseFindings(html),
    ...offlineOriginFindings(html),
    ...leafletFindings(html),
    ...keyframeHideFindings(html),
    ...bodyPositionFindings(html),
    ...sessionFetchFindings(html),
  ];
}
