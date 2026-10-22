/**
 * @file src/services/publish-requests/store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish request as a record: where it lives, how it is filed in front of the
 *   owner, and how it is settled and told to the one who asked (plan doc-mvcn6c7e4e5q, V4.3). The
 *   pattern is the package install request's (services/packages/install/package-install-request-store.ts).
 *
 *   ONE RECORD PER REQUEST, `publish.requests.<id>`, in the owner's namespace under a reserved prefix
 *   (utils/reserved-keys.ts): the decision door reads the target and the change out of the record and
 *   makes the target public as the owner, so no app and no delegated agent may write one. No new table.
 *
 *   FILED = ONE RECORD, ONE OPEN ITEM, ONE NOTIFICATION. The notification carries Approve and Decline
 *   as `api` actions on the decision door, which the bell and the Notifications page run with the
 *   owner's own session. A second ask for the same change by the same principal returns the standing
 *   request instead of a second line on the owner's list.
 *
 *   HOW IT GOES STALE. A request is decidable for seven days (policy.ts); an expired one is settled
 *   `expired` by the next filing, the next decision or the next read. The record lives thirty days
 *   from its creation (the memory TTL), so the one who asked can read the outcome, and then it is
 *   gone. At most twenty wait at once per owner.
 *
 *   SETTLED = STATE, ITEM CLOSED, REQUESTER TOLD. An agent that asked gets a turn on the Agent v2
 *   road with the request id as its context. When one of the owner's agents decided rather than the
 *   owner, the owner is told: a person must see when their AI acted for them.
 * @structure PUBLISH_REQUEST_PREFIX · PublishKind · PublishRequest · PublishRequester ·
 *   inPublishQueue · readPublishRequest · listPublishRequests · effectiveState · summarizePublishRequest ·
 *   filePublishRequest · settlePublishRequest · settleRequestsForBinnedRecord ·
 *   settleRequestsForRemovedTarget · memoryValueDigest ·
 *   requesterName · approveUrl · PublishApplyResult · PublishApplier
 * @usage
 *   const filed = await filePublishRequest({ storage, config }, ownerGhii, draft);
 *   await settlePublishRequest({ storage, config }, ownerGhii, request, 'declined', { by: decider });
 * @version-history
 *   2026-10-22 — settleRequestsForRemovedTarget(): a deleted user skill or an uninstalled cortex
 *     settles every request still waiting on it `outdated`, and `digest` binds a skill's or a
 *     cortex's content beside its version (secaudit 2026-10,
 *     apply-skill.ts:applySkillPublish:semver-restarts-on-delete-recreate,
 *     apply-cortex.ts:applyCortexPublish:version-not-bound-to-manifest-or-reinstalled-libs).
 *   2026-10-21 — A request may be filed as a PART of another (`part_of` on the part, `parts` on the
 *     parent; parts.ts): the part gets no item and no notification of its own, waits as long as the
 *     parent, and the parent's item and notification name it. A parent that ends declined, expired or
 *     outdated settles its waiting parts the same way. A request without a link is unchanged (the
 *     picture of a gated public image job; the developer's one-press decision, 2026-10-21).
 *   2026-10-20 — memoryValueDigest() and settleRequestsForBinnedRecord(): a request binds the record's
 *     content digest beside its version (left out of the fingerprint), and a binned record settles
 *     every request still waiting on it `outdated` (secaudit 2026-10,
 *     apply-memory.ts:applyMemoryPublish:version-restarts-on-bin-takeover).
 *   2026-10-20 — The kind `consent`: a consent whose recipient is `*` reaches the same readers a
 *     public record does, so it asks the same gate (secaudit 2026-10,
 *     grantConsent:wildcard-recipient-skips-publish-gate).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4.3).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { addItem, closeItem, getItem } from '../open-items.js';
import { notify } from '../notify.js';
import { sendAgentV2Message } from '../agent-v2-messaging.js';
import { emitChange } from '../event-bus.js';
import { stableStringify } from '../../utils/stable-json.js';
import { serialByKey } from '../../utils/serial-by-key.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { PUBLISH_REQUEST_DAYS, publishRequestExpired } from './policy.js';
import { announcePart } from './parts.js';

/** Where one request lives. The prefix is listable, so the owner's list finds them all. */
export const PUBLISH_REQUEST_PREFIX = 'publish.requests.';
const SPEC = 'aimeat.publish-request/v1';
const RECORD_HOURS = 30 * 24;
const MAX_WAITING = 20;
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What kind of content a request makes public. Each has an applier in appliers.ts. */
export type PublishKind =
  | 'memory' | 'file' | 'workspace-share' | 'app' | 'organism' | 'board' | 'skill'
  | 'package' | 'knowledge' | 'datapackage' | 'portfolio' | 'company' | 'cortex' | 'consent';

