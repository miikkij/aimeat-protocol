/**
 * @file src/services/eco-capability-approvals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether another account's capability may ask the caller's own outside (ecosystem) app
 *   to run one of its actions, and the owner's one-press answer, kept on the app's row:
 *   EcosystemAppRecord.capabilityApprovals.
 *
 *   WHY. A capability with the source `eco:{app}:{action}` runs over the CALLER's connected app, on
 *   the caller's tunnel, as the caller. That is right for the owner's own capability. For another
 *   account's capability it let the registrant choose which action the caller's app performed, and
 *   through an app-tool manifest's lockedInput with which arguments, while the caller only asked to
 *   run the registrant's tool (secaudit 2026-10, capability-invoke.ts:ecosystem-source:app-slug-
 *   resolved-in-caller-reach). The `mcp` source refuses the same shape (MCP_CAPABILITY_NOT_YOURS).
 *
 *   THE RULE. The capability's registrant and the caller belong to the same account: nothing changes.
 *   Otherwise the call runs only when (a) the caller's app is connected and declared that action in
 *   its manifest, the same test an eco-capability schedule meets (services/schedule-write.ts), and
 *   (b) the account holder allowed this capability to ask for this action once, with one press. A
 *   call that meets (a) but not (b) files the question: one entry per (capability, action,
 *   registrant) while it waits, a bell notice with Allow the first time, and the address of the page
 *   (views/eco-capability-allow.js) in the refusal, so the AI that met it can hand it on. Reused
 *   from services/secret-approvals.ts: one question, one press, a list written by compare-and-swap.
 *
 *   WHAT AN APPROVAL DOES. That capability, registered by that account, may ask this app to run that
 *   action from then on, with whatever input the call carries. A change of the capability's action,
 *   or the same action through another capability, is a new question. Only the account holder signed
 *   in answers (the routes ask inPerson). Deleting the app removes its row and every answer with it.
 * @structure ecoCapabilityAllowUrl · findEcoCapabilityApproval · ecosystemCallRefusal ·
 *   readEcoCapabilityApproval · approveEcoCapabilityUse · declineEcoCapabilityUse ·
 *   withdrawEcoCapabilityApproval
 * @usage
 *   const refusal = await ecosystemCallRefusal({ storage, config }, { capability, app, action, callerGhii, input });
 *   if (refusal) throw Object.assign(new Error(refusal.message), refusal);
 * @version-history
 *   v1.3.0 — 2026-10-25 — The account holder's notice carries its question's ref, and Allow and Don't
 *     allow close it: the answer shows and the buttons go (closeQuestion).
 *   v1.2.0 — 2026-10-25 — Allow and Don't allow tell the one whose call asked (approval-standard.ts
 *     tellAsker) (secaudit2026oct22, the approval standard).
 *   v1.1.0 — 2026-10-22 — The bell notice carries Don't allow beside Allow (the developer: a question
 *     with only Allow cannot be answered no).
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, capability-invoke.ts ecosystem source, r45).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord, EcosystemAppRecord, EcoCapabilityApproval } from '../storage/interface.js';
import { notify, type NotifyInput } from './notify.js';
import { emitChange } from './event-bus.js';
import { tellAsker, closeQuestion } from './approval-standard.js';
import { localAccountName, localAccountOf, ownerGhiiOf } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** The most requests one app holds waiting at once; the oldest is dropped first. */
const MAX_PENDING = 10;
/** How many times a write retries when the list changed under it. */
const SWAP_TRIES = 4;
/** How much of the asking call's input the question keeps, for the owner to read. */
const INPUT_CHARS = 500;
export const ECO_CAPABILITY_ASK_TYPE = 'eco_capability_ask';

/** Which capability asks for which action, registered by whom. */
export interface EcoApprovalKey { capability: string; action: string; registrant: string }

const sameKey = (a: EcoApprovalKey, b: EcoApprovalKey) =>
  a.capability === b.capability && a.action === b.action && a.registrant === b.registrant;
