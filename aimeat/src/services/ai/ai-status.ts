/**
 * @file src/services/ai/ai-status.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two answers the sign-in pill shows at a glance, computed from what
 *   aiCapabilitiesView (capabilities.ts) has already planned (wish-resurssipalkki-teko-lybudjetti-
 *   tallennus-ja-nelj-ovea, design C of 2026-11-07):
 *
 *   `main`  Whether the person's own AI is connected: at least one of their agents (an AI client
 *           that signed in through device authorization or MCP), or the node's chat with a model
 *           that would run. The node cannot know whether a client is open at this moment, because an
 *           MCP connection exists only while the client calls, so `connected` means "connected and
 *           allowed", never "online now".
 *   `power` Whether there is AI power to spend here: 'ok' when a text call would run now, 'over' when
 *           it is refused because the daily budget or the node's allowance is spent, 'none' for every
 *           other refusal (no key, no provider, no model). `low` says less than a tenth of the
 *           budget is left. The amounts are in US dollars, the currency the providers bill in.
 *
 *   THE SAME GATE. Both read the text capability's state, which prepareAiCall planned, so the pill
 *   says what a call would meet. A second set of rules here would drift from the real one.
 *
 *   AN APP SEES LESS. For a caller that is an app, `main` carries `connected` alone: whether the
 *   person has an AI is the pill's business, which agents they have is not the app's.
 * @structure LOW_SHARE · MainAiState · PowerState · powerOf() · mainAiOf()
 * @usage const power = await powerOf(storage, config, payer, textState, budget);
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (the sign-in pill's AI state).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountOf } from '../../utils/gaii.js';
import { nodeKeyStanding, readAllowance } from './allowance.js';
import type { CapabilityReason } from './ai-fix-words.js';

/** Below this share of the budget left, `power.low` is true (the popup says it; the bolt stays yellow). */
export const LOW_SHARE = 0.1;

/** The refusals that mean "spent", which the pill draws red rather than grey. */
const SPENT: ReadonlySet<CapabilityReason> = new Set<CapabilityReason>(['BUDGET_EXHAUSTED', 'BALANCE_SPENT']);

export interface MainAiState {
  /** At least one of the person's AIs may act: an agent, or the node's chat with a model that runs. */
  connected: boolean;
  /** Not for an app. How many agents the person has. */
  agents?: number;
  /** Not for an app. The agent seen most recently, to name in the popup. */
  latest?: { name: string; platform?: string; lastSeen: string };
  /** Not for an app. Whether the node's chat has a model that would run now. */
  chat?: boolean;
}

export interface PowerState {
  state: 'ok' | 'over' | 'none';
  /** Less than LOW_SHARE of the budget is left. Only when `state` is 'ok'. */
  low: boolean;
  /** Who pays a text call now: the person's own key, the node's key, or an agent's own key. */
  payer?: 'own' | 'node' | 'agent';
  spentTodayUsd: number;
  /** The daily budget (own key) or what the node granted in all (node's key). */
  limitUsd?: number;
  remainingUsd?: number;
  reason?: CapabilityReason;
  /** The person's sentence for an 'over' or 'none' state, in their language. */
  fix?: string;
  settingsUrl?: string;
}

