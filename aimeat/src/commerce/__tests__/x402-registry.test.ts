/**
 * @file src/commerce/__tests__/x402-registry.test.ts
 * @description Unit tests for the currency-aware x402 network registry (TARGET-042). These guard THE
 *   rule the whole EURC extension hangs on: ADVERTISE ONLY WHAT CAN SETTLE. A currency reaches a
 *   buyer only when the configured network has a real asset for it, so the decisive case here is the
 *   NEGATIVE one — a network whose entry lacks a currency must not offer that currency, and must not
 *   be able to build requirements for it. Also pins each shipped asset's address, decimals and
 *   EIP-712 domain: those four values were verified against the live contracts (by recomputing each
 *   DOMAIN_SEPARATOR) and against the public facilitator, and a silent edit to any of them would
 *   invalidate every buyer signature.
 * @usage cd aimeat && pnpm exec vitest run src/commerce/__tests__/x402-registry.test.ts
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial registry + advertising-gate tests (TARGET-042, EURC)
 */
import { describe, it, expect } from 'vitest';
import {
  X402_NETWORKS, getX402Network, getX402Asset, x402SettlementCurrencies, buildExactRequirements,
  type X402Network,
} from '../x402-facilitator.js';
import { microsToTokenRaw } from '../money.js';

/** A synthetic network that can settle dollars but NOT euros — the shape the gate must refuse. */
const USD_ONLY: X402Network = {
  id: 'usd-only-testnet',
  assets: { USD: { address: `0x${'1'.repeat(40)}`, symbol: 'USDC', decimals: 6, extra: { name: 'USDC', version: '2' } } },
};

describe('the advertising gate: a currency with no asset is never offered', () => {
  it('omits EUR from a network that has no EUR asset', () => {
    expect(x402SettlementCurrencies(USD_ONLY)).toEqual(['USD']);
    expect(x402SettlementCurrencies(USD_ONLY)).not.toContain('EUR');
  });

  it('resolves no asset for the missing pair, so nothing downstream can build requirements', () => {
    expect(getX402Asset(USD_ONLY, 'EUR')).toBeUndefined();
    expect(getX402Asset(USD_ONLY, 'USD')).toBeDefined();
  });

  it('advertises nothing at all for an unknown network (a misconfigured node promises no rail)', () => {
    expect(getX402Network('no-such-network')).toBeUndefined();
    expect(x402SettlementCurrencies(undefined)).toEqual([]);
    expect(getX402Asset(undefined, 'USD')).toBeUndefined();
  });

  it('never resolves an asset for a non-money currency', () => {
    expect(getX402Asset(getX402Network('base-sepolia'), 'morsel')).toBeUndefined();
    expect(getX402Asset(getX402Network('base-sepolia'), 'GBP')).toBeUndefined();
  });
});

describe('the shipped networks settle both money currencies', () => {
  it.each(['base-sepolia', 'base'])('%s offers exactly USD and EUR', (id) => {
    expect(x402SettlementCurrencies(getX402Network(id))).toEqual(['EUR', 'USD']);
  });

  /**
   * Verified 2026-07-25 against the live contracts: addresses from Circle's documentation, then
   * `name`/`version`/`decimals` read on-chain and PROVEN by recomputing each contract's own
   * DOMAIN_SEPARATOR from (name, version, chainId, address). The public x402.org facilitator
   * validated a real EIP-3009 signature against each, and rejected a deliberately wrong domain name
   * with `invalid_exact_evm_token_name_mismatch` — so these values are load-bearing, not cosmetic.
   */
  it.each([
    ['base-sepolia', 'USD', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'USDC', 'USDC'],
    ['base-sepolia', 'EUR', '0x808456652fdb597867f38412077A9182bf77359F', 'EURC', 'EURC'],
    ['base', 'USD', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 'USD Coin'],
    ['base', 'EUR', '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', 'EURC', 'EURC'],
  ])('%s/%s pins the verified asset + EIP-712 domain', (network, currency, address, symbol, domainName) => {
    const asset = getX402Asset(getX402Network(network), currency)!;
    expect(asset.address).toBe(address);
    expect(asset.symbol).toBe(symbol);
    expect(asset.decimals).toBe(6);
    expect(asset.extra).toEqual({ name: domainName, version: '2' });
  });

  it('gives every asset its own contract — no currency settles in another currency’s token', () => {
    const addresses = Object.values(X402_NETWORKS).flatMap((n) => Object.values(n.assets).map((a) => a!.address));
    expect(new Set(addresses).size).toBe(addresses.length);
  });
});

describe('buildExactRequirements carries the session currency’s own asset', () => {
  const common = { payTo: `0x${'b'.repeat(40)}`, amountMicros: 1_500_000, resource: 'https://node.invalid/s/1', description: 'checkout' };

  it('prices a EUR sale in EURC and a USD sale in USDC on the same network', () => {
    const network = getX402Network('base-sepolia')!;
    const eur = buildExactRequirements({ network, asset: getX402Asset(network, 'EUR')!, ...common });
    const usd = buildExactRequirements({ network, asset: getX402Asset(network, 'USD')!, ...common });

    expect(eur.asset).toBe('0x808456652fdb597867f38412077A9182bf77359F');
    expect(eur.extra).toEqual({ name: 'EURC', version: '2' });
    expect(usd.asset).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(usd.extra).toEqual({ name: 'USDC', version: '2' });
    // Same network, same price, same payee — only the instrument differs (model 2).
    expect(eur.network).toBe(usd.network);
    expect(eur.maxAmountRequired).toBe(usd.maxAmountRequired);
    expect(eur.payTo).toBe(usd.payTo);
  });

  it('maps 1.50 of a 6-decimal token 1:1 from micros', () => {
    const network = getX402Network('base-sepolia')!;
    const reqs = buildExactRequirements({ network, asset: getX402Asset(network, 'EUR')!, ...common });
    expect(reqs.maxAmountRequired).toBe('1500000'); // 1.50 EUR → 1.50 EURC
  });
});

describe('micros → token atomic units honours the token’s own decimals', () => {
  it('is the identity for the 6-decimal tokens actually shipped', () => {
    expect(microsToTokenRaw(1_500_000, 6)).toBe('1500000');
    expect(microsToTokenRaw(2000, 6)).toBe('2000'); // the sub-cent agent price survives
  });

  it('scales up exactly for an 18-decimal token, beyond safe-integer range', () => {
    expect(microsToTokenRaw(1_500_000, 18)).toBe('1500000000000000000'); // 1.50 × 10^18
    expect(Number(microsToTokenRaw(1_500_000, 18))).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
  });

  it('rounds UP when scaling down, so the seller is never handed less than the price', () => {
    expect(microsToTokenRaw(1_500_000, 2)).toBe('150');  // exact
    expect(microsToTokenRaw(2000, 2)).toBe('1');         // 0.002 → 0.01, never 0
  });
});
