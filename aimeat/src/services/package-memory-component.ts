/**
 * @file src/services/package-memory-component.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a package's `memory` component writes, read the one way the registrar reads it,
 *   and which of those keys the node itself reads and trusts.
 *
 *   A memory component names its own keys, and they land in the namespace of whoever installs the
 *   package, not of its author. So a package, which is somebody else's content, must not write a key
 *   the node reads and acts on (utils/reserved-keys.ts): the address a decrypted AI key is sent to,
 *   the spend cap, a payout address. The memory door refuses those keys to everything but the
 *   owner's own hand, and pressing install is not the owner writing them. Each door that registers a
 *   component asks reservedKeysInComponent() for every component before it writes anything.
 * @structure MemoryComponentEntry · memoryComponentEntries(content, registeredAs) ·
 *   reservedKeysInComponent(type, content, registeredAs) · reservedComponentMessage(componentId, keys)
 * @usage
 *   const reserved = reservedKeysInComponent(comp.type, comp.content, registeredAs);
 *   if (reserved.length > 0) return refusal;   // before the first write
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial. The parse moved here unchanged from component-registrar.ts, so the
 *     check and the write read the same entries.
 */
import type { PackageComponentType } from '../storage/interface.js';
import { isReservedServerKey } from '../utils/reserved-keys.js';

export interface MemoryComponentEntry { key: string; value: unknown; visibility?: string; tags?: string[] }

/**
 * The entries a `memory` component writes. The content is JSON `{ entries: [{ key, value,
 * visibility?, tags? }] }`. JSON with no `entries` is stored whole under the component's registered
 * name, and text that is not JSON is stored as that string under the same name. JSON `null` throws,
 * as it always did in the registrar, and `entries` comes back unchecked, as it always did.
 */
export function memoryComponentEntries(content: string, registeredAs: string): MemoryComponentEntry[] {
    let parsed: { entries?: MemoryComponentEntry[] };
    try { parsed = JSON.parse(content); }
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    catch { parsed = { entries: [{ key: registeredAs, value: content }] }; }
    return parsed.entries ?? [{ key: registeredAs, value: parsed }];
}

/**
 * The keys this component would write that the node itself reads and trusts. Empty for every other
 * component type, and for a body the registrar cannot read as a list of entries: that refusal is the
 * registrar's to give, with its own reason.
 */
export function reservedKeysInComponent(type: PackageComponentType, content: string, registeredAs: string): string[] {
    if (type !== 'memory') return [];
    let entries: unknown;
    // eslint-disable-next-line aimeat/no-silent-catch -- a body the registrar cannot read is refused there, with its own reason
    try { entries = memoryComponentEntries(content, registeredAs); } catch { return []; }
    if (!Array.isArray(entries)) return [];
    return entries
        .map(e => (e && typeof e === 'object' ? (e as { key?: unknown }).key : undefined))
        .filter((k): k is string => typeof k === 'string' && isReservedServerKey(k));
}

/** The refusal, worded once for the three doors that give it: which component, and which keys. */
export function reservedComponentMessage(componentId: string, keys: string[]): string {
    const named = keys.map(k => `"${k}"`).join(', ');
    return `Component "${componentId}" would write ${named}. This node reads ${keys.length === 1 ? 'that key' : 'those keys'} `
        + 'to decide what it does, so a package cannot write them for the account that installs it.';
}
