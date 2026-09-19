/**
 * @file src/services/app-hand-rolled.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a publish says when an app does by hand what a library of this node does.
 *
 *   The artifact lint names a library that is LOADED and never used. The opposite went unnamed,
 *   and it is the one that costs: a builder that never learned the node has a voice library
 *   writes its own recognition loop, one that never learned about aimeat-data posts to /v1/memory
 *   itself, and both work on the day they ship. The developer asked on 2026-09-19 whether builders
 *   use the libraries or write everything themselves; two live apps checked that day did use
 *   them, and nothing on the node would have said so if they had not.
 *
 *   HOW IT STAYS QUIET. A rule fires only when the app touches the browser API AND loads none of
 *   the libraries that would have done it; loading the library silences the rule, because the
 *   library's own page code may need the same API. Comments and string literals are taken out
 *   before anything is matched, so the word in a label or a note is not a use. Storage in the
 *   browser fires only from the third key on: a draft and a preference are not a store.
 *
 *   ONE hint that lists what it found, never one per rule, and always a WARNING: every one of
 *   these has a legitimate use somewhere, and the builder is told which library to look at, not
 *   that it may not publish.
 * @structure HAND_ROLLED_RULES · handRolledFindings(html)
 * @usage const hints = handRolledFindings(html);
 * @version-history
 *   v1.1.0 — 2026-09-19 — A chart drawn in code on a page that loads the Atelier kit. NOT a genre's
 *     own drawing: the first reading of three measured builds called their bar strip hand-drawn, and
 *     it was the almanac genre's own `.bars`, kept as a fork should keep it. So the rule is quiet for
 *     bars made of plain elements and for any genre that draws in SVG or canvas itself.
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import type { AppArtifactFinding } from './app-artifact-lint.js';
import { GENRE_BODIES } from '../data/app-templates/genres.js';

const PITFALL = 'hand-rolled';

interface Rule {
  /** What the app is doing, as a builder would say it. */
  what: string;
  test: RegExp;
  /** Loading any of these silences the rule. */
  libs: string[];
  /** The rule looks for an ADDRESS, so it has to see the string literals the other rules must not. */
  address?: boolean;
  /** What to say instead of "`<lib>` does this", when the answer is not a library to load. */
  instead?: string;
}

