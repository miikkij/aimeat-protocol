/**
 * @file src/routes/agents/device-auth-operator-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approval half of the operator-service branch of POST /v1/agents/device-authorize
 *   (agents.operator_services). The decision is services/operator-services/eligibility.ts, made before
 *   the request is written; this runs after the request row exists, when the decision said approve.
 *   Here rather than in the service because approveDeviceAuth is a route module's.
 *
 *   THE ORDER, so no agent exists without its line and no line without its agent:
 *     1. reserve the person's line (`pending`, with a nonce) BEFORE anything is made. A person who
 *        turned the service off, or another approval in progress, stops it here.
 *     2. approveDeviceAuth() with the credential agent as the approver and the entry's PRESENT words
 *        as the most it passes on.
 *     3. complete the line to `active` with the proof of the agent that now exists (./proof.ts) and
 *        `given`. If the line is no longer our reservation (the person turned the service off while
 *        this ran), or the write fails: the agent this approval made or connected is removed, with the
 *        onboarding record and test task it created, the device-authorization row is denied, the
 *        reservation is cleared, and the service gets an error it can retry. The rollback reads the
 *        approval's own result (`existing`), never a flag taken before it.
 *     4. the one notice, written as told only after it was stored; the operator action and the trail.
 *
 *   WHAT A RE-APPROVAL GIVES. A new agent gets what was asked for (or the entry's words). An agent the
 *   service made before ends with (the entry's present words ∩ the words the request names, or all of
 *   the entry's when it names none) plus the words the person added themselves (what it held minus the
 *   previous given), and `given` becomes the first set: a widened entry reaches the agent when the
 *   service asks again, and a word the entry no longer gives never survives a re-approval (S8).
 *   approveDeviceAuth is called with `operatorService: true`, the one marker that lets it rotate the
 *   key of an agent an operator service made (S1). No place default and no "Allow always" word is
 *   added: the entry is the only source of the entry's words (S7).
 *
 *   THE PRIVATE-READ EXCEPTION. The entry's words are services/operator-services/entries.ts
 *   allowedScopes, where memory:read-as-owner passes only with the entry's `private_read_reason`; so
 *   the word reaches the agent only through that named exception, `given` records that the entry gave
 *   it (the person's view reads `set_by_operator.private_read` from it), a re-approval or the sweep
 *   takes it back with the entry, and the operator action and the trail name it.
 *
 *   REQUIRED. A required entry reserves over the person's earlier off (`requiredNow`), and that person
 *   gets the notice that it is required now instead of the first one. The operator's own switch for
 *   the account (`operator_off`) still stops the approval.
 *
 *   `hooks` is for the unit tests that force an interleaving (test/unit/operator-services-flow.test.ts).
 * @structure ProvisionHooks · ProvisionOutcome · asSentence · sentenceIn · policyParts · tellPersonOnce ·
 *   tellRequiredNow · dropOnboarding · rollBack · approveForOperatorService
 * @usage const r = await approveForOperatorService(config, storage, decision, authRequest, callerGaii, ua);
 * @version-history
 *   v2.9.0 — 2026-11-27 — The English fallback bodies speak of the person's own account, as the locale texts
 *     do, not of "everyone here", which is false for an entry with named accounts.
 *   v2.8.0 — 2026-11-26 — Review round: the `operatorService` marker to approveDeviceAuth (S1), the
 *     re-approval gives the present entry words the request names (S8), a required entry's agent gets back
 *     what the approval set (S10), and an operator's switch during an approval answers NOT_APPROVED.
 *   v2.7.0 — 2026-11-26 — The notice's permission list leaves out the private read, which its own
 *     sentence states with the operator's reason.
 *   v2.6.0 — 2026-11-26 — Phase 2: the notice carries `required`, `private_read_reason`, `how_to_help` and
 *     their sentences (`off`, `private_read`, `help`); the notice that a service is required now; the
 *     operator's per-account switch stops an approval; the private read named in the audit and the trail.
 *   v2.5.0 — 2026-11-26 — The notice ends with whom to ask (`contact`, support@operators, the address the
 *     chat notice gives).
 *   v2.4.0 — 2026-11-26 — The write prefixes in the language's quotation marks (the `quoted` key), and
 *     `prefix_words` so the page quotes them in its own language.
 *   v2.3.0 — 2026-11-26 — The onboarding and its "Onboarding verification" test task that approveDeviceAuth
 *     starts are taken back for the service's agent (dropOnboarding), so no task waits in the person's list.
 *   v2.2.0 — 2026-11-26 — The notice carries the permission words (`scope_words`) and the operator's
 *     description, so the page says both in its own language; the description stands in a sentence of
 *     its own with a lead-in, and each write prefix is in quotation marks.
 *   v2.1.0 — 2026-11-26 — The notice's words in the person's language: notiftext.operator_service_on, or
 *     operator_service_on_fenced when the entry names write prefixes, with the description as `about`.
 *   v2.0.0 — 2026-11-26 — Reservation before the approval, completion with the proof, the rollback,
 *     the present words on a re-approval, and the notice marked only once stored (security review,
 *     D3, D5, D7).
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, DeviceAuthorizationRecord, AgentRecord } from '../../storage/interface.js';
import { approveDeviceAuth } from './device-auth-approve.js';
import { buildGAII, ownerGhiiOf } from '../../utils/gaii.js';
import { recordOperatorAction } from '../../services/operator/access-audit.js';
import { recordTrailEvent } from '../../services/place-trail.js';
import { notify } from '../../services/notify.js';
import { recipientLocale, fillNotifTemplate } from '../../services/notifications/recipient-words.js';
import { createT, type Locale } from '../../i18n.js';
import { plainPermission } from '../../services/permission-ask.js';
import { removeAgent } from '../../services/agents/remove-agent.js';
import { closeMcpSessionsForGaii } from '../../mcp/session-registry.js';
import { ACCOUNT_NOTE, type ProvisionDecision } from '../../services/operator-services/eligibility.js';
import { reserve, complete, clearReservation, markTold, readLine, type LedgerLine } from '../../services/operator-services/ledger.js';
import { proofOf } from '../../services/operator-services/proof.js';
import { recordSecurityIncident } from '../../services/security-incident.js';
import { announceOperatorServices } from '../../services/operator-services/events.js';
import { isRequired, privateReadGranted } from '../../services/operator-services/entries.js';
import { restoreRequiredControls } from '../../services/operator-services/required-restore.js';
import { OPERATOR_CONTACT } from '../../services/operator-services/required.js';
import { PRIVATE_READ_WORD } from '../../config/operator-services.js';
import { emitChange } from '../../services/event-bus.js';
import { logger } from '../../utils/logger.js';

type Approve = Extract<ProvisionDecision, { kind: 'approve' }>;

/** Test hooks: a forced interleaving or a forced failure. */
export interface ProvisionHooks {
  afterReserve?: () => Promise<void>;
  afterApprove?: () => Promise<void>;
  /** Stands in for the completing write. */
  complete?: typeof complete;
}

