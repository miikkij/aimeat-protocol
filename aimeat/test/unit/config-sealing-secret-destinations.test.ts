/**
 * @file test/unit/config-sealing-secret-destinations.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A host that seals a secret seals where the secret is sent with it
 *   (services/config-sealing.ts; secaudit2026oct26, config-schema:secret-destination-mutable-beside-immutable-secret).
 *   The host-set SMTP user and password and the FTN client secret are immutable rows, so naming them
 *   in AIMEAT_SEALED_CONFIG_KEYS changed nothing, and the operator could point them at a server of
 *   their own. Naming one now seals the rows that decide where it goes; a Casdoor secret, which is
 *   mutable, is sealed together with its endpoint. A node that seals nothing, or seals only other
 *   settings, keeps every row the operator's to change.
 * @usage cd aimeat && pnpm exec vitest run test/unit/config-sealing-secret-destinations.test.ts
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { sealedKeysFromEnv } from '../../src/services/config-sealing.js';

const SMTP_DESTINATION = ['email.smtp_host', 'email.smtp_port', 'email.smtp_secure', 'email.smtp_reject_unauthorized'];

describe('sealing a secret seals its destination', () => {
  it('the SMTP user or password seals the server address, port and TLS rows', () => {
    expect(sealedKeysFromEnv('email.smtp_pass').sort()).toEqual([...SMTP_DESTINATION].sort());
    expect(sealedKeysFromEnv('email.smtp_user').sort()).toEqual([...SMTP_DESTINATION].sort());
  });

  it('the FTN client secret seals the FTN provider address', () => {
    expect(sealedKeysFromEnv('eudiw.ftn_client_secret')).toEqual(['eudiw.ftn_provider_url']);
  });

  it('the Casdoor client secret is sealed together with its endpoint', () => {
    expect(sealedKeysFromEnv('auth.casdoor_client_secret').sort()).toEqual(['auth.casdoor_client_secret', 'auth.casdoor_endpoint']);
  });

  it('a node that seals other settings keeps the destination rows the operator\'s', () => {
    expect(sealedKeysFromEnv('quota.memory_mb')).toEqual(['quota.memory_mb']);
    expect(sealedKeysFromEnv(undefined)).toEqual([]);
  });

  it('a destination named as well is listed once', () => {
    expect(sealedKeysFromEnv('email.smtp_host,email.smtp_pass').sort()).toEqual([...SMTP_DESTINATION].sort());
  });
});
