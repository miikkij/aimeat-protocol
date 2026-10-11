/**
 * @file src/services/config-schema-morsels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The morsel policy settings on the admin Config tab. A pure move out of
 *   config-schema.ts (max-file-lines), as config-schema-seo.ts was: CONFIG_FIELDS spreads these rows
 *   where they stood, so the Config tab lists them in the same order.
 * @structure MORSEL_CONFIG_FIELDS
 * @version-history
 *   v1.1.0 — 2026-10-11 — The pacing pack (pacing_pack_morsels, _price, _currency): pacing capacity an
 *     operator sells for money. burn_rate and pacing_toll_default describe pacing, not a price.
 *   v1.0.0 — 2026-10-01 — Moved from config-schema.ts, unchanged.
 */
// Typed by the keys alone, not AimeatConfig: config.ts reaches config-schema.ts, so importing the
// config type here would close an import cycle (config-schema-ai.ts says the same).
import type { ConfigFieldShape } from './config-field-def.js';

type MorselKey = 'welcomeBonus' | 'dailyAllowance' | 'pacingTollDefault' | 'dailyAllowanceCap' | 'burnRate'
  | 'maxOperatorMintPerDay' | 'boardPostBaseCost' | 'boardPostCostPerKb'
  | 'pacingPackMorsels' | 'pacingPackPrice' | 'pacingPackCurrency';

export const MORSEL_CONFIG_FIELDS: ConfigFieldShape<MorselKey>[] = [
  // ── Morsel Policy (mutable) ──
  { key: 'welcomeBonus', dotPath: 'morsel_policy.welcome_bonus', envVar: 'AIMEAT_WELCOME_BONUS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Morsels granted to new agents', range: '0-10000' },
  { key: 'dailyAllowance', dotPath: 'morsel_policy.daily_allowance', envVar: 'AIMEAT_DAILY_ALLOWANCE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Daily morsel allowance per agent', range: '0-10000' },
  // The pacing floor sits with the morsel policy because that is what it is: how fast the daily
  // allowance lets anyone consume a capability, whatever they pay for it in.
  { key: 'pacingTollDefault', dotPath: 'morsel_policy.pacing_toll_default', envVar: 'AIMEAT_PACING_TOLL_DEFAULT', type: 'number',
    validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100, immutable: false,
    description: 'Pacing amount per use when an offer declares none of its own: morsels taken from the user, part burned and the rest credited to the provider. Bounds the call RATE for every offer, including money-priced ones. 0 = off; at 1 a consumer can make about 500 uses a day.',
    range: '0-100' },
  { key: 'dailyAllowanceCap', dotPath: 'morsel_policy.daily_allowance_cap', envVar: 'AIMEAT_DAILY_ALLOWANCE_CAP', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Max balance for daily allowance eligibility', range: '0-100000' },
  { key: 'burnRate', dotPath: 'morsel_policy.burn_rate', envVar: 'AIMEAT_BURN_RATE', type: 'float', validate: v => typeof v === 'number' && (v as number) >= 0 && (v as number) <= 1, immutable: false, description: 'Fraction of each pacing charge (and of the work network fee) that is burned; the rest goes to the provider', range: '0.0-1.0' },
  // Buying pacing capacity with money (Jouni 2026-10-11). Off while the pack size or the price is 0.
  { key: 'pacingPackMorsels', dotPath: 'morsel_policy.pacing_pack_morsels', envVar: 'AIMEAT_PACING_PACK_MORSELS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100000, immutable: false, description: 'Morsels in one pacing pack a user can buy with money from the operator. 0 = no pack is sold.', range: '0-100000' },
  { key: 'pacingPackPrice', dotPath: 'morsel_policy.pacing_pack_price', envVar: 'AIMEAT_PACING_PACK_PRICE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Money price of one pacing pack, in 6-decimal micro-units (1 EUR = 1000000). 0 = no pack is sold.', range: '0-' },
  { key: 'pacingPackCurrency', dotPath: 'morsel_policy.pacing_pack_currency', envVar: 'AIMEAT_PACING_PACK_CURRENCY', type: 'string', validate: v => v === 'EUR' || v === 'USD', immutable: false, description: 'Currency of the pacing pack price', range: 'EUR|USD' },
  { key: 'maxOperatorMintPerDay', dotPath: 'morsel_policy.max_operator_mint_per_day', envVar: 'AIMEAT_MAX_OPERATOR_MINT_PER_DAY', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Max morsels operator can mint per day', range: '0-1000000' },
  { key: 'boardPostBaseCost', dotPath: 'morsel_policy.board_post_base_cost', envVar: 'AIMEAT_BOARD_POST_BASE_COST', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Base morsel cost for public board posts', range: '0-1000' },
  { key: 'boardPostCostPerKb', dotPath: 'morsel_policy.board_post_cost_per_kb', envVar: 'AIMEAT_BOARD_POST_COST_PER_KB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Additional morsel cost per KB of post body', range: '0-100' },
];
