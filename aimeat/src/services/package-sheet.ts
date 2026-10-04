/**
 * @file src/services/package-sheet.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "what you get" sheet of a package: what it gives the person, what to ask their AI
 *   once it is installed, what data its apps handle and where it goes, which agents come with it,
 *   what runs on its own, which operating guides their AI gets, what it asks before installing, and
 *   what the node must already have (guided journey P3, brief doc-mupor242l3cq).
 *
 *   ONE READER FOR CHAT AND SCREEN. Until 2026-10-01 a person deciding on a package saw its parts
 *   ("app, extension ×2") and nothing about data, agents or what it would ask; the data map, the
 *   bundled crews and the schedules all travelled inside the package but nothing read them before
 *   install. This derives the sheet from the package's own components every time, so it cannot drift
 *   from what installs, and GET /v1/packages/:groupId and aimeat_package_get both return it.
 *
 *   What only the author can say, the outcome sentence and up to three example prompts, comes from
 *   the manifest's `sheet` object (package-compose.ts writes it from the compose call's `outcome`
 *   and `prompts`). Without it the outcome falls back to the description.
 * @structure PackageSheet · packageSheet(pkg) · sheetOfManifest(manifest)
 * @usage const sheet = packageSheet(pkg, config);
 * @version-history
 *   v1.2.0 — 2026-10-04 — `appAccess`: what each app asks for when it opens, which an install may
 *     approve (`grant_apps`); the Packages page shows it beside the choice.
 *   v1.1.0 — 2026-10-02 — `tools`: what the apps offer to agents, as carried (no prices; package-app-tools.ts).
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { parse as parseYaml } from 'yaml';
import type { PackageRecord, PackageComponent } from '../storage/types/packages.js';
import { parseBundledCrews } from './app-bundled-crews.js';
import { expectsOf, type PackageExpects } from './package-expects.js';
import { questionsOf } from './package-config-needs.js';
import { packageCapabilities } from './package-capabilities.js';
import type { AimeatConfig } from '../config.js';

export interface PackageSheet {
    /** What the person gets, in one sentence. */
    outcome: string;
    /** What to ask their AI once it is installed. */
    prompts: string[];
    apps: Array<{ label: string; description: string }>;
    /** Per app with a data map: what it is for, what it keeps and who reads it, and what leaves. */
    data: Array<{ app: string; what: string; keeps: Array<{ holds: string; readers: string }>; leaves: Array<{ what: string; to: string }> }>;
    /** Apps with no data map: nobody has written down where their data goes. */
    dataUnmapped: string[];
    /** Agents that come inside the apps; each waits for the person's approval after install. */
    agents: Array<{ app: string; name: string; purpose: string }>;
    /** The tools the apps offer to agents, as the package carries them: without prices. */
    tools: Array<{ app: string; name: string; description: string }>;
    /** Jobs an extension runs on its own once installed. */
    runsOnItsOwn: Array<{ component: string; what: string; when: string }>;
    /** Operating guides the person's AI gets with the apps. */
    guides: string[];
    /** Settings asked before or at install. */
    asks: Array<{ componentId: string; component: string; field: string; title: string; description: string; default: string; required: boolean; secret: boolean }>;
    /** What this node must already have. */
    expects: PackageExpects;
    /**
     * What each app asks for when it opens: the permissions an install may approve for it
     * (`grant_apps`), from the same reading the install's capabilities use (package-capabilities.ts).
     */
    appAccess: Array<{ app: string; scopes: string[]; declared: boolean }>;
}

const text = (v: unknown, max = 400): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The author's own sheet fields from a manifest string or object: `{ sheet: { outcome, prompts } }`. */
export function sheetOfManifest(manifest: unknown): { outcome: string; prompts: string[] } {
    let raw: unknown = manifest;
    if (typeof manifest === 'string') {
        // eslint-disable-next-line aimeat/no-silent-catch -- a manifest that is not JSON carries no sheet
        try { raw = JSON.parse(manifest); } catch { raw = null; }
    }
    const s = raw && typeof raw === 'object' ? (raw as { sheet?: unknown }).sheet : undefined;
    if (!s || typeof s !== 'object') return { outcome: '', prompts: [] };
    const o = s as { outcome?: unknown; prompts?: unknown };
    return {
        outcome: text(o.outcome, 300),
        prompts: Array.isArray(o.prompts) ? o.prompts.map(p => text(p, 300)).filter(Boolean).slice(0, 3) : [],
    };
}

function appHtml(c: PackageComponent): string {
    return typeof c.content === 'string' ? c.content : '';
}

/** The YAML manifest of an extension component: inside its JSON content, or the content itself. */
function extensionManifestText(c: PackageComponent): string {
    const raw = String(c.content ?? '');
    if (!raw.trimStart().startsWith('{')) return raw; // raw YAML content is the other legal shape
    const parsed = parseJsonOrNull(raw) as { manifest?: unknown } | null;
    return typeof parsed?.manifest === 'string' ? parsed.manifest : '';
}