export type PublishRequestState = 'awaiting_owner' | 'approved' | 'declined' | 'expired' | 'outdated';

/** Who asked. */
export interface PublishRequester {
  /** An agent's GAII, or `eco:<app>#<owner>@<node>` for an app grant. */
  principal: string;
  kind: 'agent' | 'app';
  /** The token's subject. */
  sub: string;
}

export interface PublishRequest {
  spec: typeof SPEC;
  id: string;
  kind: PublishKind;
  /**
   * What the change is made to, as the applier of `kind` reads it: ids and names only, never content.
   * `version` (where the kind has one) is the content's version when it was asked: an approval of a
   * target whose content changed since is settled `outdated`, so nothing the owner did not see goes out.
   */
  target: Record<string, string | number>;
  /** The English phrase a person reads for the target: "the record notes.trip", "the app quiz.html". */
  title: string;
  /** The target's own name, without words of any language: "notes.trip", "quiz.html". */
  name: string;
  /** The one field the request changes, from what to what. */
  change: { field: string; from: unknown; to: unknown };
  requested_by: PublishRequester;
  state: PublishRequestState;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  decided_by: string | null;
  outcome: { reason?: string; url?: string } | null;
  item_id: string | null;
  fingerprint: string;
  /** This request is part of another (parts.ts): the parent's id. It has no item or notification of
   *  its own, and the parent's decision decides it too. Absent on every request filed alone. */
  part_of?: string;
  /** The ids of the requests filed as parts of this one. Absent when it has none. */
  parts?: string[];
}

export type PublishRequestFail = { ok: false; status: number; code: string; message: string };

/** What an applier answers: done (with the public address when there is one), or why not. */
export type PublishApplyResult = { ok: true; url?: string } | { ok: false; reason: string };

/** Makes one approved request's target public as the owner (appliers.ts, apply-<kind>.ts). */
export type PublishApplier = (ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest) => Promise<PublishApplyResult>;
const fail = (status: number, code: string, message: string): PublishRequestFail => ({ ok: false, status, code, message });

export interface PublishStoreCtx { storage: Storage; config: AimeatConfig }

const publishRequestKey = (id: string): string => `${PUBLISH_REQUEST_PREFIX}${id}`;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/**
 * The digest of a record's value that a request binds beside its version (`target.digest`, and
 * `target.entry_digests` for a knowledge package). A version is not unique over a key's lifetime: a
 * binned key re-created by a create-if-absent write starts again at version 1, so the version alone
 * let an approval publish content written after the request (secaudit 2026-10,
 * apply-memory.ts:applyMemoryPublish:version-restarts-on-bin-takeover). Canonical JSON, so the two
 * backends give the same digest for the same value.
 */
export function memoryValueDigest(value: unknown): string {
  return sha256(stableStringify(value ?? null));
}

/** The target fields that bind the request to one content, not to one target: left out of the fingerprint. */
const CONTENT_BINDING_FIELDS = new Set(['version', 'digest', 'entry_digests']);

/** One filing or decision at a time per owner, in this process: two taps cannot both approve. */
export function inPublishQueue<T>(ownerGhii: string, work: () => Promise<T>): Promise<T> {
  return serialByKey(`publish-requests ${ownerGhii}`, work);
}

