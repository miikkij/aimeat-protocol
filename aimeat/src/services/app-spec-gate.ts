/**
 * @file src/services/app-spec-gate.ts
 * @description Did whoever is publishing this app read the build spec that is in force now?
 *
 *   THE CASE THIS EXISTS FOR (aimeat.io, 2026-08-11). An agent built and published an app without
 *   loading the `node:aimeat-app-builder` skill and without fetching GET /v1/prompts/build-app. It
 *   modelled the app on an old template it found in its own repository, and the result went live
 *   with three defects the spec answers in plain words: it read agent-written data with no
 *   ownerScope so the owner saw an empty screen, it hardcoded colours past the platform theme
 *   tokens so the light/dark switch did nothing, and it loaded /lib/aimeat-auth.js, which 404s.
 *
 *   AND THE LESSON FROM THE SAME SESSION. Both the MCP server instructions and the skill say to
 *   read the spec first, and both were skipped without consequence. What changed the agent's
 *   behaviour immediately was a machine-readable `mobile_hints` field in a publish response. A
 *   request in prose is advice; a value that has to be carried is a gate. So the spec asks to be
 *   carried, and the publish response says whether it was.
 *
 *   IT WARNS, IT DOES NOT REFUSE. The same reasoning as the AI-disclosure check (decision D2): a
 *   publish that fails is a publish that gets worked around, and the app then ships with less care
 *   rather than more. What it must not be is silent — including when the owner deliberately skips
 *   it, which is why `skipped-by-owner` is an answer and not an absence.
 * @structure
 *   - AppSpecCheck — what a publish response reports
 *   - evaluateSpecCheck(config, input) — ok | stale | missing | skipped
 * @usage
 *   import { evaluateSpecCheck } from './app-spec-gate.js';
 *   const specCheck = evaluateSpecCheck(config, { specToken, specAck });
 * @version-history
 *   v1.1.0 — 2026-08-15 — The 'ok' message says what the token proves (the spec was FETCHED at
 *     this version) instead of what it does not (that it was read). One publish carried the token
 *     after four regex searches over about a tenth of the document, and the unread parts are what
 *     the shipped app was missing.
 *   v1.0.0 — 2026-08-11 — initial.
 */
import type { AimeatConfig } from '../config.js';
import { buildAppSpecToken } from './build-app-prompt.js';

/** The skill that teaches the whole paved path, named in every non-ok answer. */
export const APP_BUILDER_SKILL_REF = 'node:aimeat-app-builder';

/** The one value the owner may send to publish without the token on purpose. */
export const SPEC_ACK_SKIPPED = 'skipped-by-owner';

export interface AppSpecCheck {
  /** `ok` = the token matches the spec as served now. Everything else is worth reading. */
  status: 'ok' | 'stale' | 'missing' | 'skipped';
  message: string;
  /** The skill that carries the full workflow. Present on everything but `ok`. */
  skill?: string;
  /** Where the spec lives, so the remedy is one fetch away. */
  spec_url?: string;
}

export interface SpecCheckInput {
  /** The digest the caller says they built against. */
  specToken?: string;
  /** `skipped-by-owner` when the owner decided to publish without the spec. */
  specAck?: string;
}

/**
 * Compare what the caller carried against the spec this node serves right now.
 *
 * A matching token wins over an ack: someone who read the spec has nothing to skip. The current
 * token is deliberately NOT echoed in a non-ok answer — handing it back would let the next call
 * satisfy the gate by copying a string out of an error, which is precisely the "somebody once saw a
 * document by this name" proof the digest exists to replace.
 */
export function evaluateSpecCheck(config: AimeatConfig, input: SpecCheckInput): AppSpecCheck {
  const expected = buildAppSpecToken(config);
  const given = typeof input.specToken === 'string' ? input.specToken.trim() : '';
  const specUrl = `${config.baseUrl.replace(/\/+$/, '')}/v1/prompts/build-app`;

  if (given && given === expected) {
    return {
      status: 'ok',
      // What this actually proves, said in the response rather than implied by the word "ok".
      //
      // The token is a digest of the spec DOCUMENT. Carrying it proves the document was fetched at
      // its current version, and nothing whatever about how much of it was read. On 2026-08-15 a
      // publish answered "Built against the current build spec" for an app assembled after four
      // regex searches over roughly a tenth of the text, and the parts never read — the shell
      // template, the login pill, the design system — are exactly what the published app was
      // missing. A stamp that overstates itself is worse than no stamp, because the next reader
      // believes it.
      message: 'You carried the current build spec token, so the spec was fetched at this version. '
        + 'That is what this attests — not that it was read. If you searched it rather than read it, '
        + 'the parts you skipped are the parts that bite: the shell template, the login pill, the '
        + 'namespace rule.',
    };
  }

  if (input.specAck === SPEC_ACK_SKIPPED) {
    return {
      status: 'skipped',
      message: 'The owner chose to publish without the build spec. Recorded on the app\'s change log.',
      skill: APP_BUILDER_SKILL_REF,
      spec_url: specUrl,
    };
  }

  if (given) {
    return {
      status: 'stale',
      message: 'The build spec has changed since the token you carried. Fetch GET /v1/prompts/build-app '
        + 'and pass spec_token. Read what changed before the next publish — the parts you did not read '
        + 'are the parts that bite.',
      skill: APP_BUILDER_SKILL_REF,
      spec_url: specUrl,
    };
  }

  return {
    status: 'missing',
    message: 'Fetch GET /v1/prompts/build-app and pass spec_token. It names the library URLs that exist, '
      + 'the theme tokens, and how to read data your agents wrote — three things a published app gets '
      + 'wrong when it is modelled on an older template instead.',
    skill: APP_BUILDER_SKILL_REF,
    spec_url: specUrl,
  };
}