export type ProvisionOutcome = { ok: true; gaii: string } | { ok: false; status: number; code: string; message: string };

const RETRY ='The agent could not be set up this time and nothing was kept. Ask again.';

/** An operator's text as a sentence that ends once: the text may or may not carry its own full stop. */
const asSentence = (raw: string | undefined): string => {
  const text = (raw ?? '').trim();
  return text && !/[.!?]$/.test(text) ? `${text}.` : text;
};

/** A sentence from `notiftext.<key>` in `locale` with `vars` filled, or the English `fallback` while the locale has no such key. */
function sentenceIn(locale: Locale, key: string, fallback: string, vars: Record<string, string>): string {
  const tpl = createT(locale)(`notiftext.${key}`);
  return tpl !== `notiftext.${key}` ? fillNotifTemplate(tpl, vars) : fallback;
}

/**
 * The phase-2 parts of a notice: whether the service is required, why it reads private records (the
 * private-read exception) and how the person can help it. `vars` carries the raw values (`required`,
 * `private_read_reason`, `how_to_help`) and the sentences in the person's language (`off`,
 * `private_read`, `help`, each from its own notiftext key with an English fallback; `private_read`
 * and `help` are empty when they do not apply), so a body template places them whole.
 */
function policyParts(d: Approve, scopes: readonly string[], locale: Locale) {
  const required = isRequired(d.entry);
  const reads = privateReadGranted(d.entry) && scopes.includes(PRIVATE_READ_WORD);
  const reason = reads ? asSentence(d.entry.private_read_reason) : '';
  const help = asSentence(d.entry.how_to_help);
  const off = required
    ? sentenceIn(locale, 'operator_service_on.off_required', 'The operator requires it, so only the operator can turn it off.', {})
    : sentenceIn(locale, 'operator_service_on.off_self', 'You can turn it off for yourself at any time on your Agents page: remove its agent.', {});
  const privateRead = reason
    ? sentenceIn(locale, 'operator_service_on.private_read', `It also reads your private records. The operator says why: ${reason}`, { reason })
    : '';
  const helpText = help ? sentenceIn(locale, 'operator_service_on.how_to_help', `How you can help: ${help}`, { how_to_help: help }) : '';
  return {
    vars: {
      required: required ? 'true' : 'false', private_read_reason: reason, how_to_help: help,
      off, private_read: privateRead ? `${privateRead} ` : '', help: helpText ? `${helpText} ` : '',
    },
    off, privateRead, helpText,
  };
}

