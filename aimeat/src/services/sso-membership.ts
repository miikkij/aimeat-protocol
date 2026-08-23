/**
 * @file src/services/sso-membership.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one effect of an SSO connection's organism binding (BR-04 R1): a person who
 *   arrives through the organisation's identity provider — SAML sign-in or SCIM provisioning —
 *   becomes a MEMBER of the organisation's organism. Nothing else: no roles, no workspace grants,
 *   no group sync in v1.
 *
 *   This deliberately does NOT go through joinOrganism(): that door enforces the organism's own
 *   joinPolicy, and an organisation organism is typically invite_only — here the operator already
 *   authorized membership by binding the connection, which IS the invitation, standing.
 * @structure ensureSsoMembership(storage, conn, ownerName) — idempotent, best-effort for callers.
 * @usage await ensureSsoMembership(storage, conn, ghii.ownerName);
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (BR-04 phases 2-3).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, SsoConnectionRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/**
 * Make sure `ownerName` is an active member of the connection's organism. No-op when the
 * connection has no binding, the organism is gone, or a membership row already exists in any
 * status — a ban or a pending invitation is a decision this function must not overwrite.
 */
export async function ensureSsoMembership(storage: Storage, conn: SsoConnectionRecord, ownerName: string): Promise<void> {
  if (!conn.organismId) return;
  try {
    const organism = await storage.getOrganism(conn.organismId);
    if (!organism) {
      logger.warn('SSO connection points at a missing organism; membership skipped', { connection: conn.id, organism: conn.organismId });
      return;
    }
    const existing = await storage.getMembership(conn.organismId, ownerName);
    if (existing) return;
    const now = new Date().toISOString();
    await storage.createMembership({
      id: randomUUID(),
      organismId: conn.organismId,
      ghii: ownerName,
      role: 'member',
      status: 'active',
      joinedAt: now,
      invitedBy: `sso:${conn.id}`,
    });
    if (!organism.members.includes(ownerName)) {
      await storage.updateOrganism(conn.organismId, { members: [...organism.members, ownerName], updatedAt: now });
    }
    emitChange('organisms');
  } catch (err) {
    // Best-effort by contract: a broken organism must not refuse a valid sign-in or provision.
    logger.warn('ensureSsoMembership failed; the person is in, the membership is not', {
      connection: conn.id, owner: ownerName, error: String(err),
    });
  }
}
