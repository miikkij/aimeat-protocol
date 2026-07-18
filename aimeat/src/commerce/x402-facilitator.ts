/**
 * @file src/commerce/x402-facilitator.ts
 * @description The x402 network registry, wire types, and facilitator client for the non-custodial
 *   USDC settlement handler (TARGET-042). The heavy crypto (EIP-3009 signing by the buyer's wallet,
 *   signature + onchain verification, the settling transfer) lives in the buyer's wallet and in the
 *   Coinbase-style FACILITATOR — never here. AIMEAT only (1) serializes the x402 `exact`
 *   PaymentRequirements a 402 advertises, (2) decodes the buyer's base64 X-PAYMENT proof, and (3)
 *   forwards both to the facilitator's /verify + /settle over safeFetch (Rule 10). That is why this
 *   handler needs no @x402 / viem dependency: there is no EIP-3009 serialization to hand-write on the
 *   server side. The NETWORK REGISTRY is the one place a chain + asset is defined, so Base, Solana, or
 *   another network is a data entry, not a code change (TARGET-042: network is a parameter).
 * @structure X402Network · X402_NETWORKS · getX402Network · X402PaymentRequirements ·
 *   X402PaymentPayload · X402VerifyResult · X402SettleResult · X402Facilitator · httpFacilitator ·
 *   testFacilitator · decodeXPayment · buildExactRequirements · extractPayTo
 * @usage
 *   const fac = config.x402TestFacilitator ? testFacilitator() : httpFacilitator(config.x402FacilitatorUrl);
 *   const reqs = buildExactRequirements({ network, payTo, amountMicros, resource, description });
 * @version-history
 *   v1.0.0 — 2026-07-18 — Initial x402 facilitator client + network registry + test double (TARGET-042)
 */
import { safeFetch } from '../utils/url-validator.js';
import { microsToUsdcRaw } from './money.js';

/** One network the x402 handler can settle on: the chain id x402 uses + the settlement asset. */
export interface X402Network {
  /** x402 `network` id echoed in the accepts[] exact scheme and the X-PAYMENT payload. */
  id: string;
  /** The settlement asset (USDC) contract address on this network. */
  asset: string;
  /** The asset's EIP-712 domain (name + version) the buyer signs against — the exact scheme `extra`. */
  extra: { name: string; version: string };
}

/**
 * The network registry — the ONE place a chain/asset is defined. Adding Base mainnet, Solana, or
 * another network is a new entry here, never a change to the handler or the commerce core
 * (TARGET-042: network is a parameter, selected by config.x402Network).
 */
export const X402_NETWORKS: Record<string, X402Network> = {
  'base-sepolia': {
    id: 'base-sepolia',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC on Base Sepolia (testnet)
    extra: { name: 'USDC', version: '2' },
  },
  'base': {
    id: 'base',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base mainnet
    extra: { name: 'USD Coin', version: '2' },
  },
};

export function getX402Network(id: string): X402Network | undefined {
  return X402_NETWORKS[id];
}

// ── x402 protocol wire types (x402 v1). Written to the spec so a real x402 client interoperates. ──

/** One entry of a 402 response's `accepts[]`: what a payment must satisfy to unlock the resource. */
export interface X402PaymentRequirements {
  scheme: 'exact';
  network: string;
  /** Atomic units of the asset (USDC has 6 decimals, matching AIMEAT money micros) as a string. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

/** The decoded X-PAYMENT header (base64 of this JSON) the buyer returns to settle. */
export interface X402PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
}

export interface X402VerifyResult { isValid: boolean; invalidReason?: string; payer?: string }
export interface X402SettleResult { success: boolean; transaction?: string; network?: string; payer?: string; errorReason?: string }

/**
 * The facilitator contract: verify a payment proof, then settle it onchain. Two implementations —
 * {@link httpFacilitator} (the real Coinbase-style service) and {@link testFacilitator} (an
 * off-chain double for E2E). The handler depends only on this interface, so the network and the
 * facilitator are both swappable parameters.
 */
export interface X402Facilitator {
  verify(payload: X402PaymentPayload, requirements: X402PaymentRequirements): Promise<X402VerifyResult>;
  settle(payload: X402PaymentPayload, requirements: X402PaymentRequirements): Promise<X402SettleResult>;
}

/**
 * The real facilitator: POST { x402Version, paymentPayload, paymentRequirements } to {baseUrl}/verify
 * and /settle. Every call goes through safeFetch (Rule 10: all non-constant outbound HTTP is SSRF
 * guarded). The facilitator performs the EIP-3009 signature check and the onchain USDC transfer;
 * AIMEAT never touches a key or holds funds.
 */