const trimBase = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

/** The owner GHII behind a principal whose stored form may be a bare account name. */
function ownerOf(principal: string, nodeId: string): string {
  const owner = ownerGhiiOf(principal);
  return owner.includes('@') ? owner : `${owner}@${nodeId}`;
}

/** `eco:{app}:{action}` read the way invokeCapability reads it; null when it is not that shape. */
function ecoTarget(capability: CapabilityRecord): { app: string; action: string } | null {
  if (capability.source?.type !== 'ecosystem') return null;
  const parts = String(capability.source.ref ?? '').split(':');
  const app = parts[1];
  return app ? { app, action: parts[2] ?? capability.id } : null;
}

/** The page where the owner answers. The page reads the facts from the node, never from this address. */
export function ecoCapabilityAllowUrl(baseUrl: string, app: string, capability: string): string {
  const q = new URLSearchParams({ app, capability });
  return `${trimBase(baseUrl)}/v1/eco-capability-allow?${q.toString()}`;
}

/** The approved entry for this key, or null. A waiting request is not an approval. */
export function findEcoCapabilityApproval(
  record: Pick<EcosystemAppRecord, 'capabilityApprovals'>, key: EcoApprovalKey,
): EcoCapabilityApproval | null {
  return (record.capabilityApprovals ?? []).find(a => !!a.approvedAt && sameKey(a, key)) ?? null;
}

/** Apply `change` with compare-and-swap. Answers the new list, or null when the app is gone. */
async function updateApprovals(
  storage: Storage, ownerName: string, app: string,
  change: (list: EcoCapabilityApproval[]) => EcoCapabilityApproval[] | null,
): Promise<{ list: EcoCapabilityApproval[]; changed: boolean; record: EcosystemAppRecord } | null> {
  if (!storage.swapEcosystemAppCapabilityApprovals) throw new Error('this storage cannot keep capability approvals');
  for (let i = 0; i < SWAP_TRIES; i++) {
    const record = await storage.getEcosystemAppByOwnerAndApp(ownerName, app);
    if (!record) return null;
    const current = record.capabilityApprovals ?? [];
    const next = change(current);
    if (!next) return { list: current, changed: false, record };
    if (await storage.swapEcosystemAppCapabilityApprovals(record.geai, current, next)) return { list: next, changed: true, record };
  }
  throw new Error('capability approvals: the list kept changing; try again');
}

/** The bell notice: the question in plain words, the page, and Allow on the notice itself. */
function askNotice(baseUrl: string, app: string, entry: EcoCapabilityApproval): NotifyInput {
  const url = ecoCapabilityAllowUrl(baseUrl, app, entry.capability);
  const registrant = localAccountName(entry.registrant);
  const name = entry.name ?? entry.capability;
  return {
    type: ECO_CAPABILITY_ASK_TYPE,
    title: `${registrant} asks to use your outside app ${app}`,
    body: `"${name}" from ${registrant} would like your outside app ${app} to run its action ${entry.action}. Open this to see what it sends, or answer here.`,
    link: url.slice(url.indexOf('/v1/')),
    i18n: { key: ECO_CAPABILITY_ASK_TYPE, vars: { registrant, app, action: entry.action, name } },
    ref: ecoQuestionRef(app, entry.capability),
    // Both answers on the notice, as on the page: a question with only Allow cannot be answered no.
    actions: [{
      id: 'deny', label: 'Don\'t allow', kind: 'api', method: 'POST',
      endpoint: `/v1/ecosystem-apps/${encodeURIComponent(app)}/capability-approvals/decline`,
      body: { capability: entry.capability }, style: 'default',
      i18n: { key: `${ECO_CAPABILITY_ASK_TYPE}.deny` },
    }, {
      id: 'allow', label: 'Allow', kind: 'api', method: 'POST',
      endpoint: `/v1/ecosystem-apps/${encodeURIComponent(app)}/capability-approvals`,
      body: { capability: entry.capability }, style: 'primary',
      i18n: { key: `${ECO_CAPABILITY_ASK_TYPE}.allow` },
    }],
  };
}

