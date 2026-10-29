/**
 * @file src/routes/federation-sync/routing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Cross-node query routing — multi-hop relay with signed route manifest + routing-fee debit,
 *   GAII→node resolution, and cross-node work submission. Extracted from federation-sync.ts to satisfy max-file-lines.
 * @version-history
 *   2026-10-29 — GET /v1/federation/resolve/:gaii asks no peer for an identity that names this node or
 *     a peer this node knows but does not list (404), and asks at most federation.resolve_max_peers
 *     peers (default 500, 0 no limit) for an identity that names no known node (secaudit2026oct26
 *     round 8c, federation-03).
 *   2026-10-27 — GET /v1/federation/resolve/:gaii remembers an identity no listed peer knew for 30
 *     seconds (at most 5000 identities), and lookups of one identity at the same moment share one
 *     round of questions, so an unknown identity repeated does not ask every peer each time
 *     (secaudit2026oct26, resolve-gaii:peer-fan-out).
 *   2026-10-22 — POST /v1/federation/route refuses a path that does not start with a single "/" or that
 *     would leave the peer's origin (400 INVALID_PATH, before the fee and the fetch); joined as strings,
 *     a path starting with '.' or ':' sent the signed relay to another host or port (secaudit2026oct22).
 *   2026-10-16 — A refusal from the far node answers HTTP 502 PEER_REFUSED (PEER_REFUSED_STATUS) on both forwarding routes; the far node's status is only in details.peer_status, so its 401 cannot read as the caller's own session ending (decision 2026-10-16).
 *   2026-10-16 — GET /v1/federation/resolve/:gaii names and asks only the peers the public directory
 *     lists; a private peer's address is not given out (QA audit S6-09).
 *   2026-10-15 — POST /v1/federation/route and POST /v1/federation/cross-node/work answer a refusal from the far node with an error envelope (PEER_REFUSED, its status, its answer in details) instead of ok: true (peerRefusal).
 *   v1.8.0 — 2026-10-12 — requireRestScope (auth/rest-scope-gate.ts): work:request on POST /v1/federation/cross-node/work. Allowed with the Deprecation headers before 4.0.0, refused from it (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 *   v1.7.0 — 2026-10-05 — Requests to peer nodes go through peerFetch (utils/peer-fetch.ts): no redirect, a time limit, and the answer read under a ceiling (secaudit 2026-10, C6).
 *   v1.6.0 — 2026-10-05 — POST /v1/federation/cross-node/work goes only to a peer with routing on
 *     (gatePeer 'allowRouting'); a packages-only or contact peer is refused (secaudit 2026-10, PKG-8).
 *   v1.5.0 — 2026-09-26 — The routing fee is routingFee (services/morsel.ts) on both endpoints, taken
 *     where the route begins as its first call goes out, after the address check. A balance that
 *     cannot cover it stops the route with 402 INSUFFICIENT_MORSELS before anything is sent. It goes
 *     back when the target or peer cannot be reached or responds with an error, and when no relay
 *     completes a multi-hop route (secaudit 2026-09, R4 6).
 *   v1.4.1 — 2026-09-26 — POST /v1/federation/route names the person who starts a route by the
 *     resolved identity (resolveIdentity): in the relay claim to the target, in the claim to a
 *     relaying peer and on the routing fee (secaudit 2026-09, R3 9).
 *   v1.4.0 — 2026-09-26 — POST /v1/federation/cross-node/work names the requester by the resolved
 *     identity (resolveIdentity): in the signed payload, in the relay claim and on the routing fee.
 *   v1.3.0 — 2026-09-17 — A multi-hop hop authenticates with its verified relay claim, since v1.2.0
 *     left it no token to show and every multi-hop route answered "no route". The routing fee is
 *     charged only on the node where the route began.
 *   v1.2.0 — 2026-09-16 — The multi-hop relay no longer forwards the caller's Authorization header to
 *     the peers it tries. The token is valid only on this node, so any relaying peer could replay it.
 *   v1.1.0 — 2026-09-03 — Every outbound relay carries a SIGNED relay claim (services/relay-claim.ts)
 *     so the receiving node can refuse a relay it does not want. Until now `allowRouting` was read
 *     only here, on the sender: Stage B measured that demoting peer B on node A did not stop B
 *     relaying into A. Both directions are enforced now and neither replaced the other — the check
 *     below still decides what THIS node relays outward.
 *   v1.0.0 — 2026-07-13 — Extracted from federation-sync.ts (max-file-lines)
 */

