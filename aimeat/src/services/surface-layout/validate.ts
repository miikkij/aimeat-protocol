/**
 * @file src/services/surface-layout/validate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two halves of trusting a stored layout, and they are deliberately not the same
 *   function: writing is strict and reading is forgiving.
 *
 *   WRITE REFUSES, AND REFUSES BEFORE ANYTHING IS STORED. validateLayout throws on the first thing
 *   it cannot accept and names where: the block index, the block id, and what was wrong. Nothing
 *   reaches storage until the whole layout has passed. This is the opposite of uploadTemplate, which
 *   writes the template and then reports which of its tags could not be resolved — fine for a
 *   document an operator is looking at, wrong for the page every member of this node lands on.
 *
 *   READ REPAIRS, AND NEVER THROWS. parseLayout drops what it cannot honour, says so in `problems`,
 *   and hands back something renderable. A person opening their home is not the right audience for
 *   a schema error, and a blank page is a worse answer than a page missing one block. Whatever
 *   parseLayout cannot rescue at all falls to the built-in layout, so there is always a page. This
 *   asymmetry is the same one getHeaderNav and setHeaderNav have had since the nav config shipped.
 *
 *   FREE-FORM IS MARKDOWN, AND MARKUP IS REFUSED AT THE DOOR. The body is rendered by the browser's
 *   Markdown component, which builds vnodes and never assigns innerHTML, so a <script> in a body
 *   would show as text rather than run. The refusal here is not that renderer's safety net — it is
 *   so an operator who pasted an AI answer full of HTML is told, at the moment they paste it, that
 *   this is not the place for it. Two reasons it matters more than it looks: the home renders inside
 *   the authenticated SPA where the DOM holds a live session, and injectCspNonce stamps a nonce onto
 *   every <script it is handed without parsing what it is stamping.
 * @structure MAX_FREEFORM_BYTES · SLUG_RE · refuseMarkup · validateLayout · parseLayout
 * @usage
 *   import { validateLayout, parseLayout } from './validate.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import { SiteError } from '../site.js';
import { blockById, blockIsPresent } from './registry.js';
import type { BlockPropDef, SurfaceBlockDef } from './registry-types.js';
import type {
    BlockPropValue,
    ResolvedLayout,
    SurfaceBlockInstance,
    SurfaceId,
    SurfaceLayout,
} from './types.js';
import { SURFACE_IDS } from './types.js';

/** One passage of operator prose. Far under the 1024 kB value ceiling, and far over any real page. */
export const MAX_FREEFORM_BYTES = 64 * 1024;

/** What a free-form body's storage slug may look like. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** How many blocks one layout may hold at all. A page nobody could scroll is not a page. */
const MAX_BLOCKS = 60;

/** Markup that must not travel in a markdown body, with the plain-words reason for each. */
const MARKUP_REFUSALS: ReadonlyArray<{ re: RegExp; why: string }> = [
    { re: /<script\b/i, why: 'a <script> tag' },
    { re: /<iframe\b/i, why: 'an <iframe> tag' },
    { re: /<object\b/i, why: 'an <object> tag' },
    { re: /<embed\b/i, why: 'an <embed> tag' },
    { re: /<form\b/i, why: 'a <form> tag' },
    { re: /\son[a-z]+\s*=/i, why: 'an inline event handler' },
    { re: /javascript:/i, why: 'a javascript: link' },
    { re: /data:text\/html/i, why: 'a data:text/html link' },
];

/**
 * Refuse a free-form body that carries markup. Throws SiteError 422 naming what was found, because
 * "invalid content" tells the person nothing about which line to change.
 */
export function refuseMarkup(body: string, where: string): void {
    if (Buffer.byteLength(body, 'utf-8') > MAX_FREEFORM_BYTES) {
        throw new SiteError('FREEFORM_TOO_LARGE',
            `${where}: the text is over ${MAX_FREEFORM_BYTES / 1024} KB. This block holds a passage, not a document.`, 422);
    }
    for (const { re, why } of MARKUP_REFUSALS) {
        if (re.test(body)) {
            throw new SiteError('FREEFORM_MARKUP',
                `${where}: this block is written in Markdown and cannot carry ${why}. `
                + 'Use Markdown for headings, links and emphasis; a page that needs its own HTML is the portal template.', 422);
        }
    }
}

function fail(code: string, message: string): never {
    throw new SiteError(code, message, 422);
}

