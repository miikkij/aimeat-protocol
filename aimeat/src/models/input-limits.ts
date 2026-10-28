/**
 * @file src/models/input-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one place the node's input length limits live, and the Zod helpers every
 *   request schema builds its text fields from.
 *
 *   WHY ONE PLACE. Before this, each schema picked its own number (a title was 100, 120, 200, 256 or
 *   unbounded depending on who wrote the route), and about 370 `z.string()` fields had no limit at
 *   all. A limit is chosen by what the field holds, from the classes below, so a title is the same
 *   length everywhere and the browser can be given the same number (wish
 *   wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli, brief doc-mvr3t631xwxk).
 *
 *   THE NUMBERS. Chosen 2026-10-27 with a wide margin over what production holds: the longest of 200
 *   app descriptions on aimeat.io was 697 characters and the longest name 39. A limit stops junk and
 *   accidents; it is not a style rule, so it sits far above anything a person writes on purpose.
 *   Changing one here changes it for every field of its class.
 *
 *   WHAT IS REFUSED, AND WHERE.
 *   - Every text field: longer than its class, a NUL character (PostgreSQL cannot store it in text
 *     or JSONB, and the write used to end in a 500), and a lone UTF-16 surrogate (it is not a
 *     character and turns into U+FFFD on the way to storage, so what was stored is not what was
 *     sent). The request-level guard (middleware/input-junk.ts) refuses the last two for every
 *     route before any schema runs; the helpers repeat it for schemas used outside a request.
 *   - safeText: also a control character other than tab, line feed and carriage return. These are
 *     names, titles and lines a person reads, where such a character is never meant and can hide
 *     text or break a terminal or a log.
 *   - requiredText: also a value that is only white space.
 *   - documentText: a whole document (an app's HTML, a Markdown page, a file as base64). Its length
 *     is bounded by the request body limit (config.jsonBodyLimitMb / jsonBodyLimitLargeMb), which an
 *     operator sets, so it carries no number of its own here.
 * @structure INPUT_LIMITS · safeText(max) · requiredText(max) · boundedText(max) · documentText() ·
 *   CONTROL_CHAR · hasControlChar(s) · hasLoneSurrogate(s) · isStorableText(s) · TEXT_REASON
 * @usage title: requiredText(INPUT_LIMITS.title), note: safeText(INPUT_LIMITS.text).optional()
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */
import { z } from 'zod';

/** Characters, by what the field holds. */
export const INPUT_LIMITS = Object.freeze({
    /** An identifier, a key, a slug, a token, a version string. */
    id: 256,
    /** A memory or storage key: a workspace record's key nests the organism, the workspace and the record id. */
    key: 1024,
    /** A name, a label, a tag, a category. */
    name: 200,
    /** A title or a subject line. */
    title: 500,
    /** One line of text: a reason, a note, a hint, a summary, a search query. */
    line: 2048,
    /** An address (RFC 3986 sets none; 2048 is what browsers and proxies keep). */
    url: 2048,
    /** An email address (RFC 5321: 254). */
    email: 254,
    /** A description of something: an app, an agent, a workspace. */
    description: 10_000,
    /** Free text a person writes: a message, a post, a comment, a prompt, instructions. */
    text: 100_000,
});

/** Why a text was refused, carried in a Zod custom issue's params and in the error's details. */
export const TEXT_REASON = Object.freeze({
    controlChar: 'control_char',
    nulByte: 'nul_byte',
    invalidUnicode: 'invalid_unicode',
    blank: 'blank',
});

/** C0 controls except tab (09), line feed (0A) and carriage return (0D); DEL; the C1 controls. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
export const CONTROL_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

export function hasControlChar(s: string): boolean {
    return CONTROL_CHAR.test(s);
}

/** A high surrogate with no low one after it, or a low one with no high one before it. No `u` flag: it reads code units. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** String.prototype.isWellFormed, which the compiler's target library does not declare yet. */
export function hasLoneSurrogate(s: string): boolean {
    return LONE_SURROGATE.test(s);
}

/** No NUL and no lone surrogate: what any storage behind this node keeps exactly as it was sent. */
export function isStorableText(s: string): boolean {
    return !s.includes('\u0000') && !hasLoneSurrogate(s);
}

function storable(schema: z.ZodString): z.ZodString {
    return schema
        .refine(s => !s.includes('\u0000'), { message: 'Contains a NUL character', params: { reason: TEXT_REASON.nulByte } })
        .refine(s => !hasLoneSurrogate(s), { message: 'Contains a broken character (a lone UTF-16 surrogate)', params: { reason: TEXT_REASON.invalidUnicode } });
}

/** Any text up to `max` characters that storage keeps exactly. For text that may hold control characters (a log, a terminal capture). */
export function boundedText(max: number): z.ZodString {
    return storable(z.string().max(max));
}

/** A text a person reads, up to `max`: no control character other than tab and line breaks. */
export function safeText(max: number): z.ZodString {
    return boundedText(max)
        .refine(s => !hasControlChar(s), { message: 'Contains a control character', params: { reason: TEXT_REASON.controlChar } });
}

/** A required text a person reads: safeText, and not empty or only white space. */
export function requiredText(max: number): z.ZodString {
    return safeText(max)
        .refine(s => s.trim().length > 0, { message: 'Is empty or only white space', params: { reason: TEXT_REASON.blank } });
}

/** A whole document. The request body limit bounds its length; see the header. */
export function documentText(): z.ZodString {
    return storable(z.string());
}
