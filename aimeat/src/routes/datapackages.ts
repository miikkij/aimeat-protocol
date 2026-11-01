/**
 * @file src/routes/datapackages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The HTTP door onto the data-package contract — the one a browser app reaches, and
 *   the reason the browser library does not reimplement any of it.
 *
 *   WHY THIS IS A CORE ROUTE AND NOT AN APP'S BUSINESS. The test for a new route here is "would a
 *   second, different service use this?", and the answer is that every producer on the node would:
 *   an app publishing a table a person assembled, an agent publishing what it gathered, and the
 *   vault app listing what exists. What it must NOT become is a second implementation — the schema
 *   inference, the quality gate, the canonical CSV and the content hash live in
 *   services/datapackage/, and this file parses requests and renders answers.
 *
 *   THE READ SIDE IS A CONVENIENCE, NOT THE ADDRESS. The canonical, permanent, auth-free,
 *   range-readable address of a package is `/v1/pub/{owner}/datapkg/{name}/{hash}/datapackage.json`,
 *   which DuckDB, pandas and frictionless-py read with no AIMEAT knowledge at all. These GETs exist
 *   because "the newest version" needs resolving and because a paginated row window is a thing a UI
 *   wants without downloading a file. Neither replaces the address.
 * @structure
 *   - POST /v1/datapackages            publish a version (refuses before writing)
 *   - POST /v1/datapackages/validate   the same gate, no write — infer + check and report
 *   - GET  /v1/datapackages            the caller's own packages, newest version each
 *   - GET  /v1/datapackages/:owner/:name         the descriptor (public packages: no auth), with odps_url
 *   - GET  /v1/datapackages/:owner/:name/odps    the ODPS sheet, projected from the version's audience
 *   - DELETE /v1/datapackages/:owner/:name       withdraw (?purge=true deletes the files too)
 *   - PUT  /v1/datapackages/:owner/:name/exchange   the EXCHANGE sale terms (exchange: false delists)
 *   - GET  /v1/datapackages/:owner/:name/rows/:resource   a paginated row window, or ?format=csv the whole resource
 * @usage app.use(dataPackagesRouter(config, storage))
 * @version-history
 *   v1.10.0 -- 2026-11-01 -- PUT /v1/datapackages/:owner/:name/exchange sells a package on EXCHANGE (or
 *     takes it off). The reads decide who reads in routes/package-reader.ts: an outside party's share, an
 *     account's EXCHANGE contract (the paid feed), or req.auth; a row window and the CSV are metered for
 *     the first two before they are sent (plan doc-mvwxcas3dom3, D5.1, D5.3).
 *   v1.9.0 -- 2026-11-01 -- The descriptor read answers `freshness` (services/datapackage/freshness.ts:
 *     fresh, late, stale or unscheduled against the producer's promise). The versions list tells the
 *     owner, per version, `in_use` (the live named shares that pin it, the outside parties' reads of the
 *     last 30 days) and whether the retention policy removes it next, with `retention_policy`
 *     (services/datapackage/versions-in-use.ts; plan doc-mvwxcas3dom3, D6.1, D6.4).
 *   v1.8.0 -- 2026-11-01 -- The four reads take an outside party (routes/party-read.ts): HTTP Basic or a
 *     party token, admitted by its named share to this package only, a pinned version served when the
 *     request names none; GET .../rows/:resource?format=csv answers the whole resource as CSV and is the
 *     one read that takes a party key in the address (`?key=`), for a share that allows it. DELETE
 *     answers `shares_ended` (plan doc-mvwxcas3dom3, D2.1, D3.2).
 *   v1.7.0 -- 2026-11-01 -- GET /v1/datapackages/:owner/:name?format=schemaorg answers the schema.org
 *     Dataset JSON-LD of the version (services/datapackage/schema-org.ts), and the descriptor read names
 *     it as `schema_org_url` (plan doc-mvwxcas3dom3, D1.4). POST answers 409 PERSONAL_DATA_PUBLIC when an
 *     app grant publishes to public from data its app's data map marks personal, unless the body says
 *     `confirm_personal_public: true` (D1.7).
 *   v1.6.0 -- 2026-11-01 -- DELETE /v1/datapackages/:owner/:name withdraws a package (?purge=true deletes
 *     its files and pointer); the reads answer 410 GONE for a withdrawn package to a reader its audience
 *     admits (plan doc-mvwxcas3dom3, D0.3).
 *   v1.5.0 -- 2026-11-01 -- GET /v1/datapackages/:owner/:name/odps answers the ODPS sheet projected at
 *     read time from the version's audience, and the descriptor read names it as `odps_url`; the sheet
 *     stored at publish said public and "No authentication" for every package (plan doc-mvwxcas3dom3, D0.1).
 *   v1.4.1 -- 2026-10-24 -- POST /v1/datapackages refuses the shared anonymous principal with 401
 *     AUTH_REQUIRED (refuseAnonymousPrincipal): a package is written outside the anonymous namespaces
 *     (secaudit2026oct22).
 *   v1.4.0 -- 2026-10-20 -- The three GETs pass the caller's whole auth (roles and scopes) to the store:
 *     an agent, app grant or ecosystem app of the owner reads a private package only with
 *     storage:read, and gets 403 SCOPE_DENIED naming the word without it; members, organism and
 *     public packages it reads on their audience, as before (secaudit 2026-10 v41, standing ruling 5,
 *     capability-loss review 2026-10-21). The versions list leaves out an earlier version whose own
 *     audience does not admit the caller (secaudit 2026-10 v42).
 *   v1.3.0 -- 2026-10-18 -- On a node that shows its content to signed-in accounts only, a publish that
 *     would make the package public lands at 'members' and the answer carries `warnings`
 *     PUBLIC_IS_SIGNED_IN_HERE (services/datapackage/publish-ask.ts, plan V1.6).
 *   v1.2.0 -- 2026-10-18 -- POST asks the publish gate when the version would make the package public
 *     (the default): an agent without publish:public publishes at the audience the package had (a
 *     first version private) and gets 202 with `publish_request` (services/datapackage/publish-ask.ts;
 *     plan doc-mvcn6c7e4e5q, V4).
 *   v1.1.0 -- 2026-10-17 -- POST takes `visibility` (public by default, members, organism:<id>,
 *     private); an organism the caller is not in is 400 NOT_ORGANISM_MEMBER before any write. The
 *     three GETs pass the caller to the store, which answers 404 to one the audience does not admit
 *     (plan doc-mvcn6c7e4e5q, V3.8; services/datapackage/audience.ts).
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, B2).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, optionalAuth } from '../auth/middleware.js';
import { refuseAnonymousPrincipal } from '../auth/anonymous-principal.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity, ownerGhiiOf, localAccountName } from '../utils/gaii.js';
import { parseDeclaredProvenanceInput } from '../mcp/ai-provenance-input.js';
import { inferSchema, validateRows, type ValidationIssue } from '../services/datapackage/table.js';
import type { PublishInput, TableSchema } from '../services/datapackage/contract.js';
import { publishPackage, openPackage, readRows, readAllRows, listPackages, listVersions, parseRef } from '../services/datapackage/store.js';
import { toCsv } from '../services/datapackage/table.js';
import { packageReaderFor } from './package-reader.js';
import { setPackageExchange } from '../services/exchange-datapackage.js';
import { validateBody } from '../models/schemas.js';
import { DatapackageExchangeSchema } from '../models/exchange-datapackage-schemas.js';
import { exchangeOutcome, reconcileAfterPackageWrite } from '../services/exchange-projection.js';
import { datapackagePublishGate, fileDatapackageAsk } from '../services/datapackage/publish-ask.js';
import { closedNodeWarnings } from '../services/closed-node-level.js';
import { callerOf } from '../middleware/caller.js';
import { denyScope403, deny403 } from '../auth/deny.js';
import { withdrawPackage, withdrawalOfRef, withdrawnMessage } from '../services/datapackage/withdraw.js';
import { lacksPackageReadScope, ownerAuthOf, DATAPACKAGE_READ_SCOPE } from '../services/datapackage/audience.js';
import { odpsSheetFor, odpsAddress, versionAudienceOf } from '../services/datapackage/odps-read.js';
import { schemaOrgDataset } from '../services/datapackage/schema-org.js';
import { readPointer, catalogueKeyRoot } from '../services/datapackage/version-audience.js';
import { datasetLandingUrl } from '../services/datapackage/catalogue-facts.js';
import { ODPS_VERSION } from '../services/exchange-odps.js';
import { packageFreshness } from '../services/datapackage/freshness-read.js';
import { versionsInUse } from '../services/datapackage/versions-in-use.js';

/** The request body a publish takes, loosely typed here and checked by the service. `schema` is
 *  OPTIONAL on the wire — an app that hands over rows and nothing else is asking for a proposal — so
 *  this is deliberately not `PublishInput`, which requires the decision to have been made. */
