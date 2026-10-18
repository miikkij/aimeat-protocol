/**
 * @file src/services/classification/default-caps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The default audience caps of decision 10.1 (plan doc-mvdipuyqraas, L5.1): a new node
 *   takes them from its first start; a node that ran before is offered them on the operator's Security
 *   page and takes each one only when the operator approves it.
 *
 *   NEW OR RUNNING, ON EVIDENCE. settleDefaultCapsAtStart() runs once per node, at start, before any
 *   request is served, and records what it found (default-caps-state.ts):
 *     - no stored node policy and no account at all: the node is new. Its default labels carry the
 *       caps from now on (policy.ts readNodePolicy).
 *     - a stored node policy, or any account: the node ran before. Its classifications keep what they
 *       have. Each default label still without a cap is offered on ONE Security page incident
 *       (`classification_default_caps`), with a decision per label on REST, MCP and the page.
 *   The start never stops on this: a failure is logged and the next start tries again.
 *
 *   THE DECISION. decideDefaultCap(): "apply" writes the cap onto the label in the node's stored
 *   policy (a node with no stored policy stores its default labels with that one cap) and adds a line
 *   to the policy's history; "keep" leaves the label as it is. A label that has a cap of its own by
 *   then keeps it, and a label the operator removed is not put back. The incident closes with the
 *   last decision.
 *
 *   NOTHING ELSE CHANGES (decision 10.3, L5.2). Approving a cap writes the policy only. Content
 *   already shown wider than the cap keeps its level: the lowering of L3.4 runs when a LABEL of
 *   content rises (audience-settle.ts, onLabelRaised), never on a policy change, and the exposure
 *   report lists what is over a cap. A later change that widens such content is refused as usual.
 * @structure DEFAULT_CAPS_INCIDENT_TYPE · settleDefaultCapsAtStart() · decideDefaultCap() · DecideCapResult
 * @usage
 *   await settleDefaultCapsAtStart(config, storage);        // server-bootstrap/config-init.ts
 *   await decideDefaultCap(config, storage, { incidentId, name: 'sisainen', resolution: 'apply', by });
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L5.1, L5.2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { emitChange } from '../event-bus.js';
import {
  findSecurityIncident, listSecurityIncidents, recordSecurityIncident, saveSecurityIncident,
  type IncidentCapOffer, type SecurityIncidentValue,
} from '../security-incident.js';
import { DEFAULT_LABEL_CAPS, DEFAULT_LABELS, defaultPolicy } from './defaults.js';
import { DEFAULT_CAPS_KEY, type DefaultCapsState } from './default-caps-state.js';
import { AUDIENCE_LEVEL_WORDS, isAudienceLevel } from './audience-levels.js';
import { validateNodePolicy } from './levels.js';
import { NODE_POLICY_KEY, type PolicyChange } from './policy.js';

export const DEFAULT_CAPS_INCIDENT_TYPE = 'classification_default_caps';

const HISTORY = 50;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The stored node policy as it is stored, or null when the node has none. */
async function storedNodePolicy(storage: Storage, system: string): Promise<Record<string, unknown> | null> {
  const v = (await storage.getMemory(system, NODE_POLICY_KEY))?.value;
  return isObj(v) && isObj(v.policy) ? v.policy : null;
}

/** The English name of a label, from the stored labels or the defaults. */
function labelName(id: string, labels: unknown[] | null): string {
  const raw = labels?.find(l => isObj(l) && l.id === id) as Record<string, unknown> | undefined;
  const n = isObj(raw?.name) ? raw!.name as Record<string, unknown> : null;
  return typeof n?.en === 'string' ? n.en : DEFAULT_LABELS.find(l => l.id === id)?.name.en ?? id;
}

