/**
 * @file src/services/decide/gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE GATE: a decision rule bound to an action an agent is about to take, and the
 *   per-agent switch that says whether the node holds the agent to it.
 *
 *   WHAT IT DOES. With the gate on, an agent that runs a rule and gets an outcome under the act band
 *   (`ask` or `stop`) is told NOT to proceed, and the owner gets an item on their open-items list
 *   that names what the agent wanted to do and what the model answered. With the gate off the agent
 *   is told it may proceed whatever the outcome was. The decision is recorded either way, with the
 *   same outcome, so an unguarded run can be compared with a guarded one afterwards.
 *
 *   OFF BY DEFAULT, AND THAT IS THE DESIGN. A comparison run needs an agent that acts unguarded, or
 *   there is nothing to compare the gate against. A rule's own `gate` field is what the switch
 *   starts at for an agent whose owner never touched it, and that field defaults to false.
 *
 *   THE SWITCH has three positions per agent, kept in ONE record, `decide.agents` (reserved prefix;
 *   one collection read as a unit, not a key per agent): `on` holds the agent to every rule it runs,
 *   `off` holds it to none, and absent means each rule's own default applies.
 *
 *   THE NODE DOES NOT PERFORM THE ACTION, so it cannot physically stop it. What it controls is the
 *   answer: `proceed: false`, a task for the owner, and a record that says the gate stopped it. An
 *   agent that acts anyway has done so against a recorded instruction.
 *
 *   ONLY AGENTS ARE GATED. An app reads the outcome and its own code decides; the owner in person is
 *   the one the gate would ask.
 * @structure GateSetting · readAgentGates · gateSettingOf · writeAgentGate · gateApplies · openGateItem
 * @usage
 *   const on = gateApplies(await gateSettingOf(storage, ownerGhii, agent), rule);
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial: decision rules on the node.
 */
import type { Storage, AiDecisionAnswer, AiDecisionOutcome } from '../../storage/interface.js';
import { upsertPrivateRecord } from '../private-record.js';
import { emitChange } from '../event-bus.js';
import { addItem } from '../open-items.js';
import { logger } from '../../utils/logger.js';
import { DecideError } from './errors.js';
import type { DecisionRule } from './rule-validate.js';

export const DECIDE_AGENTS_RECORD = 'decide.agents';

/** `rule` is "nobody has said": each rule's own `gate` default applies. */
export type GateSetting = 'on' | 'off' | 'rule';

interface AgentsRecord { agents: Record<string, { gate?: 'on' | 'off' }> }

export async function readAgentGates(storage: Storage, ownerGhii: string): Promise<Record<string, GateSetting>> {
  const v = (await storage.getMemory(ownerGhii, DECIDE_AGENTS_RECORD))?.value as AgentsRecord | undefined;
  const out: Record<string, GateSetting> = {};
  for (const [name, a] of Object.entries(v?.agents ?? {})) {
    if (a?.gate === 'on' || a?.gate === 'off') out[name] = a.gate;
  }
  return out;
}

export async function gateSettingOf(storage: Storage, ownerGhii: string, agent: string): Promise<GateSetting> {
  return (await readAgentGates(storage, ownerGhii))[agent] ?? 'rule';
}

/** Set one agent's switch. `rule` (or null) takes it back to "each rule's own default". */
export async function writeAgentGate(storage: Storage, ownerGhii: string, agent: string, setting: unknown): Promise<GateSetting> {
  if (setting !== 'on' && setting !== 'off' && setting !== 'rule' && setting !== null) {
    throw new DecideError('INVALID_BODY', 400, "gate is 'on', 'off' or 'rule' (each rule's own default).");
  }
  const rec = (await storage.getMemory(ownerGhii, DECIDE_AGENTS_RECORD))?.value as AgentsRecord | undefined;
  const agents = { ...(rec?.agents ?? {}) };
  if (setting === 'on' || setting === 'off') agents[agent] = { ...(agents[agent] ?? {}), gate: setting };
  else delete agents[agent];
  await upsertPrivateRecord(storage, ownerGhii, DECIDE_AGENTS_RECORD, { agents }, ['decide', 'gate']);
  emitChange('agents', ownerGhii);
  return setting === 'on' || setting === 'off' ? setting : 'rule';
}

/** Is this agent held to this rule. */
export function gateApplies(setting: GateSetting, rule: Pick<DecisionRule, 'gate'>): boolean {
  return setting === 'on' || (setting === 'rule' && rule.gate);
}

/** One answer in a few words, for the title of the owner's item. */
function answerWords(id: string, a: AiDecisionAnswer): string {
  if (a.type === 'noul') return `${id}: ${Math.round(Number(a.value) * 100)} %`;
  const sure = typeof a.confidence === 'number' ? ` (${Math.round(a.confidence * 100)} % sure)` : '';
  return `${id}: ${String(a.value)}${sure}`;
}

/**
 * The owner's task for a stopped action. Returns the item id, or undefined when the list is full or
 * the write failed: the agent is still told not to proceed, and the record still says it was stopped.
 */
export async function openGateItem(
  storage: Storage, ownerGhii: string,
  what: { rule: DecisionRule; agentGaii: string; outcome: AiDecisionOutcome; decisionId: string; subject: string | null; answers: Record<string, AiDecisionAnswer> },
): Promise<string | undefined> {
  const agentName = what.agentGaii.split('#')[0];
  const read = Object.keys(what.rule.thresholds).filter(q => what.answers[q]).map(q => answerWords(q, what.answers[q])).join(', ');
  const about = what.subject ? ` about ${what.subject}` : '';
  // The open-items title holds 200 characters: who, what, and what the model read, in that order,
  // so a cut takes the numbers and not the question.
  const title = `${agentName} waits for you${about}: ${what.rule.decides} (${read})`;
  try {
    const item = await addItem(storage, ownerGhii, {
      title: title.slice(0, 200), kind: 'decision', origin: what.agentGaii,
      object: { type: 'ai-decision', id: what.decisionId }, by: 'ai',
    });
    if (item) emitChange('open-items', ownerGhii);
    return item?.id;
  } catch (err) {
    logger.warn('[decide] the gate stopped an action and could not put it on the owner\'s list', {
      owner: ownerGhii, decision: what.decisionId, error: String(err),
    });
    return undefined;
  }
}
