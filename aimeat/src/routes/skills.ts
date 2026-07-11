/**
 * @file skills.ts
 * @description REST surface of the skills registry (dedicated system — NOT knowledge packages).
 *   Registry CRUD on /v1/skills (node + user scopes) and the agent attachment surface on
 *   /v1/agents/:name/skills — the read the crewaimeat connector consumes to materialize an
 *   agent's linked skills (SkillRefs resolved to manifest + file bodies). All access decisions
 *   delegate to services/skills.ts (resolveSkillRef is the single choke point).
 * @structure
 *   - GET    /v1/skills                — list: library (node + own user), or one scope
 *   - POST   /v1/skills                — publish/update a skill (inline SKILL.md + files)
 *   - GET    /v1/skills/:name          — resolve one skill (scope/owner via query)
 *   - DELETE /v1/skills/:name          — delete (own user skill; node scope = operator)
 *   - GET    /v1/agents/:name/skills   — an agent's linked skills, resolved (owner or self agent)
 *   - POST   /v1/agents/:name/skills   — link a skill to an agent (owner, or same-owner agent)
 *   - DELETE /v1/agents/:name/skills   — unlink (owner, or same-owner agent)
 * @usage
 *   import { skillsRouter } from '../routes/skills.js';
 *   app.use(skillsRouter(config, storage));
 * @version-history
 *   v1.1.0 -- 2026-07-06 -- GET /v1/skills/:name/zip — upload-ready skill ZIP ({name}/SKILL.md …)
 *     for claude.ai skill uploads and manual installs into ~/.claude/skills; supports @semver pins.
 *   v1.0.0 -- 2026-07-05 -- Initial: Phase 2a registry REST surface (node + user scopes).
 */
import { Router, type Response } from 'express';
import { ZipArchive } from 'archiver';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';
import { SkillValidationError } from '../services/skill-md.js';
import {
  publishSkill, deleteSkill, listSkills, listSkillLibrary, resolveSkillRef,
  getAgentSkillLinks, linkSkillToAgent, unlinkSkillFromAgent, resolveAgentSkills,
  listSkillsByBinding, SkillAccessError, type SkillAccessor, type SkillScope,
} from '../services/skills.js';

