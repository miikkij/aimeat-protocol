/**
 * @file src/services/crew-browser-domains.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a crew definition must say when one of its members has the tool `browser`:
 *   `browser_domains`, the hostnames the agent's browser may open.
 *
 *   WHY THE NODE CHECKS IT. A browser runs on a person's own computer, inside their home or office
 *   network. The crew runtime gives the tool only to a definition that names its hostnames, opens
 *   exactly those, sends no form and refuses a name that answers a private address (crewaimeat
 *   57b2cf0, 2026-10-13, feature `browser_domains`). Its validator runs when the agent starts, which
 *   is after the owner approved. So the same refusals are made here, when the agent is PROPOSED:
 *   the owner is never shown an agent with a browser and no limit, and the proposer is told what is
 *   wrong where they read it.
 *
 *   SYNTAX ONLY. Whether a name answers a public address is decided on the agent's computer when
 *   the browser starts, because that is the computer whose network matters. The runtime's validator
 *   stays the authority; this is the subset that needs no network.
 *
 *   EXACT HOSTS. `example.com` does not allow `www.example.com`: each name the browser may open is
 *   written out, so the list the owner approves is the whole list.
 * @structure browserDomainsError(crewDef) · BROWSER_TOOL · MAX_BROWSER_DOMAINS
 * @usage const refusal = browserDomainsError(def); if (refusal) return fail(400, 'INVALID_CREW_DEF', refusal);
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (the October agents plan, P5, the node's half).
 */

/** The tool id a member carries to use the browser on its computer. */
export const BROWSER_TOOL = 'browser';
/** How many hostnames one definition may name. */
export const MAX_BROWSER_DOMAINS = 20;

/** Names that mean the computer itself or the network it sits in. */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** The members that have the browser tool, by the name a task refers to them with. */
function membersWithBrowser(crewDef: unknown): string[] {
  const agents = (crewDef as { agents?: unknown } | null)?.agents;
  if (!Array.isArray(agents)) return [];
  return agents
    .filter((a): a is { name?: unknown; role?: unknown; tools: unknown[] } => !!a && typeof a === 'object' && Array.isArray((a as { tools?: unknown }).tools))
    .filter(a => a.tools.some(t => t === BROWSER_TOOL || (typeof t === 'string' && t.startsWith(`${BROWSER_TOOL}:`))))
    .map(a => String(a.name || a.role || 'a member'));
}

/** Why one entry is not a hostname the browser may be given, or null. */
function hostnameError(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'is not text; write a hostname such as "example.com"';
  if (value.includes('://') || value.includes('/')) return `"${value}" is a web address; write only the hostname, such as "example.com"`;
  // A regex, because check:single-entry reads a string test for the star as a hand-made scope check.
  if (/[*?]/.test(value)) return `"${value}" has a wildcard; write each hostname out, because the list the owner approves is the whole list`;
  if (value.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(value) || /^[0-9a-f:]+:[0-9a-f:]*$/i.test(value)) return `"${value}" is an IP address; the browser opens named public sites only`;
  if (value.includes(':')) return `"${value}" names a port; the browser opens a site's own ports only`;
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(value)) return `"${value}" has letters outside a-z; write the punycode form of the name (xn--…)`;
  if (value !== value.toLowerCase()) return `"${value}" is not in lower case`;
  if (value.endsWith('.')) return `"${value}" ends with a dot`;
  if (value === 'localhost') return `"${value}" is this computer; the browser opens public sites only`;
  if (PRIVATE_SUFFIXES.some(s => value.endsWith(s))) return `"${value}" is a name inside a private network; the browser opens public sites only`;
  const labels = value.split('.');
  if (labels.length < 2) return `"${value}" is one word; a public hostname has a dot in it, such as "example.com"`;
  if (value.length > 253 || !labels.every(l => LABEL.test(l))) return `"${value}" is not a hostname`;
  return null;
}

/**
 * What is wrong with a definition's browser use, or null. The tool and the list go together: a
 * member with the tool needs the list, and a list with no such member opens nothing.
 */
export function browserDomainsError(crewDef: unknown): string | null {
  const members = membersWithBrowser(crewDef);
  const given = (crewDef as { browser_domains?: unknown } | null)?.browser_domains;
  if (given === undefined || given === null) {
    return members.length > 0
      ? `browser_domains: ${members[0]} has the tool \`${BROWSER_TOOL}\`, so the definition must name the hostnames it may open, as ["example.com", ...]. The owner approves that list.`
      : null;
  }
  if (!Array.isArray(given)) return 'browser_domains is a list of hostnames, as ["example.com", ...].';
  if (members.length === 0) return `browser_domains: no member has the tool \`${BROWSER_TOOL}\`, so nothing would open these sites. Give a member the tool or take the list out.`;
  if (given.length === 0) return `browser_domains: ${members[0]} has the tool \`${BROWSER_TOOL}\`, so the list must name at least one hostname.`;
  if (given.length > MAX_BROWSER_DOMAINS) return `browser_domains names ${given.length} hostnames; the most is ${MAX_BROWSER_DOMAINS}.`;
  const seen = new Set<string>();
  for (const value of given) {
    const error = hostnameError(value);
    if (error) return `browser_domains: an entry ${error}.`;
    if (seen.has(value as string)) return `browser_domains: "${value}" is listed twice.`;
    seen.add(value as string);
  }
  return null;
}
