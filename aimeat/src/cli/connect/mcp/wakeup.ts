/**
 * @file wakeup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent wake-up via shell command or webhook POST.
 *
 * SECURITY NOTE: `wake.command` is executed via `child_process.exec` as the user
 * who runs `aimeat connect serve`. Anyone able to write to ~/.aimeat/config.yaml
 * effectively gets code execution every time a task arrives. Only the `{{agent}}`
 * placeholder is substituted; no server-side data is interpolated. Treat the
 * config file as a credential and prefer the `webhook` strategy when the local
 * config is not fully under the operator's control (shared machine, backup
 * restore from untrusted source, copy-pasted tutorial).
 *
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Initial creation.
 *   v1.0.1 -- 2026-05-28 -- Add security warning, recursive scheduling guard, and per-strategy fixes.
 */
import { exec } from 'node:child_process';
import type { AimeatConnectConfig } from '../config.js';

export async function wakeAgent(config: AimeatConnectConfig, event: string, detail: string): Promise<void> {
  const wake = config.wake;
  if (!wake) return;

  const strategy = wake.strategy ?? 'command_first';
  const command = wake.command?.replace('{{agent}}', config.agent);
  const webhook = wake.webhook;

  if ((strategy === 'command_only' || strategy === 'command_first') && command) {
    try {
      await execCommand(command);
      console.error(`[wake] Command succeeded: ${command}`);
      return;
    } catch (err) {
      console.error(`[wake] Command failed: ${(err as Error).message}`);
      if (strategy === 'command_only') return;
    }
  }

  if ((strategy === 'webhook_only' || strategy === 'webhook_first' || strategy === 'command_first') && webhook) {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, agent: config.agent, detail }),
      });
      console.error(`[wake] Webhook POST succeeded: ${webhook}`);
      return;
    } catch (err) {
      console.error(`[wake] Webhook failed: ${(err as Error).message}`);
    }
  }

  if (strategy === 'webhook_first' && command) {
    try {
      await execCommand(command);
      console.error(`[wake] Command fallback succeeded: ${command}`);
    } catch (err) {
      console.error(`[wake] Command fallback failed: ${(err as Error).message}`);
    }
  }
}

function execCommand(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 10_000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
