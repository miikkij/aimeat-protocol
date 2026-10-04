/**
 * @file src/services/goose-chat-config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The goose configuration and working directory the node's chat agent runs with.
 *
 *   WHY. goose loads its own default extensions unless its config says otherwise, and runs in the
 *   directory it is given. Measured 2026-10-04 with the real `goose acp` 1.50.0 on the node route
 *   (scripts/chat-turn-measure.ts --stub): one chat round sent 78 222 characters, of which 31 323 were
 *   the system message and 45 289 the tool definitions of 37 tools. Of those, 18 tools and most of the
 *   system message were goose's own: a shell and file editing (developer), code analysis (analyze),
 *   app building (apps), an extension manager that can switch the others back on, sub-agents
 *   (summon), a skills index of 11 279 characters, and, from the working directory, this repository's
 *   AGENTS.md as "project hints". The node chat uses none of them. The shell also ran on the node's
 *   own machine: the child environment is allow-listed (services/goose-env.ts), but a shell on the
 *   host is a shell on the host.
 *
 *   WHAT IT DOES. The chat gets a goose root of its own (AIMEAT_GOOSE_PATH_ROOT, or a directory under
 *   the system temp directory named for this node) with a config.yaml that switches every goose
 *   extension off except `todo`, which the turn guard reads (services/chat-turn-guard.ts), and an
 *   empty working directory, so goose finds no project hints and no skills to list. The node's own
 *   MCP server is given per session and is not affected.
 *
 *   AN OPERATOR'S OWN FILE IS LEFT ALONE. The node writes config.yaml when it is missing or when it
 *   carries the node's marker line. A file without the marker is the operator's, kept as it is, with
 *   one warning, because an operator who wrote their own goose config for the chat meant it.
 * @structure CHAT_GOOSE_EXTENSIONS · chatGooseRoot · chatWorkDir · chatGooseConfigYaml · ensureChatGooseConfig
 * @usage
 *   const { root, cwd } = ensureChatGooseConfig(config);   // before `goose acp` starts
 * @version-history
 *   v1.0.0 — 2026-10-04 — Initial.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';

/** The first line of a config.yaml the node wrote. A file without it belongs to the operator. */
export const NODE_CONFIG_MARKER = '# Written by the AIMEAT node for its chat agent (services/goose-chat-config.ts). The node rewrites this file.';

/**
 * goose 1.50.0's platform extensions (`goose info -v` on an empty root) and whether the node chat
 * keeps each. Only `todo`: the chat's work is the node's MCP tools, and the turn guard reads the todo
 * tool's calls. An extension goose adds in a later version, and the node does not name here, keeps
 * goose's own default until it is named.
 */
export const CHAT_GOOSE_EXTENSIONS: Readonly<Record<string, boolean>> = {
  todo: true,
  developer: false,
  analyze: false,
  apps: false,
  extensionmanager: false,
  skills: false,
  summon: false,
  tom: false,
  chatrecall: false,
  summarize: false,
  code_execution: false,
};

type RootConfig = Pick<AimeatConfig, 'goosePathRoot' | 'nodeId'>;

/** The chat agent's goose root: the operator's AIMEAT_GOOSE_PATH_ROOT, or one of the node's own. */
export function chatGooseRoot(config: RootConfig): string {
  return config.goosePathRoot || join(tmpdir(), `aimeat-goose-${config.nodeId.replace(/[^a-zA-Z0-9-]/g, '_')}`);
}

/** The empty directory the chat's goose sessions run in, so goose finds no project files. */
export function chatWorkDir(config: RootConfig): string {
  return join(chatGooseRoot(config), 'work');
}

/** The config.yaml the node writes: the marker and the extension switches, nothing else. */
export function chatGooseConfigYaml(): string {
  const lines = [NODE_CONFIG_MARKER, 'extensions:'];
  for (const [name, enabled] of Object.entries(CHAT_GOOSE_EXTENSIONS)) {
    lines.push(`  ${name}:`, `    enabled: ${enabled}`, '    type: platform', `    name: ${name}`, '    bundled: true');
  }
  return lines.join('\n') + '\n';
}

let warnedOperatorFile = false;

/** Write the chat's goose config and working directory, and return where they are. Idempotent. */
export function ensureChatGooseConfig(config: RootConfig): { root: string; cwd: string } {
  const root = chatGooseRoot(config);
  const cwd = chatWorkDir(config);
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const file = join(root, 'config', 'config.yaml');
  const wanted = chatGooseConfigYaml();
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current === null || (current.startsWith(NODE_CONFIG_MARKER) && current !== wanted)) {
    writeFileSync(file, wanted);
  } else if (!current.startsWith(NODE_CONFIG_MARKER) && !warnedOperatorFile) {
    warnedOperatorFile = true;
    logger.warn(`[goose] ${file} is the operator's own; the chat runs with the extensions it switches on, and the node does not change it`);
  }
  return { root, cwd };
}
