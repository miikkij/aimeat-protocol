/**
 * @file src/services/classification/switch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's classification switch (config `classification.mode`: off, owner or all)
 *   changed by an operator, and every change of it kept in the classification audit log (TARGET-082
 *   review). Two endpoints change it: PUT /v1/admin/config (the admin Config page) and
 *   PUT /v1/classification/switch, which the MCP action `switch_set` of aimeat_classification uses on
 *   all three surfaces. Both ask this file, so the rules below are written once.
 *
 *   WHO. An operator: the operator in person, or the operator's agent holding the operator:admin
 *   permission (services/operator-principal.ts). A sealed setting is refused before anything else.
 *
 *   WHAT WAITS FOR A PERSON. Turning classification off, or from every owner's content (all) to
 *   each owner's choice (owner), gives protection away. An AI credential (reader-kind.ts: an agent,
 *   a personal access token, an unattended run) is refused that change with PERSON_REQUIRED: the
 *   operator makes it on the admin Config page, signed in themselves. Turning it on, or from owner
 *   to all, applies at once from anyone who may change it.
 *
 *   THE RECORD. One audit row per change: action `changed`, key `classification.mode`, label the
 *   new mode, purpose `<from> → <to>`, scope `system@<node>` (the identity that holds the node's
 *   policy), no owner, so the node-level log (an operator's) shows it and no owner's log does.
 * @structure CLASSIFICATION_MODE_PATH · SwitchCaller · switchLoosens() · switchRefusal() ·
 *   recordSwitchChange() · setClassificationSwitch()
 * @usage
 *   const out = await setClassificationSwitch({ storage, config }, { auth: req.auth!, scopes }, 'all');
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 review: the switch over MCP, and recorded).
 */
import type { AimeatConfig } from '../../config.js';
import type { ClassificationMode } from '../../config-data-access.js';
import type { Storage } from '../../storage/interface.js';
import type { ConfigProvenance } from '../config-provenance.js';
import { applyConfigChanges } from '../config-apply.js';
import { isSealed, sealRefusal } from '../config-sealing.js';
import { emitChange } from '../event-bus.js';
import { askOperator } from '../operator-principal.js';
import { callerPrincipal } from '../../utils/gaii.js';
import { recordClassificationAudit } from './audit.js';
import { ClassificationError } from './labels.js';
import { readerKindOf } from './reader-kind.js';

/** The config path of the switch. */
export const CLASSIFICATION_MODE_PATH = 'classification.mode';

const MODES: readonly ClassificationMode[] = ['off', 'owner', 'all'];

/** The credential that asks for the change, as a request or a tool session carries it. */
export interface SwitchCaller {
  sub: string;
  owner: string;
  roles: string[];
  scopes?: string[];
  federated?: boolean;
  anonymous?: boolean;
  via?: string;
  app_grant?: string;
  app?: string;
}

/** Whether moving the switch from `from` to `to` gives protection away. */
export function switchLoosens(from: string, to: string): boolean {
  return (to === 'off' && from !== 'off') || (from === 'all' && to === 'owner');
}

/**
 * The refusal an AI credential gets for a loosening switch change, or null when the change may
 * proceed. A person's own session is never refused here.
 */
export function switchRefusal(caller: SwitchCaller, from: string, to: string): ClassificationError | null {
  if (!switchLoosens(from, to) || readerKindOf(caller) === 'human') return null;
  return new ClassificationError('PERSON_REQUIRED', 403,
    `Changing classification from ${from} to ${to} gives protection away, so an AI does not make it. The operator makes it on the admin Config page, signed in themselves.`);
}

/** Keep one switch change in the audit log. Never throws, never awaits (audit.ts). */
export function recordSwitchChange(nodeId: string, caller: SwitchCaller, from: string, to: string): void {
  const kind = readerKindOf(caller);
  recordClassificationAudit({
    scope: `system@${nodeId}`, ownerGaii: null, kind: 'memory', key: CLASSIFICATION_MODE_PATH, label: to,
    reader: callerPrincipal(caller, nodeId), readerKind: kind === 'anonymous' ? 'ai' : kind,
    action: 'changed', purpose: `${from} → ${to}`,
  });
}

export interface SwitchResult {
  applied: boolean;
  mode: ClassificationMode;
  from: ClassificationMode;
}

/**
 * Set the node's classification switch. Refuses, in this order: an unknown mode, a caller who is not
 * the operator, a sealed setting, and an AI's loosening. The durable write happens through
 * applyConfigChanges, as on the admin Config page, and the change is recorded.
 */
export async function setClassificationSwitch(
  deps: { storage: Storage; config: AimeatConfig; provenance?: ConfigProvenance },
  caller: SwitchCaller, mode: unknown,
): Promise<SwitchResult> {
  const { storage, config } = deps;
  if (typeof mode !== 'string' || !MODES.includes(mode as ClassificationMode)) {
    throw new ClassificationError('INVALID_INPUT', 400, 'mode is off, owner or all.');
  }
  const next = mode as ClassificationMode;
  const answer = await askOperator(storage, caller);
  if (!answer.ok) {
    throw new ClassificationError('OPERATOR_REQUIRED', 403, answer.why === 'needs-word'
      ? "Only an operator changes the classification switch. An operator's agent needs the \"operator:admin\" permission, which the operator ticks for it; \"Full access\" does not include it."
      : 'Only an operator of this server changes the classification switch.');
  }
  if (isSealed(config, CLASSIFICATION_MODE_PATH)) {
    const r = sealRefusal(CLASSIFICATION_MODE_PATH);
    throw new ClassificationError(r.code, 403, r.message);
  }
  const from = config.classificationMode;
  if (from === next) return { applied: false, mode: next, from };
  const refusal = switchRefusal(caller, from, next);
  if (refusal) throw refusal;
  const { errors } = await applyConfigChanges(deps, [{ path: CLASSIFICATION_MODE_PATH, value: next }]);
  if (errors.length) {
    throw new ClassificationError('NOT_SAVED', 500, errors.map(e => e.reason).join(' '));
  }
  recordSwitchChange(config.nodeId, caller, from, next);
  emitChange('config');
  emitChange('classification');
  return { applied: true, mode: next, from };
}
