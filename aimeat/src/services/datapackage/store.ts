/**
 * @file src/services/datapackage/store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Publishing and reading an AIMEAT Data Package — the one implementation the three
 *   bindings (ctx.datapackage, the browser library, the MCP tools) all reach.
 *
 *   REFUSE BEFORE YOU WRITE. `publish` validates every resource against its own Table Schema and
 *   returns the coordinates of what is wrong WITHOUT having stored a byte. The order is the point:
 *   this node's own audit found three defects of exactly one shape — bytes written before the name
 *   was claimed, a paywall standing down before comparing the coordinate, a response sent before the
 *   work it announced. A publish that wrote the CSV and then discovered the schema was violated would
 *   leave a half-version at a permanent address, which is worse than no version at all.
 *
 *   AND A FAILED RUN LEAVES THE PREVIOUS VERSION STANDING. `recordFailure` writes the reason onto
 *   the mutable `latest.json` pointer and touches nothing else, so a consumer following the newest
 *   version keeps reading the last good one and can see that the newest attempt failed, when, and
 *   why. No empty version, no truncated version, no silent success.
 *
 *   TWO SURFACES, ONE TRUTH. The BYTES in storage are canonical — a permanent, auth-free,
 *   range-readable address that DuckDB, pandas and frictionless-py read with no AIMEAT knowledge.
 *   The knowledge package written beside them is a CATALOGUE entry (`content_type: 'dataset'`, the
 *   value the closed union already has — `data-package` is not in it) so the package appears where a
 *   person and an agent look for knowledge. The catalogue points at the bytes; it never holds them,
 *   because a knowledge package is a collection of memory entries and memory does not carry files.
 * @structure publishPackage · openPackage · readRows · readAllRows · recordFailure · listPackages
 * @usage
 *   const out = await publishPackage({ storage, config }, ownerGhii, input, producedBy);
 *   if (!out.ok) return out.issues;
 * @version-history
 *   2026-11-03 — publishPackage checks provenance.i18n (normaliseI18n) and provenance.attribution
 *     (text) for every caller, so POST /v1/datapackages refuses what the data product path refuses.
 *   2026-11-01 — WP10e: `licenses[]` names the deed and the licence's name (./licences.ts); a version's
 *     row count and bytes in the history are the sum over its resources, not the first one's; a publish
 *     that points the package back at bytes it had earlier records that return (./version-returns.ts).
 *   2026-11-01 — The personal-data guard reads the confirmation the service recorded on the audience
 *     record, not the pointer's (WP9e, plan D1.7).
 *   2026-11-01 — openPackage, and a publish of the same bytes after a withdrawal, take the withdrawal
 *     from the service's record (./audience-record.ts trustedAudienceOf withdrawnAt), not the pointer's
 *     mark alone (WP9e).
 *   2026-11-01 — pruneOldVersions moved to ./retention.ts, where a version a live named share pins is
 *     kept; a successful publish emits the `datapackages` change to the owner's streams, and a new
 *     version tells the parties whose share pins the superseded one (./share-notices.ts; plan D6.2, D6.4).
 *   2026-11-01 — openPackage names the package to datapackageReadable, so an outside party's reader opens
 *     the package its share names; its rows pass the classification reader as no account (plan D3.2).
 *   2026-11-01 — publishPackage takes `{ dryRun: true }`: every check runs and the version is built,
 *     nothing is stored and no provenance record is made; a data product preview reads it (plan
 *     doc-mvwxcas3dom3, D9.4). ProducedBy.kind may be 'dataproduct'.
 *   2026-11-01 — A publish to public whose producer's data map marks its data personal is refused with
 *     PERSONAL_DATA_PUBLIC before any write, unless the input confirms (confirmPersonalPublic); the
 *     confirmation is recorded on the pointer (./personal-guard.ts; plan doc-mvwxcas3dom3, D1.7).
 *     ProducedBy names the app or extension for that check; neither is stored.
 *   2026-11-01 — openPackage answers null for a withdrawn package (./withdraw.ts), so every read path
 *     refuses it; a publish of the same bytes after a withdrawal writes the catalogue entry back, and
 *     any publish writes a pointer without the withdrawal (plan doc-mvwxcas3dom3, D0.3).
 *   2026-11-01 — A publish stores no odps.yaml: the product sheet is projected when it is read, from the
 *     version's audience (./odps-read.ts). The stored one said public and "No authentication" for every
 *     package (plan doc-mvwxcas3dom3, D0.1).
 *   2026-10-31 — The reads decide on the audience the service recorded (./audience-record.ts), not on
 *     the pointer's or the tag's own word, which the generic storage routes write; openPackage answers
 *     openToAnyone for the OData cache header; the rows of a resource pass the classification
 *     reader GET /v1/pub runs on the same CSV (secaudit2026oct31w2 round 10, W2-14, W2-15, W2-20).
 *   2026-10-21 — The descriptor file of a new version carries the version's audience as a tag, and an
 *     earlier version is opened and listed on that audience (capability-loss review of v42: an
 *     organism or members reader keeps the earlier versions after the newest goes public).
 *   2026-10-20 — openPackage, readRows and readAllRows take a DatapackageReader (roles and scopes too):
 *     a principal of the owner other than the owner in person reads a non-public package only with
 *     storage:read (secaudit 2026-10 v41). A pinned earlier version opens to a reader who does not
 *     read as the owner only at the tier its files were stored at, and listVersions takes the reader
 *     and leaves out the versions it cannot open (secaudit 2026-10 v42).
 *   2026-10-18 — On a node that shows its content to signed-in accounts only, a version that would make
 *     the package public (named or by the default) is published at 'members' (plan V1.6).
 *   2026-10-18 — A version published without a visibility takes visibility.datapackage_default (code
 *     default public; plan doc-mvcn6c7e4e5q, V5.6). A pointer stored with no visibility still reads public.
 *   2026-10-18 — writeLatest and upsertCatalogueEntry moved to ./version-audience.ts. A publish of bytes
 *     already stored gives the version's files, the pointer and the catalogue entry the audience asked
 *     for (setVersionAudience); it moved the pointer only, so a private version published again as
 *     public stayed private at its file addresses (plan doc-mvcn6c7e4e5q, V4).
 *   2026-10-17 — A publish takes `visibility` (public by default, members, organism:<id>, private;
 *     ./audience.ts): an organism the publisher is not in is refused before any write, the files, the
 *     pointer and the catalogue entry carry it, and openPackage, readRows and readAllRows take the
 *     reader and answer null to one the audience does not admit (plan doc-mvcn6c7e4e5q, V3.8).
 *   2026-10-15 — readAllRows: every row of one resource, for the OData feed, which pages the answer itself instead of reading a 5 000-row window (feature-list audit #151, #193).
 *   v1.2.0 -- 2026-10-13 -- The catalogue manifest names its pacing amount sharing.toll_morsels, the
 *     4.0.0 name (decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll).
 *   v1.1.0 -- 2026-10-08 -- The provenance record hashes the exact stored descriptor bytes (held until the
 *     descriptor is written, then stored), the descriptor file and the catalogue rows carry its id, and a
 *     re-publish of bytes already there stores no new record and names the one those bytes carry.
 *   v1.0.3 -- 2026-10-08 -- The package's provenance record states `mediaKind: data`.
 *   v1.0.2 -- 2026-09-26 -- The owner's account name comes from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.0.1 -- 2026-09-05 -- Notifies MCP through mcp/resource-events.ts, the leaf, rather than
 *            mcp/index.ts, which assembles the registry that imports this store back (a cycle the
 *            dependency cruiser refused once ai-jobs' on_done reached here through the extension road).
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, A4/B1/B2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AiProvenanceRecordRow } from '../../storage/interface.js';
import { writeStorageFile } from '../storage-file-write.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/resource-events.js';
import {
    provenanceForWrite, storeHeldProvenance, contentHashOf as recordHashOf, type DeclaredProvenance,
} from '../ai-provenance.js';
import { stableStringify } from '../../utils/stable-json.js';
import { logger } from '../../utils/logger.js';
import { localAccountName } from '../../utils/gaii.js';
import {
    type Descriptor, type DescriptorResource, type LatestPointer, type PublishInput, type TableSchema,
    bare, bytesHash, contentHashOf, descriptorKey, latestKey, packageId, packageKeyRoot,
    publicUrl, resourceKey, resourcePath, validateName, RESOURCE_NAME_RE,
} from './contract.js';
import { inferSchema, toCsv, fromCsv, validateRows, type ValidationIssue } from './table.js';
import { frictionlessLicence } from './licences.js';
import { recordVersionReturn, readVersionReturns } from './version-returns.js';
import { linkSourceImages } from './images.js';
import { checkAudienceWrite } from '../audience-write.js';
import {
    DATAPACKAGE_LEVELS, fileVisibilityOf, datapackageReadable, versionOpenTo, withAudienceTag, type DatapackageReader,
} from './audience.js';
import { writeLatest, upsertCatalogueEntry, setVersionAudience, readPointer, readTrustedVisibility } from './version-audience.js';
import { trustedAudienceOf } from './audience-record.js';
import { readerFor, type ReaderAuth } from '../classification/reader.js';
import { fileTarget } from '../classification/labels.js';
import { signedInOnly } from '../../config-visibility.js';
import { closedNodeLevel } from '../closed-node-level.js';
import { datapackageVisibilityDefault } from '../content-defaults.js';
import { personalPublicGuard, PERSONAL_DATA_PUBLIC } from './personal-guard.js';
import { pruneOldVersions } from './retention.js';
import { noticeSuperseded } from './share-notices.js';
import { emitChange } from '../event-bus.js';
import { DATAPACKAGES_DOMAIN } from './contract.js';
import { normaliseI18n } from '../dataproduct/definition.js';

export interface StoreDeps { storage: Storage; config: AimeatConfig }

/**
 * Point the held (not yet stored) records at the exact bytes that will be stored. The descriptor
 * file carries its record's id, so its bytes exist only after the record was built; until 2026-10-08
 * the record hashed a compact serialisation without the id, and the by-hash lookup of the bytes a
 * reader downloads found nothing. A record the caller attached already exists and is not touched.
 */
