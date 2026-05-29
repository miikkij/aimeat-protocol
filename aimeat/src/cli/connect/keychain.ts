/**
 * @file keychain.ts
 * @description Token storage abstraction. Uses a file-based fallback since keytar
 *   requires native compilation and may not be available in all environments.
 *   Tokens live at `~/.aimeat/tokens/{agent}@{owner}.token` with mode 0600.
 * @structure One file per agent. `listAllTokens()` scans the directory and parses
 *   filenames so the multi-agent serve loop can load every credential at once.
 * @version-history
 *   v1.0.0 -- initial file-based store
 *   v1.1.0 -- 2026-05-29 -- Add listAllTokens() for multi-agent serve
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

function tokensDir(): string {
  const dir = join(getConfigDir(), 'tokens');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function tokenPath(agent: string, owner: string): string {
  return join(tokensDir(), `${agent}@${owner}.token`);
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

export interface StoredCredential {
  agent: string;
  owner: string;
  token: string;
}

/**
 * Scan the tokens directory and return every stored credential. File naming
 * is `{agent}@{owner}.token`; unparseable filenames are skipped silently.
 */
export async function listAllTokens(): Promise<StoredCredential[]> {
  const dir = tokensDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: StoredCredential[] = [];
  for (const name of entries) {
    if (!name.endsWith('.token')) continue;
    const stem = name.slice(0, -'.token'.length);
    const at = stem.lastIndexOf('@');
    if (at <= 0 || at === stem.length - 1) continue;
    const agent = stem.slice(0, at);
    const owner = stem.slice(at + 1);
    try {
      const token = readFileSync(join(dir, name), 'utf-8').trim();
      if (!token) continue;
      out.push({ agent, owner, token });
    } catch { /* unreadable file, skip */ }
  }
  return out;
}
