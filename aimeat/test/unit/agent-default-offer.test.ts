/**
 * @file test/unit/agent-default-offer.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The offer a new agent's crew definition carries (services/agent-default-offer.ts):
 *   a definition with none gets one made from the agent's name and purpose, an entry a proposer
 *   wrote is completed with every key the crew runtime reads, and nothing gives the offer a price
 *   or a visibility.
 * @version-history
 *   v1.2.0 — 2026-10-13 — offerSignalError: the workflow signals a proposer may write into the first offer.
 *   v1.1.0 — 2026-10-11 — firstRequestOf: the first offer's example, given to a new agent as its first work.
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { defaultOfferFor, withDefaultOffer, firstRequestOf, offerSignalError } from '../../src/services/agent-default-offer.js';

const AGENT = { name: 'morning-news', displayName: 'Morning news', purpose: 'Reads the morning news and writes a short summary.' };

/** The keys the crew runtime reads from an entry, and fails on when one is missing. */
const RUNTIME_KEYS = ['id', 'title', 'ask', 'example', 'cost', 'latency', 'repeatability', 'verification', 'consequences'];

describe('the offer a new agent carries', () => {
  it('is made from the agent\'s name and purpose when the definition has none', () => {
    const def = withDefaultOffer({ agent_name: 'morning-news', agents: [], tasks: [] }, AGENT);
    expect(def.offers).toHaveLength(1);
    const offer = (def.offers as Record<string, unknown>[])[0];
    expect(offer.id).toBe('morning-news');
    expect(offer.title).toBe('Morning news');
    expect(offer.ask).toBe(AGENT.purpose);
    for (const key of RUNTIME_KEYS) expect(offer, `missing ${key}`).toHaveProperty(key);
  });

  it('treats an empty list, and a list with no object in it, as no offer', () => {
    expect((withDefaultOffer({ offers: [] }, AGENT).offers as unknown[])).toHaveLength(1);
    expect((withDefaultOffer({ offers: ['x', null, 3] }, AGENT).offers as Record<string, unknown>[])[0].id).toBe('morning-news');
  });

  it('keeps what a proposer wrote and adds only the keys that are missing', () => {
    const def = withDefaultOffer({
      offers: [{ id: 'daily-digest', title: 'A daily digest', ask: 'Give me a topic.', cost: 'free', inputs: { topic: 'string' } }],
    }, AGENT);
    const offer = (def.offers as Record<string, unknown>[])[0];
    expect(offer.id).toBe('daily-digest');
    expect(offer.title).toBe('A daily digest');
    expect(offer.ask).toBe('Give me a topic.');
    expect(offer.cost).toBe('free');
    expect(offer.inputs).toEqual({ topic: 'string' });
    expect(offer.example).toBe('');
    expect(offer.latency).toBe('minutes');
    expect(offer.consequences).toEqual([]);
  });

  it('replaces a value outside the node\'s vocabulary with the default, so the publish is not refused', () => {
    const def = withDefaultOffer({ offers: [{ id: 'x', title: 'X', ask: 'Y', cost: 'pricey', verification: 'trusted' }] }, AGENT);
    const offer = (def.offers as Record<string, unknown>[])[0];
    expect(offer.cost).toBe('cheap');
    expect(offer.verification).toBe('ungated');
  });

  it('holds a title and an ask to the bounds the offers schema has', () => {
    const offer = defaultOfferFor({ name: 'a-b', displayName: 'T'.repeat(300), purpose: 'P'.repeat(900) });
    expect(offer.title).toHaveLength(120);
    expect(offer.ask).toHaveLength(500);
  });

  it('gives the offer no price and no visibility: it is the owner\'s own until they say otherwise', () => {
    const offer = defaultOfferFor(AGENT) as Record<string, unknown>;
    expect(offer.price).toBeUndefined();
    expect(offer.visibility).toBeUndefined();
    expect(offer.success_signal).toBeUndefined();
  });

  it('leaves the rest of the definition as it came', () => {
    const def = withDefaultOffer({ agent_name: 'morning-news', listen_for: ['tasks'], agents: [{ role: 'R' }] }, AGENT);
    expect(def.agent_name).toBe('morning-news');
    expect(def.listen_for).toEqual(['tasks']);
    expect(def.agents).toEqual([{ role: 'R' }]);
  });
});

