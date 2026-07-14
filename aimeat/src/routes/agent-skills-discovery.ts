/**
 * @file agent-skills-discovery.ts
 * @description Agent Skills discovery index (Agent Skills Discovery RFC v0.2.0,
 *   github.com/cloudflare/agent-skills-discovery-rfc / agentskills.io): serves
 *   /.well-known/agent-skills/index.json enumerating the node-scope skills that are
 *   anonymously readable (visibility 'public'), each with a resolvable SKILL.md URL and a
 *   sha256 digest of its exact bytes. The index is GENERATED from the skills registry
 *   (services/skills.ts) — never hand-maintained — and every read goes through
 *   resolveSkillRef, the registry's single access-control choke point, with an anonymous
 *   accessor, so members-only node skills can never leak into the public index.
 * @structure
 *   - GET /.well-known/agent-skills/index.json      — the discovery index ($schema + skills[])
 *   - GET /.well-known/agent-skills/:name/SKILL.md  — the canonical SKILL.md the digest covers
 *   - buildIndex() — registry scan -> RFC entries (name, type, description, url, digest)
 * @usage
 *   import { agentSkillsDiscoveryRouter } from '../routes/agent-skills-discovery.js';
 *   app.use(agentSkillsDiscoveryRouter(config, storage));  // next to wellknownRouter
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial: Agent Skills Discovery RFC v0.2.0 index + SKILL.md serving
 */
import { Router } from 'express';
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { listSkills, resolveSkillRef, SkillAccessError, type SkillAccessor } from '../services/skills.js';
import { SKILL_NAME_RE } from '../services/skill-md.js';
import { cached, TTL } from '../services/cache.js';
import { logger } from '../utils/logger.js';

/** Schema URI pinning the RFC version this index conforms to. */
const INDEX_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

/** RFC name constraint (stricter than SKILL_NAME_RE: no consecutive hyphens). */
const RFC_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** RFC cap on a skill entry's description. */
const DESCRIPTION_MAX = 1024;

/** The index is public by definition — every registry read uses the anonymous accessor,
 *  so the mayRead gate admits only node-scope skills with visibility 'public'. */
const ANONYMOUS: SkillAccessor = { ownerName: null };

interface AgentSkillsIndexEntry {
  name: string;
  type: 'skill-md';
  description: string;
  url: string;
  digest: string;
}

/** Enumerate the public node-scope skills into RFC v0.2.0 index entries. */
async function buildIndex(
  config: AimeatConfig, storage: Storage,
): Promise<{ $schema: string; skills: AgentSkillsIndexEntry[] }> {
  const summaries = await listSkills(storage, config, 'node', ANONYMOUS);
  const skills: AgentSkillsIndexEntry[] = [];
  for (const summary of summaries) {
    if (!RFC_NAME_RE.test(summary.name) || summary.name.length > 64) {
      logger.warn('Agent Skills index: name violates the RFC constraint, skipping', { name: summary.name });
      continue;
    }
    let skillMd: string | undefined;
    try {
      const resolved = await resolveSkillRef(storage, config, `node:${summary.name}`, ANONYMOUS);
      skillMd = resolved.fileContents['SKILL.md'];
    } catch {
      continue; // gate or race — a skill we cannot serve anonymously is not indexed
    }
    if (typeof skillMd !== 'string' || skillMd.length === 0) continue;
    skills.push({
      name: summary.name,
      type: 'skill-md',
      description: summary.description.slice(0, DESCRIPTION_MAX),
      url: `${config.baseUrl}/.well-known/agent-skills/${summary.name}/SKILL.md`,
      digest: `sha256:${createHash('sha256').update(skillMd, 'utf8').digest('hex')}`,
    });
  }
  return { $schema: INDEX_SCHEMA, skills };
}

export function agentSkillsDiscoveryRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // The discovery index. Cached with the generic cache layer: a registry write emits
  // emitChange('skills') which invalidates the 'domain:skills' tag (routes-loader wiring),
  // so publishes/deletes reflect immediately; the TTL is only the backstop.
  router.get('/.well-known/agent-skills/index.json', async (_req, res) => {
    try {
      const index = await cached(
        'agent-skills:index', TTL.catalogue,
        () => buildIndex(config, storage),
        ['domain:skills'],
      );
      res.set('Cache-Control', 'max-age=300');
      res.json(index);
    } catch (err) {
      logger.error('Agent Skills index failed', { error: (err as Error).message });
      res.status(500).json({ error: 'Failed to build the Agent Skills index' });
    }
  });

  // The canonical SKILL.md a digest covers — served byte-for-byte as text/markdown so
  // sha256(response body) always equals the index entry's digest. FORBIDDEN collapses to
  // 404: the existence of a members-only node skill is not disclosed to anonymous callers.
  router.get('/.well-known/agent-skills/:name/SKILL.md', async (req, res) => {
    const name = req.params.name as string;
    if (!SKILL_NAME_RE.test(name)) {
      res.status(404).json({ error: `No such skill: ${name}` });
      return;
    }
    try {
      const skillMd = await cached(
        `agent-skills:md:${name}`, TTL.catalogue,
        async () => {
          const resolved = await resolveSkillRef(storage, config, `node:${name}`, ANONYMOUS);
          const content = resolved.fileContents['SKILL.md'];
          if (typeof content !== 'string' || content.length === 0) {
            throw new SkillAccessError('NOT_FOUND', `Skill has no SKILL.md: ${name}`);
          }
          return content;
        },
        ['domain:skills'],
      );
      res.set('Cache-Control', 'max-age=300');
      res.type('text/markdown; charset=utf-8').send(skillMd);
    } catch (err) {
      if (err instanceof SkillAccessError) {
        res.status(404).json({ error: `No such skill: ${name}` });
        return;
      }
      logger.error('Agent Skills SKILL.md failed', { name, error: (err as Error).message });
      res.status(500).json({ error: 'Failed to load the skill' });
    }
  });

  return router;
}
