/**
 * @file docs.ts
 * @description CLI subcommand: view documentation
 */
import { AimeatClient } from '../lib/api-client.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir, loadConfig } from '../lib/config.js';

export async function runDocs(module?: string): Promise<void> {
  if (!module) {
    const config = loadConfig();
    const skillPath = config ? join(getConfigDir(), config.agent, 'SKILL.md') : null;
    if (skillPath && existsSync(skillPath)) {
      console.log(readFileSync(skillPath, 'utf-8'));
    } else {
      console.log('No local docs found. Run: npx @aimeat/connect refresh');
      console.log('Or specify a module: npx @aimeat/connect docs tasks');
    }
    return;
  }

  try {
    const client = await AimeatClient.fromConfig();
    const resp = await client.get(`/v1/agents/me/handbook/${encodeURIComponent(module)}`);
    if (!resp.ok) { console.error(`Module "${module}" not found.`); return; }
    const data = resp.data as { system_prompt?: string };
    console.log(data.system_prompt ?? JSON.stringify(data, null, 2));
  } catch (e) { console.error((e as Error).message); }
}
