/**
 * @file test/unit/two-node-process.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description In a process that serves two nodes, the work a node starts while it boots, its
 *   requests, its event-bus listeners, its WebSocket upgrades and the frames on its open sockets
 *   answer for that node, whichever node booted last.
 *
 *   WHY. localAccountName and localAccountOf (utils/gaii.ts) answer for the node the code runs as
 *   (runAsNode), else for the node registered at boot. The second is one value for the whole process,
 *   and the node that booted last sets it. The multi-node E2E suites boot two or three nodes in one
 *   process, so code of the first node that does not run as that node answers for the last one. A
 *   production process serves one node, and there the two values name the same node.
 *
 *   THE NODES START THROUGH THE REAL CODE. Node A starts through runStart (index-start.ts), the way a
 *   node process starts; node B through createServer (server.ts), the way the multi-node helpers
 *   start theirs, so B is the node registered last. The bootstrap steps are stand-ins that do what
 *   the real ones do to the question asked here: config-init registers the node as its last step,
 *   service-init and the background jobs start intervals, a cron job and jobs nobody waits for, and
 *   routes-loader mounts the routes. Every probe asks the same question when it runs: what does
 *   alice of this node cut to, and what does alice of the other node cut to. The listeners are the
 *   real ones: the SSE stream, the cache invalidation, the tracked-response reaction and the
 *   connector's record push. So are the three socket managers: the connector tunnel, the personal
 *   tunnel and the realtime rooms, each reached through a real WebSocket.
 * @usage cd aimeat && pnpm exec vitest run test/unit/two-node-process.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

type Pass = (req: unknown, res: unknown, next: () => void) => void;

const h = vi.hoisted(() => {
    let openGate!: () => void;
    const state = {
        /** Resolves once both nodes have booted, so work waiting on it runs after B was registered. */
        gate: new Promise<void>((resolve) => { openGate = resolve; }),
        opened: false,
        open(): void { state.opened = true; openGate(); },
        /** The two node ids: A starts first, B last. */
        nodes: ['aimeat-two-node-a', 'aimeat-two-node-b'],
        /** The cut every probe asks, set once utils/gaii.ts is imported. */
        cut: null as null | ((identity: string) => string),
        /** The latest answer of each probe: `${node} ${what}` → `${own} | ${other}`. */
        answers: new Map<string, string>(),
        tags: [] as string[],
        timers: [] as Array<ReturnType<typeof setInterval>>,
        crons: [] as Array<{ stop(): void }>,
        tunnels: new Map<string, unknown>(),
        realtime: new Map<string, unknown>(),
        /** What a write to a realtime room's row records: room id → probe name. */
        roomProbes: new Map<string, string>(),
        servers: new Map<string, import('node:http').Server>(),
        /** What the code of `node` answers here: its own alice, and the other node's alice. */
        record(node: string, what: string): void {
            const other = state.nodes.find((n) => n !== node) ?? 'nobody';
            state.answers.set(`${node} ${what}`, `${state.cut!(`alice@${node}`)} | ${state.cut!(`alice@${other}`)}`);
        },
        /** record(), once both nodes have booted. */
        mark(node: string, what: string): void { if (state.opened) state.record(node, what); },
        /** An interval started at boot, as the sweeps, the watchdog and the retries are. */
        every(node: string, what: string): void {
            const t = setInterval(() => state.mark(node, what), 5);
            t.unref();
            state.timers.push(t);
        },
        /** A job started at boot and not waited for, as the seeders and the backfills are. */
        async later(node: string, what: string): Promise<void> {
            await state.gate;
            state.record(node, what);
        },
        /** The store a node opens: only what the code under test reads from it. */
        storageFor(node: string): unknown {
            return {
                listExtensions: async () => [],
                getMaintenanceMode: async () => null,
                // The personal-tunnel upgrade looks the owner's node up here, once it has read the token.
                getPersonalNodeByOwner: async () => {
                    state.record(node, 'a WebSocket upgrade');
                    return { nodeId: 'personal-node-1', agentGaiis: [] };
                },
                // The personal tunnel: a mailbox_ack frame deletes the item, a closed socket marks the
                // personal node offline.
                deleteMailboxItem: async () => { state.record(node, 'a personal-tunnel frame'); },
                updatePersonalNode: async (_id: string, patch: { status?: string }) => {
                    if (patch.status === 'offline') state.record(node, 'a personal-tunnel socket close');
                },
                getMailboxStats: async () => ({ count: 0, totalBytes: 0 }),
                listMailboxItems: async () => [],
                // The realtime rooms: a peer leaving writes the room's peer count.
                createRealtimeRoom: async () => {},
                deleteRealtimeRoom: async () => {},
                updateRealtimeRoom: async (roomId: string) => {
                    const what = state.roomProbes.get(roomId);
                    if (what) state.record(node, what);
                },
                // The connector sends an agent its backlog when it connects.
                listAgentTasks: async () => ({ tasks: [] }),
                listPendingMessages: async () => [],
            };
        },
    };
    return state;
});

