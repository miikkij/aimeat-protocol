/**
 * @file src/services/design-book/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book (TARGET-074 phase 5): the shared, living library of proven parts —
 *   arrangements and starting shapes that anyone's AI proposes, the bench proves, a human
 *   publishes, and every later build adopts by address instead of re-inventing. The second AEB
 *   measurement is the reason this exists: the same brief produced a look score of 8 or 4
 *   depending on which choices one builder happened to make, and the Book turns a good choice
 *   into an address every build gets.
 *
 *   A PART IS A MEMORY RECORD, NOT A TABLE ROW: `atelier.book.part.<id>` under the NODE'S OWN
 *   SYSTEM IDENTITY (`system@{nodeId}`, the compliance-register pattern), visibility public,
 *   `trackable: true` — so the evolution timeline (versions, diffs, restore) is the same free
 *   machinery every stored layout already has, and the record is self-describing
 *   (`spec: 'aimeat.designbook.part/v1'`). The system identity is not an account anyone can hold
 *   a token for, so THE ONLY WAY IN IS THROUGH THIS SERVICE'S BENCH: no owner, app grant or
 *   delegated agent can forge a part — or its `published` status — with a direct memory write.
 *   Who proposed it is a FIELD (`proposed_by` + `proposed_by_owner`), not the storage address.
 *   Usage lives in a SEPARATE untracked record (`atelier.book.usage.<id>`), because an adopt is
 *   not an edit and must not pollute the part's history.
 *
 *   THE EARNED PATH: propose (anyone, agents included) → the bench runs AT PROPOSE TIME
 *   (validate.ts, the same validator every adopt runs) → the record lands as `proposed` → the
 *   NODE OPERATOR publishes. The proposer may keep editing their own part (re-benched every
 *   time) and may retire it; only the operator flips anything else. A part id is claimed
 *   node-wide on first proposal: the address must answer the same part for everyone.
 *
 *   ONE CAPABILITY, ONE IMPLEMENTATION: REST routes and the node MCP call this class; the
 *   connector and CLI doors proxy the routes. Adoption WRITES THROUGH AppUiService — the same
 *   validated, versioned, provenance-stamped path every layout write takes.
 * @structure DesignBookService — propose() · get() · list() · adopt() · setStatus() · partKey()
 * @usage
 *   const book = new DesignBookService(storage, config);
 *   const out = await book.propose(callerGaii, raw, provenance);
 * @version-history
 *   v1.1.0 — 2026-08-28 — The new kinds land in the lifecycle: propose stamps the checks the
 *     kind's own bench ran (tokens-valid / contrast-matrix / style-valid), and adopt() MERGES a
 *     look, motion recipe or illustration style into the app's existing arrangement (refusing
 *     with words when there is none) instead of replacing it — the whole-layout replace stays
 *     the layout/fill behaviour.
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { resolveAppOwnerScope } from '../app-lifecycle.js';
import { systemGhiiFor } from '../compliance-register.js';
import { provenanceForWrite } from '../ai-provenance.js';
import { AppUiService, type WriteProvenance } from '../app-ui/service.js';
import {
  DesignBookError, validatePartInput, PART_STATUSES,
  type PartInput, type PartKind, type PartStatus,
} from './validate.js';

export const PART_KEY_PREFIX = 'atelier.book.part.';
export const USAGE_KEY_PREFIX = 'atelier.book.usage.';
export const PART_KEY_RE = /^atelier\.book\.part\.[a-z0-9][a-z0-9-]{2,60}$/;

export function partKey(id: string): string { return `${PART_KEY_PREFIX}${id}`; }
function usageKey(id: string): string { return `${USAGE_KEY_PREFIX}${id}`; }

/** What the propose-time bench actually proved, named by kind — the record says which bench ran. */
function proposeChecksFor(input: PartInput): string[] {
  if (input.kind === 'layout' || input.kind === 'fill') return ['layout-valid'];
  if (input.kind === 'illustration') return ['style-valid'];
  const checks = ['tokens-valid'];
  const tokens = (input.body as { tokens?: Record<string, string> }).tokens ?? {};
  if (tokens['--ak-accent']) checks.push('contrast-matrix');
  return checks;
}