/** What a refused call throws: the status, the code, words a person or an AI can act on, the page. */
export interface EcoCallRefusal { statusCode: number; code: string; message: string; approvalUrl?: string }

/**
 * Why this call may not run on the caller's outside app, or null when it may. Files the owner's
 * question when one press would allow it. Never throws on a storage failure: the refusal stands, and
 * the address is still the right one to hand out.
 */
export async function ecosystemCallRefusal(
  deps: { storage: Storage; config: AimeatConfig },
  call: { capability: CapabilityRecord; app: string; action: string; callerGhii: string; input: unknown },
): Promise<EcoCallRefusal | null> {
  const { storage, config } = deps;
  const registrant = ownerOf(call.capability.ownerGhii, config.nodeId);
  const callerOwner = ownerOf(call.callerGhii, config.nodeId);
  // The account's own capability over its own app: unchanged.
  if (registrant === callerOwner) return null;

  const name = call.capability.name || call.capability.id;
  const by = localAccountName(registrant);
  const account = localAccountOf(callerOwner);
  const ecoApp = account ? await storage.getEcosystemAppByOwnerAndApp(account, call.app) : null;
  if (!ecoApp) {
    return {
      statusCode: 404, code: 'ECO_APP_NOT_FOUND',
      message: `"${name}" from ${by} runs on an outside app called "${call.app}", and you have no app by that name connected.`,
    };
  }
  const declared = (ecoApp.capabilities ?? []).some(c => c.id === call.action);
  if (!declared) {
    return {
      statusCode: 403, code: 'ECOSYSTEM_CAPABILITY_NOT_YOURS',
      message: `"${name}" from ${by} asks your outside app "${call.app}" to run "${call.action}", and that app does not offer an action by that name. `
        + 'Another account\'s capability can ask your app only for an action the app itself offers. To run something else on your own app, publish your own capability over it.',
    };
  }
  const key: EcoApprovalKey = { capability: call.capability.id, action: call.action, registrant };
  if (findEcoCapabilityApproval(ecoApp, key)) return null;

  const approvalUrl = ecoCapabilityAllowUrl(config.baseUrl, call.app, call.capability.id);
  try {
    const entry: EcoCapabilityApproval = {
      ...key, name,
      input: JSON.stringify(call.input ?? {}).slice(0, INPUT_CHARS),
      requestedAt: new Date().toISOString(), requestedBy: call.callerGhii,
    };
    const out = await updateApprovals(storage, account!, call.app, (list) => {
      if (list.some(a => sameKey(a, key))) return null;   // already asked, or allowed meanwhile
      const pending = list.filter(a => !a.approvedAt);
      const drop = pending.length >= MAX_PENDING ? pending[0] : null;
      return [...list.filter(a => a !== drop), entry];
    });
    if (out?.changed) {
      await notify(storage, callerOwner, askNotice(config.baseUrl, call.app, entry));
      emitChange('ecosystem-apps', callerOwner);
    }
    // Allowed between the read above and this write: the call may run.
    if (out && findEcoCapabilityApproval({ capabilityApprovals: out.list }, key)) return null;
  } catch (err) {
    logger.warn('eco capability approvals: the request could not be filed; the refusal still stands', {
      owner: callerOwner, app: call.app, capability: call.capability.id, error: String(err),
    });
  }
  return {
    statusCode: 403, code: 'ECOSYSTEM_CAPABILITY_NEEDS_APPROVAL', approvalUrl,
    message: `"${name}" from ${by} asks your outside app "${call.app}" to run its action "${call.action}" for you, and this has not been allowed yet. `
      + `Nothing went wrong and nothing was sent. The account holder allows it once, with one press, here: ${approvalUrl} . `
      + 'If you are an AI, give the person that address in their own language, and call again when they say they have allowed it.',
  };
}

