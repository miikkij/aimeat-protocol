/**
 * @file skill-bundle.ts
 * @description Download and cache the agent's skill bundle ZIP.
 * @structure Fetches the authenticated skill bundle archive, stores the ZIP, and extracts its files locally.
 * @usage Called after `aimeat connect` auth and by `aimeat connect refresh`.
 * @version-history v1.9.4 — 2026-05-28 — Close one-shot CLI HTTP connections after bundle downloads.
 * @version-history v1.9.5 — 2026-05-28 — Extract the real SKILL.md and bundle files from the downloaded ZIP.
 * @version-history v1.9.6 — 2026-05-28 — Print a bundle-provided BUNDLE.md guide after downloads.
 * @version-history v1.9.7 — 2026-05-28 — Clarify serve-next and Hello Integration MCP sequence.
 * @version-history v1.9.8 — 2026-05-28 — Include task TODO completion in Hello Integration guidance.
 * @version-history v1.9.9 — 2026-05-28 — Clarify MCP tool names are not terminal commands.
 * @version-history v1.9.10 — 2026-05-28 — Include required telemetry reporting in Hello Integration guidance.
 * @version-history v1.9.11 — 2026-05-28 — State that Hello Integration is required first-run onboarding.
 * @version-history v1.9.12 -- 2026-05-28 -- Add correct post-onboarding setup guidance for actual commands, config, and knowledge artifacts.
 * @version-history v1.9.13 -- 2026-05-28 -- Add shared owner-memory tag guidance.
 * @version-history v1.9.14 -- 2026-05-28 -- Pull MCP tool sequence from shared onboarding-prompt.ts (removes hardcoded duplicate).
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import yauzl from 'yauzl';
import { getConfigDir } from './config.js';
import type { AimeatClient } from './api-client.js';
import { HELLO_INTEGRATION_TOOL_SEQUENCE } from './onboarding-prompt.js';

export interface DownloadedSkillBundle {
  bundleDir: string;
  zipPath: string;
  skillPath: string;
  guidePath: string;
  extractedFiles: string[];
}

interface ExtractedSkillBundle {
  skillPath: string;
  guidePath: string | null;
  extractedFiles: string[];
}

const MAX_EXTRACTED_FILES = 100;
const MAX_EXTRACTED_BYTES = 20 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 5 * 1024 * 1024;
const MANAGED_EXTRACTED_PATHS = ['SKILL.md', 'BUNDLE.md', 'references', 'scripts', 'config'];

function clearExtractedBundle(bundleDir: string): void {
  for (const relativePath of MANAGED_EXTRACTED_PATHS) {
    rmSync(join(bundleDir, relativePath), { recursive: true, force: true });
  }
}

function normalizeBundleEntry(fileName: string): string | null {
  const normalized = fileName.replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) return null;
  if (normalized.startsWith('/') || normalized.includes('../') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Unsafe bundle path: ${fileName}`);
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0 || parts.includes('..')) throw new Error(`Unsafe bundle path: ${fileName}`);
  if (parts.length > 1 && /^aimeat-[a-z0-9-]+$/i.test(parts[0])) parts.shift();
  return parts.join('/');
}

async function extractSkillBundle(buffer: Buffer, bundleDir: string): Promise<ExtractedSkillBundle> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (openError, zipfile) => {
      if (openError) { reject(openError); return; }
      if (!zipfile) { reject(new Error('Could not open skill bundle ZIP')); return; }

      let fileCount = 0;
      let extractedBytes = 0;
      let skillPath: string | null = null;
      let guidePath: string | null = null;
      const extractedFiles: string[] = [];

      zipfile.on('error', reject);
      zipfile.on('entry', (entry: yauzl.Entry) => {
        let relativePath: string | null;
        try {
          relativePath = normalizeBundleEntry(entry.fileName);
        } catch (pathError) {
          zipfile.close();
          reject(pathError);
          return;
        }

        if (!relativePath) {
          zipfile.readEntry();
          return;
        }

        fileCount += 1;
        if (fileCount > MAX_EXTRACTED_FILES) {
          zipfile.close();
          reject(new Error(`Skill bundle contains more than ${MAX_EXTRACTED_FILES} files`));
          return;
        }
        if (entry.uncompressedSize > MAX_SINGLE_FILE_BYTES) {
          zipfile.close();
          reject(new Error(`Skill bundle file is too large: ${entry.fileName}`));
          return;
        }

        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError) { zipfile.close(); reject(streamError); return; }
          if (!stream) { zipfile.close(); reject(new Error(`Could not read bundle file: ${entry.fileName}`)); return; }

          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => {
            extractedBytes += chunk.length;
            if (extractedBytes > MAX_EXTRACTED_BYTES) {
              zipfile.close();
              reject(new Error('Skill bundle extracted size limit exceeded'));
              return;
            }
            chunks.push(chunk);
          });
          stream.on('end', () => {
            const outputPath = join(bundleDir, relativePath);
            mkdirSync(dirname(outputPath), { recursive: true });
            writeFileSync(outputPath, Buffer.concat(chunks));
            extractedFiles.push(relativePath);
            if (relativePath === 'SKILL.md') skillPath = outputPath;
            if (relativePath === 'BUNDLE.md') guidePath = outputPath;
            zipfile.readEntry();
          });
          stream.on('error', (streamReadError) => { zipfile.close(); reject(streamReadError); });
        });
      });

      zipfile.on('end', () => {
        if (!skillPath) {
          reject(new Error('Skill bundle ZIP did not contain SKILL.md'));
          return;
        }
        resolve({ skillPath, guidePath, extractedFiles });
      });
      zipfile.readEntry();
    });
  });
}

function renderCompatibilityBundleGuide(client: AimeatClient, agentName: string, extractedFiles: string[]): string {
  const hasReferences = extractedFiles.some(file => file.startsWith('references/'));
  const hasScripts = extractedFiles.some(file => file.startsWith('scripts/'));
  const hasConfig = extractedFiles.some(file => file.startsWith('config/'));
  const sections = [
    '- `BUNDLE.md` - this guide. Newer nodes include it in the ZIP; this connector generated it for an older bundle.',
    '- `SKILL.md` - the main instruction file for the connected agent/runtime. Read this first.',
  ];
  if (hasReferences) sections.push('- `references/` - deeper protocol notes: API overview, task lifecycle, messages, telemetry, capabilities, and errors.');
  if (hasScripts) sections.push('- `scripts/` - runtime helper scripts for platforms that support them.');
  if (hasConfig) sections.push('- `config/` - runtime configuration snippets, hooks, or routes for platforms that support local config files.');

  return `# AIMEAT Skill Bundle

## What This Is

This folder contains the local AIMEAT skill bundle for agent \`${agentName}\` from ${client.getBaseUrl()}. If you are the connected AI agent using this runtime, \`${agentName}\` is your assigned AIMEAT agent name.

When downloaded with the connector, the original ZIP is kept as \`skill-bundle.zip\` and the useful files are extracted into the same directory.

## Files

${sections.join('\n')}

## What To Do Next

There are two ways to drive Hello Integration:

### Option A -- MCP stdio (recommended when supported)

1. Start the connector MCP server and leave it running:

   \`\`\`bash
   aimeat connect serve
   \`\`\`

2. Once the MCP server is attached to the connected AI agent/runtime (Claude
   Desktop, MCP-aware IDEs, OpenClaw with mcp config, etc.), paste this into
   the agent:

   \`\`\`text
  Use your AIMEAT tools. Hello Integration is required AIMEAT first-run onboarding. Read the AIMEAT handbook, check onboarding status, propose TODOs for the onboarding verification task, complete Hello Integration, then publish your actual supported commands, runtime configuration, and any produced knowledge package artifacts before normal autonomous work.
   \`\`\`

### Option B -- Shell fallback (when MCP stdio cannot attach)

For CLI-only agents or runtimes where \`aimeat connect serve\` would just block
without exposing tools, every MCP tool is callable directly as a one-shot
command. Walk through the same sequence with:

\`\`\`bash
aimeat connect tools                              # list available tool names
aimeat connect schema <tool-name>                 # inspect a tool's input
aimeat connect call <tool-name> --json '<input>'  # invoke a tool
\`\`\`

Start with: \`aimeat connect call aimeat_handbook_get --json '{}'\`

### The Hello Integration sequence

The agent must complete these tools in order. Names are MCP tool names (also
accepted by \`aimeat connect call <name>\`):

  \`\`\`text
${HELLO_INTEGRATION_TOOL_SEQUENCE.map(tool => `  ${tool}`).join('\n')}
  \`\`\`

Use \`generic\` as the installed skill platform unless your runtime has a more specific platform name. For the bundle version field, use \`local\` when no version is shown by the runtime.

4. After Hello Integration completes, publish real post-onboarding setup:

  - Commands: write \`agents.${agentName}.commands\` with the full owner-facing slash command catalogue this agent can actually handle. Use a flat array of \`{ name, description, category }\`. Do not copy examples or list internal MCP tools as message commands.
  - Config: write actual runtime/config artifacts under \`agents.config.*\`. If this setup only uses \`aimeat connect serve\`, describe that connector accurately; do not invent a watchdog file.
  - Shared memory: if the owner assigned shared tags in Data Access/directives, use \`agents.tag.<tag>.*\` with visibility \`owner\` and tags \`["<tag>"]\` for same-owner handoff notes, project state, queues, and team context. List shared areas with \`owner_scope=true\` plus prefix \`agents.tag.<tag>.\`.
  - Knowledge: when you produce research, docs, datasets, or reusable knowledge, create or update a real knowledge package with \`POST /v1/knowledge/import\` from \`/llms.txt\`, \`aimeat_knowledge_contribute\`, and \`aimeat_storage_upload\` as appropriate. Do not use a placeholder \`research.*\` memory key as a substitute.

5. Run \`npx aimeat connect refresh\` later to download updated bundle content.
`;
}

export function readSkillBundleGuide(bundle: DownloadedSkillBundle): string {
  return readFileSync(bundle.guidePath, 'utf-8').trim();
}

export async function downloadSkillBundle(client: AimeatClient, agentName: string): Promise<DownloadedSkillBundle> {
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
  clearExtractedBundle(bundleDir);
  const extracted = await extractSkillBundle(buffer, bundleDir);
  let guidePath = extracted.guidePath;
  if (!guidePath) {
    guidePath = join(bundleDir, 'BUNDLE.md');
    writeFileSync(guidePath, renderCompatibilityBundleGuide(client, agentName, extracted.extractedFiles), 'utf-8');
    extracted.extractedFiles.unshift('BUNDLE.md');
  }
  return { bundleDir, zipPath, skillPath: extracted.skillPath, guidePath, extractedFiles: extracted.extractedFiles };
}