// ── Quiet logs ──
vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});

// ── The bootstrap steps createServer runs ──
vi.mock('../../src/server-bootstrap/config-init.js', () => ({
    // The real step opens the store, applies the config layers and settles the hook bindings, and
    // registers the node (initSessionAuth → setThisNodeId) as its last step.
    initializeConfig: async (config: { nodeId: string }) => {
        h.record(config.nodeId, 'a boot step before the node is registered');
        const { setThisNodeId } = await import('../../src/utils/gaii.js');
        setThisNodeId(config.nodeId);
        return { storage: h.storageFor(config.nodeId), provenance: {}, consulService: null };
    },
}));
vi.mock('../../src/server-bootstrap/service-init.js', () => ({
    initializeServices: async (config: { nodeId: string }, storage: unknown) => {
        const node = config.nodeId;
        h.every(node, 'a sweep service-init starts');
        void h.later(node, 'a job service-init starts and does not wait for');
        const { ConnectTunnelManager } = await import('../../src/services/connect-tunnel.js');
        const { TunnelManager } = await import('../../src/services/personal-tunnel.js');
        const connectTunnelManager = new ConnectTunnelManager(config as never, storage as never);
        h.tunnels.set(node, connectTunnelManager);
        return {
            maintenanceCache: {}, setMaintenanceCache: () => {}, directoryService: null, peers: new Map(),
            networkDirectory: null, realtimeManager: null, mailboxNotificationService: null,
            tunnelManager: new TunnelManager(config as never, storage as never),
            connectTunnelManager,
            scheduler: {
                setWebhookDispatcher: () => {}, setPushService: () => {},
                start: async () => {
                    const { Cron } = await import('croner');
                    h.crons.push(new Cron('* * * * * *', () => h.mark(node, 'a scheduler cron job')));
                },
            },
            workflowEngine: {
                setWebhookDispatcher: () => {}, setPushService: () => {}, setEmailService: () => {},
                start: async () => { h.every(node, 'the workflow watchdog'); },
            },
            aiJobService: { reconcileAfterRestart: async () => {} },
        };
    },
}));
vi.mock('../../src/server-bootstrap/routes-loader.js', () => ({
    mountRoutes: async (app: import('express').Express, config: { nodeId: string }, storage: unknown, deps: Record<string, unknown>) => {
        const { initProcessBuffers } = await import('../../src/server-bootstrap/process-buffers.js');
        const { startBackgroundJobs } = await import('../../src/server-bootstrap/background-jobs.js');
        const { sseRouter } = await import('../../src/routes/sse.js');
        const { RealtimeManager } = await import('../../src/services/realtime-manager.js');
        const { localAccountName } = await import('../../src/utils/gaii.js');
        const { webhookDispatcher } = await initProcessBuffers(config as never, storage as never);
        // The rooms manager, as realtime-mount.ts makes it on a node with realtime switched on.
        const realtimeManager = new RealtimeManager(config as never, storage as never);
        h.realtime.set(config.nodeId, realtimeManager);
        // What a cut says inside a request of this node.
        app.get('/probe/cut', (req, res) => { res.json({ cut: localAccountName(String(req.query.id)) }); });
        app.use(sseRouter(config as never, storage as never));
        startBackgroundJobs({
            config, storage, peers: deps.peers, scheduler: deps.scheduler, workflowEngine: deps.workflowEngine,
            aiJobService: deps.aiJobService, webhookDispatcher, pushService: {}, emailService: {},
        } as never);
        // runStart listens on a port it chooses; the test reads the port from the server it made.
        const listen = app.listen.bind(app) as (...args: unknown[]) => import('node:http').Server;
        (app as unknown as { listen: unknown }).listen = (...args: unknown[]) => {
            const server = listen(...args);
            h.servers.set(config.nodeId, server);
            return server;
        };
        return { realtimeManager };
    },
}));
vi.mock('../../src/server-bootstrap/middleware-guards.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    setupGuards: () => {
        const pass: Pass = (_req, _res, next) => next();
        return { rejectForRelay: pass, mirrorReadOnly: pass, invalidateHasOwnersCache: () => {} };
    },
}));
vi.mock('../../src/server-bootstrap/static-files.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    setupStaticFiles: () => {},
}));
vi.mock('../../src/middleware/relay-gate.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    relayGate: (): Pass => (_req, _res, next) => next(),
}));
vi.mock('../../src/middleware/system-fault.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    systemFaultReporter: (): Pass => (_req, _res, next) => next(),
}));
vi.mock('../../src/cli/scaffold.js', () => ({ findPackageRoot: () => null, autoHealAssets: () => null }));

