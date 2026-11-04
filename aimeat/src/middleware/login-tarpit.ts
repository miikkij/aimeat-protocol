/**
 * @file src/middleware/login-tarpit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A per-IP delay in front of the credential doors that grows with each failure, so
 *   guessing costs the guesser time and costs everyone else nothing.
 *
 *   WHY THIS AND NOT A TIGHTER RATE LIMIT. A rate limit says "no" and the attacker moves on to the
 *   next attempt the moment the window opens; the throughput is capped but the campaign continues
 *   at that cap indefinitely. A delay changes the economics instead: the first couple of failures
 *   are free, so a person who mistypes their password notices nothing, and by the sixth the caller
 *   is waiting twenty seconds for each guess. That is the difference between a wall somebody paces
 *   in front of and a floor they sink into.
 *
 *   WHY IT STILL REFUSES EVENTUALLY. Holding a connection open is how this control becomes the
 *   attack: enough concurrent guesses, each parked for half a minute, and the sockets are the
 *   resource being exhausted. So the delay grows to a ceiling and then stops being a delay and
 *   becomes a cheap 429 with a Retry-After, and there is a cap on how many requests may be asleep
 *   here at once. Past that cap nobody waits; they are refused immediately.
 *
 *   WHY FAILURES AND NOT ATTEMPTS. The bucket counts refusals, read off the response status, so a
 *   successful sign-in never pays and never leaves a mark. It also means no login handler had to be
 *   edited to report anything: the door reports itself.
 *
 *   WHY /64 AND NOT THE ADDRESS. Providers hand out whole IPv6 blocks to one customer, so keying on
 *   the full address gives an attacker an unlimited supply of fresh buckets by rotating the host
 *   bits. Same normalisation the rate limiter uses, from the same function, so the two agree about
 *   who a caller is.
 *
 *   WHAT IT DOES NOT DO. It never blocks permanently and never bans. A shared office address or a
 *   mobile carrier NAT puts hundreds of blameless people behind one key, and a permanent block
 *   would take them all out over one attacker; every penalty here decays on its own.
 * @structure loginTarpit(config) · noteCredentialOutcome (internal, via res 'finish')
 * @usage router.post('/v1/ghii/login', loginTarpit(config), rateLimit({...}), handler)
 * @version-history
 *   2026-11-04 — The count per address is kept in the node's storage (windowCounter 'login-tarpit'), so
 *     N processes are one tarpit; the same free failures, steps, wall and window (codebase analysis
 *     2026-11-03, HA stage 2). currentDelayMs is async.
 *   2026-10-16 — Marks the response as recorded, so middleware/refusal-recorder.ts does not write the
 *     same refusal twice (QA audit S1-02).
 *   v1.0.0 — 2026-08-17 — Initial: growing per-IP delay on the credential doors.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config-types.js';
import { ipRateKey } from './rate-limit.js';
import { getStats } from '../services/stats.js';
import { recordAuthFailure, markRefusalRecorded, type AuthFailureContext } from '../services/auth-audit.js';
import { logger } from '../utils/logger.js';
import { windowCounter } from '../services/ephemeral-claims.js';

/**
 * The account name the caller tried, when the door takes one.
 *
 * Worth recording and safe to record: it is what the attacker chose to send, not something of the
 * account holder's. It is what turns a wall of refusals into "somebody is working through a list
 * of usernames" or "somebody is hammering one real account". Capped, because it is caller-written.
 */
function usernameTried(req: Request): string {
  const b = req.body as Record<string, unknown> | undefined;
  const raw = b?.username ?? b?.owner ?? b?.gaii;
  return typeof raw === 'string' ? raw.slice(0, 80) : '';
}

/** What the refusal log needs, lifted off the request. The service itself takes plain data. */
function auditContext(req: Request): AuthFailureContext {
  return {
    method: req.method,
    path: req.path,
    ip: req.ip ?? req.socket?.remoteAddress ?? '',
    host: String(req.headers.host ?? ''),
    userAgent: String(req.headers['user-agent'] ?? ''),
    authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    hasCookie: !!req.headers.cookie,
  };
}