function rehashHeldTo(held: AiProvenanceRecordRow[], bytes: Buffer): void {
    const hash = recordHashOf(bytes);
    for (const row of held) {
        row.contentHash = hash;
        if (row.record.attestation) row.record.attestation.contentHash = hash;
    }
}

/** Who produced this version. Every road knows it; none of them may make it up. */
export interface ProducedBy {
    /** The exact principal: an owner GHII, an agent GAII, or the owner on an unattended road. */
    gaii: string;
    kind: Descriptor['aimeat']['producer']['kind'];
    ref?: string;
    schedule?: string;
    run?: string;
    /** `owner/filename` of the app whose grant published (the token's own app id). Not stored: it
     *  links the publish to the app's data map (./personal-guard.ts). */
    app?: string;
    /** The extension whose action published. Not stored, for the same check. */
    extension?: string;
}

export type PublishResult =
    | { ok: true; descriptor: Descriptor; contentHash: string; descriptorUrl: string; unchanged: boolean;
        resources: Array<{ name: string; url: string; rowCount: number; bytes: number }>;
        /** Versions the owner's retention policy removed on this publish. Empty when no policy is
         *  set, which is the default: keep everything. Returned so the answer can SAY what was
         *  deleted — a deletion nobody can see is how a history disappears unnoticed. */
        pruned: string[];
        /** True for a dry run: nothing was stored. */
        dryRun?: boolean }
    | { ok: false; code: 'INVALID_INPUT' | 'QUALITY_GATE' | 'NOT_ORGANISM_MEMBER' | typeof PERSONAL_DATA_PUBLIC; message: string; issues: ValidationIssue[] };

