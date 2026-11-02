/**
 * @file src/services/dataproduct/build.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Building a data product: resolve every source as the caller, combine, check the
 *   audience and the personal columns, and publish one version through the data package publish
 *   service, or (a preview) build it without storing (plan doc-mvwxcas3dom3, D9.3, D9.4, D9.9).
 *
 *   ONE PUBLISH CODE PATH. A build reaches services/datapackage/store.ts publishPackage after the
 *   publish gate POST /v1/datapackages asks (datapackagePublishGate), so versions, the content hash,
 *   `supersedes`, the audience, provenance and the catalogue entry are what every other producer gets.
 *   The same rows give the same hash, so a second build of unchanged material answers `unchanged`
 *   and no new version: the change description is made from the sources and the row counts only, and
 *   the fetch times are outside the hash (AimeatBlock.sourcesFetchedAt).
 *
 *   REFUSE BEFORE YOU WRITE. A source that fails, an audience wider than the narrowest source
 *   (AUDIENCE_WIDER_THAN_SOURCE), a personal column in a public product without the owner's
 *   confirmation (PERSONAL_DATA_PUBLIC, the code of the D1.7 guard) and a row that fails its schema all
 *   stop the build before anything is stored, so the package stays on its previous version.
 * @structure BuildContext · prepareBuild · previewProduct · runProduct
 * @usage const out = await runProduct({ deps, caller }, definition);
 * @version-history
 *   v1.3.0 — 2026-11-01 — A definition's `attribution` and `i18n` go into the version (WP10e A2, A3).
 *   v1.2.0 — 2026-11-01 — A version a source change built records the producer schedule on-change (WP9c).
 *   v1.1.0 — 2026-11-01 — A definition's `retention` is the version's retention policy (WP9a).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9).
 */
import type { CallerContext } from '../caller-context.js';
import type { PublishInput, TableSchema } from '../datapackage/contract.js';
import { publishPackage } from '../datapackage/store.js';
import { inferSchema, validateRows, type ValidationIssue } from '../datapackage/table.js';
import { datapackagePublishGate, fileDatapackageAsk } from '../datapackage/publish-ask.js';
import { closedNodeWarnings } from '../closed-node-level.js';
import { descriptorToOdps, odpsToYamlDocument } from '../datapackage/odps.js';
import { odpsAddress } from '../datapackage/odps-read.js';
import { dataHolderFor } from '../datapackage/data-holder.js';
import { PERSONAL_DATA_PUBLIC } from '../datapackage/personal-guard.js';
import { emitChange } from '../event-bus.js';
import { DataProductError, scheduleLabelOf, type DataProductDefinition } from './definition.js';
import { combineSources, type Combined } from './combine.js';
import { type ResolvedSource, type SourceCall, type SourceDeps, audienceFits, narrowest } from './source-common.js';
import { readRecordsSource, readAppSource, readMemorySource } from './sources-memory.js';
import { readExtensionSource, readFileSource, readDatapackageSource } from './sources-io.js';

export interface BuildContext {
    deps: SourceDeps;
    caller: CallerContext;
    /** The app an app grant's request comes from (`req.auth.app`), for the publish gate. */
    app?: string;
    /** The schedule that fired this build, when one did. */
    schedule?: string;
}

/** One source, read by its kind. */
async function resolveSource(call: SourceCall, exporting: boolean): Promise<ResolvedSource> {
    switch (call.spec.kind) {
        case 'records': return readRecordsSource(call);
        case 'app': return readAppSource(call, exporting);
        case 'memory': return readMemorySource(call, exporting);
        case 'extension': return readExtensionSource(call);
        case 'file': return readFileSource(call, exporting);
        case 'datapackage': return readDatapackageSource(call);
    }
}

export interface Prepared {
    sources: ResolvedSource[];
    combined: Combined;
    input: PublishInput;
    /** The narrowest audience the sources allow. */
    allowed: string;
    /** Why a version at the definition's audience would be refused, before any publish is asked. */
    refusal?: DataProductError;
}