/**
 * One count for the whole node: an attacker moving between the login and the code door is one
 * campaign, and giving each door its own count would let them pay the entry price twice over. Each
 * key's count is the refusals inside its window (`count`) and when it decays to nothing if nothing
 * else arrives (`expiresAt`), kept in the node's storage (services/ephemeral-claims.ts), so a
 * guesser whose requests a load balancer spreads over N processes meets one tarpit, not N.
 */
const buckets = windowCounter('login-tarpit');

// process-local: the outcome writes this process started and has not finished, per key. A request
// from the same address waits for them, so it reads its own last outcome as the in-memory count gave
// it; another process reads the stored count.
const writing = new Map<string, Promise<void>>();

/** Run `fn` after the writes this process already started for `key`, and remember it until it ends. */
function writeInTurn(key: string, fn: () => Promise<unknown>): void {
  const run = (writing.get(key) ?? Promise.resolve()).then(fn).then(() => undefined, (err: unknown) => {
    logger.warn('login-tarpit: the count could not be written; the next attempt reads the last one written', { key, error: String(err) });
  });
  writing.set(key, run);
  void run.then(() => { if (writing.get(key) === run) writing.delete(key); });
}

/** The key's live count after this process's own writes: refusals in a window not yet ended. */
async function liveFails(key: string, now: number): Promise<{ fails: number; resetAt: number }> {
  await writing.get(key);
  const b = await buckets.read(key);
  return b && now <= b.expiresAt ? { fails: b.count, resetAt: b.expiresAt } : { fails: 0, resetAt: now };
}

/** How many requests are currently asleep here. The cap on this is what stops the tarpit from
 *  being the denial of service it exists to prevent. Per process, as the sockets it guards are. */
let sleeping = 0;

/** Test seam: forget every penalty this process holds in memory. */
export function resetLoginTarpit(): void {
  buckets.here.clearAll();
  sleeping = 0;
}

/** What this key would wait for its NEXT refusal, in ms. Exported for the operator surface. */
export async function currentDelayMs(config: AimeatConfig, key: string): Promise<number> {
  return delayFor(config, (await liveFails(key, Date.now())).fails);
}

/**
 * What a caller waits, given how many times they have already been refused.
 *
 * `free` is how many refusals cost nothing, so the attempt AFTER the last free one already pays.
 * Two free failures means attempts one and two are answered at full speed and the third waits a
 * step; the first version made it the fourth, which is one more guess than was asked for.
 */
