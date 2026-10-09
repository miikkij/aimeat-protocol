/**
 * @file src/services/extension-network-hosts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The manifest's `network:` block: the hostnames ctx.fetch may reach, named by the author
 *   (`hosts`), and the config fields whose value the installer gives as one more host (`host_fields`).
 *
 *   WHY host_fields. An extension that reads a customer's own service (the SOC's Wazuh indexer) has a
 *   host that differs for every install. With `hosts` alone the author had to build the package once
 *   per customer, and one bundle could not serve two buyers (wish-a-package-s-extension-hosts-
 *   settable-per-install-the-soc-s-w, aimeat-commercial, 2026-10-09). A host field is a config field
 *   of the extension: the package's config-needs asks it before the sale, the install stores the
 *   answer, the owner can change it later, and its current value joins the allowlist of THAT install
 *   from the next fetch on.
 *
 *   THE AUTHOR STILL DECIDES WHERE IT CAN POINT. Only a field the manifest names in `host_fields` can
 *   add a host, and its value is one hostname or IPv4 address with an optional port, never a scheme,
 *   a path, a wildcard or a list. A private or loopback address is still refused by safeFetch's SSRF
 *   rules on a node that refuses private egress.
 *
 *   A leaf module: the manifest builder, the capability reader and the config writers import it.
 * @structure NETWORK_HOST_FIELDS_KEY · NetworkHostField · hostRefusal() · parseHostFieldValue() ·
 *   parseNetworkDeclaration() · carryHostFieldValues() · hostFieldsOf()
 * @usage
 *   const net = parseNetworkDeclaration(manifest.network, capabilityList, manifestConfig, secretKeys);
 *   const v = parseHostFieldValue('wazuh.example.com:9200');   // { ok, value, host: 'wazuh.example.com' }
 * @version-history
 *   v1.1.0 — 2026-10-09 — carryHostFieldValues(): an in-place extension update keeps the owner's host
 *     (found on aimeat.io by cc-jouni-soc-sale: an upload upsert reset WAZUH_HOST to '').
 *   v1.0.0 — 2026-10-09 — Initial: `host_fields`, and hostRefusal() moved here from extension-manifest.ts.
 */

/** Where the manifest's `network.host_fields` is stored on the record's config. __-prefixed, so `config:` cannot set it. */
export const NETWORK_HOST_FIELDS_KEY = '__networkHostFields';

/** One config field whose value is a host this install may reach. `required`: the install asks it. */
export interface NetworkHostField { field: string; required: boolean }

/** The most host fields one manifest may name. */
const MAX_HOST_FIELDS = 10;

/** One hostname label: letters, digits and inner hyphens, 1 to 63 characters. */
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** A dotted IPv4 address in its one canonical spelling: four decimal octets, no leading zeros. */
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * Why a declared host is not a bare hostname, or null when it is. Hosts are compared EXACTLY, so each
 * refused form is one where an exact match would mean something other than what the author wrote.
 * Used for `network.hosts` and `provides.ai_provider.hosts` (services/extension-manifest.ts).
 */
export function hostRefusal(host: string): string | null {
  if (host.includes('://')) return 'a host is a bare hostname without a scheme: write api.example.com, not https://api.example.com';
  if (host.includes('/')) return 'a host is a bare hostname without a path: the key is added to every path on that host';
  if (host.includes('*')) return 'wildcards are not accepted: the key is added only to a host named exactly, so every host must be listed';
  if (host.includes('[') || host.includes(':')) {
    return 'a host is a bare hostname without a port and never an IPv6 address: ctx.fetch compares the hostname only';
  }
  if (host.length > 253) return 'a hostname is at most 253 characters';
  const labels = host.split('.');
  // A top-level label is never all digits, so this refuses every IPv4 literal and its decimal,
  // octal and hex spellings that DNS resolvers also accept.
  if (/^[0-9]+$/.test(labels[labels.length - 1] ?? '') || /^0x[0-9a-f]+$/.test(labels[labels.length - 1] ?? '')) {
    return 'an IP address is not accepted: name the service by its hostname, which is what the owner reads before adding the provider';
  }
  if (!labels.every(l => HOST_LABEL.test(l))) {
    return 'a hostname has only lowercase letters, digits, hyphens and dots between non-empty labels';
  }
  return null;
}

/**
 * Read a host field's value: one hostname, or one IPv4 address in its canonical form, with an
 * optional `:port` that is kept in the value and left out of the allowlist (ctx.fetch compares the
 * hostname only). An empty string is "not set". The installer typed this value, so an IPv4 address
 * is accepted here, unlike in a manifest's `hosts`, where the author names a public service.
 */
export function parseHostFieldValue(raw: unknown):
  { ok: true; value: string; host: string | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined) return { ok: true, value: '', host: null };
  if (typeof raw !== 'string') return { ok: false, message: 'a host field holds one hostname as text, e.g. wazuh.example.com or wazuh.example.com:9200' };
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: true, value: '', host: null };
  if (/[\s,;]/.test(value)) return { ok: false, message: `"${raw}" names more than one thing: a host field holds one hostname` };
  if (value.includes('://')) return { ok: false, message: `"${raw}" has a scheme: write the hostname only, e.g. wazuh.example.com, not https://wazuh.example.com` };
  if (value.includes('/')) return { ok: false, message: `"${raw}" has a path: write the hostname only; the extension adds the path itself` };
  if (value.includes('*')) return { ok: false, message: `"${raw}" has a wildcard: a host field names exactly one host` };
  if (value.includes('[') || (value.match(/:/g) ?? []).length > 1) {
    return { ok: false, message: `"${raw}" is an IPv6 address: a host field takes a hostname or an IPv4 address` };
  }
  const [host, port] = value.split(':') as [string, string | undefined];
  if (port !== undefined && !(/^[1-9]\d{0,4}$/.test(port) && Number(port) <= 65535)) {
    return { ok: false, message: `"${raw}" has a port that is not a number from 1 to 65535` };
  }
  if (IPV4.test(host)) return { ok: true, value, host };
  const why = hostRefusal(host);
  if (why) return { ok: false, message: `"${raw}": ${why}` };
  return { ok: true, value, host };
}