/**
 * Build, check and store one version.
 *
 * `unchanged: true` means the content hash matched what is already published: the same address
 * already holds these exact bytes, so nothing was rewritten. That is not a failure and not a new
 * version — it is a deterministic producer proving it is deterministic, and the caller should say
 * so rather than announcing an update that did not happen.
 */
export async function publishPackage(
    deps: StoreDeps, ownerGhii: string, input: PublishInput, producedBy: ProducedBy,
    /** dryRun: check and build the version, store nothing (services/dataproduct preview). */
    opts: { dryRun?: boolean } = {},
): Promise<PublishResult> {
    const { storage, config } = deps;
    const ownerName = localAccountName(ownerGhii);

    const nameError = validateName(input.name);
    if (nameError) return { ok: false, code: 'INVALID_INPUT', message: nameError, issues: [] };
    if (!input.changes || !input.changes.trim()) {
        return {
            ok: false, code: 'INVALID_INPUT', issues: [],
            message: 'changes is required: every version says what moved against the previous one and why. '
                + 'A version nobody explained is a version a consumer cannot decide about.',
        };
    }
    if (!Array.isArray(input.resources) || input.resources.length === 0) {
        return { ok: false, code: 'INVALID_INPUT', message: 'a package needs at least one resource', issues: [] };
    }
    // Who to credit and the words per language go into the content hash, so they are checked here,
    // on every caller, with the data product's own rule (dataproduct/definition.ts normaliseI18n).
    const i18n = normaliseI18n(input.provenance?.i18n);
    if (typeof i18n === 'string') return { ok: false, code: 'INVALID_INPUT', message: i18n, issues: [] };
    const attribution: unknown = input.provenance?.attribution;
    if (attribution !== undefined && typeof attribution !== 'string') {
        return { ok: false, code: 'INVALID_INPUT', message: 'provenance.attribution must be text.', issues: [] };
    }
    const provenance = { ...(input.provenance ?? {}) };
    delete provenance.i18n;
    delete provenance.attribution;
    if (attribution?.trim()) provenance.attribution = attribution.trim();
    if (i18n) provenance.i18n = i18n;
    // Who reads it, checked before anything is written: an organism the publisher is not in is
    // refused (services/audience-write.ts). When not named, the node's starting level (plan V5.6),
    // public unless the operator chose otherwise, as every package was before.
    let visibility = input.visibility ?? datapackageVisibilityDefault(config);
    // A closed node publishes a raise to public at 'members' (services/closed-node-level.ts, plan
    // V1.6). POST /v1/datapackages and the MCP tool lowered it already at the gate and say so; this
    // covers the extension capability and the workflow step, which call here directly.
    if (visibility === 'public' && signedInOnly(config)) {
        visibility = closedNodeLevel(config, visibility, 'members' as const, {
            from: await readTrustedVisibility(deps, ownerGhii, input.name),
        }).level;
    }
    const audience = await checkAudienceWrite(storage, visibility, { sub: producedBy.gaii, owner: ownerName }, DATAPACKAGE_LEVELS);
    if (!audience.ok) return { ok: false, code: audience.code, message: audience.message, issues: [] };
    const fileVisibility = fileVisibilityOf(visibility);
    // Public from personal data: the producer's data map marks its data personal, so the owner
    // confirms first (./personal-guard.ts). Refused before any write; a confirmation is recorded on
    // the service's audience record this publish writes (./audience-record.ts), and an earlier one is
    // read from there, never from the pointer file an app can rewrite.
    const recordedConfirmation = (await trustedAudienceOf(storage, config.nodeId, ownerGhii, input.name,
        await readPointer(deps, ownerGhii, input.name))).personalPublicConfirmed;
    const guard = await personalPublicGuard(deps, ownerGhii, input.name, visibility,
        { ...(producedBy.app ? { app: producedBy.app } : {}), ...(producedBy.extension ? { extension: producedBy.extension } : {}) },
        input.confirmPersonalPublic, recordedConfirmation);
    if (!guard.ok) return { ok: false, code: guard.code, message: guard.message, issues: [] };
    const personalPublicConfirmed = guard.confirmedAt ? { at: guard.confirmedAt, by: producedBy.gaii } : undefined;

    // ── 0.5 Pictures. BEFORE inference and before the hash, because a rewritten reference changes
    //        the bytes, and two publishes of the same photographs must land on the same address.
    //        It refuses here rather than later for the same reason everything else here does: a
    //        table pointing at a picture that is missing, or at somebody else's, is not written at
    //        all. → services/datapackage/images.ts
    const linked = await linkSourceImages({ storage, config }, ownerGhii, input.resources);
    if (!linked.ok) {
        return { ok: false, code: 'INVALID_INPUT', issues: [], message: linked.message };
    }

    // ── 1. Schema, then the gate. Nothing is serialised until every resource passes. ──
    const issues: ValidationIssue[] = [];
    const prepared: Array<{ name: string; schema: TableSchema; inferred: boolean; rows: Array<Record<string, unknown>>; title?: string; description?: string }> = [];
    for (const res of linked.resources) {
        if (!RESOURCE_NAME_RE.test(res.name)) {
            return { ok: false, code: 'INVALID_INPUT', issues: [],
                message: `resource name "${res.name}" must be lowercase letters, digits and dashes, 2-64 characters` };
        }
        if (!Array.isArray(res.rows)) {
            return { ok: false, code: 'INVALID_INPUT', message: `resource "${res.name}" has no rows array`, issues: [] };
        }
        const inferred = res.schema === 'infer';
        const schema = inferred ? inferSchema(res.rows) : (res.schema as TableSchema);
        if (!schema?.fields?.length) {
            return { ok: false, code: 'INVALID_INPUT', issues: [],
                message: `resource "${res.name}" has no fields — an empty schema describes nothing` };
        }
        issues.push(...validateRows(res.name, res.rows, schema));
        prepared.push({ name: res.name, schema, inferred, rows: res.rows, title: res.title, description: res.description });
    }
    if (issues.length > 0) {
        return {
            ok: false, code: 'QUALITY_GATE', issues,
            message: `${issues.length} row/column problem(s): the data does not validate against its own Table Schema, `
                + 'so no version was written and the package still stands on its previous one.',
        };
    }

    // ── 2. Serialise. Canonical CSV, hashed per resource. ──
    const bodies = prepared.map(p => {
        const data = toCsv(p.rows, p.schema);
        return { ...p, data, hash: bytesHash(data) };
    });

    const schemaSource: Descriptor['aimeat']['schemaSource'] =
        bodies.every(b => b.inferred) ? 'inferred' : bodies.some(b => b.inferred) ? 'mixed' : 'declared';

    const resources: DescriptorResource[] = bodies.map(b => ({
        name: b.name,
        path: resourcePath(b.name),
        profile: 'tabular-data-resource',
        format: 'csv',
        mediatype: 'text/csv',
        encoding: 'utf-8',
        schema: b.schema,
        rowCount: b.rows.length,
        bytes: b.data.length,
        hash: b.hash,
        ...(b.title ? { title: b.title } : {}),
        ...(b.description ? { description: b.description } : {}),
    }));

    // What this version replaces, read from the pointer BEFORE it moves. The caller may state a
    // lineage of its own — a package rebuilt from somebody else's, say — and an explicit claim wins;
    // otherwise it is simply the version that stood here a moment ago. Deriving it is the point: a
    // history that only exists when a producer remembers to fill a field is not a history.
    //
    // It is deliberately NOT in the content hash (see contentHashOf): "what I replaced" is where a
    // version sits, not what it contains, and hashing it would give the same rows two addresses
    // depending on whether anything came before.
    const previous = await readLatestPointer(deps, ownerGhii, input.name);
    const supersedes = input.provenance?.supersedes
        ?? (previous?.contentHash ? `${previous.packageId}@${previous.contentHash}` : undefined);

    const now = new Date().toISOString();
    const withoutHash = {
        name: input.name,
        profile: 'tabular-data-package' as const,
        resources,
        ...(input.title ? { title: input.title } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.keywords?.length ? { keywords: input.keywords } : {}),
        ...(input.provenance?.license ? { licenses: [frictionlessLicence(input.provenance.license)] } : {}),
        created: now,
        aimeat: {
            packageId: packageId(ownerName, input.name),
            changes: input.changes.trim(),
            producer: {
                kind: producedBy.kind,
                ...(producedBy.ref ? { ref: producedBy.ref } : {}),
                ...(producedBy.schedule ? { schedule: producedBy.schedule } : {}),
            },
            producedBy: { gaii: producedBy.gaii, ...(producedBy.run ? { run: producedBy.run } : {}), at: now },
            schemaSource,
            ...(input.parameters ? { parameters: input.parameters } : {}),
            ...provenance,
            ...(supersedes ? { supersedes } : {}),
            ...(input.retentionPolicy ? { retentionPolicy: input.retentionPolicy } : {}),
        },
    };
    const contentHash = contentHashOf(withoutHash);
    const descriptor: Descriptor = { ...withoutHash, aimeat: { ...withoutHash.aimeat, contentHash } };

    // A dry run (a data product preview) stops here: every refusal above was asked, nothing is stored,
    // no provenance record is made, and the answer says whether these bytes are already published.
    if (opts.dryRun) {
        const dryKey = descriptorKey(input.name, contentHash);
        return {
            ok: true, dryRun: true, descriptor, contentHash, pruned: [],
            descriptorUrl: publicUrl(config.baseUrl, ownerGhii, dryKey),
            unchanged: !!(await storage.getStorageFileMeta(ownerGhii, dryKey)),
            resources: bodies.map(b => ({ name: b.name, url: publicUrl(config.baseUrl, ownerGhii, resourceKey(input.name, contentHash, b.name)), rowCount: b.rows.length, bytes: b.data.length })),
        };
    }

    // TARGET-058: an agent publishing a package is model-touched output, and that gets DECLARED
    // rather than inferred from the shape of the caller. `provenanceForWrite` decides from the
    // PRINCIPAL whether a record is minted at all — an owner publishing through their own token is
    // never stamped — so this is one call rather than a branch here. It lands AFTER the hash on
    // purpose: a provenance id is a fresh UUID, and putting it inside the identity would make two
    // identical runs produce two versions.
    //
    // A new record is HELD (B8): the stored descriptor carries the record's id, so the record's hash
    // can only be taken of the exact stored bytes once the id is in them (rehashHeldTo below), and a
    // re-publish of bytes already there stores no record at all.
    const held: AiProvenanceRecordRow[] = [];
    const aiProvenanceId = await provenanceForWrite(storage, {
        principal: producedBy.gaii,
        content: stableStringify(descriptor),
        declaredId: input.declaredProvenanceId,
        declared: input.declaredProvenance as DeclaredProvenance | undefined,
        pipeline: `datapackage.publish.${producedBy.kind}`,
        mediaKind: 'data',
        // A published package is world-readable at a permanent address and is read by people as well
        // as programs, which is exactly the surface the disclosure rules are written for.
        surface: { visibility: fileVisibility, humanAudience: true },
        labelPolicy: config.aiLabelPublic,
        nodeId: config.nodeId,
        baseUrl: config.baseUrl,
        enabled: config.aiProvenance,
        held,
    });
    if (aiProvenanceId) descriptor.aimeat.aiProvenanceId = aiProvenanceId;

    // ── 3. Already published? The address carries the hash, so the same bytes are already there. ──
    const dKey = descriptorKey(input.name, contentHash);
    const existing = await storage.getStorageFile(ownerGhii, dKey);
    const descriptorUrl = publicUrl(config.baseUrl, ownerGhii, dKey);
    const resourceUrls = bodies.map(b => ({
        name: b.name,
        url: publicUrl(config.baseUrl, ownerGhii, resourceKey(input.name, contentHash, b.name)),
        rowCount: b.rows.length,
        bytes: b.data.length,
    }));
    if (existing) {
        // The bytes at this address are the earlier publish's, so the record they carry is the one
        // this answer names; the record held above was never stored.
        if (existing.aiProvenanceId) descriptor.aimeat.aiProvenanceId = existing.aiProvenanceId;
        else delete descriptor.aimeat.aiProvenanceId;
        // The same bytes under another audience: the version's files, the pointer and (when the
        // audience changed) the catalogue entry take the one asked for. Only the pointer moved
        // before, so the files kept the tier they were first written at (./version-audience.ts).
        // A withdrawn package lost its catalogue entry, so publishing it again writes the entry back.
        const moved = await setVersionAudience({ storage, config, emitResourceUpdated, emitResourceListChanged }, ownerGhii, input.name, contentHash, visibility, {
            catalogue: ((await readTrustedVisibility(deps, ownerGhii, input.name)) ?? 'public') !== visibility
                || !!(await trustedAudienceOf(storage, config.nodeId, ownerGhii, input.name, previous)).withdrawnAt,
            ...(personalPublicConfirmed ? { personalPublicConfirmed } : {}),
        });
        if (!moved.ok) return { ok: false, code: 'INVALID_INPUT', message: moved.message, issues: [] };
        // Bytes the package had earlier, and it stood on other bytes a moment ago: the history gets a
        // row for the return, so its newest row is the version the package stands on (./version-returns.ts).
        if (previous?.contentHash && bare(previous.contentHash) !== bare(contentHash)) {
            await recordVersionReturn(storage, ownerGhii, input.name, contentHash, previous.contentHash);
        }
        // The run succeeded, so the package's freshness moved: the owner's open pages re-read (D6).
        emitChange(DATAPACKAGES_DOMAIN, ownerGhii);
        // Nothing new was written, so nothing is pruned: retention trims what a NEW version pushed
        // out, and a re-publish of existing content pushed nothing out.
        return { ok: true, descriptor, contentHash, descriptorUrl, unchanged: true, resources: resourceUrls, pruned: [] };
    }

    // ── 4. Write. Bytes first, descriptor last: a descriptor is a promise about resources, and a
    //       reader that finds one must find what it points at. ──
    for (const b of bodies) {
        const written = await writeStorageFile({ storage, config, emitResourceUpdated, emitResourceListChanged }, ownerGhii, {
            key: resourceKey(input.name, contentHash, b.name),
            data: b.data,
            mimeType: 'text/csv; charset=utf-8',
            visibility: fileVisibility,
        });
        if (!written.ok) {
            return { ok: false, code: 'INVALID_INPUT', issues: [],
                message: `storing resource "${b.name}" failed: ${written.message}` };
        }
    }
    const descriptorBytes = Buffer.from(JSON.stringify(descriptor, null, 2) + '\n', 'utf8');
    rehashHeldTo(held, descriptorBytes);
    const wroteDescriptor = await writeStorageFile({ storage, config, emitResourceUpdated, emitResourceListChanged }, ownerGhii, {
        key: dKey,
        data: descriptorBytes,
        mimeType: 'application/json; charset=utf-8',
        visibility: fileVisibility,
        // The version's own audience, which an earlier version is read on once the pointer moves on
        // (./audience.ts versionOpenTo). A tag, so the descriptor's bytes stay the version's identity.
        tags: withAudienceTag([], visibility),
        // The descriptor file names its record, so GET /v1/pub serves its marks and the by-hash
        // lookup of the bytes a reader downloaded finds it.
        ...(aiProvenanceId ? { aiProvenanceId } : {}),
    });
    if (!wroteDescriptor.ok) {
        return { ok: false, code: 'INVALID_INPUT', message: `storing the descriptor failed: ${wroteDescriptor.message}`, issues: [] };
    }
    await storeHeldProvenance(storage, held);

    // The product sheet is NOT stored: it is projected from the descriptor and the version's audience
    // when it is read (./odps-read.ts, GET /v1/datapackages/{owner}/{name}/odps), so it states the
    // audience the version has now. A sheet stored at publish said public for every package.

    await writeLatest({ storage, config, emitResourceUpdated, emitResourceListChanged }, ownerGhii, input.name, contentHash, descriptorUrl, now, visibility,
        personalPublicConfirmed ? { personalPublicConfirmed } : {});
    // Retention, if the owner asked for any. AFTER the new version is live and the pointer moves,
    // never before: pruning first would leave a window where the newest version is gone and the new
    // one is not yet published.
    const pruned = input.retentionPolicy
        ? await pruneOldVersions(deps, ownerGhii, input.name, input.retentionPolicy, contentHash)
        : [];
    await upsertCatalogueEntry(deps, ownerGhii, descriptor, descriptorUrl, visibility).catch(err => {
        // The bytes ARE the package; the catalogue is where a person finds it. A catalogue failure
        // must not un-publish a version that is already at its permanent address, and it must not be
        // swallowed either — an operator seeing this knows a package is live and unlisted.
        logger.warn('datapackage: catalogue entry failed, the package is published and unlisted', {
            package: descriptor.aimeat.packageId, error: String(err),
        });
    });
    // A new version is live: the owner's open pages re-read (D6), and each party whose share pins the
    // version this one superseded is told by mail (./share-notices.ts, D6.2). In the background.
    emitChange(DATAPACKAGES_DOMAIN, ownerGhii);
    if (previous?.contentHash && bare(previous.contentHash) !== bare(contentHash)) {
        void noticeSuperseded(deps, ownerGhii, input.name, previous.contentHash, contentHash)
            .catch(err => logger.warn('datapackage: the superseded notices failed', { package: descriptor.aimeat.packageId, error: String(err) }));
    }

    return { ok: true, descriptor, contentHash, descriptorUrl, unchanged: false, resources: resourceUrls, pruned };
}

