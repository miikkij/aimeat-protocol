/**
 * @file connect-enrol-offer-binding.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An enrolment offer is bound to the identity whose socket carried it (secaudit
 *   2026-09, A9-2). A node sends `aimeat.agents.enrol` over a tunnel the daemon holds, and the
 *   daemon writes agent keys and settings from it. The offer has to name the receiving identity's
 *   owner, its node's origin and its node id; every name has to fit the node's own name grammar
 *   before a path is built from it; and nothing the connector already holds for another node may be
 *   written over. Each refusal here is checked for its answer AND for the disk: no key file and no
 *   settings file appears, and the node is never asked to enrol.
 *
 *   It calls the real `handleEnrolOffer` against a fake node (the `forward` it is given) and fake
 *   node cards (the `readNodeCard` it is given, keyed by address), in a temp connector home, the
 *   same way connector-config-layout.test.ts drives it.
 *
 *   THE NODE IS PROVEN BY ITS CARD, NOT BY ITS URL (2026-10-02). On a hosted node the crew runtime
 *   reaches the node on loopback, so the connector's node URL is http://127.0.0.1:40050 while the
 *   offer names the node's public address. The URL comparison refused every offer there. Now the
 *   connector reads the node's card at the address it itself uses and compares node id and key
 *   with the offer. The old test "refuses an offer whose node URL is another origin" asserted the
 *   URL rule this replaces, so it is gone; the refusals it stood for are the card tests below,
 *   built on one address so the old code takes them, which is how each of them failed before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connect-enrol-offer-binding.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-02 — The node is proven by its card at the connector's own address: loopback
 *     takes the offer, another node id, another key or no card refuses, and settings at the same
 *     node's other address are the same node.
 *   v1.0.0 — 2026-09-24 — Initial (secaudit 2026-09, A9-2).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';

const NODE_A = 'aimeat-test-001-a';
const NODE_B = 'aimeat-test-002-b';
const URL_A = 'http://node-a.example:4001';
const URL_B = 'http://node-b.example:4002';
/** Node A as a hosted place: its public address, and the loopback address its own container uses. */
const PUBLIC_A = 'https://place-a.aimeat.example';
const LOOP_A = 'http://127.0.0.1:40050';
const KEY_A = 'a'.repeat(43);
const KEY_B = 'b'.repeat(43);
let home = '';

type Card = { nodeId: string; publicKey: string | null };
/** What each address publishes at /.well-known/aimeat. An address not listed answers nothing. */
const defaultCards = (): Record<string, Card> => ({
  [URL_A]: { nodeId: NODE_A, publicKey: KEY_A },
  [URL_B]: { nodeId: NODE_B, publicKey: KEY_B },
});

/** The identity whose socket carried the offer: alice's own agent on node A, at `nodeUrl`. */
const receiver = (nodeUrl = URL_A) => ({
  gaii: `receiver-bot#alice@${NODE_A}`,
  agent: 'receiver-bot',
  owner: 'alice',
  config: { node_url: nodeUrl },
});

/** A well-formed offer from node A for alice; each test bends one field. */
function offer(patch: Record<string, unknown> = {}, names = ['concierge']) {
  const owner = (patch.owner as string) ?? 'alice';
  const nodeId = (patch.node_id as string) ?? NODE_A;
  return {
    grant_id: 'g1', owner, node_id: nodeId, node_url: URL_A, node_public_key: KEY_A,
    agents: names.map(name => ({ name, gaii: `${name}#${owner}@${nodeId}`, scopes: [] })),
    ...patch,
  };
}

/** Every file under the connector home, relative, so "nothing was written" is one comparison. */
function filesUnder(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full, base) : [full.slice(base.length + 1).replace(/\\/g, '/')];
  }).sort();
}

