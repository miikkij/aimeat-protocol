/**
 * @file src/services/company/smtp-host-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a company's own SMTP host may be connected to, and the address to connect to.
 *   A company's sending identity names a host and a port, and the node opens the connection itself,
 *   so without a check a company's settings reached loopback and private-network services the node
 *   can see (secaudit2026oct22, sendAsCompany:smtp-host-address-class). The same address rules as
 *   safeFetch decide (utils/blocked-ip.ts): a public address passes; loopback passes on a node in
 *   local mode (loopbackEgressAllowed); any other private, link-local or reserved address passes only
 *   when the operator lists the host, the address or its network in email.company_smtp_private_hosts.
 *
 *   The check runs when the settings are saved and again before each send, and the send connects to
 *   the address this check accepted (with the host name kept for TLS), so a name that resolves
 *   elsewhere after the save does not move the connection.
 * @structure SmtpHostCheck · checkSmtpHost(host, privateHosts, lookupFn?) · isListedPrivateHost(...)
 * @usage
 *   const checked = await checkSmtpHost(smtp.host, config.companySmtpPrivateHosts);
 *   if (!checked.ok) refuse(checked.message);
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, sendAsCompany:smtp-host-address-class).
 */
import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { blockedIpReason, isLoopbackIp, loopbackEgressAllowed } from '../../utils/blocked-ip.js';
import { logger } from '../../utils/logger.js';
import { errorFields } from '../../utils/error-fields.js';

/** The setting an operator lists a private mail server in, named in every refusal. */
export const SMTP_PRIVATE_HOSTS_SETTING = 'email.company_smtp_private_hosts';

export type SmtpHostCheck =
  /** `address` is what to connect to; null when the name did not resolve (the caller decides). */
  | { ok: true; address: string | null }
  | { ok: false; code: 'SMTP_HOST_NOT_ALLOWED'; message: string };

type LookupFn = (host: string) => Promise<Array<{ address: string }>>;
const systemLookup: LookupFn = (host) => lookup(host, { all: true, verbatim: true });

/** Whether the operator's list names this host, this address, or a network that holds the address. */
export function isListedPrivateHost(host: string, address: string, privateHosts: readonly string[]): boolean {
  const name = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const family = isIP(address);
  for (const raw of privateHosts) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === name || entry === address.toLowerCase()) return true;
    const slash = entry.indexOf('/');
    if (slash < 0 || !family) continue;
    const net = entry.slice(0, slash);
    const prefix = Number(entry.slice(slash + 1));
    const netFamily = isIP(net);
    if (netFamily !== family || !Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) continue;
    const list = new BlockList();
    list.addSubnet(net, prefix, family === 4 ? 'ipv4' : 'ipv6');
    if (list.check(address, family === 4 ? 'ipv4' : 'ipv6')) return true;
  }
  return false;
}

/**
 * Check a company's SMTP host. Every address the name resolves to must pass, so the answer does not
 * depend on which one the connection would have picked. A name that does not resolve is not refused
 * here (a server whose DNS is not live yet can still be saved); the send then fails on the name.
 */
export async function checkSmtpHost(host: string, privateHosts: readonly string[], lookupFn: LookupFn = systemLookup): Promise<SmtpHostCheck> {
  const bare = host.trim().replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(bare)) addresses = [bare];
  else {
    try {
      addresses = (await lookupFn(bare)).map(a => a.address);
    } catch (err) {
      // address null is the failure: the save accepts a name whose DNS is not live yet, and the send refuses it by name.
      logger.info('[smtp-host-check] the company SMTP host did not resolve', { host: bare, ...errorFields(err) });
      return { ok: true, address: null };
    }
    if (addresses.length === 0) return { ok: true, address: null };
  }
  for (const address of addresses) {
    const reason = blockedIpReason(address);
    if (!reason) continue;
    if (loopbackEgressAllowed() && isLoopbackIp(address)) continue;
    if (isListedPrivateHost(bare, address, privateHosts)) continue;
    return {
      ok: false, code: 'SMTP_HOST_NOT_ALLOWED',
      message: `The mail server ${bare} is at an address outside the public internet (${reason}). This server sends a company's mail `
        + `only to public mail servers, unless the operator lists that server or its network in the setting ${SMTP_PRIVATE_HOSTS_SETTING}.`,
    };
  }
  return { ok: true, address: addresses[0] };
}
