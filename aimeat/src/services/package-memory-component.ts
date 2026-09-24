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
 *
 *   The keys land in the OWNER's namespace whoever presses install, so the writing itself costs what
 *   the memory door asks for a write into it: memoryComponentWriteRefusal(), asked by the same doors
 *   at the same moment.
 * @structure MemoryComponentEntry · memoryComponentEntries(content, registeredAs) ·
 *   reservedKeysInComponent(type, content, registeredAs) · reservedComponentMessage(componentId, keys) ·
 *   ComponentWriteCaller · memoryComponentWriteRefusal(components, caller, ownerGhii)
 * @usage
 *   const reserved = reservedKeysInComponent(comp.type, comp.content, registeredAs);
 *   if (reserved.length > 0) return refusal;   // before the first write
 * @version-history
 *   v1.1.0 — 2026-09-24 — memoryComponentWriteRefusal: an agent or an app grant registering a memory
 *     or translation component answers for memory:write, and an agent also for memory:write-as-owner.
 *   v1.0.0 — 2026-09-24 — Initial. The parse moved here unchanged from component-registrar.ts, so the
 *     check and the write read the same entries.
 */
import type { PackageComponentType } from '../storage/interface.js';
import { isReservedServerKey } from '../utils/reserved-keys.js';
import { scopeIsCovered, ownerBypassesScopes, WRITE_AS_OWNER_SCOPE } from '../utils/scope-coverage.js';

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

/** Who registers the components, in the terms every install and migration door can supply. */
export interface ComponentWriteCaller {
    roles: string[];
    scopes: string[];
    federated?: boolean;
    /** The principal itself: an agent's GAII, an app grant's (which is the owner's GHII), the owner's name. */
    sub: string;
}

/**
 * What the memory door would ask of this caller before these components write into the owner's
 * namespace, or null when the caller holds it.
 *
 * A package installs under the OWNER whoever presses install, so a memory component writes there, and
 * so does a translation component (one `i18n.` record each). POST /v1/memory asks memory:write for
 * any write, and memory:write-as-owner of a principal that writes into the owner's namespace from
 * outside it (routes/memory/owner-target.ts): an agent. An app grant's own namespace IS the owner's,
 * so memory:write is its word. An ecosystem app writes only into its own namespace, so it is
 * refused. The owner in person passes, as at every door.
 */
export function memoryComponentWriteRefusal(
    components: Array<{ id: string; type: PackageComponentType }>,
    caller: ComponentWriteCaller,
    ownerGhii: string,
): { status: 403; code: 'SCOPE_DENIED' | 'FORBIDDEN'; message: string } | null {
    const memory = components.find(c => c.type === 'memory' || c.type === 'translation');
    if (!memory || ownerBypassesScopes(caller)) return null;
    if (caller.roles.includes('ecosystem')) {
        return {
            status: 403, code: 'FORBIDDEN',
            message: `Component "${memory.id}" writes into the owner's memory, and an ecosystem app writes only into its own.`,
        };
    }
    const needed = caller.sub === ownerGhii ? ['memory:write'] : ['memory:write', WRITE_AS_OWNER_SCOPE];
    const missing = needed.filter(s => !scopeIsCovered(caller.scopes, s));
    if (missing.length === 0) return null;
    return {
        status: 403, code: 'SCOPE_DENIED',
        message: `Component "${memory.id}" writes into the owner's memory, which needs ${missing.map(s => `"${s}"`).join(' and ')}, `
            + `and this session does not carry ${missing.length === 1 ? 'it' : 'them'}. The owner grants it in the permissions of this agent or app.`,
    };
}