/** Where the owner answers: the Notifications page, which shows Approve and Decline. */
export function approveUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/profile?tab=notifications`;
}

function asRequest(value: unknown): PublishRequest | null {
  const v = value as PublishRequest | undefined;
  return v && v.spec === SPEC && typeof v.id === 'string' && v.target && v.change && v.requested_by ? v : null;
}

export async function readPublishRequest(storage: Storage, ownerGhii: string, id: string): Promise<PublishRequest | null> {
  if (!ID_SHAPE.test(id)) return null;
  return asRequest((await storage.getMemory(ownerGhii, publishRequestKey(id)))?.value);
}

/** Every request on this account, newest first. */
export async function listPublishRequests(storage: Storage, ownerGhii: string): Promise<PublishRequest[]> {
  const rows = await storage.listMemory(ownerGhii, { prefix: PUBLISH_REQUEST_PREFIX });
  return rows.map(r => asRequest(r.value)).filter((r): r is PublishRequest => !!r)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The state a reader is told: a waiting request past its expiry is expired, written or not. */
export function effectiveState(request: PublishRequest, now = Date.now()): PublishRequestState {
  return request.state === 'awaiting_owner' && publishRequestExpired(request, now) ? 'expired' : request.state;
}

/** The request as a door answers it. */
export function summarizePublishRequest(request: PublishRequest, now = Date.now()) {
  return {
    id: request.id,
    kind: request.kind,
    state: effectiveState(request, now),
    title: request.title,
    name: request.name,
    target: request.target,
    change: request.change,
    requested_by: { principal: request.requested_by.principal, kind: request.requested_by.kind },
    created_at: request.created_at,
    expires_at: request.expires_at,
    decided_at: request.decided_at,
    decided_by: request.decided_by,
    outcome: request.outcome,
    ...(request.part_of ? { part_of: request.part_of } : {}),
    ...(request.parts?.length ? { parts: request.parts } : {}),
  };
}

async function putRequest(storage: Storage, ownerGhii: string, request: PublishRequest): Promise<void> {
  const row = await storage.getMemory(ownerGhii, publishRequestKey(request.id));
  const now = new Date().toISOString();
  await storage.setMemory({
    key: publishRequestKey(request.id),
    ownerGaii: ownerGhii,
    value: request as unknown as Record<string, unknown>,
    visibility: 'private',
    tags: ['publish-request'],
    ttlHours: RECORD_HOURS,
    version: (row?.version ?? 0) + 1,
    createdAt: row?.createdAt ?? request.created_at ?? now,
    updatedAt: now,
  });
}

/** The name a person reads for who asked: the agent's name, or the app's. */
export function requesterName(r: PublishRequester): string {
  const hash = r.principal.indexOf('#');
  return hash > 0 ? r.principal.slice(0, hash).replace(/^eco:/, '') : r.principal;
}

function outcomeSentence(request: PublishRequest, state: PublishRequestState, by: string | null): string {
  const what = `your request to make ${request.title} public`;
  const cap = `${what.charAt(0).toUpperCase()}${what.slice(1)}`;
  switch (state) {
    case 'approved': {
      const who = by && by.includes('#') ? `${by.split('#')[0]} approved ${what} in the owner's name` : `The owner approved ${what}`;
      return `${who}, and it is public now.${request.outcome?.url ? ` Address: ${request.outcome.url}` : ''}`;
    }
    case 'declined': return `${cap} was declined. It stays as it is.`;
    case 'expired': return `${cap} expired before anyone decided it. It stays as it is. Ask again if it is still needed.`;
    case 'outdated': return `${cap} can no longer be carried out as asked: ${request.outcome?.reason ?? 'it changed after you asked'}. It stays as it is. Ask again.`;
    default: return `${cap} is waiting for the owner.`;
  }
}

/** The draft a door hands over: everything but the bookkeeping. */
export type PublishRequestDraft = Pick<PublishRequest, 'kind' | 'target' | 'title' | 'name' | 'change' | 'requested_by' | 'part_of'>;

/**
 * Put a request in front of the owner. Changes nothing about the target. Returns the standing
 * request when the same principal already asked for the same change of the same target and it is
 * still waiting; when the target was written again in between, the standing request now names the
 * new version, because the one who asked has asked again for what is there now.
 */
