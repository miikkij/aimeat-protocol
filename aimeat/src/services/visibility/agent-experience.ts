/**
 * @file src/services/visibility/agent-experience.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What AI agents meet at the owner's place (layer C), the part a browser script cannot
 *   see: an agent's rage click is a tool call that failed or a checkout that stopped. Two sources,
 *   both counted into the owner's month record by the visibility counter:
 *   - outside agents' calls to the owner's tools, from the usage stream every metered call already
 *     goes through (services/usage/usage-buffer.ts): a sold app tool (`apptool`), an extension,
 *     capability or exchange call naming the owner as the provider, and an attached remote MCP server of the owner
 *     (`mcp-remote`) used by somebody else's agent;
 *   - agents' checkouts by stage, from the checkout code itself (recordCheckoutStage).
 *
 *   NO AGENT IS NAMED. An agent is counted under its family (the AI it is: claude, chatgpt, copilot
 *   …) as read from its own name or the platform it came from, never under its identity, and a
 *   reason is kept as the code the node answered, never the input.
 *
 *   ONE READABLE LINE PER FINDING, in English, built from the counts so the owner's AI can say it in
 *   the owner's language: "A copilot agent tried to buy 14 times; 9 checkouts failed at payment
 *   (payment_failed)."
 * @structure watchAgentCalls · agentExperienceSection · stageOfCode (agentFamilyOf is in attribution.ts)
 * @usage watchAgentCalls(storage, config); report.agents = agentExperienceSection(sum)
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer C).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { UsageCallRecord } from '../../storage/types/usage.js';
import type { VisibilityDay } from '../../models/visibility-schemas.js';
import { onUsageRecorded } from '../usage/usage-buffer.js';
import { agentFamilyOf } from './attribution.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { recordAgentCall, nodeWatchesAgents } from './visibility-counter.js';

/** Surfaces whose usage record names the selling owner as the counterparty. */
const PROVIDER_SURFACES = new Set(['apptool', 'capability', 'exchange', 'extension']);
const watched = new WeakSet<Storage>();

/**
 * Count, for the owner whose tool it was, every call an outside agent makes to it. Registered once
 * per storage; a call by the owner's own agents, or by a person, is not an outside agent's.
 */
export function watchAgentCalls(storage: Storage, config: AimeatConfig): void {
  if (watched.has(storage)) return;
  watched.add(storage);
  const suffix = `@${config.nodeId}`;
  onUsageRecorded((call: UsageCallRecord) => {
    if (!nodeWatchesAgents(config)) return;
    if (call.actorKind !== 'agent' && call.actorKind !== 'app' && call.actorKind !== 'eco') return;
    const named = PROVIDER_SURFACES.has(call.surface) ? call.counterpartyGhii
      : call.surface === 'mcp-remote' ? call.ownerGhii : '';
    // A call refused before any entitlement names the provider by the account name the product
    // carries (`providerOwner`), not by a GHII: on this node the two are the same account.
    const provider = named && !named.includes('@') ? `${named}${suffix}` : named;
    if (!provider || !provider.endsWith(suffix)) return;
    if (ownerGhiiOf(call.actorGaii) === provider) return;
    recordAgentCall(storage, config, {
      ownerGhii: provider, family: agentFamilyOf(call.actorGaii), tool: call.coordinate,
      outcome: call.outcome, reason: call.reason,
    });
  });
}

/** Where in a checkout an error code stops an agent, in the owner's words. */
export function stageOfCode(code: string): string {
  const c = code.toLowerCase();
  if (/payment|psp|card|declin|insufficient|amount|currency|handler|instrument|captur/.test(c)) return 'at payment';
  if (/missing|buyer|email/.test(c)) return 'waiting for the buyer\'s details';
  if (/item|offer|unavailable|not_found|sold|price/.test(c)) return 'at an item';
  if (/expired/.test(c)) return 'when it expired';
  if (/fulfil|deliver/.test(c)) return 'at delivery';
  if (/limit|scope|spend|members|permission|cap/.test(c)) return 'at the agent\'s spending permission';
  return 'at a step of the checkout';
}

const sum = (o: Record<string, number> | undefined): number => Object.values(o ?? {}).reduce((n, v) => n + v, 0);
const article = (family: string): string => (family === 'aimeat-agent' ? 'An agent of an AIMEAT account' : `A ${family} agent`);

export interface AgentExperience {
  checkouts: Array<{ family: string; started: number; updated: number; completed: number; canceled: number; expired: number; failed: number }>;
  checkout_errors: Array<{ family: string; code: string; stage: string; count: number }>;
  tool_calls: Array<{ family: string; calls: number; ok: number; refused: number; error: number }>;
  tool_errors: Array<{ family: string; tool: string; reason: string; count: number }>;
  findings: Array<{ family: string; kind: 'checkout' | 'tools'; text: string }>;
}

/** The section of the report this layer owns, from a window's summed day. */
export function agentExperienceSection(day: VisibilityDay): AgentExperience {
  const checkouts = Object.entries(day.checkouts ?? {}).map(([family, s]) => ({
    family,
    started: s.created ?? 0, updated: s.updated ?? 0, completed: s.completed ?? 0,
    canceled: s.canceled ?? 0, expired: s.expired ?? 0, failed: s.failed ?? 0,
  })).sort((a, b) => b.started - a.started);
  const checkoutErrors = Object.entries(day.checkoutErrors ?? {}).map(([key, count]) => {
    const [family = 'other', code = 'none'] = key.split('|');
    return { family, code, stage: stageOfCode(code), count };
  }).sort((a, b) => b.count - a.count);
  const toolCalls = Object.entries(day.agentCalls ?? {}).map(([family, o]) => ({
    family, calls: sum(o), ok: o.ok ?? 0, refused: o.refused ?? 0, error: o.error ?? 0,
  })).sort((a, b) => b.calls - a.calls);
  const toolErrors = Object.entries(day.agentErrors ?? {}).map(([key, count]) => {
    const [family = 'other', tool = 'none', reason = 'none'] = key.split('|');
    return { family, tool, reason, count };
  }).sort((a, b) => b.count - a.count);

  const findings: AgentExperience['findings'] = [];
  for (const c of checkouts) {
    const tries = Math.max(c.started, c.completed + c.failed);
    if (tries === 0) continue;
    const errs = checkoutErrors.filter((e) => e.family === c.family);
    const parts: string[] = [];
    if (errs.length) {
      const top = errs[0]!;
      parts.push(`${top.count} checkout${top.count === 1 ? '' : 's'} failed ${top.stage} (${top.code})`);
    }
    if (c.canceled + c.expired) parts.push(`${c.canceled + c.expired} ${c.canceled + c.expired === 1 ? 'was' : 'were'} abandoned`);
    parts.push(`${c.completed} completed`);
    findings.push({ family: c.family, kind: 'checkout', text: `${article(c.family)} tried to buy ${tries} time${tries === 1 ? '' : 's'}; ${parts.join(', ')}.` });
  }
  for (const t of toolCalls) {
    const bad = t.refused + t.error;
    if (bad === 0) continue;
    const top = toolErrors.find((e) => e.family === t.family);
    findings.push({
      family: t.family, kind: 'tools',
      text: `${article(t.family)} called your tools ${t.calls} time${t.calls === 1 ? '' : 's'}; ${bad} did not succeed${top ? `, most often ${top.tool} (${top.reason})` : ''}.`,
    });
  }
  return { checkouts, checkout_errors: checkoutErrors, tool_calls: toolCalls, tool_errors: toolErrors, findings };
}