/** Read every source, combine, and name what a publish at the definition's audience would refuse. */
export async function prepareBuild(ctx: BuildContext, def: DataProductDefinition): Promise<Prepared> {
    const exporting = def.visibility !== 'private';
    const sources: ResolvedSource[] = [];
    for (const spec of def.sources) {
        sources.push(await resolveSource({ deps: ctx.deps, caller: ctx.caller, spec, productName: def.name }, exporting));
    }
    const combined = combineSources(def, sources);
    const allowed = narrowest(sources.map(s => s.audience));
    let refusal: DataProductError | undefined;
    const tooWide = sources.find(s => !audienceFits(def.visibility, s.audience));
    if (tooWide) {
        refusal = new DataProductError('AUDIENCE_WIDER_THAN_SOURCE',
            `The product's audience "${def.visibility}" is wider than source ${tooWide.id} allows ("${tooWide.audience}", from ${tooWide.provenance.address}). `
            + `The widest audience these sources allow is "${allowed}". Choose that or narrower, or widen the source first.`, 409, tooWide.id,
            { allowed, source_kind: tooWide.provenance.kind, source_audience: tooWide.audience });
    } else if (def.visibility === 'public' && combined.personalIncluded.length && !def.confirmPersonalPublic) {
        refusal = new DataProductError(PERSONAL_DATA_PUBLIC,
            `The columns ${combined.personalIncluded.join(', ')} are data the data map marks personal, and the product would be public. `
            + 'Nothing was written. Leave those columns out, choose a narrower audience, or, when the owner agrees, define it again with confirm_personal_public: true.', 409);
    }
    const rows = combined.resources.reduce((n, r) => n + r.rows.length, 0);
    const fetchedAt = Object.fromEntries(sources.map(s => [s.id, s.fetchedAt]));
    const lineage = sources.map(s => s.lineage).filter((l): l is string => !!l);
    const input: PublishInput = {
        name: def.name,
        // Made from the sources and the counts only, so a build of the same rows hashes the same.
        changes: `Built by the data product "${def.name}" from ${sources.map(s => `${s.id} (${s.provenance.kind})`).join(', ')}: `
            + `${rows} row${rows === 1 ? '' : 's'} in ${combined.resources.length} resource${combined.resources.length === 1 ? '' : 's'}.`,
        resources: combined.resources.map(r => ({ name: r.name, rows: r.rows, schema: r.schema })),
        ...(def.title ? { title: def.title } : {}),
        ...(def.description ? { description: def.description } : {}),
        ...(def.keywords?.length ? { keywords: def.keywords } : {}),
        provenance: {
            sources: sources.map(s => ({ id: s.id, kind: s.provenance.kind, address: s.provenance.address, role: 'source',
                ...(s.provenance.title ? { title: s.provenance.title } : {}), ...(s.provenance.license ? { license: s.provenance.license } : {}) })),
            ...(combined.transformations.length ? { transformations: combined.transformations } : {}),
            ...(lineage.length ? { lineage } : {}),
            ...(def.license ? { license: def.license } : {}),
            ...(def.attribution ? { attribution: def.attribution } : {}),
            ...(def.i18n ? { i18n: def.i18n } : {}),
            sourcesFetchedAt: fetchedAt,
        },
        ...(def.confirmPersonalPublic ? { confirmPersonalPublic: true } : {}),
        ...(def.retention ? { retentionPolicy: def.retention } : {}),
    };
    return { sources, combined, input, allowed, ...(refusal ? { refusal } : {}) };
}

const PREVIEW_ROWS = 20;