async function enrol(o: unknown, opts: { receiverUrl?: string; cards?: Record<string, Card> } = {}) {
  process.env.AIMEAT_HOME = home;
  vi.resetModules();
  const { handleEnrolOffer } = await import('../../src/cli/connect/enrolment.js');
  const forwarded: unknown[] = [];
  const attached: unknown[] = [];
  const cardsRead: string[] = [];
  const cards = opts.cards ?? defaultCards();
  const out = await handleEnrolOffer(o, {
    receiver: receiver(opts.receiverUrl),
    readNodeCard: async (url: string) => {
      cardsRead.push(url);
      const card = cards[url.replace(/\/+$/, '')];
      return card ? { ok: true as const, ...card } : { ok: false as const, detail: 'connection refused' };
    },
    // The node accepts whatever it is sent and answers with the identities it was offered.
    forward: async (_m: string, _p: string, opts: { body?: unknown }) => {
      forwarded.push(opts.body);
      const agents = (o as { agents?: Array<{ name: string; gaii: string }> }).agents ?? [];
      return { status: 200, body: { ok: true, data: { enrolled: agents.map(a => ({ name: a.name, gaii: a.gaii, access_token: 't', expires_in: 3600 })) } } };
    },
    attach: async (a: unknown) => { attached.push(a); },
    version: 'test',
  } as never);
  return { out, forwarded, attached, cardsRead };
}

const codeOf = (out: { result: unknown }) => (out.result as { code?: string }).code;

