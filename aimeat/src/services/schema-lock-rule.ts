/**
 * @file src/services/schema-lock-rule.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may set a schema lock on which key pattern, asked by every code path that sets
 *   one for a caller: PUT /v1/memory/:key/schema and a cortex activation (REST, upsert, MCP).
 *
 *   A lock is found by its key pattern alone (storage.findApplicableSchema), so it governs every
 *   account's writes to a matching key (Core 6.6). Until 2026-10-16 any account holder could set one
 *   on any pattern, which let one account:
 *     - lock every key on the node with a pattern that starts with a wildcard (`**` matches every
 *       key, and a wildcard lock outranks a plain prefix lock);
 *     - lock another organism's or another workspace's records with its own schema;
 *     - put an exact lock beside another principal's prefix lock on the same key, and so replace
 *       that principal's schema for the key, or remove both rows with one delete (DATA-15);
 *     - replace a system-seeded schema for one key with a more specific lock of its own.
 *   A cortex activation wrote its locks with no check at all, over another principal's lock, and
 *   its deactivation deleted whatever was stored under the pattern.
 *
 *   THE RULE (QA audit 2026-10-16, S2-04 · F05a-01 · S7-01):
 *     1. A pattern whose reach is the whole node is the operator's: one that starts with a wildcard,
 *        and the trailing-star form (`name:*`) unless it names a key family that ends with `:`.
 *     2. A pattern under `organism.<id>.` is set by whoever may write that organism's meta
 *        namespace (an organism admin or creator), a workspace's meta namespace (its creator or an
 *        organism admin) or the member's own namespace (that member), asked with the same rule the
 *        memory write asks (services/organism-namespace-access.ts). A wildcard organism or
 *        workspace id is the operator's.
 *     3. A lock that another account holds on the same pattern, under the other `apply_to`, is not
 *        shadowed by a lock beside it.
 *     4. A key that another account's lock already governs is not taken over with a more specific
 *        lock. A wildcard pattern also counts as taking over every key it shares with another
 *        account's lock that it outranks: the lookup ranks a wildcard prefix lock above every plain
 *        prefix lock, and above a wildcard lock of fewer segments, so `family.*.*` would govern the
 *        keys of another account's `family.italian` (secaudit2026nov08 round 14).
 *     5. A key under `csm.` holds a registered CSM's structure (services/csm-service.ts reads the lock
 *        at `csm.<name>` as the CSM's schema). Only the account that registered the CSM, or for a
 *        name nobody registered yet the account whose name the CSM name starts with, may lock it;
 *        a pattern over every CSM is the operator's (secaudit2026nov08 round 14). "Registered" means
 *        the registering account, not a later account of an erased author's name (round 15), and the
 *        prefix row at a CSM's own key is removed only by those who may set it (csmLockRemovalRefusal).
 *   The operator passes 3 and 4 through the operator override, which writes the operator trail.
 *   A plain key family (`notes`, `recipes`) stays lockable by any account holder: Core 6.6 says an
 *   owner can lock a key or a key prefix, and the first account to lock a family holds it.
 * @structure SchemaLockCaller · SchemaLockRefusal · csmsReachedBy() · csmLockRemovalRefusal() ·
 *   schemaPatternRefusal() · schemaLockRefusal() · wildcardTakesOver()
 * @usage
 *   const refusal = await schemaLockRefusal({ storage, config }, caller, key, applyTo, ownerOf => operatorPass(ownerOf));
 *   if (refusal) return res.status(refusal.status).json(error(nodeId, refusal.code, refusal.message, refusal.status, refusal.details));
 * @version-history
 *   2026-11-08 — Rule 5 asks isRegisteringAccount (services/csm/readers.ts), so a later account of an
 *     erased author's name no longer locks that author's CSM; a CSM the caller may not read gives the
 *     reason a name nobody registered gets; csmLockRemovalRefusal keeps a CSM's own lock row from being
 *     removed by a holder that is not its registering account (secaudit2026nov08b round 15:
 *     csm-family-decided-by-name-not-registering-account, memory-write-violations-describe-unreadable-csm-lock, D1).
 *   2026-11-08 — Rule 4 also refuses a wildcard pattern that outranks another account's lock on keys
 *     both reach, and rule 5 reserves the `csm.` lock family to each CSM's registering account
 *     (secaudit2026nov08 round 14: rule4-literal-key-vs-wildcard-ranking,
 *     lockSchema-keeps-foreign-lock-holder).
 *   2026-10-16 — Initial (QA audit S2-04, F05a-01, S7-01).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, SchemaRecord, CsmRecord } from '../storage/interface.js';
import { checkOrganismNamespaceAccess, type OrganismAccessCaller } from './organism-namespace-access.js';
import { isOwnersLock } from './packages/compose/package-component-collisions.js';
import { isRegisteringAccount, csmMayReadAs } from './csm/readers.js';

/** What rule 5 answers, on PUT and on DELETE alike. */
const CSM_FAMILY_MESSAGE = 'Keys under "csm." carry the structure of a registered CSM, so only the account that registered it, its agents, or whoever runs the node can lock them. Change your own CSM with PUT /v1/csm/{name}; the name of a CSM of yours starts with your account name and a dot.';

