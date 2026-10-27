/**
 * @file src/services/setup-code.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-time setup code that POST /v1/setup/init asks for from a request others could make.
 *
 *   WHY. Until 2026-10-16 the first-owner setup was open to any address while the node had no owner,
 *   so on a fresh node with a public address whoever arrived first became its operator. Decision
 *   (Jouni, 2026-10-16): a node whose base URL is not a loopback address generates a one-time code at
 *   start while it has no owner, prints it in the start log with one sentence on where to enter it,
 *   and the setup refuses without it. A loopback node (local development, the E2E runner, `pnpm
 *   sandbox`) needs no code. The operator runs no script.
 *
 *   WHICH REQUESTS. A request goes without the code only when BOTH the base URL is loopback (the check
 *   the test-money warning uses, utils/test-money-guard.ts isLoopbackBaseUrl, not the security profile:
 *   a node on a private LAN address is on the local profile and still reachable by other people) AND
 *   the request came in on a loopback socket. Until 2026-10-23 the base URL alone decided, so a node in
 *   Docker, which keeps the default http://localhost base URL while compose publishes its port on every
 *   address of the host, let whoever arrived first become its operator (secaudit2026oct22; Jouni,
 *   2026-10-23). The code is therefore issued at start on every node that has no operator, and a
 *   loopback node's start log says it is needed only from another machine.
 *
 *   HOW IT IS HELD. Only the SHA-256 digest of the code stays in memory, in one SetupCodeGate per
 *   config object (a process can serve more than one node), and a code is compared digest to digest
 *   with timingSafeEqual. take() checks and clears in one synchronous step, so of two requests that
 *   carry the right code only one creates the owner; release() puts it back when the owner could not
 *   be created, so the operator can try again without a restart. A restart issues a new code while
 *   the node still has no OPERATOR: an owner without the operator role (a directory sync, an old
 *   node) does not end the need, because the self-heal would make the next account the operator.
 *
 *   THE CODE. Twelve characters of Crockford base32 (60 bits), printed in three groups of four. The
 *   comparison ignores case, spaces and hyphens, and reads O as 0 and I or L as 1, so a code copied
 *   from a terminal by hand still matches.
 *
 *   WHICH ROUTES. Every path that grants the operator role by the first-owner or the no-operator rule:
 *   POST /v1/setup/init and, through claimOperatorSetupCode (services/owner-provisioning.ts),
 *   POST /v1/ghii, POST /v1/ghii/register-web, POST /v1/owners, provisionOwner (an identity
 *   provider's first sign-in, an invitation) and the sign-in self-heal (routes/ghii/owner-session.ts).
 *   Once the node has an operator none of them asks for the code.
 * @structure setupCodeRequired(config, fromLoopback) · SetupCodeGate · setupCodeGateFor(config) ·
 *   setupCodeRefusal(config, input, fromLoopback) · SETUP_CODE_USED_MESSAGE · normalizeSetupCode(input)
 * @usage
 *   if (!hasOperator) logger.warn(`Setup code: ${setupCodeGateFor(config).issue()} ...`);
 *   const refusal = setupCodeRefusal(config, body.setupCode, isLoopbackAddress(req.socket.remoteAddress));
 * @version-history
 *   2026-10-27 -- requestFromThisMachine: the routes' `fromLoopback` also asks a loopback Host header and
 *     no forwarding header, so a request a same-host tunnel or reverse proxy hands on is asked for the
 *     code (secaudit2026oct26, loopback-socket-behind-local-proxy).
 *   v1.3.0 -- 2026-10-23 -- setupCodeRequired and setupCodeRefusal take `fromLoopback`, the request's
 *     socket address: a loopback base URL waives the code only for a request from loopback
 *     (secaudit2026oct22; Jouni, 2026-10-23).
 *   v1.2.1 -- 2026-10-19 -- Each character of the code is drawn with crypto.randomInt instead of a random byte modulo the alphabet (CodeQL 1749).
 *   v1.2.0 — 2026-10-16 — The code is needed while the node has no operator, not only no owner; the
 *     refusals say "operator" (Jouni, 2026-10-16).
 *   v1.1.0 — 2026-10-16 — setupCodeRefusal and SETUP_CODE_USED_MESSAGE moved here from routes/setup.ts, so
 *     the registration routes refuse the first account with the same codes and sentences (Jouni, 2026-10-16).
 *   v1.0.0 — 2026-10-16 — Initial (Jouni, 2026-10-16: first-owner setup needs a one-time code on a public node).
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { AimeatConfig } from '../config-types.js';
import { isLoopbackBaseUrl } from '../utils/test-money-guard.js';
import { isLoopbackAddress } from '../auth/loopback-pass.js';

/** Crockford base32: no I, L, O or U, so a code read aloud or copied by hand is not misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;

/**
 * Whether the first-owner setup asks this request for the one-time code. Only a request that came in
 * on a loopback socket of a node whose base URL is loopback goes without it. `fromLoopback` is the
 * route's reading of the request's SOCKET address (isLoopbackAddress(req.socket.remoteAddress)),
 * never req.ip, which a forwarded-for header sets. A node in Docker keeps the default base URL
 * http://localhost:40050 while its port is published on every address of the host, and a request
 * from outside the container arrives from the container network, so it is asked for the code
 * (secaudit2026oct22; Jouni, 2026-10-23).
 */
