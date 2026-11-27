/**
 * @file scripts/cold-agent/bench-measure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two measures the Atelier build bench adds to what `app-quality.ts` reads: what a
 *   published page wrote by hand although the node serves it, and what the build's publishes cost.
 *   Pure: a page's text or a list of tool calls in, facts out.
 *
 *   WHY THESE. On 2026-11-27 the app repository was read with the same patterns: of 133 Atelier
 *   apps, three in four defined a translation function of their own, about half a DOM helper of
 *   their own, a third called the node's REST routes directly, and the share did not fall from
 *   September to November. A change to the kit or to the build specification is meant to move
 *   these numbers, so the bench reads them from every measured build with the patterns that
 *   measurement used.
 *
 *   The patterns are regular expressions over the page's text. They find a habit, not a defect: a
 *   page may have a good reason for one of them, and a count is compared between two rounds of the
 *   same brief, never judged alone.
 * @structure HandMade · handMade() · handMadeCount() · PublishTrace · publishTrace()
 * @usage
 *   import { handMade, publishTrace } from './bench-measure.js';
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial, for the Atelier build bench (bench.ts).
 */
import type { ToolCall } from './transcript.js';

export interface HandMade {
    /** A translation function of its own (`function t(` or `const t = …`). */
    ownT: boolean;
    /** A DOM helper of its own (`el` or `h`). */
    ownEl: boolean;
    /** A toast function of its own. */
    ownToast: boolean;
    /** `navigator.clipboard.writeText` called by the page, where the kit has `copy`. */
    ownClipboard: boolean;
    /** An HTML escape function of its own, where the node serves `AIMEAT.escapeHtml`. */
    ownEsc: boolean;
    /** `fetch('/v1/…')` written in the page, where a served library has the call. */
    rawFetch: boolean;
    /** A load or save function of its own around `AIMEAT.data.get` or `set`. */
    dataWrapper: boolean;
    createElement: number;
    innerHtml: number;
    /** Characters inside the page's own `<style>` blocks, and their share of the page. */
    styleChars: number;
    styleShare: number;
}

const PATTERNS = {
    ownT: /function\s+t\s*\(|(?:const|let|var)\s+t\s*=\s*(?:function\b|\(|[a-zA-Z_$][\w$]*\s*=>)/,
    ownEl: /function\s+(?:el|h)\s*\(|(?:const|let|var)\s+(?:el|h)\s*=\s*(?:function\b|\()/,
    ownToast: /function\s+\w*toast\w*\s*\(/i,
    ownClipboard: /navigator\.clipboard\.writeText/,
    ownEsc: /function\s+esc(?:ape)?(?:Html)?\s*\(/,
    rawFetch: /fetch\(\s*[`'"][^`'"]*\/v1\//,
    dataWrapper: /function\s+\w*(?:load|save|read|write|store|persist)\w*\s*\([^)]*\)\s*\{[^}]{0,300}AIMEAT\.data\.(?:get|set)/i,
} as const;

/** What the page wrote by hand. An empty page answers all false and zero. */
export function handMade(html: string): HandMade {
    const styleChars = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).reduce((n, s) => n + s.length, 0);
    return {
        ownT: PATTERNS.ownT.test(html),
        ownEl: PATTERNS.ownEl.test(html),
        ownToast: PATTERNS.ownToast.test(html),
        ownClipboard: PATTERNS.ownClipboard.test(html),
        ownEsc: PATTERNS.ownEsc.test(html),
        rawFetch: PATTERNS.rawFetch.test(html),
        dataWrapper: PATTERNS.dataWrapper.test(html),
        createElement: (html.match(/document\.createElement\(/g) ?? []).length,
        innerHtml: (html.match(/\.innerHTML\s*=/g) ?? []).length,
        styleChars,
        styleShare: html.length ? styleChars / html.length : 0,
    };
}

/** How many of the seven habits the page has: the one number two rounds of a brief are compared on. */
export function handMadeCount(h: HandMade): number {
    return [h.ownT, h.ownEl, h.ownToast, h.ownClipboard, h.ownEsc, h.rawFetch, h.dataWrapper].filter(Boolean).length;
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