/** The stored record value — self-describing, per the memory-contracts rule. */
export interface DesignBookPart {
  spec: 'aimeat.designbook.part/v1';
  id: string;
  kind: PartKind;
  title: string;
  summary: string;
  body: Record<string, unknown>;
  tags: string[];
  status: PartStatus;
  proposed_by: string;
  /** The proposer's owner GHII — the identity the ownership rules compare against. */
  proposed_by_owner: string;
  bench: {
    checks: string[];
    passed_at: string;
    /** The automated guarantee bench's last browser run (design-book/bench.ts), when one ran. */
    browser?: {
      ran: boolean; passed?: boolean; reason?: string; at: string;
      viewports?: Array<{ viewport: string; overflow_px: number; units_rendered: number; controls_below_touch_min: number }>;
    };
  };
  created_at: string;
  updated_at: string;
  published_at?: string;
}

export interface PartSummaryRow {
  id: string; kind: PartKind; title: string; summary: string; tags: string[];
  status: PartStatus; proposed_by: string; updated_at: string; version: number;
  usage: number;
}

export class DesignBookService {
  constructor(private storage: Storage, private config: AimeatConfig) {}

  /** The caller's owner GHII — where their proposals live. The REST door hands in a resolved
   *  identity, which for an owner session is ALREADY the GHII (no `#`); only an agent-shaped
   *  principal needs resolving to the owner it acts for. */
  private async ownerOf(caller: string): Promise<string> {
    if (!caller.includes('#')) return caller;
    const scope = await resolveAppOwnerScope(this.storage, this.config, caller);
    if (!scope) throw new DesignBookError('BAD_IDENTITY', 'Failed to parse the caller identity.', 401);
    return scope.ownerGhii;
  }

  /** The Book's single home: the node's own system identity, which no token can act as. */
  private bookOwner(): string {
    return systemGhiiFor(this.config.nodeId);
  }

  /** The one record holding this id — the id is a NODE-WIDE address in the system namespace. */
  private async findRecord(id: string): Promise<MemoryRecord | null> {
    return this.storage.getMemory(this.bookOwner(), partKey(id));
  }

  private parsePart(record: MemoryRecord): DesignBookPart {
    try {
      const v = typeof record.value === 'string' ? JSON.parse(record.value) : record.value;
      return v as DesignBookPart;
    } catch {
      throw new DesignBookError('PART_UNREADABLE',
        'The stored part is not readable JSON. The proposer can overwrite it with a fresh proposal.', 422);
    }
  }

  private async usageOf(id: string): Promise<number> {
    const rec = await this.storage.getMemory(this.bookOwner(), usageKey(id));
    if (!rec) return 0;
    const v = typeof rec.value === 'string' ? JSON.parse(rec.value) : rec.value;
    return typeof (v as { count?: number }).count === 'number' ? (v as { count: number }).count : 0;
  }

  /**
   * Propose a part, or update your own. The bench runs first; a body the validator refuses never
   * lands. A fresh id lands as `proposed`; re-proposing your own part keeps its status (a minor
   * flows to every adopter's NEXT adopt) — someone else's id is refused with its owner named.
   */
  async propose(
    callerGaii: string, raw: unknown, provenance: WriteProvenance,
  ): Promise<{ id: string; status: PartStatus; version: number; replaced_version: number | null }> {
    const input: PartInput = validatePartInput(raw);
    const ownerGhii = await this.ownerOf(callerGaii);

    const existing = await this.findRecord(input.id);
    const prev = existing ? this.parsePart(existing) : null;
    if (prev && prev.proposed_by_owner !== ownerGhii) {
      throw new DesignBookError('ID_TAKEN',
        `The id "${input.id}" is already a part proposed by ${prev.proposed_by_owner}. A part id is a node-wide address — pick another.`, 409);
    }
    if (prev && prev.status === 'retired') {
      throw new DesignBookError('PART_RETIRED',
        `"${input.id}" is retired. A retired address stays retired — propose under a new id.`, 409);
    }

    const now = new Date().toISOString();
    const part: DesignBookPart = {
      spec: 'aimeat.designbook.part/v1',
      id: input.id,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      body: input.body as unknown as Record<string, unknown>,
      tags: input.tags,
      status: prev?.status ?? 'proposed',
      proposed_by: provenance.principal,
      proposed_by_owner: ownerGhii,
      bench: { checks: proposeChecksFor(input), passed_at: now },
      created_at: prev?.created_at ?? now,
      updated_at: now,
      ...(prev?.published_at ? { published_at: prev.published_at } : {}),
    };

    // Titles and summaries are text people read in the gallery: stamped like every other write.
    const aiProvenanceId = await provenanceForWrite(this.storage, {
      principal: provenance.principal,
      content: JSON.stringify(part),
      declaredId: provenance.declaredId,
      declared: provenance.declared,
      pipeline: 'design-book.propose',
      surface: { visibility: 'public', humanAudience: true },
      labelPolicy: this.config.aiLabelPublic,
      nodeId: this.config.nodeId,
      baseUrl: this.config.baseUrl,
      enabled: this.config.aiProvenance,
    });

    await this.storage.setMemory({
      key: partKey(input.id),
      ownerGaii: this.bookOwner(),
      value: JSON.stringify(part),
      visibility: 'public',
      tags: ['designbook', `kind:${part.kind}`, `status:${part.status}`],
      ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      trackable: true,
      ...(aiProvenanceId ? { aiProvenanceId } : {}),
    });
    return {
      id: input.id, status: part.status,
      version: existing ? existing.version + 1 : 1,
      replaced_version: existing?.version ?? null,
    };
  }

