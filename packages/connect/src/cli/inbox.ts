/**
 * @file inbox.ts
 * @description CLI subcommand: check message inbox
 */
import { AimeatClient } from '../lib/api-client.js';

export async function runInbox(): Promise<void> {
  const client = await AimeatClient.fromConfig();
  const resp = await client.get('/v1/agents/me/messages/inbox');
  if (!resp.ok) { console.error('Failed to fetch inbox:', resp.error); return; }
  const messages = (resp.data as { messages?: unknown[] })?.messages ?? [];
  if (messages.length === 0) { console.log('Inbox empty.'); return; }
  console.log(JSON.stringify(messages, null, 2));
}
