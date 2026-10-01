/**
 * @file test/unit/intake-share-link.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The link an app built from the public-intake template hands out opens a page.
 *
 *   The node serves a form's API address (/v1/intake/<org>/<ws>/<form>), not a page a person can
 *   open, and no route serves /f/. The kit's intakeAdmin copies the app's own page with
 *   `?form=<form id>`, and intakeForm reads the same parameter. The template and the app-building
 *   prompt must give an app builder the same link, or the app shares an address that answers 404.
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial: COMP_PUBLIC_INTAKE handed out '/f/<org>/<ws>/<form>'.
 */
import { describe, it, expect } from 'vitest';
import { COMP_PUBLIC_INTAKE } from '../../src/data/app-templates/components.js';
import { buildAppPrompt } from '../../src/services/build-app-prompt.js';

const config = { baseUrl: 'https://node.example', nodeId: 'node-example' } as never;

/** Runs the template's functions against a stub AIMEAT and a page address. */
function loadTemplate(href: string, calls: any[]) {
  const AIMEAT = {
    intake: {
      defineForm: async (spec: any) => { calls.push(['defineForm', spec]); return { form_id: spec.form_id, submit_url: '/v1/intake/o/w/' + spec.form_id }; },
      getForm: async (org: string, ws: string, id: string) => { calls.push(['getForm', org, ws, id]); return { form_id: id, fields: [] }; },
      submit: async (org: string, ws: string, id: string, values: any) => { calls.push(['submit', org, ws, id, values]); return { ok: true, id: 'r1' }; },
    },
  };
  const window = { location: new URL(href) };
  const factory = new Function('AIMEAT', 'window', COMP_PUBLIC_INTAKE + '\nreturn { setupForm, renderAndSubmit, linkedFormId };');
  return factory(AIMEAT, window);
}

describe('the public-intake template', () => {
  it('shares the app page with ?form=<form id>, the link intakeForm reads', async () => {
    const calls: any[] = [];
    const t = loadTemplate('https://shop.apps.node.example/admin?tab=forms#top', calls);
    const link = await t.setupForm('org-1', 'ws-1');
    expect(link).toBe('https://shop.apps.node.example/admin?form=contact-us');
  });

  it('has no path the node does not serve', () => {
    expect(COMP_PUBLIC_INTAKE).not.toMatch(/['"]\/f\//);
  });

  it('reads the form id from the address on the public page', async () => {
    const calls: any[] = [];
    const t = loadTemplate('https://shop.apps.node.example/?form=contact-us', calls);
    expect(t.linkedFormId()).toBe('contact-us');
    await t.renderAndSubmit('org-1', 'ws-1', t.linkedFormId(), { email: 'a@b.example' });
    expect(calls.map(c => c[0])).toEqual(['getForm', 'submit']);
    expect(calls[1][3]).toBe('contact-us');
  });
});

describe('the app-building prompt on Public Intake', () => {
  const full = buildAppPrompt(config, { mode: 'new', lang: 'en' }).full;
  const section = full.slice(full.indexOf('### Collecting input from anonymous visitors'));
  const intake = section.slice(0, section.indexOf('\n### ', 5));

  it('says the shared link is the app page with ?form=, not submit_url', () => {
    expect(intake).toContain('?form=');
    expect(intake).not.toMatch(/submit_url[^\n]*\n[^\n]*shareable|shareable link[^\n]*\n[^\n]*submit_url/);
  });
});