/** The caller of a lock write, in the terms the organism rule speaks, plus the operator answer. */
export interface SchemaLockCaller extends OrganismAccessCaller {
    /** The operator in person, or the operator's agent holding operator:admin (isOperatorCaller). */
    isOperator: boolean;
}

export interface SchemaLockRefusal {
    status: number;
    code: 'SCHEMA_PATTERN_NODE_WIDE' | 'SCHEMA_PATTERN_NOT_YOURS' | 'SCHEMA_LOCKED_BY_OTHER';
    message: string;
    details?: Record<string, unknown>;
}

/** A key-pattern segment that matches more than one value (storage/pattern-utils.ts). */
const WILDCARD = /\*/;

/** The key that stands for "this organism namespace's meta" in the organism rule, or a refusal. */
function organismProbe(keyPattern: string): { probe: string } | { operatorOnly: true } | null {
    const parts = keyPattern.split('.');
    if (parts[0] !== 'organism') return null;
    const org = parts[1];
    if (!org || WILDCARD.test(org)) return { operatorOnly: true };
    const sub = parts[2];
    const id = parts[3];
    if (sub === 'w' && id && !WILDCARD.test(id)) return { probe: `organism.${org}.w.${id}.meta._schema_lock` };
    if (sub === 'member' && id && !WILDCARD.test(id)) return { probe: `organism.${org}.member.${id}._schema_lock` };
    return { probe: `organism.${org}.meta._schema_lock` };
}

/** Whether the pattern reaches every key of the node, or every key that starts with a few letters. */
function reachesWholeNode(keyPattern: string): boolean {
    if (keyPattern.startsWith('*')) return true;
    // The trailing-star form ('chart:*') matches every key that starts with its literal part
    // (storage/pattern-utils.ts). Every cortex pack names a key family that ends with ':'; a literal
    // without it ('a*', 'organism*') reaches keys of every family that starts with those letters.
    const star = keyPattern.indexOf('*');
    if (star > 0 && star === keyPattern.length - 1 && keyPattern[star - 1] !== '.') {
        const literal = keyPattern.slice(0, -1);
        return !(literal.length > 1 && literal.endsWith(':'));
    }
    return false;
}

/**
 * A key pattern as the lock lookup reads it (storage/pattern-utils.ts matchWildcardPattern): the
 * trailing-star form is a text prefix, every other pattern a list of dot-segments in which `*` is
 * one segment and `**` one or more to the end.
 */
type PatternShape = { glued: string } | { parts: string[] };

