/**
 * @file anonymous-identity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The anonymous mode's shared identity: the anonymous owner, its one shared agent and
 *   its GHII, created when missing, and the anonymous auth fallback switched on for this node.
 * @structure setupAnonymousIdentity(config, storage)
 * @usage await setupAnonymousIdentity(config, storage);   // from initializeServices, when anonymous mode is on
 * @version-history
 *   v1.0.0 — 2026-11-04 — Moved unchanged out of service-init.ts, which had reached the 800-line limit
 *     after the HA stage 1 merge (codebase analysis 2026-11-03).
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { enableAnonymousAuth } from '../auth/middleware.js';
import { ANONYMOUS_SCOPES } from '../auth/anonymous-scopes.js';
import { logger } from '../utils/logger.js';
import { errorFields } from '../utils/error-fields.js';

/** Set up the anonymous owner + agent + GHII for anonymous mode. Normal auth still works alongside. */
export async function setupAnonymousIdentity(config: AimeatConfig, storage: Storage): Promise<void> {
  const ANON_OWNER = 'anonymous';
  const ANON_AGENT_NAME = 'shared';
  const ANON_GAII = `${ANON_AGENT_NAME}#${ANON_OWNER}@${config.nodeId}`;

  try {
    // Create anonymous owner if doesn't exist
    const owner = await storage.getOwner(ANON_OWNER);
    if (!owner) {
      const kp = await generateKeyPair();
      await storage.createOwner({
        name: ANON_OWNER,
        displayName: 'Anonymous Node',
        publicKey: kp.publicKey,
        roles: ['owner'],
        createdAt: new Date().toISOString(),
      });
      logger.info('Anonymous owner created');
    }

    // Create anonymous agent if doesn't exist
    const agent = await storage.getAgent(ANON_GAII);
    if (!agent) {
      const kp = await generateKeyPair();
      await storage.createAgent({
        name: ANON_AGENT_NAME,
        owner: ANON_OWNER,
        gaii: ANON_GAII,
        displayName: 'Shared Anonymous Agent',
        description: 'Shared agent for anonymous mode — all AI agents share this identity and memory space',
        capabilities: ['memory', 'actions', 'catalogue'],
        // THE RECORD CARRIES WHAT THE MINT HANDS OUT. It carried nothing, which was invisible while
        // a token's own scopes were the answer; auth/effective-scopes.ts made the record the truth
        // for every agent, so an empty list here meant the anonymous token was refused everywhere
        // it had worked the day before. Named in one place (ANONYMOUS_SCOPES) so the two cannot
        // drift again.
        defaultScopes: [...ANONYMOUS_SCOPES],
        publicKey: kp.publicKey,
        trustScore: 50,
        morselBalance: config.welcomeBonus,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
      logger.info('Anonymous agent created', { gaii: ANON_GAII });
    }

    // Create anonymous GHII if doesn't exist — system identity for anonymous chat sessions
    const ANON_GHII = `${ANON_OWNER}@${config.nodeId}`;
    const existingGhii = await storage.getGHII(ANON_GHII);
    if (!existingGhii) {
      const now = new Date().toISOString();
      await storage.createGHII({
        username: ANON_OWNER,
        nodeId: config.nodeId,
        ghii: ANON_GHII,
        displayName: 'Anonymous',
        verificationLevel: 0,
        ownerName: ANON_OWNER,
        totpEnabled: false,
        trustScore: 50,
        morselBalance: 0,
        createdAt: now,
        updatedAt: now,
      });
      logger.info('Anonymous GHII created', { ghii: ANON_GHII });
    }

    // Enable the anonymous auth fallback in middleware, for this node only
    enableAnonymousAuth(ANON_GAII, ANON_OWNER, config.nodeId);
    logger.info('Anonymous mode enabled — unauthenticated requests use shared identity', { gaii: ANON_GAII });
  } catch (err) {
    logger.error('Failed to setup anonymous identity', errorFields(err));
  }
}
