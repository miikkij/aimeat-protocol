/**
 * @file compliance-print-tasks.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The arithmetic of the Compliance printout (public/views/admin/compliance-tab.print-
 *   tasks.js): the tasks grouped by person, with each maker's apps per task and an app named once per
 *   task however many gaps say it; which uses and apps get a full description; the state page's
 *   counts. aimeat.io's printout ran past 180 pages because an app was printed in every gap table.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-print-tasks.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { personTasks, fullDescriptions, stateCounts } from '../../public/views/admin/compliance-tab.print-tasks.js';

const app = (owner: string, file: string, reach: string, extra: Record<string, unknown> = {}) =>
  ({ app: `${owner}/${file}`, owner, title: file.replace('.html', '').toUpperCase(), reach, uses_ai: false, annex3: null, tells_ai: null, rows: [], ...extra });

const REPORT = {
  gaps: [
    { kind: 'undocumented-ai-activity', evidence: { model: 'grok-4.3' } },
    { kind: 'app-uses-ai-not-in-register', evidence: { app: 'teemu/cv.html' } },
    { kind: 'app-declares-generation-with-gap', evidence: { app: 'jouni/news.html', gap: 'no-disclosure' } },
  ],
  processing: {
    apps: [
      app('teemu', 'cv.html', 'exposed', { uses_ai: true, annex3: 'employment', tells_ai: false }),
      app('jouni', 'news.html', 'exposed'),
      app('jouni', 'notes.html', 'self', { uses_ai: true, tells_ai: true }),
      app('jouni', 'game.html', 'unknown'),
      app('jouni', 'clock.html', 'none'),
    ],
    apps_by_reach: { exposed: 2, shared: 0, unknown: 1, self: 1, none: 1 },
    gaps: [
      { kind: 'app-personal-data-unstated', evidence: { scope: 'app', owner: 'jouni', app: 'game.html', families: [] } },
      { kind: 'app-register-without-privacy-notice', evidence: { scope: 'app', owner: 'jouni', app: 'news.html' } },
      { kind: 'app-personal-data-without-register', evidence: { scope: 'app', owner: 'jouni', app: 'news.html' } },
      { kind: 'app-register-without-privacy-notice', evidence: { scope: 'app', owner: 'teemu', app: 'cv.html' } },
      { kind: 'framework-unanswered', evidence: { scope: 'node', framework: 'gdpr' } },
      { kind: 'framework-unanswered', evidence: { scope: 'node', framework: 'nis2' } },
    ],
  },
};

const USES = [
  { id: 'uc-cv', title: 'CV Parser', apps: ['teemu/cv.html'], unanswered: 3 },
  { id: 'uc-notes', title: 'Notes', apps: ['jouni/notes.html'], unanswered: 0 },
  { id: 'uc-agent', title: 'news-writer', apps: [], unanswered: 2 },
];
const open = (u: { unanswered: number }) => u.unanswered;

describe('personTasks', () => {
  const t = personTasks({ report: REPORT, uses: USES, savedIds: new Set(['uc-notes']), open, highIds: new Set(['uc-cv']), gapThing: (g: { evidence: { framework?: string; model?: string } }) => g.evidence.framework || g.evidence.model || '' });

  it('gives the administrator the found uses, the high-risk decision, the uses that are not apps and the node\'s gaps', () => {
    expect(t.operator.map(k => k.task)).toEqual(['save', 'high', 'answer', 'gap', 'gap']);
    expect(t.operator.find(k => k.task === 'answer')).toMatchObject({ n: 2, items: ['news-writer'] });
    expect(t.operator.find(k => k.kind === 'framework-unanswered')).toMatchObject({ n: 2, items: ['gdpr', 'nis2'] });
  });

  it('gives each maker their apps per task, and never repeats the AI gaps the uses already say', () => {
    const jouni = t.makers.find(m => m.owner === 'jouni')!;
    expect(jouni.tasks.map(k => k.task)).toEqual(['writeMap', 'register', 'notice', 'label']);
    expect(jouni.tasks.find(k => k.task === 'writeMap')!.items).toEqual([{ title: 'GAME' }]);
    const teemu = t.makers.find(m => m.owner === 'teemu')!;
    expect(teemu.tasks).toEqual([{ task: 'aiAct', items: [{ title: 'CV', n: 3 }] }, { task: 'notice', items: [{ title: 'CV' }] }]);
    expect(t.operator.some(k => k.kind === 'app-uses-ai-not-in-register')).toBe(false);
  });
});

describe('fullDescriptions', () => {
  it('describes in full a use that is not an app, an Annex III or high use, and an exposed app once', () => {
    const f = fullDescriptions({ report: REPORT, uses: USES, highIds: new Set() });
    expect(f.uses.map(u => u.id)).toEqual(['uc-cv', 'uc-agent']);
    expect(f.apps.map(a => a.app)).toEqual(['jouni/news.html']);
  });

  it('leaves an app only its user sees to its one line', () => {
    const f = fullDescriptions({ report: REPORT, uses: USES, highIds: new Set() });
    expect(f.uses.some(u => u.id === 'uc-notes')).toBe(false);
  });
});

describe('stateCounts', () => {
  it('counts the apps by reach, the missing records and notices, and the AI apps with no label', () => {
    expect(stateCounts(REPORT)).toMatchObject({ apps: 5, exposed: 2, self: 1, none: 1, unknown: 1, noRegister: 1, noNotice: 2, aiApps: 2, noLabel: 1 });
  });

  it('is all zeros for a report without the app lines', () => {
    expect(stateCounts({})).toMatchObject({ apps: 0, exposed: 0, noRegister: 0, aiApps: 0 });
  });
});
