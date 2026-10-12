/**
 * @file manual-dm-helper.ts
 * @description Manual helper (NOT a CI suite) for browser-verifying the Inbox tab: registers a
 *   throwaway owner on the running dev server and sends a direct message to a target GHII, so the
 *   target (e.g. happyadmin) sees a first-contact request in the UI. Also prints the throwaway
 *   owner's token so a follow-up run can check whether the target's reply arrived.
 * @usage cd aimeat && pnpm exec tsx test/manual-dm-helper.ts send "happyadmin@aimeat-local-001-dev"
 *        cd aimeat && pnpm exec tsx test/manual-dm-helper.ts inbox <ownerName>
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial helper for layer-5 browser verification.
 */
import { registerOwner, ownerToken } from './helpers/owner-login.js';

const BASE = process.env.DM_BASE ?? 'http://localhost:40050';
const NODE_ID = process.env.DM_NODE ?? 'aimeat-local-001-dev';

async function json(path: string, opts: any = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  return { status: res.status, body: await res.json() as any };
}
async function token(owner: string): Promise<string> {
  return ownerToken(BASE, owner);
}

const [action, arg1] = process.argv.slice(2);

if (action === 'send') {
  const target = arg1;
  const name = `bobtest${Date.now().toString().slice(-6)}`;
  const tok = (await registerOwner(BASE, name)).token;
  const send = await json('/v1/messages', {
    method: 'POST', headers: { Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ to: target, body: `Hi happyadmin — this is **${name}** reaching out across the inbox. Accept to chat!` }),
  });
  console.log('sender GHII :', `${name}@${NODE_ID}`);
  console.log('send status :', send.status, JSON.stringify(send.body.data || send.body.error));
} else if (action === 'sendas') {
  // sendas <ownerName> <targetGhii> <body...>
  const [, name, target, ...rest] = process.argv.slice(2);
  const tok = await token(name);
  const send = await json('/v1/messages', {
    method: 'POST', headers: { Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ to: target, body: rest.join(' ') || 'ping' }),
  });
  console.log('send status :', send.status, JSON.stringify(send.body.data || send.body.error));
} else if (action === 'inbox') {
  const tok = await token(arg1);
  const r = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${tok}` } });
  console.log(JSON.stringify(r.body.data, null, 2));
} else {
  console.log('usage: send <targetGhii> | sendas <ownerName> <targetGhii> <body...> | inbox <ownerName>');
}
process.exit(0);
