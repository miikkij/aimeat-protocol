/**
 * @file config.ts
 * @description Configuration loader for ~/.aimeat/config.yaml
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse, stringify } from 'yaml';

export interface AimeatConnectConfig {
  node_url: string;
  agent: string;
  owner: string;
  // SECURITY: `wake.command` is passed to child_process.exec — anyone able to
  // write this file (or anyone who tricks the user into pasting a config) gets
  // code execution on every poll cycle. Prefer `webhook` when the local config
  // is not fully under the operator's control.
  wake?: {
    command?: string;
    webhook?: string;
    strategy?: 'command_first' | 'webhook_first' | 'command_only' | 'webhook_only';
  };
  poll_interval?: number;
}

const CONFIG_DIR = join(homedir(), '.aimeat');
const CONFIG_FILE = join(CONFIG_DIR, 'config.yaml');

export function getConfigDir(): string { return CONFIG_DIR; }

export function loadConfig(): AimeatConnectConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  const raw = readFileSync(CONFIG_FILE, 'utf-8');
  return parse(raw) as AimeatConnectConfig;
}

export function saveConfig(config: AimeatConnectConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, stringify(config), 'utf-8');
}
