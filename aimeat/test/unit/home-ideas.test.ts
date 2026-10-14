/**
 * @file test/unit/home-ideas.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/home-ideas.ts parseHomeIdeas against what an operator can save, and the
 *   seeded documents (services/prompt-defaults/home-ideas.ts) against each other: every language
 *   parses with no problem and carries the same ids, groups, kinds and apps.
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (wish-esimerkit-agenteista-ja-sovelluksista-kotiruudulle-mielikuvi).
 */
import { describe, it, expect } from 'vitest';
import { parseHomeIdeas } from '../../src/services/home-ideas.js';
import { HOME_IDEAS_SEEDS } from '../../src/services/prompt-defaults/home-ideas.js';

const seed = HOME_IDEAS_SEEDS[0];
const docs: Record<string, string> = { en: seed.content, ...(seed.locales ?? {}) };

describe('parseHomeIdeas', () => {
  it('gives an empty list and the reason for text that is not JSON', () => {
    const { ideas, problems } = parseHomeIdeas('{ "agents": [ oops');
    expect(ideas.agents).toEqual([]);
    expect(problems[0]).toMatch(/not JSON/);
  });

  it('gives an empty list for JSON that is not an object', () => {
    expect(parseHomeIdeas('[1,2]').problems[0]).toMatch(/not a JSON object/);
  });

  it('leaves out an entry that lacks a field and names it, and keeps the rest', () => {
    const doc = JSON.parse(seed.content);
    delete doc.agents[0].say;
    doc.agents[2].when = 'weekly';
    doc.agents.push({ ...doc.agents[3] });
    const { ideas, problems } = parseHomeIdeas(JSON.stringify(doc));
    expect(ideas.agents.map((a) => a.id)).not.toContain('minutes');
    expect(ideas.agents.length).toBe(doc.agents.length - 3);
    expect(problems.join('\n')).toMatch(/"minutes" lacks say/);
    expect(problems.join('\n')).toMatch(/when is "weekly"/);
    expect(problems.join('\n')).toMatch(/appears twice/);
  });

  it('drops the agent link of an app idea whose agent idea is not in the list', () => {
    const doc = JSON.parse(seed.content);
    doc.apps[0].agent = 'nobody';
    const { ideas, problems } = parseHomeIdeas(JSON.stringify(doc));
    expect(ideas.apps[0].agent).toBeNull();
    expect(problems.join('\n')).toMatch(/names the agent idea "nobody"/);
  });
});

describe('the seeded home ideas', () => {
  it('is one document in English, Finnish and Spanish', () => {
    expect(Object.keys(docs).sort()).toEqual(['en', 'es', 'fi']);
  });

  for (const [lang, text] of Object.entries(docs)) {
    it(`parses in ${lang} with no problem`, () => {
      const { ideas, problems } = parseHomeIdeas(text);
      expect(problems).toEqual([]);
      expect(ideas.agents.length).toBe(10);
      expect(ideas.apps.length).toBe(6);
      expect(ideas.groups.length).toBe(6);
    });

    it(`carries no em-dash in ${lang}`, () => {
      expect(text.includes('—')).toBe(false);
    });
  }

  it('has the same ids, groups, kinds and apps in every language', () => {
    const shape = (text: string) => {
      const { ideas } = parseHomeIdeas(text);
      return {
        groups: ideas.groups.map((g) => g.id),
        agents: ideas.agents.map((a) => [a.id, a.group, a.when, a.app]),
        apps: ideas.apps.map((p) => [p.id, p.ready_app, p.agent]),
      };
    };
    const en = shape(docs.en);
    expect(shape(docs.fi)).toEqual(en);
    expect(shape(docs.es)).toEqual(en);
  });

  it('files every agent idea under a group the list has', () => {
    const { ideas } = parseHomeIdeas(docs.en);
    const groups = new Set(ideas.groups.map((g) => g.id));
    for (const a of ideas.agents) expect(groups.has(a.group)).toBe(true);
  });
});
