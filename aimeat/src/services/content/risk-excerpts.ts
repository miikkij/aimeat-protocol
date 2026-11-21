/**
 * @file src/services/content/risk-excerpts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words behind a kept content risk entry, for the person who decides it: the item's
 *   subject read back from the id its entry is kept under, and the excerpt of each mark rebuilt from
 *   the item's current words (docs/internal/content-risk-accept-plan.md). A stored entry keeps no
 *   words of the content (risk-store.ts), and a person cannot accept what they cannot see.
 *
 *   SAME WORDS OR NONE. The words are read the way their point read them (a memory value as
 *   risk-text.ts riskTextOf, a message as its subject and body, a post as its title and body, a text
 *   file as its bytes), hashed, and compared with the entry's hash. Another hash: the item changed
 *   since it was marked, the offsets no longer point at the phrase, and no excerpt is given
 *   (`changed: true`). A PDF or a picture, marked from text the content pipeline took out of it, and a
 *   mail or drive file read live give no excerpt either.
 *
 *   WHO READS. Only the list of the person who decides the entry calls this (risk-hold.ts
 *   listRiskItemsFor), so every item is one the caller owns or runs as a workspace's admin.
 * @structure subjectFromEntry · wordsOf · marksWithWords
 * @usage const s = subjectFromEntry(home, id, source); const w = s && await wordsOf(deps, s);
 * @version-history
 *   v1.0.0 — 2026-11-22 — Initial (wish-riskimerkinn-t-oma-sis-lt-ei-merkitse-ja-ihminen-voi-hyv-ksy).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { riskTextOf } from './risk-text.js';
import { excerptOf } from './risk-rules.js';
import { hashText, openMarks } from './risk-core.js';
import type { RiskHome, RiskSubject } from './risk-store.js';
import type { RiskMarks, RiskKind } from './risk-types.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** A text file larger than this gives no excerpt (risk-intake.ts reads it whole up to the same size). */
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const TEXT_TYPES = /^(?:text\/|application\/(?:json|xml|xhtml\+xml|ld\+json|x-ndjson|javascript)|message\/rfc822)/iu;

/** Split `a:b:rest` once after the prefix: the first part has no colon, the rest may. */
function afterPrefix(id: string, prefix: string): [string, string] | null {
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  const at = rest.indexOf(':');
  return at > 0 ? [rest.slice(0, at), rest.slice(at + 1)] : null;
}

/**
 * The subject an entry is kept for, from its home and id (risk-store.ts subjectIdOf), or null when it
 * cannot be read back. A person's file or memory record carries its own `source` in its facts entry.
 */
export function subjectFromEntry(
  home: RiskHome, id: string, source?: { kind: string; owner: string; key: string },
): RiskSubject | null {
  if (source && (source.kind === 'memory' || source.kind === 'file')) return { kind: source.kind, owner: source.owner, key: source.key };
  if (home.kind === 'workspace') {
    if (id.startsWith('memory:')) return { kind: 'memory', owner: '', key: id.slice('memory:'.length) };
    if (id.startsWith('comment:')) return { kind: 'comment', org: home.org, ws: home.ws, key: id.slice('comment:'.length) };
    const row = afterPrefix(id, 'row:');
    return row ? { kind: 'row', org: home.org, ws: home.ws, space: row[0], id: row[1] } : null;
  }
  if (id.startsWith('dm:')) return { kind: 'dm', owner: home.owner, id: id.slice(3) };
  const board = afterPrefix(id, 'board:');
  if (board) return { kind: 'board', owner: home.owner, boardId: board[0], id: board[1] };
  const msg = afterPrefix(id, 'agent-message:');
  if (msg) return { kind: 'agent-message', owner: msg[0], agent: msg[0], id: msg[1] };
  return null;
}

const joinMessage = (a: string | null | undefined, b: string | null | undefined): string =>
  [a ?? '', b ?? ''].filter((s) => s.trim()).join('\n\n');

/** The item's current words and their hash, read the way its point read them; null when they cannot be read. */
export async function wordsOf(deps: Deps, s: RiskSubject): Promise<{ text: string; hash: string } | null> {
  const asText = (text: string) => ({ text, hash: hashText(text) });
  switch (s.kind) {
    case 'memory': {
      const rec = s.owner
        ? await deps.storage.getMemory(s.owner, s.key)
        : (await deps.storage.getMemoryByKeysAnyOwner([s.key]))[0] ?? null;
      return rec ? asText(riskTextOf(rec.value)) : null;
    }
    case 'file': {
      const meta = await deps.storage.getStorageFileMeta(s.owner, s.key);
      if (!meta || !TEXT_TYPES.test(meta.mimeType ?? '') || meta.size > MAX_TEXT_FILE_BYTES) return null;
      const file = await deps.storage.getStorageFile(s.owner, s.key);
      if (!file?.data) return null;
      const bytes = Buffer.from(file.data);
      return { text: bytes.toString('utf8'), hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
    }
    case 'comment': {
      const rec = (await deps.storage.getMemoryByKeysAnyOwner([s.key]))[0];
      const body = (rec?.value as { body?: unknown } | undefined)?.body;
      return typeof body === 'string' ? asText(body) : null;
    }
    case 'row': {
      const row = await deps.storage.getWorkspaceRow(s.org, s.ws, s.space, s.id);
      return row ? asText(riskTextOf(row.body)) : null;
    }
    case 'dm': {
      const m = await deps.storage.getDirectMessage(s.id, s.owner);
      return m ? asText(joinMessage(m.subject, m.body)) : null;
    }
    case 'board': {
      const p = await deps.storage.getPost(s.boardId, s.id);
      return p ? asText(joinMessage(p.title, p.body)) : null;
    }
    case 'agent-message': {
      const m = await deps.storage.getMessage(s.id);
      return m ? asText(m.content ?? '') : null;
    }
    case 'external': return null;
  }
}

export interface MarkWords { kind: RiskKind; rule: string; excerpt?: string; accepted: boolean }

/** The most of one matched phrase the list shows: excerptOf's own limit. */
const PHRASE = 160;

/**
 * Each mark of an entry with the words it matched, from the item's current words, and whether the
 * words changed since the entry was written (then no words are given). The excerpt is the match
 * itself (invisible characters spelled out, runs of space made one), not the text around it: the
 * person decides on the phrase, and two marks in one sentence would otherwise repeat the sentence.
 */
export function marksWithWords(entry: RiskMarks, words: { text: string; hash: string } | null): { marks: MarkWords[]; changed: boolean } {
  const open = new Set(openMarks(entry.marks, entry.accepted));
  const same = !!words && words.hash === entry.contentHash;
  const phrase = (start: number, end: number): string => {
    const e = excerptOf(words!.text.slice(start, Math.min(end, start + PHRASE)), 0, Math.min(end - start, PHRASE)).trim();
    return end - start > PHRASE ? `${e}…` : e;
  };
  return {
    changed: !!words && !same,
    marks: entry.marks.map((m) => ({
      kind: m.kind, rule: m.rule, accepted: !open.has(m),
      ...(same ? { excerpt: phrase(m.start, m.end) } : {}),
    })),
  };
}
