/**
 * @file src/services/work/create-work-item.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Commissioning one work item, whichever surface the request arrived on: the work queue
 *   routes (routes/work.ts) and aimeat_action_execute (mcp/core.ts) both call createWorkItem, and the
 *   MCP tool renders a refusal with workErrorText. Moved out of routes/work.ts unchanged, so an MCP
 *   tool no longer imports a route file (CLAUDE.md, Backend; dependency-cruiser rule
 *   mcp-does-not-import-routes). The history of both functions is in routes/work.ts's header.
 * @structure workErrorText · createWorkItem
 * @usage const result = await createWorkItem(config, storage, requesterGaii, body, peers, notificationService);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved out of routes/work.ts unchanged (structure programme unit 2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { MailboxNotificationService } from '../mailbox-notification.js';
import { refuseWorkBetween } from '../work-parties.js';
import { isIdentityShaped } from '../local-identity.js';
import { generateTrackingCode } from '../../utils/tracking-code.js';
import { calculateWorkCost, holdEscrow, routingFee } from '../morsel.js';
import { logger } from '../../utils/logger.js';
import { executeHooks } from '../hooks.js';
import { resolveGaii } from '../federation.js';
import type { PeerInfo } from '../federation.js';
import { safeFetch, validateOutboundUrl } from '../../utils/url-validator.js';
import { readJson, OUTBOUND_READ_MAX_BYTES } from '../../utils/read-capped.js';

/**
 * The text an MCP tool shows for a createWorkItem refusal: `CODE: message`. For PEER_REFUSED it
 * also names the other node, the status it answered and its own answer, because the MCP result has
 * no `details` field and "its answer is in details" pointed at nothing (decision 2026-10-16).
 */
export function workErrorText(result: { code?: string; error?: string; details?: unknown }): string {
  const base = `${result.code}: ${result.error}`;
  if (result.code !== 'PEER_REFUSED' || !result.details || typeof result.details !== 'object') return base;
  const d = result.details as { routed_to?: unknown; peer_status?: unknown; peer_error?: unknown };
  const pe = d.peer_error;
  const answer = pe && typeof pe === 'object'
    ? [(pe as { code?: unknown }).code, (pe as { message?: unknown }).message].filter(v => typeof v === 'string' && v).join(': ')
    : (typeof pe === 'string' ? pe : '');
  return `${base} The other node (${String(d.routed_to ?? 'unknown')}) refused it with HTTP ${String(d.peer_status ?? '?')}`
    + (answer ? ` and answered: ${answer.slice(0, 500)}` : ' and gave no readable answer') + '.';
}

/**
 * Commission one work item, from wherever the request arrived.
 *
 * Exported since 2026-08-11 because aimeat_action_execute was a second implementation of it, and a
 * thinner one: it never resolved the provider, so cross-node work commissioned over MCP created a
 * local row and held the requester's morsels in escrow while the provider's node heard nothing; it
 * skipped the visiting-tier peer policy that makes the lightweight join safe; and it skipped the
 * pending-queue ceiling, so one agent could flood another's inbox past a cap this door enforces.
 *
 * Returns a refusal as { error, status, code } — the caller renders it in its own terms.
 */