/**
 * Whether a value satisfies one declared prop. Returns the reason it does not, or null.
 * Exported (TARGET-074): the app-ui registry validates its blocks against the same BlockPropDef
 * union, and this 30-line judge is the piece both registries must never let drift apart.
 */
export function propProblem(def: BlockPropDef, value: BlockPropValue): string | null {
    switch (def.type) {
        case 'string':
            if (typeof value !== 'string') return 'expects text';
            if (def.maxLength !== undefined && value.length > def.maxLength) return `is longer than ${def.maxLength} characters`;
            return null;
        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value)) return 'expects a number';
            if (def.min !== undefined && value < def.min) return `is below the smallest allowed value (${def.min})`;
            if (def.max !== undefined && value > def.max) return `is above the largest allowed value (${def.max})`;
            return null;
        case 'boolean':
            return typeof value === 'boolean' ? null : 'expects true or false';
        case 'enum':
            if (typeof value !== 'string') return 'expects one of the listed values';
            return def.values.includes(value) ? null : `must be one of: ${def.values.join(', ')}`;
        case 'string[]': {
            if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) return 'expects a list of text values';
            if (def.maxItems !== undefined && value.length > def.maxItems) return `holds more than ${def.maxItems} entries`;
            if (def.values) {
                const stray = value.find(v => !def.values!.includes(v));
                if (stray !== undefined) return `names "${stray}", which is not one of: ${def.values.join(', ')}`;
            }
            return null;
        }
        default:
            return 'has a type this node does not know';
    }
}

/** Every instance in the tree, flat, with the path that reaches it. */
function walk(blocks: SurfaceBlockInstance[], parent = ''): Array<{ inst: SurfaceBlockInstance; path: string }> {
    const out: Array<{ inst: SurfaceBlockInstance; path: string }> = [];
    blocks.forEach((inst, i) => {
        const path = parent ? `${parent} > ${i}` : String(i);
        out.push({ inst, path });
        if (inst.children) out.push(...walk(inst.children, path));
    });
    return out;
}

/**
 * The write gate. Throws on the first refusal, naming where. Nothing is stored until this returns.
 * `config` is needed because a block this node cannot serve must not be saved into its layout:
 * storing it would let an operator arrange something that then renders as nothing.
 */
