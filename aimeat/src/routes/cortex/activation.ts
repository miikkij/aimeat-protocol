/**
 * @file src/routes/cortex/activation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Cortex extension activation/deactivation logic — materialises (and tears down)
 *   schemas, ontologies, prompts, actions, boards, seed-data and lib registrations. Extracted
 *   from src/routes/cortex.ts to satisfy max-file-lines.
 * @version-history
 *   2026-10-25 — Board and action ids take the cortex name through idStemOf, so a cortex named
 *     `<owner>/<name>` makes `cortex-<owner>-<name>-<component>` and no id carries a slash; a bare
 *     name gives the id it always gave (owner namespaces wish, secaudit2026oct22).
 *   2026-10-24 — activationRefusal answers 409 BOARD_ID_TAKEN when a board-template's derived board id
 *     is a board of another account, activateExtension does not record such a board, and
 *     deactivation deletes only the boards a principal of the installing account or the deactivator
 *     holds (secaudit2026oct22, cortex-activation-adopts-foreign-board-id). activationRefusal takes
 *     the record's installedBy.
 *   2026-10-16 — activationRefusal asks the schema lock rule for every schema component
 *     (services/schema-lock-rule.ts) and refuses a lock another account holds on the same pattern;
 *     deactivation deletes only the rows of its recorded patterns that the installing account still
 *     holds, one (key, apply_to) at a time (QA audit S7-01).
 *   v1.6.1 — 2026-10-11 — A cortex action declares `pricing.tollMorsels: 0` (the field was
 *     `baseMorsels`; a morsel is pacing, not a price).
 *   v1.6.0 — 2026-09-26 — A record stored without `actionProvider` has each action deleted under
 *     every principal of the account that installed the cortex (its bare name, GHII, agents and
 *     ecosystem apps) and under the deactivator's own two. The prompts and ontologies an activation
 *     wrote are deleted under the deactivating principal and every principal of that account, so a
 *     teardown finds them whoever activated the cortex (secaudit 2026-09, R4 4a).
 *   v1.5.0 — 2026-09-26 — Activation records the identity it published the actions under
 *     (`actionProvider` in the artifacts), and deactivation deletes them under it, whoever
 *     deactivates: the person after their agent, an operator after the owner. A record stored without
 *     it keeps the v1.4.0 rule (secaudit 2026-09, R3 7c).
 *   v1.4.0 — 2026-09-26 — Activation and deactivation take a CortexActor: the acting principal
 *     (`gaii`) and its resolved identity (`identity`). An action is published under the resolved
 *     identity, as POST /v1/actions publishes one, so the work doors find it. Deactivation deletes
 *     each action under the resolved identity and under the acting principal (secaudit 2026-09, R3 7c).
 *   v1.3.0 — 2026-09-24 — The ceiling pre-pass is activationRefusal(), exported, so a cortex redeploy
 *     asks it before it swaps libs, stores the manifest and tears the old activation down
 *     (db8a5635a633). It takes the activation a redeploy replaces, whose boards go first.
 *   v1.2.0 — 2026-09-14 — The public-board ceiling is asked BEFORE the component walk, for all the
 *     new public boards at once. It was asked at the board-template case, in the middle of the walk,
 *     and a refusal there is a throw: every schema, prompt, action and ontology listed before that
 *     template was already written and nothing recorded it. Invariant 14, refuse before you write.
 *   v1.1.0 — 2026-09-08 — An activated ontology carries a `skos` rendering beside its `concepts`.
 *     The old shape was a concept scheme under names no SKOS tool recognises, so nothing outside
 *     this repo could read it and it could not be pointed at an outside vocabulary. `concepts` is
 *     unchanged, so nothing that reads it notices.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/cortex.ts (max-file-lines)
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, CortexExtensionRecord, CortexActivationArtifacts } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { idStemOf } from '../../services/component-address.js';
import { publicBoardCeiling, type BoardWriteRefusal } from '../../services/board-write.js';
import { cortexOntologyToSkos } from '../../services/cortex-ontology-skos.js';
import { accountPrincipals } from '../../services/db/owner-identity.js';
import { schemaLockRefusal } from '../../services/schema-lock-rule.js';
import { isOwnersLock } from '../../services/packages/compose/package-component-collisions.js';
import { localAccountName } from '../../utils/gaii.js';

// ── Activation Logic ──

/**
 * Who an activation acts as, in the two forms it records.
 *
 * `gaii` is the acting principal as the token names it: a person's bare account name, an agent's
 * GAII. The schema locks, the prompt, ontology and seed-data memory and the boards are recorded
 * under it. A teardown removes the schema locks and boards by key, and the prompt and ontology
 * memory under it and under every principal of the installing account.
 *
 * `identity` is the resolved identity (utils/gaii.ts resolveIdentity): a person's GHII, an agent's
 * GAII. A published action is keyed on it, as POST /v1/actions keys one, because every work door
 * finds a provider's actions and work under that identity. The activation records it as the
 * artifacts' `actionProvider`, and a teardown deletes the actions there.
 */
