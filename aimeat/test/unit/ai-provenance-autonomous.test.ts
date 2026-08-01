/**
 * @file test/unit/ai-provenance-autonomous.test.ts
 * @description The rule that decides whether AI-written content owes a visible label, tested at the
 *   one function that applies it (TARGET-058 Phase 4):
 *
 *     ONLY A STEP WHERE A PERSON READS THE SUBSTANCE AND CAN REJECT IT UPGRADES humanInvolvement.
 *     Clicking publish is not that step. A workflow human-input step that reviews substance MAY
 *     upgrade it. Nothing else may.
 *
 *   It is unit-tested rather than only driven end to end because it is a SENTENCE, and sentences
 *   drift. Every autonomous path on the node — the scheduler, tracked responses, living documents,
 *   workflow review steps — routes through stampAutonomousOutput(), so this file is where a future
 *   change that quietly upgrades an unreviewed output gets caught.
 *
 *   The other half is the identity guarantee on provenanceForWrite(): a caller's declaration is
 *   honoured about the CONTENT and discarded about WHO — the one place an agent could otherwise
 *   attribute its writing to somebody else.
 * @usage pnpm exec vitest run test/unit/ai-provenance-autonomous.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 4.
 */
import { describe, it, expect } from 'vitest';
import {
  stampAutonomousOutput, provenanceForWrite, ProvenanceScopeError, INFERRED_FROM_PRINCIPAL_NOTE,
} from '../../src/services/ai-provenance.js';
import type { AiProvenanceRecordRow } from '../../src/storage/interface.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;
const AGENT = `crew#alice@${NODE}`;

/**
 * The smallest storage a mint needs: somewhere to put the row, and the two lookups the scope gate
 * makes. Deliberately not a mock framework — the assertions below are about the RECORD, and a real
 * object keeps them readable.
 */
function fakeStorage(agentScopes: string[] = []): Storage & { rows: AiProvenanceRecordRow[] } {
  const rows: AiProvenanceRecordRow[] = [];
  return {
    rows,
    createAiProvenance: async (row: AiProvenanceRecordRow) => { rows.push(row); },
    getAiProvenance: async (id: string) => rows.find(r => r.id === id),
    getAgent: async () => ({ defaultScopes: agentScopes }),
    getEcosystemApp: async () => null,
  } as unknown as Storage & { rows: AiProvenanceRecordRow[] };
}

const base = { nodeId: NODE, baseUrl: 'https://example.test' };

