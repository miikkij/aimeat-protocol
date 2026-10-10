/**
 * @file scripts/sandbox-machines.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two stand-in machines for the sandbox node, with agents on them, so the home's agent
 *   pages can be looked at with something in them.
 *
 *   WHY IT EXISTS. A machine is a connector (`aimeat connect serve`) holding a tunnel to the node,
 *   and a sandbox has none: no connector, no crew runtime. The pages that show machines, agents at
 *   work and an agent that waits for its machine were therefore empty there, and the only place to
 *   see them was production. This script is the connector half as a stand-in: it opens the tunnel
 *   the way a connector does (the install id and name headers), answers the node's enrolment offer
 *   with a real key and a signed card, and stays up. It runs no agent: nothing here does work.
 *
 *   WHAT IT LEAVES ON THE SANDBOX, for the first owner:
 *     - "Kotikone", connected for as long as this script runs, holding the sandbox's own agent and
 *       two made here: one that works by the clock on weekdays at 07:00, one that answers messages
 *     - "Toimiston palvelin", which connected once and is now away, holding one agent that works
 *       every hour, and one more agent that was ordered to it afterwards and waits for it
 *     - one proposal from the sandbox's agent, waiting for the owner
 *   Run again, it reuses what is there and connects the first machine again. `pnpm sandbox --reset`
 *   throws all of it away with the rest.
 *
 *   NOT A TEST. No assertion; e2e-agent-connectors is what says the feature holds.
 * @structure main(): read .sandbox.json · open the two machines · make the agents once · stay up
 * @usage
 *   cd aimeat && pnpm sandbox && pnpm sandbox:machines     # leave it running; Ctrl+C stops the machine
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { CompactSign, importJWK, exportJWK, generateKeyPair, calculateJwkThumbprint } from 'jose';
import * as ed from '@noble/ed25519';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..');
const STATE_FILE = join(AIMEAT, '.sandbox.json');
/** The second machine's own agent and its key, kept between runs beside the sandbox database. */
const SEAT_FILE = join(AIMEAT, '.sandbox-machines.json');
const NODE_ID = 'aimeat-local-001-dev';
const ENROL_CAPABILITY = 'aimeat.agents.enrol';

const HOME = { id: 'sandbox-home', name: 'Kotikone' };
const OFFICE = { id: 'sandbox-office', name: 'Toimiston palvelin' };

interface Sandbox { baseUrl: string; owners: Array<{ name: string; token: string }>; agent: { name: string; gaii: string; token: string } | null }

function die(message: string): never { console.error(`  ${message}`); process.exit(1); }

async function call(base: string, path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => null) as { data?: any; error?: { code?: string; message?: string } } | null;
  return { status: res.status, data: json?.data, error: json?.error };
}

/** One machine: a tunnel socket that answers the enrolment offer the way a connector does. */
function openMachine(base: string, token: string, owner: string, machine: { id: string; name: string }): Promise<WebSocket> {
  return new Promise((done, fail) => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/v1/connect/tunnel', {
      headers: { Authorization: `Bearer ${token}`, 'X-AIMEAT-Install': machine.id, 'X-AIMEAT-Install-Name': encodeURIComponent(machine.name), 'X-AIMEAT-Run-Modes': 'spawn' },
    });
    const timer = setTimeout(() => fail(new Error(`${machine.name}: the tunnel did not answer. Is the sandbox started with this version (pnpm sandbox --stop, then pnpm sandbox)?`)), 10_000);
    ws.on('error', (err) => { clearTimeout(timer); fail(err); });
    ws.on('message', (raw) => {
      let frame: any;
      try { frame = JSON.parse(raw.toString()); } catch { return; }
      if (frame.type === 'welcome') { clearTimeout(timer); done(ws); return; }
      if (frame.type !== 'invoke') return;
      const answer = frame.capability === ENROL_CAPABILITY
        ? enrol(base, token, owner, frame.input)
        : Promise.resolve({ ok: false, result: { code: 'NO_HANDLER', message: 'a stand-in machine runs nothing' } });
      void answer.then((r) => ws.send(JSON.stringify({ type: 'invoke_result', id: frame.id, ok: r.ok, result: r.result })));
    });
    // The node drops a socket that goes quiet; a connector sends this on a timer.
    const beat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat' })); }, 20_000);
    ws.on('close', () => clearInterval(beat));
  });
}