export function validateLayout(input: unknown, surface: SurfaceId, config: AimeatConfig): SurfaceLayout {
    if (!input || typeof input !== 'object') fail('LAYOUT_INVALID', 'The layout must be an object.');
    const raw = input as Partial<SurfaceLayout>;

    if (raw.v !== 1) fail('LAYOUT_INVALID', `This node writes layout version 1; it was given ${JSON.stringify(raw.v)}.`);
    if (!SURFACE_IDS.includes(surface)) fail('LAYOUT_INVALID', `"${surface}" is not a surface this node has.`);
    if (raw.surface !== undefined && raw.surface !== surface) {
        fail('LAYOUT_INVALID', `This layout says it is for "${raw.surface}" but it was sent to "${surface}".`);
    }
    if (raw.binding !== undefined && (raw.binding as { kind?: string }).kind !== 'node') {
        fail('LAYOUT_INVALID', 'Only a node-level layout can be written on this node today.');
    }
    if (!Array.isArray(raw.blocks)) fail('LAYOUT_INVALID', 'The layout has no list of blocks.');

    const flat = walk(raw.blocks as SurfaceBlockInstance[]);
    if (flat.length === 0) fail('LAYOUT_INVALID', 'A layout with no blocks would be an empty page. Remove the layout instead to go back to the built-in one.');
    if (flat.length > MAX_BLOCKS) fail('LAYOUT_INVALID', `A layout may hold ${MAX_BLOCKS} blocks; this one has ${flat.length}.`);

    const keys = new Set<string>();
    const counts = new Map<string, number>();
    const freeformKeys: string[] = [];

    for (const { inst, path } of flat) {
        const at = `block ${path}`;
        if (!inst || typeof inst !== 'object') fail('LAYOUT_INVALID', `${at} is not a block.`);
        if (typeof inst.id !== 'string' || !inst.id) fail('LAYOUT_INVALID', `${at} has no block name.`);
        if (typeof inst.key !== 'string' || !inst.key) fail('LAYOUT_INVALID', `${at} (${inst.id}) has no key of its own.`);

        const def: SurfaceBlockDef | undefined = blockById(inst.id);
        if (!def) fail('LAYOUT_INVALID', `${at}: this node has no block called "${inst.id}".`);
        if (!def.surfaces.includes(surface)) {
            fail('LAYOUT_INVALID', `${at}: "${inst.id}" cannot go on the ${surface} surface. It belongs on: ${def.surfaces.join(', ')}.`);
        }
        if (!blockIsPresent(def, config)) {
            fail('LAYOUT_INVALID', `${at}: this node cannot serve "${inst.id}", so putting it on a page would show nothing.`);
        }
        if (keys.has(inst.key)) fail('LAYOUT_INVALID', `${at}: the key "${inst.key}" is already used by another block.`);
        keys.add(inst.key);

        const n = (counts.get(inst.id) ?? 0) + 1;
        counts.set(inst.id, n);
        if (n > def.maxPerSurface) {
            fail('LAYOUT_INVALID', `${at}: "${inst.id}" may appear ${def.maxPerSurface} time(s) on a page; this is number ${n}.`);
        }

        if (inst.children && !def.container) {
            fail('LAYOUT_INVALID', `${at}: "${inst.id}" cannot hold other blocks.`);
        }
        if (inst.children?.some(c => c.children)) {
            fail('LAYOUT_INVALID', `${at}: blocks can be grouped one level deep, not two.`);
        }

        if (inst.props !== undefined) {
            if (typeof inst.props !== 'object' || inst.props === null || Array.isArray(inst.props)) {
                fail('LAYOUT_INVALID', `${at}: the settings must be an object.`);
            }
            for (const [name, value] of Object.entries(inst.props)) {
                const propDef = def.props[name];
                if (!propDef) fail('LAYOUT_INVALID', `${at}: "${inst.id}" has no setting called "${name}".`);
                const problem = propProblem(propDef, value as BlockPropValue);
                if (problem) fail('LAYOUT_INVALID', `${at}: the setting "${name}" ${problem}.`);
            }
        }

        if (inst.titles !== undefined) {
            if (typeof inst.titles !== 'object' || inst.titles === null || Array.isArray(inst.titles)) {
                fail('LAYOUT_INVALID', `${at}: the heading override must be a map of language to text.`);
            }
            for (const [lang, text] of Object.entries(inst.titles)) {
                if (!/^[a-z]{2}(-[A-Za-z0-9]+)?$/.test(lang)) fail('LAYOUT_INVALID', `${at}: "${lang}" is not a language tag.`);
                if (typeof text !== 'string' || text.length > 200) fail('LAYOUT_INVALID', `${at}: the ${lang} heading must be text under 200 characters.`);
            }
        }

        if (inst.hidden !== undefined && typeof inst.hidden !== 'boolean') {
            fail('LAYOUT_INVALID', `${at}: "hidden" must be true or false.`);
        }

        if (inst.id === 'common.freeform') freeformKeys.push(inst.key);
    }

    // A free-form block with no words behind it renders nothing and looks like a bug; a stored body
    // with no block pointing at it is litter that nobody will ever find to delete.
    const freeform = (raw.freeform ?? {}) as Record<string, { ref?: unknown; format?: unknown }>;
    for (const key of freeformKeys) {
        const entry = freeform[key];
        if (!entry) fail('LAYOUT_INVALID', `The free-form block "${key}" has no text stored for it.`);
        if (typeof entry.ref !== 'string' || !SLUG_RE.test(entry.ref)) {
            fail('LAYOUT_INVALID', `The free-form block "${key}" points at "${String(entry.ref)}", which is not a usable name (lower-case letters, numbers and dashes).`);
        }
        if (entry.format !== 'markdown') {
            fail('LAYOUT_INVALID', `The free-form block "${key}" must be written in Markdown.`);
        }
    }
    for (const key of Object.keys(freeform)) {
        if (!freeformKeys.includes(key)) {
            fail('LAYOUT_INVALID', `There is text stored for "${key}", but no free-form block uses it.`);
        }
    }

    return {
        v: 1,
        surface,
        binding: { kind: 'node' },
        blocks: raw.blocks as SurfaceBlockInstance[],
        ...(Object.keys(freeform).length ? { freeform: raw.freeform as SurfaceLayout['freeform'] } : {}),
        meta: {
            updatedAt: new Date().toISOString(),
            updatedBy: raw.meta?.updatedBy ?? 'unknown',
            source: raw.meta?.source ?? 'admin',
            ...(raw.meta?.note ? { note: String(raw.meta.note).slice(0, 400) } : {}),
        },
    };
}

/**
 * The read gate. Repairs what it can, records what it dropped, and never throws. A caller that gets
 * `degraded: true` with an empty block list should serve the built-in layout instead.
 */