/** JSON that does not parse carries no manifest; the installer refuses it with its own message. */
function parseJsonOrNull(src: string): unknown {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer: nothing declared
    try { return JSON.parse(src); } catch { return null; }
}

/** A manifest that does not parse declares no schedule; the installer refuses it with its own message. */
function parseYamlOrNull(src: string): unknown {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer: nothing declared
    try { return parseYaml(src); } catch { return null; }
}

function extensionSchedules(c: PackageComponent): Array<{ what: string; when: string }> {
    const manifest = extensionManifestText(c);
    const doc = parseYamlOrNull(manifest);
    const list = doc && typeof doc === 'object' ? (doc as { schedules?: unknown }).schedules : undefined;
    if (!Array.isArray(list)) return [];
    return list.slice(0, 20).map(s => {
        const r = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
        return { what: text(r.description) || text(r.id) || text(r.action), when: text(r.cron, 60) };
    });
}

/** The sheet, derived from the package's own components and the author's manifest fields. */
export function packageSheet(pkg: PackageRecord, config: AimeatConfig): PackageSheet {
    const author = sheetOfManifest(pkg.manifest);
    const sheet: PackageSheet = {
        outcome: author.outcome || text(pkg.description, 300),
        prompts: author.prompts,
        apps: [], data: [], dataUnmapped: [], agents: [], tools: [], runsOnItsOwn: [], guides: [], asks: [],
        expects: expectsOf(pkg.manifest),
        appAccess: [],
    };
    const labelOfApp = new Map((pkg.components ?? []).filter(c => c.type === 'app')
        .map(c => [c.id, text(((c.meta ?? {}) as Record<string, Record<string, unknown>>).app?.name, 120) || c.label]));
    sheet.appAccess = packageCapabilities(pkg.components ?? [], config, pkg.author).capabilities.apps
        .map(a => ({ app: labelOfApp.get(a.component) ?? a.name, scopes: a.scopes, declared: a.declared }));
    for (const c of pkg.components ?? []) {
        const meta = (c.meta ?? {}) as Record<string, unknown>;
        if (c.type === 'app') {
            const app = (meta.app ?? {}) as Record<string, unknown>;
            const label = text(app.name, 120) || c.label;
            sheet.apps.push({ label, description: text(app.description) });
            const map = app.datamap as Record<string, unknown> | undefined;
            if (map && typeof map === 'object') {
                const held = Array.isArray(map.held) ? map.held as Array<Record<string, unknown>> : [];
                const leaves = Array.isArray(map.leaves) ? map.leaves as Array<Record<string, unknown>> : [];
                sheet.data.push({
                    app: label, what: text(map.what, 300),
                    keeps: held.slice(0, 12).map(h => ({ holds: text(h.holds, 160) || text(h.what, 160), readers: text(h.readers, 80) })),
                    leaves: leaves.slice(0, 12).map(l => ({ what: text(l.what, 160), to: text(l.to, 160) })),
                });
            } else {
                sheet.dataUnmapped.push(label);
            }
            for (const t of Array.isArray(app.tools) ? app.tools as Array<Record<string, unknown>> : []) {
                const name = text(t.name, 80);
                if (name) sheet.tools.push({ app: label, name, description: text(t.description, 300) });
            }
            for (const crew of parseBundledCrews(appHtml(c)) ?? []) {
                const name = text(crew.agent_name, 60);
                const readme = text(crew.readme_md, 2000).split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) ?? '';
                if (name) sheet.agents.push({ app: label, name, purpose: text(crew.description, 300) || readme.slice(0, 300) });
            }
        } else if (c.type === 'extension') {
            for (const s of extensionSchedules(c)) sheet.runsOnItsOwn.push({ component: c.label, ...s });
        } else if (c.type === 'skill') {
            sheet.guides.push(c.label);
        }
    }
    // The same questions the install asks, from the same planner (package-config-needs.ts).
    const asked = questionsOf(pkg, {}, config);
    if (asked.ok) {
        const labelOf = new Map((pkg.components ?? []).map(c => [c.id, c.label]));
        // The field's own title is what a person reads; the key is what the install is sent.
        sheet.asks = asked.questions.map(q => {
            const schema = q.schema ?? {};
            const def = schema.default;
            return {
                componentId: q.component, component: labelOf.get(q.component) ?? q.component, field: q.field,
                title: text(schema.title, 120) || q.field, description: text(schema.description, 300),
                default: typeof def === 'string' || typeof def === 'number' || typeof def === 'boolean' ? String(def) : '',
                required: q.required, secret: q.secret,
            };
        });
    }
    return sheet;
}