/** The operator's words on the incident: what is offered, what changes, how to decide. */
function offerDetail(offers: IncidentCapOffer[]): string {
  const list = offers.map(o => `${o.name} (${o.label}): at most ${AUDIENCE_LEVEL_WORDS[o.max_audience as keyof typeof AUDIENCE_LEVEL_WORDS] ?? o.max_audience}`).join('; ');
  return 'This server ran before a classification could limit who may see its content. '
    + `The default classifications now come with these limits: ${list}. `
    + 'Nothing changes until you decide. For each classification, "apply" puts its limit on and "keep" leaves it without one. '
    + 'Content already shown more widely than a limit keeps its level; the "What others can see" report lists it. '
    + 'Decide each one with POST /v1/admin/security/incidents/<id>/resolve and { "name": "<classification id>", "resolution": "apply" | "keep" }, '
    + 'or aimeat_admin_incident_resolve. The limits matter only while classification is on (AIMEAT_CLASSIFICATION).';
}

/**
 * Decide, once, whether this node is new or ran before, and record it. A node that ran before gets
 * one Security page incident offering each default label's cap it does not have. Never throws.
 */
export async function settleDefaultCapsAtStart(config: Pick<AimeatConfig, 'nodeId'>, storage: Storage): Promise<void> {
  const system = `system@${config.nodeId}`;
  try {
    if (await storage.getMemory(system, DEFAULT_CAPS_KEY)) return;
    const policy = await storedNodePolicy(storage, system);
    const accounts = (await storage.listOwners()).length;
    const at = new Date().toISOString();
    let state: DefaultCapsState;
    if (!policy && accounts === 0) {
      state = { node: 'new', at, evidence: 'no stored node policy and no account', offered: [], incident: null };
    } else {
      const labels = policy && Array.isArray(policy.labels) ? policy.labels as unknown[] : null;
      const offers: IncidentCapOffer[] = [];
      for (const [id, cap] of Object.entries(DEFAULT_LABEL_CAPS)) {
        if (!cap) continue;
        if (labels) {
          const raw = labels.find(l => isObj(l) && l.id === id) as Record<string, unknown> | undefined;
          // Gone from the operator's policy, or capped by the operator already: nothing to offer.
          if (!raw || isAudienceLevel(raw.maxAudience)) continue;
        }
        offers.push({ label: id, name: labelName(id, labels), max_audience: cap, status: 'open' });
      }
      let incident: string | null = null;
      if (offers.length) {
        // A start that opened the incident and stopped before the record was written finds it here.
        const open = (await listSecurityIncidents(storage, config as AimeatConfig)).items
          .find(i => i.type === DEFAULT_CAPS_INCIDENT_TYPE && i.status === 'open');
        incident = open?.id ?? (await recordSecurityIncident(storage, config, {
          type: DEFAULT_CAPS_INCIDENT_TYPE, code: 'DEFAULT_CAPS_OFFERED', actorGhii: system, actorName: 'classification',
          detail: offerDetail(offers), source: 'start', caps: offers,
        })).id;
        emitChange('security');
      }
      state = {
        node: 'running', at,
        evidence: policy ? 'a stored node policy' : `${accounts} account${accounts === 1 ? '' : 's'} and no stored node policy`,
        offered: offers.map(o => o.label), incident,
      };
    }
    await storage.setMemory({
      key: DEFAULT_CAPS_KEY, ownerGaii: system, value: state, visibility: 'private', tags: ['classification-policy'],
      ttlHours: null, version: 1, createdAt: at, updatedAt: at,
    });
    if (state.node === 'running' && state.offered.length) {
      logger.info(`[classification] This node ran before default audience caps existed; ${state.offered.length} cap(s) wait for the operator on the Security page.`);
    }
  } catch (err) {
    logger.warn('classification: the default audience caps could not be settled at start; the next start tries again', { error: String(err) });
  }
}

export type DecideCapResult =
  | {
    ok: true; name: string; resolution: 'apply' | 'keep'; label_name: string; max_audience: string;
    /** What the decision did: applied, kept, own-cap (the label had a cap of its own) or no-label. */
    outcome: NonNullable<IncidentCapOffer['done']>; incident_status: 'open' | 'resolved';
  }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_INPUT' | 'CONFLICT'; message: string };

/**
 * Put `cap` on label `id` in the node's stored policy, with a line in its history. Answers what it
 * did: the cap put on, the label had a cap of its own, or the label is not in the policy.
 */