import type { Router, RequestHandler } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole, requireOwnerPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import type { PeerInfo } from '../../services/federation.js';
import { sign } from '../../auth/keypair.js';
import { validateOutboundUrl } from '../../utils/url-validator.js';
import { peerFetch } from '../../utils/peer-fetch.js';
import type { RouteHop, RouteManifest } from '../../types/route-manifest.js';
import { buildHopSigningMessage } from '../../types/route-manifest.js';
import { emitChange } from '../../services/event-bus.js';
import { buildRelayClaim } from '../../services/relay-claim.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { routingFee } from '../../services/morsel.js';
import { gatePeer } from '../../services/federation-peer-gate.js';
import { requireRestScope } from '../../auth/rest-scope-gate.js';

/**
 * The HTTP status of every PEER_REFUSED answer. A gateway error, never the far node's own status: a
 * client that signs its user out on any 401 read the far node's refusal as the end of its own
 * session (decision 2026-10-16). The far node's status travels in `details.peer_status`.
 */
const PEER_REFUSED_STATUS = 502;

/**
 * The answer when the far node refused what this node forwarded: an error envelope with status 502,
 * and the far node's status and answer in `details`. Both forwarding routes answered the far node's
 * 401 or 500 inside a success envelope, `ok: true` beside an error status, so a caller reading `ok`
 * took a refusal for a delivery.
 */
function peerRefusal(nodeId: string, target: string, status: number, data: unknown) {
  const peerError = (data && typeof data === 'object' && 'error' in data) ? (data as { error: unknown }).error : data;
  return error(nodeId, 'PEER_REFUSED',
    'The other node refused the request, so nothing was done there. Its own answer is in details; the routing fee was given back.',
    PEER_REFUSED_STATUS, { routed_to: target, peer_status: status, peer_error: peerError ?? null });
}

/**
 * Who may drive POST /v1/federation/route: this node's own account holder, or a peer relaying a hop.
 *
 * THE TWO CALLERS ARE DIFFERENT KINDS. The first hop is a person on THIS node starting a route; they
 * hold a credential of this node, and the A23 rule stands for them unchanged (an owner principal, so a
 * scope-limited app grant cannot drive an outbound call in this node's name). Every later hop is a
 * PEER forwarding on somebody else's behalf, and that caller can hold no credential of this node at
 * all: the token it used to forward was minted by another node, meaningless here and replayable
 * there, which is why adf8aa1e5 stopped sending it. Asking that hop for a token therefore refused
 * every multi-hop relay, and B->A->C answered "no route" from 2026-09-16.
 *
 * A HOP AUTHENTICATES WITH WHAT IT CAN PROVE. middleware/relay-gate.ts has already verified the signed
 * relay claim before any route runs: an active peer this node lets route, written for this node,
 * bound to POST and this exact path, inside a short window, signed with the key pinned for that peer,
 * and spent so it cannot be replayed. What it proved is on `req.relay`, and a claim for any other
 * path never gets that far. That is stronger than the bearer token it replaces, which named none of
 * those things. A request with no verified claim takes the ordinary road and meets the owner check.
 *
 * WHY IT DID NOT MATTER IN THE TEST UNTIL NOW. federation-multinode boots all three nodes in one
 * process, where the node signing keys are module state, so a token minted by B verified at A. On two
 * machines it would not have: multi-hop leaned on a forwarded token that only a shared process could
 * accept.
 */
function requireOwnerPrincipalOrVerifiedRelay(): RequestHandler {
    const auth = requireAuth();
    const owner = requireOwnerPrincipal();
    return (req, res, next) => {
        if (req.relay) { next(); return; }
        auth(req, res, (err?: unknown) => {
            if (err) { next(err); return; }
            owner(req, res, next);
        });
    };
}

/** How long an identity no listed peer knew is answered 404 without asking the peers again. */
const RESOLVE_MISS_TTL_MS = 30_000;
/** The most unknown identities remembered at once; the oldest goes first past it. */
const RESOLVE_MISS_MAX = 5_000;

