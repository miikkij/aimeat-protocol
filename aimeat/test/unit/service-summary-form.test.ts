/**
 * @file test/unit/service-summary-form.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which service summary request this node sends a peer during the one-release window
 *   (decision 2026-10-16): node 4.0.4 sends the older unsigned form to a peer on 4.0.2 or older and to
 *   a peer of unknown version, the signed form to a newer peer; from 4.0.5 every peer gets the signed
 *   form. The headers serviceSummaryRequestHeaders builds follow the same choice.
 * @version-history
 *   2026-10-16 — Initial (decision 2026-10-16, the signed service summary compatibility window).
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/auth/keypair.js';
import {
    serviceSummaryForm, SIGNED_SERVICE_SUMMARY_PEER_FROM, UNSIGNED_SERVICE_SUMMARY_REMOVED_IN,
} from '../../src/config-federation.js';
import { serviceSummaryRequestHeaders } from '../../src/services/federation.js';
import type { AimeatConfig } from '../../src/config.js';

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

describe('serviceSummaryRequestHeaders', () => {
    const config = { nodeId: 'aimeat-unit-a' } as AimeatConfig;

    it('the unsigned form is x-source-node alone, and needs no key', async () => {
        const h = await serviceSummaryRequestHeaders(config, { nodeId: 'aimeat-old', softwareVersion: '4.0.2' }, null);
        expect(h).toEqual({ 'Accept': 'application/json', 'x-source-node': 'aimeat-unit-a' });
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
