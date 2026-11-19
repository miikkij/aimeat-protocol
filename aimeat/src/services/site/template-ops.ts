/**
 * @file src/services/site/template-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's front page and its language versions, read, stored and deleted: the
 *   work GET, POST and DELETE /v1/site/template (routes/site.ts) and the MCP tool
 *   aimeat_site_template (mcp/site-template.ts) both run. Each takes the node's one SiteService
 *   (services/site.ts nodeSiteService), so a page stored over MCP drops the cached HTML that GET /
 *   serves, exactly as a page stored on the Portal page does. Who may call is decided before these
 *   run (requireOperator on the route, operator:admin on the tool); these only check the input and
 *   answer a refusal with the code and status the route has always answered.
 * @structure namedLanguage · readTemplateOp · storeTemplateOp · removeTemplateOp · TemplateOpResult
 * @usage const out = await storeTemplateOp(site, config, { template, lang, changedBy }); if (!out.ok) …
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: moved out of routes/site.ts unchanged, so the MCP tool runs the
 *     route's code (feature audit 2026-11-19, 4.4 item 5).
 */
import type { AimeatConfig } from '../../config.js';
import { SiteError, type SiteService } from '../site.js';

/** A refusal in the route's terms: the HTTP status, the stable code and the sentence. */
export interface TemplateOpRefusal { ok: false; status: number; code: string; message: string }
export type TemplateOpResult<T> = { ok: true; data: T } | TemplateOpRefusal;

const LANG_REFUSAL: TemplateOpRefusal = {
    ok: false, status: 422, code: 'TEMPLATE_LANG_INVALID',
    message: 'Write the language as a two-letter code, such as "fi" or "en", then send it again. Leave it out for the default page.',
};
const LB_REFUSAL: TemplateOpRefusal = {
    ok: false, status: 409, code: 'LB_MODE',
    message: 'This copy only mirrors the main site, so it cannot be edited here. Make the change on the main one.',
};

/**
 * The language a request names: a code, undefined when it names none, false when the value is no
 * code. A value that is not a code is refused, never read as "no language": a mistyped code on a
 * delete would otherwise delete the whole front page.
 */
export function namedLanguage(value: unknown): string | undefined | false {
    if (value === undefined || value === null || value === '') return undefined;
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return /^[a-z]{2}$/.test(text) ? text : false;
}

/** The stored page of `lang` (the default page without it) and the language versions the front page has. */
export async function readTemplateOp(site: SiteService, rawLang: unknown): Promise<TemplateOpResult<{
    template: string | null; lang: string | null; size_bytes: number; updated_at: string | null; tags_found: string[];
    languages: Array<{ lang: string | null; size_bytes: number; updated_at: string }>;
}>> {
    const lang = namedLanguage(rawLang);
    if (lang === false) return LANG_REFUSAL;
    const [result, pages] = await Promise.all([site.getTemplate(lang), site.listTemplates()]);
    const languages = pages.filter(p => p.lang !== null)
        .map(p => ({ lang: p.lang, size_bytes: p.sizeBytes, updated_at: p.updatedAt }));
    return { ok: true, data: {
        template: result?.template ?? null,
        lang: lang ?? null,
        size_bytes: result?.sizeBytes ?? 0,
        updated_at: result?.updatedAt ?? null,
        tags_found: result?.tagsFound ?? [],
        languages,
    } };
}

/** Store the default page, or with `lang` the language version beside it. */
export async function storeTemplateOp(site: SiteService, config: AimeatConfig, input: { template: unknown; lang: unknown; changedBy: string }): Promise<TemplateOpResult<{
    stored: true; lang: string | null; size_bytes: number; tags_found: string[]; unresolvable_tags: string[];
}>> {
    if (config.siteLbEnabled) return LB_REFUSAL;
    const { template } = input;
    if (!template || typeof template !== 'string') {
        return { ok: false, status: 422, code: 'TEMPLATE_INVALID', message: 'Name the template you want to use, then send it again.' };
    }
    const lang = namedLanguage(input.lang);
    if (lang === false) return LANG_REFUSAL;
    try {
        const result = await site.uploadTemplate(template, input.changedBy, lang);
        return { ok: true, data: {
            stored: true,
            lang: lang ?? null,
            size_bytes: Buffer.byteLength(template, 'utf-8'),
            tags_found: result.tagsFound,
            unresolvable_tags: result.unresolvableTags,
        } };
    } catch (err) {
        if (err instanceof SiteError) return { ok: false, status: err.httpStatus, code: err.code, message: err.message };
        throw err;
    }
}

/** Delete the default page and its language versions, or with `lang` that language version only. */
export async function removeTemplateOp(site: SiteService, config: AimeatConfig, input: { lang: unknown; changedBy: string }): Promise<TemplateOpResult<
    { deleted: true; lang: string } | { deleted: true; reverted_to: 'default' }
>> {
    if (config.siteLbEnabled) return LB_REFUSAL;
    const lang = namedLanguage(input.lang);
    if (lang === false) return LANG_REFUSAL;
    const deleted = await site.deleteTemplate(input.changedBy, lang);
    if (lang && !deleted) return { ok: false, status: 404, code: 'NOT_FOUND', message: `The front page has no ${lang} version.` };
    return { ok: true, data: lang ? { deleted: true, lang } : { deleted: true, reverted_to: 'default' } };
}
