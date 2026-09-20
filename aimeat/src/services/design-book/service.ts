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
 *   v1.8.0 — 2026-09-20 — The COMPONENT kind. Taking one answers its snippet and writes nothing,
 *     before the taker's app exists. A proposal is PUBLISHED BY ITSELF on three things together:
 *     the bench, its builder judging it general, and the owner's word about the app it came from
 *     (componentPublishing). Nothing here takes a part down; that stays the operator's.
 *   v1.7.0 — 2026-09-20 — The reasons (reasons.ts): get() answers what builders wrote about a part,
 *     keep() is the owner saying an app turned out well, reasonsQueue() is what the Book should
 *     grow next. A count says an AI favoured a part; only a kept app says somebody was satisfied.
 *   v1.6.0 — 2026-09-20 — recordUse(): a published app that names the parts it was built from is
 *     counted, once per app (app-book-parts.ts). The usage record remembers which apps.
 *   v1.5.0 — 2026-09-19 — map(): the published shelf as one page of text (map.ts). Three measured
 *     builds searched the Book in none of them, because a search serves a builder that already
 *     knows what the Book holds.
 *   v1.4.0 — 2026-09-05 — The EFFECT kind (wish-atelier-post-process-effects, stage 5): the
 *     propose bench is named effect-valid (no words sit under a hero band, a figure or the
 *     layer, so the matrix runs at the write that lands it on words); adopt MERGES the effect
 *     onto the first block of the component it names, or as a pass on the arrangement's ambient
 *     (the newest two kept), and refuses with words when there is no such block or no layer.
 *   v1.3.0 — 2026-09-05 — The AMBIENT kind in the lifecycle (wish-atelier-ambient-visuals):
 *     propose stamps ambient-valid and contrast-matrix (plus tokens-valid when a sheet rides
 *     along); adopt MERGES the layer as the arrangement's `ambient` and its tokens, never its
 *     look — an ambient is seasoning, and a background that repainted the whole app on adopt
 *     would be the surprise the merge rule exists to prevent — and the no-arrangement refusal
 *     names the way an app carries one in its own code. The bench's viewport rows carry the
 *     layer counts, and a list row says when it was published.
 *   v1.2.0 — 2026-08-29 — Retired parts leave every default listing: dead is invisible, and
 *     only an explicit ?status=retired asks for the graveyard.
 *   v1.1.0 — 2026-08-28 — The new kinds land in the lifecycle: propose stamps the checks the
 *     kind's own bench ran (tokens-valid / contrast-matrix / style-valid), and adopt() MERGES a
 *     look, motion recipe or illustration style into the app's existing arrangement (refusing
 *     with words when there is none) instead of replacing it — the whole-layout replace stays
 *     the layout/fill behaviour.
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { resolveAppOwnerScope } from '../app-owner-scope.js';
import { systemGhiiFor } from '../compliance-register.js';
import { provenanceForWrite } from '../ai-provenance.js';
import { AppUiService, type WriteProvenance } from '../app-ui/service.js';
import {
  DesignBookError, validatePartInput, PART_STATUSES,
  type PartInput, type PartKind, type PartStatus,
} from './validate.js';
import { POST_MAX } from '../../data/atelier-effects.js';
import { getAppTemplateIndex } from '../../data/app-templates.js';
import { buildDesignBookMap } from './map.js';
import { DesignBookReasons } from './reasons.js';
import { componentSnippet, type ComponentBody } from './component.js';

export const PART_KEY_PREFIX = 'atelier.book.part.';
export const USAGE_KEY_PREFIX = 'atelier.book.usage.';
/** How many apps a usage record remembers, so a republish is not counted as a new use. */
const USAGE_APPS_KEPT = 200;
export const PART_KEY_RE = /^atelier\.book\.part\.[a-z0-9][a-z0-9-]{2,60}$/;

export function partKey(id: string): string { return `${PART_KEY_PREFIX}${id}`; }
function usageKey(id: string): string { return `${USAGE_KEY_PREFIX}${id}`; }

