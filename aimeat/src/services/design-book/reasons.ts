/**
 * @file src/services/design-book/reasons.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a builder's reasons go, what an owner's "this one is good" does to them, and
 *   the view that turns them into the list of what Atelier should become next.
 *
 *   THREE THINGS ARE KEPT APART ON PURPOSE (the developer's ruling, 2026-09-20):
 *
 *   WRITING DOWN happens at every publish. The reasons of that version (app-build-notes.ts) go
 *     into the OWNER'S OWN memory, one record per app with its last versions in it, private. A
 *     version that was thrown away keeps its reasons there: a rebuilt app is where the most is
 *     learned, and nothing about it is lost.
 *   COUNTING happens at every publish too, into the Book's records, and is labelled for what it
 *     is: `taken` says builders reached for a part. It does not say the part is good.
 *   KEEPING happens when the OWNER says an app turned out well, and at no other moment. "The build
 *     is finished" is not that moment: he rebuilt one app three times and liked the third. keep()
 *     marks that app's rows, and `kept` is the number a person can trust: parts that are in apps
 *     somebody was satisfied with.
 *
 *   The Book's side is three kinds of record under the node's system identity, public like the
 *   parts themselves, untracked like the usage counter:
 *     atelier.book.reasons.<partId>   { took: Row[], passed: Row[] }   one row per app, newest wins
 *     atelier.book.made               { rows: MadeRow[] }              one row per app + name
 *   An app that is parked or behind an access code writes nothing here: its reasons stay its owner's.
 *
 *   HOW IT GOES STALE. One row per app, so a rebuild replaces its own earlier reason instead of
 *   piling beside it; every list is capped and the oldest rows fall off; a row of an app that was
 *   deleted is removed the next time that part's record is written (forget()).
 * @structure DesignBookReasons: record · keep · forPart · queue · forget
 * @usage await new DesignBookReasons(storage, config).record({ ... });
 * @version-history
 *   v1.1.0 — 2026-09-20 — keptState(): whether the owner said an app turned out well and what its
 *     kept version made by hand, which is what a component's publishing is earned from.
 *   v1.0.0 — 2026-09-20 — Initial (wish-atelierin-ui-kehitys-haltuun-miksi-osa-otettiin-miksi-tehtii).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { systemGhiiFor } from '../compliance-register.js';
import type { BuildNotes } from '../app-build-notes.js';

export const REASONS_KEY_PREFIX = 'atelier.book.reasons.';
export const MADE_KEY = 'atelier.book.made';
export const OWNER_NOTES_PREFIX = 'atelier.buildnotes.';

const ROWS_PER_PART = 100;
const MADE_ROWS = 500;
const VERSIONS_KEPT = 30;

export interface ReasonRow { app: string; version: number; why: string; at: string; kept: boolean }
export interface MadeRow extends ReasonRow { name: string; what: string }

interface PartReasons { spec: 'aimeat.designbook.reasons/v1'; id: string; took: ReasonRow[]; passed: ReasonRow[] }
interface MadeRecord { spec: 'aimeat.designbook.made/v1'; rows: MadeRow[] }

export interface OwnerVersionNotes extends BuildNotes { version: number; at: string; level: string | null; register: string | null }
interface OwnerNotesRecord { spec: 'aimeat.buildnotes/v1'; app: string; kept_version: number | null; kept_at: string | null; versions: OwnerVersionNotes[] }

const parse = <T>(rec: MemoryRecord | null): T | null => {
  if (!rec) return null;
  // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable reasons record starts again empty; it is commentary, never a gate
  try { return (typeof rec.value === 'string' ? JSON.parse(rec.value) : rec.value) as T; } catch { return null; }
};

export class DesignBookReasons {
  /** Only the node's id is needed (the Book lives under the node's system identity). */
  constructor(private readonly storage: Storage, private readonly config: Pick<AimeatConfig, 'nodeId'>) {}

  private book(): string { return systemGhiiFor(this.config.nodeId); }

  private async put(owner: string, key: string, value: unknown, visibility: 'public' | 'private', tags: string[]): Promise<void> {
    const prev = await this.storage.getMemory(owner, key);
    const now = new Date().toISOString();
    await this.storage.setMemory({
      key, ownerGaii: owner, value: JSON.stringify(value), visibility, tags, ttlHours: null,
      version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
    });
  }

  /**
   * One published version's reasons. Always into the owner's own record; into the Book's records
   * only when the app is one anybody may open (`shareable`).
   */
  async record(input: {
    ownerGhii: string; ownerName: string; filename: string; version: number; notes: BuildNotes;
    level: string | null; register: string | null; shareable: boolean;
  }): Promise<{ took: number; passed: number; made: number; shared: boolean }> {
    const app = `${input.ownerName}/${input.filename}`;
    const at = new Date().toISOString();

    const ownerKey = OWNER_NOTES_PREFIX + input.filename;
    const mine = parse<OwnerNotesRecord>(await this.storage.getMemory(input.ownerGhii, ownerKey))
      ?? { spec: 'aimeat.buildnotes/v1' as const, app, kept_version: null, kept_at: null, versions: [] };
    mine.versions = [...mine.versions.filter(v => v.version !== input.version),
      { version: input.version, at, level: input.level, register: input.register, ...input.notes }].slice(-VERSIONS_KEPT);
    await this.put(input.ownerGhii, ownerKey, mine, 'private', ['atelier', 'buildnotes']);

    if (input.shareable) {
      // A new version is not yet one the owner called good, whatever the last one was.
      const row = (why: string): ReasonRow => ({ app, version: input.version, why, at, kept: false });
      const touched = new Set([...input.notes.took, ...input.notes.passed].map(n => n.part));
      for (const id of touched) {
        const key = REASONS_KEY_PREFIX + id;
        const rec = parse<PartReasons>(await this.storage.getMemory(this.book(), key))
          ?? { spec: 'aimeat.designbook.reasons/v1' as const, id, took: [], passed: [] };
        const took = input.notes.took.find(n => n.part === id);
        const passed = input.notes.passed.find(n => n.part === id);
        rec.took = [...rec.took.filter(r => r.app !== app), ...(took ? [row(took.why)] : [])].slice(-ROWS_PER_PART);
        rec.passed = [...rec.passed.filter(r => r.app !== app), ...(passed ? [row(passed.why)] : [])].slice(-ROWS_PER_PART);
        await this.put(this.book(), key, rec, 'public', ['designbook', 'reasons']);
      }
      const made = parse<MadeRecord>(await this.storage.getMemory(this.book(), MADE_KEY)) ?? { spec: 'aimeat.designbook.made/v1' as const, rows: [] };
      made.rows = [...made.rows.filter(r => r.app !== app),
        ...input.notes.made.map(m => ({ ...row(m.why), name: m.name, what: m.what }))].slice(-MADE_ROWS);
      await this.put(this.book(), MADE_KEY, made, 'public', ['designbook', 'made']);
    }
    return { took: input.notes.took.length, passed: input.notes.passed.length, made: input.notes.made.length, shared: input.shareable };
  }

  /**
   * The owner says this app turned out well (or takes it back). Marks the rows of the version
   * that is live NOW, and answers with what that version holds, which is what is worth putting
   * into the Book: the parts it kept, and what it had to make.
   */
  async keep(input: { ownerGhii: string; ownerName: string; filename: string; kept: boolean }): Promise<
    { app: string; kept: boolean; version: number | null; register: string | null; took: BuildNotes['took']; made: BuildNotes['made'] } | null
  > {
    const app = `${input.ownerName}/${input.filename}`;
    const ownerKey = OWNER_NOTES_PREFIX + input.filename;
    const mine = parse<OwnerNotesRecord>(await this.storage.getMemory(input.ownerGhii, ownerKey));
    const latest = mine?.versions.at(-1);
    if (!mine || !latest) return null;
    mine.kept_version = input.kept ? latest.version : null;
    mine.kept_at = input.kept ? new Date().toISOString() : null;
    await this.put(input.ownerGhii, ownerKey, mine, 'private', ['atelier', 'buildnotes']);

    for (const id of new Set([...latest.took, ...latest.passed].map(n => n.part))) {
      const key = REASONS_KEY_PREFIX + id;
      const rec = parse<PartReasons>(await this.storage.getMemory(this.book(), key));
      if (!rec) continue;
      const mark = (r: ReasonRow): ReasonRow => (r.app === app ? { ...r, kept: input.kept } : r);
      rec.took = rec.took.map(mark);
      rec.passed = rec.passed.map(mark);
      await this.put(this.book(), key, rec, 'public', ['designbook', 'reasons']);
    }
    const made = parse<MadeRecord>(await this.storage.getMemory(this.book(), MADE_KEY));
    if (made?.rows.some(r => r.app === app)) {
      made.rows = made.rows.map(r => (r.app === app ? { ...r, kept: input.kept } : r));
      await this.put(this.book(), MADE_KEY, made, 'public', ['designbook', 'made']);
    }
    return { app, kept: input.kept, version: latest.version, register: latest.register ?? null, took: latest.took, made: latest.made };
  }

  /**
   * Whether the owner has said this app turned out well, and what its kept version made by hand.
   * What a component's publishing is earned from (service.ts): the owner's word, never a finished build.
   */
  async keptState(ownerGhii: string, filename: string): Promise<{ kept: boolean; version: number | null; made: string[] }> {
    const mine = parse<OwnerNotesRecord>(await this.storage.getMemory(ownerGhii, OWNER_NOTES_PREFIX + filename));
    const version = mine?.versions.find(v => v.version === mine.kept_version);
    return { kept: !!version, version: version?.version ?? null, made: version?.made.map(m => m.name) ?? [] };
  }

  /** One part: how often it was taken, in how many apps somebody was satisfied with, and the words. */
  async forPart(id: string): Promise<{ taken: number; kept: number; passed_over: number; took: ReasonRow[]; passed: ReasonRow[] }> {
    const rec = parse<PartReasons>(await this.storage.getMemory(this.book(), REASONS_KEY_PREFIX + id));
    const took = rec?.took ?? [];
    const passed = rec?.passed ?? [];
    return { taken: took.length, kept: took.filter(r => r.kept).length, passed_over: passed.length, took, passed };
  }

  /**
   * What Atelier should become next, read from what builders wrote: the things made by hand
   * because the Book had nothing (grouped by name, the ones in kept apps first), and the parts
   * most often looked at and left, with the reasons.
   */
  async queue(): Promise<{
    made: Array<{ name: string; times: number; kept: number; rows: MadeRow[] }>;
    passed_over: Array<{ part: string; times: number; reasons: ReasonRow[] }>;
  }> {
    const made = parse<MadeRecord>(await this.storage.getMemory(this.book(), MADE_KEY))?.rows ?? [];
    const byName = new Map<string, MadeRow[]>();
    for (const r of made) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
    const records = await this.storage.listMemory(this.book(), { prefix: REASONS_KEY_PREFIX, tags: ['designbook'] });
    const passedOver = records
      .map(rec => parse<PartReasons>(rec))
      .filter((r): r is PartReasons => !!r && r.passed.length > 0)
      .map(r => ({ part: r.id, times: r.passed.length, reasons: r.passed.slice(-8) }))
      .sort((a, b) => b.times - a.times);
    return {
      made: [...byName].map(([name, rows]) => ({ name, times: rows.length, kept: rows.filter(r => r.kept).length, rows: rows.slice(-8) }))
        .sort((a, b) => b.kept - a.kept || b.times - a.times),
      passed_over: passedOver,
    };
  }

  /** An app was deleted: its rows leave the Book's records. The owner's own record is theirs to keep. */
  async forget(ownerGhii: string, ownerName: string, filename: string): Promise<void> {
    const app = `${ownerName}/${filename}`;
    // Which part records this app ever wrote into is in its owner's own notes, version by version.
    const mine = parse<OwnerNotesRecord>(await this.storage.getMemory(ownerGhii, OWNER_NOTES_PREFIX + filename));
    const partIds = (mine?.versions ?? []).flatMap(v => [...v.took, ...v.passed].map(n => n.part));
    for (const id of new Set(partIds)) {
      const key = REASONS_KEY_PREFIX + id;
      const rec = parse<PartReasons>(await this.storage.getMemory(this.book(), key));
      if (!rec) continue;
      rec.took = rec.took.filter(r => r.app !== app);
      rec.passed = rec.passed.filter(r => r.app !== app);
      await this.put(this.book(), key, rec, 'public', ['designbook', 'reasons']);
    }
    const made = parse<MadeRecord>(await this.storage.getMemory(this.book(), MADE_KEY));
    if (made?.rows.some(r => r.app === app)) {
      made.rows = made.rows.filter(r => r.app !== app);
      await this.put(this.book(), MADE_KEY, made, 'public', ['designbook', 'made']);
    }
  }
}
