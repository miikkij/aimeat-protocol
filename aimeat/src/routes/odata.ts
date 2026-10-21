/**
 * @file src/routes/odata.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The OData v4 feed for a data package — the surface Excel, Power BI and Tableau
 *   connect to natively and then REFRESH BY THEMSELVES.
 *
 *   WHY THIS IS A CORE ROUTE. It was measured before it was written: an extension cannot serve this.
 *   The whole extension HTTP surface is two POST routes behind requireAuth, the sandbox is handed
 *   `req.body` and never the query string, and the answer is wrapped in the node's success envelope.
 *   OData needs GET, needs `$filter` and friends off the query string, needs XML for `$metadata` and
 *   needs an unwrapped JSON body with `@odata.context`. Four of those are impossible there, so the
 *   feed lives here — and this file stays a projection: the CSDL and the query language are
 *   services/datapackage/odata.ts, the bytes are the same ones the CSV address serves.
 *
 *   IT IS AS OPEN AS THE BYTES IT SERVES, AND NO MORE. A published package's CSV is world-readable
 *   at a permanent address, so a feed over the same rows is world-readable too. Putting a token in
 *   front of the feed while the CSV stays public would be theatre, not a control.
 *
 *   NOT METERED, AND SAYING SO. The design note for this target wants each feed request to be a
 *   billable event, and that is genuinely attractive — a downloaded file escapes measurement the
 *   moment it lands, and a feed does not. But metering needs an authenticated caller and an
 *   entitlement coordinate, which is a different door from this one, and a half-built meter that
 *   counted anonymous reads as free would misreport rather than under-report. So: no meter here, and
 *   the paid feed is a separate authenticated surface when it is built.
 * @structure
 *   - GET /v1/odata/:owner/:name            the service document
 *   - GET /v1/odata/:owner/:name/$metadata  CSDL XML
 *   - GET /v1/odata/:owner/:name/:resource  the entity set
 * @usage app.use(odataRouter(config, storage))
 * @version-history
 *   2026-10-20 -- The feed reads with the caller's whole auth (roles and scopes): an agent, app grant or
 *     ecosystem app of the owner reads a private package only with storage:read, and gets 403
 *     Forbidden naming the word without it (secaudit 2026-10 v41, standing ruling 5). A pinned earlier
 *     version opens on its own audience (secaudit 2026-10 v42, in the store).
 *   2026-10-19 -- Entity-set and error bodies go through sendODataJson: the same content type and body,
 *     set as a header before the send, plus `X-Content-Type-Options: nosniff` (CodeQL 1743).
 *   2026-10-17 — The feed reads with the caller's auth: a package published members, organism:<id> or
 *     private answers 404 to whom its audience does not admit, and a public one stays open to anyone
 *     (plan doc-mvcn6c7e4e5q, V3.8; services/datapackage/audience.ts).
 *   2026-10-15 — The entity set reads every row and pages the answer: at most 5 000 rows per response, @odata.nextLink to the rest, @odata.count over the whole table. It used to return the first 5 000 rows of a larger table as if they were all of it (feature-list audit #151, #193).
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, the OData surface).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { openPackage, readAllRows, parseRef } from '../services/datapackage/store.js';
import { lacksPackageReadScope, ownerAuthOf } from '../services/datapackage/audience.js';
import { toCsdl, parseQuery, applyQueryPaged, nextLinkFor, edmName, ODATA_SUPPORTED } from '../services/datapackage/odata.js';
import type { Descriptor } from '../services/datapackage/contract.js';

/**
 * OData errors have their own shape, and a client renders it. The node envelope would be a body this
 * connector does not read, so a genuine refusal would surface in Excel as "something went wrong".
 */
function odataError(res: Response, status: number, code: string, message: string): void {
    res.status(status);
    sendODataJson(res, { error: { code, message } });
}

/**
 * An OData JSON body. The content type is set on the response before the body, with
 * `X-Content-Type-Options: nosniff`, so a browser cannot read a query value echoed in a nextLink or
 * an error message as HTML (CodeQL js/reflected-xss 1743). Express adds `charset=utf-8` as before.
 */
function sendODataJson(res: Response, body: unknown): void {
    res.setHeader('Content-Type', 'application/json;odata.metadata=minimal');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(JSON.stringify(body, null, 2));
}

/** Every OData response says which version it is, and none of them may be cached as a document: the
 *  feed follows `latest` unless a version is pinned, and a stale answer is a wrong report. */
function odataHeaders(res: Response, pinned: boolean): void {
    res.setHeader('OData-Version', '4.0');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', pinned ? 'public, max-age=300' : 'no-cache');
}

