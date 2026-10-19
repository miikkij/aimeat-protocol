/**
 * @file test/unit/service-summary-form.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which service summary request this node sends a peer during the one-release window
 *   (decision 2026-10-16): node 4.0.4 sends the older unsigned form to a peer on 4.0.2 or older and to
 *   a peer of unknown version, the signed form to a newer peer; from 4.0.5 every peer gets the signed
 *   form. The headers serviceSummaryRequestHeaders builds follow the same choice, for this node's own
 *   version: the unsigned headers while the window is open, the signed ones for the same old peer after it.
 * @version-history
 *   2026-10-19 — The header test reads this node's own version: from 4.0.5 an old peer gets the signed form (node 4.1.0 turned it red).
 *   2026-10-16 — unsignedServiceSummaryAccepted: the receiving side of the window; and the signed form on request.
 *   2026-10-16 — Initial (decision 2026-10-16, the signed service summary compatibility window).
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/auth/keypair.js';
import {
    serviceSummaryForm, unsignedServiceSummaryAccepted, SIGNED_SERVICE_SUMMARY_PEER_FROM, UNSIGNED_SERVICE_SUMMARY_REMOVED_IN,
} from '../../src/config-federation.js';
import { serviceSummaryRequestHeaders } from '../../src/services/federation.js';
import { getSoftwareVersion, versionAtLeast } from '../../src/utils/version.js';
import type { AimeatConfig } from '../../src/config.js';

/** serviceSummaryRequestHeaders reads this node's own version, so its window is open only before 4.0.5. */
const windowOpen = !versionAtLeast(getSoftwareVersion(), UNSIGNED_SERVICE_SUMMARY_REMOVED_IN);

describe('serviceSummaryForm', () => {
    it('names the window: signed peers from 4.0.3, signed only from 4.0.5', () => {
        expect(SIGNED_SERVICE_SUMMARY_PEER_FROM).toBe('4.0.3');
        expect(UNSIGNED_SERVICE_SUMMARY_REMOVED_IN).toBe('4.0.5');
    });

    it('a node on 4.0.4 sends the unsigned form to a peer on 4.0.2 or older', () => {
        for (const v of ['4.0.2', '4.0.0', '3.27.1']) {
            expect(serviceSummaryForm(v, '4.0.4')).toEqual({ form: 'unsigned', reason: 'peer-old' });
        }
    });

    it('a node on 4.0.4 sends the signed form to a peer on 4.0.3 or newer', () => {
        for (const v of ['4.0.3', '4.0.4', '4.1.0', '5.0.0']) {
            expect(serviceSummaryForm(v, '4.0.4')).toEqual({ form: 'signed', reason: 'peer-new' });
        }
    });

    it('a node on 4.0.4 sends the unsigned form to a peer whose version it does not know', () => {
        for (const v of [null, undefined, '', 'unknown', 'v4']) {
            expect(serviceSummaryForm(v, '4.0.4')).toEqual({ form: 'unsigned', reason: 'peer-unknown' });
        }
    });

    it('from 4.0.5 every peer gets the signed form, the old and the unknown too', () => {
        for (const own of ['4.0.5', '4.1.0', '5.0.0']) {
            for (const v of ['4.0.2', null, '4.0.4']) {
                expect(serviceSummaryForm(v, own)).toEqual({ form: 'signed', reason: 'window-closed' });
            }
        }
    });
});

describe('unsignedServiceSummaryAccepted (the receiving side of the window)', () => {
    it('a node on 4.0.4 answers the unsigned request from a peer whose signed heartbeat named 4.0.2 or older', () => {
        for (const v of ['4.0.2', '4.0.0', '3.27.1']) expect(unsignedServiceSummaryAccepted(v, '4.0.4')).toBe(true);
    });
    it('a node on 4.0.4 refuses it from a peer on 4.0.3 or newer', () => {
        for (const v of ['4.0.3', '4.0.4', '4.1.0']) expect(unsignedServiceSummaryAccepted(v, '4.0.4')).toBe(false);
    });
    it('a node on 4.0.4 refuses it from a peer whose version it has not heard', () => {
        for (const v of [null, undefined, '', 'unknown']) expect(unsignedServiceSummaryAccepted(v, '4.0.4')).toBe(false);
    });
    it('from 4.0.5 the same old peer is refused: the window has closed', () => {
        for (const own of ['4.0.5', '4.1.0']) expect(unsignedServiceSummaryAccepted('4.0.2', own)).toBe(false);
    });
});

describe('serviceSummaryRequestHeaders', () => {
    const config = { nodeId: 'aimeat-unit-a' } as AimeatConfig;

    it.runIf(windowOpen)('the unsigned form is x-source-node alone, and needs no key', async () => {
        const h = await serviceSummaryRequestHeaders(config, { nodeId: 'aimeat-old', softwareVersion: '4.0.2' }, null);
        expect(h).toEqual({ 'Accept': 'application/json', 'x-source-node': 'aimeat-unit-a' });
    });

    it.skipIf(windowOpen)('after the window a peer on 4.0.2 gets the signed form, and a node without a key cannot send one', async () => {
        const key = await generateKeyPair();
        const h = await serviceSummaryRequestHeaders(config, { nodeId: 'aimeat-old', softwareVersion: '4.0.2' }, key);
        expect(typeof h['x-signature']).toBe('string');
        expect(h['x-audience']).toBe('aimeat-old');
        await expect(serviceSummaryRequestHeaders(config, { nodeId: 'aimeat-old', softwareVersion: '4.0.2' }, null))
            .rejects.toThrow('This node has no signing key');
    });

    it('signed = true gives the signed form to a peer the window would send the unsigned one', async () => {
        const key = await generateKeyPair();
        const h = await serviceSummaryRequestHeaders(config, { nodeId: 'aimeat-unknown', softwareVersion: null }, key, true);
        expect(typeof h['x-signature']).toBe('string');
        expect(h['x-audience']).toBe('aimeat-unknown');
    });

    it('the signed form carries the signature and the audience for that peer', async () => {
        const key = await generateKeyPair();
        const h = await serviceSummaryRequestHeaders(config, { nodeId: 'aimeat-new', softwareVersion: '4.0.3' }, key);
        expect(h['x-source-node']).toBe('aimeat-unit-a');
        expect(typeof h['x-signature']).toBe('string');
        expect(typeof h['x-timestamp']).toBe('string');
        expect(h['x-audience']).toBe('aimeat-new');
        expect(typeof h['x-audience-signature']).toBe('string');
    });
});