function shapeOf(pattern: string): PatternShape {
    const star = pattern.indexOf('*');
    if (star > 0 && star === pattern.length - 1 && pattern[star - 1] !== '.') return { glued: pattern.slice(0, -1) };
    return { parts: pattern.split('.') };
}

/** Whether some key matches both segment lists. */
function partsMeet(a: string[], b: string[], i = 0, j = 0): boolean {
    if (i < a.length && a[i] === '**') return j < b.length;
    if (j < b.length && b[j] === '**') return i < a.length;
    if (i === a.length || j === b.length) return i === a.length && j === b.length;
    if (a[i] === '*' || b[j] === '*' || a[i] === b[j]) return partsMeet(a, b, i + 1, j + 1);
    return false;
}

/** The text every key of a segment pattern starts with, and whether the key goes on past it. */
function leadOf(parts: string[]): { lead: string; more: boolean } {
    const i = parts.findIndex(p => p === '*' || p === '**');
    if (i < 0) return { lead: parts.join('.'), more: false };
    return { lead: i > 0 ? `${parts.slice(0, i).join('.')}.` : '', more: true };
}

/** Whether some key matches both patterns. Errs towards yes on the trailing-star form. */
function shapesMeet(a: PatternShape, b: PatternShape): boolean {
    if ('glued' in a && 'glued' in b) return a.glued.startsWith(b.glued) || b.glued.startsWith(a.glued);
    if ('glued' in a || 'glued' in b) {
        const glued = 'glued' in a ? a.glued : (b as { glued: string }).glued;
        const { lead, more } = leadOf('parts' in a ? a.parts : (b as { parts: string[] }).parts);
        return more ? lead.startsWith(glued) || glued.startsWith(lead) : lead.startsWith(glued);
    }
    return partsMeet(a.parts, b.parts);
}

/**
 * Whether a new wildcard prefix lock on `pattern` would govern a key that `other` governs today.
 * storage findApplicableSchema answers an exact lock first, then the matching wildcard prefix lock
 * with the most segments, then the longest plain prefix: so the new lock wins every key it shares
 * with a plain prefix lock, and with a wildcard lock of no more segments than its own.
 */
export function wildcardTakesOver(pattern: string, other: Pick<SchemaRecord, 'keyPattern' | 'applyTo'>): boolean {
    if (!WILDCARD.test(pattern) || other.applyTo !== 'prefix' || other.keyPattern === pattern) return false;
    const otherIsWild = WILDCARD.test(other.keyPattern);
    if (otherIsWild && other.keyPattern.split('.').length > pattern.split('.').length) return false;
    // A plain prefix lock governs the keys below it, never its own literal key.
    const reach: PatternShape = otherIsWild ? shapeOf(other.keyPattern) : { parts: [...other.keyPattern.split('.'), '**'] };
    return shapesMeet(shapeOf(pattern), reach);
}

/**
 * Rule 5: a pattern under `csm.` is the registering account's of every CSM it reaches, or, where it
 * reaches none, the account whose name the CSM name starts with (a new CSM's name carries its
 * account's prefix, csm-service.ts ownerPrefixed). A pattern with no literal name is every CSM's.
 */
