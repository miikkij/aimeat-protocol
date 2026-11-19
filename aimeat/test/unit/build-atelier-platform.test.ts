/**
 * @file test/unit/build-atelier-platform.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier specification's platform sections (services/builder/atelier-platform.ts):
 *   every section the index names is served, each fits one tool result, none of them teaches the
 *   retired Classic track or its tiers, part `start` names the index, and the parts still rebuild
 *   the full text because the platform sections are not in it.
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { buildAtelierPrompt } from '../../src/services/builder/atelier-prompt.js';
import { ATELIER_PARTS, atelierPiece, atelierPieceIds, MAX_PART_CHARS } from '../../src/services/builder/atelier-layers.js';
import { ATELIER_PLATFORM, atelierPlatformPiece } from '../../src/services/builder/atelier-platform.js';

const LONG = 'https://a-rather-long-organisation-node-address.example.com';
const config = { baseUrl: LONG, nodeId: 'node-example' } as never;
const full = buildAtelierPrompt(config, { mode: 'new' }).full;

/** What a platform section must never teach: the Classic track, its tiers, its shells, its hand-written sign-in. */
const CLASSIC = /\bT[123]\b|shell-pure-client|shell-cortex|shell-extension|\bclassic\b|onSession|daisy/i;

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

  it('teaches nothing of the Classic track or its tiers', () => {
    for (const id of ['platform', ...ATELIER_PLATFORM.map(s => s.id)]) {
      const text = atelierPlatformPiece(id, LONG)!.text;
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

  it('points server-side work at the extension skill and the Microservices Central', () => {
    const text = atelierPlatformPiece('server-side', LONG)!.text;
    expect(text).toContain('node:aimeat-extension-builder');
    expect(text).toContain('Microservices Central');
    expect(ATELIER_PARTS.some(p => p.id === ('server-side' as never))).toBe(false);
  });
});