export const HAND_ROLLED_RULES: Rule[] = [
  { what: 'speech recognition or speech synthesis through the browser\'s own API', test: /\b(?:webkit)?SpeechRecognition\b|\bspeechSynthesis\b/, libs: ['aimeat-voice', 'aimeat-speech'] },
  { what: 'recording through `MediaRecorder`', test: /\bnew\s+MediaRecorder\s*\(/, libs: ['aimeat-voice', 'aimeat-speech'] },
  { what: 'an audio graph through `AudioContext`', test: /\bnew\s+(?:window\.)?(?:webkit)?AudioContext\s*\(/, libs: ['aimeat-audio', 'aimeat-voice', 'aimeat-speech', 'aimeat-phaser', 'aimeat-game'] },
  { what: 'memory read or written with `fetch` to `/v1/memory`', test: /fetch\s*\([^)]{0,120}\/v1\/memory\b/, address: true, libs: ['aimeat-data', 'aimeat-atelier', 'aimeat-living'] },
  { what: 'a model called with `fetch` to `/v1/ai/`', test: /fetch\s*\([^)]{0,120}\/v1\/ai\//, address: true, libs: ['aimeat-ai', 'aimeat-voice', 'aimeat-decide'] },
  { what: 'files sent with `fetch` to `/v1/storage`', test: /fetch\s*\([^)]{0,120}\/v1\/storage\b/, address: true, libs: ['aimeat-storage', 'aimeat-assets'] },
  { what: 'a live stream opened with `EventSource` or `WebSocket` to this node', test: /\bnew\s+(?:EventSource|WebSocket)\s*\([^)]{0,120}\/v1\//, address: true, libs: ['aimeat-live', 'aimeat-agents', 'aimeat-tunnel'] },
  { what: 'a notification through `new Notification(`', test: /\bnew\s+Notification\s*\(/, libs: ['aimeat-push'] },
  {
    // `auth.setLang`, which moves the PLATFORM's language, and not `i18n.setLang`, which a page
    // calls at start to bring the kit into step with it: a live app does exactly that
    // (`A.i18n.setLang(AIMEAT.auth.getLang())`) and the first version of this rule flagged it.
    what: 'a language control of its own (`auth.setLang(` called from the page)', test: /\bauth\s*\.\s*setLang\s*\(/i, libs: [],
    instead: 'the sign-in bar carries the language switch (`AIMEAT.auth.mountLoginButton`, or the Atelier shell): declare `aimeat-locales` with two languages and repaint on the change',
  },
];

/** The page's inline scripts, with comments and string literals blanked, so only CODE is matched. */
function codeOf(html: string): string {
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
  return scripts
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1 ');
}

/** `fetch("/v1/memory")` needs its string, `"Uses AudioContext"` must lose its own: strings go only for the word rules. */
function withoutStrings(code: string): string {
  return code.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

const loaded = (html: string, lib: string): boolean => html.includes(`/v1/libs/${lib}.js`) || html.includes(`/v1/libs/${lib}?`);

export function handRolledFindings(html: string): AppArtifactFinding[] {
  const code = codeOf(html);
  if (!code.trim()) return [];
  const bare = withoutStrings(code);
  const found: string[] = [];
  for (const rule of HAND_ROLLED_RULES) {
    if (rule.libs.some(l => loaded(html, l))) continue;
    const hay = rule.address ? code : bare;
    if (!rule.test.test(hay)) continue;
    found.push(`${rule.what}: ${rule.instead ?? rule.libs.slice(0, 2).map(l => '`' + l + '`').join(' or ') + ' does this'}`);
  }
  // A chart built in code, on a page that loads the kit and never calls its chart or its gauge.
  // Quiet when the forked genre draws in SVG or canvas itself: keeping the genre's drawing is the
  // point of a fork, and the kit's chart would wear the default look inside it.
  if (loaded(html, 'aimeat-atelier') && /createElementNS\s*\([^)]*\)|\.getContext\s*\(/.test(bare)
    && /createElementNS\s*\([^)]{0,80}["'](?:rect|polyline|path|circle|line)["']|getContext\s*\(\s*["']2d["']/.test(code)
    && !/\.(?:chart|gauge|radar)\s*\(/.test(bare)) {
    const genre = /<meta\b[^>]*name\s*=\s*["']aimeat-register["'][^>]*content\s*=\s*["']genre-([a-z0-9-]+)["']/i.exec(html.slice(0, 8192))?.[1];
    const genreDraws = genre ? /<svg|createElementNS|getContext\(/.test((GENRE_BODIES as Record<string, string>)[genre] ?? '') : false;
    if (!genreDraws) {
      found.push('a chart drawn in code (SVG shapes or a 2d canvas) while the kit is loaded: `AIMEAT.atelier.chart` draws bars, lines, areas, donuts, scatter and sparklines in the page\'s own tokens and follows the theme, and `gauge` and `radar` are beside it');
    }
  }
  // A draft and a preference are not a store; a third key is.
  const keys = new Set([...code.matchAll(/\blocalStorage\.setItem\s*\(\s*(["'`])([^"'`]+)\1/g)].map(m => m[2]));
  if (keys.size >= 3 && !loaded(html, 'aimeat-data')) {
    found.push(`${keys.size} different keys kept in \`localStorage\`, which stays on one device and is lost with it: \`aimeat-data\` keeps a person's data on their node, one record per thing`);
  }
  if (!found.length) return [];
  return [{
    pitfall: PITFALL,
    severity: 'warn',
    message: 'This app does by hand what a library of this node already does: ' + found.join('; ') + '. '
      + 'A library follows the platform when it changes, and your own copy does not. `GET /v1/libs` (or part `libraries` of the build '
      + 'specification) lists every library with what it is for; read that list before you write a mechanism. If the hand-written one '
      + 'is deliberate, say why to the owner.',
    url: `/v1/appdev/pitfalls/${PITFALL}`,
  }];
}