async function csmFamilyRefusal(storage: Storage, caller: SchemaLockCaller, keyPattern: string): Promise<SchemaLockRefusal | null> {
    if (keyPattern !== 'csm' && !keyPattern.startsWith('csm.')) return null;
    const segments = keyPattern === 'csm' ? [] : keyPattern.slice('csm.'.length).split('.');
    const firstWild = segments.findIndex(s => WILDCARD.test(s));
    const literal = firstWild < 0 ? segments : segments.slice(0, firstWild);
    const refusal = (reason: string): SchemaLockRefusal => ({
        status: 403, code: 'SCHEMA_PATTERN_NOT_YOURS',
        message: CSM_FAMILY_MESSAGE,
        details: { key_pattern: keyPattern, reason },
    });
    if (literal.length === 0) return refusal('every_csm');
    const reached = await csmsReachedBy(storage, keyPattern);
    if (reached.length > 0) {
        // The registering account, not any later holder of its name (round 15): the same test the CSM
        // routes ask before a change (services/csm/readers.ts isRegisteringAccount).
        const others: CsmRecord[] = [];
        for (const c of reached) if (!(await isRegisteringAccount(storage, c, caller.owner))) others.push(c);
        if (others.length === 0) return null;
        // A CSM the caller may not read answers as a missing one (ruling 2 of 2026-11-07): the reason
        // a name nobody registered gets, unless the name is the caller's own.
        let shown = false;
        for (const c of others) if (await csmMayReadAs(storage, c, { sub: caller.principal, owner: caller.owner })) { shown = true; break; }
        return refusal(shown || literal[0] === caller.owner ? 'registered_by_other' : 'another_account_name');
    }
    return literal[0] === caller.owner ? null : refusal('another_account_name');
}

/**
 * The CSMs a pattern under `csm.` reaches: those whose name is the pattern's literal part (the
 * segments before its first wildcard), starts with it, or is a prefix of it. Empty for a pattern
 * outside `csm.` and for one with no literal name (which reaches every CSM; rule 5 names it the
 * operator's).
 */
export async function csmsReachedBy(storage: Storage, keyPattern: string): Promise<CsmRecord[]> {
    if (!keyPattern.startsWith('csm.')) return [];
    const segments = keyPattern.slice('csm.'.length).split('.');
    const firstWild = segments.findIndex(s => WILDCARD.test(s));
    const literal = firstWild < 0 ? segments : segments.slice(0, firstWild);
    if (literal.length === 0) return [];
    const name = literal.join('.');
    return (await storage.listCsms()).filter(c => c.name === name || c.name.startsWith(`${name}.`) || name.startsWith(`${c.name}.`));
}

/**
 * Rule 5 on DELETE /v1/memory/:key/schema, asked after the caller is found to hold the row: the prefix
 * row at a CSM's own key (`csm.<name>`, its jsonSchemaKey) is that CSM's schema, which currentSchema
 * serves and every write under the key is checked against. Removing it takes the check off every
 * account's writes, so only the registering account, its agents and the operator remove it, as only
 * they set it. A holder that is none of them set it before round 14 or kept a name its account was
 * erased under (secaudit2026nov08b round 15, D1). Every other row stays its holder's to remove, as before:
 * removing a row beside or over a CSM's own row leaves the CSM's lock governing.
 */
export async function csmLockRemovalRefusal(
    storage: Storage, caller: SchemaLockCaller, row: Pick<SchemaRecord, 'keyPattern' | 'applyTo'>,
): Promise<SchemaLockRefusal | null> {
    if (caller.isOperator || row.applyTo !== 'prefix' || !row.keyPattern.startsWith('csm.')) return null;
    const record = await storage.getCsm(row.keyPattern.slice('csm.'.length));
    if (!record || record.jsonSchemaKey !== row.keyPattern) return null;
    if (await isRegisteringAccount(storage, record, caller.owner)) return null;
    return {
        status: 403, code: 'SCHEMA_PATTERN_NOT_YOURS',
        message: 'This lock holds the structure of a CSM that another account registered, and every write under its key is checked against it, so only that account, its agents, or whoever runs the node can remove it. Ask whoever runs the node if it should go.',
        details: { key_pattern: row.keyPattern, reason: 'registered_by_other' },
    };
}

/**
 * Rules 1, 2 and 5: whether this caller may lock this pattern at all, whatever is stored. Reads only.
 */
