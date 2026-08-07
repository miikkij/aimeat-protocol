/**
 * @file src/routes/admin-monitoring.ts
 * @description Operator-only admin routes for monitoring and federation control — listing all work
 *   items, inspecting federation peers/peering requests, and initiating a federation join
 *   (key exchange) with a genesis/target node.
 *
 * @structure
 *   - adminMonitoringRouter(config, storage, peers): builds the operator-gated router
 *   - GET /v1/admin/work: lists all work items with status and cost
 *   - GET /v1/admin/federation: lists peering requests/peers
 *   - POST /v1/admin/federation/join: introduces this node to a target via key exchange
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord, WalletTransaction } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { RoleGrantSchema, validateBody } from '../models/schemas.js';
import { randomBytes } from 'node:crypto';
import { generateKeyPair, sign } from '../auth/keypair.js';
import { emitChange } from '../services/event-bus.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import type { PeerInfo } from '../services/federation.js';
import { performKeyExchange } from '../services/federation-helpers.js';
import { logger } from '../utils/logger.js';

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_DURATION_MS = 30 * 60_000;

export function adminMonitoringRouter(
    config: AimeatConfig,
    storage: Storage,
    peers?: Map<string, PeerInfo>,
): Router {
    const router = Router();

    // GET /v1/admin/work — list all work items (operator only)
    router.get('/v1/admin/work', requireAuth(), requireRole('operator'), async (_req, res) => {
        const allWork = await storage.listAllWork();
        res.json(success(config.nodeId, {
            work: allWork.map(w => ({
                tracking_code: w.trackingCode,
                status: w.status,
                action_id: w.actionId,
                provider_gaii: w.providerGaii,
                requester_gaii: w.requesterGaii,
                cost: w.cost,
                created_at: w.createdAt,
                updated_at: w.updatedAt,
                ttl_expires_at: w.ttlExpiresAt,
            })),
            total: allWork.length,
        }));
    });

    // GET /v1/admin/federation — federation info (operator only)
    router.get('/v1/admin/federation', requireAuth(), requireRole('operator'), async (_req, res) => {
        const peers = await storage.listPeeringRequests();
        res.json(success(config.nodeId, {
            peers: peers.map(p => ({
                id: p.id,
                from_node_url: p.fromNodeUrl,
                from_node_id: p.fromNodeId,
                target_url: p.targetUrl,
                status: p.status,
                message: p.message,
                created_at: p.createdAt,
            })),
            total: peers.length,
        }));
    });

    // POST /v1/admin/federation/join — introduce this node to a genesis/target node (operator only)
    router.post('/v1/admin/federation/join', requireAuth(), requireRole('operator'), async (req, res) => {
        const { genesis_url, role } = req.body ?? {};
        if (!genesis_url || typeof genesis_url !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'genesis_url is required'));
            return;
        }
        const joinRole = (role === 'operator' || role === 'contributor') ? role : 'contributor';
        const targetUrl = genesis_url.replace(/\/+$/, '');

        // SSRF validation before outbound fetch
        const ssrfCheck = await validateOutboundUrl(targetUrl);
        if (!ssrfCheck.valid) {
            res.status(400).json(error(config.nodeId, 'INVALID_URL', `URL blocked: ${ssrfCheck.reason}`));
            return;
        }

        // 1. Discovery
        let targetInfo: { node_id?: string; type?: string; protocol?: string; version?: string | number; capabilities?: string[] };
        try {
            const disc = await fetch(`${targetUrl}/.well-known/aimeat`, { signal: AbortSignal.timeout(10_000) });
            if (!disc.ok) throw new Error(`HTTP ${disc.status}`);
            const body = await disc.json() as { data?: typeof targetInfo };
            targetInfo = body.data!;
            if (!targetInfo?.protocol || targetInfo.protocol !== 'aimeat') {
                res.status(502).json(error(config.nodeId, 'NOT_AIMEAT', 'Target is not an AIMEAT node'));
                return;
            }
        } catch (e) {
            res.status(502).json(error(config.nodeId, 'DISCOVERY_FAILED',
                `Cannot reach ${targetUrl}: ${e instanceof Error ? e.message : String(e)}`));
            return;
        }

        // 2. Ensure this node has a keypair
        let publicKey = process.env.AIMEAT_PUBLIC_KEY ?? '';
        let privateKey = process.env.AIMEAT_PRIVATE_KEY ?? '';
        if (!publicKey || !privateKey) {
            const keys = await generateKeyPair();
            publicKey = keys.publicKey;
            privateKey = keys.privateKey;
            process.env.AIMEAT_PUBLIC_KEY = publicKey;
            process.env.AIMEAT_PRIVATE_KEY = privateKey;
        }

        // 3. Sign and send introduction
        const timestamp = new Date().toISOString();
        const messageToSign = `${config.nodeId}${config.baseUrl}${timestamp}`;
        const signature = await sign(privateKey, messageToSign);

        try {
            const introResp = await fetch(`${targetUrl}/v1/federation/peer/introduce`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_id: config.nodeId,
                    node_url: config.baseUrl,
                    node_type: config.nodeType,
                    public_key: publicKey,
                    role: joinRole,
                    message: '',
                    signature,
                    timestamp,
                }),
                signal: AbortSignal.timeout(15_000),
            });

            const introBody = await introResp.json() as { data?: { request_id: string; status: string; message?: string }; error?: { message?: string } };
            if (!introResp.ok) {
                const msg = introBody?.error?.message ?? `HTTP ${introResp.status}`;
                res.status(introResp.status).json(error(config.nodeId, 'INTRODUCTION_FAILED', msg));
                return;
            }

            // Store local peering request so we recognize the peer during key exchange
            const requestId = introBody.data?.request_id ?? `local-${Date.now()}`;
            await storage.createPeeringRequest({
                id: requestId,
                fromNodeId: targetInfo.node_id ?? targetUrl,
                fromNodeUrl: targetUrl,
                toNodeId: config.nodeId,
                status: 'approved',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const remoteStatus = introBody.data?.status ?? 'pending';

            res.json(success(config.nodeId, {
                target_node_id: targetInfo.node_id,
                target_url: targetUrl,
                request_id: requestId,
                status: remoteStatus,
                message: introBody.data?.message ?? 'Introduction sent. Awaiting genesis operator approval.',
            }));
            emitChange('config');

            const targetNodeId = targetInfo.node_id ?? targetUrl;

            if (remoteStatus === 'auto_approved') {
                completeJoin(targetUrl, targetNodeId, config, storage, peers);
            } else {
                pollForApprovalAndComplete(targetUrl, targetNodeId, requestId, config, storage, peers);
            }
        } catch (e) {
            res.status(502).json(error(config.nodeId, 'INTRODUCTION_FAILED',
                `Failed to introduce to ${targetUrl}: ${e instanceof Error ? e.message : String(e)}`));
        }
    });

    // GET /v1/admin/stats — aggregate statistics (operator only)
    router.get('/v1/admin/stats', requireAuth(), requireRole('operator'), async (_req, res) => {
        const agents = await storage.listAgents();
        const actions = await storage.listActions();

        const trustBuckets = { low: 0, medium: 0, high: 0 };
        for (const a of agents) {
            if (a.trustScore < 30) trustBuckets.low++;
            else if (a.trustScore < 70) trustBuckets.medium++;
            else trustBuckets.high++;
        }

        res.json(success(config.nodeId, {
            agents: {
                total: agents.length,
                trust_distribution: trustBuckets,
            },
            actions: {
                total: actions.length,
                categories: [...new Set(actions.map(a => a.category).filter(Boolean))],
            },
        }));
    });

    // GET /v1/admin/onboarding-funnel — the activation funnel (05-mittaus.md), operator only.
    // Rows = accounts newest first (uxtest-* excluded), each with the four markers, plus one
    // weekly-cohort rollup: created, activated (count + rate), median TTFV, activation kinds,
    // hello-page opens, MCP connections, rescues sent. Deliberately a TABLE and not a chart:
    // the decision it supports is "did the change move activation", not a dashboard.
    // ?since=<ISO> narrows the window, ?limit caps the row count (default 200, max 1000).
    router.get('/v1/admin/onboarding-funnel', requireAuth(), requireRole('operator'), async (req, res) => {
        const { readOnboardingFunnel } = await import('../services/onboarding-funnel.js');
        const since = typeof req.query.since === 'string' ? req.query.since : undefined;
        const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
        const rows = await readOnboardingFunnel(storage, { since, limit });

        // ISO week key (YYYY-Www) — the cohort grain 05-mittaus.md specifies.
        const weekOf = (iso: string): string => {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return 'unknown';
            const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
            t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));           // ISO: Thursday decides the year
            const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
            const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
            return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
        };
        const median = (xs: number[]): number | null => {
            if (xs.length === 0) return null;
            const s = [...xs].sort((a, b) => a - b);
            const mid = Math.floor(s.length / 2);
            return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
        };

        // Cohorts are grouped by week × TRACK (05-mittaus.md). One row group per path per week:
        // mixing the old and the new path into one number means neither can be judged, which is
        // the whole reason the track marker exists. Sorted newest week first, remake before legacy
        // within a week so the path under evaluation reads first.
        const byWeekTrack = new Map<string, typeof rows>();
        for (const r of rows) {
            const k = `${weekOf(r.createdAt)} ${r.track}`;
            const list = byWeekTrack.get(k) ?? [];
            list.push(r);
            byWeekTrack.set(k, list);
        }
        const cohorts = [...byWeekTrack.entries()]
            .sort((a, b) => {
                const [wa, ta] = a[0].split(' ');
                const [wb, tb] = b[0].split(' ');
                // Within a week the remake reads above legacy: the remake is the thing being
                // judged, and the legacy row is the comparison it is judged against.
                return wb.localeCompare(wa) || (ta === tb ? 0 : ta === 'remake' ? -1 : 1);
            })
            .map(([key, list]) => {
                const [week, track] = key.split(' ');
                const activated = list.filter(r => !!r.activatedAt);
                const ttfvs = activated.map(r => r.ttfvMinutes).filter((n): n is number => typeof n === 'number');
                return {
                    week,
                    track,
                    created: list.length,
                    hello_page_opened: list.filter(r => !!r.helloOpenedAt).length,
                    mcp_connected: list.filter(r => !!r.firstMcpCallAt).length,
                    activated: activated.length,
                    // Rate as a percentage with one decimal — comparable to the external benchmarks
                    // the remake was measured against (03-ulkoinen-vertailu.md).
                    activation_rate_pct: list.length ? Math.round((activated.length / list.length) * 1000) / 10 : 0,
                    ttfv_median_minutes: median(ttfvs),
                    activation_kinds: {
                        app: activated.filter(r => r.activationKind === 'app').length,
                        workspace: activated.filter(r => r.activationKind === 'workspace').length,
                        agent: activated.filter(r => r.activationKind === 'agent').length,
                    },
                    rescue_sent: list.filter(r => !!r.rescueSentAt).length,
                    // ── the remake funnel, left to right as a person walks it ──
                    mat_ok: list.filter(r => r.matResult === 'ok').length,
                    mat_failed: list.filter(r => r.matResult === 'failed').length,
                    // Total attempts across the cohort: mat_attempts / mat_ok is how hard the
                    // prompt is, and it is the number the prompt gets edited against.
                    mat_attempts: list.reduce((n, r) => n + r.matAttempts, 0),
                    branch: {
                        A: list.filter(r => r.branch === 'A').length,
                        B: list.filter(r => r.branch === 'B').length,
                        agent: list.filter(r => r.branch === 'agent').length,
                    },
                    first_agent_connected: list.filter(r => !!r.firstAgentConnectedAt).length,
                    home_initialized: list.filter(r => !!r.homeInitializedAt).length,
                    // The one number the whole remake is judged by.
                    home_initialized_rate_pct: list.length
                        ? Math.round((list.filter(r => !!r.homeInitializedAt).length / list.length) * 1000) / 10 : 0,
                    room_entered: list.filter(r => !!r.room).length,
                    rooms: {
                        create: list.filter(r => r.room === 'create').length,
                        organise: list.filter(r => r.room === 'organise').length,
                        monetise: list.filter(r => r.room === 'monetise').length,
                        company: list.filter(r => r.room === 'company').length,
                    },
                    // Its own column on purpose: remake-created accounts leaving for the old path
                    // is the result, not a footnote.
                    switched: list.filter(r => r.switched > 0).length,
                };
            });

        res.json(success(config.nodeId, { cohorts, rows, total: rows.length }));
    });

    // GET /v1/admin/messages/stats — direct-message delivery telemetry (operator only).
    // Operator visibility into whether sends land or pile up in errors. Carries NO message content
    // and NO participant identities — only routing/outcome metadata.
    router.get('/v1/admin/messages/stats', requireAuth(), requireRole('operator'), async (_req, res) => {
        const stats = await storage.getMessageDeliveryStats();
        const recent = await storage.listMessageDeliveryLogs(50);
        res.json(success(config.nodeId, { stats, recent }));
    });

    // GET /v1/admin/backup — export all data as JSON (operator only)
    router.get('/v1/admin/backup', requireAuth(), requireRole('operator'), async (_req, res) => {
        const owners = await storage.listOwners();
        const agents = await storage.listAgents();
        const actions = await storage.listActions();
        const boards = await storage.listBoards();

        // Collect all memories and transactions per agent
        const agentData: Record<string, { memories: unknown[]; transactions: unknown[] }> = {};
        for (const a of agents) {
            const memories = await storage.listMemory(a.gaii);
            const transactions = await storage.getTransactions(a.gaii, 100_000);
            agentData[a.gaii] = { memories, transactions };
        }

        res.json(success(config.nodeId, {
            version: '1.2',
            exported_at: new Date().toISOString(),
            node_id: config.nodeId,
            owners,
            agents,
            actions,
            boards,
            agent_data: agentData,
        }));
    });

    // POST /v1/admin/restore — import data from backup (operator only)
    router.post('/v1/admin/restore', requireAuth(), requireRole('operator'), async (req, res) => {
        const { owners, agents, actions, boards, agent_data } = req.body ?? {};
        const imported = { owners: 0, agents: 0, actions: 0, boards: 0, memories: 0 };

        if (owners) {
            for (const o of owners) {
                try { await storage.createOwner(o); imported.owners++; } catch (err) { logger.warn('POST /v1/admin/restore: skip duplicates', { error: String(err) }); }
            }
        }
        if (agents) {
            for (const a of agents) {
                try { await storage.createAgent(a); imported.agents++; } catch (err) { logger.warn('POST /v1/admin/restore: skip duplicates', { error: String(err) }); }
            }
        }
        if (actions) {
            for (const a of actions) {
                try { await storage.createAction(a); imported.actions++; } catch (err) { logger.warn('POST /v1/admin/restore: skip duplicates', { error: String(err) }); }
            }
        }
        if (boards) {
            for (const b of boards) {
                try { await storage.createBoard(b); imported.boards++; } catch (err) { logger.warn('POST /v1/admin/restore: skip duplicates', { error: String(err) }); }
            }
        }
        if (agent_data) {
            for (const [, data] of Object.entries(
                agent_data as Record<string, { memories?: MemoryRecord[]; transactions?: WalletTransaction[] }>,
            )) {
                if (data.memories) {
                    for (const m of data.memories) {
                        await storage.setMemory(m);
                        imported.memories++;
                    }
                }
                if (data.transactions) {
                    for (const tx of data.transactions) {
                        await storage.addTransaction(tx);
                    }
                }
            }
        }

        res.json(success(config.nodeId, {
            restored: true,
            imported,
        }));
        emitChange('config');
    });

    // POST /v1/admin/roles/grant — grant operator role (operator only)
    router.post('/v1/admin/roles/grant', requireAuth(), requireRole('operator'), validateBody(RoleGrantSchema, config.nodeId), async (req, res) => {
        const { owner } = req.body ?? {};

        const ownerRecord = await storage.getOwner(owner);
        if (!ownerRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${owner}`));
            return;
        }

        if (ownerRecord.roles.includes('operator')) {
            res.status(409).json(error(config.nodeId, 'CONFLICT', `Owner "${owner}" already has operator role`));
            return;
        }

        await storage.updateOwner(owner, { roles: [...ownerRecord.roles, 'operator'] });

        res.json(success(config.nodeId, {
            owner,
            role: 'operator',
            granted: true,
        }));
        emitChange('config');
    });

    // D.2: Trust advisory broadcast endpoint (operator only)
    router.post('/v1/admin/federation/trust-advisory', requireAuth(), requireRole('operator'), async (req, res) => {
        const { target_node, advisory_type, reason, evidence_hash } = req.body ?? {};

        if (!target_node || !advisory_type || !reason) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_node, advisory_type, and reason are required'));
            return;
        }

        const validTypes = ['warning', 'suspend', 'ban'];
        if (!validTypes.includes(advisory_type)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `advisory_type must be one of: ${validTypes.join(', ')}`));
            return;
        }

        // Note: Trust broadcast requires peers map which admin router doesn't have access to.
        // Store the advisory and let the federation service pick it up.
        const advisoryRecord = {
            id: `adv-${randomBytes(8).toString('hex')}`,
            target_node,
            advisory_type,
            reason,
            evidence_hash: evidence_hash ?? null,
            issued_by: config.nodeId,
            created_at: new Date().toISOString(),
            status: 'issued',
        };

        // Store as memory for persistence and querying
        const systemGaii = `system@${config.nodeId}`;
        await storage.setMemory({
            key: `trust_advisory:${advisoryRecord.id}`,
            ownerGaii: systemGaii,
            value: advisoryRecord,
            visibility: 'private',
            tags: ['trust_advisory', `target:${target_node}`, `type:${advisory_type}`],
            ttlHours: null,
            version: 1,
            createdAt: advisoryRecord.created_at,
            updatedAt: advisoryRecord.created_at,
        });

        res.status(201).json(success(config.nodeId, {
            advisory: advisoryRecord,
            note: 'Advisory stored. It will be broadcast to peers during next sync cycle or can be manually triggered.',
        }));
        emitChange('config');
    });

    // D.2: List trust advisories (received + issued)
    router.get('/v1/admin/federation/trust-advisories', requireAuth(), requireRole('operator'), async (req, res) => {
        const systemGaii = `system@${config.nodeId}`;
        // Query trust advisory memories
        const memories = await storage.listMemory(systemGaii, { prefix: 'trust_advisory:' });

        const advisories = memories.map(m => ({
            id: (m.value as Record<string, unknown>)?.id ?? m.key.replace('trust_advisory:', ''),
            ...(m.value as Record<string, unknown>),
            stored_at: m.createdAt,
        }));

        // Sort by most recent first
        advisories.sort((a, b) => {
            const aTime = (a as { created_at?: string }).created_at ?? '';
            const bTime = (b as { created_at?: string }).created_at ?? '';
            return bTime.localeCompare(aTime);
        });

        res.json(success(config.nodeId, {
            advisories,
            total: advisories.length,
        }));
    });

    // B.3: Sync health metrics (operator only)
    router.get('/v1/admin/federation/sync-health', requireAuth(), requireRole('operator'), async (_req, res) => {
        const queueSize = await storage.replicationQueueSize();

        res.json(success(config.nodeId, {
            queue_depth: queueSize,
            timestamp: new Date().toISOString(),
        }));
    });

    // F.4: Relay earnings query (operator only)
    router.get('/v1/admin/federation/relay-earnings', requireAuth(), requireRole('operator'), async (req, res) => {
        const since = req.query.since as string | undefined;
        const until = req.query.until as string | undefined;

        const systemGaii = `system@${config.nodeId}`;
        const memories = await storage.listMemory(systemGaii, { prefix: 'relay_earning:' });

        let earnings = memories.map(m => m.value as Record<string, unknown>);

        if (since) {
            earnings = earnings.filter(e => (e.timestamp as string) >= since);
        }
        if (until) {
            earnings = earnings.filter(e => (e.timestamp as string) <= until);
        }

        const totalMorsels = earnings.reduce((sum, e) => sum + ((e.amount as number) ?? 0), 0);

        res.json(success(config.nodeId, {
            earnings,
            total_morsels: totalMorsels,
            total_entries: earnings.length,
            period: { since: since ?? null, until: until ?? null },
        }));
    });

    return router;
}

/** Save the remote node as a local peer and perform key exchange. */
async function completeJoin(
    targetUrl: string,
    targetNodeId: string,
    config: AimeatConfig,
    storage: Storage,
    peers?: Map<string, PeerInfo>,
): Promise<void> {
    const now = new Date().toISOString();
    const newPeer: PeerInfo = {
        nodeId: targetNodeId,
        url: targetUrl,
        publicKey: '',
        status: 'active',
        addedAt: now,
        lastSeen: now,
        shareCatalogue: true,
        replicateMemory: true,
        allowRouting: true,
        peerMode: 'federation',
        allowFederatedAuth: false,
        federationAuthScopes: [],
    };

    if (peers) peers.set(targetNodeId, newPeer);
    await storage.saveFederationPeer(newPeer);

    const result = await performKeyExchange(targetUrl, config, storage);
    if (result.success && result.peerPublicKey) {
        newPeer.publicKey = result.peerPublicKey;
        await storage.saveFederationPeer(newPeer);
        logger.info(`Join complete: peer ${targetNodeId} added and keys exchanged`);
    } else if (result.success) {
        logger.info(`Join complete: peer ${targetNodeId} added (no public key received)`);
    } else {
        logger.warn(`Join: peer ${targetNodeId} saved but key exchange failed: ${result.error}`);
    }
    emitChange('federation');
}

