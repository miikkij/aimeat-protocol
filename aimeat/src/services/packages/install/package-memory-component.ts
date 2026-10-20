/**
 * @file src/services/packages/install/package-memory-component.ts
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
 *   TWO MORE PREFIXES ARE REFUSED THE SAME WAY, for the same reason: the entry key is the package
 *   author's text, and these two prefixes are read as instructions rather than as data.
 *   - `skills.` is the installer's skill registry. A bare skill name resolves `user:<owner>/<name>`
 *     before `node:<name>`, so a record written here is served to the installer's AI as the node's
 *     own guide. A package places a skill through a `skill` component, which refuses a node
 *     built-in's name (package-skill-component.ts) and counts as code (packages:install-code).
 *   - `organism.` is an organism's shared namespace, where membership decides who writes
 *     (services/organism-namespace-access.ts), and a workspace is provisioned through its own
 *     routes rather than by a package. POST /v1/memory refuses the same key to a caller that is not
 *     an active member with write rights, and pressing install is not membership.
 *
 *   The keys land in the OWNER's namespace whoever presses install, so the writing itself costs what
 *   the memory door asks for a write into it: memoryComponentWriteRefusal(), asked by the same doors
 *   at the same moment.
 *
 *   A TRANSLATION COMPONENT IS NOT A MEMORY COMPONENT HERE. It writes one record,
 *   `i18n.<registered name>`, and the registered name is `{package}-{owner}-{shortId}-{component}`
 *   with a random short id per install (package-install.ts registeredNameFor). No other install
 *   writes that key, and nothing on the node reads the `i18n.` prefix: the registrar itself is the
 *   only reader (register, the status hash, uninstall). So it is the package copy's own key, and
 *   installing the package is the whole of the permission it needs. A memory component is the
 *   opposite: its author names the keys, and they can be any key of the owner's.
 * @structure MemoryComponentEntry · memoryComponentEntries(content, registeredAs) ·
 *   reservedKeysInComponent(type, content, registeredAs) · reservedComponentMessage(componentId, keys) ·
 *   ComponentWriteCaller · memoryWordsFor(caller, ownerGhii) ·
 *   memoryComponentWriteRefusal(components, caller, ownerGhii)
 * @usage
 *   const reserved = reservedKeysInComponent(comp.type, comp.content, registeredAs);
 *   if (reserved.length > 0) return refusal;   // before the first write
 * @version-history
 *   v1.4.0 — 2026-10-20 — A memory component may write neither `skills.` nor `organism.` keys
 *     (secaudit 2026-10, defects `component-registrar.ts:memory-component:organism-workspace-skill-
 *     key-write` and `reservedKeysInComponent:skill-registry-keys-unguarded`). A non-member owner
 *     installed a package whose entries wrote `organism.<id>.w.<ws>.skills.<name>.manifest` and
 *     `.files.SKILL.md`, and the workspace skill readers then served that text to the organism's
 *     members as their operating instructions, while POST /v1/memory refused the same key 403. A
 *     memory component also wrote `skills.<a node built-in>.*`, which a `skill` component is
 *     refused by name. WHICH OF THE TWO REMEDIES: `organism.` is refused outright rather than
 *     measured with checkOrganismNamespaceAccess against the installing principal. The check stays
 *     synchronous and caller-free, so all three registering paths (package-install.ts, this
 *     registrar including its dry run, package-migrate.ts) keep asking the one check they already
 *     ask, and the answer cannot differ between them; a workspace is provisioned through its own
 *     routes, so nothing legitimate loses a road. A package that wants to seed an organism's
 *     workspace writes it through the workspace routes after the install.
 *   v1.3.1 — 2026-10-05 — The owner test is isOwnerInPerson (utils/gaii.ts; secaudit 2026-10, C4).
 *   v1.3.0 — 2026-09-30 — A skill component costs memory:write, what POST /v1/skills asks; an
 *     ecosystem app is refused it as it is a memory component.
 *   v1.2.0 — 2026-09-25 — A translation component costs nothing beyond packages:write: its one record
 *     is the install's own key. The refusal carries the words it names as `missing`, which an install
 *     request records, and memoryWordsFor() says what the write costs each kind of caller.
 *   v1.1.0 — 2026-09-24 — memoryComponentWriteRefusal: an agent or an app grant registering a memory
 *     or translation component answers for memory:write, and an agent also for memory:write-as-owner.
 *   v1.0.0 — 2026-09-24 — Initial. The parse moved here unchanged from component-registrar.ts, so the
 *     check and the write read the same entries.
 */
import type { PackageComponentType } from '../../../storage/interface.js';
import { isReservedServerKey } from '../../../utils/reserved-keys.js';
import { scopeIsCovered, WRITE_AS_OWNER_SCOPE } from '../../../utils/scope-coverage.js';
import { isOwnerInPerson } from '../../../utils/gaii.js';

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

/** The installer's skill registry (services/skills.ts): a skill arrives through a `skill` component. */
const SKILL_REGISTRY_PREFIX = 'skills.';
/** An organism's namespace (services/organism-namespace-access.ts): membership decides who writes there. */
const ORGANISM_NAMESPACE_PREFIX = 'organism.';