// ── Who is calling: a header names the session, in place of a verified token ──
vi.mock('../../src/auth/middleware.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    optionalAuth: () => (req: { headers: Record<string, unknown>; auth?: unknown }, _res: unknown, next: () => void) => {
        const named = req.headers['x-test-auth'];
        if (typeof named === 'string') req.auth = JSON.parse(named);
        next();
    },
    credentialRevoked: async () => false,
}));
vi.mock('../../src/auth/jwt.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    verifyJWT: async (token: string) => {
        if (token === 'alice-owner') return { sub: 'alice', owner: 'alice', roles: ['owner'], scopes: [], exp: 4102444800 };
        // An agent of alice on node A, as the connector tunnel takes one.
        if (token === 'bot-agent') return { sub: `bot#alice@${h.nodes[0]}`, owner: 'alice', roles: ['agent'], scopes: ['*'], exp: 4102444800 };
        return null;
    },
}));

// ── What initProcessBuffers starts, apart from the cache listener ──
vi.mock('../../src/services/webhook-dispatcher.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), createWebhookDispatcher: () => ({}),
}));
vi.mock('../../src/services/stats.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), initStats: async () => ({}),
}));
vi.mock('../../src/services/auth-audit.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), configureAuthAudit: () => {},
}));
vi.mock('../../src/services/telemetry-buffer.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), initTelemetryBuffer: () => {},
}));
vi.mock('../../src/services/usage/usage-buffer.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), initUsageBuffer: () => {},
}));
vi.mock('../../src/services/data-map/write-tally-buffer.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), initWriteTallyBuffer: () => {},
}));
vi.mock('../../src/services/consent-audit-buffer.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), initConsentAuditBuffer: () => {},
}));
vi.mock('../../src/services/cache.js', async (importOriginal) => {
    const real = await importOriginal<{ invalidateTag: (tag: string) => unknown }>();
    return { ...real, invalidateTag: (tag: string) => { h.tags.push(tag); return real.invalidateTag(tag); } };
});

