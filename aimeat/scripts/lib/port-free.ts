/**
 * @file scripts/lib/port-free.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is this port free on EVERY address a node of ours would be reached at?
 *
 *   One bind on the wildcard address does not answer that. Windows lets it succeed while another
 *   process holds 127.0.0.1 on the same port, because the two addresses differ, and then the more
 *   specific bind wins every request sent to 127.0.0.1: the new node starts, and everything
 *   addressed to it over loopback is answered by the old one. The sandbox hit exactly this on
 *   2026-09-19 (port 40605, another session's process): a publish came back as somebody else's
 *   page with 200, and the seeding died on "token undefined".
 *
 *   So the question is asked three times, in sequence, never at once: the wildcard the node itself
 *   binds, IPv4 loopback, and IPv6 loopback. A machine without IPv6 refuses the third with an
 *   address error, which is not "taken" and is read as free.
 * @structure portIsFree(port)
 * @usage import { portIsFree } from './lib/port-free.js';
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial, taken out of scripts/sandbox.ts and widened.
 */
import { createServer } from 'node:net';

/** Addresses that are absent on this machine, as opposed to held by somebody. */
const NOT_HERE = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EINVAL']);

function canBind(port: number, host: string | undefined): Promise<boolean> {
  return new Promise<boolean>((settle) => {
    const probe = createServer();
    probe.once('error', (err: NodeJS.ErrnoException) => settle(NOT_HERE.has(err.code ?? '')));
    probe.once('listening', () => probe.close(() => settle(true)));
    probe.listen(port, host);
  });
}

export async function portIsFree(port: number): Promise<boolean> {
  for (const host of [undefined, '127.0.0.1', '::1']) {
    if (!(await canBind(port, host))) return false;
  }
  return true;
}