/** The pointer as it stands now, or null when this package has never published a version. A pointer
 *  that carries only a recorded failure counts as "nothing published yet", because there is no
 *  version at it to supersede. */
async function readLatestPointer(deps: StoreDeps, ownerGhii: string, name: string): Promise<LatestPointer | null> {
    const file = await deps.storage.getStorageFile(ownerGhii, latestKey(name));
    if (!file) return null;
    try {
        const pointer = JSON.parse(file.data.toString('utf8')) as LatestPointer;
        return pointer.contentHash ? pointer : null;
    } catch (err) {
        // A pointer we cannot read is a broken pointer, and it must not silently become "no previous
        // version" — that would publish a version claiming to supersede nothing and quietly break
        // the chain. Refusing the publish is louder and correct.
        throw new Error(`latest.json for "${name}" is not readable JSON, so the version chain cannot be `
            + 'continued honestly', { cause: err });
    }
}

/**
 * A run failed. The package stays on the version it had; the pointer says the newest attempt did not
 * land, when, and why. This is the whole of "epäonnistuminen näkyy, eikä sitä peitetä": no empty
 * version is written, and a consumer polling `latest.json` learns the difference between a package
 * that has not changed and one whose producer is broken.
 */
export async function recordFailure(
    deps: StoreDeps, ownerGhii: string, name: string, message: string,
): Promise<void> {
    const key = latestKey(name);
    const existing = await deps.storage.getStorageFile(ownerGhii, key);
    let pointer: LatestPointer;
    if (existing) {
        pointer = JSON.parse(existing.data.toString('utf8')) as LatestPointer;
    } else {
        pointer = {
            packageId: packageId(localAccountName(ownerGhii), name),
            name, contentHash: '', descriptorUrl: '', updatedAt: new Date().toISOString(),
        };
    }
    pointer.lastError = { at: new Date().toISOString(), message: message.slice(0, 1000) };
    // The pointer keeps the package's audience, the one the service recorded for a published package
    // (./audience-record.ts); a pointer with none is a public package's.
    const audience = pointer.contentHash
        ? (await readTrustedVisibility(deps, ownerGhii, name)) ?? 'public'
        : pointer.visibility ?? 'public';
    await writeStorageFile({ storage: deps.storage, config: deps.config, emitResourceUpdated, emitResourceListChanged }, ownerGhii, {
        key,
        data: Buffer.from(JSON.stringify(pointer, null, 2) + '\n', 'utf8'),
        mimeType: 'application/json; charset=utf-8',
        visibility: fileVisibilityOf(audience),
    });
}