/** What the allow page shows, read from the node: the request, and whether it still stands. */
export interface EcoApprovalView {
  app: string;
  app_name: string;
  capability: string;
  name: string;
  registrant: string;
  action: string;
  input: string | null;
  requested_at: string;
  requested_by: string;
  approved_at: string | null;
  /** Whether the app still offers the action. */
  action_declared: boolean;
  /** Whether the capability still exists and still asks this app for this action. */
  still_asks: boolean;
}

/** The capability as it is now, and whether it still asks `app` for the entry's action. */
async function stillAsks(storage: Storage, nodeId: string, app: string, entry: EcoCapabilityApproval): Promise<boolean> {
  const cap = await storage.getCapability(entry.capability);
  const target = cap ? ecoTarget(cap) : null;
  return !!cap && !!target && target.app === app && target.action === entry.action
    && ownerOf(cap.ownerGhii, nodeId) === entry.registrant;
}

/** The newest request of `capability` on this app, with what it is now; null when none. */
export async function readEcoCapabilityApproval(
  storage: Storage, nodeId: string, ownerName: string, app: string, capability: string,
): Promise<EcoApprovalView | null> {
  const record = await storage.getEcosystemAppByOwnerAndApp(ownerName, app);
  const entry = (record?.capabilityApprovals ?? []).filter(a => a.capability === capability).pop();
  if (!record || !entry) return null;
  return {
    app, app_name: record.displayName ?? app, capability, name: entry.name ?? capability,
    registrant: localAccountName(entry.registrant), action: entry.action, input: entry.input ?? null,
    requested_at: entry.requestedAt, requested_by: entry.requestedBy, approved_at: entry.approvedAt ?? null,
    action_declared: (record.capabilities ?? []).some(c => c.id === entry.action),
    still_asks: await stillAsks(storage, nodeId, app, entry),
  };
}

export type EcoApprovalAnswer =
  | { ok: true; approval: EcoCapabilityApproval }
  | { ok: false; status: number; code: string; message: string };

/**
 * The owner allows the waiting request of `capability`. It must exist, and the capability must still
 * ask this app for the same action under the same registrant: a capability changed since it asked is
 * a different question, and the old page must not answer it.
 */
/** The ref of the account holder's notice about one capability's question on one app. */
const ecoQuestionRef = (app: string, capability: string) => `eco-capability-approval:${app}:${capability}`;

/** Close the account holder's notice: the answer shows with where to change it, the buttons go. */
async function closeEcoQuestion(storage: Storage, nodeId: string, ownerName: string, app: string, capability: string, outcome: 'allowed' | 'declined', by: string): Promise<void> {
  await closeQuestion({ storage }, {
    recipients: [ownerOf(ownerName, nodeId)], ref: ecoQuestionRef(app, capability), outcome, decidedBy: by,
    change: { link: '/v1/profile?tab=ecosystem', key: 'approval_change.ecosystem' },
  });
}

/** Tell the one whose call asked how the account holder answered (services/approval-standard.ts). */
async function tellEcoAsker(
  config: AimeatConfig | undefined, storage: Storage, ownerName: string, app: string,
  entry: EcoCapabilityApproval | null, outcome: 'allowed' | 'declined', decidedBy: string,
): Promise<void> {
  if (!config || !entry?.requestedBy) return;
  const name = entry.name ?? entry.capability;
  await tellAsker({ storage, config }, {
    accountGhii: ownerOf(ownerName, config.nodeId), asker: entry.requestedBy, outcome, decidedBy,
    what: `${name} on ${app}`,
    contextId: `eco-capability-approval:${app}:${entry.capability}`,
    sentence: outcome === 'allowed'
      ? `The account holder allowed "${name}" to ask their outside app ${app} to run ${entry.action}. Call it again; it runs now.`
      : `The account holder did not allow "${name}" to ask their outside app ${app} to run ${entry.action}. Nothing was sent. A later call asks again.`,
    data: { app, capability: entry.capability, action: entry.action },
    messageKind: 'eco-capability-approval',
  });
}

