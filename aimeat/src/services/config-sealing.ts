/**
 * @file src/services/config-sealing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one home for sealed configuration: settings the party who STARTED this node
 *   nominated as read-only, for a node that one party runs on behalf of another.
 *
 *   WHY IT EXISTS. A node has exactly one authority over its settings, the `operator` role, and that
 *   is correct whenever the person who runs the machine and the person who operates the node are the
 *   same person. Whenever they are not (a hosting provider, a university running one node per
 *   department, a company running one per team) there is a set of settings the second party must be
 *   able to READ and must not be able to CHANGE: quotas, rate limits, whether metrics are collected,
 *   how far a federated request may relay. Every one of those fields is `immutable: false`, so
 *   `PUT /v1/admin/config` moves it, persists it, and `applyConfigOverrides()` re-applies the
 *   persisted value at the next boot. The change therefore survives a restart and an image swap: an
 *   operator can raise the ceilings their host set, permanently, and switch off the metrics that
 *   would show it. Marking those fields immutable upstream is not the fix, because on an ordinary
 *   self-hosted node the operator legitimately owns all of them.
 *
 *   WHY THE ENVIRONMENT AND NOT A ROLE. The alternative was a `fleet-owner` role above `operator`,
 *   which adds a principal type, an authentication path and a credential that has to reach every
 *   node. This encodes the trust boundary the deployment already has: whoever starts the process
 *   decides, and nothing inside the process can argue, because the decision was never stored
 *   anywhere the process can write. There is no door to escalate through, sealed or otherwise.
 *
 *   ONLY THE NAMES come from AIMEAT_SEALED_CONFIG_KEYS. The values come from the ordinary AIMEAT_*
 *   variables they already had. A seal says "this path holds what boot decided", and boot decides
 *   from env, file and CLI as it always has.
 *
 *   AN UNKNOWN PATH REFUSES THE BOOT. The alternative is a node that boots looking sealed and is
 *   not, which no log line and no test would ever report. A deploy-time failure is loud, cheap, and
 *   lands in front of the party that made the typo.
 *
 *   ITS OWN FILE, and the config FIELD lives here too rather than in config-types.ts, which was one
 *   change away from the 800-line ceiling. Same reason config-security.ts exists, and it has a
 *   second benefit: taking `SealedConfig` rather than the whole `AimeatConfig` means nothing here
 *   imports the config types, so there is no cycle between the rule and the object it reads.
 * @structure
 *   - SealedConfig: the one field, mixed into AimeatConfig
 *   - sealedKeysFromEnv(raw): parse + validate the boot variable, throwing on an unknown path
 *   - isSealed(config, dotPath): the predicate every door asks
 *   - sealRefusal(dotPath): the single refusal sentence, so no door writes its own
 *   - sealedView(config): the sealed paths with their values, for the read doors
 * @usage
 *   import { isSealed, sealRefusal } from '../services/config-sealing.js';
 *   if (isSealed(config, path)) { const r = sealRefusal(path); ... }
 * @version-history
 *   v1.0.0 — 2026-08-18 — Initial. docs/plans/sealed-config-plan.md
 */
import { ALL_CONFIG_MAP } from './config-schema.js';

export interface SealedConfig {
  /**
   * Config dot-paths the party who STARTED this node nominated as read-only, from
   * AIMEAT_SEALED_CONFIG_KEYS at boot. Readable by the operator on every read door, refused on
   * every write door, and ignored by anything persisted inside the node. Empty on an ordinary
   * self-hosted node, where the operator legitimately owns all of these settings and behaviour is
   * byte-identical to a node that never heard of the mechanism.
   */
  sealedConfigKeys: string[];
}

/** The dot-path the seal list itself occupies, so it can never seal or unseal itself. */
export const SEALED_KEYS_PATH = 'node.sealed_config_keys';

/**
 * Parse AIMEAT_SEALED_CONFIG_KEYS into the list a node runs with.
 *
 * Throws on a name that is not a known dot-path: see the header. A path that is ALREADY immutable is
 * a redundant no-op rather than a mistake, so it is kept and left to the caller to mention.
 */
export function sealedKeysFromEnv(raw: string | undefined): string[] {
    const keys = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const unknown = keys.filter(k => !(k in ALL_CONFIG_MAP));
    if (unknown.length > 0) {
        throw new Error(
            `AIMEAT_SEALED_CONFIG_KEYS names ${unknown.length} setting(s) this node does not have: ${unknown.join(', ')}. `
            + 'Every entry must be a config dot-path (for example quota.memory_mb or rate_limits.global). '
            + 'Refusing to start, because a node that boots with a mistyped seal looks sealed and is not.',
        );
    }
    // Sealing the seal list would be circular and sealing an already-immutable path does nothing;
    // both are dropped rather than refused, so a host can pass one list to every node it runs.
    return [...new Set(keys)].filter(k => k !== SEALED_KEYS_PATH && !ALL_CONFIG_MAP[k].immutable);
}

/** Is this setting one the node's host nominated as read-only? */
export function isSealed(config: SealedConfig, dotPath: string): boolean {
    return config.sealedConfigKeys.includes(dotPath);
}

/** True when this node seals anything at all. Unset means every door behaves exactly as before. */
export function hasSealedKeys(config: SealedConfig): boolean {
    return config.sealedConfigKeys.length > 0;
}

/**
 * The refusal, written once.
 *
 * The person reading it is a customer looking at their own admin screen, so it says who set the
 * value and that they can still see it. "403" on its own reads as a bug in our software.
 */
export function sealRefusal(dotPath: string): { code: string; message: string } {
    return {
        code: 'SEALED_CONFIG',
        message: `${dotPath} is set by whoever runs this node and cannot be changed here. `
            + 'The value is shown so you can see what it is.',
    };
}

/** The sealed settings with their values, for a read door that shows a subset of the config. */
export function sealedView(config: SealedConfig): Array<{ path: string; value: unknown; description: string }> {
    return config.sealedConfigKeys.map(path => ({
        path,
        value: (config as unknown as Record<string, unknown>)[ALL_CONFIG_MAP[path].key],
        description: ALL_CONFIG_MAP[path].description,
    }));
}
