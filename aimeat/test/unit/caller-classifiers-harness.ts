/**
 * @file test/unit/caller-classifiers-harness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Collects the answers every function that classifies a caller gives (codebase analysis
 *   2026-11-03, item B1): the CallerContext kind and inPerson, isOwnerInPerson, readerKindOf, the two
 *   isOwnerPrincipal, askerKind, aiPayerOf, aiCallerFromCredential, aiCallerOfPrincipal, and the three
 *   usage actorKindOf. Credentials: every subset of the six roles, with and without the anonymous,
 *   federated and PAT marks and the account security word (1 024 shapes), plus the named shapes the
 *   node mints. Principals: the identity strings the node stores, well formed and not.
 *   caller-classifiers.test.ts compares the answers with the ones the code gave before the classifiers
 *   moved onto services/caller-facts.ts (fixtures/caller-classifiers-answers.json, written by this
 *   harness from the code at 6d18c6d7c), so a changed answer fails.
 * @structure NODE_ID · CREDENTIALS · PRINCIPALS · collectCallerAnswers()
 * @usage const answers = await collectCallerAnswers();
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item B1).
 */
import type { Storage } from '../../src/storage/interface.js';
import { callerFromAuth, type CallerAuth } from '../../src/services/caller-context.js';
import { isOwnerInPerson, resolveIdentity } from '../../src/utils/gaii.js';
import { readerKindOf } from '../../src/services/classification/reader-kind.js';
import { isOwnerPrincipal as isAccountOwnerPrincipal } from '../../src/auth/account-security.js';
import { isOwnerPrincipal as isSseOwnerPrincipal } from '../../src/auth/sse-domain-scopes.js';
import { askerKind } from '../../src/services/approval-standard.js';
import { aiPayerOf } from '../../src/services/agent-ai-keys.js';
import { aiCallerFromCredential, aiCallerOfPrincipal } from '../../src/services/ai/caller-context.js';
import { actorKindOf as toolActorKindOf } from '../../src/mcp/tool-usage-wrap.js';
import { actorKindOf as appOpenActorKindOf } from '../../src/services/usage/record-app-open.js';
import { actorKindOf as meteredActorKindOf } from '../../src/services/metered-access.js';

export const NODE_ID = 'aimeat-local-001-dev';
const PEER = 'aimeat-peer-002-dev';
const ROLE_POOL = ['owner', 'operator', 'agent', 'ecosystem', 'app', 'federated'] as const;

export interface CredentialRow {
  sub: string; owner: string; roles: string[]; scopes: string[];
  anonymous?: boolean; federated?: boolean; homeNode?: string; via?: 'pat'; app?: string;
}

/** The sub a credential with these roles carries: a GEAI, a GAII or the account name. */
function subFor(roles: readonly string[]): string {
  if (roles.includes('ecosystem')) return `eco:drum-news#alice@${NODE_ID}`;
  if (roles.includes('agent')) return `helper#alice@${NODE_ID}`;
  return 'alice';
}

/** Every subset of the six roles, with each mark on and off: 64 x 2 x 2 x 2 x 2. */
function exhaustive(): Record<string, CredentialRow> {
  const out: Record<string, CredentialRow> = {};
  for (let mask = 0; mask < 1 << ROLE_POOL.length; mask++) {
    const roles = ROLE_POOL.filter((_, i) => mask & (1 << i));
    for (const anonymous of [false, true]) for (const federated of [false, true]) for (const pat of [false, true]) for (const sec of [false, true]) {
      const key = `roles=${roles.join('+') || '-'}${anonymous ? ' anon' : ''}${federated ? ' fed' : ''}${pat ? ' pat' : ''}${sec ? ' sec' : ''}`;
      out[key] = {
        sub: subFor(roles), owner: 'alice', roles: [...roles], scopes: sec ? ['account:security'] : [],
        ...(anonymous ? { anonymous: true } : {}),
        ...(federated ? { federated: true, homeNode: PEER } : {}),
        ...(pat ? { via: 'pat' as const } : {}),
      };
    }
  }
  return out;
}

