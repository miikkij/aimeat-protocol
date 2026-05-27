/**
 * @file skill-bundle.ts
 * @description Download and cache the agent's skill bundle ZIP.
 * @structure Fetches the authenticated skill bundle archive and stores the ZIP plus a local SKILL.md pointer.
 * @usage Called after `aimeat connect` auth and by `aimeat connect refresh`.
 * @version-history v1.9.4 — 2026-05-28 — Close one-shot CLI HTTP connections after bundle downloads.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';
import type { AimeatClient } from './api-client.js';

export async function downloadSkillBundle(client: AimeatClient, agentName: string): Promise<void> {
  const bundleDir = join(getConfigDir(), agentName);
  if (!existsSync(bundleDir)) mkdirSync(bundleDir, { recursive: true });

  const url = `${client.getBaseUrl()}/v1/agents/${encodeURIComponent(agentName)}/skill-bundle`;
  const token = client.getTokenValue();
  const headers: Record<string, string> = { Connection: 'close' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Skill bundle download failed: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const zipPath = join(bundleDir, 'skill-bundle.zip');
  writeFileSync(zipPath, buffer);
  writeFileSync(join(bundleDir, 'SKILL.md'),
    `# Skill Bundle\n\nDownloaded from ${client.getBaseUrl()}\nExtract skill-bundle.zip for full reference.\n`);
}