export async function approveEcoCapabilityUse(
  storage: Storage, nodeId: string, ownerName: string, app: string, capability: string, approvedBy: string,
  /** With the node's config, the one whose call asked is told (services/approval-standard.ts). */
  config?: AimeatConfig,
): Promise<EcoApprovalAnswer> {
  const gone = `This question is no longer waiting, so nothing was allowed. The outside app ${app} was removed, `
    + `the question was already answered, or the capability changed since it asked. If it still needs your app, its next call asks you again.`;
  const record = await storage.getEcosystemAppByOwnerAndApp(ownerName, app);
  const waiting = (record?.capabilityApprovals ?? []).filter(a => a.capability === capability && !a.approvedAt);
  let current: EcoCapabilityApproval | undefined;
  for (const entry of waiting) if (await stillAsks(storage, nodeId, app, entry)) current = entry;
  if (!current) {
    const done = (record?.capabilityApprovals ?? []).find(a => a.capability === capability && a.approvedAt);
    if (done && await stillAsks(storage, nodeId, app, done)) return { ok: true, approval: done };
    return { ok: false, status: 404, code: 'APPROVAL_NOT_FOUND', message: gone };
  }
  const key: EcoApprovalKey = current;
  let approved: EcoCapabilityApproval | null = null;
  const out = await updateApprovals(storage, ownerName, app, (list) => {
    const i = list.findIndex(a => sameKey(a, key));
    if (i < 0) return null;
    if (list[i].approvedAt) { approved = list[i]; return null; }
    approved = { ...list[i], approvedAt: new Date().toISOString(), approvedBy };
    return list.map((a, j) => (j === i ? approved! : a));
  });
  if (!out || !approved) return { ok: false, status: 404, code: 'APPROVAL_NOT_FOUND', message: gone };
  if (out.changed) {
    emitChange('ecosystem-apps', ownerOf(ownerName, nodeId));
    await tellEcoAsker(config, storage, ownerName, app, approved, 'allowed', approvedBy);
  }
  await closeEcoQuestion(storage, nodeId, ownerName, app, capability, 'allowed', approvedBy);
  return { ok: true, approval: approved };
}

/** The owner says no: the waiting requests of `capability` are removed, the one who asked is told, and its next call asks again. */
export async function declineEcoCapabilityUse(
  storage: Storage, nodeId: string, ownerName: string, app: string, capability: string,
  /** With the node's config and who pressed, the one whose call asked is told. */
  tell?: { config: AimeatConfig; by: string },
): Promise<boolean> {
  let dropped: EcoCapabilityApproval | null = null;
  const out = await updateApprovals(storage, ownerName, app, (list) => {
    dropped = list.filter(a => a.capability === capability && !a.approvedAt).pop() ?? null;
    const next = list.filter(a => !(a.capability === capability && !a.approvedAt));
    return next.length === list.length ? null : next;
  });
  if (out?.changed) {
    emitChange('ecosystem-apps', ownerOf(ownerName, nodeId));
    await tellEcoAsker(tell?.config, storage, ownerName, app, dropped, 'declined', tell?.by ?? ownerOf(ownerName, nodeId));
    await closeEcoQuestion(storage, nodeId, ownerName, app, capability, 'declined', tell?.by ?? ownerOf(ownerName, nodeId));
  }
  return !!out?.changed;
}

/** Withdraw what the owner allowed for `capability` on this app, and drop its waiting requests. */
export async function withdrawEcoCapabilityApproval(
  storage: Storage, nodeId: string, ownerName: string, app: string, capability: string,
): Promise<boolean> {
  const out = await updateApprovals(storage, ownerName, app, (list) => {
    const next = list.filter(a => a.capability !== capability);
    return next.length === list.length ? null : next;
  });
  if (out?.changed) emitChange('ecosystem-apps', ownerOf(ownerName, nodeId));
  return !!out?.changed;
}