async function applyCap(storage: Storage, nodeId: string, id: string, cap: string, by: { principal: string; kind: 'human' | 'ai' }): Promise<'applied' | 'own-cap' | 'no-label'> {
  const system = `system@${nodeId}`;
  const existing = await storage.getMemory(system, NODE_POLICY_KEY);
  const rec = isObj(existing?.value) ? existing!.value as Record<string, unknown> : {};
  const stored = isObj(rec.policy) ? rec.policy : null;
  // A node with no stored policy stores its default labels: the rest of the policy keeps following
  // the code's defaults (policy.ts reads a stored policy over them).
  const labels = (stored && Array.isArray(stored.labels) ? stored.labels : defaultPolicy().labels) as Array<Record<string, unknown>>;
  const at = labels.findIndex(l => isObj(l) && l.id === id);
  if (at < 0) return 'no-label';
  if (isAudienceLevel(labels[at]!.maxAudience)) return 'own-cap';
  const nextLabels = labels.map((l, i) => (i === at ? { ...l, maxAudience: cap } : l));
  const policy = { ...(stored ?? {}), labels: nextLabels };
  // The whole policy as it will be read must still pass; a cap only narrows, so it does.
  validateNodePolicy({ ...defaultPolicy(), ...policy });
  const now = new Date().toISOString();
  const change: PolicyChange = { at: now, by: by.principal, source: by.kind, action: 'set', humanSaid: `default audience cap of ${id} approved on the Security page` };
  const history = [...(Array.isArray(rec.history) ? rec.history as PolicyChange[] : []), change].slice(-HISTORY);
  await storage.setMemory({
    key: NODE_POLICY_KEY, ownerGaii: system, value: { policy, history, proposal: rec.proposal ?? null },
    visibility: 'private', tags: ['classification-policy'], ttlHours: null,
    version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
  emitChange('classification');
  return 'applied';
}

/**
 * The operator's decision on one offered cap: "apply" or "keep". Deciding a cap the way it was decided
 * already answers what that decision did; deciding it the other way is a CONFLICT. The incident closes
 * with the last decision. Changes the node's policy only; no content's level (decision 10.3).
 */
export async function decideDefaultCap(
  config: Pick<AimeatConfig, 'nodeId'>, storage: Storage,
  input: { incidentId: string; name: string; resolution: string; by: { principal: string; kind: 'human' | 'ai' } },
): Promise<DecideCapResult> {
  if (input.resolution !== 'apply' && input.resolution !== 'keep') {
    return { ok: false, code: 'INVALID_INPUT', message: 'resolution is "apply" (the classification gets the offered limit) or "keep" (it stays without one).' };
  }
  const resolution = input.resolution;
  const rec = await findSecurityIncident(storage, config as AimeatConfig, input.incidentId);
  if (!rec) return { ok: false, code: 'NOT_FOUND', message: 'Incident not found' };
  const value = rec.value as SecurityIncidentValue;
  const entry = value.caps?.find(c => c.label === input.name);
  if (!entry) return { ok: false, code: 'NOT_FOUND', message: `This incident offers no limit for a classification "${input.name}".` };
  const answer = (done: NonNullable<IncidentCapOffer['done']>, status: 'open' | 'resolved'): DecideCapResult => ({
    ok: true, name: entry.label, resolution, label_name: entry.name, max_audience: entry.max_audience, outcome: done, incident_status: status,
  });
  if (entry.status !== 'open') {
    if (entry.status === resolution && entry.done) return answer(entry.done, value.status === 'open' ? 'open' : 'resolved');
    return { ok: false, code: 'CONFLICT', message: `"${entry.label}" was decided as "${entry.status}" on ${entry.decidedAt ?? 'an earlier day'}.` };
  }
  const done = resolution === 'apply' ? await applyCap(storage, config.nodeId, entry.label, entry.max_audience, input.by) : 'kept';
  const now = new Date().toISOString();
  const caps = (value.caps ?? []).map((c): IncidentCapOffer => (c.label === entry.label ? { ...c, status: resolution, decidedAt: now, decidedBy: input.by.principal, done } : c));
  const closed = caps.every(c => c.status !== 'open');
  await saveSecurityIncident(storage, rec, { ...value, caps, ...(closed ? { status: 'resolved', resolvedAt: now } : {}) });
  return answer(done, closed ? 'resolved' : 'open');
}
