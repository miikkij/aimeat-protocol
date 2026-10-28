/**
 * @file src/models/validation-issues.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The 400 a request gets when its body breaks a schema: one entry per field, each with
 *   the field's path, a code a client branches on, the limit when there is one, and a sentence in
 *   the caller's language. Shared by validateBody, the routes that call `safeParse` themselves and
 *   the request-level input guard, so a form gets the same answer from every route.
 *
 *   THE SHAPE. `error.details` is `[{ path, code, message, max?, min? }]`. `path` is the field's
 *   dotted path in the body ("title", "items.2.name"; "" for the body itself), which is the name a
 *   form gives its field, so a page puts each message beside its field with no code of its own
 *   (public/js/field-errors.js). `message` and the envelope's `error.message` follow the caller's
 *   language (?lang=, the aimeat-lang cookie, Accept-Language); `code` never changes with it.
 *
 *   Codes: too_long, too_short, required, blank, control_char, nul_byte, invalid_unicode,
 *   unknown_field, invalid_type, invalid_format, invalid_value, invalid.
 * @structure validationDetails(issues, input, locale) · validationFailure(nodeId, details, locale) ·
 *   requestLocale(req) · ValidationDetail
 * @usage if (!parsed.success) { const l = requestLocale(req); res.status(400).json(validationFailure(config.nodeId, validationDetails(parsed.error.issues, req.body, l), l)); return; }
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */
import type { Request } from 'express';
import type { z } from 'zod';
import { createT, resolveLocale, type Locale } from '../i18n.js';
import { error, type AimeatResponse } from '../middleware/envelope.js';
import { TEXT_REASON } from './input-limits.js';

export interface ValidationDetail {
    path: string;
    code: string;
    message: string;
    max?: number;
    min?: number;
}

/** The caller's language, as the pages and the server's own words decide it. */
export function requestLocale(req: Request): Locale {
    const lang = typeof req.query?.lang === 'string' ? req.query.lang : undefined;
    return resolveLocale(lang, req.headers.cookie, req.headers['accept-language']);
}

/** Whether `path` names nothing in `input`: the field was left out, not sent wrong. */
function absent(input: unknown, path: readonly PropertyKey[]): boolean {
    let cur: unknown = input;
    for (const key of path) {
        if (cur === null || typeof cur !== 'object') return true;
        cur = (cur as Record<PropertyKey, unknown>)[key];
    }
    return cur === undefined;
}

const REASONS = new Set<string>(Object.values(TEXT_REASON));

/** One entry per Zod issue, in the caller's language. `input` is what was parsed, so a missing field reads as required. */
export function validationDetails(issues: readonly z.core.$ZodIssue[], input: unknown, locale: Locale): ValidationDetail[] {
    const t = createT(locale);
    const out: ValidationDetail[] = [];
    for (const issue of issues) {
        const path = issue.path.map(String).join('.');
        switch (issue.code) {
            case 'too_big': {
                const max = Number(issue.maximum);
                const text = issue.origin === 'string';
                out.push({ path, code: 'too_long', max, message: t(text ? 'validation.tooLong' : 'validation.tooMany', { n: max }) });
                break;
            }
            case 'too_small': {
                const min = Number(issue.minimum);
                if (issue.origin === 'string' && min === 1) out.push({ path, code: 'required', min, message: t('validation.required') });
                else out.push({ path, code: 'too_short', min, message: t(issue.origin === 'string' ? 'validation.tooShort' : 'validation.tooFew', { n: min }) });
                break;
            }
            case 'invalid_type':
                if (absent(input, issue.path)) out.push({ path, code: 'required', message: t('validation.required') });
                else out.push({ path, code: 'invalid_type', message: t('validation.invalidType', { expected: issue.expected }) });
                break;
            case 'unrecognized_keys':
                for (const key of issue.keys) {
                    out.push({ path: path ? `${path}.${key}` : key, code: 'unknown_field', message: t('validation.unknownField') });
                }
                break;
            case 'invalid_format':
                out.push({ path, code: 'invalid_format', message: t('validation.invalidFormat') });
                break;
            case 'invalid_value':
                out.push({ path, code: 'invalid_value', message: t('validation.invalidValue') });
                break;
            case 'custom': {
                const reason = typeof issue.params?.reason === 'string' ? issue.params.reason : '';
                if (REASONS.has(reason)) out.push({ path, code: reason, message: t(`validation.${reasonKey(reason)}`) });
                else out.push({ path, code: 'invalid', message: issue.message });
                break;
            }
            default:
                out.push({ path, code: 'invalid', message: issue.message });
        }
    }
    return out;
}

function reasonKey(reason: string): string {
    return reason.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** The 400 envelope: VALIDATION_ERROR, a sentence that says to look at the fields, and the details. */
export function validationFailure(nodeId: string, details: ValidationDetail[], locale: Locale): AimeatResponse {
    const t = createT(locale);
    const only = details.length === 1 ? details[0] : undefined;
    const message = only
        ? (only.path ? t('validation.oneField', { field: only.path, problem: only.message }) : only.message)
        : t('validation.failed', { n: details.length });
    return error(nodeId, 'VALIDATION_ERROR', message, 400, details);
}
