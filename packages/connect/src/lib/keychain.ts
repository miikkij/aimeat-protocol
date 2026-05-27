/**
 * @file keychain.ts
 * @description Token storage abstraction. Uses a file-based fallback since keytar
 *   requires native compilation and may not be available in all environments.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

function tokenPath(agent: string, owner: string): string {
  const dir = join(getConfigDir(), 'tokens');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${agent}@${owner}.token`);
}

export async function storeToken(agent: string, owner: string, token: string): Promise<void> {
  writeFileSync(tokenPath(agent, owner), token, { mode: 0o600 });
}

export async function getToken(agent: string, owner: string): Promise<string | null> {
  const p = tokenPath(agent, owner);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf-8').trim();
}

export async function deleteToken(agent: string, owner: string): Promise<boolean> {
  const p = tokenPath(agent, owner);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}
