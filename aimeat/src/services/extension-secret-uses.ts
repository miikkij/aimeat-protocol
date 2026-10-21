/**
 * @file src/services/extension-secret-uses.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The manifest's `uses_secrets:` block: which of the caller's vault secrets an extension
 *   names in `{{secret:NAME}}`, the hosts it sends each one to, and why. Stored on the record's config
 *   under a __-prefixed key, so it is public with the extension the way its source is, and no
 *   `config:` block can write it.
 *
 *   WHY. A vault secret stored without a host is bound to the host of its first use. Through the
 *   owner's own extension, a first use to a host the manifest declares for that secret, by code a
 *   trusted principal wrote, binds by itself (services/extension-secret-authority.ts), so the owner's
 *   apps, chat connector and schedules keep working without the owner signed in. Anything else asks
 *   the owner (services/secret-approvals.ts), and the question quotes `why`. Declaring is transparency
 *   in the data-map sense: a reader of the extension sees where a person's key goes before running it.
 *
 *   A leaf module: the manifest builder, the first-use decision, the approval request and the
 *   extension's public read import it.
 * @structure USES_SECRETS_KEY · SecretUse · parseUsesSecrets() · usesSecretsOf() · declaredUse() ·
 *   hostCovers() · declaredHostsFor() · declaresHost()
 * @usage
 *   const uses = parseUsesSecrets(manifest.uses_secrets);   // { ok, uses } | { ok: false, message }
 *   const use = declaredUse(ext.config, 'STRIPE_KEY');       // { name, hosts, why } | null
 * @version-history
 *   v1.1.0 — 2026-10-21 — A declared host without a port covers every port of that host; the
 *     manifest's `network:` hosts count as declared for every secret (declaredHostsFor).
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10, v58 and v59 follow-up).
 */
import { normalizeSecretHost, SECRET_NAME_RE } from './owner-secrets.js';
import { capabilitiesOfRecord } from './extension-capability-declaration.js';

/** Where `uses_secrets` is stored on the record's config. __-prefixed, so `config:` cannot set it. */
export const USES_SECRETS_KEY = '__usesSecrets';

/** One declared use: the secret's name, the hosts it goes to (`host[:port]`), and why. */
export interface SecretUse { name: string; hosts: string[]; why: string }

const MAX_USES = 20;
const MAX_HOSTS = 10;
const MAX_WHY = 300;

/**
 * Validate `uses_secrets` as the manifest wrote it. Absent is fine and declares nothing. Each entry
 * is `{ name, hosts: [host or host:port, …], why }`; a host is written as the vault stores one (no
 * scheme, no path), because the comparison with the call's host is exact.
 */
export function parseUsesSecrets(raw: unknown): { ok: true; uses: SecretUse[] } | { ok: false; message: string } {
    if (raw === undefined || raw === null) return { ok: true, uses: [] };
    if (!Array.isArray(raw)) return { ok: false, message: 'uses_secrets must be a list of { name, hosts, why }' };
    if (raw.length > MAX_USES) return { ok: false, message: `uses_secrets may name at most ${MAX_USES} secrets` };
    const uses: SecretUse[] = [];
    for (const [i, entry] of raw.entries()) {
        const e = entry as Record<string, unknown> | null;
        const at = `uses_secrets[${i}]`;
        if (!e || typeof e !== 'object') return { ok: false, message: `${at} must be { name, hosts, why }` };
        if (typeof e.name !== 'string' || !SECRET_NAME_RE.test(e.name)) {
            return { ok: false, message: `${at}.name must be a secret name: letters, digits, underscore and hyphen, 1 to 64 characters` };
        }
        if (uses.some(u => u.name === e.name)) return { ok: false, message: `${at}.name ${e.name} is declared twice` };
        if (!Array.isArray(e.hosts) || e.hosts.length === 0 || e.hosts.length > MAX_HOSTS) {
            return { ok: false, message: `${at}.hosts must list 1 to ${MAX_HOSTS} hosts the secret is sent to` };
        }
        const hosts: string[] = [];
        for (const h of e.hosts) {
            const host = normalizeSecretHost(h);
            if (!host) {
                return { ok: false, message: `${at}.hosts: "${String(h)}" is not a host. Write it as api.example.com or api.example.com:8443, with no https:// and no path` };
            }
            if (!hosts.includes(host)) hosts.push(host);
        }
        if (typeof e.why !== 'string' || !e.why.trim()) {
            return { ok: false, message: `${at}.why must say in one sentence what the secret is used for; the owner reads it when asked to allow the use` };
        }
        uses.push({ name: e.name, hosts, why: e.why.trim().slice(0, MAX_WHY) });
    }
    return { ok: true, uses };
}

/** The declared uses stored on a record's config, or none. */
export function usesSecretsOf(config: Record<string, unknown> | undefined): SecretUse[] {
    const raw = config?.[USES_SECRETS_KEY];
    return Array.isArray(raw) ? raw.filter((u): u is SecretUse =>
        !!u && typeof u === 'object' && typeof (u as SecretUse).name === 'string' && Array.isArray((u as SecretUse).hosts)) : [];
}

/** The declaration for one secret, or null when the extension declared none for it. */
export function declaredUse(config: Record<string, unknown> | undefined, secretName: string): SecretUse | null {
    return usesSecretsOf(config).find(u => u.name === secretName) ?? null;
}

/**
 * Does a declared host cover the host a call goes to (`host[:port]`)? As living-hooks matches its
 * allowlist: the hostname, with the port ignored, unless the declaration names a port, which must
 * then match too. So `localhost` covers `localhost:40600`, and `api.example.com:8443` covers only
 * port 8443.
 */
export function hostCovers(declared: string, host: string): boolean {
    const d = declared.toLowerCase();
    const h = host.toLowerCase();
    if (d === h) return true;
    if (d.includes(':')) return false;
    const hostname = URL.canParse(`http://${h}`) ? new URL(`http://${h}`).hostname : '';
    return !!hostname && hostname === d;
}

/**
 * The hosts an extension declares for one secret: its `uses_secrets` entry for that name, and the
 * hosts its manifest's `network:` lets ctx.fetch reach (`network.hosts`, plus each host field's
 * current value on this install), which count for every secret it names (2026-10-21). Empty when it
 * declares neither, and then a first use asks the owner.
 */
export function declaredHostsFor(config: Record<string, unknown> | undefined, secretName: string): string[] {
    const network = capabilitiesOfRecord({ config, actions: [] }).hosts ?? [];
    return [...(declaredUse(config, secretName)?.hosts ?? []), ...network];
}

/** Whether the extension declares `host` for `secretName`, by either declaration. */
export function declaresHost(config: Record<string, unknown> | undefined, secretName: string, host: string): boolean {
    return declaredHostsFor(config, secretName).some(d => hostCovers(d, host));
}
