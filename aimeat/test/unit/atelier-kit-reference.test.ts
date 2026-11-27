/**
 * @file test/unit/atelier-kit-reference.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier kit's reference as the build specification serves it
 *   (services/builder/atelier-kit.ts, sections `kit` and `kit-<name>`): the index names the
 *   functions a builder searched the library's source for, every name it lists has a page, each
 *   fits one tool result, a component's page carries its options with the types they name, and a
 *   name the kit does not have answers nothing.
 * @version-history
 *   v1.0.0 — 2026-11-28 — Initial (wish-atelier-kirjaston-osan-asetukset-saa-yhdell-kutsulla-ilman-s).
 */
import { describe, it, expect } from 'vitest';
import { buildAtelierPrompt } from '../../src/services/builder/atelier-prompt.js';
import { atelierPiece, MAX_PART_CHARS } from '../../src/services/builder/atelier-layers.js';
import { kitComponent, kitComponentNames, kitIndex } from '../../src/services/builder/atelier-kit.js';

const NODE = 'https://a-rather-long-organisation-node-address.example.com';
const full = buildAtelierPrompt({ baseUrl: NODE, nodeId: 'node-example' } as never, { mode: 'new' }).full;

describe('the Atelier kit reference', () => {
  it('lists the functions five measured builds searched the library\'s source for', () => {
    const index = kitIndex();
    // Searched for on 2026-11-27 as `function form(spec)`, `function list(spec)` and so on.
    for (const name of ['form', 'list', 'mosaic', 'app', 'menu', 'toast', 'emptyState', 'queue']) {
      expect(index, name).toContain('- `' + name + '`');
    }
    expect(index).toContain('build-app-atelier/kit-<name>');
  });

  it('has a page for every name the index lists, and each fits one tool result', () => {
    const names = kitComponentNames();
    expect(names.length).toBeGreaterThan(150);
    expect(kitIndex().length).toBeLessThan(MAX_PART_CHARS);
    for (const name of names) {
      const page = kitComponent(name);
      expect(page, name).not.toBeNull();
      expect((page as string).length, name).toBeLessThan(MAX_PART_CHARS);
    }
  });

  it('a component\'s page carries its options, the types they name, and what may be changed', () => {
    const form = kitComponent('form') as string;
    expect(form).toContain('## AIMEAT.atelier.form(spec)');
    expect(form).toContain('fields: FormField[]');
    expect(form).toContain('@typedef {object} FormField');
    expect(form).toContain('onSubmit?:');
    expect(form).toMatch(/parts \(each element the kit builds/);
    const list = kitComponent('list') as string;
    expect(list).toContain("variant?: 'dense'|'numbered'|'plain'");
    expect(list).toContain('`--ak-list-gap`');
  });

  it('a function with no parts says its call and options, and nothing about parts', () => {
    const mosaic = kitComponent('mosaic') as string;
    expect(mosaic).toContain('## AIMEAT.atelier.mosaic(spec)');
    expect(mosaic).toContain('sources?: Record<string, () => any>');
    expect(mosaic).not.toContain('What you may change without forking it');
  });

  it('a part that is not called on its own says so', () => {
    expect(kitComponent('stage')).toContain('is not called on its own');
  });

  it('answers nothing for a name the kit does not have', () => {
    expect(kitComponent('nope')).toBeNull();
    expect(kitComponent('constructor')).toBeNull();
    expect(kitComponent('')).toBeNull();
  });

  it('is reached the way the MCP tool and the route reach a section', () => {
    expect(atelierPiece(full, 'kit', NODE)?.text).toContain('## The kit');
    expect(atelierPiece(full, 'kit-form', NODE)?.text).toContain('AIMEAT.atelier.form(spec)');
    expect(atelierPiece(full, 'kit-nope', NODE)).toBeNull();
  });

  it('the specification and its index send a builder with no browser here', () => {
    expect(atelierPiece(full, 'platform', NODE)?.text).toContain('- `kit` — ');
    expect(full).toContain('build-app-atelier/kit-<name>');
  });
});
