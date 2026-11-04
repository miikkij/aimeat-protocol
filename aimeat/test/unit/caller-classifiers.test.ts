/**
 * @file test/unit/caller-classifiers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The usage test for "who is calling, and who pays" (codebase analysis 2026-11-03, item
 *   B1). Every function that classifies a caller answers every credential shape and every principal
 *   exactly as it did before the classifiers moved onto services/caller-facts.ts: the answers before
 *   are fixtures/caller-classifiers-answers.json, collected by caller-classifiers-harness.ts from the
 *   code at 6d18c6d7c (1 039 credentials, 15 principals). The CallerContext's new fields (isPerson,
 *   reader, payer, asker) and principalCaller give, row by row, the answers the old functions gave,
 *   and `via` names how each credential the node mints arrived.
 * @usage cd aimeat && pnpm exec vitest run test/unit/caller-classifiers.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item B1).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Storage } from '../../src/storage/interface.js';
import { callerFromAuth, principalCaller, type CallerAuth, type CallerVia } from '../../src/services/caller-context.js';
import { aiAskerOf } from '../../src/services/agent-ai-keys.js';
import { collectCallerAnswers, CREDENTIALS, NAMED, NODE_ID, PRINCIPALS } from './caller-classifiers-harness.js';

const BEFORE = JSON.parse(readFileSync(new URL('./fixtures/caller-classifiers-answers.json', import.meta.url), 'utf-8')) as Record<string, unknown>;

type Payer = { payer: string; agent?: string; ecoApp?: string };
interface CredentialAnswer { principal: string; kind: string; isOwnerInPerson: boolean; readerKindOf: string; payer: Payer }
interface PrincipalAnswer { askerKind: string; toolActorKind: string; payer: Payer }

const asker = (p: Payer): string => aiAskerOf(p.payer, { ...(p.agent ? { agent: p.agent } : {}), ...(p.ecoApp ? { app: p.ecoApp } : {}) });

describe('every caller classifier answers as before', () => {
  it('every credential shape and every principal', () => {
    const now = collectCallerAnswers();
    expect(Object.keys(now).sort()).toEqual(Object.keys(BEFORE).sort());
    for (const [name, answer] of Object.entries(BEFORE)) {
      expect(JSON.parse(JSON.stringify(now[name])), name).toEqual(answer);
    }
  });

  it("the CallerContext's fields give the answers the old functions gave, for every credential", () => {
    let n = 0;
    for (const [name, c] of Object.entries(CREDENTIALS)) {
      const before = BEFORE[`credential ${name}`] as CredentialAnswer;
      const caller = callerFromAuth(c as unknown as CallerAuth, NODE_ID, {} as Storage);
      expect(caller.principal, name).toBe(before.principal);
      expect(caller.kind, name).toBe(before.kind);
      expect(caller.isPerson, name).toBe(before.isOwnerInPerson);
      expect(caller.inPerson, name).toBe(before.isOwnerInPerson);
      expect(caller.reader, name).toBe(before.readerKindOf);
      expect(JSON.parse(JSON.stringify(caller.payer)), name).toEqual(before.payer);
      expect(caller.asker, name).toBe(asker(before.payer));
      n++;
    }
    expect(n).toBe(1039);
  });

  it('principalCaller gives the payer, asker and kind the old functions gave, for every principal', () => {
    const KIND = { app: 'eco', agent: 'agent', person: 'person' } as const;
    for (const p of PRINCIPALS) {
      const before = BEFORE[`principal ${p || '(empty)'}`] as PrincipalAnswer;
      const facts = principalCaller(p);
      expect(JSON.parse(JSON.stringify(facts.payer)), p).toEqual(before.payer);
      expect(facts.asker, p).toBe(asker(before.payer));
      expect(facts.principalKind, p).toBe(KIND[before.askerKind as keyof typeof KIND]);
    }
  });

  it('via names how each credential the node mints arrived', () => {
    const expected: Record<string, CallerVia> = {
      'owner session': 'session', 'operator session': 'session', 'owner PAT': 'pat', 'operator PAT': 'pat',
      'narrow PAT': 'pat', 'agent token': 'agent-token', 'agent with account security': 'agent-token',
      'chat agent': 'agent-token', 'app grant': 'app-grant', 'ecosystem app': 'ecosystem',
      'federated visitor': 'federated', 'federated legacy owner role': 'federated', 'anonymous': 'anonymous',
      'unattended run': 'unattended', 'no role': 'unattended',
    };
    expect(Object.keys(expected).sort()).toEqual(Object.keys(NAMED).sort());
    for (const [name, c] of Object.entries(NAMED)) {
      expect(callerFromAuth(c as unknown as CallerAuth, NODE_ID, {} as Storage).via, name).toBe(expected[name]);
    }
  });
});
