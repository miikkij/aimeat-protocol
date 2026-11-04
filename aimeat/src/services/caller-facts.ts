/**
 * @file src/services/caller-facts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What kind of caller this is, how its credential arrived, whether it is the person,
 *   who pays for its AI call and who that call names: each question answered by one function, here
 *   (codebase analysis 2026-11-03, item B1). The CallerContext (services/caller-context.ts) carries
 *   the answers as fields, and the functions that answered the same questions in their own files
 *   (readerKindOf, askerKind, aiPayerOf, aiAskerOf and the three usage actorKindOf) read them from
 *   here; the two isOwnerPrincipal read isOwnerInPerson. Until this file the question had eleven answers in eleven
 *   files, by two methods (the token's roles, or the shape of the identity string), and they
 *   disagreed: an ecosystem app's metered call was recorded as the owner's (metered-access.ts, fixed
 *   on 2026-11-04 by item A3), and its AI call was planned as the owner in person (secaudit2026nov02d
 *   round 13).
 *
 *   TWO INPUTS, TWO FAMILIES. A verified credential (roles and marks) answers kind, via, the reader
 *   kind and isPerson. An identity string answers what a stored principal is (a person, an agent or
 *   an ecosystem app) and who pays for its AI call. A path that only holds a string (a job, a
 *   schedule, a stored asker) uses the second family; it cannot know the first.
 *
 *   isPerson IS isOwnerInPerson (utils/gaii.ts): the owner or operator in person, an owner-level
 *   personal access token included (Jouni, 2026-11-04: an owner's PAT is the person). That function
 *   stays where it is, at the bottom layer, because resolveIdentity asks it too.
 *
 *   Every answer here is the one the function it replaced gave, for every credential shape and every
 *   principal: test/unit/caller-classifiers.test.ts compares them with the answers recorded from the
 *   code before the move (1 039 credentials, 15 principals). `pnpm check:single-entry` rule
 *   principal-kind keeps a twelfth classifier from appearing outside this file.
 * @structure CallerKind · CallerVia · ReaderKind · PrincipalKind · AiPayer · credentialKind(auth) ·
 *   credentialVia(auth) · readerOf(auth) · principalKindOf(principal) · usageActorOfPrincipal(principal) ·
 *   usageActorOfRoles(roles) · payerOfPrincipal(principal) · askerOf(payer, who) · principalCaller(principal)
 * @usage const { payer, agent } = principalCaller(job.owner).payer;
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B1).
 */
import { ECO_PREFIX, isForeignPrincipal, isValidGEAI, parseGAII, parseGEAI } from '../utils/gaii.js';
import type { UsageActorKind } from '../storage/interface.js';

/** What a caller is, by the token it holds. */
export type CallerKind = 'anonymous' | 'visitor' | 'ecosystem' | 'app' | 'agent' | 'owner';

/**
 * How the credential arrived. `session`: the person signed in. `pat`: a personal access token, of
 * owner level or narrower. `agent-token`: an agent's own token (device authorization, its key, an
 * MCP session). `app-grant`: an app the owner approved. `ecosystem`: an ecosystem app (GEAI).
 * `unattended`: a run the node makes with no person signed in (an extension's scheduled run, a
 * workflow step). `federated`: a visitor signed in on another node. `anonymous`: nobody.
 */
export type CallerVia = 'session' | 'pat' | 'agent-token' | 'app-grant' | 'ecosystem' | 'unattended' | 'federated' | 'anonymous';

/** Who reads, as classification asks it (services/classification/reader-kind.ts). */
export type ReaderKind = 'human' | 'ai' | 'anonymous';

/** What a stored identity string is: `eco:` an ecosystem app, a `#` an agent, anything else a person. */
export type PrincipalKind = 'person' | 'agent' | 'eco';

/** Who pays for an AI call, and in whose name it was asked. */
export interface AiPayer { payer: string; agent?: string; ecoApp?: string }

/** The credential fields the credential questions read. `req.auth`, a CallerAuth and an extension's `ctx.caller` all fit. */
export interface CredentialFacts {
  roles?: readonly string[] | null;
  anonymous?: boolean;
  federated?: boolean;
  /** How the credential was obtained. 'pat': from a personal access token (auth/jwt.ts `via`). */
  via?: string;
}

/** The kind of caller a credential is. The CallerContext's `kind`. */
export function credentialKind(auth: CredentialFacts): CallerKind {
  const roles = auth.roles ?? [];
  if (auth.anonymous) return 'anonymous';
  if (isForeignPrincipal(auth)) return 'visitor';
  if (roles.includes('ecosystem')) return 'ecosystem';
  if (roles.includes('app')) return 'app';
  if (roles.includes('agent')) return 'agent';
  return 'owner';
}

/** How a credential arrived. The CallerContext's `via`; it decides nothing, it says. */
export function credentialVia(auth: CredentialFacts): CallerVia {
  const roles = auth.roles ?? [];
  if (auth.anonymous) return 'anonymous';
  if (isForeignPrincipal(auth)) return 'federated';
  if (roles.includes('ecosystem')) return 'ecosystem';
  if (roles.includes('app')) return 'app-grant';
  if (auth.via === 'pat') return 'pat';
  if (roles.includes('agent')) return 'agent-token';
  if (roles.includes('owner')) return 'session';
  return 'unattended';
}

