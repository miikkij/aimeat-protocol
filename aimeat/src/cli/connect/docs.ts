/**
 * @file docs.ts
 * @description CLI subcommand: view documentation
 * @structure Reads cached handbook markdown from the connector config directory and prints overview or module docs.
 * @usage Called by `aimeat connect docs [module]`.
 * @version-history v1.9.4 — 2026-05-28 — Update connector guidance and fail missing remote modules with a nonzero exit.
 */
import { AimeatClient } from './api-client.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir, loadConfig } from './config.js';

export async function runDocs(module?: string): Promise<void> {
  if (!module) {
    const config = loadConfig();
    const skillPath = config ? join(getConfigDir(), config.agent, 'SKILL.md') : null;
    if (skillPath && existsSync(skillPath)) {
      console.log(readFileSync(skillPath, 'utf-8'));
    } else {
      console.log('No local docs found. Run: npx aimeat connect refresh');
      console.log('Or specify a module: npx aimeat connect docs tasks');
    }
    return;
  }

  try {
    const client = await AimeatClient.fromConfig();
    const resp = await client.get(`/v1/agents/me/handbook/${encodeURIComponent(module)}`);
    if (!resp.ok) { console.error(`Module "${module}" not found.`); process.exitCode = 1; return; }
    const data = resp.data as { system_prompt?: string };
    console.log(data.system_prompt ?? JSON.stringify(data, null, 2));
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
