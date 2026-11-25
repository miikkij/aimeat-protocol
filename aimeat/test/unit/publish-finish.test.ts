/**
 * @file test/unit/publish-finish.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every text that tells a builder how an Atelier app is finished says the same thing:
 *   the one size matrix (services/app/publish-finish.ts) and which of the four owed items the app
 *   owes at its level. Read in the build specification, the appdev handbook's FINISH, the skills
 *   aimeat-app-builder-atelier and aimeat-app-workstation, and the publish answer's `next_steps`.
 *
 *   WHY. A builder meets these texts at different moments of one build, and the one it meets last
 *   wins: on 2026-11-08 the publish answer named other sizes than the specification, and on
 *   2026-11-25 the specification called its four sizes "these three", the workstation skill named
 *   three, and FINISH said every app owes all four items while the publish refusal asks a quick
 *   prototype for neither a skill nor a face.
 * @usage cd aimeat && pnpm exec vitest run test/unit/publish-finish.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-agentti-saa-nykyiset-aimeat-ohjeet-ja-tekee-sovitun-ty-n-lop, items 4 and 5).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { ATELIER_SIZE_MATRIX, OWED_BY_LEVEL } from '../../src/services/app/publish-finish.js';
import { buildPublishNextSteps, documentSteps } from '../../src/services/app/publish-next-steps.js';
import { buildAtelierPrompt } from '../../src/services/builder/atelier-prompt.js';
import { APPDEV_HANDBOOK } from '../../src/services/handbooks/appdev.js';
import { BUILTIN_SKILLS } from '../../src/data/builtin-skills.js';
import { toolsRegisteredOn } from '../../src/tool-catalog/surfaces.js';
import { APP_MANAGE_ACTION_NAMES } from '../../src/tool-catalog/definitions/app-manage.js';

const config = { nodeId: 'node-test', baseUrl: 'https://node.example', appMaxSizeMb: 5 } as unknown as AimeatConfig;
const skill = (name: string): string => BUILTIN_SKILLS.find(s => s.name === name)?.skillMd ?? '';
const page = (level?: string, extra = ''): string =>
  `<!doctype html><html><head>${level ? `<meta name="aimeat-level" content="${level}">` : ''}${extra}</head><body></body></html>`;
const docs = { dataMapMissing: true, dataMapRowsWithoutWhy: 0, designSpecVersion: undefined, newVersion: 2 };

describe('the one size matrix', () => {
  it('is the four sizes of the specification', () => {
    expect(ATELIER_SIZE_MATRIX).toBe('390×844, 1280×900, 1280×460 and 1920×1080');
  });

  const spec = buildAtelierPrompt({ baseUrl: 'https://node.example' } as never, {}).full;
  const finishing = spec.slice(spec.indexOf('## Finishing'));

  it('is what the specification\'s Finishing opens with, and it does not call them three', () => {
    expect(finishing).toContain(`open the app at ${ATELIER_SIZE_MATRIX} in BOTH`);
    expect(finishing).not.toMatch(/three sizes/);
  });

  it('is in both skills that name sizes', () => {
    expect(skill('aimeat-app-builder-atelier')).toContain(ATELIER_SIZE_MATRIX);
    expect(skill('aimeat-app-workstation')).toContain(ATELIER_SIZE_MATRIX);
  });

  let storage: Storage;
  beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });

  it('is what the publish answer measures at and looks at', async () => {
    const steps = await buildPublishNextSteps(storage, config, 'alice', 'shop.html', undefined, 'atelier', 'genre-ledger', page(), docs);
    expect(String(steps?.acceptance)).toContain(ATELIER_SIZE_MATRIX);
    expect(String(steps?.screens)).toContain(ATELIER_SIZE_MATRIX);
  });
});

describe('the four owed items, by level', () => {
  it('the appdev surface carries a tool for each: face_set, aimeat_skill_publish, aimeat_datamap_set, spec_set', () => {
    const appdev = toolsRegisteredOn('appdev');
    for (const tool of ['aimeat_app_manage', 'aimeat_skill_publish', 'aimeat_datamap_set']) expect(appdev.has(tool), tool).toBe(true);
    for (const action of ['face_set', 'spec_set']) expect(APP_MANAGE_ACTION_NAMES).toContain(action);
  });

  it('FINISH and the skill say the same rule, and the specification no longer says every app owes all four', () => {
    expect(APPDEV_HANDBOOK).toContain(OWED_BY_LEVEL);
    expect(skill('aimeat-app-builder-atelier')).toContain(OWED_BY_LEVEL);
    // The specification's part `libraries` is at its size ceiling, so Finishing points at step 9.
    const spec = buildAtelierPrompt({ baseUrl: 'https://node.example' } as never, {}).full;
    const finishing = spec.slice(spec.indexOf('## Finishing'));
    expect(finishing).not.toMatch(/every app owes/);
    expect(finishing).toMatch(/owes at its level/);
    expect(finishing).toMatch(/says what each holds, by level/);
  });

  let storage: Storage;
  beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });

  it('the publish answer asks a quick prototype for no face and no skill', async () => {
    const steps = await buildPublishNextSteps(storage, config, 'alice', 'shop.html', undefined, 'atelier', undefined, page('proto'), docs);
    expect(String(steps?.agent_face)).toMatch(/^Not owed/);
    expect(String(steps?.bound_skill)).toMatch(/^Not owed/);
  });

  it('the publish answer asks a presentation for no face and no skill', async () => {
    const steps = await buildPublishNextSteps(storage, config, 'alice', 'shop.html', undefined, 'atelier', undefined,
      page('plain', '<meta name="aimeat-ai-path" content="none">'), docs);
    expect(String(steps?.agent_face)).toMatch(/^Not owed/);
  });

  it('the publish answer asks every other app for both', async () => {
    const steps = await buildPublishNextSteps(storage, config, 'alice', 'shop.html', undefined, 'atelier', undefined, page('plain'), docs);
    expect(String(steps?.agent_face)).toMatch(/^No agent face yet/);
    expect(String(steps?.bound_skill)).toMatch(/^No skill bound yet/);
  });
});

describe('the design spec\'s next calls carry the app they are about', () => {
  it('names the owner and the file, whether the spec is missing or behind', () => {
    const missing = documentSteps('bob', 'shop.html', docs);
    expect(String(missing.design_spec)).toContain('owner: "bob", filename: "shop.html"');
    const behind = documentSteps('bob', 'shop.html', { ...docs, designSpecVersion: 1 });
    expect(String(behind.design_spec)).toContain('owner: "bob", filename: "shop.html"');
    expect(String(behind.data_map)).not.toContain('owner:');
    expect(String(missing.data_map)).toContain('app: "bob/shop.html"');
  });
});