function delayFor(config: AimeatConfig, fails: number): number {
  if (fails < config.loginTarpitFreeFailures) return 0;
  const steps = fails - config.loginTarpitFreeFailures + 1;
  return Math.min(steps * config.loginTarpitStepMs, config.loginTarpitMaxDelayMs);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Delay this caller in proportion to how many times they have just been refused, and refuse them
 * outright once that stops being proportionate.
 *
 * Mount it BEFORE the handler and before any password verification: the point is that the guesser
 * pays before the node spends anything on them, and password hashing is the expensive part.
 */
export function loginTarpit(config: AimeatConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!config.loginTarpitEnabled) { next(); return; }
    // This route's 401 and 403 are written below with the name tried, so the response recorder
    // (middleware/refusal-recorder.ts) leaves them alone. It still counts a 401 in auth_failures_total.
    markRefusalRecorded(res);

    const key = ipRateKey(req.ip ?? req.socket?.remoteAddress);

    // Count the outcome once the response is written. 401/403/429 are the refusals worth counting;
    // a 400 is a malformed request rather than a wrong guess, and counting it would let a client
    // bug tarpit its own user.
    res.on('finish', () => {
      const refused = res.statusCode === 401 || res.statusCode === 403;
      // A 429 from this middleware is the wall working. It is recorded, because a log that shows
      // the guesses and not the point where they stopped understates the campaign by exactly the
      // part an operator wants to see. It is NOT counted as a new failure: penalising somebody for
      // being penalised would make the window grow on its own and never let a shared address out.
      const walled = res.statusCode === 429;
      if (walled) {
        recordAuthFailure(auditContext(req), {
          status: 401, code: 'ATTEMPTS_REFUSED',
          reason: `too many failed attempts, refused without trying${usernameTried(req) ? ` (was trying "${usernameTried(req)}")` : ''}`,
        });
      }
      if (refused) {
        // The refusal log, from the one place that sees the outcome of a credential door. These
        // handlers answer 401 themselves rather than through the auth middleware, so without this
        // the wrong-password attempts — the whole reason somebody opens this file — were the only
        // refusals on the node that went unrecorded.
        recordAuthFailure(auditContext(req), {
          status: res.statusCode === 403 ? 403 : 401,
          code: 'CREDENTIAL_REFUSED',
          // The name that was tried is the single most useful field here, and it is not a secret:
          // it is what an attacker chose to send. The password never appears, in any form.
          reason: `credential refused at ${req.path}${usernameTried(req) ? ` for "${usernameTried(req)}"` : ''}`,
        });
        // One more inside a live window, or 1 in a new one; the window ends a full window from now.
        writeInTurn(key, async () => {
          const at = Date.now();
          const counted = await buckets.bump(key, { now: at, windowMs: config.loginTarpitWindowMs, staleBefore: at, sliding: true });
          if (counted.count === config.loginTarpitBlockAfter) {
            // Once per campaign, not once per guess: the point of the line is that an operator can
            // see a campaign start without the log becoming the flood.
            logger.warn('login-tarpit: credential guessing from one address has reached the refusal threshold', {
              key, fails: counted.count, path: req.path,
            });
          }
        });
      } else if (res.statusCode < 400) {
        // A credential that worked clears a live penalty. The person who mistyped twice and then got
        // it right should not be slower for the next hour.
        writeInTurn(key, async () => {
          const b = await buckets.read(key);
          if (b && Date.now() <= b.expiresAt) await buckets.clear(key);
        });
      }
    });

    const now = Date.now();
    const { fails, resetAt } = await liveFails(key, now);
    if (fails >= config.loginTarpitBlockAfter) {
      const retryAfterSec = Math.ceil((resetAt - now) / 1000);
      getStats()?.increment('login_tarpit_blocked_total');
      res.setHeader('Retry-After', Math.max(1, retryAfterSec));
      res.status(429).json({
        ok: false, protocol: 'aimeat', version: 'v1', timestamp: new Date().toISOString(),
        error: {
          code: 'TOO_MANY_ATTEMPTS',
          message: `Too many failed attempts from this address. Try again in ${Math.max(1, retryAfterSec)} seconds.`,
        },
        hints: { next_actions: [{ description: 'Wait, then try again', method: 'POST', url: req.path }] },
      });
      return;
    }

    const delayMs = delayFor(config, fails);
    if (delayMs <= 0) { next(); return; }

    // The cap is the difference between a tarpit and an amplifier. Over it, refuse cheaply rather
    // than hold one more socket: the caller was going to be made to wait anyway.
    if (sleeping >= config.loginTarpitMaxConcurrent) {
      getStats()?.increment('login_tarpit_shed_total');
      res.setHeader('Retry-After', Math.ceil(delayMs / 1000));
      res.status(429).json({
        ok: false, protocol: 'aimeat', version: 'v1', timestamp: new Date().toISOString(),
        error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed attempts. Try again shortly.' },
        hints: { next_actions: [{ description: 'Wait, then try again', method: 'POST', url: req.path }] },
      });
      return;
    }

    sleeping++;
    getStats()?.increment('login_tarpit_delayed_total');
    try {
      await sleep(delayMs);
    } finally {
      sleeping--;
    }
    // The client may have given up while we held it. Writing to a closed socket is not an error
    // worth having, and running the handler for a caller who left is work nobody asked for.
    //
    // The test is on the RESPONSE, never `req.destroyed`. An IncomingMessage is destroyed as soon
    // as its body has been read, which the body parser does on every POST before this middleware
    // ever runs — so guarding on it meant every delayed request returned here without calling
    // next() and hung until the client timed out. The door was open for exactly as long as nobody
    // was being delayed.
    if (res.writableEnded || res.destroyed) return;
    next();
  };
}
