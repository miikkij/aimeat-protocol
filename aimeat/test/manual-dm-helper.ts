/**
 * @file manual-dm-helper.ts
 * @description Manual helper (NOT a CI suite) for browser-verifying the Inbox tab: registers a
 *   throwaway owner on the running dev server and sends a direct message to a target GHII, so the
 *   target (e.g. happyadmin) sees a first-contact request in the UI. Also prints the throwaway
 *   owner's token so a follow-up run can check whether the target's reply arrived.
 * @usage cd aimeat && pnpm exec tsx test/manual-dm-helper.ts send "happyadmin@aimeat-local-001-dev"
 *        cd aimeat && pnpm exec tsx test/manual-dm-helper.ts inbox <ownerName> <privKeyB64>
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial helper for layer-5 browser verification.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.DM_BASE ?? 'http://localhost:40050';
const NODE_ID = process.env.DM_NODE ?? 'aimeat-local-001-dev';

async function sign(privB64: string, msg: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}
async function json(path: string, opts: any = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  return { status: res.status, body: await res.json() as any };
}
async function token(owner: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const sig = await sign(priv, owner + NODE_ID + ts);
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp: ts, signature: sig }) });
  if (!body.ok) throw new Error('token: ' + JSON.stringify(body.error));
  return body.data.token;
}

const [action, arg1, arg2] = process.argv.slice(2);

if (action === 'send') {
  const target = arg1;
  const name = `bobtest${Date.now().toString().slice(-6)}`;
  const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
  if (reg.status !== 201) throw new Error('register: ' + JSON.stringify(reg.body));
  const priv = reg.body.data.private_key;
  const tok = await token(name, priv);
  const send = await json('/v1/messages', {
    method: 'POST', headers: { Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ to: target, body: `Hi happyadmin — this is **${name}** reaching out across the inbox. Accept to chat!` }),
  });
  console.log('sender GHII :', `${name}@${NODE_ID}`);
  console.log('sender priv :', priv);
  console.log('send status :', send.status, JSON.stringify(send.body.data || send.body.error));
} else if (action === 'sendas') {
  // sendas <ownerName> <privKeyB64> <targetGhii> <body...>
  const [, name, priv, target, ...rest] = process.argv.slice(2);
  const tok = await token(name, priv);
  const send = await json('/v1/messages', {
    method: 'POST', headers: { Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ to: target, body: rest.join(' ') || 'ping' }),
  });
  console.log('send status :', send.status, JSON.stringify(send.body.data || send.body.error));
} else if (action === 'inbox') {
  const tok = await token(arg1, arg2);
  const r = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${tok}` } });
  console.log(JSON.stringify(r.body.data, null, 2));
} else {
  console.log('usage: send <targetGhii> | inbox <ownerName> <privKeyB64>');
}
process.exit(0);
