/**
 * @file src/middleware/refusals.ts
 * @description The refusals a PERSON hears, written for the person rather than for us.
 *
 *   WHAT THIS IS FOR. Of 2107 messages a caller can see, 490 are refusal-shaped and 22 of them say
 *   what to do next. Forty-three say exactly "Access denied" and nothing else. That is the moment a
 *   person decides whether this system is worth the trouble, and today it tells them they did
 *   something wrong, does not say what, and offers no way forward.
 *
 *   THE FOUR RUNGS, in this order, every time:
 *     1. what was being attempted — so it reads as handled, not dumped on them
 *     2. the one thing only they can decide
 *     3. something else we can try if the answer is no, so it is not a dead end
 *     4. ask the people who run this, WITHOUT the person writing anything
 *   The fourth is appended to every error by envelope.ts already, so a builder here supplies 1-3.
 *
 *   TWO READERS, TWO PLACES. `message` is the sentence, and it must survive being read aloud to
 *   somebody who has never heard of a scope. The identifiers go in `details`, where whoever wants
 *   them can look. Putting both in one sentence is why neither reader is served today.
 *
 *   A NOTE ON WHO ACTUALLY READS THIS. Almost nobody sees these with their own eyes: an assistant
 *   reads them and speaks to the person. That is the reason the sentence must be plain rather than
 *   the reason it can stay technical — a model repeats the register it is handed.
 * @structure
 *   - refuseNotYours() — the thing belongs to someone else
 *   - refuseNeedsPermission() — the owner has not granted this agent that permission yet
 *   - refuseNotMember() — a shared space this person has not joined
 *   - refuseNeedsSignIn() — nobody is signed in
 * @usage
 *   res.status(403).json(refuseNotYours(config, { thing: 'app', action: 'change' }));
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial, from the measurement of what our refusals say.
 */
import type { AimeatConfig } from '../config.js';
import { error, type AimeatResponse, type HintAction } from './envelope.js';

/** Look at your own things instead — the alternative that keeps a refusal from being a dead end. */
const seeYourOwn = (listUrl: string): HintAction => ({
    description: 'See the ones that are yours',
    method: 'GET',
    url: listUrl,
});

/**
 * Someone else owns this.
 *
 * NOT "Access denied". The person did nothing wrong: they asked about a thing that belongs to
 * somebody else, which is an ordinary mistake and reads as an accusation only because of how we
 * phrase it. `owner` is included when naming them is not itself a disclosure — on a public
 * catalogue it helps, and the caller can see it anyway.
 */
export function refuseNotYours(
    config: AimeatConfig,
    opts: { thing: string; action?: string; listUrl?: string; owner?: string; details?: unknown },
): AimeatResponse {
    const action = opts.action ?? 'change';
    const sentence = opts.owner
        ? `This ${opts.thing} belongs to ${opts.owner}, so it cannot be ${action}d from here.`
        : `This ${opts.thing} belongs to someone else, so it cannot be ${action}d from here.`;
    return error(config.nodeId, 'ACCESS_DENIED', sentence, 403, opts.details,
        opts.listUrl ? [seeYourOwn(opts.listUrl)] : undefined);
}

/**
 * The owner has not given this agent that permission yet.
 *
 * The most common refusal on the node and the one most worth getting right: it is a QUESTION for the
 * owner, not a failure. `want` is what the agent was trying to do, in plain words — "save this under
 * your name", not "write to the owner namespace". The scope word goes in `details`.
 */
export function refuseNeedsPermission(
    config: AimeatConfig,
    opts: { want: string; scope?: string; grantUrl?: string; alternative?: HintAction },
): AimeatResponse {
    const next: HintAction[] = [{
        description: `Give permission to ${opts.want}`,
        method: 'GET',
        url: opts.grantUrl ?? '/profile/agents',
        note: 'The owner turns this on per agent, and can turn it off again at any time.',
    }];
    if (opts.alternative) next.push(opts.alternative);
    return error(
        config.nodeId,
        'SCOPE_DENIED',
        `Your assistant would need your permission to ${opts.want}.`,
        403,
        opts.scope ? { required_permission: opts.scope } : undefined,
        next,
    );
}

/** A shared space this person has not joined. An invitation is missing, not a right. */
export function refuseNotMember(
    config: AimeatConfig,
    opts: { space: string; requestUrl?: string; details?: unknown },
): AimeatResponse {
    const next: HintAction[] = [];
    if (opts.requestUrl) {
        next.push({ description: 'Ask to be let in', method: 'POST', url: opts.requestUrl });
    }
    return error(
        config.nodeId,
        'FORBIDDEN',
        `${opts.space} is a shared space and you are not a member of it yet.`,
        403,
        opts.details,
        next.length ? next : undefined,
    );
}

/** Nobody is signed in. Say what signing in is for, not that authentication failed. */
export function refuseNeedsSignIn(config: AimeatConfig, opts?: { want?: string }): AimeatResponse {
    const sentence = opts?.want
        ? `Sign in first, and then you can ${opts.want}.`
        : 'Sign in first — this is something only you can see.';
    return error(config.nodeId, 'AUTH_REQUIRED', sentence, 401, undefined, [
        { description: 'Sign in', method: 'POST', url: '/v1/auth/token' },
    ]);
}