/** The one notice a person gets: marked told only after it was stored, so a failed one is tried at the next approval. Never throws. */
async function tellPersonOnce(storage: Storage, config: AimeatConfig, d: Approve, account: string, scopes: readonly string[]): Promise<void> {
  try {
    const line = await readLine(storage, config.nodeId, d.entry.id, account);
    if (!line || line.told_at) return;
    const ghii = `${account}@${config.nodeId}`;
    const locale = await recipientLocale(storage, ghii);
    // Each permission's sentence from the agent page, named in the language's quotation marks
    // (notiftext.operator_service_on.quoted), separated by semicolons.
    const quoted = createT(locale)('notiftext.operator_service_on.quoted');
    const policy = policyParts(d, scopes, locale);
    // The private read is said apart, in its own sentence with the operator's reason, never inside the list.
    const listed = policy.privateRead ? scopes.filter((w) => w !== PRIVATE_READ_WORD) : scopes;
    const may = listed.map((w) => plainPermission(w, locale) ?? w)
      .map((s) => fillNotifTemplate(quoted, { text: s.replace(/\.$/, '') })).join('; ');
    const description = asSentence(d.entry.description);
    // The operator's own words, in a sentence of their own with a lead-in in the person's language;
    // nothing when the entry has no description.
    const about = description ? `${fillNotifTemplate(createT(locale)('notiftext.operator_service_on.about'), { description })} ` : '';
    // Each prefix in the language's quotation marks, separated by commas, so a prefix's own final "."
    // never meets the sentence's.
    const rawPrefixes = d.entry.write_prefixes ?? [];
    const prefixes = rawPrefixes.map((p) => fillNotifTemplate(quoted, { text: p })).join(', ');
    const where = prefixes ? ` As you, it writes in your memory only under keys that begin with: ${prefixes}.` : '';
    const r = await notify(storage, ghii, {
      type: 'operator_service_on',
      title: `${d.entry.display_name} is switched on for you`,
      // The same words as notiftext.operator_service_on(_fenced).body: the person's own account, which is
      // true whether the entry's audience is everyone or named accounts.
      body: `The operator switched ${d.entry.display_name} on for your account, so it now has an agent there. ${about}Its permissions: ${may}.${where} ${policy.vars.private_read}${policy.vars.help}${policy.off} You can ask the operator more with a message to ${OPERATOR_CONTACT}.`,
      link: '/v1/profile?tab=agents',
      // Two texts, so a language never has to say "it writes under" with nothing after it. The stored
      // words are the person's stored language (push and email send them); the page says the notice
      // again in its own language from `scope_words` and `description` (js/services/notifications.js).
      i18n: {
        key: prefixes ? 'operator_service_on_fenced' : 'operator_service_on',
        vars: {
          service: d.entry.display_name, about, description, permissions: may, scope_words: listed.join(','),
          write_prefixes: prefixes, prefix_words: rawPrefixes.join(','), contact: OPERATOR_CONTACT,
          ...policy.vars,
        },
      },
    });
    if (r.stored) await markTold(storage, config.nodeId, d.entry.id, account);
  } catch (err) {
    logger.warn('operator services: the person was not told of the new agent; the next approval tries again', { service: d.entry.id, account, error: String(err) });
  }
}

/**
 * The notice for a person who had turned the service off and gets its agent again because the entry
 * is required now. Once per such approval: the line goes from `removed` to `active` only here. Never throws.
 */
async function tellRequiredNow(storage: Storage, config: AimeatConfig, d: Approve, account: string, scopes: readonly string[]): Promise<void> {
  try {
    const ghii = `${account}@${config.nodeId}`;
    const locale = await recipientLocale(storage, ghii);
    const description = asSentence(d.entry.description);
    const policy = policyParts(d, scopes, locale);
    const about = description ? `${description} ` : '';
    await notify(storage, ghii, {
      type: 'operator_service_required',
      title: `${d.entry.display_name} is now required`,
      // The same words as notiftext.operator_service_required.body.
      body: `You turned ${d.entry.display_name} off earlier. The operator now requires it, so it has an agent in your account again, and only the operator can turn it off. ${about}${policy.vars.private_read}${policy.vars.help}You can ask the operator more with a message to ${OPERATOR_CONTACT}.`,
      link: '/v1/profile?tab=agents',
      i18n: {
        key: 'operator_service_required',
        vars: { service: d.entry.display_name, description, scope_words: scopes.join(','), contact: OPERATOR_CONTACT, ...policy.vars },
      },
    });
  } catch (err) {
    logger.warn('operator services: the person was not told the service is required now', { service: d.entry.id, account, error: String(err) });
  }
}

