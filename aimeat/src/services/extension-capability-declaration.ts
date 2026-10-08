/**
 * @file src/services/extension-capability-declaration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an extension may do beyond its own memory: reach the internet (`network`), start
 *   AI jobs billed to its installer (`ai`), send email (`email`) and buy from another provider
 *   (`payments`). The package approval shows this list and the sandbox enforces the same list, so
 *   what the owner approved is what the code can do.
 *
 *   WHY. Until 2026-10-05 the approval searched the script text for `ctx.fetch(`, `ctx.email(` and
 *   the like, and the sandbox gave every extension every capability. A script that wrote
 *   `const f = ctx.fetch`, `ctx['fe' + 'tch']` or called the raw `__fetch` global was approved as
 *   "no network" and reached the internet anyway (secaudit 2026-10, PKG-3).
 *
 *   DECLARED OR INFERRED. A manifest may say `capabilities: [network, ai]`; that list is the answer.
 *   A manifest that says nothing (every extension written before this file) gets the list inferred
 *   from its scripts by a deliberately broad word match: a script that contains the word `fetch`
 *   anywhere is taken to use the network. Over-reading is safe in both directions, because the
 *   approval then shows more and the sandbox allows what was shown; what the text does not name at
 *   all (a computed property, a decoded string) is refused.
 * @structure CAPABILITY_DECLARATION_KEY · EXTENSION_CAPABILITY_NAMES · ExtensionCapabilitySet ·
 *   parseCapabilityDeclaration(raw) · inferCapabilities(code) · capabilitiesOfRecord(record) ·
 *   capabilityNotDeclared(name)
 * @usage
 *   const caps = capabilitiesOfRecord(ext);
 *   buildExtensionCtx({ ..., capabilities: caps });
 * @version-history
 *   v1.1.0 — 2026-10-08 — `hosts` (manifest `network: { hosts }`, stored as `__networkHosts`): the only
 *     hostnames ctx.fetch reaches, checked on every redirect hop by safeFetch's allowHosts.
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, PKG-3, plan S8).
 */

/** Where the manifest's declaration is stored on the record's config. __-prefixed, so `config:` cannot set it. */
export const CAPABILITY_DECLARATION_KEY = '__capabilities';

export const EXTENSION_CAPABILITY_NAMES = ['network', 'ai', 'email', 'payments'] as const;
export type ExtensionCapabilityName = typeof EXTENSION_CAPABILITY_NAMES[number];

/** Where the manifest's `network: { hosts }` is stored on the record's config. __-prefixed, like the list. */
export const NETWORK_HOSTS_KEY = '__networkHosts';

/**
 * The four capabilities, and whether the manifest declared them (true) or the node inferred them
 * (false). `hosts`, when the manifest named them, is the only hostnames ctx.fetch may reach, on
 * every redirect hop too; absent means any public address, as before.
 */
export type ExtensionCapabilitySet = Record<ExtensionCapabilityName, boolean> & { declared: boolean; hosts?: string[] };

/** The manifest's `network.hosts` on an installed record, or undefined when it named none. */
function networkHostsOf(config: Record<string, unknown> | undefined): string[] | undefined {
  const raw = config?.[NETWORK_HOSTS_KEY];
  if (!Array.isArray(raw)) return undefined;
  const hosts = raw.filter((h): h is string => typeof h === 'string' && !!h).map(h => h.toLowerCase());
  return hosts.length ? hosts : undefined;
}

/** The broad word each capability is inferred from. Matching more than the call is the safe side. */
const INFERRED_FROM: Record<ExtensionCapabilityName, RegExp> = {
  network: /fetch/i,
  ai: /\bai\b|_ai_/,
  email: /email/i,
  payments: /buy/i,
};

/** Read a manifest's `capabilities:`. Undefined is "not declared"; anything else must be a list of the four names. */
export function parseCapabilityDeclaration(raw: unknown):
  { ok: true; list?: ExtensionCapabilityName[] } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true };
  if (!Array.isArray(raw) || raw.some(x => typeof x !== 'string')) {
    return { ok: false, message: `capabilities must be a list of names, e.g. capabilities: [network, ai]. The names are ${EXTENSION_CAPABILITY_NAMES.join(', ')}.` };
  }
  const unknown = (raw as string[]).filter(x => !(EXTENSION_CAPABILITY_NAMES as readonly string[]).includes(x));
  if (unknown.length) {
    return { ok: false, message: `capabilities names ${unknown.join(', ')}, which do not exist; the names are ${EXTENSION_CAPABILITY_NAMES.join(', ')}.` };
  }
  return { ok: true, list: [...new Set(raw as ExtensionCapabilityName[])].sort() };
}

/** The capabilities a script's text names, by the broad word match above. */
export function inferCapabilities(code: string): Record<ExtensionCapabilityName, boolean> {
  const out = {} as Record<ExtensionCapabilityName, boolean>;
  for (const name of EXTENSION_CAPABILITY_NAMES) out[name] = INFERRED_FROM[name].test(code);
  return out;
}

/** The capabilities an extension record has: its declaration, else what its scripts name. */
export function capabilitiesOfRecord(record: {
  config?: Record<string, unknown>; actions: Array<{ scriptContent?: string }>;
}): ExtensionCapabilitySet {
  const declared = record.config?.[CAPABILITY_DECLARATION_KEY];
  const hosts = networkHostsOf(record.config);
  if (Array.isArray(declared)) {
    const out = { declared: true } as ExtensionCapabilitySet;
    for (const name of EXTENSION_CAPABILITY_NAMES) out[name] = declared.includes(name);
    return hosts ? { ...out, hosts } : out;
  }
  const code = record.actions.map(a => a.scriptContent ?? '').join('\n');
  return { ...inferCapabilities(code), declared: false, ...(hosts ? { hosts } : {}) };
}

/** The refusal a script meets when it uses a capability its extension does not have. */
export function capabilityNotDeclared(name: ExtensionCapabilityName): Error {
  return new Error(`CAPABILITY_NOT_DECLARED: this extension may not use ${name}. Its manifest does not `
    + `declare it in capabilities: [...], and its scripts do not name it where the installer could see it.`);
}
