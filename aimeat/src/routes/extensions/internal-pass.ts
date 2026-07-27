/**
 * @file src/routes/extensions/internal-pass.ts
 * @description A one-shot, in-process pass saying "this call was already settled upstream, do not
 *   charge it again".
 *
 *   An extension-backed capability runs behind this node's OWN authenticated HTTP surface: the
 *   app-tool route settles the contract and then invokes the capability over loopback, which walks
 *   straight back into the raw-invoke paywall. Once that paywall started charging for actions a
 *   priced app-tool sells (it had to — the raw route was a free door onto every priced product on
 *   the node), one call would settle twice.
 *
 *   The settlement belongs to the app-tool route, because that route KNOWS which product was
 *   bought. The raw route cannot: one extension action can be sold under several tools, and a
 *   caller holding contracts for two of them gives no clue which one they meant. So the app-tool
 *   route charges, and hands the invoke a pass.
 *
 *   The pass is a random token held in this process's memory, consumed on first use and expiring in
 *   seconds. It is never minted from user input, never returned to a client, and travels only on
 *   the loopback request the node makes to itself. A pass that arrives from anywhere else does not
 *   exist in the map, so it does nothing — the header cannot be forged into a free call, only into
 *   a normal paid one.
 * @structure mintInternalPass(coordExt, coordAction) · consumeInternalPass(token) · INTERNAL_PASS_HEADER
 * @usage
 *   const pass = mintInternalPass(coordExt, toolName);            // app-tool route, after settling
 *   headers[INTERNAL_PASS_HEADER] = pass;                          // on the loopback invoke
 *   const settled = consumeInternalPass(req.header(INTERNAL_PASS_HEADER));  // paywall
 * @version-history
 *   v1.0.0 — 2026-07-27 — Initial: one settlement per call once the raw door became chargeable.
 */
import { randomBytes } from 'node:crypto';

/** Header the loopback invoke carries. Meaningless to an outside caller — see the file note. */
export const INTERNAL_PASS_HEADER = 'x-aimeat-internal-pass';

/** What was settled upstream, so the paywall can log what it is standing down for. */
export interface InternalPass {
  coordExt: string;
  coordAction: string;
}

/**
 * Passes live milliseconds in practice — the loopback request is the very next thing that happens.
 * Ten seconds is generous for a slow event loop and short enough that a leaked map entry is a
 * rounding error rather than a lingering credential.
 */
const TTL_MS = 10_000;

const passes = new Map<string, { pass: InternalPass; expiresAt: number }>();

/** Drop anything expired. Cheap: the map holds at most the calls in flight. */
function sweep(now: number): void {
  for (const [token, held] of passes) {
    if (held.expiresAt <= now) passes.delete(token);
  }
}

export function mintInternalPass(coordExt: string, coordAction: string): string {
  const now = Date.now();
  sweep(now);
  const token = randomBytes(24).toString('base64url');
  passes.set(token, { pass: { coordExt, coordAction }, expiresAt: now + TTL_MS });
  return token;
}

/**
 * Consume a pass. Returns what it covered, or null if it is absent, unknown, expired or already
 * used — every one of which means "charge this call normally", never "let it through free".
 */
export function consumeInternalPass(token: string | undefined | null): InternalPass | null {
  if (!token) return null;
  const held = passes.get(token);
  if (!held) return null;
  passes.delete(token);                       // single use, even when expired
  return held.expiresAt > Date.now() ? held.pass : null;
}