/**
 * The Hello Integration onboarding and its test task that approveDeviceAuth starts for every new
 * agent, taken back for an operator service's agent: a service does not onboard through a person's
 * account, and its "Onboarding verification" task would wait in the person's list with nobody to do
 * it. Only the test task the onboarding record names is removed. Never throws: a leftover is the
 * old behaviour, not a fault.
 */
async function dropOnboarding(storage: Storage, gaii: string): Promise<void> {
  try {
    const onboarding = await storage.getOnboarding(gaii);
    const testTaskId = onboarding?.steps?.find((s) => s.id === 'accept_test_task')?.details?.testTaskId;
    // The test task is created active, and a delete takes only a task that is not running: it is
    // set aside (declined) first, then removed with its events.
    if (typeof testTaskId === 'string') {
      await storage.updateAgentTask(testTaskId, { status: 'declined' });
      await storage.deleteAgentTask(testTaskId);
    }
    if (onboarding) await storage.deleteOnboarding(gaii);
    emitChange('agent-onboarding');
  } catch (err) {
    logger.warn('operator services: the onboarding of the service\'s agent was not taken back', { gaii, error: String(err) });
  }
}

/**
 * Undo what an approval made: the agent this approval made or connected (the same record: its createdAt
 * did not change since), its onboarding record and its test task. The account's feed line may stay.
 * An agent the person made in the meantime under the name has another createdAt and is left alone.
 */
async function rollBack(storage: Storage, config: AimeatConfig, account: string, agentName: string, made: AgentRecord | null): Promise<void> {
  const live = made ? await storage.getAgent(made.gaii) : null;
  if (!live || live.createdAt !== made!.createdAt) return;
  const { tasks } = await storage.listAgentTasks(live.gaii);
  for (const t of tasks) await storage.deleteAgentTask(t.id);
  await storage.deleteOnboarding(live.gaii);
  const out = await removeAgent({ storage, config, closeMcpSessions: closeMcpSessionsForGaii },
    { owner: account, principal: account, ownerInPerson: true }, agentName, { operatorServiceLine: 'leave' });
  if (!out.ok) throw new Error(`the agent ${live.gaii} could not be removed: ${out.message}`);
}

