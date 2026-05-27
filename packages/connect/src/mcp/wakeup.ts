/**
 * @file wakeup.ts
 * @description Agent wake-up via shell command or webhook POST.
 */
import { exec } from 'node:child_process';
import type { AimeatConnectConfig } from '../lib/config.js';

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