/** The connector's half of an enrolment: a key per agent, a card signed with it, one submit. */
async function enrol(base: string, token: string, owner: string, offer: any) {
  const cards: string[] = [];
  for (const offered of offer.agents as any[]) {
    const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    const priv = await exportJWK(pair.privateKey);
    const pub = await exportJWK(pair.publicKey);
    const kid = await calculateJwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: pub.x! }, 'sha256');
    const card = {
      spec: 'aimeat.agent-card/v1', gaii: offered.gaii, name: offered.name, owner, node: NODE_ID,
      displayName: offered.display_name ?? offered.name, description: offered.description ?? '',
      runtime: { platform: 'sandbox-machines', version: '1.0.0' }, runMode: offered.run_mode ?? 'spawn',
      skills: [], modalities: ['text'], requestedScopes: offered.scopes ?? [],
      publicKey: { kty: 'OKP', crv: 'Ed25519', x: pub.x, kid }, jwksUri: offered.jwks_url, cardUri: offered.card_url,
      issuedAt: new Date().toISOString(),
    };
    const key = await importJWK({ kty: 'OKP', crv: 'Ed25519', d: priv.d, x: pub.x }, 'EdDSA');
    cards.push(await new CompactSign(new TextEncoder().encode(JSON.stringify(card))).setProtectedHeader({ alg: 'EdDSA', kid }).sign(key));
  }
  const res = await call(base, '/v1/agents/v2/enrol', token, 'POST', { grant_id: offer.grant_id, cards });
  return res.status === 200 ? { ok: true, result: { attached: (offer.agents as any[]).map((a) => a.name) } } : { ok: false, result: res.error ?? null };
}

/** The second machine needs an agent of its own to hold its tunnel; made once, its key kept. */
async function officeSeat(base: string, owner: string, ownerToken: string): Promise<string> {
  const kept = existsSync(SEAT_FILE) ? JSON.parse(readFileSync(SEAT_FILE, 'utf-8')) as { base: string; gaii: string; privateKey: string } : null;
  let seat = kept && kept.base === base ? kept : null;
  if (!seat) {
    const made = await call(base, '/v1/agents', ownerToken, 'POST', { name: `office-seat-${Date.now().toString(36)}`, owner, capabilities: [], mode: 'workstation', scopes: ['*'] });
    if (made.status !== 201) die(`could not make the second machine's own agent: ${made.error?.message ?? made.status}`);
    seat = { base, gaii: made.data.agent.gaii, privateKey: made.data.private_key };
    writeFileSync(SEAT_FILE, JSON.stringify(seat, null, 2));
  }
  const ts = new Date().toISOString();
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(seat.gaii + ts), Buffer.from(seat.privateKey, 'base64'))).toString('base64');
  const tok = await call(base, '/v1/auth/token', '', 'POST', { gaii: seat.gaii, timestamp: ts, signature: sig });
  if (!tok.data?.token) die('could not sign the second machine in. Run pnpm sandbox --reset, then both commands again.');
  return tok.data.token as string;
}

const crew = (name: string, hears: string[], job: string) => ({
  agent_name: name, process: 'sequential', listen_for: hears,
  agents: [{ name: 'worker', role: 'Worker', goal: job, backstory: 'You do one job and report what you did.', tools: ['memory'], allow_delegation: false }],
  tasks: [{ id: 'main', description: `${job} The request: {{ctx.prompt}}`, expected_output: 'A short report of what was done.', agent: 'worker', context: [] }],
});

/** Propose and approve one agent as the owner, ordered to a machine. Returns whether it attached. */
async function make(base: string, ownerToken: string, a: { name: string; display: string; purpose: string; hears?: string[]; machine: string; cron?: string }) {
  const proposed = await call(base, '/v1/agents/v2/agent-proposals', ownerToken, 'POST', {
    name: a.name, display_name: a.display, purpose: a.purpose, scopes: ['memory:read', 'memory:write'], mode: 'task-runner', run_mode: 'spawn',
    crew_def: crew(a.name, a.hears ?? ['tasks'], a.purpose), connector: a.machine,
  });
  if (proposed.status !== 201) die(`${a.name}: ${proposed.error?.message ?? proposed.status}`);
  const approved = await call(base, `/v1/agents/v2/agent-proposals/${proposed.data.proposal.id}/approve`, ownerToken, 'POST', {});
  if (approved.status !== 200) die(`${a.name}: ${approved.error?.message ?? approved.status}`);
  if (a.cron) {
    await call(base, `/v1/agents/${a.name}/schedules`, ownerToken, 'POST', {
      kind: 'agent_task', cron: a.cron, timezone: 'Europe/Helsinki', display_name: a.display, task_title: a.display, task_description: a.purpose,
    });
  }
  return approved.data?.attached === true;
}