/** Why one key is refused, which is what the message says and the only thing it varies on. */
type RefusedKind = 'trusted' | 'registry' | 'organism';

function refusedKind(key: string): RefusedKind | null {
    if (isReservedServerKey(key)) return 'trusted';
    if (key.startsWith(SKILL_REGISTRY_PREFIX)) return 'registry';
    if (key.startsWith(ORGANISM_NAMESPACE_PREFIX)) return 'organism';
    return null;
}

/**
 * The keys this component would write that a package may not write: one the node itself reads and
 * trusts, one in the installer's skill registry, and one in an organism's namespace (the file header
 * says why each). Empty for every other component type, and for a body the registrar cannot read as
 * a list of entries: that refusal is the registrar's to give, with its own reason.
 */
export function reservedKeysInComponent(type: PackageComponentType, content: string, registeredAs: string): string[] {
    if (type !== 'memory') return [];
    let entries: unknown;
    // eslint-disable-next-line aimeat/no-silent-catch -- a body the registrar cannot read is refused there, with its own reason
    try { entries = memoryComponentEntries(content, registeredAs); } catch { return []; }
    if (!Array.isArray(entries)) return [];
    return entries
        .map(e => (e && typeof e === 'object' ? (e as { key?: unknown }).key : undefined))
        .filter((k): k is string => typeof k === 'string' && refusedKind(k) !== null);
}

/** The refusal, worded once for the three doors that give it: which component, and which keys. */
export function reservedComponentMessage(componentId: string, keys: string[]): string {
    const named = (kind: RefusedKind) => keys.filter(k => refusedKind(k) === kind).map(k => `"${k}"`).join(', ');
    const trusted = named('trusted');
    const registry = named('registry');
    const organism = named('organism');
    const parts: string[] = [];
    if (trusted) {
        parts.push(`Component "${componentId}" would write ${trusted}. This node reads ${trusted.includes(',') ? 'those keys' : 'that key'} `
            + 'to decide what it does, so a package cannot write them for the account that installs it.');
    }
    if (registry) {
        parts.push(`Component "${componentId}" would write ${registry}, which is the skill registry of the account that installs it. `
            + 'A package adds a skill through a skill component, which is refused when it carries the name of one of this node\'s own skills.');
    }
    if (organism) {
        parts.push(`Component "${componentId}" would write ${organism}, which belongs to an organism and its members. `
            + 'Installing a package is not membership, so a package cannot write there; the workspace routes do that after the install.');
    }
    return parts.join(' ');
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
 * The words the memory door asks of this caller for a write into the owner's namespace: none for the
 * owner in person, memory:write for an app grant (its own namespace IS the owner's), and memory:write
 * plus memory:write-as-owner for a principal writing there from outside it (routes/memory/
 * owner-target.ts), which is an agent.
 */
export function memoryWordsFor(caller: ComponentWriteCaller, ownerGhii: string): string[] {
    if (isOwnerInPerson(caller)) return [];
    return caller.sub === ownerGhii ? ['memory:write'] : ['memory:write', WRITE_AS_OWNER_SCOPE];
}

/**
 * What the memory door would ask of this caller before these components write into the owner's
 * namespace, or null when the caller holds it.
 *
 * A package installs under the OWNER whoever presses install, so a memory component writes there.
 * POST /v1/memory asks memory:write for any write, and memory:write-as-owner of a principal that
 * writes into the owner's namespace from outside it: memoryWordsFor(). An ecosystem app writes only
 * into its own namespace, so it is refused, and `missing` is empty because no word would change that.
 * The owner in person passes, as at every door. A translation component costs nothing here (the file
 * header says why). A skill component writes the owner's skill registry, which POST /v1/skills
 * guards with memory:write alone, so that is what it costs.
 */
export function memoryComponentWriteRefusal(
    components: Array<{ id: string; type: PackageComponentType }>,
    caller: ComponentWriteCaller,
    ownerGhii: string,
): { status: 403; code: 'SCOPE_DENIED' | 'FORBIDDEN'; message: string; missing: string[] } | null {
    const writers = components.filter(c => c.type === 'memory' || c.type === 'skill');
    const memory = writers.find(c => c.type === 'memory') ?? writers[0];
    if (!memory || isOwnerInPerson(caller)) return null;
    if (caller.roles.includes('ecosystem')) {
        return {
            status: 403, code: 'FORBIDDEN', missing: [],
            message: `Component "${memory.id}" writes into the owner's memory, and an ecosystem app writes only into its own.`,
        };
    }
    const words = memory.type === 'memory' ? memoryWordsFor(caller, ownerGhii) : ['memory:write'];
    const missing = words.filter(s => !scopeIsCovered(caller.scopes, s));
    if (missing.length === 0) return null;
    return {
        status: 403, code: 'SCOPE_DENIED', missing,
        message: `Component "${memory.id}" writes into the owner's memory, which needs ${missing.map(s => `"${s}"`).join(' and ')}, `
            + `and this session does not carry ${missing.length === 1 ? 'it' : 'them'}. The owner grants it in the permissions of this agent or app.`,
    };
}
