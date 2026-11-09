/**
 * @file scripts/lib/blocker-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Parses the network rules of an Adblock Plus style filter list (EasyList, EasyPrivacy,
 *   uBlock Origin's own lists) and answers whether a first-party URL on this node would be blocked.
 *   Used by scripts/check-blocked-names.ts.
 *
 *   WHAT IT READS. Network rules only: cosmetic rules (`##`, `#@#`, `#?#`, `#$#`, `#%#`, `#+js`),
 *   comments and headers are dropped. Exception rules (`@@`) are dropped too, so the answer errs
 *   towards "blocked": a file name an exception happens to rescue on one list is still a name that
 *   another list may block.
 *
 *   WHICH RULES APPLY TO US. A served file of this node is a FIRST-PARTY request on the node's own
 *   host. So a rule marked `third-party` (`3p`) never applies, a rule limited to listed domains
 *   (`domain=` / `from=` with a positive entry) applies only when the entry covers the host, and a
 *   rule limited to resource types applies only when the file's type is among them. Rules that do
 *   not block a request (`removeparam`, `csp`, `header`, `permissions`, `replace`, `urltransform`,
 *   `badfilter`, `popup`, the hide options) are dropped.
 *
 *   SPEED. About 80 000 rules against about 2 000 files: each rule keeps its longest literal run,
 *   and the regular expression is tried only on a URL that contains that run.
 * @structure parseRules(text) · blockingRule(url, type, rules, host) · resourceType(path)
 * @usage
 *   const rules = parseRules(listText);
 *   blockingRule('https://aimeat.io/components/X.js?v=1', 'script', rules, 'aimeat.io') // → rule or null
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial. Written after EasyPrivacy's `/fingerprint.js^` blocked
 *     /components/Fingerprint.js and with it the admin page and the Contexts page.
 */

export type ResourceType = 'script' | 'stylesheet' | 'image' | 'font' | 'media' | 'xmlhttprequest' | 'other';

export interface Rule {
    /** The rule as the list wrote it, for the report. */
    text: string;
    /** Lower-cased literal run the URL must contain before the regex is tried ('' when none). */
    literal: string;
    re: RegExp;
    /** Types the rule is limited to; empty means all. */
    types: Set<string>;
    /** Types the rule excludes (`~script`). */
    notTypes: Set<string>;
    /** Positive domains the rule is limited to; empty means everywhere. */
    domains: string[];
    /** Negated domains (`domain=~github.com`). */
    notDomains: string[];
}

const COSMETIC = /#[@?$%]?#|#\+js/;
/** An option list: `name`, `~name` or `name=value`, comma-separated. A regex's `$/` never matches. */
const OPTIONS = /^~?[a-z0-9_-]+(=[^,]*)?(,~?[a-z0-9_-]+(=[^,]*)?)*$/i;
const NON_BLOCKING = new Set(['removeparam', 'csp', 'header', 'permissions', 'replace', 'urltransform',
    'uritransform', 'badfilter', 'popup', 'popunder', 'elemhide', 'ehide', 'generichide', 'ghide',
    'specifichide', 'shide', 'genericblock', 'document', 'doc', 'subdocument', 'frame', 'ping',
    'websocket', 'object', 'webrtc', 'cname', 'inline-script', 'inline-font', 'to']);
const TYPE_ALIASES: Record<string, string> = {
    script: 'script', stylesheet: 'stylesheet', css: 'stylesheet', image: 'image', font: 'font',
    media: 'media', xmlhttprequest: 'xmlhttprequest', xhr: 'xmlhttprequest', other: 'other',
};

/** The resource type a browser gives a request for this file, read from its extension. */
export function resourceType(path: string): ResourceType {
    const ext = path.toLowerCase().split('.').pop() ?? '';
    if (ext === 'js' || ext === 'mjs') return 'script';
    if (ext === 'css') return 'stylesheet';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif', 'bmp'].includes(ext)) return 'image';
    if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'font';
    if (['mp3', 'mp4', 'webm', 'ogg', 'wav', 'm4a', 'opus'].includes(ext)) return 'media';
    if (ext === 'json') return 'xmlhttprequest';
    return 'other';
}