export async function createWorkItem(
  config: AimeatConfig,
  storage: Storage,
  requesterGaii: string,
  body: {
    action_id?: string;
    provider_gaii?: string;
    input?: unknown;
    ttl_hours?: number;
    callback_url?: string;
    priority?: 'low' | 'normal' | 'high';
  },
  peers: Map<string, PeerInfo>,
  notificationService?: MailboxNotificationService | null,
) {
  const { action_id, provider_gaii, input, ttl_hours, callback_url, priority } = body;

  if (!action_id || !provider_gaii || input === undefined) {
    return { error: 'action_id, provider_gaii, and input are required', status: 400, code: 'INVALID_INPUT' };
  }

  // The provider is named by its full identity: a person's GHII, an agent's GAII or an ecosystem app's
  // GEAI. A bare account name identifies no principal, so no caller could accept the work, and the
  // requester's escrow would wait for the TTL. The shape test is the one the address book and direct
  // messages use (services/local-identity.ts).
  if (!isIdentityShaped(provider_gaii)) {
    return {
      error: 'provider_gaii must be a full identity: a person\'s GHII (name@node), an agent\'s GAII (agent#name@node) or an ecosystem app\'s GEAI (eco:app#name@node)',
      status: 400,
      code: 'INVALID_INPUT',
    };
  }

  // SECURITY: no work with yourself (trust score manipulation), and none between two principals of
  // one owner: a person and their own agent, either way round, or two agents of one person. Every
  // work queue endpoint and MCP tool creates work here, and EXCHANGE agent work calls the same
  // function (services/work-parties.ts), so the rule has one home.
  const refused = refuseWorkBetween(requesterGaii, provider_gaii);
  if (refused) {
    return { error: refused.message, status: 400, code: refused.code };
  }

  // Extension hook: pre_work_request
  const hookResult = await executeHooks(config, storage, 'pre_work_request', {
    requester_gaii: requesterGaii, action_id, provider_gaii,
  });
  if (!hookResult.allowed) {
    return { error: hookResult.reason ?? 'Work request denied by extension hook', status: 403, code: 'HOOK_REJECTED' };
  }

  // Resolve provider location — local or remote?
  const resolved = await resolveGaii(provider_gaii, config, storage, peers);

  // Check if the resolved GAII is on a personal node anchored to this operator
  let personalNodeTarget: string | null = null;
  if (resolved && !resolved.local && resolved.nodeUrl === config.baseUrl) {
    // This is a personal node agent — treat as local work, notify via tunnel/mailbox later
    personalNodeTarget = resolved.nodeId;
  } else if (resolved && !resolved.local) {
    // Visiting-tier peers are not providers-of-record: never route work to them
    // (allowRouting=false). This is the cap that makes the lightweight join safe.
    const targetPeer = peers.get(resolved.nodeId) ?? [...peers.values()].find(p => p.nodeId === resolved.nodeId);
    if (targetPeer && targetPeer.allowRouting === false) {
      return { error: 'Target node does not accept routed work (visiting tier)', status: 403, code: 'POLICY_DENIED' };
    }
    // SSRF validation: block requests to private/reserved IPs. Checked before the routing fee is
    // taken, so a refused address costs nothing.
    const remoteUrlCheck = await validateOutboundUrl(resolved.nodeUrl);
    if (!remoteUrlCheck.valid) {
      logger.warn(`Blocked outbound work request to ${resolved.nodeUrl}: ${remoteUrlCheck.reason}`);
      return { error: `Remote node URL blocked: ${remoteUrlCheck.reason}`, status: 400, code: 'INVALID_URL' };
    }

    // The 1-morsel cross-node routing fee (§15), taken as the call goes out. It goes back when no
    // route is made: the node cannot be reached, or it answers with an error (services/morsel.ts).
    const fee = routingFee(storage, requesterGaii, { type: 'routing_fee', trackingCode: `route:${resolved.nodeId}` });
    if (!(await fee.take())) {
      return { error: 'Insufficient morsels for cross-node routing fee (1 morsel)', status: 402, code: 'INSUFFICIENT_MORSELS' };
    }

    // Forward work request to the remote node
    let resp: Response;
    let remoteResult: Record<string, unknown>;
    try {
      // safeFetch, not fetch, even though the URL was just validated: the check above reads the
      // FIRST hop only, and a host that passes it can answer 302 to loopback or to a metadata
      // address. safeFetch re-runs the same validation on every hop and throws `Fetch blocked: …`,
      // which the catch below turns into the same REMOTE_UNREACHABLE the network errors give. The
      // pre-check stays because it is what produces the specific 400 a caller can act on.
      resp = await safeFetch(`${resolved.nodeUrl}/v1/work/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AIMEAT-Origin-Node': config.nodeId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      remoteResult = await readJson(resp, OUTBOUND_READ_MAX_BYTES) as Record<string, unknown>;
    } catch (err) {
      await fee.giveBack();
      logger.warn('Failed to forward work request to remote node', { nodeUrl: resolved.nodeUrl, error: String(err) });
      return { error: `Remote node ${resolved.nodeId} unreachable`, status: 502, code: 'REMOTE_UNREACHABLE' };
    }
    if (!resp.ok) {
      // REFUSED BY THE FAR NODE, SAID AS SUCH (QA audit F14b-01, F18-01). A node takes forwarded work
      // only from a signed-in caller of its own, which a forwarding node is not, so today every real
      // peer refuses this request (the feature list's "Cross-node work and settlement" row says so).
      // The far node's own answer used to be passed through as this node's, and the MCP tool said
      // "routed"; nothing on either node said why. The fee goes back, nothing was held here.
      await fee.giveBack();
      const peerError = (remoteResult && typeof remoteResult === 'object' && 'error' in remoteResult) ? remoteResult.error : remoteResult;
      logger.warn('The provider node refused forwarded work', { node: resolved.nodeId, status: resp.status });
      return {
        error: 'The provider\'s node refused the work request, so nothing was created there and nothing was held here. Its own answer is in details; the routing fee was given back.',
        // 502, never the far node's own status: a client that ends its session on any 401 read the
        // far node's refusal as the end of its own (decision 2026-10-16). The far status is in details.
        status: 502, code: 'PEER_REFUSED',
        details: { routed_to: resolved.nodeId, peer_status: resp.status, peer_error: peerError ?? null },
      };
    }
    return { forwarded: true, remoteStatus: resp.status, remoteResult };
  }

  const ttl = ttl_hours ?? 24;
  const now = new Date();
  const trackingCode = generateTrackingCode();

  // Look up action to get pricing
  const actions = await storage.listActions();
  const action = actions.find(a => a.id === action_id && a.providerGaii === provider_gaii);

  // W-2: Enforce max pending work items per provider (Appendix B)
  const providerWork = await storage.listWorkByProvider(provider_gaii);
  const pendingCount = providerWork.filter(w => ['pending', 'accepted', 'in_progress'].includes(w.status)).length;
  if (pendingCount >= config.workQueueMaxPending) {
    return {
      error: `Provider ${provider_gaii} has ${pendingCount} pending work items (max ${config.workQueueMaxPending})`,
      status: 429,
      code: 'QUEUE_FULL',
    };
  }

  // The action's PACING amount, not a price (ruling decision-morseli-on-tahdistus-ei-hinta-tarjouksen-
  // kaksi-arvoa). The escrow holds it plus the network fee; acceptance releases it to the provider and
  // burns or splits the network fee per the burn rate (services/morsel.ts settlePayment).
  const tollMorsels = action?.pricing.tollMorsels ?? 0;
  // §15: priority 'high' doubles the pacing amount
  const effectiveToll = priority === 'high' ? tollMorsels * 2 : tollMorsels;
  const cost = calculateWorkCost(effectiveToll, config.burnRate);

  // Hold escrow and create the work item in ONE transaction: written apart, a failed create after
  // the debit charged the requester for work that was never stored (QA audit E6-03).
  const created = await storage.transaction(async () => {
    const held = await holdEscrow(storage, requesterGaii, provider_gaii, trackingCode, cost.total);
    if (!held) return null;
    return storage.createWork({
      trackingCode,
      status: 'pending',
      actionId: action_id,
      providerGaii: provider_gaii,
      requesterGaii,
      input: input as Record<string, unknown>,
      cost,
      callbackUrl: callback_url,
      ttlExpiresAt: new Date(now.getTime() + ttl * 3600_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });
  if (!created) {
    const requester = await storage.getAgent(requesterGaii);
    return {
      error: `You need ${cost.total} morsels but have ${requester?.morselBalance ?? 0}`,
      status: 402,
      code: 'INSUFFICIENT_MORSELS',
      details: { required: cost.total, available: requester?.morselBalance ?? 0 },
    };
  }

  const work = created;

  // If the provider is on a personal node, queue a notification
  if (personalNodeTarget) {
    const { MailboxService } = await import('../mailbox.js');
    const mailboxService = new MailboxService(config, storage);
    const enqueuedItem = await mailboxService.enqueue(personalNodeTarget, {
      personalNodeId: personalNodeTarget,
      type: 'work_assignment',
      fromGaii: requesterGaii,
      toGaii: provider_gaii,
      payload: JSON.stringify({
        event: 'work.assigned',
        tracking_code: trackingCode,
        action_id,
        input,
      }),
      sizeBytes: 0,
      retentionDays: 7,
    }).catch(err => {
      logger.warn('Failed to queue work notification for personal node', { nodeId: personalNodeTarget, error: String(err) });
      return null;
    });

    // Fire-and-forget push notification to node owner (REQ-007)
    if (enqueuedItem && notificationService) {
      void notificationService.notify(personalNodeTarget, enqueuedItem);
    }
  }

  return { work, personalNodeTarget };
}