export function httpFacilitator(baseUrl: string): X402Facilitator {
  const url = baseUrl.replace(/\/+$/, '');
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await safeFetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`x402 facilitator ${path} responded ${res.status}`);
    return await res.json() as T;
  }
  return {
    verify: (paymentPayload, paymentRequirements) =>
      post<X402VerifyResult>('/verify', { x402Version: 1, paymentPayload, paymentRequirements }),
    settle: (paymentPayload, paymentRequirements) =>
      post<X402SettleResult>('/settle', { x402Version: 1, paymentPayload, paymentRequirements }),
  };
}

/**
 * TEST ONLY: an off-chain facilitator double so the x402 chain — 402 → sign → X-PAYMENT → verify →
 * settle → resource, and a replay of the same proof rejected — is E2E-provable without a testnet
 * wallet or a real facilitator. verify() accepts any well-formed exact payload whose value matches
 * the requirement; settle() succeeds ONCE per authorization nonce and fails on replay, mirroring the
 * USDC contract's single-use EIP-3009 nonce. The used-nonce set lives in the closure, so each server
 * boot starts clean. Registered only when config.x402TestFacilitator; NEVER a real settlement.
 */
export function testFacilitator(): X402Facilitator {
  const usedNonces = new Set<string>();
  return {
    async verify(payload, requirements) {
      const auth = payload?.payload?.authorization;
      if (!auth?.from || !auth?.nonce) return { isValid: false, invalidReason: 'malformed_authorization' };
      if (auth.value !== requirements.maxAmountRequired) return { isValid: false, invalidReason: 'insufficient_value' };
      if (usedNonces.has(auth.nonce)) return { isValid: false, invalidReason: 'nonce_already_used' };
      return { isValid: true, payer: auth.from };
    },
    async settle(payload, requirements) {
      const auth = payload.payload.authorization;
      if (usedNonces.has(auth.nonce)) return { success: false, errorReason: 'nonce_already_used' };
      usedNonces.add(auth.nonce);
      return { success: true, transaction: `0xtest${auth.nonce.replace(/[^a-fA-F0-9]/g, '').slice(0, 24)}`, network: requirements.network, payer: auth.from };
    },
  };
}

/** Decode a base64 X-PAYMENT header into an exact-scheme payload; null on missing/malformed input. */
export function decodeXPayment(header: string | undefined): X402PaymentPayload | null {
  if (!header) return null;
  try {
    const payload = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as X402PaymentPayload;
    if (!payload || payload.scheme !== 'exact' || !payload.payload?.authorization?.nonce) return null;
    return payload;
  } catch { return null; }
}

/**
 * Build the exact-scheme PaymentRequirements for a MONEY amount. money micros → USDC atomic units is
 * the identity (both carry 6 decimals), so a 1.50 USD price (1_500_000 micros) is 1.50 USDC — this is
 * model 2 made concrete: the price is USD, the settlement instrument is USDC, one to one.
 */
export function buildExactRequirements(args: {
  network: X402Network; payTo: string; amountMicros: number; resource: string; description: string;
}): X402PaymentRequirements {
  return {
    scheme: 'exact',
    network: args.network.id,
    maxAmountRequired: String(microsToUsdcRaw(args.amountMicros)),
    resource: args.resource,
    description: args.description,
    mimeType: 'application/json',
    payTo: args.payTo,
    maxTimeoutSeconds: 120,
    asset: args.network.asset,
    extra: args.network.extra,
  };
}

/**
 * Pull the seller's USDC payout address (payTo) from their opaque `commerce.psp` record. Accepts a
 * few shapes — `{ payTo }`, `{ address }`, `{ x402: { address } }` — and returns it only when it is a
 * well-formed EVM address, so a Stripe-only psp (no address) simply yields undefined and the handler
 * answers "seller has no x402 address" rather than settling to a bad target.
 */
export function extractPayTo(psp: unknown): string | undefined {
  if (!psp || typeof psp !== 'object') return undefined;
  const p = psp as { payTo?: unknown; address?: unknown; x402?: { address?: unknown; payTo?: unknown } };
  const candidate = p.payTo ?? p.address ?? p.x402?.address ?? p.x402?.payTo;
  return typeof candidate === 'string' && /^0x[a-fA-F0-9]{40}$/.test(candidate) ? candidate : undefined;
}