/** The credentials the node mints or builds, by name. */
export const NAMED: Record<string, CredentialRow> = {
  'owner session': { sub: 'alice', owner: 'alice', roles: ['owner'], scopes: [] },
  'operator session': { sub: 'alice', owner: 'alice', roles: ['owner', 'operator'], scopes: [] },
  'owner PAT': { sub: `alice@${NODE_ID}`, owner: 'alice', roles: ['owner'], scopes: ['*'], via: 'pat' },
  'operator PAT': { sub: `alice@${NODE_ID}`, owner: 'alice', roles: ['owner', 'operator'], scopes: ['*'], via: 'pat' },
  'narrow PAT': { sub: `helper#alice@${NODE_ID}`, owner: 'alice', roles: ['agent'], scopes: ['memory:read'], via: 'pat' },
  'agent token': { sub: `helper#alice@${NODE_ID}`, owner: 'alice', roles: ['agent'], scopes: ['memory:read'] },
  'agent with account security': { sub: `helper#alice@${NODE_ID}`, owner: 'alice', roles: ['agent'], scopes: ['account:security'] },
  'chat agent': { sub: `chat#alice@${NODE_ID}`, owner: 'alice', roles: ['agent'], scopes: ['*'] },
  'app grant': { sub: 'alice', owner: 'alice', roles: ['app'], scopes: ['memory:read'], app: 'alice/notes.html' },
  'ecosystem app': { sub: `eco:drum-news#alice@${NODE_ID}`, owner: 'alice', roles: ['ecosystem'], scopes: ['memory:read'] },
  'federated visitor': { sub: `bob@${PEER}`, owner: `bob@${PEER}`, roles: ['federated'], scopes: [], federated: true, homeNode: PEER },
  'federated legacy owner role': { sub: 'bob', owner: 'bob', roles: ['owner'], scopes: [], federated: true, homeNode: PEER },
  'anonymous': { sub: `anonymous@${NODE_ID}`, owner: 'anonymous', roles: [], scopes: [], anonymous: true },
  'unattended run': { sub: `scheduler@${NODE_ID}`, owner: 'alice', roles: ['operator'], scopes: [] },
  'no role': { sub: `alice@${NODE_ID}`, owner: 'alice', roles: [], scopes: [] },
};

export const CREDENTIALS: Record<string, CredentialRow> = { ...NAMED, ...exhaustive() };

export const PRINCIPALS: string[] = [
  `alice@${NODE_ID}`, `helper#alice@${NODE_ID}`, `chat#alice@${NODE_ID}`, `eco:drum-news#alice@${NODE_ID}`,
  `eco:Bad#alice@${NODE_ID}`, `eco:drum-news`, `Bad Name#alice@${NODE_ID}`, `helper#alice`, 'alice', `bob@${PEER}`,
  `helper#bob@${PEER}`, `eco:drum-news#bob@${PEER}`, `scheduler@${NODE_ID}`, 'anon', '',
];

/** The credential shapes aiCallerFromCredential is asked with beside a principal. */
const AI_CREDS: Record<string, { roles: string[]; app?: string }> = {
  none: { roles: [] }, owner: { roles: ['owner'] }, agent: { roles: ['agent'] }, ecosystem: { roles: ['ecosystem'] },
  'app with id': { roles: ['app'], app: 'alice/notes.html' }, 'app without id': { roles: ['app'] },
};

const NO_STORAGE = {} as Storage;

function asAuth(c: CredentialRow): CallerAuth {
  return {
    sub: c.sub, owner: c.owner, roles: c.roles, scopes: c.scopes,
    ...(c.anonymous ? { anonymous: true } : {}),
    ...(c.federated !== undefined ? { federated: c.federated } : {}),
    ...(c.homeNode ? { homeNode: c.homeNode } : {}),
    ...(c.via ? { via: c.via } : {}),
  } as CallerAuth;
}

/** Every classifier's answer for every credential and every principal, keyed by what was asked. */
export function collectCallerAnswers(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, c] of Object.entries(CREDENTIALS)) {
    const auth = asAuth(c);
    const caller = callerFromAuth(auth, NODE_ID, NO_STORAGE);
    const principal = resolveIdentity(auth, NODE_ID);
    out[`credential ${name}`] = {
      principal,
      kind: caller.kind,
      inPerson: caller.inPerson,
      isOwnerInPerson: isOwnerInPerson(auth),
      readerKindOf: readerKindOf(auth),
      accountIsOwnerPrincipal: isAccountOwnerPrincipal({ roles: c.roles, scopes: c.scopes, ...(c.federated !== undefined ? { federated: c.federated } : {}) }),
      sseIsOwnerPrincipal: isSseOwnerPrincipal({ roles: c.roles }),
      meteredActorKind: meteredActorKindOf({ roles: c.roles }),
      payer: aiPayerOf(principal),
    };
  }
  for (const p of PRINCIPALS) {
    const ai: Record<string, unknown> = {};
    for (const [n, cred] of Object.entries(AI_CREDS)) ai[n] = aiCallerFromCredential(cred, p);
    out[`principal ${p || '(empty)'}`] = {
      askerKind: askerKind(p),
      toolActorKind: toolActorKindOf(p),
      appOpenActorKind: appOpenActorKindOf(p),
      payer: aiPayerOf(p),
      aiCallerOfPrincipal: aiCallerOfPrincipal(p),
      aiCallerFromCredential: ai,
    };
  }
  return out;
}
