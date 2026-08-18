/**
 * @file src/services/app-tool-interfaces.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The PINNED INTERFACE versioning for EXCHANGE app-tool offerings (TARGET-045, Gap 1 —
 *   cross-app selling). An app owner sells a named tool (e.g. `getCompanyBrief`) as a metered offering;
 *   a consumer contracts it and integrates against its I/O SCHEMA. The problem this solves: the provider
 *   must keep improving the app WITHOUT breaking a live consumer integration bound to that interface.
 *
 *   The invention ("Pinned Interface, Versioned Provider"): the app product stays fully mutable, but each
 *   sellable interface is snapshot into an IMMUTABLE, content-addressed VERSION `{inputSchema, outputSchema,
 *   binding}`. Republishing an UNCHANGED interface is idempotent (same schemaHash → same version); changing
 *   the I/O schema or the backing binding mints a NEW version (append-only — an existing version record is
 *   never mutated). An offering pins one version; a contract (entitlement) pins the same version and the
 *   metered call routes to THAT snapshot's binding — so a provider can ship v2 freely while existing
 *   contracts keep hitting the frozen v1. Deprecation/migration is an offering-level lifecycle (re-point to
 *   the new version for NEW consumers), never a silent break.
 *
 *   NOTE: price is intentionally NOT frozen here — it is authoritative at accept time and captured into the
 *   entitlement, so a provider may reprice for new consumers while existing contracts keep their agreed price.
 *   Only the integration contract (schema + binding) is version-frozen.
 *
 *   Storage: PUBLIC memory under the provider's GHII (so consumers can read the frozen schema). Version
 *   records `apptool.iface.{hash}.v{n}` are append-only (never mutated); the `.latest` pointer is the only
 *   mutable record.
 * @structure AppToolInterface · InterfaceDef · ifaceKeyBase · ensureInterfaceVersion · getInterfaceVersion ·
 *   getLatestInterface · listInterfaceVersions
 * @usage
 *   const iface = await ensureInterfaceVersion(storage, providerGhii, appId, tool, { inputSchema, outputSchema, binding });
 *   const pinned = await getInterfaceVersion(storage, providerGhii, appId, tool, ent.surface.ifaceVersion);
 * @version-history
 *   v1.0.0 — 2026-07-21 — Initial pinned-interface versioning (append-only snapshots + latest pointer + freeze).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../storage/interface.js';

/** One frozen, content-addressed version of a sellable app-tool interface — the integration contract. */
export interface AppToolInterface {
  appId: string;            // the app filename, e.g. "exchange.html"
  ownerName: string;        // the provider owner (bare name, for display)
  tool: string;             // the tool name within the app's manifest
  ifaceVersion: number;     // 1-based, monotonic per (provider, app, tool)
  schemaHash: string;       // sha256 over {inputSchema, outputSchema, binding} — the version identity
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  /** The backing capability id invoked to fulfil a metered call. Null = unbound (agent-work path, Gap 2). */
  binding: string | null;
  createdAt: string;
}

/** The mutable, per-publish definition snapshot into a version. */
export interface InterfaceDef {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  binding: string | null;
}

const ownerNameOf = (providerGhii: string): string => providerGhii.split('@')[0].split('#').pop() ?? providerGhii;

/** Stable, prefix-scannable key base for all versions of one (provider, app, tool). Hashed because appId
 *  carries dots (`.html`) and tool names carry `.`/`-`, which would make a dotted key ambiguous to scan. */
export function ifaceKeyBase(providerGhii: string, appId: string, tool: string): string {
  const h = createHash('sha256').update(`${providerGhii}|${appId}|${tool}`).digest('hex').slice(0, 24);
  return `apptool.iface.${h}`;
}

const versionKey = (base: string, n: number): string => `${base}.v${n}`;
const latestKey = (base: string): string => `${base}.latest`;

/** The content identity of an interface: republishing an identical schema+binding is idempotent. */
function hashDef(def: InterfaceDef): string {
  const canonical = JSON.stringify({ i: def.inputSchema ?? {}, o: def.outputSchema ?? {}, b: def.binding ?? null });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * Snapshot the current sellable interface into a version, minting a NEW version only when the schema/binding
 * actually changed (else returns the existing latest — idempotent relisting). Existing version records are
 * NEVER overwritten — that immutability IS the freeze. `providerGhii` is the full provider GHII (the PUBLIC
 * owner of the snapshot records).
 */
export async function ensureInterfaceVersion(
  storage: Storage, providerGhii: string, appId: string, tool: string, def: InterfaceDef,
): Promise<AppToolInterface> {
  const base = ifaceKeyBase(providerGhii, appId, tool);
  const hash = hashDef(def);

  const latest = await getLatestInterface(storage, providerGhii, appId, tool);
  if (latest && latest.schemaHash === hash) return latest;   // unchanged → reuse the pinned version

  const nextVersion = (latest?.ifaceVersion ?? 0) + 1;
  const now = new Date().toISOString();
  const iface: AppToolInterface = {
    appId, ownerName: ownerNameOf(providerGhii), tool, ifaceVersion: nextVersion, schemaHash: hash,
    inputSchema: def.inputSchema ?? {}, outputSchema: def.outputSchema ?? {}, binding: def.binding ?? null,
    createdAt: now,
  };
  await storage.setMemory({
    key: versionKey(base, nextVersion), ownerGaii: providerGhii, value: iface,
    visibility: 'public', tags: ['apptool-interface'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
  await storage.setMemory({
    key: latestKey(base), ownerGaii: providerGhii, value: { version: nextVersion, updatedAt: now },
    visibility: 'public', tags: ['apptool-interface-latest'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
  return iface;
}

/** One frozen interface version, or null. */
export async function getInterfaceVersion(
  storage: Storage, providerGhii: string, appId: string, tool: string, version: number,
): Promise<AppToolInterface | null> {
  const base = ifaceKeyBase(providerGhii, appId, tool);
  const rec = await storage.getMemory(providerGhii, versionKey(base, version));
  return rec ? (rec.value as AppToolInterface) : null;
}

/** The current (highest) interface version, or null if the tool was never snapshot. */
export async function getLatestInterface(
  storage: Storage, providerGhii: string, appId: string, tool: string,
): Promise<AppToolInterface | null> {
  const base = ifaceKeyBase(providerGhii, appId, tool);
  const ptr = await storage.getMemory(providerGhii, latestKey(base));
  const version = (ptr?.value as { version?: number } | undefined)?.version;
  if (!version) return null;
  const rec = await storage.getMemory(providerGhii, versionKey(base, version));
  return rec ? (rec.value as AppToolInterface) : null;
}

/** Every snapshot version for a tool, oldest first (for the provider console's version history). */
export async function listInterfaceVersions(
  storage: Storage, providerGhii: string, appId: string, tool: string,
): Promise<AppToolInterface[]> {
  const base = ifaceKeyBase(providerGhii, appId, tool);
  const { items } = await storage.listAllMemory({ prefix: `${base}.v`, limit: 500 });
  return items
    .map(r => r.value as AppToolInterface)
    .filter(v => v && typeof v.ifaceVersion === 'number')
    .sort((a, b) => a.ifaceVersion - b.ifaceVersion);
}
