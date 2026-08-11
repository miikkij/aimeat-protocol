/**
 * @file src/services/db/notebook-db-service.ts
 * @description Purpose-built Application DB Service for the profile Notebook tab — the ONE call behind
 *   GET /v1/notebook. The tab mounts a 3-request fan-out: the inbox notes (loadInbox loaded the WHOLE
 *   owner-scope memory list and filtered client-side to the `notebook.inbox.` prefix) + organism names +
 *   the notebook settings. This composes all three in one read scope AND narrows the inbox to a
 *   server-side prefix scan (so a large keyspace no longer loads every value just to find the notes).
 *   Single-master: the Notebook tab mount only.
 *
 * @structure NotebookService.overview(ownerName, ownerGhii) → { inbox, settings, organisms }
 * @usage const nb = await createNotebookService(storage).overview(owner, `${owner}@${nodeId}`);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Notebook tab's 3 reads into one composite (inbox = prefix scan).
 */
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { visibilityToZone } from '../../routes/memory/shared.js';

/** Owner-captured notes live under this key prefix (mirrors public/views/profile/notebook-helpers.js). */
const INBOX_PREFIX = 'notebook.inbox.';

export interface NotebookOverview {
  inbox: Array<Record<string, unknown>>;
  settings: Record<string, unknown>;
  organisms: { organisms: unknown[] };
}

export class NotebookService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Notebook tab mount for one owner in a single read scope. The inbox is read by prefix across the
   * owner's identities (GHII + agents), newest first, in the GET /v1/memory record shape the tab's note
   * cards already consume — but only the `notebook.inbox.` keys are ever loaded.
   */
  overview(ownerName: string, ownerGhii: string): Promise<NotebookOverview> {
    return runInReadScope(async () => {
      const agents = await this.storage.getAgentsByOwner(ownerName);
      const gaiis = [ownerGhii, ...agents.map(a => a.gaii)];

      const [inboxRecs, settingsRec, organisms] = await Promise.all([
        this.storage.listMemoryForOwners(gaiis, { prefix: INBOX_PREFIX }),
        this.storage.getMemory(ownerGhii, 'notebook.settings'),
        this.storage.listOrganisms({ member: ownerName }),
      ]);

      const inbox = inboxRecs
        .filter(r => r.key.startsWith(INBOX_PREFIX))
        .map(r => ({
          key: r.key, owner_gaii: r.ownerGaii, value: r.value, visibility: r.visibility,
          zone: visibilityToZone(r.visibility), tags: r.tags, version: r.version,
          flagCount: r.flagCount ?? 0, created_at: r.createdAt, updated_at: r.updatedAt,
        }))
        .sort((a, b) => +new Date(b.updated_at || b.created_at || 0) - +new Date(a.updated_at || a.created_at || 0));

      return {
        inbox,
        settings: (settingsRec?.value as Record<string, unknown>) ?? {},
        organisms: { organisms },
      };
    });
  }
}

/** Assemble the Notebook tab composite over the given storage. */
export function createNotebookService(storage: Storage): NotebookService {
  return new NotebookService(storage);
}