async function main(): Promise<void> {
  if (!existsSync(STATE_FILE)) die('no sandbox here. Run pnpm sandbox first.');
  const box = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as Sandbox;
  const owner = box.owners[0];
  if (!owner || !box.agent) die('the sandbox has no owner or agent. Run pnpm sandbox --reset.');
  const base = box.baseUrl;

  // The agents block is on the finished home, and a home is finished once a live agent exists and
  // the owner's AI has proved its MCP connection. The stand-in writes that proof record, so the
  // owner lands on the finished home rather than on the onboarding one. A second run answers 409.
  await call(base, '/v1/memory', owner.token, 'POST', { key: 'onboarding.hello_mcp', value: { ok: true, by: 'sandbox-machines' } });

  const home = await openMachine(base, box.agent.token, owner.name, HOME);
  const have = new Set(((await call(base, '/v1/agents', owner.token)).data?.agents ?? []).map((a: any) => a.name as string));

  if (!have.has('aamukatsaus')) {
    const office = await openMachine(base, await officeSeat(base, owner.name, owner.token), owner.name, OFFICE);
    // The node records a machine two seconds after its first socket; a proposal can name it at once.
    await make(base, owner.token, { name: 'aamukatsaus', display: 'Aamukatsaus', purpose: 'Kerää joka arkiaamu alan uutiset ja kirjoittaa niistä tiivistelmän.', machine: HOME.id, cron: '0 7 * * 1-5' });
    await make(base, owner.token, { name: 'asiakasviestit', display: 'Asiakasviestit', purpose: 'Vastaa asiakkaiden viesteihin ja kertoo, mihin sinun pitää vastata itse.', hears: ['tasks', 'messages', 'dms'], machine: HOME.id });
    await make(base, owner.token, { name: 'somevahti', display: 'Somevahti', purpose: 'Katsoo kerran tunnissa, mitä yrityksestäsi sanotaan somessa.', machine: OFFICE.id, cron: '0 * * * *' });
    await call(base, '/v1/agents/aamukatsaus/tasks', owner.token, 'POST', { title: 'Aamun uutiset', description: 'Kerää tämän aamun uutiset ja kirjoita tiivistelmä.' });
    await new Promise((r) => setTimeout(r, 2500));
    office.close();
    await new Promise((r) => setTimeout(r, 1000));
    // Ordered to the machine that just went away: it waits for that machine and no other.
    await make(base, owner.token, { name: 'laskuttaja', display: 'Laskuttaja', purpose: 'Tekee laskun jokaisesta valmistuneesta työstä ja lähettää sen hyväksyttäväksi.', machine: OFFICE.id });
    // One proposal from the owner's own agent, left for the owner to approve.
    await call(base, '/v1/agents/v2/agent-proposals', box.agent.token, 'POST', {
      name: 'laskujen-tarkistaja', display_name: 'Laskujen tarkistaja', scopes: ['memory:read'], mode: 'task-runner', run_mode: 'spawn',
      purpose: 'Vertaa saapuvat laskut tilauksiin kerran päivässä ja kertoo, jos summa ei täsmää.',
      crew_def: crew('laskujen-tarkistaja', ['tasks'], 'Compare incoming invoices with their orders and report every mismatch.'),
    });
  }

  console.log(`\n  Stand-in machines on ${base}`);
  console.log(`  ─────────────────────────────────────────────────────────────`);
  console.log(`  ${HOME.name}            connected while this runs`);
  console.log(`  ${OFFICE.name}  away, with one agent on it and one waiting for it`);
  console.log(`\n  sign in as ${owner.name} at ${base}/spa.html, then open ${base}/v1/home`);
  console.log(`  Ctrl+C disconnects ${HOME.name}.\n`);

  const stop = () => { try { home.close(); } catch { /* already closed */ } process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