describe('the request a new agent is given first', () => {
  it('is the example of the definition\'s first offer', () => {
    expect(firstRequestOf({ offers: [{ id: 'a', example: '  Make a slogan for Morning Coffee.  ' }, { id: 'b', example: 'second' }] }))
      .toBe('Make a slogan for Morning Coffee.');
  });

  it('is empty when there is no offer, no example, or no definition, so the caller uses the purpose', () => {
    expect(firstRequestOf({ offers: [{ id: 'a', example: '' }] })).toBe('');
    expect(firstRequestOf({ offers: [{ id: 'a' }] })).toBe('');
    expect(firstRequestOf({ offers: ['x', null] })).toBe('');
    expect(firstRequestOf({})).toBe('');
    expect(firstRequestOf(null)).toBe('');
  });
});

describe('the workflow signals a proposer may write into the first offer', () => {
  const signals = {
    required_to_function: 'none',
    success_signal: { kind: 'deterministic', key: 'crews.morning-news.wf.{run}', op: 'nonempty' },
    deliverable_location: { key: 'crews.morning-news.wf.{run}' },
  };

  it('none is fine: the default offer carries no workflow signals (Jouni, 2026-10-11)', () => {
    expect(offerSignalError({ offers: [{ id: 'a', title: 'A', ask: 'ask' }] }, 'morning-news')).toBeNull();
    expect(offerSignalError({}, 'morning-news')).toBeNull();
    expect(offerSignalError(null, 'morning-news')).toBeNull();
    const def = withDefaultOffer({ agents: [], tasks: [] }, AGENT);
    const offer = (def.offers as Record<string, unknown>[])[0];
    for (const field of Object.keys(signals)) expect(offer).not.toHaveProperty(field);
  });

  it('all three, with the result under the agent\'s own crews.<name>. keys, is accepted and kept', () => {
    expect(offerSignalError({ offers: [{ id: 'a', ...signals }] }, 'morning-news')).toBeNull();
    const def = withDefaultOffer({ offers: [{ id: 'a', title: 'A', ask: 'ask', ...signals }] }, AGENT);
    const offer = (def.offers as Record<string, unknown>[])[0];
    expect(offer.success_signal).toEqual(signals.success_signal);
    expect(offer.deliverable_location).toEqual(signals.deliverable_location);
    expect(offer.required_to_function).toBe('none');
  });

  it('a half set is refused, naming what is missing: the runtime would publish no offer at all', () => {
    const { deliverable_location: _dl, ...two } = signals;
    void _dl;
    expect(offerSignalError({ offers: [{ id: 'a', ...two }] }, 'morning-news')).toContain('deliverable_location');
    expect(offerSignalError({ offers: [{ id: 'a', success_signal: signals.success_signal }] }, 'morning-news')).toContain('required_to_function');
  });

  it('a result key outside the agent\'s own keys is refused: the runtime writes nowhere else', () => {
    const elsewhere = (key: unknown) => offerSignalError({ offers: [{ id: 'a', ...signals, deliverable_location: { key } }] }, 'morning-news');
    expect(elsewhere('agents.morning-news.offers')).toContain('crews.morning-news.');
    expect(elsewhere('crews.other-agent.wf.{run}')).toContain('crews.morning-news.');
    expect(elsewhere('crews.morning-news.wf {run}')).toContain('space');
    expect(elsewhere('')).toContain('deliverable_location');
    expect(elsewhere(undefined)).toContain('deliverable_location');
    expect(offerSignalError({ offers: [{ id: 'a', ...signals, deliverable_location: 'crews.morning-news.wf.{run}' }] }, 'morning-news')).toContain('deliverable_location');
  });

  it('only the first offer is read, because the runtime publishes only the first', () => {
    expect(offerSignalError({ offers: [{ id: 'a' }, { id: 'b', success_signal: signals.success_signal }] }, 'morning-news')).toBeNull();
  });
});