export async function schemaPatternRefusal(
    deps: { storage: Storage; config: AimeatConfig },
    caller: SchemaLockCaller,
    keyPattern: string,
): Promise<SchemaLockRefusal | null> {
    if (caller.isOperator) return null;
    if (reachesWholeNode(keyPattern)) {
        return {
            status: 403, code: 'SCHEMA_PATTERN_NODE_WIDE',
            message: 'A structure lock on this pattern would govern keys of every account on this node, so only whoever runs the node can set it. Lock a key family of your own, such as "notes" or "recipe:*".',
            details: { key_pattern: keyPattern },
        };
    }
    const org = organismProbe(keyPattern);
    if (org && 'operatorOnly' in org) {
        return {
            status: 403, code: 'SCHEMA_PATTERN_NODE_WIDE',
            message: 'A structure lock on this pattern would govern every organism on this node, so only whoever runs the node can set it. Name one organism and one workspace.',
            details: { key_pattern: keyPattern },
        };
    }
    if (org) {
        const refusal = await checkOrganismNamespaceAccess(deps, caller, org.probe, 'write');
        if (refusal) {
            return {
                status: 403, code: 'SCHEMA_PATTERN_NOT_YOURS',
                message: 'Only the organism\'s admins, the workspace\'s creator, or the member whose space it is can lock the structure of these records. Ask one of them to set it.',
                details: { key_pattern: keyPattern, reason: refusal.code },
            };
        }
    }
    return csmFamilyRefusal(deps.storage, caller, keyPattern);
}

/**
 * The whole rule (1 to 4) for setting a lock on (keyPattern, applyTo). The same pattern under the
 * same apply_to is the caller's own check (DATA-15: the principal that set it, or the operator),
 * so it is left to the code path, which knows its principal. `operatorPass` is asked only when
 * rule 3 or 4 would refuse, with the holder of the lock in the way, so the operator trail is
 * written only for an override that was needed.
 */
export async function schemaLockRefusal(
    deps: { storage: Storage; config: AimeatConfig },
    caller: SchemaLockCaller,
    keyPattern: string,
    applyTo: 'exact' | 'prefix',
    operatorPass: (ownerOf: string) => Promise<boolean>,
): Promise<SchemaLockRefusal | null> {
    const pattern = await schemaPatternRefusal(deps, caller, keyPattern);
    if (pattern) return pattern;

    const { storage, config } = deps;
    const ownerGhii = `${caller.owner}@${config.nodeId}`;
    const mine = (lockedBy: string): boolean => isOwnersLock(lockedBy, caller.owner, ownerGhii);
    const lockedByOther = (holder: string): SchemaLockRefusal => ({
        status: 403, code: 'SCHEMA_LOCKED_BY_OTHER',
        message: `This structure is locked by ${holder}. Ask them to unlock it, or make your own copy.`,
        details: { key_pattern: keyPattern, locked_by: holder },
    });

    // Rule 3: the other row of the same pattern.
    const beside = await storage.getSchema(keyPattern, applyTo === 'exact' ? 'prefix' : 'exact');
    if (beside && !mine(beside.lockedBy) && !(await operatorPass(beside.lockedBy))) return lockedByOther(beside.lockedBy);

    // Rule 4: the lock that governs the pattern's own key today, when it is a different pattern.
    const governing = await storage.findApplicableSchema(keyPattern);
    if (governing && governing.keyPattern !== keyPattern && !mine(governing.lockedBy)
        && !(await operatorPass(governing.lockedBy))) {
        return lockedByOther(governing.lockedBy);
    }
    // Rule 4 for the keys a wildcard reaches: the lock that governs the pattern's literal text above
    // misses a deeper plain lock (`family.italian` under `family.*.*`), which the new lock outranks.
    if (applyTo === 'prefix' && WILDCARD.test(keyPattern)) {
        for (const other of await storage.listSchemas()) {
            if (mine(other.lockedBy) || !wildcardTakesOver(keyPattern, other)) continue;
            if (!(await operatorPass(other.lockedBy))) return lockedByOther(other.lockedBy);
        }
    }
    return null;
}
