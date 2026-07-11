/**
 * @file skill-install.ts
 * @description `aimeat skill install <ref>` — fetch a skill from an AIMEAT node's skills
 *   registry and materialize it as a local Anthropic agent skill (the SKILL.md contract is
 *   the same format), so Claude Code / Claude Desktop Cowork pick it up natively.
 *
 *   Target directory: --dir <path> wins; --project → ./.claude/skills; default
 *   ~/.claude/skills. Auth: --node <url> [--token <jwt>] for an explicit node, --agent <name>
 *   for a specific connector agent, else the connector's primary config (~/.aimeat).
 *   Provenance (`metadata.aimeat_ref` + `metadata.aimeat_node`) is stamped into the local
 *   SKILL.md frontmatter so `install` can later detect updates (a re-run overwrites).
 * @structure runSkillInstall(ref, flags) — the CLI entry (wired in src/index.ts)
 * @usage
 *   aimeat skill install node:manage-my-agents
 *   aimeat skill install user:alice/style@1.0.2 --project
 *   aimeat skill install ws:ORG/WS/team-style --dir C:\\skills
 * @version-history
 *   v1.0.0 -- 2026-07-06 -- Initial (Skills feature — local install for Claude Code/Desktop)
 */
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { isAllowedSkillPath } from '../services/skill-md.js';

interface ResolvedSkillPayload {
  ref: string;
  name: string;
  description: string;
  version: string;
  files: Array<{ path: string; size: number }>;
  fileContents: Record<string, string>;
}

const NODE_REF = /^node:([a-z0-9-]+(?:@\d+\.\d+\.\d+)?)$/;
const USER_REF = /^user:([a-z0-9_-]+)\/([a-z0-9-]+(?:@\d+\.\d+\.\d+)?)$/;
const WS_REF = /^ws:([A-Za-z0-9-]+)\/([A-Za-z0-9-]+)\/([a-z0-9-]+(?:@\d+\.\d+\.\d+)?)$/;

/** Decompose a ref (or bare name) into the REST resolve path. */
function refToPath(ref: string): string | null {
  let m = ref.match(NODE_REF);
  if (m) return `/v1/skills/${encodeURIComponent(m[1])}?scope=node`;
  m = ref.match(USER_REF);
  if (m) return `/v1/skills/${encodeURIComponent(m[2])}?scope=user&owner=${encodeURIComponent(m[1])}`;
  m = ref.match(WS_REF);
  if (m) return `/v1/skills/${encodeURIComponent(m[3])}?scope=workspace&organism=${encodeURIComponent(m[1])}&ws=${encodeURIComponent(m[2])}`;
  if (/^[a-z0-9-]+(?:@\d+\.\d+\.\d+)?$/.test(ref)) return `/v1/skills/${encodeURIComponent(ref)}`;
  return null;
}

/** Stamp aimeat_ref + aimeat_node into the SKILL.md frontmatter metadata (textual — keeps the
 *  author's formatting; the two keys are free-form metadata per the contract). */
export function stampProvenance(skillMd: string, pinnedRef: string, nodeUrl: string): string {
  const m = skillMd.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/);
  if (!m) return skillMd;   // malformed — write verbatim, the node validated it anyway
  let fm = m[2];
  const upsert = (key: string, value: string) => {
    const line = new RegExp(`^(\\s{2,})${key}:.*$`, 'm');
    if (line.test(fm)) fm = fm.replace(line, `$1${key}: ${value}`);
    else if (/^metadata:\s*$/m.test(fm)) fm = fm.replace(/^metadata:\s*$/m, `metadata:\n  ${key}: ${value}`);
    else fm = `${fm}\nmetadata:\n  ${key}: ${value}`;
  };
  upsert('aimeat_ref', pinnedRef);
  upsert('aimeat_node', nodeUrl);
  return `${m[1]}${fm}${m[3]}${m[4]}`;
}

export async function runSkillInstall(ref: string | undefined, flags: Record<string, string>): Promise<void> {
  if (!ref) {
    console.error('Usage: aimeat skill install <ref> [--dir <path>] [--project] [--agent <name>] [--node <url> [--token <jwt>]]');
    console.error('  <ref>: node:{name} | user:{owner}/{name} | ws:{org}/{ws}/{name} | bare name — all accept @{semver} pins');
    process.exitCode = 1;
    return;
  }
  const path = refToPath(ref);
  if (!path) {
    console.error(`Not a valid skill ref: ${ref}`);
    process.exitCode = 1;
    return;
  }

  try {
    const { AimeatClient } = await import('./connect/api-client.js');
    let client: InstanceType<typeof AimeatClient>;
    let nodeUrl: string;
    if (flags.node) {
      client = new AimeatClient(flags.node.replace(/\/+$/, ''), flags.token ?? '');
      nodeUrl = flags.node.replace(/\/+$/, '');
    } else if (flags.agent) {
      const { loadAgentByName } = await import('./connect/config.js');
      const loaded = await loadAgentByName(flags.agent, flags.owner || undefined);
      if (!loaded) throw new Error(`Agent "${flags.agent}" not found in connector. Run: aimeat connect list`);
      client = new AimeatClient(loaded.config.node_url, loaded.token);
      nodeUrl = loaded.config.node_url;
    } else {
      client = await AimeatClient.fromConfig();
      nodeUrl = client.getBaseUrl();
    }

    const resp = await client.get(path);
    if (!resp.ok) {
      const err = resp.error as { message?: string; code?: string } | undefined;
      throw new Error(`Fetch failed: ${err?.code ?? ''} ${err?.message ?? JSON.stringify(resp)}`);
    }
    const skill = (resp.data as { skill?: ResolvedSkillPayload })?.skill;
    if (!skill?.fileContents?.['SKILL.md']) throw new Error('Node returned no skill content');

    const baseDir = flags.dir
      ? resolve(flags.dir)
      : flags.project
        ? join(process.cwd(), '.claude', 'skills')
        : join(homedir(), '.claude', 'skills');
    const skillDir = join(baseDir, skill.name);

    // Fresh install semantics: clear a pre-existing directory so removed files don't linger.
    if (existsSync(skillDir) && readdirSync(skillDir).length) rmSync(skillDir, { recursive: true, force: true });

    const pinnedRef = /@\d+\.\d+\.\d+$/.test(skill.ref) ? skill.ref : `${skill.ref}@${skill.version}`;
    let written = 0;
    for (const [relPath, content] of Object.entries(skill.fileContents)) {
      if (!isAllowedSkillPath(relPath)) {
        console.error(`Skipping unexpected path from node: ${relPath}`);
        continue;
      }
      const target = join(skillDir, relPath);
      mkdirSync(dirname(target), { recursive: true });
      const body = relPath === 'SKILL.md' ? stampProvenance(content, pinnedRef, nodeUrl) : content;
      writeFileSync(target, body, 'utf-8');
      written++;
    }

    console.log(`✓ Installed ${skill.ref} v${skill.version} (${written} file${written === 1 ? '' : 's'})`);
    console.log(`  → ${skillDir}`);
    console.log('  Claude Code / Desktop Cowork discover it automatically. Re-run to update.');
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
