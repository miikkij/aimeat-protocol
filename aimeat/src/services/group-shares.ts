/**
 * @file group-shares.ts
 * @description Key-space shares: the decision engine behind "this owner lets this group read this
 *   key pattern". One place answers all three questions the table exists for — may this principal
 *   create a share, is this key covered for this reader right now, and what does each side see.
 * @structure
 *   - validateSharePattern() — what a pattern may cover before it is stored
 *   - isKeyShared() — the read decision, called from the shared access guard
 *   - accessorGroupIds() — the groups a principal reads through (its own GAII and its owner GHII)
 *   - listOutgoingShares() / listIncomingShares() — the owner's view and the reader's view
 * @usage
 *   import { isKeyShared } from '../services/group-shares.js';
 *   const hit = await isKeyShared(storage, record.ownerGaii, key, accessorGaii);
 * @version-history
 *   v1.0.0 -- 2026-08-11 -- Initial. Replaces the record-field share (`visibility:'group'` +
 *     one `groupId`), which could name only one group, had to be repeated on every write, and
 *     could not cover a key space that does not exist yet.
 */
import type { Storage, GroupShareRecord, SharingGroupRecord } from '../storage/interface.js';
import { consentMatchPattern } from '../storage/pattern-utils.js';
import { parseGaiiLoose, ownerGhiiOf } from '../utils/gaii.js';
import { RESERVED_OWNER_KEY_PREFIXES } from '../utils/reserved-keys.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';

/** How many shares one owner may hold. Not a policy so much as a backstop against a runaway loop. */
export const MAX_SHARES_PER_OWNER = 500;

/**
 * What a share pattern may cover.
 *
 * The pattern language is the consent one (`storage/pattern-utils.ts`): `*` is exactly one segment
 * and `**` is the rest of the key. Same wildcard, same meaning, on purpose — a node where `*` means
 * two different things depending on which feature reads it is a node where nobody can predict what
 * they just agreed to.
 *
 * Two things are refused rather than trimmed, because a share that quietly covers less (or more)
 * than the person believed is worse than an error:
 *
 * 1. **A pattern with no literal prefix.** `*`, `**` and `**.something` would hand over the owner's
 *    whole keyspace, or an unbounded slice of it, in one gesture. Sharing is per key space; giving
 *    away everything is not a share, and there is no interface anywhere that asks for it.
 * 2. **Anything reaching a reserved server key.** `openrouter.*` holds the URL a decrypted AI key is
 *    posted to, `ai-usage.*` the spend cap, `profile.*` the public directory inputs. These are
 *    server-trusted config the node itself reads; handing them to another account is not a sharing
 *    decision an owner can meaningfully make, so it is not offered.
 */
export function validateSharePattern(pattern: string): { ok: true } | { ok: false; code: string; message: string } {
  const p = (pattern ?? '').trim();
  if (!p) return { ok: false, code: 'INVALID_PATTERN', message: 'A share needs a key pattern.' };
  if (p.length > 400) return { ok: false, code: 'INVALID_PATTERN', message: 'Key pattern is too long (max 400 characters).' };

  // The literal head: everything before the first wildcard. A share must be anchored somewhere.
  const firstStar = p.indexOf('*');
  const literalHead = firstStar === -1 ? p : p.slice(0, firstStar);
  if (literalHead.replace(/[./]/g, '').length < 3) {
    return {
      ok: false, code: 'PATTERN_TOO_BROAD',
      message: 'A share must name a key space, not the whole namespace. Give at least three characters before the first wildcard, e.g. "deliveries.abc.**".',
    };
  }

  for (const reserved of RESERVED_OWNER_KEY_PREFIXES) {
    // Either direction is a hit: the pattern sits inside the reserved space ("openrouter.key"), or
    // its literal head is short enough that the pattern would reach into one ("open*").
    if (p.startsWith(reserved) || reserved.startsWith(literalHead)) {
      return {
        ok: false, code: 'RESERVED_KEY',
        message: `"${reserved}*" is managed by the node on your behalf and cannot be shared.`,
      };
    }
  }
  return { ok: true };
}

/** Live = not past its expiry. A share with no expiry runs until it is revoked. */
function isLive(share: GroupShareRecord, now: number): boolean {
  if (!share.expiresAt) return true;
  return new Date(share.expiresAt).getTime() > now;
}