export function setupCodeRequired(config: Pick<AimeatConfig, 'baseUrl'>, fromLoopback: boolean): boolean {
  return !(fromLoopback && isLoopbackBaseUrl(config.baseUrl));
}

/** The headers a forwarder (a reverse proxy or a tunnel client) adds to the request it hands on. */
const FORWARDING_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host'] as const;

/** Whether a Host header names this machine itself: localhost (and *.localhost), 127.x or ::1. */
function loopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const lower = host.trim().toLowerCase();
  const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(lower);
  const name = v6 ? v6[1] : lower.replace(/:\d+$/, '');
  return name === 'localhost' || name.endsWith('.localhost') || name === '::1' || /^127(?:\.\d{1,3}){3}$/.test(name);
}

/**
 * The `fromLoopback` every setup-code route passes: the request came in on a loopback socket, names
 * this machine in its Host header, and carries no forwarding header. A tunnel client or a reverse
 * proxy on the same machine hands every outside request on over a loopback socket, so the socket
 * alone let the first visitor through such a forwarder become the operator of a node that kept the
 * default loopback base URL (secaudit2026oct26, loopback-socket-behind-local-proxy). Local
 * development, the E2E runner and `pnpm sandbox` (http://localhost or 127.0.0.1, no forwarder) still
 * need no code; anyone else has it from the start log.
 */
export function requestFromThisMachine(req: { socket?: { remoteAddress?: string | undefined }; headers: Record<string, string | string[] | undefined> }): boolean {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return false;
  if (FORWARDING_HEADERS.some(h => req.headers[h] !== undefined)) return false;
  const host = req.headers.host;
  return loopbackHost(Array.isArray(host) ? host[0] : host);
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
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
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
export const SETUP_CODE_USED_MESSAGE = 'The setup code was used a moment ago by another request, so this node now has its operator. Reload the page and sign in, or register as a new account.';

/**
 * Why a request that would create this node's first owner is refused, or null when it may go on:
 * SETUP_CODE_REQUIRED without a code (or with none waiting), SETUP_CODE_INVALID with a wrong one.
 * Asks nothing of the store: the caller has already established that the node has no owner. Does
 * not use the code; take() does that just before the owner is created.
 */
export function setupCodeRefusal(config: Pick<AimeatConfig, 'baseUrl'> & object, input: unknown, fromLoopback: boolean): { code: 'SETUP_CODE_REQUIRED' | 'SETUP_CODE_INVALID'; message: string } | null {
  if (!setupCodeRequired(config, fromLoopback)) return null;
  const gate = setupCodeGateFor(config);
  if (!gate.pending) {
    return { code: 'SETUP_CODE_REQUIRED', message: 'This node needs a one-time setup code to make its first operator, and none is waiting. Restart the node, then use the code its start log prints.' };
  }
  if (typeof input !== 'string' || input.trim() === '') {
    return { code: 'SETUP_CODE_REQUIRED', message: 'This node has no operator yet, and this account would become its operator, which needs the one-time setup code. Look in the node\'s start log for the line that starts with "Setup code", and enter that code in the setup wizard or send it as setupCode.' };
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