export interface OpenedPackage {
    descriptor: Descriptor; descriptorUrl: string; latest?: LatestPointer;
    /** True when anyone, signed in or not, opens this version: the package and the version are public. */
    openToAnyone: boolean;
}

/**
 * Read a package back. `ref` is `pkg:{owner}/{name}` for the newest version, or
 * `pkg:{owner}/{name}@sha256:…` to pin one. A pinned reference always answers with the same bytes,
 * which is what makes pinning worth anything.
 */
export async function openPackage(
    deps: StoreDeps, ref: string, nodeId: string, reader?: DatapackageReader | null,
): Promise<OpenedPackage | null> {
    const parsed = parseRef(ref, nodeId);
    if (!parsed) return null;
    const { ownerGhii, name, contentHash } = parsed;

    // The package's audience is the one the service recorded (./audience-record.ts), read for a pinned
    // version too; the pointer file is read for the version it names and its recorded failure. A
    // package this reader may not read answers like a missing one. No reader is anonymous.
    const pointerFile = await deps.storage.getStorageFile(ownerGhii, latestKey(name));
    const pointer = pointerFile ? JSON.parse(pointerFile.data.toString('utf8')) as LatestPointer : undefined;
    const trusted = await trustedAudienceOf(deps.storage, deps.config.nodeId, ownerGhii, name, pointer);
    if (!(await datapackageReadable(deps.storage, ownerGhii, trusted.visibility, reader, name))) return null;
    // A withdrawn package opens for nobody, its owner included (./withdraw.ts); a route answers 410.
    // The record's mark counts too, so a pointer with its mark cleared brings no package back.
    if (trusted.withdrawnAt) return null;

    let hash = contentHash;
    let latest: LatestPointer | undefined;
    if (!hash) {
        if (!pointer) return null;
        // A pointer that names another version than the service recorded was written past it: the
        // recorded version and audience stand in for its own.
        const current = trusted.pointer?.contentHash;
        latest = current && current !== pointer.contentHash
            ? { ...pointer, contentHash: current, ...(trusted.visibility !== undefined ? { visibility: trusted.visibility } : {}) }
            : pointer;
        if (!latest.contentHash) return null;   // only a failure has ever been recorded
        hash = latest.contentHash;
    }
    const file = await deps.storage.getStorageFile(ownerGhii, descriptorKey(name, hash));
    if (!file) return null;
    // A pinned earlier version keeps its own audience: the package's audience covers the version it
    // points at, and approving one version public opens no other (./audience.ts).
    const versionFile = trusted.versionFile(hash, file);
    if (!(await versionOpenTo(deps.storage, ownerGhii, reader, trusted.pointer, hash, versionFile))) return null;
    const openToAnyone = await datapackageReadable(deps.storage, ownerGhii, trusted.visibility, null)
        && await versionOpenTo(deps.storage, ownerGhii, null, trusted.pointer, hash, versionFile);
    return {
        descriptor: JSON.parse(file.data.toString('utf8')) as Descriptor,
        descriptorUrl: publicUrl(deps.config.baseUrl, ownerGhii, descriptorKey(name, hash)),
        ...(latest ? { latest } : {}),
        openToAnyone,
    };
}

