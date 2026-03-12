import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { PROMPT_SEEDS } from '../services/prompt-defaults.js';
import { seedSystemPrompts } from '../services/prompt-seeder.js';

export function adminPromptsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/admin/prompts/reset-all — reset ALL prompts to factory defaults, clear version histories
  router.post('/v1/admin/prompts/reset-all', requireAuth(), requireRole('operator'), async (req, res) => {
    await storage.deleteAllSystemPrompts();
    await seedSystemPrompts(storage);
    const prompts = await storage.listSystemPrompts();
    res.json(success(config.nodeId, { prompts, resetCount: prompts.length }));
  });

  // GET /v1/admin/prompts — list all prompts
  router.get('/v1/admin/prompts', requireAuth(), requireRole('operator'), async (req, res) => {
    const group = req.query.group as string | undefined;
    const prompts = await storage.listSystemPrompts(group ? { group } : undefined);
    res.json(success(config.nodeId, { prompts }));
  });

  // GET /v1/admin/prompts/:id — get single prompt
  router.get('/v1/admin/prompts/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const prompt = await storage.getSystemPrompt(id);
    if (!prompt) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not found'));
    res.json(success(config.nodeId, { prompt }));
  });

  // PATCH /v1/admin/prompts/:id — update prompt
  router.patch('/v1/admin/prompts/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const existing = await storage.getSystemPrompt(id);
    if (!existing) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not found'));

    const { content, locales, active, changeNote } = req.body;

    // Validate content size (64 KB max)
    if (content !== undefined && Buffer.byteLength(content, 'utf8') > 65536) {
      return res.status(400).json(error(config.nodeId, 'CONTENT_TOO_LARGE', 'Prompt content must be under 64 KB'));
    }
    // Validate and sanitize locale overrides
    if (locales !== undefined) {
      // Strip empty keys and empty-string values (spec: empty override = absent)
      for (const lk of Object.keys(locales)) {
        if (!lk || (typeof locales[lk] === 'string' && locales[lk].length === 0)) {
          delete locales[lk];
        }
      }
      const localeKeys = Object.keys(locales);
      if (localeKeys.length > 10) {
        return res.status(400).json(error(config.nodeId, 'TOO_MANY_LOCALES', 'Maximum 10 locale overrides allowed'));
      }
      for (const lk of localeKeys) {
        if (typeof locales[lk] === 'string' && Buffer.byteLength(locales[lk], 'utf8') > 65536) {
          return res.status(400).json(error(config.nodeId, 'CONTENT_TOO_LARGE', `Locale "${lk}" content must be under 64 KB`));
        }
      }
    }

    const contentChanged = (content !== undefined && content !== existing.content) ||
                           (locales !== undefined && JSON.stringify(locales) !== JSON.stringify(existing.locales));

    const now = new Date().toISOString();
    const owner = req.auth!.owner;
    const newVersion = contentChanged ? existing.version + 1 : existing.version;

    const updated = await storage.upsertSystemPrompt({
      ...existing,
      ...(content !== undefined && { content }),
      ...(locales !== undefined && { locales }),
      ...(active !== undefined && { active }),
      version: newVersion,
      updatedAt: now,
      updatedBy: owner,
    });

    if (contentChanged) {
      await storage.createSystemPromptVersion({
        promptId: id,
        version: newVersion,
        content: updated.content,
        locales: updated.locales,
        changedBy: owner,
        changedAt: now,
        changeNote: changeNote as string | undefined,
      });
      await storage.pruneSystemPromptVersions(id, 50);
    }

    res.json(success(config.nodeId, { prompt: updated }));
  });

  // POST /v1/admin/prompts/:id/reset — reset to factory default
  router.post('/v1/admin/prompts/:id/reset', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const existing = await storage.getSystemPrompt(id);
    if (!existing) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not found'));

    const seed = PROMPT_SEEDS.find(s => s.id === id);
    if (!seed) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No factory default for this prompt'));

    const now = new Date().toISOString();
    const owner = req.auth!.owner;
    const newVersion = existing.version + 1;

    const updated = await storage.upsertSystemPrompt({
      ...existing,
      content: seed.content,
      locales: undefined,
      version: newVersion,
      updatedAt: now,
      updatedBy: owner,
    });

    await storage.createSystemPromptVersion({
      promptId: id,
      version: newVersion,
      content: seed.content,
      changedBy: owner,
      changedAt: now,
      changeNote: 'Reset to factory default',
    });
    await storage.pruneSystemPromptVersions(id, 50);

    res.json(success(config.nodeId, { prompt: updated }));
  });

  // GET /v1/admin/prompts/:id/versions — version history
  router.get('/v1/admin/prompts/:id/versions', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const prompt = await storage.getSystemPrompt(id);
    if (!prompt) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not found'));
    const versions = await storage.getSystemPromptVersions(id);
    res.json(success(config.nodeId, { versions }));
  });

  // GET /v1/admin/prompts/:id/versions/:version — specific version
  router.get('/v1/admin/prompts/:id/versions/:version', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const version = parseInt(req.params.version as string, 10);
    const record = await storage.getSystemPromptVersion(id, version);
    if (!record) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Version not found'));
    res.json(success(config.nodeId, { version: record }));
  });

  // POST /v1/admin/prompts/:id/versions/:version/restore — restore version
  router.post('/v1/admin/prompts/:id/versions/:version/restore', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const version = parseInt(req.params.version as string, 10);
    const existing = await storage.getSystemPrompt(id);
    if (!existing) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not found'));
    const oldVersion = await storage.getSystemPromptVersion(id, version);
    if (!oldVersion) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Version not found'));

    const now = new Date().toISOString();
    const owner = req.auth!.owner;
    const newVersion = existing.version + 1;

    const updated = await storage.upsertSystemPrompt({
      ...existing,
      content: oldVersion.content,
      locales: oldVersion.locales,
      version: newVersion,
      updatedAt: now,
      updatedBy: owner,
    });

    await storage.createSystemPromptVersion({
      promptId: id,
      version: newVersion,
      content: oldVersion.content,
      locales: oldVersion.locales,
      changedBy: owner,
      changedAt: now,
      changeNote: `Restored from version ${version}`,
    });
    await storage.pruneSystemPromptVersions(id, 50);

    res.json(success(config.nodeId, { prompt: updated }));
  });

  return router;
}
