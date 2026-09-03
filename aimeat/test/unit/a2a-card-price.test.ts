/**
 * @file test/unit/a2a-card-price.test.ts
 * @description The price a stranger reads on an agent card, in both rails.
 *
 *   THIS IS THE ONE NUMBER A BUYER DECIDES ON. The A2A card exists so somebody can see what an
 *   offering costs without starting a task to find out, and the sentence that carries it was wrong
 *   in two ways at once.
 *
 *   `unit` IS THE RAIL — `'money' | 'morsels'`, what the price is paid IN — and it was printed as
 *   the billing unit, so a morsel offering advertised "8 morsel per morsels". A buyer reading that
 *   cannot tell whether it is per document, per page or per hour.
 *
 *   AND `basePrice` IS MICROS ON THE MONEY RAIL. Printed raw, a EUR 1.50 offering read
 *   "1500000 EUR per money" to every stranger who fetched the card. Nobody had seen it because no
 *   money-priced offering has been published yet — it was waiting for the first one, on the surface
 *   built for people who have not signed up here and cannot be told it was a display bug.
 *
 *   Both are pinned by value rather than by shape: a test asserting "the description mentions the
 *   price" passes on 1500000 as happily as on 1.50.
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, with the fix it exists to hold.
 */
import { describe, it, expect } from 'vitest';
import { a2aCardFor, directoryDescriptionFor } from '../../src/services/a2a-card.js';
import type { AimeatConfig } from '../../src/config.js';
import type { AgentRecord } from '../../src/storage/interface.js';

const config = { nodeId: 'test-node', baseUrl: 'https://example.test' } as unknown as AimeatConfig;

const agent = {
  gaii: 'seller#alice@test-node', name: 'seller', owner: 'alice',
  displayName: 'seller', capabilities: [], tags: [], trustScore: 0, morselBalance: 0,
  createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), publicKey: 'x',
} as unknown as AgentRecord;

/** The offering shape the card reads. Only the fields the price sentence touches matter here. */
const offering = (over: Record<string, unknown>) => ({
  offeringId: 'off-1', title: 'Summarise a document', description: 'Key points from a document.',
  action: 'summarize', ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

function priceSentence(o: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const card = a2aCardFor(config, agent, 'https://example.test/v1/a2a/alice/seller', { offerings: [o] as any });
  const skill = (card.skills ?? []).find(s => s.id === 'off-1');
  if (!skill) throw new Error('the offering did not reach the card as a skill');
  return skill.description ?? '';
}

describe('the price on an agent card', () => {
  it('says morsels per task, and never "per morsels"', () => {
    const text = priceSentence(offering({ unit: 'morsels', basePrice: 8, currency: null }));
    expect(text).toContain('8 morsels per task');
    // The defect verbatim: the rail printed where the billing unit belongs.
    expect(text).not.toContain('per morsels');
  });

  it('says one morsel in the singular', () => {
    expect(priceSentence(offering({ unit: 'morsels', basePrice: 1, currency: null })))
      .toContain('1 morsel per task');
  });

  it('turns money micros into money, and never advertises a million times the price', () => {
    const text = priceSentence(offering({ unit: 'money', basePrice: 1_500_000, currency: 'EUR' }));
    expect(text).toContain('1.50 EUR per task');
    // The number a buyer would have decided on. Asserted as an absence, because this is the half
    // that has never been seen: no money-priced offering exists yet, so nothing has ever rendered it.
    expect(text).not.toContain('1500000');
    expect(text).not.toContain('per money');
  });

  it('drops the trailing zeros on a whole amount', () => {
    expect(priceSentence(offering({ unit: 'money', basePrice: 2_000_000, currency: 'USD' })))
      .toContain('2 USD per task');
  });
});

describe('the line a stranger reads in the directory', () => {
  it('is the description the agent set, when it has one', () => {
    expect(directoryDescriptionFor('Reads the open web.', [offering({ title: 'Summarise' })]))
      .toBe('Reads the open web.');
  });

  it('falls back to what the agent SELLS, because both listed agents had none', () => {
    // An empty index is a directory that makes everybody read every card, which is the opposite of
    // what a directory is for.
    expect(directoryDescriptionFor('', [offering({ title: 'Summarise a document' })]))
      .toBe('Summarise a document');
  });

  it('joins several offerings, so one line says the whole shop', () => {
    expect(directoryDescriptionFor(null, [offering({ title: 'Summarise' }), offering({ title: 'Translate' })]))
      .toBe('Summarise · Translate');
  });
});