/** Rows of one resource, paginated. The caller names the window; nothing here decides to send a
 *  whole table into somebody's context because it happened to fit. */
export async function readRows(
    deps: StoreDeps, ref: string, nodeId: string, resource: string, opts: { offset?: number; limit?: number; select?: string[] } = {},
    reader?: DatapackageReader | null,
): Promise<{ rows: Array<Record<string, unknown>>; total: number; schema: TableSchema } | null> {
    const loaded = await loadResourceRows(deps, ref, nodeId, resource, reader);
    if (!loaded) return null;
    const { all, res } = loaded;
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.min(Math.max(1, opts.limit ?? 500), 5000);
    let rows = all.slice(offset, offset + limit);
    let schema = res.schema;
    if (opts.select?.length) {
        const keep = new Set(opts.select);
        rows = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))));
        schema = { ...res.schema, fields: res.schema.fields.filter(f => keep.has(f.name)) };
    }
    return { rows, total: all.length, schema };
}

/**
 * Every row of one resource, unwindowed. For the OData feed only: it applies $filter and $orderby to
 * the whole table and splits the answer into pages with @odata.nextLink, so a 5 000-row window here
 * would make a larger table look complete when it is not. The CSV is parsed whole in readRows too,
 * so this reads nothing more than a windowed read does.
 */
