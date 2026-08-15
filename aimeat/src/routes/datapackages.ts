/**
 * @file src/routes/datapackages.ts
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
 *   - GET  /v1/datapackages/:owner/:name         the descriptor (public packages: no auth)
 *   - GET  /v1/datapackages/:owner/:name/rows/:resource   a paginated row window
 * @usage app.use(dataPackagesRouter(config, storage))
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, B2).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, optionalAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';
import { parseDeclaredProvenanceInput } from '../mcp/ai-provenance-input.js';
import { inferSchema, validateRows, type ValidationIssue } from '../services/datapackage/table.js';
import type { PublishInput, TableSchema } from '../services/datapackage/contract.js';
import { publishPackage, openPackage, readRows, listPackages, listVersions, parseRef } from '../services/datapackage/store.js';

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
     * Publish one version.
     *
     * TWO SCOPES, because a package genuinely is two things: bytes in the caller's storage and a
     * catalogue entry in their memory. An agent holding only one of them would be able to write half
     * a package, and a half-published package is exactly the state this design refuses everywhere
     * else. Owner sessions bypass scopes as they do on every route.
     */
    router.post('/v1/datapackages', requireAuth(), requireScope('storage:write', 'memory:write'), async (req, res) => {
        const caller = resolveIdentity(req.auth!, config.nodeId);
        const ownerGhii = ownerGhiiOf(caller);
        const body = (req.body ?? {}) as PublishBody;
        const declared = parseDeclaredProvenanceInput((req.body as { ai_provenance?: unknown })?.ai_provenance);
        if (!declared.ok) {
            res.status(400).json(error(config.nodeId, 'INVALID_PROVENANCE',
                'The ai_provenance block does not validate.', undefined, { violations: declared.violations }));
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
        });

        if (!out.ok) {
            // 422 for the quality gate: the request was well-formed and the DATA was refused, which
            // is a different thing from a malformed body and reads differently in a client.
            const status = out.code === 'QUALITY_GATE' ? 422 : 400;
            res.status(status).json(error(config.nodeId, out.code, out.message, undefined, { issues: out.issues }));
            return;
        }
        emitChange('files');
        res.status(out.unchanged ? 200 : 201).json(success(config.nodeId, {
            package_id: out.descriptor.aimeat.packageId,
            content_hash: out.contentHash,
            descriptor_url: out.descriptorUrl,
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
        const ref = buildRef(req.params.owner as string, req.params.name as string, req.query.version);
        const opened = await openPackage(store, ref, config.nodeId);
        if (!opened) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No such data package: ${ref}`));
            return;
        }
        res.json(success(config.nodeId, {
            descriptor: opened.descriptor,
            descriptor_url: opened.descriptorUrl,
            // Present only on an unpinned read, and it is where a consumer learns that the LATEST
            // attempt failed while the version they are reading is the last good one.
            ...(opened.latest ? { latest: opened.latest } : {}),
        }, [
            { description: 'The permanent address of these bytes', method: 'GET', url: opened.descriptorUrl },
        ]));
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
        const opened = await openPackage(store, buildRef(owner, name, undefined), config.nodeId);
        if (!opened) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No such data package: ${buildRef(owner, name, undefined)}`));
            return;
        }
        const ownerGhii = owner.includes('@') ? owner : `${owner}@${config.nodeId}`;
        const versions = await listVersions(store, ownerGhii, name);
        res.json(success(config.nodeId, { package_id: opened.descriptor.aimeat.packageId, versions, total: versions.length }, [
            { description: 'The newest version', method: 'GET', url: `/v1/datapackages/${owner}/${name}` },
        ]));
    });

    /** A paginated row window. For anything larger, read the CSV from its permanent address — that
     *  is what it is for, and it supports byte ranges. */
    router.get('/v1/datapackages/:owner/:name/rows/:resource', optionalAuth(), async (req, res) => {
        const ref = buildRef(req.params.owner as string, req.params.name as string, req.query.version);
        const select = typeof req.query.select === 'string' ? req.query.select.split(',').filter(Boolean) : undefined;
        const out = await readRows(store, ref, config.nodeId, req.params.resource as string, {
            offset: numberParam(req.query.offset),
            limit: numberParam(req.query.limit),
            ...(select?.length ? { select } : {}),
        });
        if (!out) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No such resource in ${ref}`));
            return;
        }
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