  /** The stored record version of one part, or null when the address is empty — the seeding
   *  probe, so the boot seeder never overrules an operator's Book. */
  async getRecordVersion(id: string): Promise<number | null> {
    const record = await this.findRecord(id);
    return record ? record.version : null;
  }

  /** One part, whole, with its usage count. */
  async get(id: string): Promise<{ part: DesignBookPart; version: number; usage: number; owner: string }> {
    const record = await this.findRecord(id);
    if (!record) {
      throw new DesignBookError('NOT_FOUND',
        `No Design Book part "${id}". List what exists with the search — the Book only answers for addresses it holds.`, 404);
    }
    const part = this.parsePart(record);
    return { part, version: record.version, usage: await this.usageOf(id), owner: part.proposed_by_owner };
  }

  /** The catalogue view: public parts, filtered in memory (the Book is a bounded, curated set). */
  async list(filters: { kind?: string; status?: string; q?: string; limit?: number } = {}): Promise<PartSummaryRow[]> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const items = await this.storage.listMemory(this.bookOwner(), { prefix: PART_KEY_PREFIX, tags: ['designbook'] });
    const rows: PartSummaryRow[] = [];
    for (const record of items) {
      if (!PART_KEY_RE.test(record.key)) continue;
      let part: DesignBookPart;
      // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable part is excluded from the browse; reading it directly answers with the worded 422
      try { part = this.parsePart(record); } catch { continue; }
      if (filters.kind && part.kind !== filters.kind) continue;
      if (filters.status && part.status !== filters.status) continue;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        const hay = `${part.id} ${part.title} ${part.summary} ${part.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      rows.push({
        id: part.id, kind: part.kind, title: part.title, summary: part.summary, tags: part.tags,
        status: part.status, proposed_by: part.proposed_by, updated_at: part.updated_at,
        version: record.version,
        usage: await this.usageOf(part.id),
      });
      if (rows.length >= limit) break;
    }
    return rows;
  }

  /**
   * Adopt one part into one of the CALLER'S apps: the part's body becomes the app's stored
   * layout, through the same validated, versioned write every layout takes. Published parts are
   * adoptable by anyone; a proposed part only by its own proposer (testing your own proposal is
   * how it earns publishing).
   */
  async adopt(
    callerGaii: string, id: string, filename: string, provenance: WriteProvenance,
  ): Promise<{ id: string; filename: string; version: number; replaced_version: number | null; kind: PartKind }> {
    const record = await this.findRecord(id);
    if (!record) throw new DesignBookError('NOT_FOUND', `No Design Book part "${id}".`, 404);
    const part = this.parsePart(record);
    const ownerGhii = await this.ownerOf(callerGaii);
    if (part.status !== 'published' && part.status !== 'aging' && part.proposed_by_owner !== ownerGhii) {
      throw new DesignBookError('NOT_PUBLISHED',
        `"${id}" is ${part.status}, and only its proposer can adopt it before it is published. The published catalogue is what everyone builds from.`, 403);
    }

    const apps = new AppUiService(this.storage, this.config);
    // The caller's OWN app, whichever door they came through: an owner session hands in a GHII
    // (name@node), an agent a GAII (agent#name@node) — the owner name is the part before the
    // separator either way, and the app is looked up under it, never under a client-supplied one.
    const callerOwnerName = callerGaii.includes('#')
      ? callerGaii.slice(callerGaii.indexOf('#') + 1, callerGaii.indexOf('@'))
      : callerGaii.slice(0, callerGaii.indexOf('@'));
    const app = await this.storage.getAppByOwnerName(callerOwnerName, filename);
    if (!app) {
      throw new DesignBookError('NOT_FOUND',
        `No published app "${filename}" under your owner "${callerOwnerName}". A part is adopted into a published app — publish first, or check the filename.`, 404);
    }
    // A layout or leiska REPLACES the app's arrangement; a look, motion recipe or illustration
    // style MERGES into the one it already has — those kinds are seasoning, and seasoning with
    // no dish to land on refuses with words. Every path writes through the same validated,
    // versioned, provenance-stamped door, so an adopted accent pair re-proves its matrix here.
    let nextLayout: unknown = part.body;
    if (part.kind === 'look' || part.kind === 'motion' || part.kind === 'illustration') {
      const current = await apps.read(app.ownerGaii, filename);
      if (!current.layout) {
        throw new DesignBookError('NO_LAYOUT',
          `"${filename}" has no stored arrangement to adopt a ${part.kind} into. Adopt a layout or fill first (or store one with the ui set tool), then season it.`, 409);
      }
      if (part.kind === 'illustration') {
        nextLayout = { ...current.layout, imagery: part.body };
      } else {
        const body = part.body as { tokens?: Record<string, string>; look?: string };
        nextLayout = {
          ...current.layout,
          ...(part.kind === 'look' && body.look ? { look: body.look } : {}),
          tokens: { ...(current.layout.tokens ?? {}), ...(body.tokens ?? {}) },
        };
      }
    }
    const out = await apps.write(app.ownerGaii, filename, nextLayout, provenance);

    // Adoption is the heartbeat: an aging part someone still reaches for is not stale — one real
    // use lifts it straight back to published, without an operator round.
    if (part.status === 'aging') {
      await this.setStatus(callerGaii, true, id, 'published');
    }

    // The adopt is the usage signal — a read is browsing, an adopt is a build. Untracked on
    // purpose: a counter's history is noise, and it must never pollute the part's own timeline.
    const now = new Date().toISOString();
    const prevUsage = await this.usageOf(id);
    const usageRec = await this.storage.getMemory(this.bookOwner(), usageKey(id));
    await this.storage.setMemory({
      key: usageKey(id),
      ownerGaii: this.bookOwner(),
      value: JSON.stringify({ spec: 'aimeat.designbook.usage/v1', id, count: prevUsage + 1, last_adopted_at: now }),
      visibility: 'public',
      tags: ['designbook', 'usage'],
      ttlHours: null,
      version: usageRec ? usageRec.version + 1 : 1,
      createdAt: usageRec?.createdAt ?? now,
      updatedAt: now,
    });

    return { id, filename, version: out.version, replaced_version: out.replaced_version, kind: part.kind };
  }

  /**
   * Flip a part's lifecycle state. The operator moves anything anywhere (publish, age, demote a
   * broken part back to proposed); the proposer may only RETIRE their own. The actor's authority
   * is decided here, against the resolved caller — never at the door alone.
   */
  async setStatus(
    callerGaii: string, isOperator: boolean, id: string, status: string,
  ): Promise<{ id: string; status: PartStatus; previous: PartStatus }> {
    if (!(PART_STATUSES as readonly string[]).includes(status)) {
      throw new DesignBookError('UNKNOWN_STATUS', `A part is one of: ${PART_STATUSES.join(', ')}.`);
    }
    const record = await this.findRecord(id);
    if (!record) throw new DesignBookError('NOT_FOUND', `No Design Book part "${id}".`, 404);
    const part = this.parsePart(record);

    if (!isOperator) {
      const ownerGhii = await this.ownerOf(callerGaii);
      const ownsIt = part.proposed_by_owner === ownerGhii;
      if (!ownsIt || status !== 'retired') {
        throw new DesignBookError('NOT_ALLOWED',
          'Publishing, aging and demoting are the node operator\'s calls. A proposer may retire their own part, nothing more.', 403);
      }
    }

    const previous = part.status;
    const now = new Date().toISOString();
    const next: DesignBookPart = {
      ...part, status: status as PartStatus, updated_at: now,
      ...(status === 'published' ? { published_at: now } : {}),
    };
    await this.storage.setMemory({
      key: record.key,
      ownerGaii: this.bookOwner(),
      value: JSON.stringify(next),
      visibility: 'public',
      tags: ['designbook', `kind:${part.kind}`, `status:${next.status}`],
      ttlHours: null,
      version: record.version + 1,
      createdAt: record.createdAt,
      updatedAt: now,
      trackable: true,
    });
    return { id, status: next.status, previous };
  }
}