export async function readAllRows(
    deps: StoreDeps, ref: string, nodeId: string, resource: string, reader?: DatapackageReader | null,
): Promise<{ rows: Array<Record<string, unknown>>; total: number; schema: TableSchema } | null> {
    const loaded = await loadResourceRows(deps, ref, nodeId, resource, reader);
    if (!loaded) return null;
    return { rows: loaded.all, total: loaded.all.length, schema: loaded.res.schema };
}

/** The parsed CSV of one resource of one package version, with the resource's descriptor entry. */
async function loadResourceRows(
    deps: StoreDeps, ref: string, nodeId: string, resource: string, reader?: DatapackageReader | null,
): Promise<{ all: Array<Record<string, unknown>>; res: DescriptorResource } | null> {
    const parsed = parseRef(ref, nodeId);
    const opened = await openPackage(deps, ref, nodeId, reader);
    if (!parsed || !opened) return null;
    const res = opened.descriptor.resources.find(r => r.name === resource);
    if (!res) return null;
    const hash = opened.descriptor.aimeat.contentHash;
    const key = resourceKey(parsed.name, hash, resource);
    const file = await deps.storage.getStorageFile(parsed.ownerGhii, key);
    if (!file) return null;
    // The classification reader GET /v1/pub runs on the same CSV (routes/storage-files.ts): a label
    // that hides the file from this reader, or ranks above an agent's clearance, hides its rows too,
    // and the read answers as a missing resource, as /v1/pub answers 404.
    // An outside party reads as a principal of no account and no recognised role, which classification
    // reads the stricter way (services/classification/reader-kind.ts): a label that keeps content inside
    // the owner's account or an organism hides it from the party too.
    const asReader = reader?.party ? { sub: reader.sub ?? '', owner: '', roles: ['party'] } : reader?.sub ? reader as ReaderAuth : null;
    const [shown] = await readerFor(deps, asReader).show([file], () => fileTarget(parsed.ownerGhii, key, file.workspaceRef));
    if (!shown) return null;
    return { all: fromCsv(shown.data, res.schema), res };
}