interface PublishBody extends Omit<Partial<PublishInput>, 'resources'> {
    resources?: Array<{ name: string; rows: Array<Record<string, unknown>>; schema?: 'infer' | TableSchema; title?: string; description?: string }>;
}

export function dataPackagesRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const store = { storage, config };

    /**
     * After a refused read: a principal of the package's owner (agent, app grant, ecosystem app)
     * without storage:read gets 403 SCOPE_DENIED naming the word, as /v1/pub answers for the same
     * bytes, instead of a 404 that reads as a missing package (secaudit 2026-10 v41). Only when the
     * package or version is there for its owner, so a missing one or a missing resource stays 404.
     */
    const refusedForScope = async (req: Request, res: Response, ref: string): Promise<boolean> => {
        // A withdrawn package answers 410 to a reader its audience admits; anyone else gets the 404
        // below, so a withdrawn non-public package does not reveal that it existed.
        const withdrawn = await withdrawalOfRef(store, ref, config.nodeId, req.auth);
        if (withdrawn) {
            res.status(410).json(error(config.nodeId, 'GONE', withdrawnMessage(ref, withdrawn.withdrawnAt), undefined, { withdrawn_at: withdrawn.withdrawnAt }));
            return true;
        }
        const parsed = parseRef(ref, config.nodeId);
        if (!parsed || !lacksPackageReadScope(parsed.ownerGhii, req.auth)) return false;
        if (await openPackage(store, ref, config.nodeId, req.auth)) return false;
        if (!(await openPackage(store, ref, config.nodeId, ownerAuthOf(parsed.ownerGhii)))) return false;
        denyScope403(req, res, [DATAPACKAGE_READ_SCOPE],
            'Reading a private data package of your owner, or a private earlier version of one, needs the "storage:read" scope. Ask the owner to grant it.');
        return true;
    };

    /**
     * Who reads: an outside party admitted by its share (routes/party-read.ts), or req.auth as before.
     * Null when a party credential was refused and the answer is sent. `ref` is the reference to open:
     * the share's pinned version when the request named none.
     */
    const readerOf = async (req: Request, res: Response, what: string, opts: { urlKey?: boolean } = {}) => {
        const owner = req.params.owner as string, name = req.params.name as string;
        const asked = typeof req.query.version === 'string' && req.query.version.trim() ? req.query.version.trim() : undefined;
        // An outside party's share, an account's EXCHANGE contract, or req.auth (routes/package-reader.ts).
        const who = await packageReaderFor(req, res, store, { owner, name, what, ...(asked ? { version: asked } : {}), ...(opts.urlKey ? { urlKey: true } : {}) });
        if (!who) return null;
        return { reader: who.reader, ref: who.ref, party: who.admitted, served: who.served, charge: who.charge };
    };

    /** The schema.org Dataset JSON-LD of an opened version: the public page address for a public package only. */
    const schemaOrgOf = async (opened: NonNullable<Awaited<ReturnType<typeof openPackage>>>) => {
        const d = opened.descriptor;
        const owner = /^pkg:([^/]+)\//.exec(d.aimeat.packageId)?.[1] ?? '';
        const ownerGhii = `${owner}@${config.nodeId}`;
        const audience = await versionAudienceOf(store, ownerGhii, d.name, d.aimeat.contentHash, opened.latest ?? await readPointer(store, ownerGhii, d.name));
        const catalogueId = catalogueKeyRoot(d.aimeat.packageId).slice('packages/'.length);
        return schemaOrgDataset({
            baseUrl: config.baseUrl, siteName: config.seoSiteName || `AIMEAT node ${config.nodeId}`, ownerName: owner,
            descriptor: d, descriptorUrl: opened.descriptorUrl, audience,
            ...(audience === 'public' ? { landingUrl: datasetLandingUrl(config.baseUrl, catalogueId) } : {}),
            ...(opened.latest?.updatedAt ? { modified: opened.latest.updatedAt } : {}),
        });
    };

    /**
     * Publish one version.
     *
     * TWO SCOPES, because a package genuinely is two things: bytes in the caller's storage and a
     * catalogue entry in their memory. An agent holding only one of them would be able to write half
     * a package, and a half-published package is exactly the state this design refuses everywhere
     * else. Owner sessions bypass scopes as they do on every route.
     */
    // The shared anonymous principal does not publish: a package is stored under datapkg/ and its
    // pointer in memory, outside the anonymous/ and anonymous.* namespaces, and a members or public
    // package is read by other people (secaudit2026oct22).
    router.post('/v1/datapackages', requireAuth(), refuseAnonymousPrincipal(), requireScope('storage:write', 'memory:write'), async (req, res) => {
        const caller = resolveIdentity(req.auth!, config.nodeId);
        const ownerGhii = ownerGhiiOf(caller);
        const body = (req.body ?? {}) as PublishBody;
        const declared = parseDeclaredProvenanceInput((req.body as { ai_provenance?: unknown })?.ai_provenance);
        if (!declared.ok) {
            res.status(400).json(error(config.nodeId, 'INVALID_PROVENANCE',
                'The ai_provenance block does not validate.', undefined, { violations: declared.violations }));
            return;
        }

        // Publishing it public (the default) asks the node's publish gate first (plan
        // doc-mvcn6c7e4e5q, V4): on an ask the version is published at the audience the package had,
        // a first one private, and the request is filed after.
        const gate = await datapackagePublishGate(store, callerOf(req, config.nodeId, storage), req.auth?.app, ownerGhii,
            String(body.name ?? ''), body.visibility !== undefined ? String(body.visibility) : undefined);
        if (gate.kind === 'refused') {
            res.status(gate.status).json(error(config.nodeId, gate.code, gate.message));
            return;
        }

        const input: PublishInput = {
            name: String(body.name ?? ''),
            changes: String(body.changes ?? ''),
            resources: (body.resources ?? []).map(r => ({
                name: String(r.name ?? ''),
                rows: Array.isArray(r.rows) ? r.rows : [],
                // 'infer' is the default because an app that hands over rows and no schema is asking
                // for a proposal, not for a refusal. The descriptor records `schemaSource: 'inferred'`
                // so the difference stays visible to whoever reads the package later.
                schema: r.schema ?? 'infer',
                ...(r.title ? { title: r.title } : {}),
                ...(r.description ? { description: r.description } : {}),
            })),
            ...(body.title ? { title: body.title } : {}),
            ...(body.description ? { description: body.description } : {}),
            ...(body.parameters ? { parameters: body.parameters } : {}),
            ...(body.provenance ? { provenance: body.provenance } : {}),
            ...(body.retentionPolicy ? { retentionPolicy: body.retentionPolicy } : {}),
            // Who reads it: public (default), members, organism:<id> or private. The service checks it
            // before any write (services/datapackage/audience.ts).
            ...(gate.visibility !== undefined ? { visibility: gate.visibility } : {}),
            // The owner's confirmation of a public package from personal data (personal-guard.ts).
            ...((req.body as { confirm_personal_public?: unknown })?.confirm_personal_public === true ? { confirmPersonalPublic: true } : {}),
            // TARGET-058: what the caller says about how this was made. provenanceForWrite decides
            // from the PRINCIPAL whether anything is minted, so an owner publishing by hand is not
            // stamped and an app or agent is.
            ...(declared.declared ? { declaredProvenance: declared.declared } : {}),
            ...(typeof (req.body as { ai_provenance_id?: unknown })?.ai_provenance_id === 'string'
                ? { declaredProvenanceId: (req.body as { ai_provenance_id: string }).ai_provenance_id } : {}),
        };

        const out = await publishPackage(store, ownerGhii, input, {
            gaii: caller,
            // The producer is what the CALLER is, not what the body claims. A descriptor whose
            // producer block can be set by its own request describes nothing a reader can rely on.
            kind: req.auth!.roles.includes('agent') ? 'agent' : req.auth!.roles.includes('app') ? 'app' : 'manual',
            ...(typeof body.producer?.ref === 'string' ? { ref: body.producer.ref } : {}),
            // The app a grant belongs to, from the token and never from the body: its data map says
            // whether the data is personal (services/datapackage/personal-guard.ts).
            ...(req.auth!.roles.includes('app') && req.auth!.app ? { app: req.auth!.app } : {}),
        });

        if (!out.ok) {
            // 422 for the quality gate: the request was well-formed and the DATA was refused, which
            // is a different thing from a malformed body and reads differently in a client.
            // 409 for public from personal data: the request is right and waits for the owner's word.
            const status = out.code === 'QUALITY_GATE' ? 422 : out.code === 'PERSONAL_DATA_PUBLIC' ? 409 : 400;
            res.status(status).json(error(config.nodeId, out.code, out.message, undefined, { issues: out.issues }));
            return;
        }
        emitChange('files');
        const asked = gate.requester
            ? await fileDatapackageAsk(store, req.auth!.owner, gate.requester, ownerGhii, input.name, out.contentHash, gate.from)
            : closedNodeWarnings(gate.warning);
        // 202 when the version was published at the audience the package had and making it public waits for the owner.
        res.status(asked.publish_request ? 202 : out.unchanged ? 200 : 201).json(success(config.nodeId, {
            ...asked,
            package_id: out.descriptor.aimeat.packageId,
            content_hash: out.contentHash,
            descriptor_url: out.descriptorUrl,
            odps_url: odpsAddress(config.baseUrl, localAccountName(ownerGhii), input.name, out.contentHash),
            // NOT a new version: the same bytes were already at this address. A deterministic
            // producer proving it is deterministic should not be reported as an update.
            unchanged: out.unchanged,
            schema_source: out.descriptor.aimeat.schemaSource,
            resources: out.resources,
            // Named, not counted. If the owner's retention policy removed a version, whoever
            // published has to be able to see WHICH — a pinned consumer of one of these now
            // gets a 404, and that is a thing to know at the moment it happens.
            ...(out.pruned.length ? { pruned_versions: out.pruned } : {}),
        }, [
            { description: 'Read the descriptor (permanent, no auth)', method: 'GET', url: out.descriptorUrl },
        ]));
    });

    /**
     * The gate, without the write. What `success` looks like here is "nothing is wrong", and what a
     * publisher gets when something is is the row and the column — so the problem is visible in the
     * browser before anything is stored.
     */
    router.post('/v1/datapackages/validate', requireAuth(), requireScope('storage:write'), async (req, res) => {
        const body = (req.body ?? {}) as PublishBody;
        const issues: ValidationIssue[] = [];
        const schemas: Record<string, TableSchema> = {};
        for (const r of body.resources ?? []) {
            const rows = Array.isArray(r.rows) ? r.rows : [];
            const schema = (!r.schema || r.schema === 'infer') ? inferSchema(rows) : r.schema;
            schemas[String(r.name)] = schema;
            issues.push(...validateRows(String(r.name), rows, schema));
        }
        res.json(success(config.nodeId, {
            ok: issues.length === 0,
            issues,
            // The inferred schemas travel back so a publisher can look at the proposal, correct a
            // type and send it as a DECLARED schema on the real publish.
            schemas,
        }));
    });

    /** Every package the caller owns, newest version each, with any recorded failure. */
    router.get('/v1/datapackages', requireAuth(), requireScope('storage:read'), async (req, res) => {
        const ownerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
        const packages = await listPackages(store, ownerGhii);
        res.json(success(config.nodeId, { packages, total: packages.length }));
    });

    /**
     * One package's descriptor. `?version=sha256:…` pins; without it the newest is resolved through
     * the mutable pointer. No auth: a published package is public, and the whole point is that a
     * program can read it without an AIMEAT session.
     */
    router.get('/v1/datapackages/:owner/:name', optionalAuth(), async (req, res) => {
        const who = await readerOf(req, res, 'descriptor');
        if (!who) return;
        const ref = who.ref;
        const opened = await openPackage(store, ref, config.nodeId, who.reader);
        if (!opened) {
            if (!who.party && await refusedForScope(req, res, ref)) return;
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No such data package: ${ref}`));
            return;
        }
        who.served();
        const odpsUrl = odpsAddress(config.baseUrl, req.params.owner as string, req.params.name as string, opened.descriptor.aimeat.contentHash);
        if (req.query.format === 'schemaorg') {
            // The schema.org Dataset JSON-LD the public dataset page embeds (services/datapackage/schema-org.ts).
            res.type('application/ld+json; charset=utf-8').send(JSON.stringify(await schemaOrgOf(opened), null, 2));
            return;
        }
        const schemaOrgUrl = `${config.baseUrl.replace(/\/+$/, '')}/v1/datapackages/${encodeURIComponent(req.params.owner as string)}/${encodeURIComponent(req.params.name as string)}?format=schemaorg`;
        // The package's freshness against its producer's promise (services/datapackage/freshness.ts, D6.1).
        const ownerGhii = parseRef(ref, config.nodeId)?.ownerGhii;
        const freshness = ownerGhii ? await packageFreshness(store, ownerGhii, req.params.name as string, opened.latest ? { pointer: opened.latest } : {}) : null;
        res.json(success(config.nodeId, {
            descriptor: opened.descriptor,
            ...(freshness ? { freshness } : {}),
            descriptor_url: opened.descriptorUrl,
            // The ODPS product sheet of this version, projected from its audience when it is read.
            odps_url: odpsUrl,
            // The schema.org Dataset JSON-LD of the newest version, for a page to embed.
            schema_org_url: schemaOrgUrl,
            // Present only on an unpinned read, and it is where a consumer learns that the LATEST
            // attempt failed while the version they are reading is the last good one.
            ...(opened.latest ? { latest: opened.latest } : {}),
        }, [
            { description: 'The permanent address of these bytes', method: 'GET', url: opened.descriptorUrl },
            { description: 'The ODPS product sheet of this version (YAML)', method: 'GET', url: odpsUrl },
        ]));
    });

    /**
     * Withdraw a package (services/datapackage/withdraw.ts): every read answers 410 after it and the
     * catalogue no longer lists it; the version files stay unless `?purge=true`, which deletes them and
     * the pointer. The owner in person, or the owner's principal with storage:write; every refusal comes
     * before any write. The shared anonymous principal is refused with 401 as on the publish.
     */
    // requireScope answers a principal without storage:write before the service; the service asks the
    // same word again for the MCP tool, which reaches it without this middleware. The word is a literal
    // here (it equals DATAPACKAGE_WITHDRAW_SCOPE) because the REST scope scanner reads literals only.
    router.delete('/v1/datapackages/:owner/:name', requireAuth(), refuseAnonymousPrincipal(), requireScope('storage:write'), async (req, res) => {
        const purge = req.query.purge === 'true' || req.query.purge === '1';
        const out = await withdrawPackage(store, callerOf(req, config.nodeId, storage), req.params.owner as string, req.params.name as string, { purge });
        if (!out.ok) {
            // requireScope above already refused a principal without storage:write, so this branch is the
            // service's own answer for the MCP path and is not reached from this route in practice.
            if (out.code === 'SCOPE_DENIED') { deny403(req, res, out.code, out.message); return; }
            if (out.code === 'FORBIDDEN') { deny403(req, res, out.code, out.message); return; }
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }
        res.json(success(config.nodeId, {
            package_id: out.packageId, name: out.name, status: 'withdrawn', withdrawn_at: out.withdrawnAt,
            purged: out.purged, already_withdrawn: out.alreadyWithdrawn, files_deleted: out.filesDeleted,
            catalogue_removed: out.catalogueRemoved,
            // Its named shares to outside parties ended with it (services/parties/shares.ts).
            shares_ended: out.sharesEnded,
        }, [
            { description: 'Your packages, with this one marked withdrawn (or gone, when purged)', method: 'GET', url: '/v1/datapackages' },
            ...(out.purged ? [] : [{ description: 'Publish a version again to restore it', method: 'POST', url: '/v1/datapackages' }]),
        ]));
    });

    /**
     * Sell a package on EXCHANGE, change its terms, or with `exchange: false` take it off the market
     * (services/exchange-datapackage.ts; plan doc-mvwxcas3dom3, D5.1, D5.2). The terms are stored on the
     * package pointer and the listing is projected from them before the answer, which carries what the
     * projection did. A contract already signed keeps its price and its interface. The owner in person,
     * or the owner's principal with exchange:write; a new listing of data asks the node's data
     * intermediation setting first (403 DATA_INTERMEDIATION_NOT_OFFERED).
     */
    router.put('/v1/datapackages/:owner/:name/exchange', requireAuth(), refuseAnonymousPrincipal(), requireScope('exchange:write'), validateBody(DatapackageExchangeSchema, config.nodeId), async (req, res) => {
        const out = await setPackageExchange(store, callerOf(req, config.nodeId, storage), req.params.owner as string, req.params.name as string,
            (req.body ?? {}) as Record<string, unknown>,
            async (ownerGhii, name) => exchangeOutcome(await reconcileAfterPackageWrite(storage, ownerGhii, name), 'POST /v1/exchange/reconcile'));
        if (!out.ok) {
            if (out.status === 403) { deny403(req, res, out.code, out.message); return; }
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }
        res.json(success(config.nodeId, { exchange: out.terms, listing: out.listing }, [
            { description: 'The listings on EXCHANGE', method: 'GET', url: '/v1/exchange/offerings' },
        ]));
    });

    /**
     * The ODPS v4.1 product sheet of one version, projected now from the descriptor and the version's
     * audience (services/datapackage/odps-read.ts): YAML, or the envelope with `?format=json`. Readable
     * by whoever may read the package, refused as the descriptor read refuses.
     */
    router.get('/v1/datapackages/:owner/:name/odps', optionalAuth(), async (req, res) => {
        const who = await readerOf(req, res, 'odps');
        if (!who) return;
        const ref = who.ref;
        const sheet = await odpsSheetFor(store, ref, config.nodeId, who.reader);
        if (!sheet) {
            if (!who.party && await refusedForScope(req, res, ref)) return;
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No such data package: ${ref}`));
            return;
        }
        who.served();
        if (req.query.format === 'json') {
            res.json(success(config.nodeId, { odps_version: ODPS_VERSION, content_hash: sheet.contentHash, odps: sheet.doc }));
            return;
        }
        res.type('text/yaml; charset=utf-8').send(sheet.yaml);
    });

    /**
     * Every version of one package, newest first, each with the explanation it was published with.
     *
     * Same door as the read above: a public package's history is public, because a history you
     * cannot see is not a history a consumer can rely on. `openPackage` is called first so a
     * package nobody may read answers 404 here too, rather than leaking its shape through a list.
     */
    router.get('/v1/datapackages/:owner/:name/versions', optionalAuth(), async (req, res) => {
        const owner = req.params.owner as string;
        const name = req.params.name as string;
        const who = await readerOf(req, res, 'versions');
        if (!who) return;
        // A party whose share pins a version opens that one; anyone else the newest.
        const opened = await openPackage(store, who.party ? who.ref : buildRef(owner, name, undefined), config.nodeId, who.reader);
        if (!opened) {
            if (!who.party && await refusedForScope(req, res, buildRef(owner, name, undefined))) return;
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No such data package: ${buildRef(owner, name, undefined)}`));
            return;
        }
        who.served();
        const ownerGhii = owner.includes('@') ? owner : `${owner}@${config.nodeId}`;
        // The caller's history: an earlier version it may not open is not listed (secaudit 2026-10 v42).
        const versions = await listVersions(store, ownerGhii, name, who.reader);
        // The owner's view (D6.4): which versions a named share pins or an outside party read within 30
        // days, and which the retention policy removes next. The shares and the read log are the owner's,
        // so only the owner in person, or the owner's principal with storage:read, is told.
        const caller = who.party || !req.auth || req.auth.anonymous ? null : callerOf(req, config.nodeId, storage);
        const ownersView = !!caller && !caller.visitor && caller.ownerGhii === ownerGhii && caller.has('storage:read');
        const use = ownersView ? await versionsInUse(store, ownerGhii, name, versions) : null;
        const shown = use
            ? versions.map(v => ({ ...v, in_use: use.byHash.get(v.contentHash.replace(/^sha256:/, '')) ?? null }))
            : versions;
        res.json(success(config.nodeId, {
            package_id: opened.descriptor.aimeat.packageId, versions: shown, total: versions.length,
            ...(use ? { retention_policy: use.retention, read_window_days: 30 } : {}),
        }, [
            { description: 'The newest version', method: 'GET', url: `/v1/datapackages/${owner}/${name}` },
        ]));
    });

    /** A paginated row window. For anything larger, read the CSV from its permanent address — that
     *  is what it is for, and it supports byte ranges. */
    router.get('/v1/datapackages/:owner/:name/rows/:resource', optionalAuth(), async (req, res) => {
        // `?format=csv` answers the whole resource as CSV: a stable address for a spreadsheet that
        // follows the newest version (or the version a share pins). Only it takes an outside party's
        // key in the address (`?key=`), and only for a share that allows it (plan D2.1 (c)).
        const csv = req.query.format === 'csv';
        const who = await readerOf(req, res, `rows/${req.params.resource as string}${csv ? '.csv' : ''}`, { urlKey: csv });
        if (!who) return;
        const ref = who.ref;
        if (csv) {
            const all = await readAllRows(store, ref, config.nodeId, req.params.resource as string, who.reader);
            if (!all) {
                if (!who.party && await refusedForScope(req, res, ref)) return;
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No such resource in ${ref}`));
                return;
            }
            // A data read through a share a purchase made, or a contract, is metered now (plan D5.3).
            if (!(await who.charge())) return;
            who.served(all.total);
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.type('text/csv; charset=utf-8').send(toCsv(all.rows, all.schema));
            return;
        }
        const select = typeof req.query.select === 'string' ? req.query.select.split(',').filter(Boolean) : undefined;
        const out = await readRows(store, ref, config.nodeId, req.params.resource as string, {
            offset: numberParam(req.query.offset),
            limit: numberParam(req.query.limit),
            ...(select?.length ? { select } : {}),
        }, who.reader);
        if (!out) {
            if (!who.party && await refusedForScope(req, res, ref)) return;
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No such resource in ${ref}`));
            return;
        }
        if (!(await who.charge())) return;
        who.served(out.rows.length);
        res.json(success(config.nodeId, {
            rows: out.rows, total: out.total, schema: out.schema,
            offset: numberParam(req.query.offset) ?? 0, count: out.rows.length,
        }));
    });

    return router;
}

/** `pkg:{owner}/{name}[@sha256:…]`, validated by the same parser the service uses. */
function buildRef(owner: string, name: string, version: unknown): string {
    const v = typeof version === 'string' && version.trim() ? `@${version.trim()}` : '';
    return `pkg:${owner}/${name}${v}`;
}

function numberParam(v: unknown): number | undefined {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

/** Re-exported so the MCP tools resolve a reference the same way this route does. */
export { parseRef };
