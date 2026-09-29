/**
 * @file src/services/classification/reader.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE ONE CHECK COMPONENT of classification (TARGET-082, spec §13.2, decided by Jouni
 *   2026-09-29: "Tee yksi komponentti mitä käytetään useammassa kohtaa tarkistus mukaan lukien ettei
 *   synny duplikaatti patheja"). Every loader that hands stored content to a caller takes a reader
 *   made here instead of an identity string, so a loader cannot run without the check, and the
 *   check is written once.
 *
 *   A reader is the caller (who they are, whose data space they act in, whether they are a person or
 *   an AI) plus three operations, and no others:
 *     show(items)            a list, a search or a single read: what this reader may see;
 *     useForAi(targets)      content going to a model: refuses what a model may not read;
 *     leave(items, where)    an export, a share link or federation: what may leave the organism.
 *
 *   V1 (this version): the switch is read and the operations pass everything through. With the
 *   switch off they pass without reading anything, which is what "off changes nothing" means in cost
 *   as well as in behaviour. V4 applies the decisions inside these three functions and nowhere else.
 * @structure ReaderAuth · EgressDestination · ContentReader · readerFor() · readerForCaller() ·
 *   systemReader()
 * @usage
 *   const reader = readerFor({ storage, config }, req.auth);
 *   const shown = await reader.show(records, r => memoryTarget(r.ownerGaii, r.key));
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial: the component and its pass-through.
 */
import type { Storage, ContentLabelTarget } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { resolveIdentity, callerPrincipal, localAccountName } from '../../utils/gaii.js';
import { readerKindOf, type ReaderKind } from './reader-kind.js';

/** The credential fields a reader is made from. `req.auth` fits. */
export interface ReaderAuth {
  sub: string;
  owner: string;
  roles: string[];
  scopes?: string[];
  federated?: boolean;
  homeNode?: string;
  anonymous?: boolean;
  app_grant?: string;
  app?: string;
}

/** Where content goes when it leaves: an export file, a share link, another node. */
export type EgressDestination =
  | { kind: 'export'; organismId: string | null }
  | { kind: 'share'; organismId: string; ws: string }
  | { kind: 'federation'; peer: string };

export interface ContentReader {
  /** human, ai or anonymous from the credential; system for the node's own work with no caller. */
  readonly kind: ReaderKind | 'system';
  /** The identity storage is keyed by (resolveIdentity). Empty for anonymous. */
  readonly identity: string;
  /** Who is making the request (callerPrincipal): an app is named apart from its owner. */
  readonly principal: string;
  /** The credential, for the existing access checks a loader still makes. Null for anonymous and system. */
  readonly auth: ReaderAuth | null;
  show<T>(items: readonly T[], targetOf: (item: T) => ContentLabelTarget | null): Promise<T[]>;
  useForAi(targets: readonly ContentLabelTarget[], use: { capability: string }): Promise<void>;
  leave<T>(items: readonly T[], targetOf: (item: T) => ContentLabelTarget | null, where: EgressDestination):
    Promise<{ kept: T[]; left: Array<{ item: T; label: string; reason: string }> }>;
}

interface ReaderDeps {
  storage: Storage;
  config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'>;
}

function makeReader(_deps: ReaderDeps, who: Pick<ContentReader, 'kind' | 'identity' | 'principal' | 'auth'>): ContentReader {
  // V1: every operation returns what it was given and reads nothing, whatever the switch says.
  // V4 reads the switch (policy.ts classificationActiveFor) and the labels (labels.ts labelsFor) here.
  return {
    ...who,
    async show(items) { return [...items]; },
    async useForAi() { /* V4: refuse a target whose label hides it from AI */ },
    async leave(items) { return { kept: [...items], left: [] }; },
  };
}

/** The reader behind a request. No credential is an anonymous reader. */
export function readerFor(deps: ReaderDeps, auth: ReaderAuth | null | undefined): ContentReader {
  const kind = readerKindOf(auth);
  if (!auth || kind === 'anonymous') return makeReader(deps, { kind: 'anonymous', identity: '', principal: '', auth: null });
  return makeReader(deps, {
    kind,
    identity: resolveIdentity(auth, deps.config.nodeId),
    principal: callerPrincipal(auth, deps.config.nodeId),
    auth,
  });
}

/** The reader behind an extension's caller (`ctx.caller`), which already carries its identity. */
export function readerForCaller(
  deps: ReaderDeps, caller: { gaii: string; owner: string; roles: string[]; scopes?: string[] },
): ContentReader {
  const kind = readerKindOf(caller);
  return makeReader(deps, {
    kind: kind === 'anonymous' ? 'ai' : kind,
    identity: caller.gaii,
    principal: caller.gaii,
    auth: { sub: caller.gaii, owner: caller.owner, roles: caller.roles, scopes: caller.scopes },
  });
}

/**
 * The reader behind a node MCP session. Every such session is an agent (mcp/index.ts refuses any
 * other credential), so its tools hold the agent's identity and the request's scopes, not a token.
 */
export function readerForAgent(deps: ReaderDeps, agentGaii: string, scopes: readonly string[] = []): ContentReader {
  const owner = localAccountName(agentGaii);
  return makeReader(deps, {
    kind: 'ai',
    identity: agentGaii,
    principal: agentGaii,
    auth: { sub: agentGaii, owner, roles: ['agent'], scopes: [...scopes] },
  });
}

/**
 * The node's own work with no caller: a scheduled job, a background run. It acts in `identity`'s
 * data space. Content it sends to a model still passes useForAi, because what reaches a model is
 * decided by the content's label, not by who asked.
 */
export function systemReader(deps: ReaderDeps, identity: string): ContentReader {
  return makeReader(deps, { kind: 'system', identity, principal: identity, auth: null });
}
