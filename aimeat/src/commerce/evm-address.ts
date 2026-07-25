/**
 * @file src/commerce/evm-address.ts
 * @description Guards for the ONE value a seller types by hand in the whole stablecoin flow: the
 *   address their USDC settles to. Getting it wrong is not a validation nicety — an EIP-3009 transfer
 *   to the wrong target is irreversible, and the two ways to get it wrong are both easy:
 *
 *     1. A TYPO. 40 hex characters carry no meaning a human can proof-read. EIP-55 encodes a checksum
 *        in the CAPITALISATION of the hex, so a mixed-case address that fails the checksum is almost
 *        certainly mistyped or truncated. (An all-lowercase or all-uppercase address carries no
 *        checksum at all, so it is accepted and normalised rather than rejected.)
 *     2. PASTING THE TOKEN CONTRACT instead of a wallet. The USDC/EURC contract addresses are the
 *        values a seller most plausibly has on their clipboard while setting this up — they appear in
 *        every x402 doc, and in our own network registry. Funds sent there are gone.
 *
 *   The optional on-chain probe answers the remaining question — is this a contract or an account the
 *   seller can hold a key for — but only when the operator configured an RPC. It is best-effort by
 *   design: a save must not depend on a third party being reachable, so an unreachable RPC lets the
 *   save through while a definite "this is a contract" answer blocks it.
 * @structure isEvmAddressShape · toChecksumAddress · checksumIsWrong · settlementAssetMatch ·
 *   probeIsContract
 * @usage
 *   const bad = settlementAssetMatch(addr);            // → { network, currency } when it is a token
 *   if (checksumIsWrong(addr)) return 400;
 *   const stored = toChecksumAddress(addr);
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial guards after a real misconfiguration: the USDC Base-Sepolia contract
 *     address was saved as a payout address, and the shape-only check accepted it silently.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { X402_NETWORKS } from './x402-facilitator.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';

/** 0x + 40 hex characters. Shape only — says nothing about whether the address means anything. */
export function isEvmAddressShape(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

/** The EIP-55 mixed-case form: capitalisation derived from keccak-256 of the lowercase hex body. */
export function toChecksumAddress(value: string): string {
  const body = value.slice(2).toLowerCase();
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(body))).toString('hex');
  let out = '0x';
  for (let i = 0; i < body.length; i++) {
    out += parseInt(hash[i] as string, 16) >= 8 ? (body[i] as string).toUpperCase() : body[i];
  }
  return out;
}

/**
 * True when the input carries a checksum (it is mixed case) and that checksum does not match.
 * All-lowercase / all-uppercase input carries no checksum, so it is not "wrong" — just unverifiable.
 */
export function checksumIsWrong(value: string): boolean {
  const body = value.slice(2);
  const mixedCase = body !== body.toLowerCase() && body !== body.toUpperCase();
  return mixedCase && toChecksumAddress(value) !== value;
}

/** The settlement token this address IS, when it is one of ours. A payout address must never be a token. */
export function settlementAssetMatch(value: string): { network: string; currency: string } | null {
  const needle = value.toLowerCase();
  for (const [networkId, network] of Object.entries(X402_NETWORKS)) {
    for (const [currency, asset] of Object.entries(network.assets)) {
      if (asset && asset.address.toLowerCase() === needle) return { network: networkId, currency };
    }
  }
  return null;
}

/**
 * Ask the chain whether the address holds contract code. `true` = definitely a contract (block the
 * save), `false` = an externally-owned account, `null` = could not tell, which must never block:
 * an RPC outage is not a reason to stop a seller configuring their own payouts.
 */
export async function probeIsContract(rpcUrl: string, address: string): Promise<boolean | null> {
  if (!rpcUrl) return null;
  try {
    const res = await safeFetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const body = await res.json() as { result?: unknown };
    if (typeof body.result !== 'string') return null;
    return body.result !== '0x' && body.result !== '0x0';
  } catch (err) {
    logger.warn('[payout] on-chain address probe unavailable; saving without it', { error: String(err) });
    return null;
  }
}
