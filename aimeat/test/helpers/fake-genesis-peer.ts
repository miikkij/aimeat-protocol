/**
 * @file test/helpers/fake-genesis-peer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Another FEDERATION, answered on loopback inside the test process. A genesis peer is
 *   not a peer node: it is a whole other federation this node exchanges catalogues and memory with,
 *   so nothing short of a second world can drive the genesis routes past their refusals. This is
 *   that second world, reduced to the four doors the node under test ever knocks on:
 *
 *     GET  /v1/federation/cross-catalogue          what genesis-sync pulls
 *     GET  /v1/federation/genesis-memory-read      what a cross-genesis memory read fans out to
 *     POST /v1/federation/genesis-catalogue-ingest what genesis-sync pushes back
 *     POST /v1/federation/replicate                where a prefix subscription sends memory
 *
 *   It carries its own Ed25519 key pair, because the ingest door on the node under test verifies a
 *   signature made with the key the operator pinned when the peering was requested. What each door
 *   answers is mutable, so a suite can turn one 404 or hand back a shorter catalogue between calls
 *   and watch the node react. Every request is recorded whole, so an assertion can hold the node to
 *   the body it actually put on the wire rather than to the status it got back.
 * @structure
 *   - RecordedRequest: method, path, query and parsed body of one arriving request
 *   - FakeGenesisPeer: the handle, with the mutable answers and the request log
 *   - startFakeGenesisPeer(nodeId): listens on 127.0.0.1 on a free port
 * @usage
 *   const peer = await startFakeGenesisPeer('aimeat-remote-001-fake');
 *   peer.catalogueEntries = [{ id: 'a1', type: 'action' }];
 *   ... drive the node ...
 *   await peer.close();
 * @version-history
 *   v1.0.0 — 2026-09-08 — Written for test/e2e-genesis-federation.ts.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

/** One request that arrived at the fake federation, kept whole. */
export interface RecordedRequest {
    method: string;
    /** Pathname only, without the query string. */
    path: string;
    query: Record<string, string>;
    body: Record<string, unknown> | null;
}

export interface FakeGenesisPeer {
    /** The address to register as `genesisUrl`. */
    url: string;
    nodeId: string;
    /** Base64, the value the operator pins on the peering record. */
    publicKey: string;
    privateKey: string;
    requests: RecordedRequest[];

    /** What GET /v1/federation/cross-catalogue answers under data.entries. */
    catalogueEntries: Array<Record<string, unknown>>;
    /** What that same door answers under data.catalogue_hash. */
    catalogueHash: string;
    /** What GET /v1/federation/genesis-memory-read answers under data.results. */
    memoryResults: Array<Record<string, unknown>>;
    /** The status POST /v1/federation/genesis-catalogue-ingest answers with. 404 is the graceful case. */
    ingestStatus: number;

    /** How many requests of this method reached this exact path. */
    count(method: string, path: string): number;
    /** Those requests, oldest first. */
    seen(method: string, path: string): RecordedRequest[];
    /** Sign a message with this federation's private key, the way the real far end would. */
    sign(message: string): Promise<string>;
    close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk.toString(); });
        req.on('end', () => resolve(raw));
    });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

export async function startFakeGenesisPeer(nodeId: string): Promise<FakeGenesisPeer> {
    const privateKeyBytes = ed.utils.randomSecretKey();
    const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes);

    const state = {
        url: '',
        nodeId,
        publicKey: Buffer.from(publicKeyBytes).toString('base64'),
        privateKey: Buffer.from(privateKeyBytes).toString('base64'),
        requests: [] as RecordedRequest[],
        catalogueEntries: [] as Array<Record<string, unknown>>,
        catalogueHash: 'remote-catalogue-hash-0',
        memoryResults: [] as Array<Record<string, unknown>>,
        ingestStatus: 200,
    };

    const server: Server = createServer((req, res) => {
        void (async () => {
            const raw = req.method === 'POST' ? await readBody(req) : '';
            const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
            let body: Record<string, unknown> | null = null;
            if (raw) {
                try { body = JSON.parse(raw) as Record<string, unknown>; }
                catch { body = { _unparsed: raw }; }
            }
            state.requests.push({
                method: req.method ?? 'GET',
                path: parsed.pathname,
                query: Object.fromEntries(parsed.searchParams.entries()),
                body,
            });

            if (req.method === 'GET' && parsed.pathname === '/v1/federation/cross-catalogue') {
                send(res, 200, {
                    ok: true,
                    node_id: state.nodeId,
                    data: { entries: state.catalogueEntries, total: state.catalogueEntries.length, catalogue_hash: state.catalogueHash },
                });
                return;
            }

            if (req.method === 'GET' && parsed.pathname === '/v1/federation/genesis-memory-read') {
                send(res, 200, {
                    ok: true,
                    node_id: state.nodeId,
                    data: { results: state.memoryResults, total: state.memoryResults.length },
                });
                return;
            }

            if (req.method === 'POST' && parsed.pathname === '/v1/federation/genesis-catalogue-ingest') {
                if (state.ingestStatus !== 200) {
                    send(res, state.ingestStatus, { ok: false, error: { code: 'NOT_FOUND', message: 'no ingest door here' } });
                    return;
                }
                send(res, 200, { ok: true, node_id: state.nodeId, data: { stored: 0 } });
                return;
            }

            if (req.method === 'POST' && parsed.pathname === '/v1/federation/replicate') {
                send(res, 200, { ok: true, node_id: state.nodeId, data: { replicated: true } });
                return;
            }

            send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: parsed.pathname } });
        })();
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
    });
    state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    return {
        get url() { return state.url; },
        get nodeId() { return state.nodeId; },
        get publicKey() { return state.publicKey; },
        get privateKey() { return state.privateKey; },
        get requests() { return state.requests; },
        get catalogueEntries() { return state.catalogueEntries; },
        set catalogueEntries(v) { state.catalogueEntries = v; },
        get catalogueHash() { return state.catalogueHash; },
        set catalogueHash(v) { state.catalogueHash = v; },
        get memoryResults() { return state.memoryResults; },
        set memoryResults(v) { state.memoryResults = v; },
        get ingestStatus() { return state.ingestStatus; },
        set ingestStatus(v) { state.ingestStatus = v; },
        count(method, path) {
            return state.requests.filter(r => r.method === method && r.path === path).length;
        },
        seen(method, path) {
            return state.requests.filter(r => r.method === method && r.path === path);
        },
        async sign(message) {
            const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(state.privateKey, 'base64'));
            return Buffer.from(sig).toString('base64');
        },
        close() {
            return new Promise<void>((resolve) => { server.close(() => resolve()); });
        },
    };
}
