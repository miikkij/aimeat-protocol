/**
 * @file src/config-x402.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The x402 stablecoin settlement settings (TARGET-042). A pure move out of config.ts
 *   (max-file-lines), unchanged: the spread stands where the five lines stood.
 * @structure x402Defaults()
 * @usage
 *   import { x402Defaults } from './config-x402.js';
 *   const config = { ...x402Defaults(), ... };
 * @version-history
 *   v1.0.0 — 2026-10-29 — Moved from config.ts, unchanged.
 */

export function x402Defaults() {
  return {
    // x402 stablecoin settlement (TARGET-042): NON-CUSTODIAL USDC handler for money (USD) sessions.
    // USDC is a payment METHOD for a USD price (model 2), never a currency of its own. Network +
    // facilitator are parameters so Solana / another facilitator drops in without a core change. OFF
    // by default (registers only when enabled) so a node advertises the exact scheme only when it can
    // settle it. Base Sepolia + the public x402.org facilitator are the safe testnet defaults.
    x402Enabled: process.env.AIMEAT_X402_ENABLED === 'true',
    x402Network: process.env.AIMEAT_X402_NETWORK ?? 'base-sepolia',
    x402FacilitatorUrl: process.env.AIMEAT_X402_FACILITATOR_URL ?? 'https://x402.org/facilitator',
    // OPTIONAL read-only RPC used to check that a seller's payout address is an account and not a
    // contract. Unset = the check is skipped (a save never depends on a third party being up).
    x402RpcUrl: process.env.AIMEAT_X402_RPC_URL ?? '',
    x402TestFacilitator: process.env.AIMEAT_X402_TEST_FACILITATOR === 'true',
  };
}
