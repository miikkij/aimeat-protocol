/**
 * @file test/unit/connector-install-identity.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a connector says about its installation at connect, and how the node reads it:
 *   the reported name (cli/connect/install-id.ts getInstallName, services/connect-tunnel-roster.ts
 *   parseInstallName) and the run modes its runtime declares (cli/connect/run-modes.ts readRunModes).
 *
 *   The rules held here. A name is sent URI-encoded and comes back as written, because a host name
 *   may hold characters an HTTP header may not, and a header the client library refuses would stop
 *   the connector from connecting. The node removes control characters and caps the length, because
 *   the value ends on the owner's page. AIMEAT_INSTALL_NAME wins over the host name. A run-mode
 *   declaration that names no known mode is `spawn`, never an empty list.
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial, with the connector registry.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { hostname } from 'node:os';
import { getInstallName } from '../../src/cli/connect/install-id.js';
import { readRunModes } from '../../src/cli/connect/run-modes.js';
import { parseInstallName, parseRunModes, INSTALL_NAME_MAX } from '../../src/services/connect-tunnel-roster.js';

const savedName = process.env.AIMEAT_INSTALL_NAME;
afterEach(() => {
  if (savedName === undefined) delete process.env.AIMEAT_INSTALL_NAME;
  else process.env.AIMEAT_INSTALL_NAME = savedName;
});

describe('the name a connector reports', () => {
  it('is the host name when nothing is set', () => {
    delete process.env.AIMEAT_INSTALL_NAME;
    expect(getInstallName()).toBe(hostname().trim().slice(0, 60).trim() || null);
  });

  it('is AIMEAT_INSTALL_NAME when the person set one', () => {
    process.env.AIMEAT_INSTALL_NAME = '  Toimiston palvelin  ';
    expect(getInstallName()).toBe('Toimiston palvelin');
  });

  it('is cut to sixty characters', () => {
    process.env.AIMEAT_INSTALL_NAME = 'x'.repeat(90);
    expect(getInstallName()).toHaveLength(60);
  });
});

describe('the name as the node reads it', () => {
  it('comes back as written through the header encoding', () => {
    const sent = encodeURIComponent('Jounin läppäri №2');
    expect(/^[\x20-\x7e]*$/.test(sent)).toBe(true);
    expect(parseInstallName(sent)).toBe('Jounin läppäri №2');
  });

  it('is taken as sent when it is not URI-encoded', () => {
    expect(parseInstallName('plain-host')).toBe('plain-host');
    expect(parseInstallName('100%')).toBe('100%');
  });

  it('loses control characters and extra whitespace, and is capped', () => {
    expect(parseInstallName(encodeURIComponent('a\r\nb\u0000c\t d'))).toBe('a b c d');
    expect(parseInstallName(encodeURIComponent('y'.repeat(200)))).toHaveLength(INSTALL_NAME_MAX);
  });

  it('is null when there is nothing to show', () => {
    expect(parseInstallName(undefined)).toBeNull();
    expect(parseInstallName('')).toBeNull();
    expect(parseInstallName(encodeURIComponent('   '))).toBeNull();
  });
});

describe('the run modes a runtime declares', () => {
  it('are spawn when nothing is declared', () => {
    expect(readRunModes(undefined)).toEqual(['spawn']);
    expect(readRunModes('')).toEqual(['spawn']);
  });

  it('are the known modes named, once each', () => {
    expect(readRunModes('spawn, Resident,spawn')).toEqual(['spawn', 'resident']);
    expect(readRunModes('resident')).toEqual(['resident']);
  });

  it('are spawn when the declaration names no known mode', () => {
    expect(readRunModes('always,forever')).toEqual(['spawn']);
  });

  it('are read by the node as the same list', () => {
    expect(parseRunModes(readRunModes('spawn,resident').join(','))).toEqual(['spawn', 'resident']);
  });
});