// ── What startBackgroundJobs starts ──
vi.mock('../../src/services/job-seeding.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    seedCoreScheduledJobs: (config: { nodeId: string }) => h.later(config.nodeId, 'the core job seeding'),
}));
vi.mock('../../src/services/message-delivery.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    startMessageRetryJob: (config: { nodeId: string }) => h.every(config.nodeId, 'the message retry'),
}));
vi.mock('../../src/services/tracked-response.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    startTrackedResponseReconciler: (config: { nodeId: string }) => h.every(config.nodeId, 'the tracked-response reconciler'),
    evaluateTrackedKey: async (ctx: { config: { nodeId: string } }) => {
        await Promise.resolve();
        h.record(ctx.config.nodeId, 'the tracked-response reaction');
    },
}));
vi.mock('../../src/services/track-registry.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    rebuildTrackRegistry: async () => {},
    isTracked: (key: string) => key.startsWith('watched.'),
}));
vi.mock('../../src/services/genesis-sync.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), createGenesisSyncService: () => null,
}));
vi.mock('../../src/services/cache-cleanup.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), startCacheCleanupJob: () => {},
}));
vi.mock('../../src/services/sync-scheduler.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), startSyncScheduler: () => {},
}));
vi.mock('../../src/services/extension-schedules.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), backfillExtensionJobOwnerScope: async () => {},
}));
vi.mock('../../src/services/dependency-map.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), backfillDependencyMap: async () => {},
}));
vi.mock('../../src/services/component-versions.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), backfillComponentVersions: async () => {},
}));

import { loadConfig } from '../../src/config.js';
import { createServer } from '../../src/server.js';
import { runStart } from '../../src/index-start.js';
import { emitChange, emitMemoryWritten } from '../../src/services/event-bus.js';
import { localAccountName, runAsNode, setThisNodeId } from '../../src/utils/gaii.js';

const [NODE_A, NODE_B] = h.nodes;
const AIMEAT_DIR = fileURLToPath(new URL('../..', import.meta.url));
h.cut = localAccountName;

/** The answer of code that runs as `node`: its own alice cut to the account, the other node's whole. */
const asNode = (node: string): string => `alice | alice@${node === NODE_A ? NODE_B : NODE_A}`;

function configFor(nodeId: string): ReturnType<typeof loadConfig>['config'] {
    const { config } = loadConfig({});
    config.nodeId = nodeId;
    config.port = 0;
    config.baseUrl = 'http://127.0.0.1';
    config.devMode = true;
    config.testMode = true;
    config.adminPassword = 'two-node-process';
    config.storageProvider = 'memory';
    return config;
}

async function until(done: () => boolean, ms = 3_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
}

/** The latest answer of each probe, waiting up to three seconds for the ones not yet heard. */
async function answersOf(keys: string[]): Promise<Record<string, string | undefined>> {
    await until(() => keys.every((k) => h.answers.has(k)));
    return Object.fromEntries(keys.map((k) => [k, h.answers.get(k)]));
}

async function call(port: number, method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
}

/** An open SSE stream, split into frames as they arrive. */
function openStream(port: number, ticket: string): Promise<{ frames: string[]; close: () => void }> {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: `/v1/events?ticket=${ticket}` }, (res) => {
            const frames: string[] = [];
            let buf = '';
            res.setEncoding('utf8');
            res.on('error', () => {});
            res.on('data', (chunk: string) => {
                buf += chunk;
                for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
                    frames.push(buf.slice(0, i));
                    buf = buf.slice(i + 2);
                }
            });
            resolve({ frames, close: () => req.destroy() });
        });
        req.on('error', reject);
    });
}

/** A WebSocket upgrade request; the status the node answers it with. */
function upgrade(port: number, path: string, token: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port, path,
            headers: {
                Connection: 'Upgrade', Upgrade: 'websocket', Authorization: `Bearer ${token}`,
                'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            },
        });
        req.on('response', (res) => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on('upgrade', (_res, socket) => { socket.destroy(); resolve(101); });
        req.on('error', reject);
        req.end();
    });
}

