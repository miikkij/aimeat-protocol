/**
 * @file src/routes/owners/export.ts
 * @description GDPR data export for one owner: GET /v1/owners/:name/export. Extracted VERBATIM
 *   from src/routes/owners.ts to satisfy max-file-lines; the route body is unchanged, so what the
 *   export contains and who may call it are exactly what they were.
 *
 *   Owner-invariant reads (boards, posts, flags) stay hoisted out of the per-agent loop — that was
 *   an O(agents x boards) fix and moving the file must not undo it.
 * @structure registerOwnerExportRoute(router, config, storage)
 * @usage
 *   import { registerOwnerExportRoute } from './owners/export.js';
 *   registerOwnerExportRoute(router, config, storage);
 * @version-history
 *   v1.1.0 — 2026-08-11 — Security audit H-1/H-7: behind requireOwnerPrincipal(). One export is
 *     everything the account holds in one response, and the check below only refuses a DIFFERENT
 *     owner — every machine principal of the SAME owner passed it, because req.auth.owner is the
 *     human's account name on an agent, ecosystem and app-grant token alike.
 *   v1.0.0 — 2026-08-07 — Extracted from routes/owners.ts (max-file-lines).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOwnerPrincipal } from '../../auth/middleware.js';
import { error, success } from '../../middleware/envelope.js';
import { calculateTrustScore } from '../../services/trust.js';

/** Mount GET /v1/owners/:name/export on an existing router. */
export function registerOwnerExportRoute(router: Router, config: AimeatConfig, storage: Storage): void {
  // GET /v1/owners/:name/export — GDPR data export (account holder or operator)
  // Exports ALL data types associated with the owner for full GDPR compliance.
  router.get('/v1/owners/:name/export', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const name = req.params.name as string;
    if (req.auth!.owner !== name && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only export your own data'));
      return;
    }

    const owner = await storage.getOwner(name);
    if (!owner) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${name}`));
      return;
    }

    // ── GHII (identity) data ────────────────────────────────────────
    const ghiiRecord = await storage.getGHIIByOwner(name);
    const ghiiData = ghiiRecord ? {
      username: ghiiRecord.username,
      ghii: ghiiRecord.ghii,
      display_name: ghiiRecord.displayName,
      bio: ghiiRecord.bio,
      avatar: ghiiRecord.avatar,
      locale: ghiiRecord.locale,
      verification_level: ghiiRecord.verificationLevel,
      totp_enabled: ghiiRecord.totpEnabled,
      // NOTE: TOTP secret is intentionally excluded for security
      email_verified_at: ghiiRecord.emailVerifiedAt,
      verification_method: ghiiRecord.verificationMethod,
      magic_link_enabled: ghiiRecord.magicLinkEnabled,
      notification_email: ghiiRecord.notificationEmail,
      last_login_at: ghiiRecord.lastLoginAt,
      login_count: ghiiRecord.loginCount,
      trust_score: ghiiRecord.trustScore,
      morsel_balance: ghiiRecord.morselBalance,
      verified_attributes: ghiiRecord.verifiedAttributes,
      ftn_verified: ghiiRecord.ftnVerified,
      created_at: ghiiRecord.createdAt,
      updated_at: ghiiRecord.updatedAt,
    } : null;
    const ghii = ghiiRecord?.ghii;

    // ── Agent data (comprehensive) ──────────────────────────────────
    const agents = await storage.getAgentsByOwner(name);
    const agentGaiis = agents.map(a => a.gaii);
    const allWorkTrackingCodes = new Set<string>();
    const agentData: Record<string, unknown>[] = [];

    // Owner-invariant reads hoisted OUT of the per-agent loop (were re-fetched per agent →
    // O(agents×boards) for posts). Boards + their posts load once; flags load once.
    const allBoards = await storage.listBoards();
    const postsByBoard = new Map<string, Awaited<ReturnType<typeof storage.listPosts>>>();
    for (const board of allBoards) {
      postsByBoard.set(board.id, await storage.listPosts(board.id, { limit: 10000 }));
    }
    const allFlags = await storage.listFlags();

    for (const agent of agents) {
      const memories = await storage.listMemory(agent.gaii);
      const providerWork = await storage.listWorkByProvider(agent.gaii);
      const requesterWork = await storage.listWorkByRequester(agent.gaii);
      for (const w of providerWork) allWorkTrackingCodes.add(w.trackingCode);
      for (const w of requesterWork) allWorkTrackingCodes.add(w.trackingCode);
      const transactions = await storage.getTransactions(agent.gaii, 10000);
      const trust = await calculateTrustScore(agent.gaii, storage);

      // Board posts by this agent (from the pre-loaded per-board posts).
      const agentBoardPosts = [];
      for (const board of allBoards) {
        const posts = postsByBoard.get(board.id) ?? [];
        for (const post of posts) {
          if (post.authorGaii === agent.gaii) {
            agentBoardPosts.push({
              board_id: post.boardId,
              post_id: post.id,
              title: post.title,
              body: post.body,
              category: post.category,
              tags: post.tags,
              reactions: post.reactions,
              reply_to: post.replyTo,
              created_at: post.createdAt,
            });
          }
        }
      }

      // Consent records granted by this agent
      const consentsGranted = await storage.listConsents(agent.gaii);
      // Consent audit trail for this agent
      const consentAudit = await storage.listConsentAudit(agent.gaii);

      // Flags filed by this agent (from the pre-loaded flag list)
      const flagsFiled = allFlags.filter(f => f.flaggedBy === agent.gaii).map(f => ({
        id: f.id,
        target_type: f.targetType,
        target_id: f.targetId,
        reason: f.reason,
        description: f.description,
        status: f.status,
        created_at: f.createdAt,
      }));
      // Flags against this agent
      const flagsAgainst = allFlags.filter(f => f.targetType === 'agent' && f.targetId === agent.gaii).map(f => ({
        id: f.id,
        flagged_by: f.flaggedBy,
        reason: f.reason,
        description: f.description,
        status: f.status,
        created_at: f.createdAt,
      }));

      // Storage files (metadata only — no binary data)
      const storageFiles = await storage.listStorageFiles(agent.gaii);
      const filesMetadata = storageFiles.map(f => ({
        key: f.key,
        mime_type: f.mimeType,
        size: f.size,
        visibility: f.visibility,
        created_at: f.createdAt,
      }));

      // Board subscriptions
      const boardSubscriptions = await storage.listSubscriptionsByAgent(agent.gaii);

      // Escrow holds
      const escrowHolds = await storage.listEscrowHolds(agent.gaii);

      // agent.owner === name for every agent here (all from getAgentsByOwner(name)), so the owner
      // GHII is the already-loaded ghiiRecord — no per-agent getGHIIByOwner re-fetch. The morsel
      // balance lives on the owner GHII (agent balances are always 0 in the morsel economy).
      agentData.push({
        gaii: agent.gaii,
        display_name: agent.displayName,
        description: agent.description,
        capabilities: agent.capabilities,
        default_scopes: agent.defaultScopes,
        trust,
        morsel_balance: ghiiRecord?.morselBalance ?? 0,
        created_at: agent.createdAt,
        last_seen: agent.lastSeen,
        memories: memories.map(m => ({
          key: m.key,
          value: m.value,
          visibility: m.visibility,
          tags: m.tags,
          version: m.version,
          created_at: m.createdAt,
          updated_at: m.updatedAt,
        })),
        work_provided: providerWork.map(w => ({
          tracking_code: w.trackingCode,
          action_id: w.actionId,
          status: w.status,
          requester_gaii: w.requesterGaii,
          cost: w.cost,
          rating: w.rating,
          created_at: w.createdAt,
          updated_at: w.updatedAt,
        })),
        work_requested: requesterWork.map(w => ({
          tracking_code: w.trackingCode,
          action_id: w.actionId,
          status: w.status,
          provider_gaii: w.providerGaii,
          cost: w.cost,
          rating: w.rating,
          created_at: w.createdAt,
          updated_at: w.updatedAt,
        })),
        transactions: transactions.map(t => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          counterparty_gaii: t.counterpartyGaii,
          tracking_code: t.trackingCode,
          timestamp: t.timestamp,
        })),
        board_posts: agentBoardPosts,
        consents_granted: consentsGranted.map(c => ({
          id: c.id,
          data_pattern: c.dataPattern,
          recipient: c.recipient,
          purpose: c.purpose,
          scope: c.scope,
          expires: c.expires,
          status: c.status,
          granted_at: c.grantedAt,
          revoked_at: c.revokedAt,
        })),
        consent_audit: consentAudit.map(a => ({
          consent_id: a.consentId,
          accessor_gaii: a.accessorGaii,
          memory_key: a.memoryKey,
          action: a.action,
          allowed: a.allowed,
          timestamp: a.timestamp,
        })),
        flags_filed: flagsFiled,
        flags_against: flagsAgainst,
        storage_files: filesMetadata,
        board_subscriptions: boardSubscriptions.map(s => ({
          board_id: s.boardId,
          callback_url: s.callbackUrl,
          filters: s.filters,
          created_at: s.createdAt,
        })),
        escrow_holds: escrowHolds.map(e => ({
          hold_id: e.holdId,
          amount: e.amount,
          reason: e.reason,
          status: e.status,
          extension_name: e.extensionName,
          created_at: e.createdAt,
          released_at: e.releasedAt,
          released_to: e.releasedTo,
        })),
      });
    }

    // ── Disputes (via work tracking codes) ──────────────────────────
    const allDisputes = await storage.listAllDisputes();
    const ownerDisputes = allDisputes.filter(d =>
      agentGaiis.includes(d.openedBy) ||
      // Also include disputes on work records involving owner's agents
      allWorkTrackingCodes.has(d.trackingCode)
    );
    const disputeExport = [];
    for (const dispute of ownerDisputes) {
      const auditLog = await storage.getDisputeAuditLog(dispute.id);
      disputeExport.push({
        id: dispute.id,
        tracking_code: dispute.trackingCode,
        status: dispute.status,
        opened_by: dispute.openedBy,
        reason: dispute.reason,
        ruling: dispute.ruling,
        created_at: dispute.createdAt,
        updated_at: dispute.updatedAt,
        audit_log: auditLog.map(e => ({
          sequence: e.sequence,
          event: e.event,
          actor: e.actor,
          timestamp: e.timestamp,
          data: e.data,
        })),
      });
    }

    // ── Personal node data ──────────────────────────────────────────
    const personalNode = await storage.getPersonalNodeByOwner(name);
    const personalNodeData = personalNode ? {
      node_id: personalNode.nodeId,
      anchor_node_id: personalNode.anchorNodeId,
      status: personalNode.status,
      agent_gaiis: personalNode.agentGaiis,
      last_seen: personalNode.lastSeen,
      mailbox_quota_bytes: personalNode.mailboxQuotaBytes,
      mailbox_used_bytes: personalNode.mailboxUsedBytes,
      visibility: personalNode.visibility,
      created_at: personalNode.createdAt,
      updated_at: personalNode.updatedAt,
    } : null;

    // ── Personal push subscriptions (on personal node) ──────────────
    let personalPushSubscriptions: unknown[] = [];
    if (personalNode) {
      const subs = await storage.listPersonalPushSubscriptions(personalNode.nodeId);
      personalPushSubscriptions = subs.map(s => ({
        id: s.id,
        endpoint: s.endpoint,
        failure_count: s.failureCount,
        created_at: s.createdAt,
        last_used_at: s.lastUsedAt,
      }));

      // Notification preferences
      const prefs = await storage.getNotificationPreferences(personalNode.nodeId);
      if (prefs) {
        (personalNodeData as Record<string, unknown>).notification_preferences = {
          enabled: prefs.enabled,
          channels: prefs.channels,
          notify_types: prefs.notifyTypes,
          cooldown_minutes: prefs.cooldownMinutes,
          quiet_hours_utc: prefs.quietHoursUtc,
          email: prefs.email,
        };
      }
    }

    // ── Push subscription (PWA — Phase 3.1) ─────────────────────────
    const pushSub = await storage.getPushSubscription(name);
    const pushSubscription = pushSub ? {
      endpoint: pushSub.endpoint,
      created_at: pushSub.createdAt,
      last_used_at: pushSub.lastUsedAt,
    } : null;

    // ── Marketplace: listings and purchases ──────────────────────────
    const listings = await storage.listListings({ sellerOwner: name });
    const listingsExport = listings.map(l => ({
      id: l.id,
      title: l.title,
      description: l.description,
      category: l.category,
      price_morsels: l.priceMorsels,
      condition: l.condition,
      availability: l.availability,
      location: l.location,
      tags: l.tags,
      status: l.status,
      flag_count: l.flagCount,
      created_at: l.createdAt,
      updated_at: l.updatedAt,
    }));

    const purchasesAsBuyer = await storage.listPurchasesByBuyer(name);
    const purchasesAsSeller = await storage.listPurchasesBySeller(name);
    const purchasesExport = {
      as_buyer: purchasesAsBuyer.map(p => ({
        id: p.id,
        listing_id: p.listingId,
        seller_owner: p.sellerOwner,
        price_morsels: p.priceMorsels,
        transaction_fee_morsels: p.transactionFeeMorsels,
        total_cost_morsels: p.totalCostMorsels,
        status: p.status,
        rating: p.rating,
        tracking_code: p.trackingCode,
        created_at: p.createdAt,
        completed_at: p.completedAt,
      })),
      as_seller: purchasesAsSeller.map(p => ({
        id: p.id,
        listing_id: p.listingId,
        buyer_owner: p.buyerOwner,
        price_morsels: p.priceMorsels,
        transaction_fee_morsels: p.transactionFeeMorsels,
        total_cost_morsels: p.totalCostMorsels,
        status: p.status,
        rating: p.rating,
        tracking_code: p.trackingCode,
        created_at: p.createdAt,
        completed_at: p.completedAt,
      })),
    };

    // ── Matches (via GHII) ──────────────────────────────────────────
    let matchesExport: unknown[] = [];
    if (ghii) {
      const matches = await storage.listMatchesByProfile(ghii);
      matchesExport = matches.map(m => ({
        id: m.id,
        profile_a: m.profileA,
        profile_b: m.profileB,
        score: m.score,
        breakdown: m.breakdown,
        status: m.status,
        notified_at: m.notifiedAt,
        responded_at: m.respondedAt,
        expires_at: m.expiresAt,
        created_at: m.createdAt,
      }));
    }

    // ── Organism memberships (via GHII) ─────────────────────────────
    let organismMemberships: unknown[] = [];
    if (ghii) {
      const memberships = await storage.listMembershipsByGhii(ghii);
      const membershipExport = [];
      for (const mem of memberships) {
        const organism = await storage.getOrganism(mem.organismId);
        membershipExport.push({
          organism_id: mem.organismId,
          organism_name: organism?.name ?? null,
          role: mem.role,
          status: mem.status,
          joined_at: mem.joinedAt,
          invited_by: mem.invitedBy,
        });
      }
      organismMemberships = membershipExport;
    }

    // ── Chat instances ──────────────────────────────────────────────
    const chatInstances = await storage.listChatInstances({ ownerName: name });
    const chatInstancesExport = chatInstances.map(c => ({
      id: c.id,
      platform: c.platform,
      app_name: c.appName,
      ghii: c.ghii,
      is_anonymous: c.isAnonymous,
      created_at: c.createdAt,
      last_seen: c.lastSeen,
    }));

    // ── Flags filed by GHII (owner-level moderation) ────────────────
    // Flags may also be filed by GHII directly (not just agent GAIIs)
    let ghiiFlags: unknown[] = [];
    if (ghii) {
      const allFlags = await storage.listFlags();
      ghiiFlags = allFlags.filter(f => f.flaggedBy === ghii).map(f => ({
        id: f.id,
        target_type: f.targetType,
        target_id: f.targetId,
        reason: f.reason,
        description: f.description,
        status: f.status,
        created_at: f.createdAt,
      }));
    }

    res.json(success(config.nodeId, {
      owner: {
        name: owner.name,
        display_name: owner.displayName,
        roles: owner.roles,
        created_at: owner.createdAt,
      },
      ghii: ghiiData,
      agents: agentData,
      disputes: disputeExport,
      personal_node: personalNodeData,
      personal_push_subscriptions: personalPushSubscriptions,
      push_subscription: pushSubscription,
      listings: listingsExport,
      purchases: purchasesExport,
      matches: matchesExport,
      organism_memberships: organismMemberships,
      chat_instances: chatInstancesExport,
      ghii_flags_filed: ghiiFlags,
      exported_at: new Date().toISOString(),
    }));
  });
}
