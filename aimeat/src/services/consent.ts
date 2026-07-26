/**
 * @file consent.ts
 * @description Consent decision engine for non-public reads: recipient matching, read
 *   authorization (visibility + group + private consent + organism-member resolution),
 *   audit-entry writing, and the consent-expiry background job. Used by the shared
 *   access-guard and every identity-scoped read path (memory, storage, knowledge).
 * @structure
 *   - matchesRecipient() — pure recipient-pattern matcher (sync; organism.* resolved elsewhere)
 *   - checkConsentForRead() — full read decision incl. async organism-membership resolution
 *   - auditDataAccess() — write a ConsentAuditEntry
 *   - expireConsents() / startConsentExpiryJob() — periodic expiry of stale grants
 * @usage
 *   import { checkConsentForRead, auditDataAccess } from '../services/consent.js';
 * @version-history
 *   v1.1.0 -- 2026-06-07 -- Resolve organism.{id} grants via active-membership lookup in
 *     checkConsentForRead (previously matchesRecipient returned false with no resolver).
 *   v1.2.0 -- 2026-06-21 -- auditDataAccess now enqueues into the in-memory consent-audit
 *     buffer (batched off the request path) instead of a synchronous per-read DB write.
 *   v1.3.0 -- 2026-07-16 -- organism-grant resolution reads the accessor's memberships ONCE
 *     (listMembershipsByGhii) instead of getMembership per org grant (Phase 3).
 */
import { v4 as uuidv4 } from 'uuid';
import type { Storage, ConsentAuditEntry } from '../storage/interface.js';
import { globMatchSimple, consentMatchPattern } from '../storage/pattern-utils.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { bufferConsentAudit } from './consent-audit-buffer.js';
import { logger } from '../utils/logger.js';

/**
 * Check whether a consent record's recipient field matches a given accessor.
 *
 * Supported recipient patterns:
 * - `*`                      — wildcard, matches any accessor
 * - exact GAII               — matches only that specific GAII
 * - `ghii:username@node`     — matches all agents owned by that GHII user on that node
 * - `domain:*.pattern`       — matches all agents whose home node matches the glob
 * - `node:node-id`           — matches all agents on a specific node
 * - `organism.{id}`          — placeholder (requires async lookup, handled separately)
 */
export function matchesRecipient(
  recipient: string,
  accessorGaii: string,
  accessorOwner: string,
  accessorNode: string,
): boolean {
  // Wildcard — everyone
  if (recipient === '*') return true;

  // Exact GAII match
  if (recipient === accessorGaii) return true;

  // GHII user — all agents under this human identity on a specific node
  if (recipient.startsWith('ghii:')) {
    const ghii = recipient.slice(5); // "username@node"
    const atIdx = ghii.lastIndexOf('@');
    if (atIdx === -1) return false;
    const username = ghii.slice(0, atIdx);
    const node = ghii.slice(atIdx + 1);
    return accessorOwner === username && accessorNode === node;
  }

  // Domain glob — match accessor's home node ID
  if (recipient.startsWith('domain:')) {
    const pattern = recipient.slice(7); // "*.health-network.fi"
    return globMatchSimple(pattern, accessorNode);
  }

  // Specific node — all agents on that node
  if (recipient.startsWith('node:')) {
    const nodeId = recipient.slice(5);
    return accessorNode === nodeId;
  }

  // Organism membership — not handled here (requires async storage lookup)
  // The storage layer should handle organism.{id} patterns separately
  if (recipient.startsWith('organism.')) {
    return false; // Placeholder — resolved at storage layer
  }

  return false;
}

/**
 * Check if an accessor has consent to read a specific memory key.
 *
 * Logic:
 * 1. If visibility is 'public' → always allow
 * 2. If accessor is the data owner → always allow
 * 3. If visibility is 'owner' → allow if same owner
 * 4. If visibility is 'private' → allow only for owner
 * 5. Otherwise: find matching consent → allow if active consent exists
 */
