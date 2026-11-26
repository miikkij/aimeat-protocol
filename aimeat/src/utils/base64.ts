/**
 * @file base64.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Strict base64 decoder used by every inline-upload endpoint
 *   (POST /v1/apps, POST /v1/memory/files, POST /v1/storage, app screenshot).
 *   Wraps Node's `Buffer.from(str, 'base64')` with input validation because
 *   the built-in is permissive: it silently drops characters outside the
 *   base64 alphabet. A caller that mistakenly sends raw HTML, JSON, or
 *   binary therefore gets a successful upload with a tiny garbage payload,
 *   served back as 200 to downloaders with no diagnostic anywhere.
 *
 *   NO REGULAR EXPRESSION OVER THE WHOLE TEXT. The check was `/^[A-Za-z0-9+/_-]+={0,2}$/`. V8 may run
 *   such a pattern with one backtrack entry per character, and then throws RangeError "Maximum call
 *   stack size exceeded" at 4,194,304 characters: an inline upload of a file over about 3.1 MB
 *   answered 500 on aimeat.io. isBase64Text reads the text one character at a time instead, and the
 *   other base64 checks (secret shares, skill files, AI data URLs) use it too.
 * @structure
 *   - withoutWhitespace() -- the text with its whitespace removed
 *   - isBase64Text() -- the alphabet, then at most two `=`, read one character at a time
 *   - decodeStrictBase64() -- validate, then decode. Null on invalid input.
 * @usage
 *   import { decodeStrictBase64 } from '../utils/base64.js';
 *   const data = decodeStrictBase64(req.body.content);
 *   if (!data) {
 *     res.status(400).json(error(nodeId, 'INVALID_INPUT', 'content must be base64'));
 *     return;
 *   }
 * @version-history
 *   v1.1.0 -- 2026-11-26 -- isBase64Text and withoutWhitespace replace the whole-text regular
 *     expressions, which threw past 4 MiB characters (an inline upload of 3.2 MB answered 500). A
 *     value that is not a string answers null instead of throwing.
 *   v1.0.0 -- 2026-05-29 -- Initial utility. Added in response to a silent-
 *     corruption bug discovered while seeding the directory-submission
 *     reviewer account: raw HTML POSTed to /v1/apps was accepted as base64
 *     and stored as a 14-byte garbage buffer.
 */

/** 1 for a character of the standard alphabet, 2 for the URL-safe pair `-` and `_`, by char code. */
const ALPHABET: Uint8Array = (() => {
    const t = new Uint8Array(128);
    const standard = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let i = 0; i < standard.length; i++) t[standard.charCodeAt(i)] = 1;
    t[45] = 2; // -
    t[95] = 2; // _
    return t;
})();

const EQUALS = 61;

/**
 * `s` without whitespace. A single-character pattern, so a long run of whitespace is no backtracking;
 * the text is returned as it is when it holds none.
 */
export function withoutWhitespace(s: string): string {
    return /\s/.test(s) ? s.replace(/\s/g, '') : s;
}

/**
 * Whether `s` is base64 text: at least one character of the alphabet (with `-` and `_` unless
 * `urlSafe` is false), and `=` only as the last one or two characters. With `padding: 'anywhere'`,
 * `=` may stand anywhere, as a data URL's check allowed. Whitespace is not base64 text: remove it
 * first with withoutWhitespace(). Read one character at a time, so its cost and its memory do not
 * depend on the regular-expression engine, whatever the length.
 */
export function isBase64Text(s: string, opts: { urlSafe?: boolean; padding?: 'end' | 'anywhere' } = {}): boolean {
    if (typeof s !== 'string' || s.length === 0) return false;
    const urlSafe = opts.urlSafe !== false;
    const anywhere = opts.padding === 'anywhere';
    let end = s.length;
    if (!anywhere) {
        // At most two `=`, at the very end, and something before them.
        if (s.charCodeAt(end - 1) === EQUALS) end--;
        if (end > 0 && s.charCodeAt(end - 1) === EQUALS) end--;
        if (end === 0) return false;
    }
    let letters = 0;
    for (let i = 0; i < end; i++) {
        const c = s.charCodeAt(i);
        if (anywhere && c === EQUALS) continue;
        const kind = c < 128 ? ALPHABET[c] : 0;
        if (kind === 0 || (kind === 2 && !urlSafe)) return false;
        letters++;
    }
    return letters > 0;
}

/**
 * Decode `content` as base64 into a Buffer. Returns null if `content` is
 * not a valid base64 string. Whitespace is tolerated (stripped before
 * decoding). Standard and URL-safe base64 are both accepted.
 *
 * Validation rules:
 *  - Non-empty after whitespace stripping
 *  - Only characters from [A-Za-z0-9+/_-]
 *  - Optional trailing padding of 0, 1, or 2 `=` characters
 */
export function decodeStrictBase64(content: string): Buffer | null {
    if (typeof content !== 'string') return null;
    const clean = withoutWhitespace(content);
    if (!isBase64Text(clean)) return null;
    return Buffer.from(clean, 'base64');
}
