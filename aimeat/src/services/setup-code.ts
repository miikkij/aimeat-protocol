/**
 * @file src/services/setup-code.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-time setup code that POST /v1/setup/init asks for on a node others can reach.
 *
 *   WHY. Until 2026-10-16 the first-owner setup was open to any address while the node had no owner,
 *   so on a fresh node with a public address whoever arrived first became its operator. Decision
 *   (Jouni, 2026-10-16): a node whose base URL is not a loopback address generates a one-time code at
 *   start while it has no owner, prints it in the start log with one sentence on where to enter it,
 *   and the setup refuses without it. A loopback node (local development, the E2E runner, `pnpm
 *   sandbox`) needs no code. The operator runs no script.
 *
 *   WHICH NODES. The test is the loopback check the test-money warning uses (utils/test-money-guard.ts
 *   isLoopbackBaseUrl), not the security profile: a node on a private LAN address is on the local
 *   profile and still reachable by other people.
 *
 *   HOW IT IS HELD. Only the SHA-256 digest of the code stays in memory, in one SetupCodeGate per
 *   config object (a process can serve more than one node), and a code is compared digest to digest
 *   with timingSafeEqual. take() checks and clears in one synchronous step, so of two requests that
 *   carry the right code only one creates the owner; release() puts it back when the owner could not
 *   be created, so the operator can try again without a restart. A restart issues a new code while
 *   the node still has no owner. Once an owner exists the setup answers ALREADY_CONFIGURED before it
 *   asks for the code, and the code is cleared.
 *
 *   THE CODE. Twelve characters of Crockford base32 (60 bits), printed in three groups of four. The
 *   comparison ignores case, spaces and hyphens, and reads O as 0 and I or L as 1, so a code copied
 *   from a terminal by hand still matches.
 *
 *   WHICH ROUTES. Every route that can create the first owner, and so the operator: POST /v1/setup/init
 *   and, through claimFirstOwnerSetupCode (services/owner-provisioning.ts), POST /v1/ghii,
 *   POST /v1/ghii/register-web, POST /v1/owners and provisionOwner (an identity provider's first
 *   sign-in, an invitation). Once the node has an owner none of them asks for the code.
 * @structure setupCodeRequired(config) · SetupCodeGate · setupCodeGateFor(config) · setupCodeRefusal(config, input) ·
 *   SETUP_CODE_USED_MESSAGE · normalizeSetupCode(input)
 * @usage
 *   if (setupCodeRequired(config) && !hasOwner) logger.warn(`Setup code: ${setupCodeGateFor(config).issue()} ...`);
 *   const gate = setupCodeGateFor(config); if (!gate.matches(body.setupCode)) refuse();
 * @version-history
 *   v1.1.0 — 2026-10-16 — setupCodeRefusal and SETUP_CODE_USED_MESSAGE moved here from routes/setup.ts, so
 *     the registration routes refuse the first account with the same codes and sentences (Jouni, 2026-10-16).
 *   v1.0.0 — 2026-10-16 — Initial (Jouni, 2026-10-16: first-owner setup needs a one-time code on a public node).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AimeatConfig } from '../config-types.js';
import { isLoopbackBaseUrl } from '../utils/test-money-guard.js';

/** Crockford base32: no I, L, O or U, so a code read aloud or copied by hand is not misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;

/** Whether the first-owner setup asks for the one-time code: on any node whose base URL is not loopback. */
export function setupCodeRequired(config: Pick<AimeatConfig, 'baseUrl'>): boolean {
  return !isLoopbackBaseUrl(config.baseUrl);
}

/**
 * The code as it is compared: upper case, without spaces and hyphens, O read as 0 and I or L as 1.
 * Anything that is not a string is the empty string.
 */
export function normalizeSetupCode(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

function digest(normalized: string): Buffer {
  return createHash('sha256').update(normalized, 'utf8').digest();
}

/** One node's code: the digest only, single use. */
export class SetupCodeGate {
  private hash: Buffer | null = null;
  private held: Buffer | null = null;

  /** Generate a new code, keep its digest, and return the code for the start log. Replaces any earlier one. */
  issue(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
    this.hash = digest(code);
    this.held = null;
    return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
  }

  /** Whether a code is waiting to be used. */
  get pending(): boolean {
    return this.hash !== null;
  }

  /** Whether `input` is the waiting code. Compared digest to digest in constant time; never true when no code waits. */
  matches(input: unknown): boolean {
    const normalized = normalizeSetupCode(input);
    if (!this.hash || normalized.length === 0) return false;
    return timingSafeEqual(digest(normalized), this.hash);
  }

  /**
   * Use the code: true and the code is gone when `input` matches, false otherwise. Synchronous, so two
   * requests with the right code cannot both pass. Call commit() once the owner exists, or release()
   * when it could not be created.
   */
  take(input: unknown): boolean {
    if (!this.matches(input)) return false;
    this.held = this.hash;
    this.hash = null;
    return true;
  }

  /** The owner was created: the taken code is spent. */
  commit(): void {
    this.held = null;
  }

  /** The owner could not be created: the taken code waits again, unless a newer one was issued meanwhile. */
  release(): void {
    if (this.held && !this.hash) this.hash = this.held;
    this.held = null;
  }

  /** No code waits any more (the node has an owner). */
  clear(): void {
    this.hash = null;
    this.held = null;
  }
}

/** The refusal when the right code was used by another request a moment before this one took it. */
export const SETUP_CODE_USED_MESSAGE = 'The setup code was used a moment ago by another request, so this node now has its first owner. Reload the page and sign in, or register as a new account.';

/**
 * Why a request that would create this node's first owner is refused, or null when it may go on:
 * SETUP_CODE_REQUIRED without a code (or with none waiting), SETUP_CODE_INVALID with a wrong one.
 * Asks nothing of the store: the caller has already established that the node has no owner. Does
 * not use the code; take() does that just before the owner is created.
 */
export function setupCodeRefusal(config: Pick<AimeatConfig, 'baseUrl'> & object, input: unknown): { code: 'SETUP_CODE_REQUIRED' | 'SETUP_CODE_INVALID'; message: string } | null {
  if (!setupCodeRequired(config)) return null;
  const gate = setupCodeGateFor(config);
  if (!gate.pending) {
    return { code: 'SETUP_CODE_REQUIRED', message: 'This node needs a one-time setup code to create its first owner, and none is waiting. Restart the node, then enter the code its start log prints.' };
  }
  if (typeof input !== 'string' || input.trim() === '') {
    return { code: 'SETUP_CODE_REQUIRED', message: 'This node has no owner yet, and creating its first owner needs the one-time setup code. Look in the node\'s start log for the line that starts with "Setup code", and enter that code in the setup wizard or send it as setupCode.' };
  }
  if (!gate.matches(input)) {
    return { code: 'SETUP_CODE_INVALID', message: 'That setup code is not right. Copy the code from the node\'s start log, from the line that starts with "Setup code", and try again.' };
  }
  return null;
}

const gates = new WeakMap<object, SetupCodeGate>();

/** The gate of the node this config belongs to: the start log issues through it, the setup route checks through it. */
export function setupCodeGateFor(config: object): SetupCodeGate {
  let gate = gates.get(config);
  if (!gate) {
    gate = new SetupCodeGate();
    gates.set(config, gate);
  }
  return gate;
}