/** What the propose-time bench actually proved, named by kind — the record says which bench ran. */
function proposeChecksFor(input: PartInput): string[] {
  if (input.kind === 'layout' || input.kind === 'fill') return ['layout-valid'];
  if (input.kind === 'illustration') return ['style-valid'];
  // Markup against the allowlist, the stylesheet under its own prefix, every colour a token.
  if (input.kind === 'component') return ['markup-allowlist', 'styles-scoped', 'colours-are-tokens', 'no-script', 'judgement-given'];
  if (input.kind === 'ambient') {
    // The ambient bench always runs the matrix: the preset is proven on the part's look.
    const checks = ['ambient-valid', 'contrast-matrix'];
    const tokens = (input.body as { tokens?: Record<string, string> }).tokens;
    if (tokens && Object.keys(tokens).length > 0) checks.push('tokens-valid');
    return checks;
  }
  if (input.kind === 'effect') {
    // The effect bench proves the target and the knobs; no words sit under a hero band, a
    // figure or the layer, so the matrix has nothing to measure until the effect lands on
    // words in an arrangement, where the layout validator runs it.
    const checks = ['effect-valid'];
    const tokens = (input.body as { tokens?: Record<string, string> }).tokens;
    if (tokens && Object.keys(tokens).length > 0) checks.push('tokens-valid');
    return checks;
  }
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
      viewports?: Array<{
        viewport: string; overflow_px: number; units_rendered: number; controls_below_touch_min: number;
        ambient_layers?: number; ambient_painted?: number; fx_applied?: number; fx_running?: number;
      }>;
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
  /** When it was last published — so a gallery can say "new this week" from the truth. */
  published_at?: string;
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
  ): Promise<{ id: string; status: PartStatus; version: number; replaced_version: number | null; publishing?: { earned: boolean; why: string } }> {
    const input: PartInput = validatePartInput(raw);
    const ownerGhii = await this.ownerOf(callerGaii);
    const publishing = input.kind === 'component' ? await this.componentPublishing(ownerGhii, input.body as unknown as ComponentBody) : undefined;

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
      // A component that earned it goes straight to the shelf; nothing here ever takes a part
      // DOWN from published, which stays the operator's call.
      status: prev?.status === 'published' || prev?.status === 'aging' ? prev.status : (publishing?.earned ? 'published' : (prev?.status ?? 'proposed')),
      proposed_by: provenance.principal,
      proposed_by_owner: ownerGhii,
      bench: { checks: proposeChecksFor(input), passed_at: now },
      created_at: prev?.created_at ?? now,
      updated_at: now,
      ...(prev?.published_at ? { published_at: prev.published_at } : (publishing?.earned ? { published_at: now } : {})),
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
      ...(publishing ? { publishing } : {}),
    };
  }

  /**
   * Whether a component goes onto the shelf by itself. THREE THINGS, ALL OF THEM (ruled
   * 2026-09-20): the bench passed (or this is not reached), its builder judged it GENERAL and
   * said why, and it comes out of an app whose OWNER said the app turned out well. The bench
   * proves it renders and wears the page; it cannot prove anybody else wants it, which is what
   * the judgement is for, and a finished build proves nothing about the app, which is what the
   * owner's word is for. A component that misses one stays proposed: listed in the queue, usable
   * by whoever made it, and one operator action away from the shelf.
   */
  private async componentPublishing(ownerGhii: string, body: ComponentBody): Promise<{ earned: boolean; why: string }> {
    if (body.judgement.reach !== 'general') {
      return { earned: false, why: 'Its builder judged it special to one app, so it stays proposed: listed, and usable by whoever made it.' };
    }
    if (!body.from_app) {
      return { earned: false, why: 'It names no app it came out of (from_app), so there is no owner\'s word to earn publishing from. It stays proposed.' };
    }
    const state = await new DesignBookReasons(this.storage, this.config).keptState(ownerGhii, body.from_app);
    if (!state.kept) {
      return { earned: false, why: `The owner has not said "${body.from_app}" turned out well (aimeat_designbook_keep). A finished build is not that. It stays proposed until they do; propose it again then.` };
    }
    if (!state.made.length) {
      return { earned: false, why: `The kept version of "${body.from_app}" wrote down nothing it made by hand (the \`made\` list of its build notes), so nothing says this component came out of it. It stays proposed.` };
    }
    return { earned: true, why: `Published: the bench passed, its builder judged it general, and it comes out of "${body.from_app}", which its owner said turned out well.` };
  }

  /** The stored record version of one part, or null when the address is empty — the seeding
   *  probe, so the boot seeder never overrules an operator's Book. */
  async getRecordVersion(id: string): Promise<number | null> {
    const record = await this.findRecord(id);
    return record ? record.version : null;
  }

  /**
   * One part, whole, with its usage count and what builders wrote about it: `taken` is how often
   * a builder reached for it, `kept` how many of those apps an owner was satisfied with, and the
   * rows carry the reasons, the ones for passing it over included.
   */
  async get(id: string): Promise<{
    part: DesignBookPart; version: number; usage: number; owner: string;
    reasons: Awaited<ReturnType<DesignBookReasons['forPart']>>;
  }> {
    const record = await this.findRecord(id);
    if (!record) {
      throw new DesignBookError('NOT_FOUND',
        `No Design Book part "${id}". List what exists with the search — the Book only answers for addresses it holds.`, 404);
    }
    const part = this.parsePart(record);
    return {
      part, version: record.version, usage: await this.usageOf(id), owner: part.proposed_by_owner,
      reasons: await new DesignBookReasons(this.storage, this.config).forPart(id),
    };
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
      // A retired part is DEAD: nothing adopts it and no browse should show it. It survives
      // only so its address cannot be re-proposed. It appears in a listing only when asked
      // for by name (?status=retired) — the developer met his own retirees in the gallery,
      // which is exactly the shelf litter this line removes.
      if (!filters.status && part.status === 'retired') continue;
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
        ...(part.published_at ? { published_at: part.published_at } : {}),
      });
      if (rows.length >= limit) break;
    }
    return rows;
  }

  /**
   * The published shelf as ONE page of text: every part on a line, grouped by kind. What a
   * builder reads before it composes anything, and what a search with no word answers (map.ts).
   */
  async map(): Promise<{ map: string; count: number }> {
    const shelf = await this.list({ status: 'published', limit: 200 });
    // THE GENRES COME FROM THE SERVED TEMPLATES, which is what a fork reads. A genre part in the
    // Book only names a template, and the shelf lags the templates: production held 19 of 23 on
    // 2026-09-19 and a fresh node holds none, so a map of the shelf alone hid genres that fork.
    const genres = getAppTemplateIndex().filter(t => t.kind === 'genre');
    const rows = [
      ...genres.map(g => ({ id: g.id, kind: 'genre', summary: g.description })),
      ...shelf.filter(r => r.kind !== 'genre'),
    ];
    const map = buildDesignBookMap(rows, {
      baseUrl: this.config.baseUrl,
      light: new Map(genres.map(g => [g.id, g.light === 'follows' ? 'follows' as const : 'fixed' as const])),
    });
    return { map, count: rows.length };
  }

  /**
   * Adopt one part into one of the CALLER'S apps: the part's body becomes the app's stored
   * layout, through the same validated, versioned write every layout takes. Published parts are
   * adoptable by anyone; a proposed part only by its own proposer (testing your own proposal is
   * how it earns publishing).
   */
  async adopt(
    callerGaii: string, id: string, filename: string, provenance: WriteProvenance,
  ): Promise<{
    id: string; filename: string; version: number; replaced_version: number | null; kind: PartKind;
    /** A component only: the markup, the stylesheet and how to wire them. */
    snippet?: ReturnType<typeof componentSnippet>;
  }> {
    const record = await this.findRecord(id);
    if (!record) throw new DesignBookError('NOT_FOUND', `No Design Book part "${id}".`, 404);
    const part = this.parsePart(record);
    const ownerGhii = await this.ownerOf(callerGaii);
    if (part.status !== 'published' && part.status !== 'aging' && part.proposed_by_owner !== ownerGhii) {
      throw new DesignBookError('NOT_PUBLISHED',
        `"${id}" is ${part.status}, and only its proposer can adopt it before it is published. The published catalogue is what everyone builds from.`, 403);
    }

    // A COMPONENT is taken BEFORE the app exists: it is two texts to build into the page, and
    // there is no stored arrangement for it to land in. So it needs no published app, writes
    // nothing, and is not counted here: the publish counts it when the page names it in its
    // build notes (`took`), which is also where the builder says why it chose it.
    if (part.kind === 'component') {
      return {
        id, filename, version: record.version, replaced_version: null, kind: part.kind,
        snippet: componentSnippet(part.body as unknown as ComponentBody),
      };
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
    // A layout or leiska REPLACES the app's arrangement; a look, motion recipe, illustration
    // style or ambient MERGES into the one it already has — those kinds are seasoning, and
    // seasoning with no dish to land on refuses with words. Every path writes through the same
    // validated, versioned, provenance-stamped door, so an adopted accent pair re-proves its
    // matrix here, and an adopted ambient is proven again on the look it lands on.
    // A GENRE is a whole page: taking one home is a FORK of its template, never a merge into a
    // stored arrangement — adopting it would overwrite an app with a scaffold.
    if (part.kind === 'genre') {
      const tid = (part.body as { template?: string }).template || '';
      throw new DesignBookError('GENRE_IS_FORKED',
        `A genre is forked, not adopted: fetch GET /v1/app-templates/${tid} , swap the words and sources for your app, and publish it as its own file. The Book shows it; the template registry hands it over.`, 409);
    }
    let nextLayout: unknown = part.body;
    if (part.kind === 'look' || part.kind === 'motion' || part.kind === 'illustration' || part.kind === 'ambient' || part.kind === 'effect') {
      const current = await apps.read(app.ownerGaii, filename);
      if (!current.layout) {
        throw new DesignBookError('NO_LAYOUT',
          `"${filename}" has no stored arrangement to adopt a ${part.kind} into. Adopt a layout or fill first (or store one with the ui set tool), then season it.`
          + (part.kind === 'ambient' ? ' An app with no stored arrangement can still carry an ambient in its own code: app({ ambient: "<preset>" }).' : '')
          + (part.kind === 'effect' ? ' An app with no stored arrangement can still wear an effect in its own code: AIMEAT.atelier.fx(el, { id }).' : ''), 409);
      }
      if (part.kind === 'illustration') {
        nextLayout = { ...current.layout, imagery: part.body };
      } else if (part.kind === 'effect') {
        // The effect lands where the part says: as a pass on the arrangement's ambient (which
        // must be running one), or on the first block of the target component. No target
        // refuses with words rather than landing somewhere else; the write re-proves it there.
        const body = part.body as { effect: string; params?: Record<string, number | string>; on: 'hero' | 'figure' | 'layer' };
        const spec = { id: body.effect, ...(body.params ? { params: body.params } : {}) };
        if (body.on === 'layer') {
          const layer = current.layout.ambient;
          if (!layer || layer.preset === 'none') {
            throw new DesignBookError('NO_TARGET',
              `"${filename}" runs no ambient, and a pass runs over the layer's own field: adopt an ambient first (the Book's ambient shelf), then this pass.`, 409);
          }
          const rest = (layer.post ?? []).filter((p) => (typeof p === 'string' ? p : p.id) !== body.effect);
          nextLayout = { ...current.layout, ambient: { ...layer, post: [...rest, spec].slice(-POST_MAX) } };
        } else {
          const blocks = current.layout.blocks;
          const idx = blocks.findIndex((b) => b.component === body.on);
          if (idx < 0) {
            throw new DesignBookError('NO_TARGET',
              `"${filename}" has no ${body.on} block for this effect to land on. Add one (or adopt a layout that has it), then adopt the effect.`, 409);
          }
          nextLayout = { ...current.layout, blocks: blocks.map((b, i) => (i === idx ? { ...b, effect: spec } : b)) };
        }
      } else if (part.kind === 'ambient') {
        // The layer lands as the arrangement's `ambient` and the sheet merges; the part's look
        // says where it was proven and previewed, and never overwrites the app's own.
        const body = part.body as { ambient: string; alpha?: number; speed?: number; tokens?: Record<string, string> };
        nextLayout = {
          ...current.layout,
          ambient: {
            preset: body.ambient,
            ...(body.alpha !== undefined ? { alpha: body.alpha } : {}),
            ...(body.speed !== undefined ? { speed: body.speed } : {}),
          },
          ...(body.tokens && Object.keys(body.tokens).length > 0
            ? { tokens: { ...(current.layout.tokens ?? {}), ...body.tokens } }
            : {}),
        };
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
    await this.countUse(id, `${callerOwnerName}/${filename}`, true);

    return { id, filename, version: out.version, replaced_version: out.replaced_version, kind: part.kind };
  }

  /**
   * One more use of a part, by one app. The record remembers the apps that used it (the last
   * USAGE_APPS_KEPT), which is what lets a publish that NAMES its parts count each app once
   * however often it is republished. An adopt counts every time, as it always has (`always`).
   */
  private async countUse(id: string, app: string, always: boolean): Promise<boolean> {
    const now = new Date().toISOString();
    const usageRec = await this.storage.getMemory(this.bookOwner(), usageKey(id));
    let prev: { count?: number; apps?: string[] };
    // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable counter starts again from zero; it is a counter
    try { prev = (usageRec ? (typeof usageRec.value === 'string' ? JSON.parse(usageRec.value) : usageRec.value) : {}) ?? {}; } catch { prev = {}; }
    const apps = Array.isArray(prev.apps) ? prev.apps.filter(a => typeof a === 'string') : [];
    const known = apps.includes(app);
    if (known && !always) return false;
    await this.storage.setMemory({
      key: usageKey(id),
      ownerGaii: this.bookOwner(),
      value: JSON.stringify({
        spec: 'aimeat.designbook.usage/v1', id, count: (typeof prev.count === 'number' ? prev.count : 0) + 1,
        last_adopted_at: now, apps: [...apps.filter(a => a !== app), app].slice(-USAGE_APPS_KEPT),
      }),
      visibility: 'public',
      tags: ['designbook', 'usage'],
      ttlHours: null,
      version: usageRec ? usageRec.version + 1 : 1,
      createdAt: usageRec?.createdAt ?? now,
      updatedAt: now,
    });
    return true;
  }

  /**
   * THE OWNER SAYS AN APP TURNED OUT WELL (or takes it back). The only moment anything is "kept":
   * a finished build is not one, because an app is often rebuilt before anybody likes it
   * (reasons.ts). Answers with what that version holds, which is what is worth putting into the
   * Book now: the parts it kept using, and what it had to make by hand.
   */
  async keep(callerGaii: string, filename: string, kept: boolean): Promise<{
    app: string; kept: boolean; version: number; took: Array<{ part: string; why: string }>;
    made: Array<{ name: string; what: string; why: string }>; next: string;
  }> {
    const ownerName = callerGaii.includes('#')
      ? callerGaii.slice(callerGaii.indexOf('#') + 1, callerGaii.indexOf('@'))
      : callerGaii.slice(0, callerGaii.indexOf('@'));
    const app = await this.storage.getAppByOwnerName(ownerName, filename);
    if (!app) throw new DesignBookError('NOT_FOUND', `No published app "${filename}" under your owner "${ownerName}".`, 404);
    const out = await new DesignBookReasons(this.storage, this.config).keep({ ownerGhii: app.ownerGaii, ownerName, filename, kept });
    if (!out || out.version === null) {
      throw new DesignBookError('NO_NOTES',
        `"${filename}" has written down no build notes, so there is nothing to keep yet. A page carries them in <script type="application/json" id="aimeat-build-notes"> `
        + '(what it took from the Design Book, what it passed over, what it made by hand, each with why) and the next publish stores them.', 409);
    }
    const next = !kept
      ? 'Taken back: this app no longer counts as one its owner was satisfied with.'
      : out.made.length
        ? `This version made ${out.made.length} thing${out.made.length === 1 ? '' : 's'} by hand because the Book had nothing for it: ${out.made.map(m => m.name).join(', ')}. `
          + 'NOW is when they are offered to the next builder, and you do it, in this conversation: for each one, take its markup and its styles out of the app (aimeat_app_get, then read the page) and propose it, '
          + `aimeat_designbook_propose with kind "component" and body { prefix, html, css, use, judgement: { reach, why }, from_app: "${filename}" }. `
          + 'The component carries no script (the app that takes it wires the behaviour), every class starts with its prefix, and every colour is a var(--ak-…) token so it wears whatever page it lands in. '
          + 'JUDGE EACH ONE HONESTLY: reach "general" when another kind of app would use it (a grid a person ticks), "special" when it belongs to this app alone (a flute fingering chart), with the reason. '
          + 'A general one from this app is published by itself; a special one stays listed and yours. An ARRANGEMENT you composed goes in as kind "fill", its own words turned back into <placeholders>. '
          + 'Tell the owner in a line what went onto the shelf and what you judged special.'
        : 'Recorded. This version made nothing by hand, so there is nothing new to offer the Book; the parts it took now count as kept.';
    return { app: out.app, kept: out.kept, version: out.version, took: out.took, made: out.made, next };
  }

  /** What builders wrote down about the Book, turned into what it should become next (reasons.ts). */
  async reasonsQueue(): Promise<Awaited<ReturnType<DesignBookReasons['queue']>>> {
    return new DesignBookReasons(this.storage, this.config).queue();
  }

  /**
   * A published app NAMED these parts as what it was built from (app-book-parts.ts). Counts each
   * part once per app. Only the published shelf counts: a part still in proposal, a retired one
   * and a genre (which is forked, and whose fork is the app's register) are answered as unknown.
   */
  async recordUse(app: string, ids: string[]): Promise<{ counted: string[]; already: string[]; unknown: string[] }> {
    const out = { counted: [] as string[], already: [] as string[], unknown: [] as string[] };
    for (const id of ids) {
      const record = await this.findRecord(id);
      let part: DesignBookPart | null;
      // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable part is answered as unknown, which is what the builder can act on
      try { part = record ? this.parsePart(record) : null; } catch { part = null; }
      if (!part || part.kind === 'genre' || (part.status !== 'published' && part.status !== 'aging')) { out.unknown.push(id); continue; }
      ((await this.countUse(id, app, false)) ? out.counted : out.already).push(id);
    }
    return out;
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

  /**
   * DELETE a part outright — the cleanup retire cannot be. A system that can be littered but
   * never cleaned drifts toward a graveyard nobody can read (the developer's words, after six
   * bad parts had only a "retired" to go to). The rule: junk with ZERO adoptions is deleted
   * whole, history included; a part some app has adopted keeps its address and is retired
   * instead, because the adopters' history points at it.
   */
  async delete(
    callerGaii: string, isOperator: boolean, id: string,
  ): Promise<{ id: string; deleted: true }> {
    const record = await this.findRecord(id);
    if (!record) throw new DesignBookError('NOT_FOUND', `No Design Book part "${id}".`, 404);
    const part = this.parsePart(record);
    if (!isOperator) {
      const ownerGhii = await this.ownerOf(callerGaii);
      if (part.proposed_by_owner !== ownerGhii) {
        throw new DesignBookError('NOT_ALLOWED',
          'Deleting is the node operator\'s call, or the proposer\'s on their own part.', 403);
      }
    }
    const usage = await this.usageOf(id);
    if (usage > 0) {
      throw new DesignBookError('PART_IN_USE',
        `"${id}" is adopted by ${usage} build${usage === 1 ? '' : 's'} whose history points at it — retire it instead of deleting it.`, 409);
    }
    if (this.storage.deleteMemorySubtree) {
      // The subtree takes the version history with it — deleted means gone, not haunting.
      await this.storage.deleteMemorySubtree(this.bookOwner(), record.key);
    } else {
      await this.storage.deleteMemory(this.bookOwner(), record.key);
    }
    return { id, deleted: true };
  }
}
