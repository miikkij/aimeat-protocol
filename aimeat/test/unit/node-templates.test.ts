/**
 * @file node-templates.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The templates the node ships, as the template tools answer for them.
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { nodeTemplateAnswer, nodeTemplateIndex, unknownTemplateMessage } from '../../src/services/node-templates.js';
import { getAppTemplates } from '../../src/data/app-templates.js';
import { MAX_PART_CHARS } from '../../src/services/build-app-layers.js';

describe('node templates', () => {
  it('returns the shell every build text names, with its file and how to start from it', () => {
    const shell = nodeTemplateAnswer('shell-pure-client');
    expect(shell?.source).toBe('node');
    expect(String(shell?.content)).toContain('<html');
    expect(String(shell?.how_to_start)).toContain('content');
  });

  it('returns null for an id the node does not ship, and the message names the shells', () => {
    expect(nodeTemplateAnswer('no-such-template')).toBeNull();
    const message = unknownTemplateMessage('no-such-template');
    expect(message).toContain('no-such-template');
    expect(message).toContain('shell-pure-client');
  });

  it('lists every shipped template, short enough to arrive beside the proposals', () => {
    const index = nodeTemplateIndex();
    expect(index.length).toBe(getAppTemplates().length);
    expect(index.every(t => t.id && t.kind && t.title)).toBe(true);
    expect(JSON.stringify(index, null, 2).length).toBeLessThan(MAX_PART_CHARS / 2);
  });

  it('serves every shell whole in one tool result', () => {
    for (const t of getAppTemplates().filter(x => x.kind === 'app-shell')) {
      expect(JSON.stringify(nodeTemplateAnswer(t.id), null, 2).length, t.id).toBeLessThan(MAX_PART_CHARS);
    }
  });
});