/** An open WebSocket to a node, with every frame the node sent it, parsed. */
async function socketTo(port: number, path: string, headers: Record<string, string> = {}): Promise<{ ws: WebSocket; frames: Array<{ type?: string }> }> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    const frames: Array<{ type?: string }> = [];
    ws.on('message', (data) => { frames.push(JSON.parse(String(data)) as { type?: string }); });
    ws.on('error', () => {}); // a node that ends the connection on a broken frame is an expected answer
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('unexpected-response', (_req, res) => reject(new Error(`upgrade answered ${res.statusCode}`)));
    });
    return { ws, frames };
}

let serverA: http.Server;
let serverB: http.Server;
let portA = 0;
let portB = 0;

beforeAll(async () => {
    setThisNodeId(null); // no node has booted in this process yet
    process.env.AIMEAT_ADMIN_PASSWORD ??= 'two-node-process';
    const before = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
    // Node A starts the way a node process starts.
    await runStart(configFor(NODE_A), { envKeys: [], fileKeys: [], cliKeys: [], fileName: null }, AIMEAT_DIR);
    // Its shutdown handlers belong to a node process, not to this test run.
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        for (const l of process.listeners(signal)) if (!before[signal].includes(l)) process.off(signal, l);
    }
    serverA = h.servers.get(NODE_A)!;
    if (!serverA.listening) await new Promise((r) => serverA.once('listening', r));
    portA = (serverA.address() as AddressInfo).port;
    // Node B starts the way the multi-node helpers start theirs, and is the node registered last.
    const b = await createServer(configFor(NODE_B));
    serverB = await new Promise<http.Server>((resolve) => { const s = b.app.listen(0, '127.0.0.1', () => resolve(s)); });
    portB = (serverB.address() as AddressInfo).port;
    h.open();
}, 60_000);

afterAll(async () => {
    for (const t of h.timers) clearInterval(t);
    for (const c of h.crons) c.stop();
    for (const s of [serverA, serverB]) {
        if (!s) continue;
        s.closeAllConnections();
        await new Promise((r) => s.close(() => r(null)));
    }
    setThisNodeId(null);
});

describe('work a node starts while it boots', () => {
    const started = [
        'a sweep service-init starts', 'a job service-init starts and does not wait for', 'a scheduler cron job',
        'the workflow watchdog', 'the core job seeding', 'the message retry', 'the tracked-response reconciler',
    ];

    it('answers for the node that started it, whichever node booted last', async () => {
        const keys = [NODE_A, NODE_B].flatMap((node) => started.map((what) => `${node} ${what}`));
        const got = await answersOf(keys);
        expect(got).toEqual(Object.fromEntries(keys.map((k) => [k, asNode(k.slice(0, k.indexOf(' ')))])));
    });

    it('answers for the node that boots, before that node is registered', () => {
        // Node A's step ran with no node registered in the process; node B's with node A registered.
        const key = (node: string) => `${node} a boot step before the node is registered`;
        expect({ a: h.answers.get(key(NODE_A)), b: h.answers.get(key(NODE_B)) })
            .toEqual({ a: asNode(NODE_A), b: asNode(NODE_B) });
    });
});

describe('a request', () => {
    const cut = async (port: number, id: string) =>
        (await call(port, 'GET', `/probe/cut?id=${encodeURIComponent(id)}`)).body.cut;

    it('answers for the node that serves it, whichever node booted last', async () => {
        expect([await cut(portA, `alice@${NODE_A}`), await cut(portA, `alice@${NODE_B}`)]).toEqual(['alice', `alice@${NODE_B}`]);
        expect([await cut(portB, `alice@${NODE_B}`), await cut(portB, `alice@${NODE_A}`)]).toEqual(['alice', `alice@${NODE_A}`]);
    });

    it('answers for the node that serves it when no node is registered', async () => {
        setThisNodeId(null);
        try {
            expect([await cut(portA, `alice@${NODE_A}`), await cut(portA, `alice@${NODE_B}`)]).toEqual(['alice', `alice@${NODE_B}`]);
        } finally {
            setThisNodeId(NODE_B);
        }
    });
});