export interface CortexActor {
  gaii: string;
  identity: string;
}

/**
 * What activating `ext` would refuse, asked without writing anything: the public-board ceiling,
 * for all of its NEW public boards at once (asking per board would count the same free slot
 * several times over). activateExtension asks it before its component walk; a cortex redeploy asks
 * it before it swaps a byte (routes/cortex.ts upsertCortex).
 *
 * `replacing` is an activation torn down before this one runs, as a redeploy tears down the old one:
 * its boards are deleted first, so they are neither "already there" nor held against the ceiling.
 */
export async function activationRefusal(
  ext: Pick<CortexExtensionRecord, 'name' | 'components' | 'installedBy'>,
  config: AimeatConfig,
  storage: Storage,
  gaii: string,
  isOperator = false,
  replacing?: Pick<CortexExtensionRecord, 'activationArtifacts'>,
): Promise<BoardWriteRefusal | null> {
  // The schema locks first: who may lock each pattern, and the locks of another account it would
  // replace, shadow or sit under (services/schema-lock-rule.ts, the rule PUT /v1/memory/:key/schema
  // asks). The activation set locks with no check, so a cortex replaced another account's lock and
  // its deactivation deleted it (QA audit S7-01).
  const schemaRefusal = await activationSchemaRefusal(ext, config, storage, gaii, isOperator);
  if (schemaRefusal) return schemaRefusal;

  const boardRefusal = await foreignBoardRefusal(ext, storage, gaii);
  if (boardRefusal) return boardRefusal;

  const leaving = new Set(replacing?.activationArtifacts.boardIds ?? []);
  let wanted = 0;
  for (const comp of ext.components) {
    if (comp.type !== 'board-template' || comp.visibility !== 'public') continue;
    const boardId = `cortex-${idStemOf(ext.name)}-${comp.name}`;
    if (!leaving.has(boardId) && await storage.getBoard(boardId)) continue;   // already there, and staying
    wanted++;
  }
  if (wanted === 0) return null;
  return publicBoardCeiling({ storage, config }, { gaii, roles: isOperator ? ['operator'] : [] }, 'public', wanted, leaving);
}

/**
 * The principals whose board an activation of a cortex installed by `installedBy` may take as its
 * own and its teardown may delete: every principal of the installing account
 * (services/db/owner-identity.ts) and the acting principal (an operator acting for the owner).
 */
async function boardHolders(storage: Storage, installedBy: string, gaii: string): Promise<Set<string>> {
  return new Set([gaii, ...await accountPrincipals(storage, installedBy)]);
}

