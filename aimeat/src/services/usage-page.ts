/**
 * @file src/services/usage-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one read behind the operator's Usage page: whose money paid for the AI on this
 *   node, what it went on, and the one bill the node cannot count by itself.
 *
 *   THE QUESTION THIS ANSWERS, which the page could not. An operator opens Usage to find out what
 *   this is costing THEM. Three separate systems each held part of that and the page showed all
 *   three as peers: the per-owner daily table split by whose key paid, the LLM ledger rollup, and
 *   the AI-apps aggregate. None of them is the operator's bill, because the money the operator
 *   actually pays is the house key and the chat agent's key, and the second of those is spent by a
 *   child process the node hands the key to (services/goose-acp.ts) and never sees again.
 *
 *   SO THE PAYLOAD IS ORGANISED BY WHOSE MONEY IT IS, not by which system counted it. `house` is
 *   the operator's, `own` is other people's own provider accounts, and `ledger` is named as the
 *   third count rather than presented as a fourth fact. The ceiling — the grant times the number of
 *   accounts — is the number an operator would act on and no surface had ever multiplied it out.
 *
 *   NO OUTBOUND CALL UNLESS ASKED. `includeKeySpend` is what reaches the provider, and it is off
 *   for the page's own load: a page that phones a third party on every render stops loading when
 *   that third party is slow. → services/openrouter-key.ts
 *
 *   IT REIMPLEMENTS NOTHING. The models and the people come from getAdminLedger, the same function
 *   GET /v1/admin/ledger calls; the key split comes from the same storage read GET
 *   /v1/admin/usage/house makes. Building either a second time here is how one tool name came to
 *   mean three different things on three surfaces.
 * @structure
 *   - UsagePage and its parts
 *   - buildUsagePage(config, storage, opts) — the whole payload
 * @usage
 *   import { buildUsagePage } from '../services/usage-page.js';
 *   const data = await buildUsagePage(config, storage, { from, to, includeKeySpend: false });
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Usage page's rebuild.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { getAdminLedger } from './ledger-admin.js';
import { readKeySpend, type KeySpend } from './openrouter-key.js';

/** How many models get a row of their own before the rest fold into one. */
const TOP_MODELS = 8;

const isoDay = (offsetDays = 0): string =>
  new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

export interface UsageScopeTotals {
  cost_usd: number;
  calls: number;
  /** Distinct accounts that spent anything on this scope of key. */
  people: number;
}

export interface UsageModelRow {
  model: string;
  providers: string[];
  cost_usd: number;
  total_tokens: number;
  calls: number;
  unpriced_calls: number;
  /** This model's share of the priced bill, 0 to 1. */
  share: number;
}

export interface UsagePage extends Record<string, unknown> {
  from: string;
  to: string;
}

/**
 * Everything the Usage page shows, in one read.
 *
 * @param opts.includeKeySpend ask the provider what the operator's own keys have spent. One
 *   outbound round trip per key, cached for a minute, and never done on a page load.
 */
