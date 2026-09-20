/**
 * @file test/unit/agui-protocol-version.test.ts
 * @description What this node tells an AG-UI client it speaks, held against what the protocol says.
 *
 *   ONE STRING, WRITTEN TWICE, AND FOR A YEAR IT WAS THE WRONG KIND OF STRING. `AGUI_PROTOCOL`
 *   declared `0.0.59`, which was the npm version of @ag-ui/core. AG-UI's own version is a different
 *   number with a different meaning, and a front end reading the package version learns nothing
 *   about the wire it is about to speak. @ag-ui/core 1.0.0 exports `PROTOCOL_VERSION`, so there is
 *   now something true to compare against.
 *
 *   WHY NOT JUST IMPORT IT AND DELETE THE LITERAL. `security/protocol-versions.json` is the
 *   register of every protocol this node speaks, and its gate reads the declaration out of the
 *   source file. A computed value gives that gate nothing to read. So the literal stays, this test
 *   binds it to the package, and the register binds the ledger to the literal. An upgrade that
 *   moves AG-UI's protocol version then fails HERE, on the day of the upgrade, instead of waiting
 *   for the register's 90-day clock to notice.
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial, with the @ag-ui/core 1.0.0 upgrade.
 */
import { describe, it, expect } from 'vitest';
import { PROTOCOL_VERSION } from '@ag-ui/core';
import { AGUI_PROTOCOL } from '../../src/services/agui-run.js';

describe('the AG-UI version this node declares', () => {
  it('is the protocol version the package publishes, not the package version', () => {
    expect(AGUI_PROTOCOL.version).toBe(PROTOCOL_VERSION);
  });

  it('names the protocol', () => {
    expect(AGUI_PROTOCOL.name).toBe('ag-ui');
  });
});
