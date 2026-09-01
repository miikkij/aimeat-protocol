/**
 * @file src/cli/connect/install-id.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description This installation's id: which MACHINE a connector is running on, as far as the node
 *   is concerned.
 *
 *   WHAT IT FIXES. One `connect serve` holds one socket per agent, so the node saw an owner's
 *   sockets as one undifferentiated set and two laptops were indistinguishable from one. The
 *   basic-agents offer went to whichever principal sorted first, which could be the machine the
 *   person was not sitting at. The V1 report said so as a stated limitation; this closes it.
 *
 *   WHY IT IS NOT IN THE TOKEN. The credential belongs to the AGENT and this belongs to the
 *   MACHINE, and the whole point is telling two machines holding one credential apart. A claim in
 *   the token would be the same value on both.
 *
 *   IT IS NOT A SECRET AND NOT A CREDENTIAL. It decides which of an owner's OWN daemons an offer
 *   goes to, and nothing else: the node still verifies the token on every socket, and every fence
 *   downstream is unchanged. Forging one gets you a different one of your own machines.
 *
 * @structure getInstallId()
 * @usage headers: { 'X-AIMEAT-Install': getInstallId() }
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, post-audit item 5).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getConfigDir } from './config.js';
import { logger } from '../../utils/logger.js';

/** Read once per process: the file does not change under a running daemon. */
let cached: string | null = null;

function installIdPath(): string {
  return join(getConfigDir(), 'install-id');
}

/**
 * This installation's id, minted on first use and stable afterwards.
 *
 * A machine that cannot write its config directory still gets an id — a fresh one per process,
 * which is worse than stable and much better than none: two machines are still two, and the only
 * cost is that a restart looks like a new machine. Failing the connector over an id that exists to
 * disambiguate a convenience would be the wrong trade.
 */
export function getInstallId(): string {
  if (cached) return cached;
  const path = installIdPath();
  try {
    if (existsSync(path)) {
      const stored = readFileSync(path, 'utf-8').trim();
      if (stored) { cached = stored.slice(0, 64); return cached; }
    }
    const minted = randomUUID();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${minted}\n`, { encoding: 'utf-8', mode: 0o600 });
    cached = minted;
    return cached;
  } catch (err) {
    logger.warn('connect: could not persist an install id; using a per-process one', { error: String(err) });
    cached = randomUUID();
    return cached;
  }
}
