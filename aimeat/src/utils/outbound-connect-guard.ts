/**
 * @file outbound-connect-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connect-time half of the outbound SSRF guard. validateOutboundUrl resolves a host
 *   name and checks the addresses; fetch then resolved the name a second time and connected to
 *   whatever that answer said, so a name whose DNS answered a public address first and a loopback,
 *   private or metadata address second passed the check and connected inside (DNS rebinding).
 *
 *   Here the lookup that opens the socket is the one that is checked: an undici dispatcher whose
 *   `connect.lookup` resolves the name, refuses the connection when any address is blocked, and hands
 *   the socket exactly the addresses it checked. safeFetch passes it on every hop it validates, so the
 *   address the request goes to is an address the guard accepted. A literal IP needs no lookup and
 *   is decided by validateOutboundUrl before the request.
 * @structure guardedLookup(hostname, options, callback) · guardedDispatcher() · connectRefusal(err)
 * @usage await fetch(url, { ...init, dispatcher: guardedDispatcher() });
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial: the connection is pinned to the checked address (QA audit S4-02).
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { Agent } from 'undici';
import { blockedIpReason, isLoopbackIp, loopbackEgressAllowed } from './blocked-ip.js';

/** The code a connect-time refusal carries, so safeFetch can tell it from a network failure. */
export const CONNECT_BLOCKED = 'EAIMEAT_CONNECT_BLOCKED';

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `net.connect` lookup that refuses a blocked address. Every address the name resolves to is
 * checked, as validateOutboundUrl does, and the socket gets the same list back, so it cannot connect
 * to an address nobody checked.
 */
export function guardedLookup(hostname: string, options: { all?: boolean; family?: number | string } | undefined, callback: LookupCallback): void {
  const family = typeof options?.family === 'number' ? options.family : 0;
  dnsLookup(hostname, { all: true, family }, (err, addresses) => {
    if (err) { callback(err, []); return; }
    if (!addresses.length) {
      callback(Object.assign(new Error(`${hostname} resolved to no address`), { code: 'ENOTFOUND' }), []);
      return;
    }
    const allowLoopback = loopbackEgressAllowed();
    for (const { address } of addresses) {
      const reason = blockedIpReason(address);
      if (reason && !(allowLoopback && isLoopbackIp(address))) {
        callback(Object.assign(
          new Error(`Fetch blocked: ${hostname} resolved to a ${reason} when the connection was opened`),
          { code: CONNECT_BLOCKED },
        ), []);
        return;
      }
    }
    if (options?.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

let dispatcher: Agent | null = null;

/** The one dispatcher safeFetch connects through. Created on first use; it pools connections as fetch does. */
export function guardedDispatcher(): Agent {
  if (!dispatcher) dispatcher = new Agent({ connect: { lookup: guardedLookup as never } });
  return dispatcher;
}

/** The refusal inside a fetch failure, when the connect-time check was what stopped it. */
export function connectRefusal(err: unknown): Error | null {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && e && typeof e === 'object'; depth++) {
    if ((e as { code?: unknown }).code === CONNECT_BLOCKED) return e as Error;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}