describe('an enrolment offer is bound to the identity that received it (A9-2)', () => {
  beforeEach(() => {
    home = resolve(process.cwd(), `test/.tmp-enrol-binding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(home, { recursive: true });
  });
  afterEach(() => {
    delete process.env.AIMEAT_HOME;
    try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('refuses an offer naming another owner, and writes nothing', async () => {
    const before = filesUnder(home);
    const { out, forwarded } = await enrol(offer({ owner: 'mallory' }));
    expect(out.ok).toBe(false);
    expect(forwarded).toHaveLength(0);
    expect(filesUnder(home)).toEqual(before);
  });

  it('takes an offer naming the node\'s public address when the connector reaches that node on loopback', async () => {
    // The hosted place, measured 2026-10-02: every offer was refused OFFER_FROM_ANOTHER_NODE here.
    const { out, forwarded, attached, cardsRead } = await enrol(
      offer({ node_url: PUBLIC_A }),
      { receiverUrl: LOOP_A, cards: { [LOOP_A]: { nodeId: NODE_A, publicKey: KEY_A } } },
    );
    expect(codeOf(out)).toBeUndefined();
    expect(out.ok).toBe(true);
    expect(forwarded).toHaveLength(1);
    expect(attached).toHaveLength(1);
    // The card was read where the connector itself reaches the node, never at the offer's word.
    expect(cardsRead.every(u => u.startsWith(LOOP_A))).toBe(true);
    const cfg = yamlParse(readFileSync(join(home, 'agents', 'alice', 'concierge', 'config.yaml'), 'utf-8')) as { node_url: string };
    expect(cfg.node_url).toBe(LOOP_A);
  });

  it('refuses when the node at the connector\'s own address names another node, and writes nothing', async () => {
    const before = filesUnder(home);
    const { out, forwarded } = await enrol(offer(), { cards: { [URL_A]: { nodeId: NODE_B, publicKey: KEY_A } } });
    expect(out.ok).toBe(false);
    expect(codeOf(out)).toBe('OFFER_FROM_ANOTHER_NODE');
    expect(forwarded).toHaveLength(0);
    expect(filesUnder(home)).toEqual(before);
  });

  it('refuses when the node at the connector\'s own address carries another key than the offer, and writes nothing', async () => {
    const before = filesUnder(home);
    const { out, forwarded } = await enrol(offer(), { cards: { [URL_A]: { nodeId: NODE_A, publicKey: KEY_B } } });
    expect(out.ok).toBe(false);
    expect(codeOf(out)).toBe('OFFER_FROM_ANOTHER_NODE');
    expect(forwarded).toHaveLength(0);
    expect(filesUnder(home)).toEqual(before);
  });

  it('refuses when the node\'s card cannot be read at the connector\'s own address, and writes nothing', async () => {
    const before = filesUnder(home);
    const { out, forwarded } = await enrol(offer(), { cards: {} });
    expect(out.ok).toBe(false);
    expect(codeOf(out)).toBe('NODE_CARD_UNREADABLE');
    expect(forwarded).toHaveLength(0);
    expect(filesUnder(home)).toEqual(before);
  });

  it('takes settings at the same node\'s other address as that node, and moves them to the connector\'s address', async () => {
    // The second URL comparison: what the connector already holds was compared by origin too.
    const dir = join(home, 'agents', 'alice', 'concierge');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.yaml'), yamlStringify({ node_url: PUBLIC_A, runner: { command: 'run.sh' } }), 'utf-8');
    const sameNode = { nodeId: NODE_A, publicKey: KEY_A };
    const { out, forwarded } = await enrol(
      offer({ node_url: LOOP_A }),
      { receiverUrl: LOOP_A, cards: { [LOOP_A]: sameNode, [PUBLIC_A]: sameNode } },
    );
    expect(codeOf(out)).toBeUndefined();
    expect(out.ok).toBe(true);
    expect(forwarded).toHaveLength(1);
    const cfg = yamlParse(readFileSync(join(dir, 'config.yaml'), 'utf-8')) as { node_url: string; runner: unknown };
    expect(cfg.node_url).toBe(LOOP_A);
    expect(cfg.runner).toEqual({ command: 'run.sh' });
  });

  it('refuses an offer whose node id is not the receiving identity\'s node, and writes nothing', async () => {
    const before = filesUnder(home);
    const { out, forwarded } = await enrol(offer({ node_id: 'aimeat-test-002-b' }));
    expect(out.ok).toBe(false);
    expect(forwarded).toHaveLength(0);
    expect(filesUnder(home)).toEqual(before);
  });

  it('refuses a name with ../ in it before any path is built, and writes nothing', async () => {
    const before = filesUnder(home);
    const { out, forwarded } = await enrol(offer({}, ['../escape-probe']));
    expect(out.ok).toBe(false);
    expect(forwarded).toHaveLength(0);
    expect(filesUnder(home)).toEqual(before);
    expect(filesUnder(home).some(f => f.includes('escape-probe'))).toBe(false);
  });

  it('refuses an agent whose offered identity is not name#owner@node', async () => {
    const o = offer();
    o.agents[0].gaii = `concierge#bob@${NODE_A}`;
    const { out, forwarded } = await enrol(o);
    expect(out.ok).toBe(false);
    expect(forwarded).toHaveLength(0);
  });

  it('does not write over a key this connector holds for another node', async () => {
    mkdirSync(join(home, 'keys'), { recursive: true });
    const keyFile = join(home, 'keys', 'concierge@alice.key');
    const other = JSON.stringify({ privateKey: 'p', publicKey: 'x', kid: 'k', gaii: 'concierge#alice@aimeat-test-002-b', nodeId: 'aimeat-test-002-b' });
    writeFileSync(keyFile, other, 'utf-8');
    const { out, forwarded } = await enrol(offer());
    expect(out.ok).toBe(false);
    expect(forwarded).toHaveLength(0);
    expect(readFileSync(keyFile, 'utf-8')).toBe(other);
  });

  it('does not write over settings that point at another node', async () => {
    const dir = join(home, 'agents', 'alice', 'concierge');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.yaml'), yamlStringify({ node_url: URL_B, runner: { command: 'run.sh' } }), 'utf-8');
    const { out, forwarded } = await enrol(offer());
    expect(out.ok).toBe(false);
    expect(codeOf(out)).toBe('HELD_FOR_ANOTHER_NODE');
    expect(forwarded).toHaveLength(0);
    expect(yamlParse(readFileSync(join(dir, 'config.yaml'), 'utf-8')).node_url).toBe(URL_B);
    expect(existsSync(join(home, 'keys', 'concierge@alice.key'))).toBe(false);
  });

  it('does not write over settings at an address whose card cannot be read', async () => {
    const dir = join(home, 'agents', 'alice', 'concierge');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.yaml'), yamlStringify({ node_url: 'http://gone.example:4009' }), 'utf-8');
    const { out, forwarded } = await enrol(offer());
    expect(codeOf(out)).toBe('HELD_FOR_ANOTHER_NODE');
    expect(forwarded).toHaveLength(0);
    expect(yamlParse(readFileSync(join(dir, 'config.yaml'), 'utf-8')).node_url).toBe('http://gone.example:4009');
    expect(existsSync(join(home, 'keys', 'concierge@alice.key'))).toBe(false);
  });

  it('enrols a well-formed offer from the receiving identity\'s own node', async () => {
    const { out, forwarded, attached } = await enrol(offer());
    expect(out.ok).toBe(true);
    expect(forwarded).toHaveLength(1);
    expect(attached).toHaveLength(1);
    expect(existsSync(join(home, 'keys', 'concierge@alice.key'))).toBe(true);
    const cfg = yamlParse(readFileSync(join(home, 'agents', 'alice', 'concierge', 'config.yaml'), 'utf-8')) as { node_url: string };
    expect(cfg.node_url).toBe(URL_A);
  });
});