/**
 * 409 BOARD_ID_TAKEN when a board-template's board id is already a board of another account.
 *
 * The id is derived, `cortex-<cortex>-<component>`, so two cortexes can derive the same one
 * (`a-b` + `c` and `a` + `b-c`). Activation took an existing board of that id as its own and recorded
 * it, and the deactivation of the second cortex then deleted the first account's board and its posts
 * (secaudit2026oct22, cortex-activation-adopts-foreign-board-id). A board the installing account
 * holds is still taken as its own, which is what a re-activation and a redeploy do.
 */
async function foreignBoardRefusal(
  ext: Pick<CortexExtensionRecord, 'name' | 'components' | 'installedBy'>,
  storage: Storage,
  gaii: string,
): Promise<BoardWriteRefusal | null> {
  let holders: Set<string> | undefined;
  for (const comp of ext.components) {
    if (comp.type !== 'board-template') continue;
    const boardId = `cortex-${idStemOf(ext.name)}-${comp.name}`;
    const board = await storage.getBoard(boardId);
    if (!board) continue;
    holders ??= await boardHolders(storage, ext.installedBy, gaii);
    if (holders.has(board.ownerGaii)) continue;
    return {
      ok: false, status: 409, code: 'BOARD_ID_TAKEN',
      message: `This cortex would make the board "${boardId}", and a board with that id belongs to another account. `
        + `Rename the board-template component "${comp.name}" or the cortex.`,
    };
  }
  return null;
}

/**
 * The schema components' refusal, or null. `gaii` is the acting principal as the activation records
 * it: a person's bare account name or an agent's GAII. The same pattern under the same apply_to may
 * be replaced only when its holder is a principal of the activating account (isOwnersLock, the rule
 * the package path applies), or by the operator.
 */
async function activationSchemaRefusal(
  ext: Pick<CortexExtensionRecord, 'components'>,
  config: AimeatConfig,
  storage: Storage,
  gaii: string,
  isOperator: boolean,
): Promise<BoardWriteRefusal | null> {
  const schemas = ext.components.filter((c): c is Extract<typeof c, { type: 'schema' }> => c.type === 'schema');
  if (schemas.length === 0) return null;
  const owner = localAccountName(gaii);
  const ownerGhii = `${owner}@${config.nodeId}`;
  const isAgent = gaii.includes('#');
  const caller = {
    principal: isAgent ? gaii : ownerGhii, owner, roles: isAgent ? ['agent'] : ['owner'], isOperator,
  };
  for (const comp of schemas) {
    const ruled = await schemaLockRefusal({ storage, config }, caller, comp.key_pattern, comp.apply_to, async () => isOperator);
    if (ruled) return { ok: false, status: ruled.status, code: ruled.code, message: ruled.message };
    const held = await storage.getSchema(comp.key_pattern, comp.apply_to);
    if (held && !isOperator && !isOwnersLock(held.lockedBy, owner, ownerGhii)) {
      return {
        ok: false, status: 403, code: 'SCHEMA_LOCKED_BY_OTHER',
        message: `This cortex would replace a structure lock that ${held.lockedBy} holds. Ask them to unlock it, or change the cortex to lock keys of your own.`,
      };
    }
  }
  return null;
}

/** The pattern recorded in `schemaKeys`, and the rows of it this deactivation may remove. */
async function ownSchemaRows(
  ext: CortexExtensionRecord,
  storage: Storage,
  key: string,
  holders: ReadonlySet<string>,
): Promise<Array<'exact' | 'prefix'>> {
  // The apply_to the cortex declared for this pattern, when its components still say; both rows
  // otherwise (a record from before the components were kept beside the artifacts).
  const declared = new Set(ext.components
    .filter((c): c is Extract<typeof c, { type: 'schema' }> => c.type === 'schema' && c.key_pattern === key)
    .map(c => c.apply_to));
  const rows: Array<'exact' | 'prefix'> = [];
  for (const applyTo of ['exact', 'prefix'] as const) {
    if (declared.size > 0 && !declared.has(applyTo)) continue;
    const row = await storage.getSchema(key, applyTo);
    if (row && holders.has(row.lockedBy)) rows.push(applyTo);
  }
  return rows;
}

