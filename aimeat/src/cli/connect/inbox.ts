/**
 * @file inbox.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description CLI subcommand: check message inbox
 * @structure Loads connector credentials, fetches pending inbound messages, and prints them as JSON.
 * @usage Called by `aimeat connect inbox`.
 * @version-history v1.9.4 — 2026-05-28 — Handle missing config and request failures without stack traces.
 */
import { AimeatClient } from './api-client.js';
import { loadConfig } from './config.js';

export async function runInbox(): Promise<void> {
  try {
    const client = await AimeatClient.fromConfig();
    const config = loadConfig()!;
    const resp = await client.get(`/v1/agents/${encodeURIComponent(config.agent)}/messages/inbox`);
    if (!resp.ok) {
      console.error('Failed to fetch inbox:', resp.error);
      process.exitCode = 1;
      return;
    }
    const messages = (resp.data as { messages?: unknown[] })?.messages ?? [];
    if (messages.length === 0) { console.log('Inbox empty.'); return; }
    console.log(JSON.stringify(messages, null, 2));
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
