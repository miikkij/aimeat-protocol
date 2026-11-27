/**
 * @file scripts/cold-agent/bench-measure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two measures the Atelier build bench adds to what `app-quality.ts` reads: what a
 *   published page wrote by hand although the node serves it, and what the build's publishes cost.
 *   Pure: a page's text or a list of tool calls in, facts out.
 *
 *   WHAT COUNTS AS BY HAND. A function of the page's own that does the work the node serves: a
 *   translation function that does not call the kit's, a DOM helper, a toast that does not call the
 *   kit's, a clipboard call, an HTML escape, a REST call written into the page. A function that
 *   only passes its arguments on to the kit is the kit in use, under a shorter name.
 *
 *   The first version did not make that difference, and it was wrong on every page of the first
 *   baseline round: `var t = function (k, v) { return i18n.t(k, v); }` counted as a translation
 *   function of the page's own, a `failToast` that calls the kit's toast as a toast of its own, and
 *   any `load` or `save` function that reaches `AIMEAT.data` as a storage wrapper. Read by hand,
 *   the five pages held one hand-made thing between them, a five-line DOM helper. The storage
 *   habit is gone from the measure: an app's own function that calls the data library is ordinary
 *   code, and no pattern tells it from a wrapper.
 *
 *   The patterns are regular expressions over the page's text. They find a habit, not a defect: a
 *   page may have a good reason for one of them, and a count is compared between two rounds of the
 *   same brief, never judged alone. Read a page before repeating its count as a finding.
 * @structure HandMade · handMade() · handMadeCount() · HAND_MADE_HABITS · PublishTrace · publishTrace()
 * @usage
 *   import { handMade, publishTrace } from './bench-measure.js';
 * @version-history
 *   v1.1.0 — 2026-11-27 — A function that calls the kit's own is not by hand (translation, toast),
 *     and the storage habit is removed: six habits, not seven.
 *   v1.0.0 — 2026-11-27 — Initial, for the Atelier build bench (bench.ts).
 */
import type { ToolCall } from './transcript.js';

export interface HandMade {
    /** A translation function of its own: named `t`, and not passing the work on to an `i18n.t`. */
    ownT: boolean;
    /** A DOM helper of its own (`el` or `h`). */
    ownEl: boolean;
    /** A toast function of its own: one that does not call the kit's `toast`. */
    ownToast: boolean;
    /** `navigator.clipboard.writeText` called by the page, where the kit has `copy`. */
    ownClipboard: boolean;
    /** An HTML escape function of its own, where the node serves `AIMEAT.escapeHtml`. */
    ownEsc: boolean;
    /** `fetch('/v1/…')` written in the page, where a served library has the call. */
    rawFetch: boolean;
    createElement: number;
    innerHtml: number;
    /** Characters inside the page's own `<style>` blocks, and their share of the page. */
    styleChars: number;
    styleShare: number;
}

/** The habits `handMadeCount` counts, in the order a report names them. */
export const HAND_MADE_HABITS = ['ownT', 'ownEl', 'ownToast', 'ownClipboard', 'ownEsc', 'rawFetch'] as const;

/** How much of a function is read after its opening to see whether it passes the work on. */
const BODY_CHARS = 320;

/** Is some match of `open` followed, within one function body's length, by no call matching `passesOn`? */
function definesOwn(html: string, open: RegExp, passesOn: RegExp): boolean {
    for (const m of html.matchAll(open)) {
        if (!passesOn.test(html.slice(m.index, m.index + BODY_CHARS))) return true;
    }
    return false;
}

const T_OPEN = /function\s+t\s*\(|(?:const|let|var)\s+t\s*=\s*(?:function\b|\(|[a-zA-Z_$][\w$]*\s*=>)/g;
const TOAST_OPEN = /function\s+\w*toast\w*\s*\(/gi;
const PATTERNS = {
    ownEl: /function\s+(?:el|h)\s*\(|(?:const|let|var)\s+(?:el|h)\s*=\s*(?:function\b|\()/,
    ownClipboard: /navigator\.clipboard\.writeText/,
    ownEsc: /function\s+esc(?:ape)?(?:Html)?\s*\(/,
    rawFetch: /fetch\(\s*[`'"][^`'"]*\/v1\//,
} as const;

/** What the page wrote by hand. An empty page answers all false and zero. */
export function handMade(html: string): HandMade {
    const styleChars = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).reduce((n, s) => n + s.length, 0);
    return {
        // `i18n.t(`, `I.t(`, `AIMEAT.atelier.i18n.t(`: any `.t(` call inside the body is the kit's.
        ownT: definesOwn(html, T_OPEN, /\.t\s*\(/),
        ownEl: PATTERNS.ownEl.test(html),
        ownToast: definesOwn(html, TOAST_OPEN, /\.toast\s*\(/),
        ownClipboard: PATTERNS.ownClipboard.test(html),
        ownEsc: PATTERNS.ownEsc.test(html),
        rawFetch: PATTERNS.rawFetch.test(html),
        createElement: (html.match(/document\.createElement\(/g) ?? []).length,
        innerHtml: (html.match(/\.innerHTML\s*=/g) ?? []).length,
        styleChars,
        styleShare: html.length ? styleChars / html.length : 0,
    };
}

/** How many of the six habits the page has: the one number two rounds of a brief are compared on. */
export function handMadeCount(h: HandMade): number {
    return HAND_MADE_HABITS.filter(k => h[k]).length;
}

export interface PublishTrace {
    /** Calls of a publish tool, refused ones included. */
    publishAttempts: number;
    /** Publish calls the node refused, with the code of each refusal in order. */
    publishRefusals: string[];
    /** Every refusal of a node tool, as `tool: CODE`, in order: where the node stopped the build. */
    refusals: string[];
    /** Shell commands whose answer was a refusal of the node: a builder with a shell may call a route with curl. */
    shellRefusals: string[];
    /** Node tool calls before the first publish attempt; null when the build never tried to publish. */
    callsBeforeFirstPublish: number | null;
    /** Calls of the node's tools (`aimeat_*`), and all tool calls. */
    nodeCalls: number;
    allCalls: number;
}

const PUBLISH = /^aimeat_app_(publish|draft_publish)$/;
/** The refusal's code when the answer names one, and the start of the answer otherwise. */
const codeOf = (text: string): string => /"code"\s*:\s*"([A-Z0-9_]+)"/.exec(text)?.[1] ?? /\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/.exec(text)?.[1]
    ?? (text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'no text');

/** What the build's tool calls say about its publishes and the node's refusals. */
export function publishTrace(calls: ToolCall[]): PublishTrace {
    const node = calls.filter(c => c.name.startsWith('aimeat_'));
    const firstPublish = node.findIndex(c => PUBLISH.test(c.name));
    return {
        publishAttempts: node.filter(c => PUBLISH.test(c.name)).length,
        publishRefusals: node.filter(c => PUBLISH.test(c.name) && c.isError).map(c => codeOf(c.resultHead)),
        refusals: node.filter(c => c.isError).map(c => `${c.name}: ${codeOf(c.resultHead)}`),
        shellRefusals: calls.filter(c => c.name === 'Bash' && c.isError && /"code"\s*:\s*"[A-Z0-9_]+"/.test(c.resultHead)).map(c => codeOf(c.resultHead)),
        callsBeforeFirstPublish: firstPublish < 0 ? null : firstPublish,
        nodeCalls: node.length,
        allCalls: calls.length,
    };
}