describe('code that runs as no node', () => {
    it('cuts every identity when no node is registered, as the connector CLI and unit tests need', () => {
        setThisNodeId(null);
        try {
            expect([localAccountName(`alice@${NODE_A}`), localAccountName('bot#alice@some-peer-node')]).toEqual(['alice', 'alice']);
        } finally {
            setThisNodeId(NODE_B);
        }
    });
});

describe('an event-bus listener of node A, when node B emits', () => {
    it('SSE: the stream of alice on node A hears her own events and not those of alice on node B', async () => {
        const auth = JSON.stringify({ sub: 'alice', owner: 'alice', roles: ['owner'], scopes: [] });
        const t = await call(portA, 'POST', '/v1/events/ticket', { 'x-test-auth': auth });
        expect(t.status).toBe(200);
        const stream = await openStream(portA, (t.body.data as { ticket: string }).ticket);
        try {
            await until(() => stream.frames.includes(':open'));
            runAsNode(NODE_B, () => emitChange('probe-namesake', `alice@${NODE_B}`));
            runAsNode(NODE_B, () => emitChange('probe-own', `alice@${NODE_A}`));
            await new Promise((r) => setTimeout(r, 1_200)); // one coalescing window
            const heard = stream.frames
                .filter((f) => f.startsWith('data: '))
                .flatMap((f) => (JSON.parse(f.slice(6)) as { domains: string[] }).domains);
            expect({ own: heard.includes('probe-own'), namesake: heard.includes('probe-namesake') })
                .toEqual({ own: true, namesake: false });
        } finally {
            stream.close();
        }
    });

    it('cache: node A drops the tag of the identity whole, node B the tag of its own account', () => {
        h.tags.length = 0;
        runAsNode(NODE_B, () => emitChange('probe-cache', `alice@${NODE_B}`));
        expect(h.tags.filter((t) => t.startsWith('owner:')).sort())
            .toEqual(['owner:alice:probe-cache', `owner:alice@${NODE_B}:probe-cache`]);
    });

    it('tracked responses: each node reacts to the write as itself', async () => {
        const keys = [NODE_A, NODE_B].map((node) => `${node} the tracked-response reaction`);
        for (const k of keys) h.answers.delete(k);
        runAsNode(NODE_B, () => emitMemoryWritten(`alice@${NODE_B}`, 'watched.probe'));
        expect(await answersOf(keys)).toEqual({ [keys[0]]: asNode(NODE_A), [keys[1]]: asNode(NODE_B) });
    });

    it('connector record push: node A checks its subscriber\'s read as node A', async () => {
        const principal = `bot#alice@${NODE_A}`;
        const mgr = h.tunnels.get(NODE_A) as {
            connections: Map<string, unknown>;
            spaceSubscribers: Map<string, Set<string>>;
            canPrincipalReadSpace: unknown;
        };
        mgr.connections.set(principal, { principal, ws: { readyState: 1, send: () => {} } });
        mgr.spaceSubscribers.set('org-1|ws-1|tasks', new Set([principal]));
        mgr.canPrincipalReadSpace = async () => { h.record(NODE_A, 'the connector record push'); return false; };
        try {
            runAsNode(NODE_B, () => emitMemoryWritten(`alice@${NODE_B}`, 'organism.org-1.w.ws-1.tasks.t-1'));
            const key = `${NODE_A} the connector record push`;
            expect((await answersOf([key]))[key]).toBe(asNode(NODE_A));
        } finally {
            mgr.connections.delete(principal);
            mgr.spaceSubscribers.delete('org-1|ws-1|tasks');
        }
    });
});

