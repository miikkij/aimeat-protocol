import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logger } from '../utils/logger.js';

export function adminPromptsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── GET /v1/admin/prompts — List all system prompts ──
  router.get('/v1/admin/prompts', requireAuth(), requireRole('operator'), async (_req, res) => {
    try {
      const prompts = await storage.listSystemPrompts();
      res.json(success(config.nodeId, { prompts, total: prompts.length }));
    } catch (err) {
      logger.error('Failed to list system prompts', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list system prompts'));
    }
  });

  // ── GET /v1/admin/prompts/:id/versions — List version history ──
  // (registered before /:id to avoid route conflicts)
  router.get('/v1/admin/prompts/:id/versions', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const id = req.params.id as string;

      const prompt = await storage.getSystemPrompt(id);
      if (!prompt) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Prompt "${id}" not found`));
        return;
      }

      const versions = await storage.listSystemPromptVersions(id);
      res.json(success(config.nodeId, { promptId: id, versions, total: versions.length }));
    } catch (err) {
      logger.error('Failed to list prompt versions', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list prompt versions'));
    }
  });

  // ── GET /v1/admin/prompts/:id/versions/:version — Get specific version ──
  router.get('/v1/admin/prompts/:id/versions/:version', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const id = req.params.id as string;
      const version = parseInt(req.params.version as string, 10);

      if (isNaN(version) || version < 1) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'version must be a positive integer'));
        return;
      }

      const record = await storage.getSystemPromptVersion(id, version);
      if (!record) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Version ${version} of prompt "${id}" not found`));
        return;
      }

      res.json(success(config.nodeId, { version: record }));
    } catch (err) {
      logger.error('Failed to get prompt version', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get prompt version'));
    }
  });

  // ── PUT /v1/admin/prompts/:id/activate/:version — Activate (rollback to) old version ──
  router.put('/v1/admin/prompts/:id/activate/:version', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const id = req.params.id as string;
      const targetVersion = parseInt(req.params.version as string, 10);

      if (isNaN(targetVersion) || targetVersion < 1) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'version must be a positive integer'));
        return;
      }

      const prompt = await storage.getSystemPrompt(id);
      if (!prompt) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Prompt "${id}" not found`));
        return;
      }

      const targetRecord = await storage.getSystemPromptVersion(id, targetVersion);
      if (!targetRecord) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Version ${targetVersion} of prompt "${id}" not found`));
        return;
      }

      // Rollback = new version with content from the target version
      const newVersion = prompt.version + 1;
      const now = new Date().toISOString();

      const updated: typeof prompt = {
        ...prompt,
        content: targetRecord.content,
        tags: targetRecord.tags,
        version: newVersion,
        updatedAt: now,
      };

      await storage.upsertSystemPrompt(updated);
      await storage.saveSystemPromptVersion({
        promptId: id,
        version: newVersion,
        content: targetRecord.content,
        tags: targetRecord.tags,
        savedBy: req.auth!.sub,
        savedAt: now,
      });

      logger.info(`Prompt "${id}" rolled back to v${targetVersion} as v${newVersion}`, { by: req.auth!.sub });

      res.json(success(config.nodeId, {
        prompt: updated,
        rolledBackFrom: targetVersion,
      }));
    } catch (err) {
      logger.error('Failed to activate prompt version', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to activate prompt version'));
    }
  });

  // ── GET /v1/admin/prompts/:id — Get specific prompt ──
  router.get('/v1/admin/prompts/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const id = req.params.id as string;

      const prompt = await storage.getSystemPrompt(id);
      if (!prompt) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Prompt "${id}" not found`));
        return;
      }

      res.json(success(config.nodeId, { prompt }));
    } catch (err) {
      logger.error('Failed to get system prompt', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get system prompt'));
    }
  });

  // ── PUT /v1/admin/prompts/:id — Update prompt (creates new version) ──
  router.put('/v1/admin/prompts/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const id = req.params.id as string;
      const body = req.body as Record<string, unknown>;
      const content = body.content as string;
      const tags = (body.tags as string[]) ?? undefined;
      const active = body.active;

      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'content (non-empty string) is required'));
        return;
      }

      const prompt = await storage.getSystemPrompt(id);
      if (!prompt) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Prompt "${id}" not found`));
        return;
      }

      const newVersion = prompt.version + 1;
      const now = new Date().toISOString();

      const updated: typeof prompt = {
        ...prompt,
        content,
        tags: tags ?? prompt.tags,
        active: typeof active === 'boolean' ? active : prompt.active,
        version: newVersion,
        updatedAt: now,
      };

      await storage.upsertSystemPrompt(updated);
      await storage.saveSystemPromptVersion({
        promptId: id,
        version: newVersion,
        content,
        tags: updated.tags,
        savedBy: req.auth!.sub,
        savedAt: now,
      });

      logger.info(`Prompt "${id}" updated to v${newVersion}`, { by: req.auth!.sub });

      res.json(success(config.nodeId, { prompt: updated }));
    } catch (err) {
      logger.error('Failed to update system prompt', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update system prompt'));
    }
  });

  return router;
}
