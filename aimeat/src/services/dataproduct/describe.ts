/**
 * @file src/services/dataproduct/describe.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A draft of a data product's description, written by the owner's own AI from what the
 *   product is made of (canvas board Vaihe3-Esikatselu: "Tekoäly kirjoitti kuvauksen luonnoksen
 *   sarakkeista ja lähteestä; muuta se omaksesi."; WP9c). The REST route POST
 *   /v1/dataproducts/{name}/describe and the MCP tool aimeat_dataproduct action "describe" both call
 *   describeProduct.
 *
 *   WHAT THE AI READS: the product's name and title, a label of each source (./definition.ts
 *   sourceLabel, identifiers only), and each output column's name, type and description. No row of
 *   data is sent, so nothing a source holds reaches the model.
 *
 *   WHO PAYS: the owner's AI settings, through services/ai/completion.ts completeForOwner, as the
 *   caller the AI planner reads (an agent asks as itself, an app as its grant). The words: storage:read
 *   (it reads the definition) and ai:use (it spends the owner's AI), the word POST /v1/ai/complete asks.
 *
 *   WHAT IT ANSWERS: the draft, nothing stored; the page fills it into the description field for the
 *   owner to change. The provenance record of the call (services/ai-provenance-marks.ts), decided
 *   against the audience the product would have, so the page shows the AI label when one is owed. No
 *   AI to ask (no key, no model, the budget spent): the refusal of the AI call, with `details.reason`
 *   (NO_KEY, NO_MODEL, BUDGET_EXHAUSTED ...) and `details.settings_url`, the AI settings page.
 * @structure DESCRIBE_LANGS · describeProduct · describePrompt
 * @usage const out = await describeProduct(ctx, name, body);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9c, plan doc-mvwxcas3dom3 D9.4).
 */
import type { DataProductAnswer, DataProductCtx } from './service.js';
import { getProduct } from './service.js';
import { normaliseDefinition, sourceLabel, asDefinition, type DataProductDefinition } from './definition.js';
import { completeForOwner, AiCompletionError } from '../ai/completion.js';
import { aiCallerFromCredential } from '../ai/caller-context.js';
import { reasonOf, aiSettingsUrl } from '../ai/ai-fix-words.js';
import { servedProvenanceOf } from '../ai-provenance-marks.js';

/** The languages a draft is written in; anything else is English. */
export const DESCRIBE_LANGS = ['en', 'fi', 'es'] as const;
const LANGUAGE_NAMES: Record<typeof DESCRIBE_LANGS[number], string> = { en: 'English', fi: 'Finnish', es: 'Spanish' };

const SYSTEM_PROMPT = 'You write the description of a dataset for a data catalogue, the way a careful data steward would. '
    + 'The reader is a person deciding whether this data fits their purpose, and a program that shows the text next to the table. '
    + 'Write two or three plain sentences: what each row is, what the main columns tell, and where the data comes from. '
    + 'Ground every statement in the facts given; when a fact is missing, describe only what is given. '
    + 'Answer with the description text alone, as one paragraph.';

/** The user prompt: the facts, one per line. */
export function describePrompt(def: Pick<DataProductDefinition, 'name' | 'title' | 'sources' | 'columns'>, lang: typeof DESCRIBE_LANGS[number]): string {
    const lines = [
        `Write the description in ${LANGUAGE_NAMES[lang]}.`,
        `Dataset name: ${def.title || def.name}`,
        `Address name: ${def.name}`,
        'Sources:',
        ...def.sources.map(s => `- ${s.id}: ${s.kind}, ${sourceLabel(s).label}`),
    ];
    const cols = (def.columns ?? []).filter(c => c.include !== false);
    if (cols.length) {
        lines.push('Columns that go out:');
        for (const c of cols) lines.push(`- ${c.name ?? c.from} (${c.type ?? 'string'})${c.description ? `: ${c.description}` : ''}`);
    } else {
        lines.push('Columns: every column of the sources, as they are.');
    }
    return lines.join('\n');
}

/** A draft of the description of a stored product, or of a draft body (`sources` given). */
export async function describeProduct(ctx: DataProductCtx, name: string, body: Record<string, unknown> = {}): Promise<DataProductAnswer<Record<string, unknown>>> {
    const caller = ctx.caller;
    if (caller.kind === 'anonymous') return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: 'A data product belongs to an account: sign in.' };
    if (caller.visitor) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'A session from another node does not describe data products here.' };
    const missing = ['storage:read', 'ai:use'].filter(w => !caller.has(w));
    if (missing.length) return { ok: false, status: 403, code: 'SCOPE_DENIED', message: `This needs the ${missing.map(w => `"${w}"`).join(' and ')} permission. Ask the owner to grant it.` };

    let def: DataProductDefinition | null;
    if (Array.isArray(body.sources)) {
        const norm = normaliseDefinition(name, body);
        if (!norm.ok) return { ok: false, status: 400, code: norm.code, message: norm.message };
        const now = new Date().toISOString();
        def = { ...norm.definition, definedBy: caller.principal, createdAt: now, updatedAt: now };
    } else {
        const got = await getProduct(ctx, name);
        if (!got.ok) return got;
        def = asDefinition(got.data.definition);
        if (!def) return { ok: false, status: 404, code: 'NOT_FOUND', message: `You have no data product "${name}".` };
    }
    const lang = (DESCRIBE_LANGS as readonly string[]).includes(String(body.lang)) ? body.lang as typeof DESCRIBE_LANGS[number] : 'en';
    const { storage, config } = ctx.deps;
    try {
        const r = await completeForOwner(storage, config, caller.ownerGhii, {
            prompt: describePrompt(def, lang), systemPrompt: SYSTEM_PROMPT, temperature: 0.3,
            modelRole: 'execution', lang: { chosen: lang },
            ...aiCallerFromCredential({ roles: [...caller.roles], app: ctx.app ?? null }, caller.principal),
        });
        const description = r.content.trim().replace(/^"+|"+$/g, '').replace(/\s*\n+\s*/g, ' ').slice(0, 2000);
        const prov = r.provenance
            ? servedProvenanceOf(config, r.provenance, { full: true, surface: { visibility: def.visibility === 'public' ? 'public' : 'private' } })
            : undefined;
        return {
            ok: true, data: {
                description, lang, model: r.model, ai_written: true, truncated: r.truncated,
                ...(prov ? { provenance: { id: prov.id, record: prov.record, record_url: prov.recordUrl } } : {}),
            },
        };
    } catch (e) {
        if (!(e instanceof AiCompletionError)) throw e;
        return {
            ok: false, status: e.status, code: e.code, message: e.message,
            details: { reason: reasonOf(e), settings_url: aiSettingsUrl(config) },
        };
    }
}