/** Approve one request the operator-service decision approved. */
export async function approveForOperatorService(
  config: AimeatConfig, storage: Storage, d: Approve, request: DeviceAuthorizationRecord, callerGaii: string,
  userAgent: string | undefined, hooks: ProvisionHooks = {},
): Promise<ProvisionOutcome> {
  const account = request.ownerName;
  const id = d.entry.id;
  const gaii = buildGAII(request.agentName, account, config.nodeId);
  const nonce = randomUUID();

  // 1. The reservation, before anything is made.
  // A required entry reserves over the person's earlier off; the operator's own switch still holds.
  const r = await reserve(storage, config.nodeId, id, account, gaii, nonce, callerGaii, isRequired(d.entry));
  if (r.outcome === 'removed' || r.outcome === 'operator_off') return { ok: false, status: 409, code: 'NOT_APPROVED', message: ACCOUNT_NOTE };
  if (r.outcome === 'busy') return { ok: false, status: 409, code: 'BUSY', message: 'Another request for this account is being approved. Ask again in a moment.' };
  const reservation = r.after!;
  await hooks.afterReserve?.();

  // 2. The approval. What it gives an agent the service made before: the entry's present words the
  //    request names, or all of them when it names none (d.scopes, decided in eligibility.ts), plus what
  //    the person added themselves. A widened entry reaches the agent at its next request; a narrowed one
  //    takes the word back (S8).
  const present = d.entry.allowedScopes;
  const heldBefore = d.existing ? (await storage.getAgent(gaii))?.defaultScopes ?? [] : [];
  const prevGiven = r.before?.given ?? present;
  const personAdded = heldBefore.filter((w) => !prevGiven.includes(w));
  const entryWords = d.scopes.filter((w) => present.includes(w));
  // A service's agent goes through no person's onboarding: what approveDeviceAuth starts for an agent
  // that had none is taken back right after it (dropOnboarding), so no test task waits in the list.
  const hadOnboarding = !!(await storage.getOnboarding(gaii));
  let result: Awaited<ReturnType<typeof approveDeviceAuth>>;
  try {
    result = await approveDeviceAuth(
      config, storage, request, callerGaii,
      d.existing ? [...new Set([...entryWords, ...personAdded])] : d.scopes, userAgent, true,
      d.existing ? [...new Set([...present, ...personAdded])] : present,
      // The one branch that may connect a service's agent again with a new key (S1).
      { operatorService: true },
    );
  } catch (err) {
    await clearReservation(storage, config.nodeId, id, account, nonce, r.before);
    throw err;
  }
  if (!result.ok) {
    await clearReservation(storage, config.nodeId, id, account, nonce, r.before);
    return result;
  }
  await hooks.afterApprove?.();
  if (!hadOnboarding) await dropOnboarding(storage, result.gaii);

  // 3. Completion with the proof of the agent that exists now.
  const made = await storage.getAgent(result.gaii);
  const given = (result.existing ? entryWords : d.scopes).filter((w) => made?.defaultScopes?.includes(w));
  let completed = false;
  try {
    completed = !!made && (await (hooks.complete ?? complete)(storage, config.nodeId, id, account, nonce, proofOf(made), given)).ok;
  } catch (err) {
    logger.error('operator services: the ledger line could not be completed; the approval is rolled back', { service: id, account, error: String(err) });
  }
  if (!completed) {
    // The line is no longer our reservation (the person turned the service off), or the write failed.
    // The device-authorization row first, so no poll collects the credential, then the agent.
    await storage.updateDeviceAuth(request.deviceCode, { status: 'denied', agentCredentials: undefined });
    // Turned off meanwhile: by the person, or by the operator's switch for this account.
    const lineNow = await readLine(storage, config.nodeId, id, account);
    const turnedOff = lineNow?.state === 'removed' || !!lineNow?.operator_off;
    // An agent connected again whose line could not be completed goes too: its key was rotated, and a
    // line that does not name its new key would never prove it the service's again.
    const restore: LedgerLine | null = result.existing
      ? { gaii: reservation.gaii, at: reservation.at, state: 'ended', ...(reservation.told_at ? { told_at: reservation.told_at } : {}) }
      : r.before;
    try {
      await clearReservation(storage, config.nodeId, id, account, nonce, restore);
      await rollBack(storage, config, account, request.agentName, made);
    } catch (err) {
      await recordSecurityIncident(storage, config, {
        type: 'operator_service', code: 'ROLLBACK_INCOMPLETE', actorGhii: ownerGhiiOf(callerGaii), source: 'operator_service_provision',
        detail: `An approval of the operator service ${id} for ${account}@${config.nodeId} could not be completed, and undoing it failed: ${String(err)}. `
          + 'The next request or the sweep at the next start clears the reservation; remove the agent on the person\'s Agents page if it is still there.',
      });
    }
    return turnedOff
      ? { ok: false, status: 409, code: 'NOT_APPROVED', message: ACCOUNT_NOTE }
      : { ok: false, status: 503, code: 'RETRY', message: RETRY };
  }

  // A required entry: what the person set before it became required is put back as this approval set it (S10).
  if (isRequired(d.entry) && made) await restoreRequiredControls(storage, config, made, { by: callerGaii });

  // 4. The notice, the operator action, the trail line, the event.
  const held = made?.defaultScopes ?? [];
  const scopes = held.join(', ');
  // The private read, named wherever the approval is recorded: the word the entry gave (`given`) and
  // the reason every covered person is told.
  const privateRead = privateReadGranted(d.entry) && given.includes(PRIVATE_READ_WORD);
  if (d.requiredNow) await tellRequiredNow(storage, config, d, account, held);
  else await tellPersonOnce(storage, config, d, account, held);
  await recordOperatorAction(storage, config, {
    operatorGhii: ownerGhiiOf(callerGaii), actorGaii: callerGaii, ownerOf: `${account}@${config.nodeId}`,
    area: 'operator-service', action: result.existing ? 'reconnect' : 'provision', subject: id,
    data: { scopes, ...(privateRead ? { private_read: PRIVATE_READ_WORD, private_read_reason: d.entry.private_read_reason ?? '' } : {}),
      ...(isRequired(d.entry) ? { required: 'true' } : {}) },
  });
  recordTrailEvent({
    actor: callerGaii, code: 'POST /v1/agents/device-authorize', target: result.gaii, event: 'agent.approved',
    detail: `The operator service ${id} set up the agent of ${account}@${config.nodeId} with ${scopes}.`
      + (privateRead ? ` It reads the person's private records (${PRIVATE_READ_WORD}), as the operator gave it.` : ''),
  });
  await announceOperatorServices(storage, config);
  return { ok: true, gaii: result.gaii };
}
