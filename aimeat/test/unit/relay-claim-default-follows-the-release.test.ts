/**
 * @file relay-claim-default-follows-the-release.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node-wide relay-claim setting is what the release it ships in promises.
 *
 *   `federation.relay_claim` names two versions (services/relay-claim-policy.ts): the default
 *   becomes `required` in RELAY_CLAIM_REQUIRED_BY_DEFAULT_IN, and `optional` is removed in
 *   RELAY_CLAIM_OPTIONAL_REMOVED_IN. The operator reads both in the setting's description, and
 *   nothing in the code changes by itself when package.json reaches either version. So this reads
 *   the version the node reports and holds three things to it: the default loadConfig() gives,
 *   whether an explicit `optional` still stands (in the environment, in the config schema, on one
 *   peer), and the two versions the description names. A release that reaches a named version
 *   without the change fails here, and so does moving a version without changing what the operator
 *   reads.
 * @structure the default · an explicit optional · the description
 * @usage pnpm exec vitest run test/unit/relay-claim-default-follows-the-release.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { CONFIG_FIELDS } from '../../src/services/config-schema.js';
import { compareVersions } from '../../src/services/federation-overview.js';
import {
    RELAY_CLAIM_REQUIRED_BY_DEFAULT_IN, RELAY_CLAIM_OPTIONAL_REMOVED_IN, parsePeerRelayClaim,
} from '../../src/services/relay-claim-policy.js';
import { getSoftwareVersion } from '../../src/utils/version.js';

const ENV = 'AIMEAT_FEDERATION_RELAY_CLAIM';
const VERSION = getSoftwareVersion();
const requiredByDefault = compareVersions(VERSION, RELAY_CLAIM_REQUIRED_BY_DEFAULT_IN) >= 0;
const optionalRemoved = compareVersions(VERSION, RELAY_CLAIM_OPTIONAL_REMOVED_IN) >= 0;
/** A config file that is not there, so no aimeat.ini or aimeat.config.json in the cwd is read. */
const NO_FILE = join(tmpdir(), `aimeat-no-config-${process.pid}.ini`);
const field = CONFIG_FIELDS.find(f => f.key === 'federationRelayClaim');

/** The node-wide setting loadConfig() gives with this value in the environment, or 'refused'. */
function nodeSetting(value: string | undefined): string {
    if (value === undefined) delete process.env[ENV];
    else process.env[ENV] = value;
    try {
        return loadConfig({ configPath: NO_FILE }).config.federationRelayClaim;
    } catch {
        // The node refused the value at start, which is one way to refuse it.
        return 'refused';
    }
}

describe(`federation.relay_claim at version ${VERSION}`, () => {
    let saved: string | undefined;
    beforeEach(() => { saved = process.env[ENV]; });
    afterEach(() => {
        if (saved === undefined) delete process.env[ENV];
        else process.env[ENV] = saved;
    });

    it(`defaults to optional before ${RELAY_CLAIM_REQUIRED_BY_DEFAULT_IN} and to required from it`, () => {
        expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
        expect(nodeSetting(undefined)).toBe(requiredByDefault ? 'required' : 'optional');
    });

    it(`takes optional as a setting before ${RELAY_CLAIM_OPTIONAL_REMOVED_IN} and refuses it from then on`, () => {
        const node = nodeSetting('optional');
        if (optionalRemoved) expect(node).not.toBe('optional');
        else expect(node).toBe('optional');
        expect(field?.validate('optional')).toBe(!optionalRemoved);
        expect(parsePeerRelayClaim('optional').ok).toBe(!optionalRemoved);
    });

    it('names the same two versions where the operator reads the setting', () => {
        expect(field?.description).toContain(RELAY_CLAIM_REQUIRED_BY_DEFAULT_IN);
        expect(field?.description).toContain(RELAY_CLAIM_OPTIONAL_REMOVED_IN);
    });
});
