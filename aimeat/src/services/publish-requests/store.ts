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
 *   2026-10-25 — A settled request's notices show the answer and lose their buttons (closeQuestion,
 *     by the notices' ref `publish-request:<id>`; the developer's review of the sandbox).
 *   2026-10-25 — A request may ask something other than making a thing public (`approval`): the
 *     kinds `extension-email-policy`, `crew-model` and `account-setting`. It names who answers (the
 *     owner, or the node's operators, who get the item and the notice with the account in the
 *     decision body) and says in plain words what is checked and why; the one who asked hears the
 *     answer either way through services/approval-standard.ts tellAsker, a person and an app in the
 *     bell as well as an agent on its inbox (secaudit2026oct22, the developer's approval standard).
 *   2026-10-25 — The kind `internet-opening`: an agent or an app asks to open one app to the internet
 *     on a closed node (services/internet-opening/opening-door.ts).
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
import { emitChange } from '../event-bus.js';
import { approverGhiis, closeQuestion, tellAsker, type Approver, type ApprovalOutcome } from '../approval-standard.js';

/** The ref a request's notices carry, so its decision closes them (services/notification-answers.ts). */
const questionRef = (id: string) => `publish-request:${id}`;
import { stableStringify } from '../../utils/stable-json.js';
import { serialByKey } from '../../utils/serial-by-key.js';
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
  | 'package' | 'knowledge' | 'datapackage' | 'portfolio' | 'company' | 'cortex' | 'consent'
  // An app opened to the internet on a closed node, asked by an agent or an app (services/internet-opening/).
  | 'internet-opening'
  // Approvals that make nothing public (`approval` on the request; services/approval-standard.ts):
  // an extension's emailPolicy grant (the operators answer), a crew model choice with its own
  // address set by an app, and switching off the owner's secret host question.
  | 'extension-email-policy' | 'crew-model' | 'account-setting';

/** The stored state. A request whose `approval` names the operators reads `awaiting_operator` while it waits. */
export type PublishRequestState = 'awaiting_owner' | 'approved' | 'declined' | 'expired' | 'outdated';

/** Who asked. */
export interface PublishRequester {
  /** An agent's GAII, `eco:<app>#<owner>@<node>` for an app grant, or a person's GHII. */
  principal: string;
  kind: 'agent' | 'app' | 'person';
  /** The token's subject. */
  sub: string;
}

/**
 * A request that asks something other than making a thing public (services/approval-standard.ts):
 * who answers it, and what is checked and why, in plain English an AI passes on. The approver's
 * notice says it from `i18n` in the reader's language.
 */
export interface ApprovalAsk {
  approver: Approver;
  /** What the one who asked wants, as the phrase after "asks to": "let the extension mailer send email to any address". */
  asks: string;
  /** Why the node checks it first, in one or two sentences. */
  why: string;
  /** The word an agent of the owner must hold to approve it. Absent: being the owner's agent is enough. */
  approve_scope?: string;
  /** Where the person changes it later, shown on the answered notice: a page and its locale key under `notiftext.`. */
  change?: { link: string; key: string };
  /** The approver notice's locale key under `notiftext.` and its variables (names, never sentences). */
  i18n: { key: string; vars: Record<string, string> };
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
  /** Present on a request that makes nothing public: who answers, and what is checked and why. */
  approval?: ApprovalAsk;
  /** The items the question put on the operators' lists, one per operator (approval.approver 'operators'). */
  approver_items?: Array<{ ghii: string; id: string }>;
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

/** Who answers a waiting request: the owner, unless its `approval` names the operators. */
export function waitingFor(request: Pick<PublishRequest, 'approval'>): Approver {
  return request.approval?.approver ?? 'owner';
}

/** The request as a door answers it. A waiting question for the operators reads `awaiting_operator`. */
export function summarizePublishRequest(request: PublishRequest, now = Date.now()) {
  const state = effectiveState(request, now);
  return {
    id: request.id,
    kind: request.kind,
    state: state === 'awaiting_owner' && waitingFor(request) === 'operators' ? 'awaiting_operator' as const : state,
    waiting_for: waitingFor(request),
    ...(request.approval ? { asks: request.approval.asks, why: request.approval.why } : {}),
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

/** The sentence the one who asked reads for a request that makes nothing public. */
function approvalSentence(request: PublishRequest, words: ApprovalAsk, state: PublishRequestState, by: string | null): string {
  const what = `your request to ${words.asks}`;
  const cap = `${what.charAt(0).toUpperCase()}${what.slice(1)}`;
  const who = words.approver === 'operators' ? 'An operator of this node' : by && by.includes('#') ? `${by.split('#')[0]}, in the owner's name,` : 'The owner';
  switch (state) {
    case 'approved': return `${who} allowed ${what}. It is in effect now.`;
    case 'declined': return `${who} did not allow ${what}. Nothing changed.`;
    case 'expired': return `${cap} expired before anyone answered it. Nothing changed. Ask again if it is still needed.`;
    case 'outdated': return `${cap} can no longer be carried out as asked: ${request.outcome?.reason ?? 'it changed after you asked'}. Nothing changed. Ask again.`;
    default: return `${cap} is waiting for ${words.approver === 'operators' ? "this node's operators" : 'the owner'}.`;
  }
}

function outcomeSentence(request: PublishRequest, state: PublishRequestState, by: string | null): string {
  if (request.approval) return approvalSentence(request, request.approval, state, by);
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
export type PublishRequestDraft = Pick<PublishRequest, 'kind' | 'target' | 'title' | 'name' | 'change' | 'requested_by' | 'part_of' | 'approval'>;

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
        `${MAX_WAITING} requests already wait for an answer on this account. Some need to be answered before another one is filed.`);
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
    if (draft.approval) {
      await announceApproval(ctx, ownerGhii, request, draft.approval, who);
      return { ok: true as const, request, alreadyWaiting: false };
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
      ref: questionRef(request.id),
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
 * Put a request that makes nothing public in front of whoever answers it (services/approval-
 * standard.ts): an item on each answerer's list and a notice that says what is checked and why, with
 * Allow and Don't allow. A question for the operators carries the account in the decision body, since
 * the operator answers from their own session; the account's holder hears of it without buttons when
 * they are not an operator themselves.
 */
async function announceApproval(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest, words: ApprovalAsk, who: string): Promise<void> {
  const { storage } = ctx;
  const to = await approverGhiis(ctx, ownerGhii, words.approver);
  const items: Array<{ ghii: string; id: string }> = [];
  for (const ghii of to) {
    const item = await addItem(storage, ghii, {
      title: `${who} asks to ${words.asks}`.slice(0, 200),
      kind: 'decision',
      origin: request.requested_by.principal,
      object: { type: 'publish-request', id: request.id },
      by: request.requested_by.kind === 'person' ? 'person' : 'ai',
    });
    if (item?.id) items.push({ ghii, id: item.id });
  }
  const own = items.find(i => i.ghii === ownerGhii);
  request.item_id = own?.id ?? null;
  const others = items.filter(i => i.ghii !== ownerGhii);
  if (others.length) request.approver_items = others;
  await putRequest(storage, ownerGhii, request);

  const door = `/v1/publish-requests/${request.id}/decision`;
  const account = words.approver === 'operators' ? { account: ownerGhii } : {};
  const vars = { who, ...words.i18n.vars };
  for (const ghii of to) {
    await notify(storage, ghii, {
      type: 'approval_request',
      title: `${who} asks to ${words.asks}`,
      body: `${words.why} If you allow it, it is in effect at once. If you do not, nothing changes. ${who} hears the answer either way.`,
      link: '/v1/profile?tab=notifications',
      i18n: { key: words.i18n.key, vars },
      ref: questionRef(request.id),
      actions: [
        { id: 'deny', label: 'Don\'t allow', kind: 'api', method: 'POST', endpoint: door, body: { decision: 'decline', ...account }, style: 'default', i18n: { key: 'approval_request.deny' } },
        { id: 'allow', label: 'Allow', kind: 'api', method: 'POST', endpoint: door, body: { decision: 'approve', ...account }, style: 'primary', i18n: { key: 'approval_request.allow' } },
      ],
    });
    emitChange('notifications', ghii);
    emitChange('open-items', ghii);
  }
  if (!to.includes(ownerGhii)) {
    // The account the question is about hears of it; the operators answer it.
    await notify(storage, ownerGhii, {
      type: 'approval_request_sent',
      title: `${who} asked this node's operators to ${words.asks}`,
      body: `${words.why} It waits for an operator. You hear the answer here.`,
      link: '/v1/profile?tab=notifications',
      i18n: { key: `${words.i18n.key}_sent`, vars },
    });
  }
  logger.info('Approval request filed', {
    event: 'publish.request_filed', owner: ownerGhii, id: request.id, kind: request.kind,
    by: request.requested_by.principal, approver: words.approver, to: to.length,
  });
}

/** The outcome word the approval standard tells the one who asked. */
function outcomeOf(state: Exclude<PublishRequestState, 'awaiting_owner'>): ApprovalOutcome {
  return state === 'approved' ? 'allowed' : state;
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

  const closedBy = how.by && how.by.includes('#') ? 'ai' as const : 'person' as const;
  const lists = [
    ...(request.item_id ? [{ ghii: ownerGhii, id: request.item_id }] : []),
    ...(request.approver_items ?? []),
  ];
  for (const it of lists) {
    try {
      if (await getItem(storage, it.ghii, it.id)) await closeItem(storage, it.ghii, it.id, closedBy);
      if (it.ghii !== ownerGhii) emitChange('open-items', it.ghii);
    } catch (err) {
      logger.warn('Publish request: could not close a list item', { owner: it.ghii, id: request.id, error: String(err) });
    }
  }

  // The question's notices show the answer and lose their buttons, for whoever it went to
  // (services/approval-standard.ts closeQuestion; the developer, 2026-10-25).
  await closeQuestion(ctx, {
    recipients: await approverGhiis(ctx, ownerGhii, waitingFor(request)),
    ref: questionRef(request.id), outcome: outcomeOf(state), decidedBy: how.by,
    ...(request.approval?.change ? { change: request.approval.change } : {}),
  });

  // The one who asked hears the answer, Allow and Don't allow alike (services/approval-standard.ts).
  // A publish request asked by an app was told to the owner by the owner's own press, or by the
  // agent-decided notice below, so only its agent asker gets a message, as before.
  if (request.approval || request.requested_by.kind === 'agent') {
    await tellAsker(ctx, {
      accountGhii: ownerGhii,
      asker: request.requested_by.principal,
      outcome: outcomeOf(state),
      sentence: outcomeSentence(settled, state, how.by),
      what: request.name,
      decidedBy: how.by,
      contextId: request.id,
      data: { kind: request.kind, target: request.target, state, ...(settled.outcome ?? {}) },
      messageKind: 'publish-request',
      link: '/v1/profile?tab=notifications',
    });
  }

  // A part decided with its parent is told to the owner once, by the parent's own notice. A request
  // the operators answer is told to the account by tellAsker and by its own notice at filing.
  if (!request.approval && how.by && how.by.includes('#') && (state === 'approved' || state === 'declined') && !how.withParent) {
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