/** Splits `pattern$options`, telling an options `$` from a regex's end anchor. */
function splitOptions(line: string): [string, string] {
    const i = line.lastIndexOf('$');
    if (i > 0 && OPTIONS.test(line.slice(i + 1))) return [line.slice(0, i), line.slice(i + 1)];
    return [line, ''];
}

function escapeRe(s: string): string {
    return s.replace(/[.+?${}()[\]\\/]/g, '\\$&');
}

/** The pattern as a regular expression, Adblock Plus syntax. */
function patternToRegex(pattern: string, matchCase: boolean): RegExp | null {
    const flags = matchCase ? '' : 'i';
    if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
        try { return new RegExp(pattern.slice(1, -1), flags); } catch { return null; }
    }
    let p = pattern;
    let head = '';
    let tail = '';
    if (p.startsWith('||')) { head = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^/?#]*\\.)?'; p = p.slice(2); }
    else if (p.startsWith('|')) { head = '^'; p = p.slice(1); }
    if (p.endsWith('|')) { tail = '$'; p = p.slice(0, -1); }
    const body = p.split('').map((c) => {
        if (c === '*') return '.*';
        if (c === '^') return '(?:[^\\w.%-]|$)';
        return escapeRe(c);
    }).join('');
    try { return new RegExp(head + body + tail, flags); } catch { return null; }
}

/** Longest run of characters the URL must contain literally. */
function longestLiteral(pattern: string): string {
    if (pattern.startsWith('/') && pattern.endsWith('/')) return '';
    let best = '';
    for (const run of pattern.replace(/^\|\|?/, '').replace(/\|$/, '').split(/[*^]/)) if (run.length > best.length) best = run;
    return best.toLowerCase();
}

/** Every network rule in a filter list's text. */
export function parseRules(text: string): Rule[] {
    const rules: Rule[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('!') || line.startsWith('[') || line.startsWith('@@') || COSMETIC.test(line)) continue;
        const [pattern, optText] = splitOptions(line);
        if (!pattern || pattern === '*' || pattern === '|' || pattern === '||') continue;
        const types = new Set<string>();
        const notTypes = new Set<string>();
        const domains: string[] = [];
        const notDomains: string[] = [];
        let matchCase = false;
        let skip = false;
        for (const opt of optText ? optText.split(',') : []) {
            const [nameRaw, value = ''] = opt.split('=');
            const negated = nameRaw.startsWith('~');
            const name = nameRaw.replace(/^~/, '').toLowerCase();
            if (name === 'third-party' || name === '3p') { if (!negated) skip = true; continue; }
            if (name === 'first-party' || name === '1p') { if (negated) skip = true; continue; }
            if (name === 'match-case') { matchCase = true; continue; }
            if (name === 'domain' || name === 'from') {
                for (const d of value.split('|').filter(Boolean)) (d.startsWith('~') ? notDomains : domains).push(d.replace(/^~/, '').toLowerCase());
                continue;
            }
            if (NON_BLOCKING.has(name)) { skip = true; continue; }
            const type = TYPE_ALIASES[name];
            if (type) (negated ? notTypes : types).add(type);
            // Anything else (important, redirect, all, denyallow, rewrite …) does not change whether
            // a first-party request is blocked, or blocks it anyway.
        }
        if (skip) continue;
        const re = patternToRegex(pattern, matchCase);
        if (!re) continue;
        rules.push({ text: line, literal: matchCase ? '' : longestLiteral(pattern), re, types, notTypes, domains, notDomains });
    }
    return rules;
}

function coversHost(domain: string, host: string): boolean {
    return host === domain || host.endsWith(`.${domain}`);
}

/** The first rule that would block this first-party request, or null. */
export function blockingRule(url: string, type: ResourceType, rules: Rule[], host: string): Rule | null {
    const lower = url.toLowerCase();
    for (const r of rules) {
        if (r.literal && !lower.includes(r.literal)) continue;
        if (r.types.size && !r.types.has(type)) continue;
        if (r.notTypes.has(type)) continue;
        if (r.domains.length && !r.domains.some((d) => coversHost(d, host))) continue;
        if (r.notDomains.some((d) => coversHost(d, host))) continue;
        if (r.re.test(url)) return r;
    }
    return null;
}