export function skillsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Caller identity for the read gate — anonymous sessions carry no owner. sub/gaii feed
   *  the workspace membership gate (canReadWorkspace). */
  function accessorOf(req: Express.Request): SkillAccessor {
    const auth = req.auth as (typeof req.auth & { anonymous?: boolean }) | undefined;
    if (!auth || auth.anonymous === true) return { ownerName: null };
    return {
      ownerName: (auth.owner as string) ?? null,
      isOperator: (auth.roles as string[]).includes('operator'),
      sub: auth.sub as string,
      gaii: resolveIdentity(req.auth!, config.nodeId),
    };
  }

  /** Anon-mode injects a truthy shared identity — never treat it as an owner/agent. */
  function isAnonymous(req: Express.Request): boolean {
    return (req.auth as { anonymous?: boolean } | undefined)?.anonymous === true;
  }

  function sendSkillError(res: Response, err: unknown): void {
    if (err instanceof SkillValidationError) {
      res.status(422).json(error(config.nodeId, 'SKILL_INVALID', err.message, 422, { code: err.code }));
      return;
    }
    if (err instanceof SkillAccessError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400;
      res.status(status).json(error(config.nodeId, err.code, err.message));
      return;
    }
    logger.error('Skills route failed', { error: (err as Error).message, stack: (err as Error).stack });
    res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Skill operation failed'));
  }

  /* ── GET /v1/skills — list the library (default) or one scope. Manifests only, no bodies. ── */
  router.get('/v1/skills', requireAuth(), async (req, res) => {
    try {
      const accessor = accessorOf(req);
      // 2d: ?binding=app:{owner}/{filename} — skills bound to one app, across scopes.
      if (typeof req.query.binding === 'string') {
        const skills = await listSkillsByBinding(storage, config, req.query.binding, accessor);
        res.json(success(config.nodeId, { binding: req.query.binding, skills }));
        return;
      }
      const scope = (req.query.scope as string) ?? 'library';
      if (scope === 'library') {
        const library = await listSkillLibrary(storage, config, accessor);
        res.json(success(config.nodeId, { library }));
        return;
      }
      if (scope !== 'node' && scope !== 'user' && scope !== 'workspace') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'scope must be library, node, user, or workspace'));
        return;
      }
      if (scope === 'workspace' && (!req.query.organism || !req.query.ws)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'workspace scope requires organism and ws query params'));
        return;
      }
      const owner = (req.query.owner as string) ?? accessor.ownerName ?? undefined;
      const wsTarget = scope === 'workspace'
        ? { org: req.query.organism as string, ws: req.query.ws as string }
        : undefined;
      const skills = await listSkills(storage, config, scope as SkillScope, accessor, owner, wsTarget);
      res.json(success(config.nodeId, { scope, skills }));
    } catch (err) {
      sendSkillError(res, err);
    }
  });

  /* ── POST /v1/skills — publish or update. Body: { skill_md, files?, scope?, visibility? } ── */
  router.post('/v1/skills', requireAuth(), async (req, res) => {
    try {
      const accessor = accessorOf(req);
      if (!accessor.ownerName) {
        res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Authentication required'));
        return;
      }
      const { skill_md, files: extraFiles, scope: scopeRaw, visibility, organism, ws } = req.body ?? {};
      const scope: SkillScope = scopeRaw === 'node' ? 'node' : scopeRaw === 'workspace' ? 'workspace' : 'user';
      if (scope === 'node' && !accessor.isOperator) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Node-scope skills are operator-managed'));
        return;
      }
      if (scope === 'workspace' && (typeof organism !== 'string' || typeof ws !== 'string')) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'workspace scope requires organism and ws in the body'));
        return;
      }
      if (typeof skill_md !== 'string' || skill_md.length === 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'skill_md (the SKILL.md content) is required'));
        return;
      }
      if (visibility !== undefined && !['owner', 'members', 'public'].includes(visibility)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility must be owner, members, or public'));
        return;
      }
      const files = new Map<string, string>([['SKILL.md', skill_md]]);
      if (extraFiles && typeof extraFiles === 'object' && !Array.isArray(extraFiles)) {
        for (const [path, content] of Object.entries(extraFiles as Record<string, unknown>)) {
          if (typeof content !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `files["${path}"] must be a string`));
            return;
          }
          files.set(path, content);
        }
      }
      const summary = await publishSkill(storage, config, {
        scope,
        owner: accessor.ownerName,
        publisher: req.auth!.sub as string,
        files,
        visibility: visibility as 'owner' | 'members' | 'public' | undefined,
        ...(scope === 'workspace' ? { organismId: organism, workspaceId: ws, accessor } : {}),
      });
      emitChange('skills');
      res.status(201).json(success(config.nodeId, { skill: summary }, [
        { description: 'Resolve this skill', method: 'GET', url: `/v1/skills/${summary.name}?scope=${summary.scope}` },
      ]));
    } catch (err) {
      sendSkillError(res, err);
    }
  });

  /* ── GET /v1/skills/:name — resolve one skill. Query: scope (user|node), owner, manifest_only ── */
  router.get('/v1/skills/:name', requireAuth(), async (req, res) => {
    try {
      const name = req.params.name as string;
      const accessor = accessorOf(req);
      const manifestOnly = req.query.manifest_only === 'true';
      const scopeQ = req.query.scope as string | undefined;
      const ownerQ = (req.query.owner as string | undefined) ?? accessor.ownerName ?? undefined;

      const refs: string[] = [];
      if (scopeQ === 'node') refs.push(`node:${name}`);
      else if (scopeQ === 'user') refs.push(`user:${ownerQ}/${name}`);
      else if (scopeQ === 'workspace') {
        const org = req.query.organism as string | undefined;
        const wsId = req.query.ws as string | undefined;
        if (!org || !wsId) {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'workspace scope requires organism and ws query params'));
          return;
        }
        refs.push(`ws:${org}/${wsId}/${name}`);
      } else {
        // Unscoped lookup: the caller's own registry first, then the node library.
        if (ownerQ) refs.push(`user:${ownerQ}/${name}`);
        refs.push(`node:${name}`);
      }

      let lastErr: unknown = new SkillAccessError('NOT_FOUND', `Skill not found: ${name}`);
      for (const ref of refs) {
        try {
          const skill = await resolveSkillRef(storage, config, ref, accessor, { manifestOnly });
          res.json(success(config.nodeId, { skill }));
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      sendSkillError(res, lastErr);
    } catch (err) {
      sendSkillError(res, err);
    }
  });

  /* ── GET /v1/skills/:name/zip — download a skill as a ZIP (dir layout: {name}/SKILL.md …).
   *    The ZIP is upload-ready for claude.ai's skill upload and for manual installs into
   *    ~/.claude/skills. Same addressing as the resolve route; the :name segment may carry
   *    an @semver pin ({name}@1.0.2 → the retained snapshot). ── */
  router.get('/v1/skills/:name/zip', requireAuth(), async (req, res) => {
    try {
      const nameParam = req.params.name as string;
      const accessor = accessorOf(req);
      const scopeQ = req.query.scope as string | undefined;
      const ownerQ = (req.query.owner as string | undefined) ?? accessor.ownerName ?? undefined;

      const refs: string[] = [];
      if (scopeQ === 'node') refs.push(`node:${nameParam}`);
      else if (scopeQ === 'user') refs.push(`user:${ownerQ}/${nameParam}`);
      else if (scopeQ === 'workspace') {
        const org = req.query.organism as string | undefined;
        const wsId = req.query.ws as string | undefined;
        if (!org || !wsId) {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'workspace scope requires organism and ws query params'));
          return;
        }
        refs.push(`ws:${org}/${wsId}/${nameParam}`);
      } else {
        if (ownerQ) refs.push(`user:${ownerQ}/${nameParam}`);
        refs.push(`node:${nameParam}`);
      }

      let skill = null;
      let lastErr: unknown = new SkillAccessError('NOT_FOUND', `Skill not found: ${nameParam}`);
      for (const ref of refs) {
        try { skill = await resolveSkillRef(storage, config, ref, accessor); break; }
        catch (err) { lastErr = err; }
      }
      if (!skill) { sendSkillError(res, lastErr); return; }

      const bareName = skill.name;   // pin stripped — the wrapper dir must equal the skill name
      const archive = new ZipArchive({ zlib: { level: 6 } });
      const chunks: Buffer[] = [];
      archive.on('data', (c: Buffer) => chunks.push(c));
      archive.on('end', () => {
        const buffer = Buffer.concat(chunks);
        res.set({
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${bareName}.zip"`,
          'Content-Length': String(buffer.length),
          'X-Skill-Ref': skill!.ref,
          'X-Skill-Version': skill!.version,
        });
        res.send(buffer);
      });
      archive.on('error', (err: Error) => {
        res.status(500).json(error(config.nodeId, 'ZIP_ERROR', `Failed to build skill ZIP: ${err.message}`));
      });
      for (const [path, content] of Object.entries(skill.fileContents)) {
        archive.append(content, { name: `${bareName}/${path}` });
      }
      await archive.finalize();
    } catch (err) {
      sendSkillError(res, err);
    }
  });

  /* ── DELETE /v1/skills/:name — own user skill, or node scope for operators ── */
  router.delete('/v1/skills/:name', requireAuth(), async (req, res) => {
    try {
      const name = req.params.name as string;
      const accessor = accessorOf(req);
      if (!accessor.ownerName) {
        res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Authentication required'));
        return;
      }
      const scope: SkillScope = req.query.scope === 'node' ? 'node' : req.query.scope === 'workspace' ? 'workspace' : 'user';
      if (scope === 'node' && !accessor.isOperator) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Node-scope skills are operator-managed'));
        return;
      }
      const deleted = await deleteSkill(storage, config, scope, name, {
        owner: accessor.ownerName ?? undefined,
        ...(scope === 'workspace' ? { org: req.query.organism as string, ws: req.query.ws as string, accessor } : {}),
      });
      if (!deleted) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Skill not found: ${name}`));
        return;
      }
      emitChange('skills');
      res.json(success(config.nodeId, { deleted: true, name, scope }));
    } catch (err) {
      sendSkillError(res, err);
    }
  });

  /* ── GET /v1/agents/:name/skills — linked skills, resolved (the crewaimeat consumer read) ── */
  router.get('/v1/agents/:name/skills', requireAuth(), async (req, res) => {
    try {
      if (isAnonymous(req)) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Authentication required'));
        return;
      }
      const agentName = req.params.name as string;
      const owner = req.auth!.owner as string;
      const roles = req.auth!.roles as string[];
      // Owner sessions may read any of their agents; an agent may read only itself.
      if (roles.includes('agent') && !roles.includes('owner')) {
        const sub = req.auth!.sub as string;
        if (!sub.startsWith(`${agentName}#`)) {
          res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Agents may only read their own skills'));
          return;
        }
      }
      const manifestOnly = req.query.manifest_only === 'true';
      const { skills, unresolved } = await resolveAgentSkills(storage, config, owner, agentName, { manifestOnly });
      res.json(success(config.nodeId, { agent: agentName, skills, unresolved }));
    } catch (err) {
      sendSkillError(res, err);
    }
  });

  /* ── POST /v1/agents/:name/skills — link a skill. Owner sessions, or agents acting for
   *    their owner (links always target agents under req.auth.owner). Body: { ref } ── */
  router.post('/v1/agents/:name/skills', requireAuth(), async (req, res) => {
    try {
      if (isAnonymous(req)) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Authentication required'));
        return;
      }
      const agentName = req.params.name as string;
      const owner = req.auth!.owner as string;
      const ref = req.body?.ref;
      if (typeof ref !== 'string' || ref.length === 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ref is required (e.g. node:my-skill or user:alice/my-skill)'));
        return;
      }
      const links = await linkSkillToAgent(storage, config, owner, agentName, ref, req.auth!.sub as string);
      emitChange('skills', `${owner}@${config.nodeId}`);
      res.json(success(config.nodeId, { agent: agentName, links }));
    } catch (err) {
      sendSkillError(res, err);
    }
  });

  /* ── DELETE /v1/agents/:name/skills — unlink. Same access as link. Body or query: { ref } ── */
  router.delete('/v1/agents/:name/skills', requireAuth(), async (req, res) => {
    try {
      if (isAnonymous(req)) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Authentication required'));
        return;
      }
      const agentName = req.params.name as string;
      const owner = req.auth!.owner as string;
      const ref = req.body?.ref ?? req.query.ref;
      if (typeof ref !== 'string' || ref.length === 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ref is required'));
        return;
      }
      const links = await unlinkSkillFromAgent(storage, config, owner, agentName, ref);
      emitChange('skills', `${owner}@${config.nodeId}`);
      res.json(success(config.nodeId, { agent: agentName, links }));
    } catch (err) {
      sendSkillError(res, err);
    }
  });

  /* ── 2d: GET /v1/apps/:owner/:filename/skills — registry skills bound to one app.
   *    Mounted before the apps router, so this wins over the greedy app-download route.
   *    Anonymous callers see only public-bound skills (the scope read gates apply). ── */
  router.get('/v1/apps/:owner/:filename/skills', requireAuth(), async (req, res) => {
    try {
      const ownerParam = req.params.owner as string;
      const owner = ownerParam.includes('@') ? ownerParam.split('@')[0] : ownerParam;
      const filename = req.params.filename as string;
      const binding = `app:${owner}/${filename}`;
      const skills = await listSkillsByBinding(storage, config, binding, accessorOf(req));
      res.json(success(config.nodeId, { binding, skills }));
    } catch (err) {
      sendSkillError(res, err);
    }
  });

  /* ── Expose current link records without resolution (cheap; used by UIs) ── */
  router.get('/v1/agents/:name/skills/links', requireAuth(), async (req, res) => {
    try {
      if (isAnonymous(req)) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Authentication required'));
        return;
      }
      const agentName = req.params.name as string;
      const owner = req.auth!.owner as string;
      const links = await getAgentSkillLinks(storage, config, owner, agentName);
      res.json(success(config.nodeId, { agent: agentName, links }));
    } catch (err) {
      sendSkillError(res, err);
    }
  });

  return router;
}
