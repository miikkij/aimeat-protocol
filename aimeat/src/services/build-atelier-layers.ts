/**
 * @file src/services/build-atelier-layers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier build specification in parts a chat can actually receive.
 *
 *   WHY THIS EXISTS. Until 2026-09-19 the Atelier specification had ONE door, GET
 *   /v1/prompts/build-app-atelier, and it is 68 kB of text inside a 207 kB answer. An AI connected
 *   over MCP with no HTTP tool of its own, which is what a chat client is, could not read it at
 *   all; the Classic specification it could, in four parts through aimeat_handbook_get. So the
 *   track this node wants every app built on was the one whose guide a chat could not open, and
 *   the easy road led to Classic. A model said exactly that to the developer on the day this was
 *   written: it started on Atelier, was pointed at a separate guide, and changed to the template
 *   it could begin from at once.
 *
 *   Same rule as build-app-layers.ts: the finished text is CUT at its `## ` headings and never
 *   rewritten, so the whole-document door and these parts can never say different things. There
 *   are no on-demand sections here. The Atelier text is one argument about how a page is made, and
 *   a builder who skips the genre or the patterns builds the stacked default-look page this track
 *   exists to prevent; so every part is listed, and the first says in which order and why.
 * @structure ATELIER_PARTS · ATELIER_HEADING_PART · atelierPiece() · atelierPieceIds()
 * @usage
 *   const piece = atelierPiece(buildAtelierPrompt(config, { mode: 'new' }).full, 'genre', config.baseUrl);
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { MAX_PART_CHARS } from './build-app-layers.js';

export type AtelierPartId = 'start' | 'genre' | 'patterns' | 'look';

/** In reading order. `what` is the line the first part shows for each of the others. */
export const ATELIER_PARTS: Array<{ id: AtelierPartId; what: string }> = [
  { id: 'start', what: 'The interview, what the Atelier track is, the component kit, how a component is customised, data, how to finish and publish, and what is never done.' },
  { id: 'genre', what: 'REQUIRED before any code: an app starts from a genre, a complete page in a committed register, and the publish refuses an app without a register. Also the pattern shelf, the Design Book and the signature.' },
  { id: 'patterns', what: 'How the code is written: six patterns to copy, the living record, and the mosaic that arranges a screen from outside the file.' },
  { id: 'look', what: 'The look presets, the one ambient layer, effects, motion and imagery. Read it before you change anything the genre did not decide for you.' },
];

/**
 * Which part carries each `## ` heading of the Atelier text. A heading missing from this table
 * goes to `start`, and test/unit/build-atelier-layers.test.ts fails on it, so a section added to
 * build-atelier-prompt.ts is placed by a person and not by default.
 */
export const ATELIER_HEADING_PART: Record<string, AtelierPartId> = {
  '': 'start',
  'First, a short interview': 'start',
  'The Atelier track': 'start',
  'The components (`AIMEAT.atelier`)': 'start',
  'A COMPONENT THAT IS NEARLY RIGHT IS CUSTOMISED, NEVER COPIED': 'start',
  'AI inside the app': 'start',
  'Data, in short': 'start',
  'Finishing': 'start',
  'What the review always catches': 'start',
  'Never': 'start',

  'Start from a GENRE — a complete committed register, and the register is required': 'genre',
  'The pattern shelf': 'genre',
  'The Design Book first': 'genre',
  'The signature: this app\'s own hand': 'genre',

  'A LIVING DOCUMENT: A SHEET WHOSE NUMBERS STAND ON EACH OTHER IS A RECORD': 'patterns',
  'Six patterns to copy': 'patterns',
  'The mosaic: the arrangement lives outside your file': 'patterns',

  'The look': 'look',
  'The ambient: the one layer allowed to move at idle': 'look',
  'Effects: still on the words, a moment on a cue, living only behind them': 'look',
  'Motion, and the moment something needs the eye': 'look',
  'Imagery': 'look',
};

export interface AtelierSection { title: string; text: string; part: AtelierPartId; placed: boolean }

/** Cut the finished text at its `## ` headings. A heading inside a code fence is code. */
export function splitAtelierSpec(full: string): AtelierSection[] {
  const sections: AtelierSection[] = [];
  let title = '';
  let lines: string[] = [];
  let inFence = false;
  const close = () => {
    if (!lines.length) return;
    const part = ATELIER_HEADING_PART[title];
    sections.push({ title, text: lines.join('\n'), part: part ?? 'start', placed: part !== undefined });
  };
  for (const line of full.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    if (!inFence && /^## /.test(line)) { close(); title = line.replace(/^## /, ''); lines = []; }
    lines.push(line);
  }
  close();
  return sections;
}

/** What the first part says about the rest, placed right after "The Atelier track". */
function partsIndex(nodeUrl: string): string {
  let out = '### This specification comes in parts\n';
  out += 'You are reading part `start`. The other three belong to the same specification and carry the same authority. '
    + 'Read `genre` and `patterns` BEFORE you write any code: an Atelier app is forked from a genre, and the publish refuses one that names no register. '
    + 'Over MCP: `aimeat_handbook_get { tier: "build-app-atelier/<id>" }`. Over HTTP the whole text in one piece: `GET ' + nodeUrl + '/v1/prompts/build-app-atelier?format=txt`.\n';
  for (const p of ATELIER_PARTS.filter(x => x.id !== 'start')) out += '- `' + p.id + '` — ' + p.what + '\n';
  return out;
}

export interface AtelierPiece { id: AtelierPartId; text: string }

/** One part by id, or null. Joined the way the full text joins its sections. */
export function atelierPiece(full: string, id: string, baseUrl: string): AtelierPiece | null {
  if (!ATELIER_PARTS.some(p => p.id === id)) return null;
  const mine = splitAtelierSpec(full).filter(s => s.part === id);
  if (!mine.length) return null;
  if (id !== 'start') return { id: id as AtelierPartId, text: mine.map(s => s.text).join('\n') };
  const out: string[] = [];
  let indexed = false;
  for (const s of mine) {
    out.push(s.text);
    if (!indexed && s.title === 'The Atelier track') { out.push(partsIndex(baseUrl.replace(/\/+$/, ''))); indexed = true; }
  }
  if (!indexed) out.push(partsIndex(baseUrl.replace(/\/+$/, '')));
  return { id: 'start', text: out.join('\n') };
}

export function atelierPieceIds(): string[] { return ATELIER_PARTS.map(p => p.id); }

export { MAX_PART_CHARS };