/**
 * The identities a principal is recognised by when reading through a group.
 *
 * An agent is a member in its own right (`bot#alice@node` added directly) AND through the human who
 * owns it (`alice@node` added as a person). Both are checked, because an owner adding "alice" means
 * alice, and alice acts through her agents. An owner session resolves to its GHII before it gets
 * here, so the two cases meet in the same list.
 */
function accessorIdentities(accessorGaii: string): string[] {
  const out = new Set<string>([accessorGaii]);
  const owner = ownerGhiiOf(accessorGaii);
  if (owner && owner !== accessorGaii) out.add(owner);
  const parsed = parseGaiiLoose(accessorGaii);
  if (parsed.owner && parsed.node) out.add(`${parsed.owner}@${parsed.node}`);
  return [...out];
}

/** The groups this principal reads through, with the member row that admitted them. */
export async function accessorGroups(storage: Storage, accessorGaii: string): Promise<SharingGroupRecord[]> {
  if (!accessorGaii || accessorGaii === 'anonymous') return [];
  const seen = new Set<string>();
  const groups: SharingGroupRecord[] = [];
  for (const identity of accessorIdentities(accessorGaii)) {
    for (const g of await storage.listSharingGroupsByMember(identity)) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      groups.push(g);
    }
  }
  return groups;
}

/** Does the member row (or the group default) actually carry read? A group can hold a muted member. */
function mayRead(group: SharingGroupRecord, accessorGaii: string): boolean {
  const identities = new Set(accessorIdentities(accessorGaii));
  const member = group.members.find(m => identities.has(m.identifier));
  if (!member) return false;
  return (member.permissions ?? group.defaultPermissions).read === true;
}

/**
 * Is this key shared with this reader right now?
 *
 * Two indexed reads and a pattern match: the reader's groups, the shares pointing at them, then the
 * pattern. Nothing here consults the record's own visibility — that is the point of the design. A
 * `private` record covered by a live share is readable by the group, and stays private to everyone
 * else, so sharing something never changes what it is.
 */
export async function isKeyShared(
  storage: Storage,
  ownerGaii: string,
  key: string,
  accessorGaii: string,
): Promise<{ shared: boolean; shareId?: string }> {
  if (!accessorGaii || accessorGaii === 'anonymous') return { shared: false };

  const groups = (await accessorGroups(storage, accessorGaii))
    // Only groups belonging to the owner of the record can reach it. A group of the reader's own
    // never grants them anything of someone else's, however it is named.
    .filter(g => g.ownerGaii === ownerGaii || ownerGhiiOf(g.ownerGaii) === ownerGhiiOf(ownerGaii))
    .filter(g => mayRead(g, accessorGaii));
  if (groups.length === 0) return { shared: false };

  const now = Date.now();
  const shares = await storage.listGroupSharesByGroups(groups.map(g => g.id));
  for (const share of shares) {
    if (ownerGhiiOf(share.ownerGaii) !== ownerGhiiOf(ownerGaii)) continue;
    if (!isLive(share, now)) continue;
    if (consentMatchPattern(share.keyPattern, key)) return { shared: true, shareId: share.id };
  }
  return { shared: false };
}

// ── Making and revoking one, for both doors ──────────────────────────────────

export type ShareResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string };

export interface ShareCaller {
  /** The OWNER identity the share belongs to, already resolved from the session. */
  ownerGaii: string;
  scopes: string[];
  roles: string[];
  /** The exact principal acting, for the audit column. Equals ownerGaii for an owner session. */
  principal: string;
}

/**
 * Making a share is its own permission, `share:manage`, and no wildcard carries it
 * (see SCOPES_OUTSIDE_WILDCARD).
 *
 * `memory:write` does not cover it and must not be read as covering it: writing the owner's own
 * records and handing another account a standing right to read them are different favours, and the
 * second is the one the owner would want to be asked about. Same reasoning `exchange:grant` states
 * for giving away what the owner sells. "Full access" is one click, and nobody clicking it is
 * deciding that an agent may publish their memory to people they never named.
 */
