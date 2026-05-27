/**
 * @file send.ts
 * @description CLI subcommand: send a message
 */
import { AimeatClient } from './api-client.js';
import { loadConfig } from './config.js';

export async function runSend(flags: Record<string, string>): Promise<void> {
  if (!flags.to || !flags.body) {
    console.error('Usage: npx @aimeat/connect send --to GAII --body "message"');
    return;
  }
  const client = await AimeatClient.fromConfig();
  const config = loadConfig()!;
  const resp = await client.post(`/v1/agents/${encodeURIComponent(config.agent)}/messages`, {
    to: flags.to,
    body: flags.body,
  });
  if (!resp.ok) { console.error('Failed to send:', resp.error); return; }
  console.log('Message sent.');
}