/**
 * Who reads, as classification asks it (TARGET-082, spec §13.3): a person on their own screen, or an
 * AI. Decided from the credential, never from what the caller declares.
 *
 * A person: the owner's own session, an owner-level personal access token (and the JWT exchanged from
 * one), an app grant (the person's own screen), and a visitor from another node signed in as a person.
 * An AI: an agent token (every MCP session is one), a personal access token narrower than owner level
 * (it holds role agent, services/access-token.ts), an ecosystem app, an unattended run (role operator
 * without owner). Anonymous: nobody signed in. A credential with no role this knows is read the
 * stricter way. The `via: 'pat'` mark is not read: an owner-level PAT is the person (Jouni,
 * 2026-11-04), as isOwnerInPerson answers for it.
 */
export function readerOf(auth: CredentialFacts | null | undefined): ReaderKind {
  if (!auth) return 'anonymous';
  if (auth.anonymous) return 'anonymous';
  const roles = auth.roles ?? [];
  // An operator signed in is ['owner', 'operator']; an unattended run is ['operator'] alone.
  if (roles.includes('agent') || roles.includes('ecosystem') || (roles.includes('operator') && !roles.includes('owner'))) return 'ai';
  if (roles.includes('owner') || roles.includes('app') || roles.includes('federated')) return 'human';
  return 'ai';
}

/** What a stored identity string is, read from its shape: `eco:` an ecosystem app, a `#` an agent, else a person. */
export function principalKindOf(principal: string): PrincipalKind {
  if (principal.startsWith(ECO_PREFIX)) return 'eco';
  if (principal.includes('#')) return 'agent';
  return 'person';
}

/** principalKindOf in the usage stream's words: a person is counted as `owner`. */
const USAGE_ACTOR_OF_PRINCIPAL: Readonly<Record<PrincipalKind, UsageActorKind>> = { person: 'owner', agent: 'agent', eco: 'eco' };

/** The usage stream's actor kind of a stored identity (MCP tool calls, app opens). */
export function usageActorOfPrincipal(principal: string): UsageActorKind {
  return USAGE_ACTOR_OF_PRINCIPAL[principalKindOf(principal)];
}

/**
 * The usage stream's actor kind of a session's roles (metered calls). An app grant is counted as the
 * app whatever other role the list carries, as metered-access.ts always counted it; otherwise the
 * credential's kind, an ecosystem app as `eco`, and everything else as the owner.
 */
export function usageActorOfRoles(roles: readonly string[]): UsageActorKind {
  if (roles.includes('app')) return 'app';
  const kind = credentialKind({ roles });
  return kind === 'ecosystem' ? 'eco' : kind === 'agent' ? 'agent' : 'owner';
}

/**
 * WHO PAYS FOR A TEXT CALL, AND IN WHOSE NAME IT WAS ASKED. An agent's call is paid by its owner:
 * the owner's settings, daily budget, allowance and usage record, with the agent named so that its
 * own key comes first and its own cap applies. Every other principal pays as itself.
 *
 * Ruled by the developer on 2026-09-20. Until then a text door took the payer to be the principal,
 * so an agent's completion was keyed, budgeted and metered in the AGENT's own namespace: the owner's
 * own key never paid for an agent's call, the owner's daily budget did not cap it, and each agent
 * drew a free starter allowance of its own.
 *
 * An ecosystem app (`eco:<app>#<owner>@<node>`) is paid by its owner too, as the owner's app
 * `eco:<app>` (`ecoApp`): the owner's key, settings, app allowlist, per-app cap, daily budget and
 * node-key allowance apply to it, and its spend shows on the owner's usage under that name. Until
 * 2026-11-02 it paid as itself (secaudit2026nov02d round 13). Storage is not moved: what the app
 * keeps stays in its own namespace (utils/gaii.ts resolveIdentity).
 */
export function payerOfPrincipal(principal: string): AiPayer {
  const p = parseGAII(principal);
  if (p) return { payer: `${p.owner}@${p.node}`, agent: p.agent };
  const e = parseGEAI(principal);
  return e ? { payer: `${e.owner}@${e.node}`, ecoApp: `${ECO_PREFIX}${e.app}` } : { payer: principal };
}

/**
 * Who asked for a call, as the provenance record and the usage ledger name it beside the payer: the
 * agent's GAII, the ecosystem app's GEAI (`app` is `eco:<app>`, as payerOfPrincipal names it), or the payer.
 * `app` is the app the node identified (the plan's verified app), never a request body's word.
 */
export function askerOf(payer: string, who: { agent?: string; app?: string }): string {
  if (who.agent) return `${who.agent}#${payer}`;
  if (who.app?.startsWith(ECO_PREFIX) && isValidGEAI(`${who.app}#${payer}`)) return `${who.app}#${payer}`;
  return payer;
}

/** The facts an identity string carries, for a path that holds no credential (a job, a schedule, an MCP tool). */
export interface PrincipalCaller {
  readonly principal: string;
  readonly principalKind: PrincipalKind;
  /** payerOfPrincipal(principal): who pays for an AI call this principal asks for. */
  readonly payer: AiPayer;
  /** askerOf: the identity the AI call names (the agent's GAII, the app's GEAI, or the payer). */
  readonly asker: string;
}

/** The CallerContext's principal facts, from the string alone. */
export function principalCaller(principal: string): PrincipalCaller {
  const payer = payerOfPrincipal(principal);
  return {
    principal,
    principalKind: principalKindOf(principal),
    payer,
    asker: askerOf(payer.payer, { ...(payer.agent ? { agent: payer.agent } : {}), ...(payer.ecoApp ? { app: payer.ecoApp } : {}) }),
  };
}