export async function filePublishRequest(
  ctx: PublishStoreCtx, ownerGhii: string, draft: PublishRequestDraft,
): Promise<{ ok: true; request: PublishRequest; alreadyWaiting: boolean } | PublishRequestFail> {
  const { storage } = ctx;
  // The version and the content digests are left out: a second ask about the same target is the same request.
  const where = Object.fromEntries(Object.entries(draft.target).filter(([k]) => !CONTENT_BINDING_FIELDS.has(k)));
  const fingerprint = sha256(stableStringify({
    kind: draft.kind, by: draft.requested_by.principal, target: where, to: draft.change.to,
  }));
  return inPublishQueue(ownerGhii, async () => {
    const now = Date.now();
    const all = await listPublishRequests(storage, ownerGhii);
    for (const old of all.filter(r => r.state === 'awaiting_owner' && publishRequestExpired(r, now))) {
      await settlePublishRequest(ctx, ownerGhii, old, 'expired', { by: null });
    }
    const waiting = all.filter(r => r.state === 'awaiting_owner' && !publishRequestExpired(r, now));
    const same = waiting.find(r => r.fingerprint === fingerprint);
    if (same) {
      if (stableStringify(same.target) === stableStringify(draft.target)) return { ok: true as const, request: same, alreadyWaiting: true };
      const moved: PublishRequest = { ...same, target: draft.target, change: draft.change };
      await putRequest(storage, ownerGhii, moved);
      return { ok: true as const, request: moved, alreadyWaiting: true };
    }
    if (waiting.length >= MAX_WAITING) {
      return fail(409, 'TOO_MANY_REQUESTS',
        `${MAX_WAITING} requests to make something public already wait for the owner. They need to decide some before another one is filed.`);
    }
    const request: PublishRequest = {
      spec: SPEC, id: randomUUID(), ...draft,
      state: 'awaiting_owner',
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + PUBLISH_REQUEST_DAYS * 86_400_000).toISOString(),
      decided_at: null, decided_by: null, outcome: null, item_id: null,
      fingerprint,
    };
    const who = requesterName(draft.requested_by);
    // A part (parts.ts): filed under a parent that still waits, it gets no item and no notification of
    // its own, waits exactly as long as the parent, and the parent's item and notification name it.
    // A parent that is gone or decided leaves the part a request of its own, filed as any other.
    delete request.part_of;
    const parent = draft.part_of && draft.part_of !== request.id ? waiting.find(r => r.id === draft.part_of) : undefined;
    if (parent) {
      const part: PublishRequest = { ...request, part_of: parent.id, expires_at: parent.expires_at };
      await putRequest(storage, ownerGhii, part);
      const linked: PublishRequest = { ...parent, parts: [...(parent.parts ?? []), part.id] };
      await putRequest(storage, ownerGhii, linked);
      await announcePart(ctx, ownerGhii, requesterName(parent.requested_by), linked, part);
      logger.info('Publish request filed as a part', {
        event: 'publish.request_filed', owner: ownerGhii, id: part.id, kind: draft.kind,
        by: draft.requested_by.principal, part_of: parent.id,
      });
      return { ok: true as const, request: part, alreadyWaiting: false };
    }
    const item = await addItem(storage, ownerGhii, {
      title: `${who} asks to make ${draft.title} public`.slice(0, 200),
      kind: 'decision',
      origin: draft.requested_by.principal,
      object: { type: 'publish-request', id: request.id },
      by: 'ai',
    });
    request.item_id = item?.id ?? null;
    await putRequest(storage, ownerGhii, request);

    const door = `/v1/publish-requests/${request.id}/decision`;
    // The English here is the fallback and what a push carries; the page says it from the i18n key.
    await notify(storage, ownerGhii, {
      type: 'publish_request',
      title: `${who} asks to make ${draft.title} public`,
      body: `Public means anyone can read it, also people who are not signed in. If you approve, it is public at once. If you decline, it stays as it is.`,
      link: '/v1/profile?tab=notifications',
      i18n: { key: 'publish_request', vars: { who, what: draft.name } },
      actions: [
        { id: 'approve', label: 'Approve', kind: 'api', method: 'POST', endpoint: door, body: { decision: 'approve' }, style: 'primary' },
        { id: 'decline', label: 'Decline', kind: 'api', method: 'POST', endpoint: door, body: { decision: 'decline' }, style: 'default' },
      ],
    });
    emitChange('open-items', ownerGhii);
    emitChange('notifications', ownerGhii);
    logger.info('Publish request filed', {
      event: 'publish.request_filed', owner: ownerGhii, id: request.id, kind: draft.kind,
      by: draft.requested_by.principal, item: request.item_id,
    });
    return { ok: true as const, request, alreadyWaiting: false };
  });
}

