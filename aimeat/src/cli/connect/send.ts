/**
 * @file send.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description CLI subcommand: send a message
 * @structure Validates message flags and posts an agent message through the authenticated connector client.
 * @usage Called by `aimeat connect send --body <message>`.
 * @version-history v1.9.4 — 2026-05-28 — Update connector guidance and fail missing arguments with a nonzero exit.
 * @version-history v1.9.5 — 2026-05-28 — Use the current agent message payload shape.
 */
import { AimeatClient } from './api-client.js';
import { loadConfig } from './config.js';

export async function runSend(flags: Record<string, string>): Promise<void> {
  if (!flags.body) {
    console.error('Usage: npx aimeat connect send --body "message"');
    process.exitCode = 1;
    return;
  }
  try {
    const client = await AimeatClient.fromConfig();
    const config = loadConfig()!;
    const resp = await client.post(`/v1/agents/${encodeURIComponent(config.agent)}/messages`, {
      content: flags.body,
      direction: 'outbound',
    });
    if (!resp.ok) {
      console.error('Failed to send:', resp.error);
      process.exitCode = 1;
      return;
    }
    console.log('Message sent.');
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