export async function buildUsagePage(
  config: AimeatConfig,
  storage: Storage,
  opts: { from?: string; to?: string; includeKeySpend?: boolean } = {},
): Promise<UsagePage> {
  const to = opts.to || isoDay(0);
  const from = opts.from || isoDay(29);

  const [daily, ledger, owners] = await Promise.all([
    storage.queryUsageDailyAllOwners({ from, to }),
    getAdminLedger(storage, { from, to }),
    storage.listOwners(),
  ]);

  // ── Whose key paid ──
  // One pass over the daily rows. `scopes` is the money question; `byDay` is the same split over
  // time, which is the only split on this page worth a chart: the operator's line and everyone
  // else's answer different questions and a per-model stack answered neither.
  const scopes: Record<'house' | 'own', { cost_usd: number; calls: number; people: Set<string> }> = {
    house: { cost_usd: 0, calls: 0, people: new Set() },
    own: { cost_usd: 0, calls: 0, people: new Set() },
  };
  const byDay = new Map<string, { date: string; house_usd: number; own_usd: number }>();
  for (const r of daily) {
    const which = r.apiKeyScope === 'node' ? 'house' : 'own';
    const bucket = scopes[which];
    bucket.cost_usd += r.costUsd || 0;
    bucket.calls += r.calls || 0;
    bucket.people.add(r.ownerGhii);

    let day = byDay.get(r.date);
    if (!day) { day = { date: r.date, house_usd: 0, own_usd: 0 }; byDay.set(r.date, day); }
    if (which === 'house') day.house_usd += r.costUsd || 0;
    else day.own_usd += r.costUsd || 0;
  }

  const grant = config.chatFreeAllowanceUsd || 0;
  const ceiling = grant * owners.length;

  // ── The models, folded ──
  // Everything past the top few becomes one row. The old page drew one chart series per model into
  // a twelve-colour palette that CYCLES, so on a node running eighteen models six of them wore a
  // colour another model already had, in a stacked bar where two same-coloured segments in one
  // stack cannot be separated. A row with a bar has no such ceiling.
  const pricedTotal = ledger.totals.cost_usd || 0;
  const share = (c: number) => (pricedTotal > 0 ? c / pricedTotal : 0);
  const all = ledger.per_model;
  const top: UsageModelRow[] = all.slice(0, TOP_MODELS).map(m => ({
    model: m.model,
    providers: m.providers,
    cost_usd: m.cost_usd,
    total_tokens: m.total_tokens,
    calls: m.calls,
    unpriced_calls: m.unpriced_calls,
    share: share(m.cost_usd),
  }));
  const rest = all.slice(TOP_MODELS);
  const other = rest.length
    ? {
      models: rest.length,
      names: rest.map(m => m.model),
      cost_usd: rest.reduce((a, m) => a + m.cost_usd, 0),
      total_tokens: rest.reduce((a, m) => a + m.total_tokens, 0),
      calls: rest.reduce((a, m) => a + m.calls, 0),
      unpriced_calls: rest.reduce((a, m) => a + m.unpriced_calls, 0),
      share: share(rest.reduce((a, m) => a + m.cost_usd, 0)),
    }
    : null;

  // ── What the unpriced calls actually are ──
  // A call is unpriced when the provider reported no cost, which is overwhelmingly a free or local
  // model rather than a hole in the metering. The old page printed the raw count beside the total
  // with nothing to say which way it cut, so the honest reading — "the total is short by about the
  // price of sixty calls" — was indistinguishable from the alarming one.
  const unpricedTotal = ledger.totals.unpriced_calls || 0;
  const unpricedInTail = other?.unpriced_calls ?? 0;
  const pricedCalls = Math.max(0, (ledger.totals.calls || 0) - unpricedTotal);
  const avgPriced = pricedCalls > 0 ? pricedTotal / pricedCalls : 0;
  // Only the unpriced calls on models that DO otherwise cost something are money we cannot see;
  // a model that never charges has nothing missing.
  const unpricedOnPricedModels = top.reduce(
    (a, m) => a + (m.cost_usd > 0 ? m.unpriced_calls : 0), 0);

  const keys: Record<string, unknown> = {
    house: {
      configured: !!config.openrouterInstanceKey,
      // The house key is metered per call, so the node's own number is meaningful — and still only
      // covers the calls that reached the metering.
      metered_here: true,
      node_counted_usd: scopes.house.cost_usd,
      spend: null as KeySpend | null,
    },
    chat: {
      configured: !!config.gooseProviderApiKey,
      enabled: !!(config.gooseBin || '').trim(),
      model: config.gooseModel || null,
      // The honest half, and the reason this whole service exists: every chat turn is spent from
      // this key by a child process, so no figure the node counts includes any of it.
      metered_here: false,
      node_counted_usd: null,
      spend: null as KeySpend | null,
    },
  };

  if (opts.includeKeySpend) {
    const [house, chat] = await Promise.all([
      readKeySpend(config, config.openrouterInstanceKey, 'house'),
      readKeySpend(config, config.gooseProviderApiKey, 'chat'),
    ]);
    (keys.house as Record<string, unknown>).spend = house;
    (keys.chat as Record<string, unknown>).spend = chat;
  }

  return {
    from,
    to,
    whose_money: {
      house: { cost_usd: scopes.house.cost_usd, calls: scopes.house.calls, people: scopes.house.people.size } as UsageScopeTotals,
      own: { cost_usd: scopes.own.cost_usd, calls: scopes.own.calls, people: scopes.own.people.size } as UsageScopeTotals,
      // Named as a third count rather than shown as a fourth fact. It reads a different table from
      // the two above and is the larger set; saying so is the point.
      ledger: {
        cost_usd: pricedTotal,
        calls: ledger.totals.calls,
        total_tokens: ledger.totals.total_tokens,
        counted_from: 'the LLM usage rollup, which carries calls the per-owner daily table does not',
      },
      grant_usd: grant,
      accounts: owners.length,
      // The arithmetic no surface had ever done: the most the house key can cost before somebody
      // is refused.
      ceiling_usd: ceiling,
      drawn_usd: scopes.house.cost_usd,
    },
    keys,
    models: {
      rows: top,
      other,
      unpriced: {
        calls: unpricedTotal,
        in_the_tail: unpricedInTail,
        on_models_that_charge: unpricedOnPricedModels,
        avg_priced_call_usd: avgPriced,
        // What the missing calls would have cost if they had been priced like the priced ones.
        estimated_missing_usd: unpricedOnPricedModels * avgPriced,
      },
    },
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    people: ledger.per_user,
  };
}
