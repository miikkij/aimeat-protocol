/**
 * @file src/services/config-schema-commerce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The marketplace and commerce core settings on the admin Config tab. A pure move out of
 *   config-schema.ts (max-file-lines), as config-schema-morsels.ts was: CONFIG_FIELDS spreads these
 *   rows where they stood, so the Config tab lists them in the same order.
 * @structure COMMERCE_CONFIG_FIELDS
 * @usage import { COMMERCE_CONFIG_FIELDS } from './config-schema-commerce.js';
 * @version-history
 *   v1.0.0 — 2026-10-29 — Moved from config-schema.ts, unchanged.
 */
// Typed by the keys alone, not AimeatConfig: config.ts reaches config-schema.ts, so importing the
// config type here would close an import cycle (config-schema-morsels.ts says the same).
import type { ConfigFieldShape } from './config-field-def.js';
import { oneOf } from './config-schema-validators.js';

type CommerceKey = 'marketplaceEnabled' | 'marketplaceTransactionFeePercent' | 'marketplaceFeeMode'
  | 'operatorFeeAccount' | 'commerceFeePercent' | 'commerceEnabled' | 'commerceSessionTtlMinutes' | 'mcpCardCommerceTools';

export const COMMERCE_CONFIG_FIELDS: ConfigFieldShape<CommerceKey>[] = [
  // ── Marketplace (Phase 2.6, mutable) ──
  { key: 'marketplaceEnabled', dotPath: 'marketplace.enabled', envVar: 'AIMEAT_MARKETPLACE_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Marketplace feature enabled' },
  { key: 'marketplaceTransactionFeePercent', dotPath: 'marketplace.tx_fee_percent', envVar: 'AIMEAT_MARKETPLACE_TX_FEE_PERCENT', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 50, immutable: false, description: 'Transaction fee percentage', range: '0-50' },

  // ── Commerce core + fee policy (TARGET-033, mutable) ──
  { key: 'marketplaceFeeMode', dotPath: 'commerce.fee_mode', envVar: 'AIMEAT_MARKETPLACE_FEE_MODE', type: 'string', ...oneOf('operator', 'burn'), immutable: false, description: 'Marketplace fee destination: operator (credited to node operator) or burn', range: 'operator|burn' },
  { key: 'operatorFeeAccount', dotPath: 'commerce.operator_fee_account', envVar: 'AIMEAT_OPERATOR_FEE_ACCOUNT', type: 'string', validate: v => v === null || (typeof v === 'string' && (v as string).length <= 100), immutable: false, description: 'Owner name whose GHII receives operator-mode fees (empty = first operator-role owner)' },
  { key: 'commerceFeePercent', dotPath: 'commerce.fee_percent', envVar: 'AIMEAT_COMMERCE_FEE_PERCENT', type: 'number', validate: v => v === null || (typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 50), immutable: false, description: 'Checkout fee percentage (empty inherits marketplace tx fee percent)', range: '0-50' },
  { key: 'commerceEnabled', dotPath: 'commerce.enabled', envVar: 'AIMEAT_COMMERCE_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Checkout sessions (/v1/commerce) enabled' },
  { key: 'commerceSessionTtlMinutes', dotPath: 'commerce.session_ttl_minutes', envVar: 'AIMEAT_COMMERCE_SESSION_TTL_MINUTES', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 10080, immutable: false, description: 'Open checkout-session lifetime in minutes', range: '5-10080' },
  { key: 'mcpCardCommerceTools', dotPath: 'commerce.mcp_card_tools', envVar: 'AIMEAT_MCP_CARD_COMMERCE_TOOLS', type: 'string', ...oneOf('inline', 'pointer'), immutable: false, description: 'MCP Server Card commerce_tools mode: inline (embed priced app-tool catalog) or pointer (link /v1/commerce/tools)' },
];