/** Every package one owner has, newest version each, with any recorded failure. */
export async function listPackages(deps: StoreDeps, ownerGhii: string): Promise<LatestPointer[]> {
    const files = await deps.storage.listStorageFiles(ownerGhii);
    const names = files
        .filter(f => f.key.startsWith('datapkg/') && f.key.endsWith('/latest.json'))
        .map(f => f.key.slice('datapkg/'.length, -'/latest.json'.length));
    const out: LatestPointer[] = [];
    for (const name of names) {
        const file = await deps.storage.getStorageFile(ownerGhii, latestKey(name));
        if (!file) continue;
        const pointer = JSON.parse(file.data.toString('utf8')) as LatestPointer;
        // A published package lists with the audience its reads decide on (./audience-record.ts).
        const trusted = pointer.contentHash ? (await trustedAudienceOf(deps.storage, deps.config.nodeId, ownerGhii, name, pointer)).visibility : undefined;
        out.push(trusted !== undefined && trusted !== (pointer.visibility ?? 'public') ? { ...pointer, visibility: trusted } : pointer);
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** One entry in a package's history: enough to decide about a version without opening it. */
export interface VersionEntry {
    contentHash: string;
    /** When this version's descriptor was written. Not the descriptor's own `created`, which is the
     *  first producer's clock; this is when these bytes landed here. */
    at: string;
    /** True for the one `latest.json` points at. There is exactly one, unless nothing is published. */
    current: boolean;
    /** The mandatory explanation. It is the reason a history is readable rather than a list of hashes. */
    changes: string;
    /** Rows and bytes over every resource of the version. */
    rowCount: number;
    bytes: number;
    /** How many resources (tables) the version has. */
    resources: number;
    descriptorUrl: string;
    supersedes?: string;
    /** The producer kind, and for a data product build its sources, so a page can say the version's
     *  note in its own language from facts rather than show the English `changes`. */
    producer?: string;
    sources?: Array<{ id: string; kind: string }>;
    /** Present on a row that records the package coming back to these bytes (./version-returns.ts):
     *  the version it left. The row's `at` is when it came back. */
    returnedFrom?: string;
}

/**
 * Every version of one package, newest first.
 *
 * The versions are DISCOVERED FROM THE KEYS rather than from an index, because the keys are the
 * index: a version is a directory named by its content hash, so nothing can be published without
 * appearing here and nothing can be listed here without existing. An index would be a second thing
 * to keep in step with the first.
 *
 * Each descriptor is read, which is one small GET per version. That is what makes `changes` and
 * `rowCount` available, and it is bounded by the owner's retention policy rather than by time.
 *
 * The list is the `reader`'s: a version that reader may not open (an earlier one stored narrower than
 * the pointer's tier, ./audience.ts versionOpenTo) is left out, hash, explanation and row count
 * included. The caller has already decided the reader may read the package at all (openPackage).
 */
export async function listVersions(
    deps: StoreDeps, ownerGhii: string, name: string, reader: DatapackageReader | null | undefined,
): Promise<VersionEntry[]> {
    const root = `${packageKeyRoot(name)}/`;
    const pointer = await readLatestPointer(deps, ownerGhii, name);
    // The version the package points at and each version's audience, as the service recorded them.
    const trusted = await trustedAudienceOf(deps.storage, deps.config.nodeId, ownerGhii, name, pointer);
    const currentHash = trusted.pointer?.contentHash ?? pointer?.contentHash ?? '';
    const files = (await deps.storage.listStorageFiles(ownerGhii))
        .filter(f => f.key.startsWith(root) && f.key.endsWith('/datapackage.json'));

    const out: VersionEntry[] = [];
    for (const f of files) {
        const hash = f.key.slice(root.length).split('/')[0];
        if (!/^[a-f0-9]{64}$/.test(hash)) continue;
        if (!(await versionOpenTo(deps.storage, ownerGhii, reader, trusted.pointer, hash, trusted.versionFile(hash, f)))) continue;
        const body = await deps.storage.getStorageFile(ownerGhii, f.key);
        if (!body) continue;
        let descriptor: Descriptor;
        try {
            descriptor = JSON.parse(body.data.toString('utf8')) as Descriptor;
        } catch (err) {
            // A descriptor that will not parse is not skipped quietly: a history with a hole in it
            // reads as a history, and a consumer counting versions would be counting wrong. The
            // caller gets the failure and can say which version is unreadable.
            throw new Error(`datapackage "${name}": the descriptor at ${f.key} is not readable JSON, so the `
                + 'version history cannot be listed honestly', { cause: err });
        }
        const resources = descriptor.resources ?? [];
        const a = descriptor.aimeat;
        out.push({
            contentHash: a.contentHash,
            at: f.createdAt,
            current: false,
            changes: a.changes,
            rowCount: resources.reduce((n, r) => n + (r.rowCount ?? 0), 0),
            bytes: resources.reduce((n, r) => n + (r.bytes ?? 0), 0),
            resources: resources.length,
            descriptorUrl: publicUrl(deps.config.baseUrl, ownerGhii, f.key),
            ...(a.supersedes ? { supersedes: a.supersedes } : {}),
            ...(a.producer?.kind ? { producer: a.producer.kind } : {}),
            ...(a.producer?.kind === 'dataproduct' && a.sources?.length
                ? { sources: a.sources.map(s => ({ id: String(s.id ?? ''), kind: String(s.kind ?? '') })) } : {}),
        });
    }
    // A return to earlier bytes is a row of its own, at the time it came back (./version-returns.ts).
    const listed = new Map(out.map(v => [bare(v.contentHash), v]));
    for (const r of await readVersionReturns(deps.storage, ownerGhii, name)) {
        const same = listed.get(bare(r.contentHash));
        if (same) out.push({ ...same, at: r.at, ...(r.from ? { returnedFrom: r.from } : {}) });
    }
    out.sort((x, y) => y.at.localeCompare(x.at));
    // A return made before returns were recorded: the package stands on bytes older than its newest
    // version, and the pointer moved after that version landed. The pointer's time is the return's.
    const standing = out.find(v => bare(v.contentHash) === bare(currentHash));
    const newest = out[0];
    if (standing && newest && standing !== newest && bare(newest.contentHash) !== bare(currentHash)
        && pointer?.updatedAt && pointer.updatedAt > newest.at) {
        out.unshift({ ...standing, at: pointer.updatedAt, returnedFrom: newest.contentHash });
    }
    // The newest row of the version the package stands on is the current one; an earlier row of the
    // same bytes is history.
    const cur = out.find(v => bare(v.contentHash) === bare(currentHash));
    if (cur) cur.current = true;
    return out;
}

/** `pkg:{owner}/{name}` or `pkg:{owner}/{name}@sha256:…`, or the bare `{name}` of your own. */
export function parseRef(ref: string, nodeId: string): { ownerGhii: string; name: string; contentHash?: string } | null {
    const m = /^pkg:([^/@]+)\/([^@]+)(?:@(sha256:[a-f0-9]{64}))?$/.exec(String(ref || '').trim());
    if (!m) return null;
    const owner = m[1];
    return {
        ownerGhii: owner.includes('@') ? owner : `${owner}@${nodeId}`,
        name: m[2],
        ...(m[3] ? { contentHash: m[3] } : {}),
    };
}