export async function activateExtension(
  ext: CortexExtensionRecord,
  config: AimeatConfig,
  storage: Storage,
  actor: CortexActor,
  // Whether the person activating counts as an operator, for the one component type that has a
  // ceiling. Defaults to false, which is the stricter answer: a caller that cannot say is bounded.
  isOperator = false,
): Promise<CortexActivationArtifacts> {
  const { gaii } = actor;
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

  // REFUSE BEFORE THE FIRST WRITE, because there is nothing behind this loop that can undo one.
  // The public-board ceiling used to be asked at the board-template case, in the middle of the
  // walk, and a refusal there is a `throw` — so every schema lock, prompt, action and ontology
  // record the manifest listed BEFORE that template was already written, activateCortex never
  // reached the line that records them in activationArtifacts, and nothing was left that could take
  // them back. The upsert path was worse: libraries and manifest already swapped, the previous
  // activation's side effects already torn down. Found by the AI triage of 2026-09-13, twice; the
  // upsert now asks activationRefusal() itself before its first write (routes/cortex.ts).
  //
  // Asked once, for ALL the new public boards together (activationRefusal says why).
  const ceiling = await activationRefusal(ext, config, storage, gaii, isOperator);
  if (ceiling) throw new Error(ceiling.message);

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
          // Both readings, side by side. `concepts` is byte-for-byte what it has always been, so a
          // cortex published months ago and anything reading that field are untouched; `skos` is
          // the same content under the names a SKOS reader knows, which is what lets an app point
          // a cortex's vocabulary at an outside one.
          value: {
            name: comp.name,
            description: comp.description,
            concepts: comp.concepts,
            skos: cortexOntologyToSkos(comp, `${ext.name}/${comp.name}`),
          },
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

      // 4. action, under the resolved identity (CortexActor says why)
      case 'action': {
        const actionId = `cortex-${idStemOf(ext.name)}-${comp.name}`;
        try {
          await storage.createAction({
            id: actionId,
            providerGaii: actor.identity,
            displayName: comp.name,
            description: comp.description,
            inputSchema: comp.input_schema,
            outputSchema: {},
            // No pacing amount: a cortex action is unpaced (ActionRecord.pricing.tollMorsels).
            pricing: { tollMorsels: 0 },
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
        const boardId = `cortex-${idStemOf(ext.name)}-${comp.name}`;
        const existingBoard = await storage.getBoard(boardId);
        if (!existingBoard) {
          // THE CEILING ON PUBLIC BOARDS APPLIES HERE TOO. A board-template defaults to `public`
          // and this wrote straight to storage, so activating cortexes was an unbounded way to fill
          // the catalogue that createBoard() bounds at ten per account. Refusing the activation is
          // the honest answer: the cortex asked for a public board and cannot have one, and a board
          // quietly downgraded to private would be a cortex that does not work as it says.
          // Asked again here on purpose, and it is the pre-pass above that makes the ordinary case
          // refuse before anything is written. This one closes the window where a second activation
          // for the same account takes the last slot between that check and this write.
          const ceiling = await publicBoardCeiling({ storage, config }, { gaii, roles: isOperator ? ['operator'] : [] }, comp.visibility);
          if (ceiling) throw new Error(ceiling.message);
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
        } else if (!(await boardHolders(storage, ext.installedBy, gaii)).has(existingBoard.ownerGaii)) {
          // Another account's board of the same id, made after the pre-pass above asked: it is not
          // this activation's, so it is not recorded and no teardown of this cortex reaches it.
          logger.warn(`Cortex board id belongs to another account, not taken: ${boardId}`, { extension: ext.name });
          break;
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

  // Whoever tears this activation down (the person after their agent, an agent after its person, an
  // operator after the owner) deletes the actions where they were published, so that is recorded.
  if (artifacts.actionIds.length > 0) artifacts.actionProvider = actor.identity;

  return artifacts;
}

// ── Deactivation Logic ──

export async function deactivateExtension(
  ext: CortexExtensionRecord,
  storage: Storage,
  actor: CortexActor,
): Promise<void> {
  const { gaii } = actor;
  const { activationArtifacts: artifacts } = ext;

  // Every principal of the account that installed the cortex (services/db/owner-identity.ts): its
  // bare name, its GHII, its agents' GAIIs and its ecosystem apps' GEAIs. Any of them can have
  // activated it, so what the activation wrote under the activating principal is looked for under
  // each. Read once, and only when the teardown needs it.
  let installer: Promise<string[]> | undefined;
  const installerPrincipals = (): Promise<string[]> => (installer ??= accountPrincipals(storage, ext.installedBy));

  // Remove the schema locks this activation recorded, one row at a time, and only a row that a
  // principal of the installing account (or the deactivator) still holds. deleteSchema(key) removed
  // every row of the pattern, so a deactivation took another account's lock with it (QA audit S7-01).
  if (artifacts.schemaKeys.length > 0) {
    const holders = new Set([gaii, ...await installerPrincipals()]);
    for (const key of artifacts.schemaKeys) {
      for (const applyTo of await ownSchemaRows(ext, storage, key, holders)) {
        await storage.deleteSchema(key, applyTo);
        logger.info(`Cortex deactivated schema: ${key}`, { extension: ext.name, apply_to: applyTo });
      }
    }
  }

  // Remove prompts and ontologies (stored as memory, under the principal that activated the cortex),
  // under the deactivating principal and under every principal of the installing account. The keys
  // are this cortex's own (`__cortex__/<name>/…`), so nothing else is stored under them.
  if (artifacts.promptKeys.length + artifacts.ontologyKeys.length > 0) {
    const owners = [...new Set([gaii, ...await installerPrincipals()])];
    for (const key of artifacts.promptKeys) {
      for (const owner of owners) await storage.deleteMemory(owner, key);
      logger.info(`Cortex deactivated prompt: ${key}`, { extension: ext.name });
    }
    for (const key of artifacts.ontologyKeys) {
      for (const owner of owners) await storage.deleteMemory(owner, key);
      logger.info(`Cortex deactivated ontology: ${key}`, { extension: ext.name });
    }
  }

  // Remove actions, under the identity the activation recorded publishing them under
  // (`actionProvider`), whoever deactivates. A record stored without it does not say which principal
  // published them, so each id is deleted under every principal of the installing account and under
  // the deactivator's own two (an operator's included). The pair (provider, id) is unique, so no
  // action of another cortex or another person is reached.
  const providers = artifacts.actionProvider ? [artifacts.actionProvider]
    : artifacts.actionIds.length > 0 ? [...new Set([actor.identity, gaii, ...await installerPrincipals()])] : [];
  for (const actionId of artifacts.actionIds) {
    for (const provider of providers) await storage.deleteAction(actionId, provider);
    logger.info(`Cortex deactivated action: ${actionId}`, { extension: ext.name });
  }

  // Remove the boards this activation recorded, and only a board a principal of the installing
  // account (or the deactivator) holds. An activation recorded another account's board of the same
  // derived id as its own, and this loop deleted it with its posts (secaudit2026oct22).
  if (artifacts.boardIds.length > 0) {
    const holders = new Set([gaii, ...await installerPrincipals()]);
    for (const boardId of artifacts.boardIds) {
      const board = await storage.getBoard(boardId);
      if (!board) continue;
      if (!holders.has(board.ownerGaii)) {
        logger.warn(`Cortex deactivation left a board another account holds: ${boardId}`, { extension: ext.name, owner: board.ownerGaii });
        continue;
      }
      await storage.deleteBoard(boardId);
      logger.info(`Cortex deactivated board: ${boardId}`, { extension: ext.name });
    }
  }

  // Do NOT remove seed-data (preserve user data during deactivation)
  // Do NOT remove lib files (they stay until uninstall)
}
