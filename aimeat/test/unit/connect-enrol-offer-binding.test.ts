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
 *   It calls the real `handleEnrolOffer` against a fake node (the `forward` it is given), in a temp
 *   connector home, the same way connector-config-layout.test.ts drives it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connect-enrol-offer-binding.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (secaudit 2026-09, A9-2).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';

const NODE_A = 'aimeat-test-001-a';
const URL_A = 'http://node-a.example:4001';
let home = '';

/** The identity whose socket carried the offer: alice's own agent on node A. */
const receiver = () => ({
  gaii: `receiver-bot#alice@${NODE_A}`,
  agent: 'receiver-bot',
  owner: 'alice',
  config: { node_url: URL_A },
});

/** A well-formed offer from node A for alice; each test bends one field. */
function offer(patch: Record<string, unknown> = {}, names = ['concierge']) {
  const owner = (patch.owner as string) ?? 'alice';
  const nodeId = (patch.node_id as string) ?? NODE_A;
  return {
    grant_id: 'g1', owner, node_id: nodeId, node_url: URL_A,
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

async function enrol(o: unknown) {
  process.env.AIMEAT_HOME = home;
  vi.resetModules();
  const { handleEnrolOffer } = await import('../../src/cli/connect/enrolment.js');
  const forwarded: unknown[] = [];
  const attached: unknown[] = [];
  const out = await handleEnrolOffer(o, {
    receiver: receiver(),
    // The node accepts whatever it is sent and answers with the identities it was offered.
    forward: async (_m: string, _p: string, opts: { body?: unknown }) => {
      forwarded.push(opts.body);
      const agents = (o as { agents?: Array<{ name: string; gaii: string }> }).agents ?? [];
      return { status: 200, body: { ok: true, data: { enrolled: agents.map(a => ({ name: a.name, gaii: a.gaii, access_token: 't', expires_in: 3600 })) } } };
    },
    attach: async (a: unknown) => { attached.push(a); },
    version: 'test',
  } as never);
  return { out, forwarded, attached };
}

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

  it('refuses an offer whose node URL is another origin, and writes nothing', async () => {
    const before = filesUnder(home);
    const { out, forwarded } = await enrol(offer({ node_url: 'http://node-b.example:4002' }));
    expect(out.ok).toBe(false);
    expect(forwarded).toHaveLength(0);
    expect(filesUnder(home)).toEqual(before);
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
    writeFileSync(join(dir, 'config.yaml'), yamlStringify({ node_url: 'http://node-b.example:4002', runner: { command: 'run.sh' } }), 'utf-8');
    const { out, forwarded } = await enrol(offer());
    expect(out.ok).toBe(false);
    expect(forwarded).toHaveLength(0);
    expect(yamlParse(readFileSync(join(dir, 'config.yaml'), 'utf-8')).node_url).toBe('http://node-b.example:4002');
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
