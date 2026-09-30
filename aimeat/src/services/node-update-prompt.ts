/**
 * @file src/services/node-update-prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The prompt an operator copies from the new-version dialog into Claude Code or Codex,
 *   which then updates the node. Built on the node, so the dialog and the aimeat_admin_node_update
 *   MCP tool hand out the same text.
 *
 *   IT CARRIES WHAT THE NODE KNOWS AND THE AI CANNOT SEE: the running and the new version, the
 *   address, where the package sits and where the node was started from, and the node's own guess
 *   at how it was installed. The AI checks the guess against the machine, because a guess from a
 *   path is a lead: a clone run through `npm link` looks like an npm install from inside.
 *
 *   ONE PATH PER INSTALL THAT README.md DESCRIBES (npm, npx, from source, Docker, the desktop app),
 *   and one sentence for everything else. The MCP connection is used to confirm the result when the
 *   AI has one; the update itself needs a shell on the machine and nothing more.
 *
 *   Written to docs/coding-guidelines/prompt-writing.md: every instruction says what to do.
 * @structure InstallMethod · UpdatePromptInput · buildNodeUpdatePrompt()
 * @usage const prompt = buildNodeUpdatePrompt({ current, latest, releasedAt, baseUrl, install, storage });
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */

export type InstallMethod = 'npm' | 'npx' | 'source' | 'docker' | 'desktop' | 'unknown';

export interface UpdatePromptInput {
  current: string;
  latest: string;
  releasedAt: string | null;
  baseUrl: string;
  install: { method: InstallMethod; packageDir: string | null; workingDir: string };
  /** The storage backend, so the backup step names the right thing to copy. */
  storage: string;
  sqlitePath: string;
}

const METHOD_LABEL: Record<InstallMethod, string> = {
  npm: 'an npm install of the `aimeat` package',
  npx: 'run with npx',
  source: 'a git clone of github.com/miikkij/aimeat-protocol, run from source',
  docker: 'inside a Docker container',
  desktop: 'the AIMEAT Personal Node desktop app',
  unknown: 'could not be told from its files',
};

function backupStep(input: UpdatePromptInput): string {
  if (input.storage === 'sqlite') {
    return `Make a backup first: copy the SQLite database file (\`${input.sqlitePath}\`, relative to the working directory) and the \`.env\` file to a safe place, and tell me where they are.`;
  }
  if (input.storage === 'postgres-kysely') {
    return 'Make a backup first: take a `pg_dump` of the PostgreSQL database that AIMEAT_DATABASE_URL in the `.env` names, copy the `.env` file to a safe place, and tell me where they are.';
  }
  return 'Make a backup first: copy the `.env` file to a safe place and tell me where it is. This node keeps its data in memory, so a restart starts it empty.';
}

export function buildNodeUpdatePrompt(input: UpdatePromptInput): string {
  const { current, latest, baseUrl, install } = input;
  const released = input.releasedAt ? ` (released ${input.releasedAt.slice(0, 10)})` : '';
  const base = baseUrl.replace(/\/+$/, '');
  return [
    `Update my AIMEAT node from version ${current} to ${latest}, the newest version on npm${released}.`,
    '',
    'What the node says about itself:',
    `- Address: ${base}`,
    `- Running version: ${current}`,
    `- Installed as: ${METHOD_LABEL[install.method]} (the node guessed this from where its files are; confirm it on the machine)`,
    `- Package directory: ${install.packageDir ?? 'unknown'}`,
    `- Working directory, where it was started and where its .env and data are: ${install.workingDir}`,
    `- Storage: ${input.storage}`,
    '',
    'Do this, in order:',
    '1. Find out how this node is installed and how it is started: look at the package directory, the working directory, and the process, service or container that runs it. When the answer is unclear, ask me before you go on.',
    `2. ${backupStep(input)}`,
    '3. Tell me that the node goes down for the update, and wait for my go-ahead. People who use it lose their connection while it restarts.',
    '4. Update it the way it was installed:',
    `   - npm install: \`npm install -g aimeat@${latest}\` for a global install, or \`npm install aimeat@${latest}\` in the project that depends on it.`,
    `   - npx: start it from the working directory as \`npx aimeat@${latest} start\`, with the version named, so npx fetches the new one and leaves its cached copy behind.`,
    '   - From source: `git pull` on the main branch, then in the `aimeat/` directory `pnpm install`, and `pnpm build` when the node runs from `dist/` (`pnpm start`).',
    '   - Docker: `git pull` in the clone, then in `aimeat/` run `docker compose up --build -d` with the same compose file it runs with now (`-f docker-compose.sqlite.yml` for the SQLite one).',
    '   - AIMEAT Personal Node (the Windows desktop app): the app updates itself. Open it and accept the update, or install the newest release from https://github.com/miikkij/aimeat-protocol/releases/latest.',
    `   - Any other setup (a process manager, a system service, your own container image, a package mirror): bring the \`aimeat\` package to ${latest} the way that setup installs it.`,
    '5. Start the node again the same way it was started before, from the same working directory with the same `.env`. On start it runs its database migrations and refreshes its pages and translations by itself, and it keeps the files I have edited. Keep the existing `.env` as it is; `aimeat init` is for a new node only.',
    `6. Check the result: \`curl -s ${base}/v1/build\` answers with "version": "${latest}". When you are connected to this node over MCP (the AIMEAT connector), also call the aimeat_admin_node_update tool, which reports the version the node runs. The update itself works without MCP.`,
    '7. Tell me what you did, which version runs now, and anything that went differently from this plan. When a step fails, stop there, show me the error, and keep the data and the `.env` exactly as they are.',
  ].join('\n');
}