function gate(caller: ShareCaller): Extract<ShareResult<never>, { ok: false }> | null {
  // The human at their own keyboard, and nobody else. An AGENT's token carries its owner's `owner`
  // role too (routes/auth.ts copies it on), so a plain `roles.includes('owner')` would wave through
  // every agent of every owner and the permission would mean nothing. The exclusion is what makes
  // it a permission rather than a label.
  const isHumanOwnerSession = (caller.roles.includes('owner') || caller.roles.includes('operator'))
    && !caller.roles.includes('agent')
    && !caller.roles.includes('ecosystem')
    && !caller.roles.includes('app');
  if (isHumanOwnerSession || scopeIsCovered(caller.scopes, 'share:manage')) return null;
  return {
    ok: false, status: 403, code: 'SCOPE_DENIED',
    message: 'Sharing a key space with someone else needs the "share:manage" permission, which this session does not carry.',
  };
}

export interface ShareInput {
  groupId: string;
  keyPattern: string;
  note?: string;
  expiresAt?: string | null;
}

/** One implementation, called by REST and by MCP. The gate, the ownership check and the ceiling live here. */
export async function createShare(
  deps: { storage: Storage; newId: () => string; now: () => string },
  caller: ShareCaller,
  input: ShareInput,
): Promise<ShareResult<GroupShareRecord>> {
  const denied = gate(caller);
  if (denied) return denied;

  const group = await deps.storage.getSharingGroup(input.groupId);
  // A group that is not the caller's is reported as missing rather than forbidden: whether a
  // stranger's group exists is not something an outsider gets to learn by asking.
  if (!group || ownerGhiiOf(group.ownerGaii) !== ownerGhiiOf(caller.ownerGaii)) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Sharing group not found' };
  }

  const verdict = validateSharePattern(input.keyPattern);
  if (!verdict.ok) {
    return { ok: false, status: verdict.code === 'RESERVED_KEY' ? 403 : 400, code: verdict.code, message: verdict.message };
  }

  const existing = await deps.storage.listGroupSharesByOwner(caller.ownerGaii);
  if (existing.length >= MAX_SHARES_PER_OWNER) {
    return {
      ok: false, status: 413, code: 'QUOTA_EXCEEDED',
      message: `Maximum ${MAX_SHARES_PER_OWNER} shares per owner. Revoke one you no longer need, or widen a pattern instead of adding another.`,
    };
  }
  // The same pattern to the same group twice is the same share. Return the one that exists rather
  // than growing a second row that revoking the first would not undo.
  const duplicate = existing.find(s => s.groupId === input.groupId && s.keyPattern === input.keyPattern.trim());
  if (duplicate) return { ok: true, value: duplicate };

  const record: GroupShareRecord = {
    id: deps.newId(),
    groupId: input.groupId,
    ownerGaii: caller.ownerGaii,
    keyPattern: input.keyPattern.trim(),
    createdAt: deps.now(),
    createdBy: caller.principal,
    ...(input.note ? { note: input.note } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
  return { ok: true, value: await deps.storage.createGroupShare(record) };
}

/** Revoking is immediate: the next read finds no share and falls back to the record's own tier. */
export async function revokeShare(
  deps: { storage: Storage },
  caller: ShareCaller,
  shareId: string,
): Promise<ShareResult<GroupShareRecord>> {
  const denied = gate(caller);
  if (denied) return denied;
  const share = await deps.storage.getGroupShare(shareId);
  if (!share || ownerGhiiOf(share.ownerGaii) !== ownerGhiiOf(caller.ownerGaii)) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Share not found' };
  }
  await deps.storage.deleteGroupShare(shareId);
  return { ok: true, value: share };
}

/** What this owner has given away, and to whom. The Access tab's own question. */
export async function listOutgoingShares(storage: Storage, ownerGaii: string): Promise<GroupShareRecord[]> {
  return storage.listGroupSharesByOwner(ownerGaii);
}

/**
 * What has been shared WITH this principal. The half whose absence made the old feature unusable:
 * a reader had to be handed the owner's identity and the exact key out of band, because nothing on
 * the node would tell them what they had been given.
 */
export async function listIncomingShares(storage: Storage, accessorGaii: string): Promise<GroupShareRecord[]> {
  const groups = (await accessorGroups(storage, accessorGaii)).filter(g => mayRead(g, accessorGaii));
  if (groups.length === 0) return [];
  const now = Date.now();
  return (await storage.listGroupSharesByGroups(groups.map(g => g.id))).filter(s => isLive(s, now));
}