export function parseLayout(stored: unknown, surface: SurfaceId, config: AimeatConfig): Omit<ResolvedLayout, 'source'> {
    const problems: string[] = [];
    let raw: unknown = stored;

    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            // Not silent: the reason travels back to the operator in `problems`, and the visitor
            // gets a page either way.
            return { layout: emptyOf(surface), degraded: true, problems: ['The stored layout is not readable, so the built-in one is being shown.'] };
        }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { layout: emptyOf(surface), degraded: true, problems: ['The stored layout is not a layout, so the built-in one is being shown.'] };
    }

    const rec = raw as Partial<SurfaceLayout>;
    if (rec.v !== 1) {
        return {
            layout: emptyOf(surface),
            degraded: true,
            problems: [`The stored layout is version ${String(rec.v)}, which this node does not read. The built-in one is being shown.`],
        };
    }

    const freeform = { ...(rec.freeform ?? {}) };
    const keep = (list: unknown, depth: number): SurfaceBlockInstance[] => {
        if (!Array.isArray(list)) return [];
        const out: SurfaceBlockInstance[] = [];
        const keys = new Set<string>();
        for (const item of list) {
            if (!item || typeof item !== 'object') { problems.push('A block that was not a block was left out.'); continue; }
            const inst = item as SurfaceBlockInstance;
            const def = typeof inst.id === 'string' ? blockById(inst.id) : undefined;
            if (!def) { problems.push(`"${String(inst.id)}" is not a block this node has, so it was left out.`); continue; }
            if (!def.surfaces.includes(surface)) { problems.push(`"${inst.id}" does not belong on this page, so it was left out.`); continue; }
            if (!blockIsPresent(def, config)) { problems.push(`This node cannot serve "${inst.id}" right now, so it was left out.`); continue; }
            const key = typeof inst.key === 'string' && inst.key ? inst.key : inst.id;
            if (keys.has(key)) { problems.push(`Two blocks shared the key "${key}"; the second was left out.`); continue; }
            keys.add(key);

            const props: Record<string, BlockPropValue> = {};
            for (const [name, value] of Object.entries(inst.props ?? {})) {
                const propDef = def.props[name];
                if (!propDef) { problems.push(`"${inst.id}" has no setting called "${name}"; it was ignored.`); continue; }
                if (propProblem(propDef, value as BlockPropValue)) {
                    problems.push(`The setting "${name}" on "${inst.id}" could not be used, so its normal value applies.`);
                    continue;
                }
                props[name] = value as BlockPropValue;
            }

            if (inst.id === 'common.freeform') {
                const entry = freeform[key];
                if (!entry || typeof entry.ref !== 'string' || !SLUG_RE.test(entry.ref)) {
                    problems.push(`The free-form block "${key}" has no text stored for it, so it was left out.`);
                    continue;
                }
            }

            out.push({
                id: inst.id,
                key,
                ...(Object.keys(props).length ? { props } : {}),
                ...(inst.titles && typeof inst.titles === 'object' ? { titles: inst.titles } : {}),
                ...(inst.hidden === true ? { hidden: true } : {}),
                ...(def.container && depth === 0 && Array.isArray(inst.children)
                    ? { children: keep(inst.children, depth + 1) }
                    : {}),
            });
        }
        return out;
    };

    const blocks = keep(rec.blocks, 0);
    const usedKeys = new Set(blocks.flatMap(b => [b.key, ...(b.children ?? []).map(c => c.key)]));
    for (const key of Object.keys(freeform)) if (!usedKeys.has(key)) delete freeform[key];

    return {
        layout: {
            v: 1,
            surface,
            binding: { kind: 'node' },
            blocks,
            ...(Object.keys(freeform).length ? { freeform } : {}),
            meta: {
                updatedAt: typeof rec.meta?.updatedAt === 'string' ? rec.meta.updatedAt : new Date(0).toISOString(),
                updatedBy: typeof rec.meta?.updatedBy === 'string' ? rec.meta.updatedBy : 'unknown',
                source: rec.meta?.source ?? 'admin',
                ...(rec.meta?.note ? { note: String(rec.meta.note).slice(0, 400) } : {}),
            },
        },
        degraded: problems.length > 0,
        problems,
    };
}

/** A layout shaped correctly and holding nothing — the signal to fall back to the built-in one. */
function emptyOf(surface: SurfaceId): SurfaceLayout {
    return {
        v: 1,
        surface,
        binding: { kind: 'node' },
        blocks: [],
        meta: { updatedAt: new Date(0).toISOString(), updatedBy: 'unknown', source: 'admin' },
    };
}
