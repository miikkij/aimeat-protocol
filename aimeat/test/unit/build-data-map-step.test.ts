/**
 * @file test/unit/build-data-map-step.test.ts
 * @description Both build interviews include the data map step (services/build-data-map-step.ts):
 *   the three questions, the scenario with named people that waits for a yes, the organism
 *   workspace for team data and the app's `open_to` setting. The interviews' existing questions are
 *   held word for word, because the step was added beside them and replaced nothing. The Atelier
 *   proposal states the map, and the Atelier "Data, in short" carries the team branch.
 * @usage cd aimeat && pnpm exec vitest run test/unit/build-data-map-step.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V7).
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { buildAtelierPrompt } from '../../src/services/build-atelier-prompt.js';
import { buildAppPrompt } from '../../src/services/build-app-prompt.js';
import { buildAppPiece } from '../../src/services/build-app-layers.js';
import { atelierPiece } from '../../src/services/build-atelier-layers.js';
import { getAppdevPitfalls } from '../../src/data/appdev-pitfalls.js';

const config = { baseUrl: 'https://node.example', nodeId: 'node-test' } as unknown as AimeatConfig;
const classic = buildAppPrompt(config, { mode: 'new', lang: 'en' }).full;
const atelier = buildAtelierPrompt(config, { mode: 'new', lang: 'en' }).full;

const QUESTIONS = [
  '(a) Who opens the app: just you, your organisation (which organisation?), or anyone?',
  '(b) For each kind of data the app keeps (name each one from the idea): whose is it? PERSONAL (each person their own), SHARED BY THE TEAM (one common set that everybody in the organisation reads and edits), or PUBLIC (anyone may see it)?',
  '(c) Who may change the shared data: everyone in the team, or only some roles?',
];
const CONFIRMATION = '**Then confirm with a scenario, and wait for a yes.**';
const EXAMPLE = '"So I understood: when Teemu adds a candidate, Maija sees them at once in the same list. When Maija marks a candidate as a favourite, only Maija sees the mark. Nobody outside the company can open the app. Is that right?"';
const TRAP = 'a team app built on per-user memory gives every person an empty copy of their own';

function expectStep(text: string, name: string): void {
  for (const q of QUESTIONS) expect(text, name).toContain(q);
  expect(text, name).toContain(CONFIRMATION);
  expect(text, name).toContain('with named people');
  expect(text, name).toContain(EXAMPLE);
  expect(text, name).toContain('Build only after they say yes.');
  expect(text, name).toContain('ONE organism workspace that every member reads and writes');
  expect(text, name).toContain('workspacePicker');
  expect(text, name).toContain('`open_to`');
  expect(text, name).toContain('`organism:<id>`');
  expect(text, name).toContain(TRAP);
}

describe('the data map step, Classic', () => {
  it('carries the three questions, the confirmation with an example, the workspace steer and open_to', () => {
    expectStep(classic, 'classic');
    expect(classic).toContain('the section "If several people share it: a GROUP application" has the whole shape');
  });

  it('comes right after the interview, before Step 2', () => {
    const skip = classic.indexOf('Skip any question I already answered in my idea above.');
    const step = classic.indexOf('**Then the data map: three more questions, before any code.**');
    const build = classic.indexOf('## Step 2');
    expect(skip).toBeGreaterThan(-1);
    expect(step).toBeGreaterThan(skip);
    expect(build).toBeGreaterThan(step);
  });

  it('keeps the old questions word for word', () => {
    expect(classic).toContain('4. Data: SHARED (a community space others can see and add to) or PRIVATE (only mine)?\n');
    expect(classic).toContain('5. Should it use AI features (summaries, suggestions, generation)? If yes I can enable them via aimeat-ai.\n');
    expect(classic).toContain('2. What should it be called?\n');
  });

  it('serves the questions in part start and the steer in part data', () => {
    const start = buildAppPiece(classic, 'start', config.baseUrl)!.text;
    const data = buildAppPiece(classic, 'data', config.baseUrl)!.text;
    for (const q of QUESTIONS) expect(start).toContain(q);
    expect(data).toContain('### How the data map answers steer the build');
    expect(data).toContain(TRAP);
  });

  it('leaves the improve-mode body without the interview step', () => {
    const improve = buildAppPrompt(config, { mode: 'improve', lang: 'en' }).full;
    expect(improve).not.toContain(QUESTIONS[0]);
  });
});

describe('the data map step, Atelier', () => {
  it('carries the three questions, the confirmation with an example, the workspace steer and open_to', () => {
    expectStep(atelier, 'atelier');
    expect(atelier).toContain('`AIMEAT.atelier.workspacePicker({ target, app, onReady })`');
    expect(atelier).not.toContain('GROUP application');
  });

  it('comes right after the numbered questions, before the proposal', () => {
    const five = atelier.indexOf('5. Anything it must NOT do?');
    const step = atelier.indexOf('**Then the data map: three more questions, before any code.**');
    const propose = atelier.indexOf('## Then propose, and wait for the answer');
    expect(five).toBeGreaterThan(-1);
    expect(step).toBeGreaterThan(five);
    expect(propose).toBeGreaterThan(step);
  });

  it('keeps the old questions word for word', () => {
    expect(atelier).toContain('2. Who uses it — just you, or others too (shared data)?\n');
    expect(atelier).toContain('- **Who signs in**, and what is kept for them. An app nobody signs in to says so here.\n');
  });

  it('has the proposal state the data map', () => {
    const propose = atelier.slice(atelier.indexOf('## Then propose, and wait for the answer'));
    expect(propose).toContain('- **The data map, and the confirmed scenario.**');
  });

  it('gives "Data, in short" a team branch, and the body (the spec token) carries it', () => {
    const body = buildAtelierPrompt(config, { mode: 'improve' }).body;
    const data = body.slice(body.indexOf('## Data, in short'), body.indexOf('## Finishing'));
    expect(data).toContain('`AIMEAT.data.set/get`');
    expect(data).toContain('**How the data map answers steer the build**');
    expect(data).toContain('ONE organism workspace');
    expect(data).toContain(TRAP);
  });

  it('serves the questions in part start and the team branch in part libraries', () => {
    const start = atelierPiece(atelier, 'start', config.baseUrl)!.text;
    const libraries = atelierPiece(atelier, 'libraries', config.baseUrl)!.text;
    for (const q of QUESTIONS) expect(start).toContain(q);
    expect(libraries).toContain('## Data, in short');
    expect(libraries).toContain('## What the review always catches');
  });
});

describe('the pitfall', () => {
  it('team-data-in-personal-memory names the symptom, the cause and the fix', () => {
    const p = getAppdevPitfalls().find(x => x.id === 'team-data-in-personal-memory');
    expect(p).toBeDefined();
    expect(p!.symptom).toContain('Each person sees only what they entered themselves');
    expect(p!.symptom).toContain('AIMEAT.data');
    expect(p!.fix).toContain('organism workspace');
    expect(p!.fix).toContain('workspacePicker');
    expect(p!.fix).toContain('data map step');
  });
});