/**
 * Record how a request ended, close the item it put on the owner's list, and tell the one who asked.
 * `by` is who decided: the owner's GHII, an agent's GAII, or null when time decided.
 */
export async function settlePublishRequest(
  ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest, state: Exclude<PublishRequestState, 'awaiting_owner'>,
  how: { by: string | null; outcome?: PublishRequest['outcome']; /** A part decided by its parent's decision (parts.ts). */ withParent?: boolean },
): Promise<PublishRequest> {
  const { storage } = ctx;
  const settled: PublishRequest = {
    ...request, state,
    decided_at: new Date().toISOString(),
    decided_by: how.by,
    outcome: how.outcome ?? request.outcome,
  };
  await putRequest(storage, ownerGhii, settled);

  if (request.item_id) {
    try {
      if (await getItem(storage, ownerGhii, request.item_id)) {
        await closeItem(storage, ownerGhii, request.item_id, how.by && how.by.includes('#') ? 'ai' : 'person');
      }
    } catch (err) {
      logger.warn('Publish request: could not close the owner list item', { owner: ownerGhii, id: request.id, error: String(err) });
    }
  }

  if (request.requested_by.kind === 'agent') {
    try {
      await sendAgentV2Message(storage, {
        owner: localAccountName(ownerGhii),
        from: how.by ?? ownerGhii,
        to: request.requested_by.principal,
        role: 'agent',
        contextId: request.id,
        parts: [
          { kind: 'text', text: outcomeSentence(settled, state, how.by) },
          { kind: 'data', data: { request_id: request.id, kind: request.kind, target: request.target, state, ...(settled.outcome ?? {}) } },
        ],
        metadata: { kind: 'publish-request' },
      });
    } catch (err) {
      logger.warn('Publish request: the requester could not be told; the record says it', { owner: ownerGhii, id: request.id, error: String(err) });
    }
  }

  // A part decided with its parent is told to the owner once, by the parent's own notice.
  if (how.by && how.by.includes('#') && (state === 'approved' || state === 'declined') && !how.withParent) {
    const agentName = how.by.split('#')[0];
    const asker = requesterName(request.requested_by);
    await notify(storage, ownerGhii, {
      type: 'publish_request_decided',
      title: `${agentName} ${state === 'approved' ? 'made' : 'kept'} ${request.title} ${state === 'approved' ? 'public' : 'as it was'}`,
      body: state === 'approved'
        ? `${asker} asked for it, and ${agentName} approved it in your name.`
        : `${asker} asked for it, and ${agentName} declined it in your name.`,
      link: '/v1/profile?tab=notifications',
      i18n: {
        key: state === 'approved' ? 'publish_request_approved_by_agent' : 'publish_request_declined_by_agent',
        vars: { by: agentName, who: asker, what: request.name },
      },
    });
    emitChange('notifications', ownerGhii);
  }

  emitChange('open-items', ownerGhii);
  logger.info('Publish request settled', {
    event: 'publish.request_settled', owner: ownerGhii, id: request.id, state, by: how.by,
  });

  // A part follows its parent when the parent ends without being made public: declined, expired or
  // outdated, so nothing waits behind an item that is gone (parts.ts). An approval applies its parts
  // in decide.ts, where each one is checked as its own request.
  if (state !== 'approved') {
    for (const id of request.parts ?? []) {
      const part = await readPublishRequest(storage, ownerGhii, id);
      if (!part || part.state !== 'awaiting_owner' || part.part_of !== request.id) continue;
      await settlePublishRequest(ctx, ownerGhii, part, state, {
        by: how.by, withParent: true,
        ...(state === 'outdated' ? { outcome: { reason: `${request.title} it belongs to could not be made public` } } : {}),
      });
    }
  }
  return settled;
}

