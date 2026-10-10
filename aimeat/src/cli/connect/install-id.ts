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
 *   THE NAME BESIDE IT. A UUID tells two machines apart and tells a person nothing, so the connector
 *   also reports a name: AIMEAT_INSTALL_NAME when the person set one, else the host name. The node
 *   shows it to the connector's own owner, who can replace it with a name of their own there. It is
 *   sent URI-encoded, because a host name may hold characters an HTTP header may not, and a header
 *   the client library refuses would stop the connector from connecting at all.
 *
 * @structure getInstallId() · getInstallName() · installHeaders()
 * @usage headers: { Authorization: `Bearer ${token}`, ...installHeaders() }
 * @version-history
 *   v1.1.0 — 2026-10-10 — getInstallName() and installHeaders(): the connector reports a name for
 *     its installation (X-AIMEAT-Install-Name), which the node's connector list shows.
 *   v1.0.1 — 2026-10-09 — The home is prepared before the write: 0700 and a .gitignore of `*`
 *     (home-dir.ts; secrets audit 2026-10-09, S4).
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, post-audit item 5).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { hostname } from 'node:os';
import { getConfigDir } from './config.js';
import { prepareConnectorHome } from './home-dir.js';
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
    // The home is made 0700 with a .gitignore of `*` before anything is written in it (home-dir.ts).
    prepareConnectorHome(dirname(path));
    writeFileSync(path, `${minted}\n`, { encoding: 'utf-8', mode: 0o600 });
    cached = minted;
    return cached;
  } catch (err) {
    logger.warn('connect: could not persist an install id; using a per-process one', { error: String(err) });
    cached = randomUUID();
    return cached;
  }
}

/** The longest name sent. The node keeps the same length. */
const INSTALL_NAME_MAX = 60;

/**
 * The name this installation reports: AIMEAT_INSTALL_NAME when set, else the host name, else none.
 * Read per call, because it costs nothing and an operator may set the variable between starts.
 */
export function getInstallName(): string | null {
  const fromEnv = (process.env.AIMEAT_INSTALL_NAME ?? '').trim();
  let name = fromEnv;
  if (!name) {
    try { name = hostname().trim(); } catch (err) {
      logger.warn('connect: the host name could not be read; the connector reports no name', { error: String(err) });
      name = '';
    }
  }
  name = name.slice(0, INSTALL_NAME_MAX).trim();
  return name === '' ? null : name;
}

/** The two headers that say which installation a tunnel socket belongs to. */
export function installHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'X-AIMEAT-Install': getInstallId() };
  const name = getInstallName();
  if (name) headers['X-AIMEAT-Install-Name'] = encodeURIComponent(name);
  return headers;
}