export function registerRoutingRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    // Per node (a test process can run two): the identities no peer knew, with when that stops
    // being the answer, and the rounds of questions under way per identity.
    const resolveMisses = new Map<string, number>();
    const resolveRounds = new Map<string, Promise<PeerInfo | null>>();

    // ── Cross-Node Query Routing ──

    // POST /v1/federation/route — Forward a request to a peer node (multi-hop relay).
    //
    // A23 (E2E test-quality audit). This is an OUTBOUND call made in this node's name, charged to
    // this node's relationship with its peers, and it carried requireAuth() alone — so any principal
    // that could authenticate at all could drive the relay, including a scope-limited app grant.
    // requireOwnerPrincipal is the narrow answer and it costs nothing measurable: greps across
    // public/ (the SPA), src/mcp/ (no tool reaches it), src/static/sdk-libs/ and python/aimeat-crewai
    // find ZERO callers, and federation-multinode drives it with an owner token. The wider answer —
    // a `federation:relay` word an agent could hold — is available the day someone wants an agent to
    // relay; it is not invented here for a caller that does not exist.
    //
    // A hop from a peer is admitted on its verified relay claim instead; see
    // requireOwnerPrincipalOrVerifiedRelay() above.
    router.post('/v1/federation/route', requireOwnerPrincipalOrVerifiedRelay(), async (req, res) => {
        const { target_node, method, path, body: reqBody, max_hops } = req.body ?? {};

        if (!target_node || !path) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_node and path are required'));
            return;
        }
        // The path is a path on the peer, never a part of its address: the request goes to the peer's
        // stored origin and nowhere else. Joined as strings, a path starting with '.' or ':' moved it
        // to another host or port, this node's signed relay claim included (secaudit2026oct22).
        // Refused before any fee or fetch.
        if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
            res.status(400).json(error(config.nodeId, 'INVALID_PATH', 'path must be an absolute path on the peer, starting with a single "/" (for example /v1/health)'));
            return;
        }

        // Honour inbound X-Relay-Hops header from upstream relay, otherwise use body or config default
        const inboundHops = req.headers['x-relay-hops'] ? parseInt(req.headers['x-relay-hops'] as string, 10) : null;
        const hops = inboundHops ?? max_hops ?? config.maxRelayHops;
        if (hops <= 0) {
            res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Max relay hops exceeded'));
            return;
        }

        // Build relay path from inbound header
        const inboundPath = req.headers['x-relay-path'] as string | undefined;
        const relayPath = inboundPath ? `${inboundPath},${config.nodeId}` : config.nodeId;

        // Prevent routing loops — reject if we already appear in the path
        const pathNodes = relayPath.split(',');
        if (pathNodes.filter(n => n === config.nodeId).length > 1) {
            res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Routing loop detected'));
            return;
        }

        // On a hop, the principal is the one the previous node signed into the claim: the person who
        // started the route, on their own node. Nothing here can re-check that name, and nothing
        // here needs to; it is carried forward into the next claim so the far end sees who asked.
        // Where the route starts, the person is named by their full identity (resolveIdentity, their
        // GHII): a bare account name means nobody on the next node, or that node's own namesake. The
        // routing fee below is taken from the same identity.
        const requesterGaii = req.relay ? req.relay.caller : resolveIdentity(req.auth!, config.nodeId);

        // The 1-morsel routing fee (routingFee, services/morsel.ts), ONLY on the node where the route
        // began.
        //
        // A morsel paces a person, and the person who asked has their balance on the node they asked
        // from, which charges them once there. A hop holds no account for a name from another node,
        // so a debit there has nothing to take from. Charging the relaying node's own operator
        // instead would make a node pay for carrying other people's traffic, which is the opposite
        // of what allowRouting lets an operator choose. Ruled 2026-09-17 with the relay-claim
        // authentication.
        //
        // The fee is taken as the first call of the route goes out, after the checks that can refuse
        // it, and a balance that cannot cover it stops the route before anything is sent. It goes
        // back when no route is made: the target cannot be reached, or it answers with an error.
        const fee = routingFee(storage, req.relay ? null : requesterGaii, {
            type: 'federation_routing', trackingCode: `relay:${relayPath}`,
        });
        const refuseForFee = () => res.status(402).json(error(config.nodeId, 'INSUFFICIENT_MORSELS',
            'Insufficient morsels for the routing fee (1 morsel)'));

        // F.2: Build route hop for this relay node
        async function buildLocalHop(forwardedTo: string | null, prevSignature: string): Promise<RouteHop> {
            const receivedAt = new Date().toISOString();
            const signingMessage = buildHopSigningMessage(config.nodeId, receivedAt, forwardedTo, prevSignature);
            const nodeKey = await storage.getNodeKey();
            const hopSignature = nodeKey?.privateKey
                ? await sign(nodeKey.privateKey, signingMessage)
                : '';
            return {
                node_id: config.nodeId,
                received_at: receivedAt,
                forwarded_to: forwardedTo,
                signature: hopSignature,
            };
        }

        // Parse incoming route manifest from headers or body
        const inboundManifest: RouteManifest = req.body?.route_manifest ?? {
            origin: req.headers['x-forwarded-from'] as string ?? config.nodeId,
            hops: [],
        };

        // 1. Check if target is a direct peer
        const targetPeer = [...peers.values()].find(p => p.nodeId === target_node && p.status === 'active');

        if (targetPeer && !targetPeer.allowRouting) {
            res.status(403).json(error(config.nodeId, 'POLICY_DENIED', 'Routing is disabled for this peer'));
            return;
        }

        if (targetPeer) {
            try {
                const targetUrl = `${targetPeer.url}${path}`;
                const peerOrigin = URL.parse(targetPeer.url)?.origin;
                if (!peerOrigin) {
                    res.status(400).json(error(config.nodeId, 'INVALID_URL', `The stored address of peer ${target_node} is not a valid URL`));
                    return;
                }
                if (URL.parse(targetUrl)?.origin !== peerOrigin) {
                    res.status(400).json(error(config.nodeId, 'INVALID_PATH', 'path must stay on the peer\'s own address'));
                    return;
                }
                // SSRF validation: block requests to private/reserved IPs
                const targetUrlCheck = await validateOutboundUrl(targetUrl);
                if (!targetUrlCheck.valid) {
                    res.status(400).json(error(config.nodeId, 'INVALID_URL', targetUrlCheck.reason ?? 'URL validation failed'));
                    return;
                }
                if (!(await fee.take())) { refuseForFee(); return; }
                // The receiving node decides whether it accepts a relay from US, and it needs proof
                // rather than the header below — anyone can type that one. One claim per forwarded
                // request, bound to this method and this path, single-use at the far end.
                const claim = await buildRelayClaim(storage, config, {
                    audience: target_node, method: method ?? 'GET', path, caller: requesterGaii,
                });
                const response = await peerFetch(targetUrl, {
                    method: method ?? 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Forwarded-From': config.nodeId,
                        'X-Relay-Hops': String(hops - 1),
                        'X-Relay-Path': relayPath,
                        ...(claim ?? {}),
                    },
                    ...(reqBody && ['POST', 'PUT', 'PATCH'].includes((method ?? 'GET').toUpperCase())
                        ? { body: JSON.stringify(reqBody) }
                        : {}),
                }, { timeoutMs: 30_000 });
                if (!response.ok) {
                    // Unreachable, a redirect, a timeout or an answer over the ceiling: the route failed, so the fee goes back.
                    await fee.giveBack();
                    res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR',
                        `Failed to reach peer ${target_node}: ${response.message}`));
                    return;
                }

                const data = response.json ?? null;
                // An error answer is no route made, so the fee goes back and the answer is an error.
                if (response.status < 200 || response.status >= 300) {
                    await fee.giveBack();
                    res.status(PEER_REFUSED_STATUS).json(peerRefusal(config.nodeId, target_node, response.status, data));
                    return;
                }

                // F.2: Add hop signing for direct peer routing
                const hop = await buildLocalHop(target_node, inboundManifest.hops.length > 0 ? inboundManifest.hops[inboundManifest.hops.length - 1].signature : '');
                inboundManifest.hops.push(hop);

                res.status(response.status).json(success(config.nodeId, {
                    routed_to: target_node,
                    routed_via: config.nodeId,
                    relay_path: relayPath.split(','),
                    hops_remaining: hops - 1,
                    response_status: response.status,
                    response_data: data,
                    route_manifest: inboundManifest,
                }));
                emitChange('federation');
            } catch (err) {
                // The route failed, so the fee goes back.
                await fee.giveBack();
                res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR',
                    `Failed to reach peer ${target_node}: ${err instanceof Error ? err.message : 'unknown error'}`));
            }
            return;
        }

        // 2. Not a direct peer — try multi-hop relay through active peers
        const activePeers = [...peers.values()].filter(p =>
            p.status === 'active' && p.allowRouting && !pathNodes.includes(p.nodeId));
        if (activePeers.length === 0) {
            res.status(404).json(error(config.nodeId, 'FEDERATION_ERROR', `No route to node ${target_node}`));
            return;
        }

        for (const relay of activePeers) {
            try {
                const relayUrl = `${relay.url}/v1/federation/route`;
                // SSRF validation: block requests to private/reserved IPs
                const relayUrlCheck = await validateOutboundUrl(relayUrl);
                if (!relayUrlCheck.valid) {
                    logger.warn(`Blocked outbound relay to peer ${relay.nodeId}: ${relayUrlCheck.reason}`);
                    continue;
                }
                // Taken once, as the first call of this route goes out; the relays tried after it
                // share the same fee.
                if (!(await fee.take())) { refuseForFee(); return; }
                // ONE HOP, ONE CLAIM: this one is written for the NEXT node and covers the call we
                // are actually making to it, which is a POST to its own /v1/federation/route. The
                // node after that gets its own claim from that node. A receiver only ever decides
                // about its own peer, which is the only party it has a pinned key for.
                const hopClaim = await buildRelayClaim(storage, config, {
                    audience: relay.nodeId, method: 'POST', path: '/v1/federation/route', caller: requesterGaii,
                });
                const response = await peerFetch(relayUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        // NO Authorization. The caller's token was forwarded here, to every peer
                        // this loop tries. A token is signed with this node's key and means nothing
                        // on the peer; it means everything back on this node, so any relaying peer
                        // could replay it against us until it expired. The signed claim below is
                        // what tells the peer who sent the relay, as on the direct branch above.
                        'X-Forwarded-From': config.nodeId,
                        'X-Relay-Hops': String(hops - 1),
                        'X-Relay-Path': relayPath,
                        ...(hopClaim ?? {}),
                    },
                    body: JSON.stringify({
                        target_node,
                        method: method ?? 'GET',
                        path,
                        body: reqBody,
                        max_hops: hops - 1,
                    }),
                }, { timeoutMs: 30_000 });
                if (!response.ok) {
                    // This relay was not reached: try the next one.
                    logger.warn('POST /v1/federation/route: relay peer not reached', { peer: relay.nodeId, reason: response.reason });
                    continue;
                }

                if (response.status >= 200 && response.status < 300) {
                    const data = response.json ?? null;

                    // F.2: Add hop signing for multi-hop relay routing
                    const relayHop = await buildLocalHop(relay.nodeId, inboundManifest.hops.length > 0 ? inboundManifest.hops[inboundManifest.hops.length - 1].signature : '');
                    inboundManifest.hops.push(relayHop);

                    res.json(success(config.nodeId, {
                        routed_to: target_node,
                        routed_via: relay.nodeId,
                        relay_path: relayPath.split(',').concat(relay.nodeId),
                        hops_remaining: hops - 1,
                        response_data: data,
                        route_manifest: inboundManifest,
                    }));
                    emitChange('federation');
                    return;
                }
            } catch (err) {
                // Try next relay
              logger.warn('buildLocalHop: continuing after a suppressed failure', { error: String(err) });
            }
        }

        // No relay made the route, so the fee goes back.
        await fee.giveBack();
        res.status(404).json(error(config.nodeId, 'FEDERATION_ERROR',
            `No route to node ${target_node} via any active peer`));
    });

    // GET /v1/federation/resolve/:gaii — Resolve which node hosts a GAII
    router.get('/v1/federation/resolve/:gaii', async (req, res) => {
        const gaii = req.params.gaii as string;

        // Check if agent is local
        const localAgent = await storage.getAgent(gaii);
        if (localAgent) {
            res.json(success(config.nodeId, {
                gaii,
                node_id: config.nodeId,
                local: true,
            }));
            return;
        }

        // This route answers anyone, so it names only the peers the public directory names: a private
        // peer (a contact link) is nobody's to learn about, and its address was handed to whoever
        // guessed its node id (QA audit S6-09).
        const listedPeers = [...peers.values()].filter(p => p.status === 'active' && p.peerMode !== 'private');

        // Parse GAII to extract node hint (agent#owner@node)
        const atIdx = gaii.lastIndexOf('@');
        if (atIdx !== -1) {
            const nodeHint = gaii.substring(atIdx + 1);
            const peer = listedPeers.find(p => p.nodeId === nodeHint);
            if (peer) {
                res.json(success(config.nodeId, {
                    gaii,
                    node_id: nodeHint,
                    node_url: peer.url,
                    local: false,
                }));
                return;
            }
            // The identity names its home node, and this node knows that node: itself, or a peer the
            // directory does not list (private, or not active). No other peer is its home, so none is
            // asked, and an unlisted peer's address is not given out (secaudit2026oct26 round 8c).
            if (nodeHint === config.nodeId || peers.has(nodeHint)) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND',
                    `Agent ${gaii} not found on this node or any active peer`));
                return;
            }
        }

        // Ask peers (broadcast resolve). An identity no peer knew is answered from memory for a short
        // while, and lookups of one identity at the same moment share one round, so repeating an
        // unknown identity does not send one request to every listed peer each time
        // (secaudit2026oct26, resolve-gaii:peer-fan-out).
        const missUntil = resolveMisses.get(gaii);
        if (missUntil !== undefined && missUntil > Date.now()) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND',
                `Agent ${gaii} not found on this node or any active peer`));
            return;
        }
        let round = resolveRounds.get(gaii);
        if (!round) {
            round = askPeers(gaii, listedPeers).finally(() => { resolveRounds.delete(gaii); });
            resolveRounds.set(gaii, round);
        }
        const found = await round;
        if (found) {
            res.json(success(config.nodeId, {
                gaii,
                node_id: found.nodeId,
                node_url: found.url,
                local: false,
            }));
            return;
        }
        rememberMiss(gaii);

        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
            `Agent ${gaii} not found on this node or any active peer`));
    });

    /**
     * Ask each listed peer in turn whether it hosts `gaii`; the first that does, or null. At most
     * federation.resolve_max_peers peers are asked (0 is no limit), in the order this node holds them.
     */
    async function askPeers(gaii: string, listedPeers: PeerInfo[]): Promise<PeerInfo | null> {
        const most = config.federationResolveMaxPeers;
        let asked = 0;
        for (const peer of listedPeers) {
            if (most > 0 && asked >= most) {
                logger.info(`GET /v1/federation/resolve/:gaii asked ${asked} peers, the most federation.resolve_max_peers allows`, { gaii, listed: listedPeers.length });
                break;
            }
            try {
                // SSRF validation: block requests to private/reserved IPs
                const peerResolveCheck = await validateOutboundUrl(peer.url);
                if (!peerResolveCheck.valid) {
                    logger.warn(`Blocked outbound resolve to peer ${peer.nodeId}: ${peerResolveCheck.reason}`);
                    continue;
                }
                asked++;
                const resp = await peerFetch(`${peer.url}/v1/agents/${encodeURIComponent(gaii)}`, {}, { timeoutMs: 5_000 });
                if (resp.ok && resp.status >= 200 && resp.status < 300) return peer;
            } catch (err) {
                // Continue to next peer
              logger.warn('GET /v1/federation/resolve/:gaii: continuing after a suppressed failure', { error: String(err) });
            }
        }
        return null;
    }

    /** Remember that no listed peer knows `gaii`, dropping the oldest entry past the bound. */
    function rememberMiss(gaii: string): void {
        resolveMisses.delete(gaii);
        resolveMisses.set(gaii, Date.now() + RESOLVE_MISS_TTL_MS);
        while (resolveMisses.size > RESOLVE_MISS_MAX) {
            const oldest = resolveMisses.keys().next().value;
            if (oldest === undefined) break;
            resolveMisses.delete(oldest);
        }
    }

    // POST /v1/federation/cross-node/work — Submit cross-node work request
    router.post('/v1/federation/cross-node/work', requireAuth(), requireRestScope('work:request'), requireRole('agent'), async (req, res) => {
        const { target_node, action_id, provider_gaii, input, ttl_hours } = req.body ?? {};

        if (!target_node || !action_id || !provider_gaii || input === undefined) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'target_node, action_id, provider_gaii, and input are required'));
            return;
        }

        const peer = [...peers.values()].find(p => p.nodeId === target_node && p.status === 'active');
        if (!peer) {
            res.status(404).json(error(config.nodeId, 'FEDERATION_ERROR',
                `No active peer for node ${target_node}`));
            return;
        }
        // Work goes only to a peer this node routes to: a packages-only or contact peer has routing
        // off, and any package author could add the former (secaudit 2026-10, PKG-8).
        const gate = gatePeer(peers, target_node, 'allowRouting');
        if (!gate.ok) { res.status(gate.status).json(error(config.nodeId, gate.code, gate.message)); return; }

        // Who asked, by the full identity: a person's GHII, an agent's GAII. The peer reads it as the
        // requester, and a bare account name names nobody there, or that node's namesake. The routing
        // fee is taken from the same identity: as the call goes out, and back again when the peer
        // cannot be reached or answers with an error (routingFee, services/morsel.ts).
        const requester = resolveIdentity(req.auth!, config.nodeId);
        const fee = routingFee(storage, requester, { type: 'federation_routing' });

        try {
            // SSRF validation: block requests to private/reserved IPs
            const crossNodeUrlCheck = await validateOutboundUrl(peer.url);
            if (!crossNodeUrlCheck.valid) {
                res.status(400).json(error(config.nodeId, 'INVALID_URL', crossNodeUrlCheck.reason ?? 'URL validation failed'));
                return;
            }
            if (!(await fee.take())) {
                res.status(402).json(error(config.nodeId, 'INSUFFICIENT_MORSELS', 'Insufficient morsels for the routing fee (1 morsel)'));
                return;
            }

            // P1-11: Sign outbound cross-node work request
            const workPayload = {
                action_id,
                provider_gaii,
                input,
                ttl_hours: ttl_hours ?? 24,
                cross_node_requester: requester,
                origin_node: config.nodeId,
                timestamp: new Date().toISOString(),
            };
            const nodeKey = await storage.getNodeKey();
            let workSignature: string | undefined;
            if (nodeKey?.privateKey) {
                workSignature = await sign(nodeKey.privateKey, JSON.stringify(workPayload));
            }

            // This call carries X-Forwarded-From, so to the receiving node it IS a relay and its
            // gate will ask for a claim. Signed here for the same reason and in the same shape.
            const workClaim = await buildRelayClaim(storage, config, {
                audience: target_node, method: 'POST', path: '/v1/work/request', caller: requester,
            });
            const response = await peerFetch(`${peer.url}/v1/work/request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Forwarded-From': config.nodeId,
                    'X-Requester-Node': config.nodeId,
                    ...(workClaim ?? {}),
                },
                body: JSON.stringify({
                    ...workPayload,
                    signature: workSignature,
                }),
            }, { timeoutMs: 30_000 });
            if (!response.ok) {
                // The call failed, so the fee goes back.
                await fee.giveBack();
                res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR',
                    `Failed to submit cross-node work: ${response.message}`));
                return;
            }

            const data = response.json ?? null;
            // An error answer is no route made, so the fee goes back and the answer is an error.
            if (response.status < 200 || response.status >= 300) {
                await fee.giveBack();
                res.status(PEER_REFUSED_STATUS).json(peerRefusal(config.nodeId, target_node, response.status, data));
                return;
            }

            res.status(response.status).json(success(config.nodeId, {
                routed_to: target_node,
                response_data: data,
            }));
            emitChange('federation');
        } catch (err) {
            // The call failed, so the fee goes back.
            await fee.giveBack();
            res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR',
                `Failed to submit cross-node work: ${err instanceof Error ? err.message : 'unknown error'}`));
        }
    });
}