/** The manifest-declared value of a config entry: a descriptor's `default`, or a plain scalar. Undefined when none. */
function declaredValueOf(entry: unknown): unknown {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    return 'default' in (entry as Record<string, unknown>) ? (entry as Record<string, unknown>).default : undefined;
  }
  return entry;
}

/**
 * Validate a manifest's `network:` block. `hosts` is the author's fixed list; `host_fields` is a map
 * of config field name to `required` or `optional`. Either may be absent, not both. Each host field
 * must be a non-secret field of the manifest's own `config:`, and a value it declares there must be a
 * valid host. Undefined `network` declares nothing (any public address, as before).
 */
export function parseNetworkDeclaration(
  network: unknown,
  capabilityList: readonly string[] | undefined,
  manifestConfig: Record<string, unknown> | undefined,
  secretKeys: readonly string[],
): { ok: true; hosts?: string[]; hostFields?: NetworkHostField[] } | { ok: false; message: string } {
  if (network === undefined) return { ok: true };
  const shape = 'network must be a map with a hosts list, a host_fields map, or both, and nothing else, '
    + 'e.g. network: { hosts: [api.example.com], host_fields: { WAZUH_HOST: optional } }';
  if (!network || typeof network !== 'object' || Array.isArray(network)) return { ok: false, message: shape };
  const n = network as Record<string, unknown>;
  if ('hostFields' in n) {
    return { ok: false, message: 'network.hostFields is spelled host_fields, and it is a map of config field to required or optional, e.g. host_fields: { WAZUH_HOST: optional }' };
  }
  const extra = Object.keys(n).filter(k => k !== 'hosts' && k !== 'host_fields');
  if (extra.length || (n.hosts === undefined && n.host_fields === undefined)) return { ok: false, message: shape };

  let hosts: string[] | undefined;
  if (n.hosts !== undefined) {
    const raw = n.hosts;
    if (!Array.isArray(raw) || raw.length === 0 || raw.some(h => typeof h !== 'string')) return { ok: false, message: shape };
    for (const h of raw as string[]) {
      const why = hostRefusal(h.toLowerCase());
      if (why) return { ok: false, message: `network.hosts "${h}": ${why}` };
    }
    hosts = [...new Set((raw as string[]).map(h => h.toLowerCase()))].sort();
  }

  let hostFields: NetworkHostField[] | undefined;
  if (n.host_fields !== undefined) {
    const raw = n.host_fields;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length === 0) {
      return { ok: false, message: 'network.host_fields must be a map of config field to required or optional, e.g. host_fields: { WAZUH_HOST: optional }' };
    }
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > MAX_HOST_FIELDS) return { ok: false, message: `network.host_fields names ${entries.length} fields; the most is ${MAX_HOST_FIELDS}` };
    hostFields = [];
    for (const [field, mode] of entries) {
      if (mode !== 'required' && mode !== 'optional') {
        return { ok: false, message: `network.host_fields.${field} must be required or optional` };
      }
      if (!manifestConfig || !(field in manifestConfig)) {
        return { ok: false, message: `network.host_fields names ${field}, which is not a field of this manifest's config:. Declare it there, e.g. config: { ${field}: { description: "The address of …" } }` };
      }
      if (secretKeys.includes(field)) {
        return { ok: false, message: `network.host_fields names ${field}, which is a secret field. A host is shown to the installer, so a host field is never secret` };
      }
      const declared = declaredValueOf(manifestConfig[field]);
      if (declared !== undefined) {
        const parsed = parseHostFieldValue(declared);
        if (!parsed.ok) return { ok: false, message: `config.${field} is a host field, and its value ${parsed.message}` };
      }
      hostFields.push({ field, required: mode === 'required' });
    }
    hostFields.sort((a, b) => a.field.localeCompare(b.field));
  }

  if (capabilityList && !capabilityList.includes('network')) {
    return { ok: false, message: 'network names hosts, and capabilities does not include network. Add network to capabilities, or remove network.' };
  }
  return { ok: true, ...(hosts ? { hosts } : {}), ...(hostFields ? { hostFields } : {}) };
}

/**
 * A new build of an installed extension, with each host field set to the host the install already
 * holds. A host is the owner's answer for THIS install, so an in-place update (a redeploy, an upload,
 * an operator's reinstall) keeps it, as a package update does through mergeExtensionConfig. A field
 * the install has no valid host for keeps the new build's value. Returns a new object.
 */
export function carryHostFieldValues(
  next: Record<string, unknown> | undefined, previous: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out = { ...(next ?? {}) };
  for (const { field } of hostFieldsOf(out)) {
    const held = parseHostFieldValue(previous?.[field]);
    if (held.ok && held.host) out[field] = held.value;
  }
  return out;
}

/** The host fields an installed record declares, or [] when its manifest named none. */
export function hostFieldsOf(config: Record<string, unknown> | undefined): NetworkHostField[] {
  const raw = config?.[NETWORK_HOST_FIELDS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is NetworkHostField =>
    !!f && typeof f === 'object' && typeof (f as NetworkHostField).field === 'string' && typeof (f as NetworkHostField).required === 'boolean');
}
