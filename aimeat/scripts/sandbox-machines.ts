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
 *     - the organism "Asiakaspalvelu" with the workspace "Tukipyynnöt", whose two record spaces an
 *       agent can watch
 *   Run again, it reuses what is there and connects the first machine again. `pnpm sandbox --reset`
 *   throws all of it away with the rest.
 *
 *   NOT A TEST. No assertion; e2e-agent-connectors is what says the feature holds.
 * @structure main(): read .sandbox.json · open the two machines · make the agents once · stay up
 * @usage
 *   cd aimeat && pnpm sandbox && pnpm sandbox:machines     # leave it running; Ctrl+C stops the machine
 * @version-history
 *   v1.3.0 — 2026-10-13 — A stand-in computer answers `crew.menu` with one model profile and two
 *     models, so the new-agent page's "Which model it thinks with" can be looked at and a pick
 *     stored with the approval.
 *   v1.2.0 — 2026-10-12 — The stand-in computers name the features `record_spaces` and
 *     `record_backfill`, in the answer to `crew.menu` and in the X-AIMEAT-Features header a
 *     connector presents at connect.
 *   v1.1.0 — 2026-10-12 — A stand-in computer answers `crew.menu` with a tool list and the feature
 *     `record_spaces`. The agents enrolled on the first machine are attached to its socket with
 *     their own keys (kept in .sandbox-machines.json), because the node asks an agent only while
 *     that agent is connected. The first owner gets the organism "Asiakaspalvelu" with a workspace
 *     "Tukipyynnöt" that has two record spaces, a row space and a document space, so the choice
 *     "when something new arrives in a workspace" can be looked at.
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
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
const MENU_CAPABILITY = 'crew.menu';

/**
 * What a stand-in computer answers when the node asks an agent on it what its runtime offers
 * (GET /v1/agents/:name/crew/menu): the tool ids the home's draft falls back to, and the feature
 * a crew runtime names when it wakes an agent on a workspace's records. It lets the "new agent"
 * page be looked at with its fifth choice open. Nothing here runs a tool or watches a workspace.
 */
const MENU = {
  tools: [
    { id: 'web', purpose: 'search the live web' },
    { id: 'memory', purpose: 'read and write the person\'s AIMEAT memory at exact keys' },
    { id: 'dm', purpose: 'read the messages sent to the agent and answer them' },
    { id: 'app_tools', purpose: 'find and call the tools that apps on AIMEAT publish' },
    { id: 'workspace', purpose: 'read the person\'s organisms and workspaces. Read-only' },
    { id: 'workspace_write', purpose: 'everything "workspace" reads, and create or update a record and append rows' },
  ],
  features: ['record_spaces', 'record_backfill'],
  // Two models in the shape a crew runtime sends them, so the page's model choice can be looked
  // at and a pick stored. Nothing here calls a model.
  llm: {
    profiles: ['content'],
    models: ['deepseek/deepseek-v4-pro', 'openai/gpt-oss-120b'].map((id) => {
      const provider = { type: 'openrouter', name: 'openrouter-paid', models: [{ id, context: 131072 }], base_url: 'https://openrouter.ai/api/v1', api_key_env: 'OPENROUTER_API_KEY' };
      return { label: `openrouter-paid:${id}`, id, ...provider, provider };
    }),
  },
};

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

/** An enrolled agent's key, kept between runs so the stand-in can hold the agent on its socket again. */
interface AgentKey { d: string; x: string; kid: string; machine: string }
/** What SEAT_FILE holds for one sandbox: the second machine's own agent, and the keys of the agents enrolled here. */
interface Kept { base: string; gaii?: string; privateKey?: string; keys?: Record<string, AgentKey> }

/** What was kept for this sandbox; a file written for another one (a reset moves nothing, a new port does) reads as empty. */
function readKept(base: string): Kept {
  const kept = existsSync(SEAT_FILE) ? JSON.parse(readFileSync(SEAT_FILE, 'utf-8')) as Kept : null;
  return kept && kept.base === base ? kept : { base };
}
function writeKept(next: Kept): void { writeFileSync(SEAT_FILE, JSON.stringify(next, null, 2)); }