/** Background poll for remote approval, then complete the join. */
function pollForApprovalAndComplete(
    targetUrl: string,
    targetNodeId: string,
    requestId: string,
    config: AimeatConfig,
    storage: Storage,
    peers?: Map<string, PeerInfo>,
): void {
    const startedAt = Date.now();

    const timer = setInterval(async () => {
        if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
            clearInterval(timer);
            logger.warn(`Join poll for ${targetNodeId} timed out after ${MAX_POLL_DURATION_MS / 60_000}min`);
            return;
        }
        try {
            const resp = await fetch(
                `${targetUrl}/v1/federation/peer/introduce/${requestId}/status`,
                { signal: AbortSignal.timeout(10_000) },
            );
            if (!resp.ok) return;
            const body = await resp.json() as { data?: { status: string } };
            const status = body.data?.status;

            if (status === 'approved' || status === 'auto_approved') {
                clearInterval(timer);
                logger.info(`Join request ${requestId} approved by ${targetNodeId}`);
                await completeJoin(targetUrl, targetNodeId, config, storage, peers);
            } else if (status === 'rejected') {
                clearInterval(timer);
                logger.info(`Join request ${requestId} rejected by ${targetNodeId}`);
                await storage.updatePeeringRequest(requestId, { status: 'rejected' });
                emitChange('federation');
            }
        } catch (err) {
            // Network error during poll -- keep trying
          logger.warn('pollForApprovalAndComplete: continuing after a suppressed failure', { error: String(err) });
        }
    }, POLL_INTERVAL_MS);
}
