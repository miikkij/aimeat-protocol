/**
 * @file node-templates.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The templates the node ships, as the template tools answer for them.
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
  nodeTemplateAnswer, nodeTemplateIndex, unknownTemplateMessage, splitAtLines, MAX_TEMPLATE_CONTENT_CHARS,
} from '../../src/services/node-templates.js';
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
      const answer = nodeTemplateAnswer(t.id)!;
      expect(answer.parts, t.id).toBeUndefined();
      expect(JSON.stringify(answer, null, 2).length, t.id).toBeLessThan(MAX_PART_CHARS);
    }
  });

  it('serves EVERY shipped template in answers that fit, and the parts joined are the file', () => {
    // Five game-genre templates are 26 to 32 kB. Until 2026-09-19 they came back whole, which a
    // chat never received: the client keeps a result of that size out of the conversation.
    let inParts = 0;
    for (const t of getAppTemplates()) {
      const first = nodeTemplateAnswer(t.id)!;
      const count = typeof first.parts === 'number' ? first.parts : 1;
      if (count > 1) inParts++;
      let joined = '';
      for (let part = 1; part <= count; part++) {
        const answer = nodeTemplateAnswer(t.id, part)!;
        expect(JSON.stringify(answer, null, 2).length, `${t.id} part ${part}`).toBeLessThan(MAX_PART_CHARS);
        joined += String(answer.content);
      }
      expect(joined, t.id).toBe(t.content);
    }
    expect(inParts).toBeGreaterThan(0);
  });

  it('refuses a part the template does not have, and says which it has', () => {
    const big = getAppTemplates().find(t => t.content.length > MAX_TEMPLATE_CONTENT_CHARS)!;
    const parts = nodeTemplateAnswer(big.id)!.parts as number;
    expect(String(nodeTemplateAnswer(big.id, parts + 1)!.part_error)).toContain(`1 to ${parts}`);
    expect(String(nodeTemplateAnswer(big.id, 0)!.part_error)).toContain('parts 1 to');
    expect(nodeTemplateAnswer(big.id, 1)!.how_to_read).toBeTruthy();
  });

  it('cuts at line ends, and inside a line only when one line is longer than the limit', () => {
    expect(splitAtLines('aa\nbb\ncc\n', 6)).toEqual(['aa\nbb\n', 'cc\n']);
    expect(splitAtLines('abcdefgh\nij', 3).join('')).toBe('abcdefgh\nij');
    expect(splitAtLines('abcdefgh\nij', 3).every(p => p.length <= 3)).toBe(true);
    expect(splitAtLines('', 5)).toEqual([]);
  });
});