describe('a WebSocket upgrade', () => {
    it('answers for the node that takes it, whichever node booted last', async () => {
        h.answers.delete(`${NODE_A} a WebSocket upgrade`);
        expect(await upgrade(portA, '/v1/personal/tunnel', 'alice-owner')).toBe(101);
        expect(h.answers.get(`${NODE_A} a WebSocket upgrade`)).toBe(asNode(NODE_A));
    });
});

describe('an event on an open socket of node A, while node B booted last', () => {
    it('connector tunnel: a subscribe frame checks the read as node A', async () => {
        const key = `${NODE_A} a connector-tunnel frame`;
        const mgr = h.tunnels.get(NODE_A) as { canPrincipalReadSpace: unknown };
        mgr.canPrincipalReadSpace = async () => { h.record(NODE_A, 'a connector-tunnel frame'); return false; };
        const { ws, frames } = await socketTo(portA, '/v1/connect/tunnel', { Authorization: 'Bearer bot-agent' });
        try {
            await until(() => frames.some((f) => f.type === 'welcome'));
            h.answers.delete(key);
            ws.send(JSON.stringify({ type: 'subscribe', id: 'sub-1', spaces: [{ organism_id: 'org-1', ws: 'ws-1', space: 'tasks' }] }));
            await until(() => frames.some((f) => f.type === 'subscribed'));
            expect(h.answers.get(key)).toBe(asNode(NODE_A));
        } finally {
            ws.close();
        }
    });

    it('personal tunnel: a frame, and the socket closing, run as node A', async () => {
        const keys = ['a personal-tunnel frame', 'a personal-tunnel socket close'].map((what) => `${NODE_A} ${what}`);
        const { ws, frames } = await socketTo(portA, '/v1/personal/tunnel', { Authorization: 'Bearer alice-owner' });
        await until(() => frames.some((f) => f.type === 'welcome'));
        for (const k of keys) h.answers.delete(k);
        // The personal node confirms it holds a mailbox item, and the node deletes its own copy.
        ws.send(JSON.stringify({ type: 'mailbox_ack', id: 'ack-1', payload: JSON.stringify(['item-1']), timestamp: new Date().toISOString() }));
        await answersOf([keys[0]]);
        ws.close();
        expect(await answersOf(keys)).toEqual({ [keys[0]]: asNode(NODE_A), [keys[1]]: asNode(NODE_A) });
    });

    it('realtime room: a frame, the socket closing and a socket error run as node A', async () => {
        const mgr = h.realtime.get(NODE_A) as { createRoom(opts: Record<string, unknown>): Promise<{ id: string }> };
        /** A peer in a room of its own; what the room's row records is named `what`. */
        const joined = async (what: string) => {
            const room = await mgr.createRoom({ appType: 'probe', name: what.replace(/\W+/g, '-'), createdBy: `alice@${NODE_A}` });
            h.roomProbes.set(room.id, what);
            const peer = await socketTo(portA, `/v1/realtime/ws?room=${room.id}&nick=probe&token=alice-owner`);
            await until(() => peer.frames.some((f) => f.type === 'joined'));
            h.answers.delete(`${NODE_A} ${what}`);
            return peer.ws;
        };
        const leaves = await joined('a realtime frame');
        leaves.send(JSON.stringify({ type: 'leave' }));
        const closes = await joined('a realtime socket close');
        closes.close();
        const breaks = await joined('a realtime socket error');
        // A client frame without a mask breaks the protocol, and the node's socket reports an error.
        (breaks as unknown as { _socket: Socket })._socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
        const keys = ['a realtime frame', 'a realtime socket close', 'a realtime socket error'].map((what) => `${NODE_A} ${what}`);
        expect(await answersOf(keys)).toEqual(Object.fromEntries(keys.map((k) => [k, asNode(NODE_A)])));
    });
});