describe('stampAutonomousOutput — the rule that decides whether a label is owed', () => {
  it('records humanInvolvement "none" when nobody reviewed the output', async () => {
    const storage = fakeStorage();
    const id = await stampAutonomousOutput(storage, {
      principal: OWNER, content: 'a scheduled job wrote this', pipeline: 'schedule:nightly', ...base,
    });
    const rec = storage.rows.find(r => r.id === id)!.record;
    expect(rec.humanInvolvement).toBe('none');
    expect(rec.level).toBe('ai-generated');
    expect(rec.notes).toContain('Nobody read the substance');
  });

  it('upgrades to "editorial-control" ONLY when a reviewer and a step are named', async () => {
    const storage = fakeStorage();
    const id = await stampAutonomousOutput(storage, {
      principal: OWNER, content: 'a draft a person then read', pipeline: 'workflow:gated/gate',
      reviewedBy: { who: 'alice', step: 'gate' }, ...base,
    });
    const rec = storage.rows.find(r => r.id === id)!.record;
    expect(rec.humanInvolvement).toBe('editorial-control');
    // A claim of editorial control that cannot name the reviewer is worth nothing.
    expect(rec.notes).toContain('alice');
    expect(rec.notes).toContain('gate');
  });

  it('never records an inference as an observation', async () => {
    const storage = fakeStorage();
    const id = await stampAutonomousOutput(storage, {
      principal: OWNER, content: 'x', pipeline: 'schedule:nightly', ...base,
    });
    const rec = storage.rows.find(r => r.id === id)!.record;
    expect(rec.attestation?.stampedBy).toBe('node');
    expect(rec.attestation?.observed).toBe(false);
  });

  it('hashes the exact bytes, so a detection query can find them later', async () => {
    const storage = fakeStorage();
    const id = await stampAutonomousOutput(storage, {
      principal: OWNER, content: 'the exact bytes', pipeline: 'p', ...base,
    });
    const rec = storage.rows.find(r => r.id === id)!.record;
    expect(rec.attestation?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('mints nothing at all when provenance is switched off', async () => {
    const storage = fakeStorage();
    const id = await stampAutonomousOutput(storage, {
      principal: OWNER, content: 'x', pipeline: 'p', enabled: false, ...base,
    });
    expect(id).toBeUndefined();
    expect(storage.rows).toHaveLength(0);
  });
});

describe('provenanceForWrite — what a caller may and may not assert', () => {
  it('stamps an agent that declared nothing as model-written (Mint-3)', async () => {
    const storage = fakeStorage();
    const id = await provenanceForWrite(storage, { principal: AGENT, content: 'silence', ...base });
    const rec = storage.rows.find(r => r.id === id)!.record;
    expect(rec.level).toBe('ai-generated');
    expect(rec.humanInvolvement).toBe('none');
    expect(rec.notes).toBe(INFERRED_FROM_PRINCIPAL_NOTE);
  });

  it('leaves an OWNER alone — a person writing through their own token is presumed human', async () => {
    const storage = fakeStorage();
    const id = await provenanceForWrite(storage, { principal: OWNER, content: 'a person typed this', ...base });
    expect(id).toBeUndefined();
    expect(storage.rows).toHaveLength(0);
  });

  it('honours a declaration about the CONTENT', async () => {
    const storage = fakeStorage(['provenance:write']);
    const id = await provenanceForWrite(storage, {
      principal: AGENT, content: 'relayed human text',
      declared: { level: 'original', humanInvolvement: 'full-human' }, ...base,
    });
    const rec = storage.rows.find(r => r.id === id)!.record;
    expect(rec.level).toBe('original');
    expect(rec.humanInvolvement).toBe('full-human');
    expect(rec.attestation?.stampedBy).toBe('principal');
    // A principal stamp can never claim this node witnessed anything.
    expect(rec.attestation?.observed).toBe(false);
  });

  it('defaults an omitted human_involvement to none rather than inventing review', async () => {
    const storage = fakeStorage(['provenance:write']);
    const id = await provenanceForWrite(storage, {
      principal: AGENT, content: 'x', declared: { level: 'synthesized' }, ...base,
    });
    expect(storage.rows.find(r => r.id === id)!.record.humanInvolvement).toBe('none');
  });

  it('takes identity from the RESOLVED principal, never from the declaration', async () => {
    const storage = fakeStorage(['provenance:write']);
    const id = await provenanceForWrite(storage, {
      principal: AGENT, content: 'x',
      // A declaration carrying identity fields it has no business carrying.
      declared: {
        level: 'ai-generated',
        principal: `impostor@${NODE}`, nodeId: 'somewhere-else',
      } as never,
      ...base,
    });
    const rec = storage.rows.find(r => r.id === id)!.record;
    expect(rec.generator?.principal).toBe(AGENT);
    expect(rec.generator?.nodeId).toBe(NODE);
  });

  it('refuses a declaration without provenance:write, naming the scope', async () => {
    const storage = fakeStorage(['memory:write']);
    await expect(provenanceForWrite(storage, {
      principal: AGENT, content: 'x', declared: { level: 'original' }, ...base,
    })).rejects.toBeInstanceOf(ProvenanceScopeError);
    // Refused, not silently downgraded: a caller that thinks it declared something and finds the
    // opposite recorded has been lied to by its own call.
    expect(storage.rows).toHaveLength(0);
  });

  it('lets a wildcard scope through, exactly as requireScope does', async () => {
    const storage = fakeStorage(['*']);
    const id = await provenanceForWrite(storage, {
      principal: AGENT, content: 'x', declared: { level: 'original' }, ...base,
    });
    expect(storage.rows.find(r => r.id === id)!.record.level).toBe('original');
  });

  it('still stamps the write when the caller only omits the block', async () => {
    const storage = fakeStorage(['memory:write']);
    const id = await provenanceForWrite(storage, { principal: AGENT, content: 'x', ...base });
    expect(storage.rows.find(r => r.id === id)!.record.level).toBe('ai-generated');
  });
});