interface TextLike {
  on: boolean; keySource?: 'agent' | 'own' | 'node'; reason?: CapabilityReason; fix?: string; settingsUrl?: string;
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The bolt's state. `text` is the text capability as aiCapabilitiesView planned it; `budget` is the
 * daily budget and today's spend it already read. The node's key is read only when it is the payer.
 */
export async function powerOf(
  storage: Storage, config: AimeatConfig, payer: string, text: TextLike,
  budget: { dailyBudgetUsd: number; spentTodayUsd: number },
): Promise<PowerState> {
  const spentTodayUsd = round(budget.spentTodayUsd);
  if (!text.on) {
    const over = !!text.reason && SPENT.has(text.reason);
    return {
      state: over ? 'over' : 'none', low: false, spentTodayUsd,
      ...(over && budget.dailyBudgetUsd > 0 ? { limitUsd: budget.dailyBudgetUsd, remainingUsd: 0 } : {}),
      ...(text.reason ? { reason: text.reason } : {}),
      ...(text.fix ? { fix: text.fix } : {}), ...(text.settingsUrl ? { settingsUrl: text.settingsUrl } : {}),
    };
  }
  if (text.keySource === 'node') {
    // The node's key pays: what is left is the person's allowance, not the daily budget.
    const [standing, rec] = await Promise.all([nodeKeyStanding(storage, config, payer), readAllowance(storage, config, payer)]);
    const remainingUsd = round(standing.remainingUsd);
    const limitUsd = round(rec.granted_usd);
    return {
      state: 'ok', payer: 'node', spentTodayUsd, limitUsd, remainingUsd,
      low: limitUsd > 0 && remainingUsd < limitUsd * LOW_SHARE,
    };
  }
  const limitUsd = budget.dailyBudgetUsd;
  const remainingUsd = round(Math.max(0, limitUsd - budget.spentTodayUsd));
  return {
    state: 'ok', payer: text.keySource === 'agent' ? 'agent' : 'own', spentTodayUsd, limitUsd, remainingUsd,
    low: limitUsd > 0 && remainingUsd < limitUsd * LOW_SHARE,
  };
}

/** The capabilities the pill names, in its order: picture (read, make) and sound (hear, speak). */
export const PILL_CAPABILITIES = ['vision', 'image', 'transcription', 'speech'] as const;
export type PillCapability = typeof PILL_CAPABILITIES[number];

export interface AppNeed {
  capability: PillCapability;
  /** A call the app makes for it would run now: the capability is on and, when the app named a role
   *  for it, the person has connected that role. */
  on: boolean;
  fix?: string;
  settingsUrl?: string;
}

/**
 * What an app needs, from the AI roles it declares in its meta (services/app-ai-roles.ts), as the
 * pill shows it beside the bolt: one entry per pill capability any role names. Empty for an app that
 * declares no roles, and for every caller that is not acting for an app.
 */
export function appNeedsOf(
  roles: Array<{ capabilities?: unknown; bound?: unknown }> | undefined,
  states: Record<string, TextLike>, aiSettingsUrl: string,
): AppNeed[] {
  if (!roles?.length) return [];
  const out: AppNeed[] = [];
  for (const cap of PILL_CAPABILITIES) {
    const naming = roles.filter(r => Array.isArray(r.capabilities) && r.capabilities.includes(cap));
    if (!naming.length) continue;
    const s = states[cap];
    const on = !!s?.on && naming.every(r => r.bound !== false);
    // Off because the capability is off: its own sentence. Off because a role is not connected yet:
    // the AI page, where the person connects it (the pill says the words).
    out.push({
      capability: cap, on,
      ...(on ? {} : { ...(!s?.on && s?.fix ? { fix: s.fix } : {}), settingsUrl: s?.settingsUrl ?? aiSettingsUrl }),
    });
  }
  return out;
}

/**
 * Whether the person's own AI is connected. `payer` is the person's identity (an owner GHII, also for
 * an agent's call); `chatRuns` is whether a text call would run now; `forApp` trims the answer to the
 * one boolean an app may read.
 */
export async function mainAiOf(
  storage: Storage, payer: string, chatRuns: boolean, forApp: boolean,
): Promise<MainAiState> {
  const owner = localAccountOf(payer);
  const agents = owner ? await storage.getAgentsByOwner(owner) : [];
  const connected = agents.length > 0 || chatRuns;
  if (forApp) return { connected };
  const latest = agents.reduce<(typeof agents)[number] | null>((a, b) => (!a || (b.lastSeen ?? '') > (a.lastSeen ?? '') ? b : a), null);
  return {
    connected, agents: agents.length, chat: chatRuns,
    ...(latest ? { latest: {
      name: latest.displayName || latest.name, lastSeen: latest.lastSeen,
      ...(latest.platform ? { platform: latest.platform } : {}),
    } } : {}),
  };
}