/** Does this waiting request name the record (namespace, key): a memory record, or a knowledge package's manifest or entry? */
function namesRecord(request: PublishRequest, namespace: string, key: string): boolean {
  if (String(request.target.namespace ?? '') !== namespace) return false;
  if (request.kind === 'memory') return String(request.target.key ?? '') === key;
  if (request.kind !== 'knowledge') return false;
  if (`packages/${String(request.target.package_id ?? '')}/manifest` === key) return true;
  try {
    const entries = JSON.parse(String(request.target.entries ?? '{}')) as Record<string, unknown>;
    return !!entries && typeof entries === 'object' && Object.prototype.hasOwnProperty.call(entries, key);
  } catch (err) {
    // A damaged entry list names nothing here; the applier refuses it on approval.
    logger.warn('Publish request: the entry list of a knowledge request does not parse', { id: request.id, error: String(err) });
    return false;
  }
}

/**
 * A record went into the bin: every request still waiting on it is settled `outdated`, and the one
 * who asked is told. What the owner would approve is gone, and a later write at the same key starts a
 * new life (a create-if-absent write takes the binned row over at version 1), so approving the old
 * request would publish content written after it (secaudit 2026-10,
 * apply-memory.ts:applyMemoryPublish:version-restarts-on-bin-takeover). Best-effort: a failure here
 * leaves the delete done, and the applier's version and digest check still refuses the approval.
 */
export async function settleRequestsForBinnedRecord(
  ctx: PublishStoreCtx, ownerGhii: string, namespace: string, key: string,
): Promise<number> {
  try {
    return await inPublishQueue(ownerGhii, async () => {
      const now = Date.now();
      const waiting = (await listPublishRequests(ctx.storage, ownerGhii))
        .filter(r => r.state === 'awaiting_owner' && !publishRequestExpired(r, now) && namesRecord(r, namespace, key));
      for (const r of waiting) {
        await settlePublishRequest(ctx, ownerGhii, r, 'outdated', {
          by: null, outcome: { reason: `the record ${key} was deleted after the request was made` },
        });
      }
      return waiting.length;
    });
  } catch (err) {
    logger.warn('Publish request: could not settle the requests on a deleted record', { owner: ownerGhii, namespace, key, error: String(err) });
    return 0;
  }
}

/**
 * A user skill was deleted or a cortex uninstalled: every request still waiting on it is settled
 * `outdated`, and the one who asked is told. `where` names the target by the fields its kind files
 * (a skill: owner and name; a cortex: name). A skill created again under the same name starts at
 * version 1.0.0 again, and a cortex installed again may take the same version, so an approval of the
 * old request would publish content written after it; a request filed before the content digest
 * existed has only its version to hold it (secaudit 2026-10,
 * apply-skill.ts:applySkillPublish:semver-restarts-on-delete-recreate,
 * apply-cortex.ts:applyCortexPublish:version-not-bound-to-manifest-or-reinstalled-libs).
 * Best-effort, as settleRequestsForBinnedRecord: the removal stays done either way.
 */
export async function settleRequestsForRemovedTarget(
  ctx: PublishStoreCtx, ownerGhii: string, kind: 'skill' | 'cortex', where: Record<string, string>, what: string,
): Promise<number> {
  try {
    return await inPublishQueue(ownerGhii, async () => {
      const now = Date.now();
      const waiting = (await listPublishRequests(ctx.storage, ownerGhii))
        .filter(r => r.kind === kind && r.state === 'awaiting_owner' && !publishRequestExpired(r, now)
          && Object.entries(where).every(([field, value]) => String(r.target[field] ?? '') === value));
      for (const r of waiting) {
        await settlePublishRequest(ctx, ownerGhii, r, 'outdated', {
          by: null, outcome: { reason: `${what} was removed after the request was made` },
        });
      }
      return waiting.length;
    });
  } catch (err) {
    logger.warn('Publish request: could not settle the requests on a removed target', { owner: ownerGhii, kind, ...where, error: String(err) });
    return 0;
  }
}