export async function checkConsentForRead(
  storage: Storage,
  memoryKey: string,
  ownerGaii: string,
  accessorGaii: string,
  visibility: string,
  groupId?: string,
): Promise<{ allowed: boolean; consentId?: string; reason?: string }> {
  // Public data is always accessible
  if (visibility === 'public') {
    return { allowed: true, reason: 'public_data' };
  }

  // Owner always has access to their own data
  if (ownerGaii === accessorGaii) {
    return { allowed: true, reason: 'owner_access' };
  }

  // Owner-visibility: check if same owner (different agent of same owner)
  if (visibility === 'owner') {
    // Check if both GAIIs belong to the same owner
    const ownerPart = ownerGaii.includes('#') ? ownerGaii.split('#')[1]?.split('@')[0] : ownerGaii.split('@')[0];
    const accessorPart = accessorGaii.includes('#') ? accessorGaii.split('#')[1]?.split('@')[0] : accessorGaii.split('@')[0];
    if (ownerPart && accessorPart && ownerPart === accessorPart) {
      return { allowed: true, reason: 'same_owner' };
    }
  }

  // Group visibility: check membership in the referenced sharing group
  if (visibility === 'group') {
    if (!groupId) return { allowed: false, reason: 'missing_group_id' };
    const group = await storage.getSharingGroup(groupId);
    if (!group) return { allowed: false, reason: 'group_not_found' };

    // Owner of the group always has access
    if (group.ownerGaii === accessorGaii) {
      return { allowed: true, reason: 'group_owner' };
    }

    // Check accessor ownership match (bare owner name vs GHII)
    const accessorParsed = parseGaiiLoose(accessorGaii);
    const groupOwnerParsed = parseGaiiLoose(group.ownerGaii);
    if (accessorParsed && groupOwnerParsed && accessorParsed.owner === groupOwnerParsed.owner) {
      return { allowed: true, reason: 'group_owner' };
    }

    const member = group.members.find(m =>
      m.identifier === accessorGaii ||
      (accessorParsed && m.identifier === `${accessorParsed.owner}@${accessorParsed.node}`),
    );
    if (!member) return { allowed: false, reason: 'not_group_member' };
    const perms = member.permissions ?? group.defaultPermissions;
    if (!perms.read) return { allowed: false, reason: 'no_read_permission' };
    return { allowed: true, reason: 'group_member' };
  }

  // Private data requires explicit consent
  const matchingConsents = await storage.findMatchingConsents(ownerGaii, memoryKey, accessorGaii);

  if (matchingConsents.length > 0) {
    return {
      allowed: true,
      consentId: matchingConsents[0].id,
      reason: 'consent_granted',
    };
  }

  // `organism.{id}` recipients can't be resolved by the sync matchesRecipient() — they
  // require an async membership lookup. Honor such a grant when the accessor is an active
  // member of the granted organism. Membership is keyed by the bare owner name (see
  // organisms.ts / knowledge.ts, which call getMembership with req.auth.owner).
  const orgGrants = (await storage.listConsents(ownerGaii, { status: 'active' })).filter(c =>
    c.recipient.startsWith('organism.') &&
    consentMatchPattern(c.dataPattern, memoryKey) &&
    (!c.expires || new Date(c.expires) > new Date()),
  );
  if (orgGrants.length > 0) {
    const accessorOwner = parseGaiiLoose(accessorGaii).owner;
    if (accessorOwner) {
      // The accessor's active organism memberships in ONE query (was getMembership per org grant), then
      // honour the first grant whose organism the accessor actively belongs to — same result, same order.
      const activeOrgIds = new Set(
        (await storage.listMembershipsByGhii(accessorOwner))
          .filter(m => m.status === 'active')
          .map(m => m.organismId),
      );
      for (const c of orgGrants) {
        if (activeOrgIds.has(c.recipient.slice('organism.'.length))) {
          return { allowed: true, consentId: c.id, reason: 'organism_member_consent' };
        }
      }
    }
  }

  return {
    allowed: false,
    reason: 'no_matching_consent',
  };
}

/**
 * Record an audit entry for data access or a consent mutation. Enqueues into the in-memory
 * consent-audit buffer (flushed in batches off the request path) rather than writing to
 * storage synchronously. The `storage` param is kept for signature stability but unused.
 *
 * Policy (see consent-audit-buffer.ts): callers only audit what is worth keeping — access
 * DENIALS (allowed:false) and consent MUTATIONS (grant/revoke). Allowed reads are no longer
 * audited; that was the bulk of the unbounded growth and the per-read write that slowed reads.
 */
export async function auditDataAccess(
  _storage: Storage,
  consentId: string | null,
  ownerGaii: string,
  accessorGaii: string,
  memoryKey: string,
  action: ConsentAuditEntry['action'],
  allowed: boolean,
): Promise<void> {
  bufferConsentAudit({
    id: uuidv4(),
    consentId: consentId ?? 'none',
    ownerGaii,
    accessorGaii,
    memoryKey,
    action,
    timestamp: new Date().toISOString(),
    allowed,
  });
}

/**
 * Expire consents that have passed their expiration date.
 * Returns the number of expired consents.
 */
export async function expireConsents(storage: Storage): Promise<number> {
  const now = new Date().toISOString();
  return storage.expireStaleConsents(now);
}

/**
 * Start the consent expiry background job.
 * Runs every 10 minutes.
 */
export function startConsentExpiryJob(storage: Storage): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await expireConsents(storage);
    } catch (err) {
      // Silent failure for background job
      logger.warn('startConsentExpiryJob: continuing after a suppressed failure', { error: String(err) });
    }
  }, 10 * 60 * 1000); // 10 minutes
}
