/**
 * @file src/routes/cortex/activation.ts
 * @description Cortex extension activation/deactivation logic — materialises (and tears down)
 *   schemas, ontologies, prompts, actions, boards, seed-data and lib registrations. Extracted
 *   from src/routes/cortex.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/cortex.ts (max-file-lines)
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, CortexExtensionRecord, CortexActivationArtifacts } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';

// ── Activation Logic ──

export async function activateExtension(
  ext: CortexExtensionRecord,
  config: AimeatConfig,
  storage: Storage,
  gaii: string,
): Promise<CortexActivationArtifacts> {
  const artifacts: CortexActivationArtifacts = {
    schemaKeys: [],
    promptKeys: [],
    actionIds: [],
    boardIds: [],
    seedDataKeys: [...ext.activationArtifacts.seedDataKeys],  // carry over from previous
    ontologyKeys: [],
    libFiles: [...ext.activationArtifacts.libFiles],  // carry over from previous
  };

  const now = new Date().toISOString();

  for (const comp of ext.components) {
    switch (comp.type) {
      // 1. schema
      case 'schema': {
        await storage.setSchema({
          keyPattern: comp.key_pattern,
          applyTo: comp.apply_to,
          schemaJson: comp.schema,
          schemaMode: 'strict',
          lockedBy: gaii,
          setAt: now,
          updatedAt: now,
        });
        artifacts.schemaKeys.push(comp.key_pattern);
        logger.info(`Cortex activated schema: ${comp.key_pattern}`, { extension: ext.name });
        break;
      }

      // 2. ontology → store as memory under __cortex__/{ext.name}/ontology/{comp.name}
      case 'ontology': {
        const ontKey = `__cortex__/${ext.name}/ontology/${comp.name}`;
        const existingOnt = await storage.getMemory(gaii, ontKey);
        await storage.setMemory({
          key: ontKey,
          ownerGaii: gaii,
          value: { name: comp.name, description: comp.description, concepts: comp.concepts },
          visibility: 'public',
          tags: ['cortex', 'ontology', ext.name],
          ttlHours: null,
          version: existingOnt ? existingOnt.version + 1 : 1,
          createdAt: existingOnt ? existingOnt.createdAt : now,
          updatedAt: now,
        });
        artifacts.ontologyKeys.push(ontKey);
        logger.info(`Cortex activated ontology: ${ontKey}`, { extension: ext.name });
        break;
      }

      // 3. prompt → store as memory under __cortex__/{ext.name}/prompts/{comp.name}
      case 'prompt': {
        const promptKey = `__cortex__/${ext.name}/prompts/${comp.name}`;
        const existingPrompt = await storage.getMemory(gaii, promptKey);
        await storage.setMemory({
          key: promptKey,
          ownerGaii: gaii,
          value: { name: comp.name, content: comp.content, variables: comp.variables },
          visibility: 'public',
          tags: ['cortex', 'prompt', ext.name],
          ttlHours: null,
          version: existingPrompt ? existingPrompt.version + 1 : 1,
          createdAt: existingPrompt ? existingPrompt.createdAt : now,
          updatedAt: now,
        });
        artifacts.promptKeys.push(promptKey);
        logger.info(`Cortex activated prompt: ${promptKey}`, { extension: ext.name });
        break;
      }

      // 4. action
      case 'action': {
        const actionId = `cortex-${ext.name}-${comp.name}`;
        try {
          await storage.createAction({
            id: actionId,
            providerGaii: gaii,
            displayName: comp.name,
            description: comp.description,
            inputSchema: comp.input_schema,
            outputSchema: {},
            pricing: { baseMorsels: 0 },
            tags: ['cortex', ext.name],
            createdAt: now,
            updatedAt: now,
          });
          artifacts.actionIds.push(actionId);
          logger.info(`Cortex activated action: ${actionId}`, { extension: ext.name });
        } catch (e: unknown) {
          // Action might already exist (idempotent re-activation)
          if ((e as Error).message === 'ACTION_EXISTS') {
            artifacts.actionIds.push(actionId);
            logger.info(`Cortex action already exists, skipping: ${actionId}`, { extension: ext.name });
          } else {
            throw e;
          }
        }
        break;
      }

      // 5. board-template
      case 'board-template': {
        const boardId = `cortex-${ext.name}-${comp.name}`;
        const existingBoard = await storage.getBoard(boardId);
        if (!existingBoard) {
          await storage.createBoard({
            id: boardId,
            name: comp.title,
            description: comp.description,
            visibility: comp.visibility,
            ownerGaii: gaii,
            allowedGaiis: [],
            createdAt: now,
          });

          // Create seed posts if specified
          if (comp.seed_posts) {
            for (const seedPost of comp.seed_posts) {
              const postId = `post-${randomBytes(8).toString('hex')}`;
              await storage.createPost({
                id: postId,
                boardId,
                authorGaii: gaii,
                title: seedPost.title,
                body: seedPost.body,
                tags: ['cortex', 'seed'],
                reactions: {},
                createdAt: now,
              });
            }
          }

          logger.info(`Cortex activated board: ${boardId}`, { extension: ext.name });
        } else {
          logger.info(`Cortex board already exists, skipping: ${boardId}`, { extension: ext.name });
        }
        artifacts.boardIds.push(boardId);
        break;
      }

      // 6. seed-data
      case 'seed-data': {
        for (const entry of comp.entries) {
          const existingSeed = await storage.getMemory(gaii, entry.key);
          await storage.setMemory({
            key: entry.key,
            ownerGaii: gaii,
            value: entry.value,
            visibility: 'public',
            tags: ['cortex', 'seed-data', ext.name],
            ttlHours: null,
            version: existingSeed ? existingSeed.version + 1 : 1,
            createdAt: existingSeed ? existingSeed.createdAt : now,
            updatedAt: now,
          });
          if (!artifacts.seedDataKeys.includes(entry.key)) {
            artifacts.seedDataKeys.push(entry.key);
          }
        }
        logger.info(`Cortex activated seed-data: ${comp.entries.length} entries`, { extension: ext.name });
        break;
      }

      // 7. lib — just record in artifacts
      case 'lib': {
        if (!artifacts.libFiles.includes(comp.filename)) {
          artifacts.libFiles.push(comp.filename);
        }
        logger.info(`Cortex lib registered: ${comp.filename}`, { extension: ext.name });
        break;
      }
    }
  }

  return artifacts;
}

// ── Deactivation Logic ──

export async function deactivateExtension(
  ext: CortexExtensionRecord,
  storage: Storage,
  gaii: string,
): Promise<void> {
  const { activationArtifacts: artifacts } = ext;

  // Remove schemas
  for (const key of artifacts.schemaKeys) {
    await storage.deleteSchema(key);
    logger.info(`Cortex deactivated schema: ${key}`, { extension: ext.name });
  }

  // Remove prompts (stored as memory)
  for (const key of artifacts.promptKeys) {
    await storage.deleteMemory(gaii, key);
    logger.info(`Cortex deactivated prompt: ${key}`, { extension: ext.name });
  }

  // Remove ontologies (stored as memory)
  for (const key of artifacts.ontologyKeys) {
    await storage.deleteMemory(gaii, key);
    logger.info(`Cortex deactivated ontology: ${key}`, { extension: ext.name });
  }

  // Remove actions
  for (const actionId of artifacts.actionIds) {
    await storage.deleteAction(actionId, gaii);
    logger.info(`Cortex deactivated action: ${actionId}`, { extension: ext.name });
  }

  // Remove boards
  for (const boardId of artifacts.boardIds) {
    await storage.deleteBoard(boardId);
    logger.info(`Cortex deactivated board: ${boardId}`, { extension: ext.name });
  }

  // Do NOT remove seed-data (preserve user data during deactivation)
  // Do NOT remove lib files (they stay until uninstall)
}
