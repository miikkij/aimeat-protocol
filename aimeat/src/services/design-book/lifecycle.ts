/**
 * @file src/services/design-book/lifecycle.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book's seeding and forgetting (TARGET-074 phase 5).
 *
 *   SEEDING: the six layout presets (app-ui/layouts.ts) become the Book's first PUBLISHED parts
 *   at boot, so a fresh node's Book is never an empty shelf — the first adopt has something
 *   proven to pick. Idempotent and non-authoritative: a part is created only when its address is
 *   empty, so an operator who ages, retires or replaces a seeded part is never overruled by the
 *   next restart. Every seed still passes the SAME bench a proposal passes; a preset the
 *   validator has stopped accepting is skipped with a log line, never stored on trust.
 *
 *   FORGETTING: the aging job answers "how does this go stale" for the Book itself — a published
 *   part nobody has adopted within the window is marked `aging` (still adoptable, visibly
 *   fading). Adoption is the heartbeat: DesignBookService.adopt() lifts an aging part straight
 *   back to published, so one real use un-fades it without an operator round.
 * @structure seedDesignBook() · runDesignBookAgingJob() · AGING_AFTER_DAYS
 * @usage
 *   await seedDesignBook(storage, config);                    // server-bootstrap/service-init.ts
 *   scheduler.registerCoreHandler('designbook-aging', ...);   // services/core-jobs.ts
 * @version-history
 *   v1.1.0 — 2026-09-05 — The six AMBIENTS are seeded published beside the six leiskat
 *     (ambient-<preset>, each on the first look it fits at its shelf alpha), through the same
 *     bench: a fresh node's AMBIENT shelf is never an empty wall, and prod gets them on the
 *     deploy restart with no publish round. The seed loop is one function now (pure
 *     extraction), so a third registry can join it (wish-atelier-ambient-visuals).
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { systemGhiiFor } from '../compliance-register.js';
import { UI_LAYOUT_PRESETS } from '../app-ui/layouts.js';
import { AMBIENTS, type AtelierAmbient } from '../../data/atelier-ambients.js';
import { DesignBookService, type DesignBookPart } from './service.js';
import { DesignBookError, type PartKind } from './validate.js';

/** A published part with no adoption for this long fades to `aging`. One adopt un-fades it. */
export const AGING_AFTER_DAYS = 60;

/**
 * The six leiskat become the Book's first published parts. Runs at boot, creates only what is
 * missing, and every body goes through the bench — the seed has no side door either.
 */
export async function seedDesignBook(storage: Storage, config: AimeatConfig): Promise<void> {
  const book = new DesignBookService(storage, config);
  const system = systemGhiiFor(config.nodeId);
  await seedParts(book, system, UI_LAYOUT_PRESETS.map((preset) => ({
    id: `leiska-${preset.id}`,
    kind: 'fill',
    title: presetTitle(preset.id),
    summary: `${preset.summary} ${preset.fill}`.slice(0, 240),
    body: preset.layout as unknown as Record<string, unknown>,
    tags: ['leiska', 'seed'],
  })));
  // The six ambients, each on the first look it fits at its shelf alpha — the propose bench
  // proves the combination on that look, so a registry entry the matrix refuses is logged
  // here and never lands, which doubles as a drift check.
  await seedParts(book, system, AMBIENTS.map(ambientSeed));
}

/** A part the node seeds: the same shape a proposal carries. */
interface SeedPart {
  id: string;
  kind: PartKind;
  title: string;
  summary: string;
  body: Record<string, unknown>;
  tags: string[];
}

/** Propose and publish each seed whose address is still free; a refusal is logged, never thrown. */
async function seedParts(book: DesignBookService, system: string, seeds: SeedPart[]): Promise<void> {
  for (const seed of seeds) {
    try {
      const existing = await book.getRecordVersion(seed.id);
      if (existing !== null) continue; // the address is claimed — an operator's Book is theirs
      await book.propose(system, seed, { principal: system });
      await book.setStatus(system, true, seed.id, 'published');
    } catch (err) {
      if (err instanceof DesignBookError) {
        // A seed the bench refuses is a REGISTRY drift, not a seeding problem: say so and move on.
        logger.warn(`design-book seed: "${seed.id}" refused by the bench — ${err.code}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }
}

/** One ambient preset as a seeded part: the demo arrangement will wear it on its first fit. */
function ambientSeed(a: AtelierAmbient): SeedPart {
  return {
    id: `ambient-${a.id}`,
    kind: 'ambient',
    title: ambientTitle(a.id),
    summary: a.feel.slice(0, 240),
    body: { ambient: a.id, alpha: a.shelfAlpha, speed: a.defaultSpeed, look: a.fitsLooks[0] },
    tags: ['ambient', 'seed'],
  };
}

/** The gallery card name for a seeded ambient — the preset, spoken. */
function ambientTitle(presetId: string): string {
  const names: Record<string, string> = {
    'waves': 'The wave',
    'aurora': 'The aurora drift',
    'dust': 'Dust in the light',
    'grid': 'The floor grid',
    'static': 'Static',
    'ink': 'Ink wash',
  };
  return names[presetId] ?? presetId;
}

/** The gallery card name for a seeded preset — the preset id, spoken. */
function presetTitle(presetId: string): string {
  const names: Record<string, string> = {
    'cover': 'Cover page',
    'dashboard': 'Dashboard',
    'browse': 'Browse grid',
    'work-queue': 'Work queue',
    'story-deck': 'Story deck',
    'guided-flow': 'Guided flow',
  };
  return names[presetId] ?? presetId;
}

/**
 * The nightly fade: published parts with zero adoptions past the window turn `aging`.
 * Operator-published parts fade exactly like seeded ones — the Book forgets by USE, not by rank.
 */
export async function runDesignBookAgingJob(storage: Storage, config: AimeatConfig): Promise<void> {
  const book = new DesignBookService(storage, config);
  const system = systemGhiiFor(config.nodeId);
  const cutoff = Date.now() - AGING_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const rows = await book.list({ status: 'published', limit: 200 });
  let faded = 0;
  for (const row of rows) {
    if (row.usage > 0) continue;
    const { part }: { part: DesignBookPart } = await book.get(row.id);
    const publishedAt = Date.parse(part.published_at ?? part.created_at);
    if (Number.isNaN(publishedAt) || publishedAt > cutoff) continue;
    await book.setStatus(system, true, row.id, 'aging');
    faded++;
  }
  if (faded > 0) logger.info(`design-book aging: ${faded} unadopted part(s) faded to aging`);
}
