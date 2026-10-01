/**
 * @file services/package-config-needs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a package, or every package of an install bundle, needs the customer to give
 *   before it works: the questions a shop asks before payment (install packages, phase 5).
 *
 *   WHY. A shop sells a bundle before the customer's node exists, and until now the settings the
 *   apps need were known only to that node's own dry run, after the sale. aimeat-commercial filed it
 *   as wish-asennuspaketin-pakolliset-asetukset-pit-isi-tiet-ennen-kuin-, and Jouni approved the fix
 *   on 2026-09-28: the repository answers from the packages it holds, and the shop's agent asks with
 *   the permission it grants with.
 *
 *   ONE READING OF THE DECLARATIONS. The answer is planPackageConfig() over each package's parts, with
 *   the bundle's defaults given, so a field the bundle already fills is not asked again, and a field
 *   the install would refuse without is exactly a `required` question here. App fields come from the
 *   app's `aimeat-config` schema; extension fields from its manifest, and a `type: secret` field is a
 *   secret question, whose answer goes in the install set's secrets file, never in the set.
 * @structure ConfigQuestion · packageConfigNeeds()
 * @usage
 *   const out = await packageConfigNeeds(storage, config, { owner, isOperator }, groupId);
 * @version-history
 *   v1.1.0 — 2026-10-01 — A public package's questions are readable by anyone on this node, so its
 *     installer can answer them first; `questionsOf` is exported for the package sheet.
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 5).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageRecord, InstalledComponent } from '../storage/interface.js';
import { bundleOfPackage } from './install-set-spec.js';
import { planPackageConfig, configPreview } from './package-config.js';

/** One thing to ask. `package` and `component` place the answer in the install set's config or secrets. */
export interface ConfigQuestion {
    package: string;
    component: string;
    field: string;
    kind: 'app' | 'extension';
    required: boolean;
    secret: boolean;
    /** The field's JSON Schema, for an app field: type, title, description, enum, format, default. */
    schema?: Record<string, unknown>;
}

export type ConfigNeedsResult =
    | { ok: true; group_id: string; version: string; bundle: boolean; name: string; questions: ConfigQuestion[]; defaults: Record<string, Record<string, Record<string, unknown>>>; problems: string[] }
    | { ok: false; status: number; code: string; message: string };

const notFound = (groupId: string): ConfigNeedsResult => ({ ok: false, status: 404, code: 'NOT_FOUND', message: `Package not found: ${groupId}` });

/** The questions for one package, with `defaults` already given. Also read by services/package-sheet.ts. */
export function questionsOf(
    pkg: PackageRecord, defaults: Record<string, Record<string, unknown>>, config: AimeatConfig,
): { ok: true; questions: ConfigQuestion[] } | { ok: false; problem: string } {
    const planned: InstalledComponent[] = pkg.components.map(c => ({ componentId: c.id, type: c.type, registeredAs: c.id, originalHash: '', customized: false }));
    const plan = planPackageConfig(pkg.components, planned, defaults, { config, owner: pkg.author });
    if (!plan.ok) return { ok: false, problem: `${pkg.packageGroupId}: ${plan.code}: ${plan.message}` };
    const questions: ConfigQuestion[] = [];
    for (const part of configPreview(plan)) {
        const component = String(part.component_id);
        if (part.type === 'app') {
            const schema = part.schema as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
            const given = new Set(part.given as string[]);
            const missing = new Set((part.missing as Array<{ field: string }>).map(m => m.field));
            for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
                if (given.has(field)) continue;
                questions.push({ package: pkg.packageGroupId, component, field, kind: 'app', required: missing.has(field), secret: false, schema: fieldSchema });
            }
            continue;
        }
        const given = new Set(part.given as string[]);
        const secrets = new Set(part.secret_fields as string[]);
        for (const field of part.fields as string[]) {
            if (given.has(field)) continue;
            // An extension's manifest says which fields are secret but not which are required: a secret
            // the node cannot hold for the customer is the one thing the install cannot do without.
            questions.push({ package: pkg.packageGroupId, component, field, kind: 'extension', required: secrets.has(field), secret: secrets.has(field) });
        }
    }
    return { ok: true, questions };
}

/**
 * The questions a package or a bundle asks, for its author or an operator, and for anyone when the
 * package is public (a private package is the author's, as for the shop's sale flow; the packages are private,
 * and the shop's agent is the author's). For a bundle, every package it lists, with the bundle's
 * defaults; a listed package this node does not hold is named in `problems`.
 */
export async function packageConfigNeeds(
    storage: Storage, config: AimeatConfig, caller: { owner: string; isOperator: boolean }, groupId: string,
): Promise<ConfigNeedsResult> {
    const readable = async (g: string): Promise<PackageRecord | null> => {
        const pkg = await storage.getLatestPublished(g);
        if (!pkg) return null;
        // A public package is installable by anyone here, so anyone here may ask what it asks:
        // the questions are the install's own, and a person or their AI answers them before
        // pressing install rather than after a refusal (guided journey P3). A private package stays
        // with its author and the operator, as the shop's sale flow needs.
        return pkg.author === caller.owner || caller.isOperator || pkg.visibility === 'public' ? pkg : null;
    };
    const root = await readable(groupId);
    if (!root) return notFound(groupId);
    const bundle = bundleOfPackage(root);
    if (bundle && !bundle.ok) return { ok: false, status: 400, code: 'INVALID_BUNDLE', message: bundle.message };

    const questions: ConfigQuestion[] = [];
    const problems: string[] = [];
    const defaults: Record<string, Record<string, Record<string, unknown>>> = {};
    const members = bundle ? bundle.value.packages.map(p => ({ groupId: p.groupId, defaults: p.config })) : [{ groupId, defaults: {} }];
    for (const m of members) {
        const pkg = m.groupId === groupId ? root : await readable(m.groupId);
        if (!pkg) { problems.push(`${m.groupId}: NOT_FOUND: this node holds no published version you may read.`); continue; }
        if (Object.keys(m.defaults).length) defaults[m.groupId] = m.defaults;
        const out = questionsOf(pkg, m.defaults, config);
        if (!out.ok) { problems.push(out.problem); continue; }
        questions.push(...out.questions);
    }
    return {
        ok: true, group_id: groupId, version: root.version, bundle: !!bundle,
        name: bundle ? bundle.value.name : root.name, questions, defaults, problems,
    };
}
