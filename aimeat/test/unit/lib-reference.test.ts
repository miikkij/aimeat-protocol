/**
 * @file test/unit/lib-reference.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The reference of the libraries beside the Atelier kit as the build specification
 *   serves it (services/builder/lib-reference.ts, sections `lib` and `lib-<name>`): the index names
 *   each library and its functions, each library's page carries what builders searched its source
 *   for, every page fits one tool result, and a name with no reference answers nothing.
 * @version-history
 *   v1.0.0 — 2026-11-28 — Initial (wish-kirjautumis-data-ja-kielikirjaston-funktioiden-ohje-yhdell-k).
 */
import { describe, it, expect } from 'vitest';
import { buildAtelierPrompt } from '../../src/services/builder/atelier-prompt.js';
import { atelierPiece, MAX_PART_CHARS } from '../../src/services/builder/atelier-layers.js';
import { libIndex, libNames, libPage } from '../../src/services/builder/lib-reference.js';

const NODE = 'https://a-rather-long-organisation-node-address.example.com';
const full = buildAtelierPrompt({ baseUrl: NODE, nodeId: 'node-example' } as never, { mode: 'new' }).full;

describe('the reference of the libraries beside the kit', () => {
  it('lists the four libraries with how each is loaded and its functions', () => {
    expect(libNames()).toEqual(['auth', 'data', 'i18n', 'fmt']);
    const index = libIndex();
    expect(index).toContain('`lib-auth`: `AIMEAT.auth` (`/v1/libs/aimeat-auth.js`)');
    expect(index).toContain('`mountLoginButton`');
    expect(index).toContain('`lib-data`: `AIMEAT.data`');
    expect(index).toContain('`getEntry`');
    expect(index.length).toBeLessThan(MAX_PART_CHARS);
  });

  it('the sign-in page answers what every measured build searched aimeat-auth.js for', () => {
    const auth = libPage('auth') as string;
    // The login button's options, and which handler shows the app.
    expect(auth).toContain('### AIMEAT.auth.mountLoginButton(selector, opts = {})');
    expect(auth).toContain('@param {MountLoginOptions} [opts]');
    expect(auth).toContain('@typedef {object} MountLoginOptions');
    expect(auth).toContain('@property {(session: AuthSession, how: { restored: boolean }) => void} [onSession]');
    expect(auth).toContain('@property {() => void} [onLogout]');
    expect(auth).toContain('@property {boolean} [compact]');
    expect(auth).toMatch(/onLogin runs after a sign-in or a registration only/);
    // The session's shape, with the name to show.
    expect(auth).toContain('@typedef {object} AuthSession');
    expect(auth).toContain('@property {string} displayName');
    expect(auth).toContain('### AIMEAT.auth.getSession()');
    // The library's own members stay out.
    expect(auth).not.toContain('AIMEAT.auth._restore');
  });

  it('the data page says how a record is read, written on its version, listed and deleted', () => {
    const data = libPage('data') as string;
    for (const call of ['set(key, value, opts)', 'get(key, opts)', 'getEntry(key, opts)', 'list(opts)', 'delete(key, opts)', 'action(ext, actionId, input)']) {
      expect(data, call).toContain(`### AIMEAT.data.${call}`);
    }
    expect(data).toContain('expectedVersion');
  });

  it('the words and the formats are two pages of one library file', () => {
    expect(libPage('i18n')).toContain('### AIMEAT.i18n.t(key, vars)');
    expect(libPage('i18n')).toContain('aimeat-lang-change');
    expect(libPage('fmt')).toContain('### AIMEAT.fmt.date(v, opts)');
    expect(libPage('fmt')).toContain('### AIMEAT.fmt.relative(v)');
  });

  it('every page fits one tool result, and a name with no reference answers nothing', () => {
    for (const name of libNames()) expect((libPage(name) as string).length, name).toBeLessThan(MAX_PART_CHARS);
    expect(libPage('nope')).toBeNull();
    expect(libPage('constructor')).toBeNull();
  });

  it('is reached the way the MCP tool and the route reach a section, and the specification points at it', () => {
    expect(atelierPiece(full, 'lib', NODE)?.text).toContain('## The libraries beside the kit');
    expect(atelierPiece(full, 'lib-auth', NODE)?.text).toContain('## AIMEAT.auth');
    expect(atelierPiece(full, 'lib-nope', NODE)).toBeNull();
    expect(atelierPiece(full, 'platform', NODE)?.text).toContain('- `lib` — ');
    expect(full).toContain('`lib-auth`');
  });

  it('the kit\'s form page says how a test reaches a field', () => {
    expect(atelierPiece(full, 'kit-form', NODE)?.text).toContain('[data-ak-field="title"] input');
  });
});