const KEY_GRANT = 'urn:aimeat:params:oauth:grant-type:agent-key';
const attachedHere = new Set<string>();

/**
 * Hold on a machine's socket every agent this script enrolled on it, the way a connector does:
 * a credential minted with the agent's key, then one `attach` frame. An attached agent is
 * connected for the node, so the node can ask it what its runtime offers (`crew.menu`). An agent
 * whose key is gone (the sandbox was reset, or it was enrolled by an older version of this
 * script) is skipped: it stays on the machine's list and answers nothing.
 */
async function attachKept(ws: WebSocket, base: string, machine: { id: string }): Promise<void> {
  for (const [gaii, key] of Object.entries(readKept(base).keys ?? {})) {
    if (key.machine !== machine.id || attachedHere.has(gaii)) continue;
    const now = Math.floor(Date.now() / 1000);
    const jwk = await importJWK({ kty: 'OKP', crv: 'Ed25519', d: key.d, x: key.x }, 'EdDSA');
    const assertion = await new CompactSign(new TextEncoder().encode(JSON.stringify({ sub: gaii, aud: NODE_ID, iat: now, exp: now + 60, jti: randomUUID() })))
      .setProtectedHeader({ alg: 'EdDSA', kid: key.kid }).sign(jwk);
    const res = await fetch(`${base}/v1/agents/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: KEY_GRANT, assertion }) });
    const body = await res.json().catch(() => null) as { access_token?: string; data?: { access_token?: string } } | null;
    const token = body?.access_token ?? body?.data?.access_token;
    if (!token) continue;
    ws.send(JSON.stringify({ type: 'attach', id: randomUUID(), agent: gaii, token }));
    attachedHere.add(gaii);
  }
}

/** One machine: a tunnel socket that answers the enrolment offer the way a connector does. */
function openMachine(base: string, token: string, owner: string, machine: { id: string; name: string }): Promise<WebSocket> {
  return new Promise((done, fail) => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/v1/connect/tunnel', {
      // The features go out as a connector presents them (AIMEAT_RUNTIME_FEATURES): the node keeps
      // them on the computer's row, so the new-agent page reads them without asking an agent.
      headers: { Authorization: `Bearer ${token}`, 'X-AIMEAT-Install': machine.id, 'X-AIMEAT-Install-Name': encodeURIComponent(machine.name), 'X-AIMEAT-Run-Modes': 'spawn', 'X-AIMEAT-Features': MENU.features.join(',') },
    });
    const timer = setTimeout(() => fail(new Error(`${machine.name}: the tunnel did not answer. Is the sandbox started with this version (pnpm sandbox --stop, then pnpm sandbox)?`)), 10_000);
    ws.on('error', (err) => { clearTimeout(timer); fail(err); });
    ws.on('message', (raw) => {
      let frame: any;
      try { frame = JSON.parse(raw.toString()); } catch { return; }
      if (frame.type === 'welcome') { clearTimeout(timer); done(ws); return; }
      if (frame.type !== 'invoke') return;
      const answer = frame.capability === ENROL_CAPABILITY
        ? enrol(base, token, owner, frame.input, machine.id)
        : frame.capability === MENU_CAPABILITY
          ? Promise.resolve({ ok: true, result: MENU })
          : Promise.resolve({ ok: false, result: { code: 'NO_HANDLER', message: 'a stand-in machine runs nothing' } });
      // A call for an agent held on this socket names it, and the answer names it back.
      void answer.then((r) => ws.send(JSON.stringify({ type: 'invoke_result', id: frame.id, ...(frame.agent ? { agent: frame.agent } : {}), ok: r.ok, result: r.result })));
    });
    // The node drops a socket that goes quiet; a connector sends this on a timer.
    const beat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat' })); }, 20_000);
    ws.on('close', () => clearInterval(beat));
  });
}

/** The connector's half of an enrolment: a key per agent, a card signed with it, one submit. */
async function enrol(base: string, token: string, owner: string, offer: any, machineId: string) {
  const cards: string[] = [];
  for (const offered of offer.agents as any[]) {
    const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    const priv = await exportJWK(pair.privateKey);
    const pub = await exportJWK(pair.publicKey);
    const kid = await calculateJwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: pub.x! }, 'sha256');
    const kept = readKept(base);
    writeKept({ ...kept, keys: { ...(kept.keys ?? {}), [offered.gaii as string]: { d: priv.d!, x: pub.x!, kid, machine: machineId } } });
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
  const kept = readKept(base);
  let seat = kept.gaii && kept.privateKey ? { gaii: kept.gaii, privateKey: kept.privateKey } : null;
  if (!seat) {
    const made = await call(base, '/v1/agents', ownerToken, 'POST', { name: `office-seat-${Date.now().toString(36)}`, owner, capabilities: [], mode: 'workstation', scopes: ['*'] });
    if (made.status !== 201) die(`could not make the second machine's own agent: ${made.error?.message ?? made.status}`);
    seat = { gaii: made.data.agent.gaii as string, privateKey: made.data.private_key as string };
    writeKept({ ...readKept(base), ...seat });
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

const SUPPORT = { organism: 'Asiakaspalvelu', workspace: 'Tukipyynnöt' };

/**
 * One organism of the first owner with a workspace an agent can watch, made once: two record
 * spaces (a published record in one gives a watching agent a task), and a row space and a document
 * space, which the page leaves out because neither wakes an agent.
 */
async function seedSupport(base: string, owner: string, ownerToken: string): Promise<void> {
  // `member` asks for the organisms this owner is in; without it the list holds public ones only,
  // and this organism is private.
  const mine = await call(base, `/v1/organisms?member=${encodeURIComponent(owner)}`, ownerToken);
  if (mine.status !== 200) die(`could not read the owner's organisms: ${mine.error?.message ?? mine.status}`);
  const names = ((mine.data?.organisms ?? []) as Array<{ name?: string }>).map((o) => o.name);
  if (names.includes(SUPPORT.organism)) return;
  const org = await call(base, '/v1/organisms', ownerToken, 'POST', {
    name: SUPPORT.organism, description: 'Asiakkaiden pyynnöt ja niiden vastaukset.', type: 'project', join_policy: 'invite', visibility: 'private',
  });
  if (org.status !== 201) die(`could not make the organism ${SUPPORT.organism}: ${org.error?.message ?? org.status}`);
  const space = (name: string, description: string, namespace: string, more: Record<string, unknown>) =>
    ({ name, description, schemaRef: `schema:${name}@1`, namespace, writeRole: 'member', ...more });
  const ws = await call(base, `/v1/organisms/${org.data.organism.id}/workspaces`, ownerToken, 'POST', {
    name: SUPPORT.workspace,
    manifest: {
      manifestVersion: '1.0', name: SUPPORT.workspace, kind: 'project', status: 'active',
      objectTypes: [
        space('pyynto', 'Asiakkaan lähettämä tukipyyntö.', 'shared.support-requests', { backing: 'memory', cardinality: 'many', versioned: false, mode: 'records' }),
        space('tilaus', 'Verkkokaupasta tullut tilaus.', 'shared.orders', { backing: 'memory', cardinality: 'many', versioned: false, mode: 'records' }),
        space('tapahtuma', 'Loki siitä, mitä pyynnöille on tehty.', 'shared.events', { backing: 'rows', mode: 'records' }),
        space('ohjeet', 'Vastausohjeet.', 'shared.guides', { backing: 'memory', mode: 'document' }),
      ],
    },
  });
  if (ws.status !== 201) die(`could not make the workspace ${SUPPORT.workspace}: ${ws.error?.message ?? ws.status}`);
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
  await seedSupport(base, owner.name, owner.token);

  const home = await openMachine(base, box.agent.token, owner.name, HOME);
  const have = new Set(((await call(base, '/v1/agents', owner.token)).data?.agents ?? []).map((a: any) => a.name as string));

  if (!have.has('aamukatsaus')) {
    // No agent of this script exists, so the sandbox's data is new (a reset keeps the port, and
    // with it the address the kept file is matched by). What was kept belongs to the data that is
    // gone: the second machine's agent and every enrolled key.
    writeKept({ base });
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

  // The agents enrolled on the first machine are held on its socket, so one of them can be asked
  // what its runtime offers. Run again, the kept keys attach them again.
  await attachKept(home, base, HOME);

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
