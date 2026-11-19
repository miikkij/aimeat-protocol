/**
 * @file test/unit/build-atelier-platform.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier specification's platform sections (services/builder/atelier-platform.ts):
 *   every section the index names is served, each fits one tool result, none of them teaches the
 *   retired Classic track or its tiers, part `start` names the index, and the parts still rebuild
 *   the full text because the platform sections are not in it.
 * @version-history
 *   v1.1.0 — 2026-11-19 — `other-owners` and the pointer the served `group` and `row-spaces` end with.
 *   v1.0.0 — 2026-11-19 — Initial, with `from-classic` and the paste delivery.
 */
import { describe, it, expect } from 'vitest';
import { buildAtelierPrompt } from '../../src/services/builder/atelier-prompt.js';
import { ATELIER_PARTS, atelierPiece, atelierPieceIds, MAX_PART_CHARS } from '../../src/services/builder/atelier-layers.js';
import { ATELIER_PLATFORM, atelierPlatformPiece } from '../../src/services/builder/atelier-platform.js';

const LONG = 'https://a-rather-long-organisation-node-address.example.com';
const config = { baseUrl: LONG, nodeId: 'node-example' } as never;
const full = buildAtelierPrompt(config, { mode: 'new' }).full;

/** What a platform section must never teach: the Classic track, its tiers, its shells, its hand-written sign-in. */
// "classic" alone is a word the engines use in its own sense (three.js's classic script, Mermaid's
// look "classic"), so the track is looked for by how it is named.
const CLASSIC = /\bT[123]\b|shell-pure-client|shell-cortex|shell-extension|Classic (track|spec)|content="classic"|onSession|daisy/i;

describe('Atelier platform sections', () => {
  it('serves every section the index names, under one heading each', () => {
    for (const s of ATELIER_PLATFORM) {
      const piece = atelierPlatformPiece(s.id, LONG);
      expect(piece, s.id).not.toBeNull();
      expect(piece!.text.startsWith('## '), s.id).toBe(true);
    }
  });

  it('keeps each section and the index under what one tool result carries', () => {
    for (const id of ['platform', ...ATELIER_PLATFORM.map(s => s.id)]) {
      expect(atelierPlatformPiece(id, LONG)!.text.length, id).toBeLessThanOrEqual(MAX_PART_CHARS);
    }
  });

  it('teaches nothing of the Classic track or its tiers, except the section that moves a Classic app', () => {
    for (const id of ['platform', ...ATELIER_PLATFORM.map(s => s.id).filter(x => x !== 'from-classic')]) {
      // The index names the section that moves a Classic app; that one line may say Classic.
      const text = atelierPlatformPiece(id, LONG)!.text.split('\n').filter(l => !l.startsWith('- `from-classic`')).join('\n');
      expect(CLASSIC.exec(text)?.[0] ?? null, id).toBeNull();
    }
  });

  it('is reached through atelierPiece and listed by atelierPieceIds', () => {
    expect(atelierPiece(full, 'group', LONG)!.text).toContain('## ');
    expect(atelierPieceIds()).toContain('platform');
    expect(atelierPieceIds()).toContain('server-side');
    expect(atelierPiece(full, 'no-such-section', LONG)).toBeNull();
  });

  it('is named in part `start`, which stays under the limit on a long node address', () => {
    const start = atelierPiece(full, 'start', LONG)!.text;
    expect(start).toContain('- `platform` —');
    expect(start.length).toBeLessThanOrEqual(MAX_PART_CHARS);
  });

  it('stays out of the full text, so the parts still rebuild it', () => {
    expect(full).not.toContain('## The platform: sections only some apps need');
    expect(full).not.toContain('## Server-side work: an extension');
  });

  it('moves a Classic app with the Atelier shell, its keys kept and the migration pitfall named', () => {
    const text = atelierPlatformPiece('from-classic', LONG)!.text;
    expect(text).toContain('AIMEAT.atelier.section(');
    expect(text).toContain('every memory key');
    expect(text).toContain('atelier-kit-migration-traps');
    expect(text).not.toMatch(/\bT[123]\b|shell-pure-client/);
  });

  it('gives an AI that cannot connect a preface and the publish-by-hand section', () => {
    const paste = buildAtelierPrompt(config, { mode: 'new', delivery: 'paste' }).full;
    expect(paste.startsWith('## Before you start: you are not connected')).toBe(true);
    expect(paste).toContain('## When the app is ready');
    expect(paste).toContain(full);
    expect(buildAtelierPrompt(config, { mode: 'new' }).full).toBe(full);
  });

  it('serves `other-owners` with the rules a two-account app meets, and group and row-spaces point at it', () => {
    const text = atelierPlatformPiece('other-owners', LONG)!.text;
    for (const needle of ['aimeat_organism_member_add', '"extensions": ["<installer>/<extension>"]', 'organism:direct',
      '"apps": ["<owner>/<filename>"]', "'workspace:' + organismId", 'ctx.changed({ owners', 'writes_past_app_rules', 'two accounts, both agents']) {
      expect(text, needle).toContain(needle);
    }
    expect(atelierPlatformPiece('platform', LONG)!.text).toContain('- `other-owners` —');
    for (const id of ['group', 'row-spaces']) expect(atelierPlatformPiece(id, LONG)!.text, id).toContain('read the section `other-owners`');
    expect(atelierPlatformPiece('files', LONG)!.text).not.toContain('`other-owners`');
    expect(full).not.toContain("## Other people's accounts");
  });

  it('points server-side work at the extension skill and the Microservices Central', () => {
    const text = atelierPlatformPiece('server-side', LONG)!.text;
    expect(text).toContain('node:aimeat-extension-builder');
    expect(text).toContain('Microservices Central');
    expect(ATELIER_PARTS.some(p => p.id === ('server-side' as never))).toBe(false);
  });
});