/** Build without publishing: rows, counts, schema, validation, and the ODPS sheet the version would get. */
export async function previewProduct(ctx: BuildContext, def: DataProductDefinition): Promise<Record<string, unknown>> {
    const prepared = await prepareBuild(ctx, def);
    const { combined, sources } = prepared;
    const issues: ValidationIssue[] = [];
    const schemas: Record<string, TableSchema> = {};
    for (const r of combined.resources) {
        const schema = r.schema === 'infer' ? inferSchema(r.rows) : r.schema;
        schemas[r.name] = schema;
        issues.push(...validateRows(r.name, r.rows, schema));
    }
    const base = {
        name: def.name, audience: def.visibility, allowed_audience: prepared.allowed,
        sources: sources.map(s => ({ id: s.id, kind: s.provenance.kind, address: s.provenance.address, rows: s.rows.length, audience: s.audience,
            ...(s.personal.size ? { personal_columns: [...s.personal] } : {}) })),
        resources: combined.resources.map(r => ({ name: r.name, row_count: r.rows.length, schema: schemas[r.name], rows: r.rows.slice(0, PREVIEW_ROWS) })),
        transformations: combined.transformations,
        validation: { ok: issues.length === 0, issues },
        published: false,
    };
    if (prepared.refusal) return { ...base, publish_check: { ok: false, code: prepared.refusal.code, message: prepared.refusal.message } };
    if (issues.length) return { ...base, publish_check: { ok: false, code: 'QUALITY_GATE', message: `${issues.length} row/column problem(s); a run would write no version.` } };
    const ownerGhii = ctx.caller.ownerGhii;
    const dry = await publishPackage({ storage: ctx.deps.storage, config: ctx.deps.config }, ownerGhii, { ...prepared.input, visibility: def.visibility },
        { gaii: ctx.caller.principal, kind: 'dataproduct', ref: `dataproducts.${def.name}` }, { dryRun: true });
    if (!dry.ok) return { ...base, publish_check: { ok: false, code: dry.code, message: dry.message } };
    const doc = descriptorToOdps({
        descriptor: dry.descriptor, ownerGhii, baseUrl: ctx.deps.config.baseUrl, descriptorUrl: dry.descriptorUrl, audience: def.visibility,
        dataHolder: await dataHolderFor(ctx.deps, ownerGhii, def.visibility),
        resourceUrls: Object.fromEntries(dry.resources.map(r => [r.name, r.url])),
    });
    return {
        ...base, publish_check: { ok: true },
        content_hash: dry.contentHash, unchanged: dry.unchanged,
        odps: doc, odps_yaml: odpsToYamlDocument(doc),
    };
}

export interface RunOutcome {
    package_id: string; content_hash: string; descriptor_url: string; odps_url: string; unchanged: boolean;
    rows: number; resources: Array<{ name: string; url: string; rowCount: number; bytes: number }>;
    sources: Array<{ id: string; rows: number; fetchedAt: string }>;
    publish_request?: unknown; warnings?: unknown[];
}

/** Build and publish one version. Throws DataProductError; nothing is stored when it throws. */
export async function runProduct(ctx: BuildContext, def: DataProductDefinition): Promise<RunOutcome> {
    const prepared = await prepareBuild(ctx, def);
    if (prepared.refusal) throw prepared.refusal;
    const store = { storage: ctx.deps.storage, config: ctx.deps.config };
    const ownerGhii = ctx.caller.ownerGhii;
    // The gate POST /v1/datapackages asks: an agent without publish:public publishes at the audience
    // the package had, and the request is filed after.
    const gate = await datapackagePublishGate(store, ctx.caller, ctx.app, ownerGhii, def.name, def.visibility);
    if (gate.kind === 'refused') throw new DataProductError(gate.code, gate.message, gate.status);
    const out = await publishPackage(store, ownerGhii, { ...prepared.input, ...(gate.visibility !== undefined ? { visibility: gate.visibility } : {}) }, {
        gaii: ctx.caller.principal, kind: 'dataproduct', ref: `dataproducts.${def.name}`,
        ...(ctx.schedule ? { schedule: ctx.schedule } : scheduleLabelOf(def) ? { schedule: scheduleLabelOf(def) } : {}),
    });
    if (!out.ok) {
        const first = out.issues?.[0];
        const detail = first ? ` First: row ${first.row ?? '?'}, field "${first.field ?? '?'}": ${first.message}.` : '';
        throw new DataProductError(out.code, out.message + detail, out.code === 'QUALITY_GATE' ? 422 : out.code === PERSONAL_DATA_PUBLIC ? 409 : 400);
    }
    emitChange('files');
    const asked = gate.requester
        ? await fileDatapackageAsk(store, ctx.caller.owner, gate.requester, ownerGhii, def.name, out.contentHash, gate.from)
        : closedNodeWarnings(gate.warning);
    return {
        package_id: out.descriptor.aimeat.packageId, content_hash: out.contentHash, descriptor_url: out.descriptorUrl,
        odps_url: odpsAddress(ctx.deps.config.baseUrl, ctx.caller.owner, def.name, out.contentHash),
        unchanged: out.unchanged, rows: out.resources.reduce((n, r) => n + r.rowCount, 0), resources: out.resources,
        sources: prepared.sources.map(s => ({ id: s.id, rows: s.rows.length, fetchedAt: s.fetchedAt })),
        ...(asked.publish_request ? { publish_request: asked.publish_request } : {}),
        ...(asked.warnings?.length ? { warnings: asked.warnings } : {}),
    };
}
