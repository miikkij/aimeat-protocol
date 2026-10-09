/**
 * @file test/unit/config-secret-marks.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A Config row whose variable is named like a secret is marked secret. A row shows its
 *   value on the operator's Config page (GET /v1/admin/config) unless its `adminDisplay` is
 *   `configured` or `hidden` (services/config-sealing.ts isSecretField), and the default is to show
 *   it. check:config-coverage asks for a row for every variable the node reads, the data key and
 *   three OAuth client secrets among them, so the next row added for one of those would show it to
 *   the operator and the operator's agents unless somebody remembered the mark (secrets audit
 *   2026-10-09, node configuration S2). This test is that memory.
 *
 *   THE RULE reads the environment variable's name, split at underscores:
 *   - PRIVATE anywhere, or
 *   - the last word is SECRET, PASSWORD, PASSPHRASE, PASS, CREDENTIAL, CREDENTIALS, TOKEN or KEY.
 *   So AIMEAT_TURN_SECRET and AIMEAT_OPENROUTER_INSTANCE_KEY are secret-named, and
 *   AIMEAT_AGENT_V2_TOKEN_TTL, AIMEAT_MEMORY_MAX_KEYS and AIMEAT_PASSKEY_ENABLED are not.
 *
 *   NOT_SECRET is the explicit list of secret-named rows that are public on purpose (a public key, a
 *   key id), each with its reason. A row goes there only with that reason written down.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S2).
 */
import { describe, it, expect } from 'vitest';
import { CONFIG_FIELDS } from '../../src/services/config-schema.js';
import { isSecretField } from '../../src/services/config-sealing.js';

const SECRET_LAST_WORDS = new Set(['SECRET', 'PASSWORD', 'PASSPHRASE', 'PASS', 'CREDENTIAL', 'CREDENTIALS', 'TOKEN', 'KEY']);

/** Secret-named rows that are public on purpose, with the reason. Empty today. */
const NOT_SECRET: Readonly<Record<string, string>> = {};

function secretNamed(envVar: string): boolean {
  const words = envVar.toUpperCase().split('_').filter(Boolean);
  return words.includes('PRIVATE') || SECRET_LAST_WORDS.has(words[words.length - 1] ?? '');
}

/** The rows that would show a secret-named value on the Config page. */
function unmarked(fields: ReadonlyArray<{ envVar: string; adminDisplay?: 'visible' | 'configured' | 'hidden' }>): string[] {
  return fields.filter(f => secretNamed(f.envVar) && !isSecretField(f) && !(f.envVar in NOT_SECRET)).map(f => f.envVar);
}

describe('a secret-named Config row is marked secret', () => {
  it('the rule tells a secret name from a setting about one', () => {
    for (const name of ['AIMEAT_TURN_SECRET', 'AIMEAT_SMTP_PASS', 'AIMEAT_ADMIN_PASSWORD', 'AIMEAT_KEY_PASSPHRASE',
      'AIMEAT_CONSUL_TOKEN', 'AIMEAT_OPENROUTER_INSTANCE_KEY', 'AIMEAT_VAPID_PRIVATE_KEY', 'AIMEAT_TURN_CREDENTIAL',
      'AIMEAT_GOOSE_PROVIDER_API_KEY', 'AIMEAT_ENCRYPTION_KEY']) {
      expect(secretNamed(name), name).toBe(true);
    }
    for (const name of ['AIMEAT_AGENT_V2_TOKEN_TTL', 'AIMEAT_MEMORY_MAX_KEYS', 'AIMEAT_PASSKEY_ENABLED',
      'AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS', 'AIMEAT_KEY_CACHE_REFRESH_MINUTES', 'AIMEAT_OWNER_KEY_LOGIN',
      'AIMEAT_SEALED_CONFIG_KEYS', 'AIMEAT_INSTALL_SET_SECRETS', 'AIMEAT_DECIDE_MAX_REQUEST_TOKENS']) {
      expect(secretNamed(name), name).toBe(false);
    }
  });

  it('a new row named like a secret and left visible is refused', () => {
    expect(unmarked([
      { envVar: 'AIMEAT_ENCRYPTION_KEY' },
      { envVar: 'AIMEAT_GOOGLE_OAUTH_CLIENT_SECRET', adminDisplay: 'visible' },
      { envVar: 'AIMEAT_FINVOICE_OPERATOR_KEY', adminDisplay: 'configured' },
    ])).toEqual(['AIMEAT_ENCRYPTION_KEY', 'AIMEAT_GOOGLE_OAUTH_CLIENT_SECRET']);
  });

  it('every row in CONFIG_FIELDS named like a secret is marked configured or hidden', () => {
    expect(unmarked(CONFIG_FIELDS), 'add adminDisplay: \'configured\' to these rows, or a reason to NOT_SECRET').toEqual([]);
  });

  it('NOT_SECRET names only rows that exist and are secret-named', () => {
    const vars = new Set(CONFIG_FIELDS.map(f => f.envVar));
    for (const name of Object.keys(NOT_SECRET)) {
      expect(vars.has(name), name).toBe(true);
      expect(secretNamed(name), name).toBe(true);
    }
  });
});