export function odataRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const store = { storage, config };

    /** `pkg:owner/name[@version]` from the path plus the optional `version` query parameter. */
    const refOf = (req: Request): string => {
        const v = typeof req.query.version === 'string' && req.query.version.trim()
            ? `@${req.query.version.trim()}` : '';
        return `pkg:${req.params.owner}/${req.params.name}${v}`;
    };
    /**
     * A package this caller may not open. A principal of the package's owner (agent, app grant,
     * ecosystem app) without storage:read, on a package its owner can open, gets 403 naming the word,
     * as GET /v1/datapackages/... does (secaudit 2026-10 v41); anyone else gets 404, as a missing
     * package does.
     */
    const notOpened = async (req: Request, res: Response, ref: string): Promise<void> => {
        const parsed = parseRef(ref, config.nodeId);
        if (parsed && lacksPackageReadScope(parsed.ownerGhii, req.auth)
            && await openPackage(store, ref, config.nodeId, ownerAuthOf(parsed.ownerGhii))) {
            odataError(res, 403, 'Forbidden',
                'Reading a private data package of your owner, or a private earlier version of one, needs the "storage:read" scope. Ask the owner to grant it.');
            return;
        }
        odataError(res, 404, 'NotFound', `No such data package: ${ref}`);
    };
    const serviceRoot = (req: Request): string =>
        `${config.baseUrl.replace(/\/+$/, '')}/v1/odata/${encodeURIComponent(req.params.owner as string)}`
        + `/${encodeURIComponent(req.params.name as string)}`;

    /** The service document: which entity sets this feed offers. What Excel reads first. */
    router.get('/v1/odata/:owner/:name', async (req, res) => {
        const opened = await openPackage(store, refOf(req), config.nodeId, req.auth);
        if (!opened) { await notOpened(req, res, refOf(req)); return; }
        odataHeaders(res, !!req.query.version);
        res.type('application/json;odata.metadata=minimal').send(JSON.stringify({
            '@odata.context': `${serviceRoot(req)}/$metadata`,
            value: opened.descriptor.resources.map(r => ({
                name: edmName(r.name), kind: 'EntitySet', url: edmName(r.name),
            })),
        }, null, 2));
    });

    /**
     * CSDL. XML, not JSON, because that is what the v4 metadata document is and what every native
     * connector parses — a JSON approximation here would fail inside Excel with no useful message.
     */
    router.get('/v1/odata/:owner/:name/\\$metadata', async (req, res) => {
        const opened = await openPackage(store, refOf(req), config.nodeId, req.auth);
        if (!opened) { await notOpened(req, res, refOf(req)); return; }
        odataHeaders(res, !!req.query.version);
        res.type('application/xml; charset=utf-8')
            .send(toCsdl(opened.descriptor, namespaceFor(opened.descriptor)));
    });

    /** One entity set: the rows, with the readable subset of the query language applied. */
    router.get('/v1/odata/:owner/:name/:resource', async (req, res) => {
        const ref = refOf(req);
        const opened = await openPackage(store, ref, config.nodeId, req.auth);
        if (!opened) { await notOpened(req, res, ref); return; }

        // The client addresses the set by the name the METADATA published, which may differ from the
        // descriptor's own field-legal-but-not-CSDL-legal name.
        const resource = opened.descriptor.resources.find(r => edmName(r.name) === req.params.resource);
        if (!resource) {
            odataError(res, 404, 'NotFound',
                `No entity set "${req.params.resource}". This feed offers: `
                + opened.descriptor.resources.map(r => edmName(r.name)).join(', '));
            return;
        }

        const params = new URLSearchParams(req.url.split('?')[1] ?? '');
        const parsed = parseQuery(params, resource.schema);
        if (!parsed.ok) {
            // 501 for "this feed does not do that", 400 for "you asked for something that is not
            // there". Both are refusals; neither quietly returns the unfiltered set.
            odataError(res, parsed.code === 'NOT_IMPLEMENTED' ? 501 : 400,
                parsed.code === 'NOT_IMPLEMENTED' ? 'NotImplemented' : 'BadRequest', parsed.message);
            return;
        }

        // The whole resource is read and filtered here, then split into pages of ODATA_PAGE_SIZE
        // rows. It used to read a 5 000-row window and return it as the whole table, with
        // @odata.count saying 5 000 too. The read is pinned to the content hash just opened, so a
        // version published between the two calls cannot mix into this answer, and the nextLink
        // carries the same hash. Filtering in the process is honest for the sizes this format is
        // built for; the query is parsed into a shape a storage-side implementation could execute.
        const contentHash = opened.descriptor.aimeat.contentHash;
        const pinnedRef = `pkg:${req.params.owner}/${req.params.name}@${contentHash}`;
        const all = await readAllRows(store, pinnedRef, config.nodeId, resource.name, req.auth);
        if (!all) { odataError(res, 404, 'NotFound', `Could not read ${resource.name} of ${ref}`); return; }

        const page = applyQueryPaged(all.rows, parsed.value, resource.schema);
        odataHeaders(res, !!req.query.version);
        const entitySetUrl = `${serviceRoot(req)}/${encodeURIComponent(edmName(resource.name))}`;
        const body: Record<string, unknown> = {
            '@odata.context': `${serviceRoot(req)}/$metadata#${edmName(resource.name)}`,
            ...(parsed.value.count ? { '@odata.count': page.matched } : {}),
            value: page.rows,
            ...(page.next ? { '@odata.nextLink': nextLinkFor(entitySetUrl, params, page.next, contentHash) } : {}),
        };
        sendODataJson(res, body);
    });

    /** What a caller gets for asking about a feed that does not exist as a whole. */
    router.get('/v1/odata', (_req, res) => {
        odataError(res, 400, 'BadRequest',
            'An OData service root is one data package: /v1/odata/{owner}/{package}. '
            + `Supported query options on an entity set: ${ODATA_SUPPORTED.join(', ')}.`);
    });

    return router;
}

/** The CSDL namespace for one package — its own id, so two packages' metadata cannot collide in a
 *  client that has both open. */
function namespaceFor(d: Descriptor): string {
    return `AIMEAT.${d.name}`;
}
