/**
 * @file test/unit/dataspace-protocol.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of the Dataspace Protocol provider (plan doc-mvwxcas3dom3, D8): the ids
 *   this node mints and parses, the two state machines, the ODRL offers and agreement, and the catalog
 *   and dataset bodies, each validated against the normative DSP 2025-1 JSON Schemas
 *   (test/fixtures/dsp/), and the settings parsers (did:web, trusted issuers, static tokens, TCK mode).
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8).
 */
import { describe, it, expect } from 'vitest';
import {
    agreementIdOf, callbackUrl, datasetIdOf, locateAgreement, locatePid, negotiationAck, negotiationError, negotiationNext,
    negotiationPid, offerIdOf, parseDatasetId, parseOfferId, takesDataspaceCredential, transferAck, transferNext, transferPid,
} from '../../src/services/dataspace/contract.js';
import { agreementOf, decimalOf, offerOf } from '../../src/services/dataspace/policy.js';
import { catalogJson, datasetJson } from '../../src/services/dataspace/catalog.js';
import { nodeDidWeb, staticParticipantFor, tckModeVerdict, trustedIssuers } from '../../src/services/dataspace/settings.js';
import { negotiationScript, tckDatasets, transferScript } from '../../src/services/dataspace/tck.js';
import { dspSchemaErrors } from '../helpers/dsp-schemas.js';

const HEX = '0123456789abcdef0123456789abcdef';
const config = { baseUrl: 'https://node.example.com', nodeId: 'node-1' };

describe('ids', () => {
    it('a process id names its owner and record, and nothing else parses as one', () => {
        const pid = negotiationPid('alice.b', HEX);
        expect(locatePid(pid, 'cn')).toEqual({ owner: 'alice.b', hex: HEX });
        expect(locatePid(pid, 'tp')).toBeNull();
        expect(locatePid(transferPid('bob', HEX), 'tp')).toEqual({ owner: 'bob', hex: HEX });
        expect(locatePid('urn:uuid:1', 'cn')).toBeNull();
        expect(locatePid(`urn:aimeat:dsp:cn:${Buffer.from('../x').toString('base64url')}:${HEX}`, 'cn')).toBeNull();
        expect(locateAgreement(agreementIdOf('alice', HEX))).toEqual({ owner: 'alice', hex: HEX });
    });
    it('dataset and offer ids round-trip; an open offer has no ref and the others need one', () => {
        expect(parseDatasetId(datasetIdOf('alice', 'budget'))).toEqual({ owner: 'alice', name: 'budget' });
        expect(parseDatasetId('urn:aimeat:dataset:alice:Bad Name')).toBeNull();
        expect(parseOfferId(offerIdOf('alice', 'budget', 'open'))).toEqual({ owner: 'alice', name: 'budget', kind: 'open' });
        expect(parseOfferId(offerIdOf('alice', 'budget', 'share', 'c-123'))).toEqual({ owner: 'alice', name: 'budget', kind: 'share', ref: 'c-123' });
        expect(parseOfferId('urn:aimeat:offer:alice:budget:share')).toBeNull();
        expect(parseOfferId('urn:aimeat:offer:alice:budget:open:x')).toBeNull();
    });
    it('the DSP paths take their own credential; nothing else does', () => {
        expect(takesDataspaceCredential('/dsp/2025-1/negotiations/request')).toBe(true);
        expect(takesDataspaceCredential('/dsp/2025-1')).toBe(true);
        expect(takesDataspaceCredential('/dsp/2025-10/x')).toBe(false);
        expect(takesDataspaceCredential('/v1/memory')).toBe(false);
    });
    it('a callback path keeps the colons of a pid and escapes the rest', () => {
        expect(callbackUrl('http://cb.example/base/', 'negotiations', 'urn:uuid:1', 'agreement')).toBe('http://cb.example/base/negotiations/urn:uuid:1/agreement');
        expect(callbackUrl('http://cb.example', 'transfers', 'a/b c', 'start')).toBe('http://cb.example/transfers/a%2Fb%20c/start');
    });
});

describe('state machines', () => {
    it('negotiation: only the DSP transitions, nothing after a terminal state', () => {
        expect(negotiationNext('OFFERED', 'counter')).toBe('REQUESTED');
        expect(negotiationNext('REQUESTED', 'counter')).toBeNull();
        expect(negotiationNext('OFFERED', 'accepted')).toBe('ACCEPTED');
        expect(negotiationNext('ACCEPTED', 'verification')).toBeNull();
        expect(negotiationNext('AGREED', 'verification')).toBe('VERIFIED');
        expect(negotiationNext('OFFERED', 'verification')).toBeNull();
        expect(negotiationNext('AGREED', 'termination')).toBe('TERMINATED');
        expect(negotiationNext('FINALIZED', 'termination')).toBeNull();
        expect(negotiationNext('TERMINATED', 'termination')).toBeNull();
    });
    it('transfer: a consumer starts only from SUSPENDED; completion and suspension only from STARTED', () => {
        expect(transferNext('REQUESTED', 'start')).toBeNull();
        expect(transferNext('SUSPENDED', 'start')).toBe('STARTED');
        expect(transferNext('REQUESTED', 'completion')).toBeNull();
        expect(transferNext('SUSPENDED', 'completion')).toBeNull();
        expect(transferNext('STARTED', 'suspension')).toBe('SUSPENDED');
        expect(transferNext('REQUESTED', 'termination')).toBe('TERMINATED');
        expect(transferNext('TERMINATED', 'start')).toBeNull();
        expect(transferNext('COMPLETED', 'termination')).toBeNull();
    });
});

describe('bodies against the DSP 2025-1 schemas', () => {
    const offer = offerOf(offerIdOf('alice', 'budget', 'share', 'c1'), {
        usage: { resale: false, derivatives: false, attribution: true }, purpose: 'Budget report', expires: '2027-01-01T00:00:00.000Z',
    });
    const priced = offerOf(offerIdOf('alice', 'budget', 'exchange', 'off-1'), { priced: { amount: 12_500_000, currency: 'EUR', model: 'per_month', offeringId: 'off-1' } });
    const ds = { id: datasetIdOf('alice', 'budget'), title: 'Budget', license: 'CC-BY-4.0', offers: [{ kind: 'share' as const, offer }, { kind: 'exchange' as const, offer: priced }] };

    it('a Catalog with one dataset, and one with none, validate; an offer carries no target', () => {
        expect(dspSchemaErrors(catalogJson(config, [ds]))).toEqual([]);
        expect(dspSchemaErrors(catalogJson(config, []))).toEqual([]);
        expect(offer).not.toHaveProperty('target');
        expect(dspSchemaErrors(datasetJson(config, ds, true))).toEqual([]);
    });
    it('the ODRL rules: purpose and end constrain use, resale and derivatives are prohibited, attribution and the price are duties', () => {
        expect((offer.permission as Array<Record<string, unknown>>)[0]!.constraint).toEqual([
            { leftOperand: 'odrl:purpose', operator: 'eq', rightOperand: 'Budget report' },
            { leftOperand: 'odrl:dateTime', operator: 'lteq', rightOperand: '2027-01-01T00:00:00.000Z' },
        ]);
        expect(offer.prohibition).toEqual([{ action: 'odrl:distribute' }, { action: 'odrl:derive' }]);
        expect(offer.obligation).toEqual([{ action: 'odrl:attribute' }]);
        const duty = (priced.obligation as Array<Record<string, unknown>>)[0]!;
        expect(duty.action).toBe('odrl:compensate');
        expect(duty.constraint).toContainEqual({ leftOperand: 'odrl:payAmount', operator: 'eq', rightOperand: '12.50' });
        expect(duty.constraint).toContainEqual({ leftOperand: 'odrl:elapsedTime', operator: 'eq', rightOperand: 'P30D' });
    });
    it('the Agreement message and the acks validate', () => {
        const agreement = agreementOf(agreementIdOf('alice', HEX), offer, { target: ds.id, assigner: 'did:web:node.example.com', assignee: 'did:web:consumer.example' });
        expect(agreement.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        const msg = { '@context': ['https://w3id.org/dspace/2025/1/context.jsonld'], '@type': 'ContractAgreementMessage', providerPid: negotiationPid('alice', HEX), consumerPid: 'urn:uuid:c', agreement };
        expect(dspSchemaErrors(msg)).toEqual([]);
        expect(dspSchemaErrors(negotiationAck({ providerPid: 'p', consumerPid: 'c', state: 'REQUESTED' }))).toEqual([]);
        expect(dspSchemaErrors(transferAck({ providerPid: 'p', consumerPid: 'c', state: 'STARTED' }))).toEqual([]);
        expect(dspSchemaErrors(negotiationError('p', 'c', 'X', 'why'))).toEqual([]);
    });
    it('the TCK datasets validate as datasets', () => {
        for (const d of tckDatasets()) expect(dspSchemaErrors(datasetJson(config, d, true))).toEqual([]);
    });
    it('decimalOf writes micro-units as a decimal string', () => {
        expect(decimalOf(12_500_000)).toBe('12.50');
        expect(decimalOf(1_234_567)).toBe('1.234567');
        expect(decimalOf(3_000_000)).toBe('3.00');
    });
});

describe('settings', () => {
    it('did:web of a public address, with a port and a path', () => {
        expect(nodeDidWeb('https://aimeat.io')).toBe('did:web:aimeat.io');
        expect(nodeDidWeb('http://localhost:40600/')).toBe('did:web:localhost%3A40600');
        expect(nodeDidWeb('https://x.example/node/a')).toBe('did:web:x.example:node:a');
    });
    it('trusted issuers per data space, and a bare DID list as one data space', () => {
        expect([...trustedIssuers({ baseUrl: '', dataspaceTrustedIssuers: 'catenax=did:web:a,did:web:b;gaiax=did:web:c' })])
            .toEqual([['catenax', ['did:web:a', 'did:web:b']], ['gaiax', ['did:web:c']]]);
        expect([...trustedIssuers({ baseUrl: '', dataspaceTrustedIssuers: 'did:web:a,did:web:b' })]).toEqual([['default', ['did:web:a', 'did:web:b']]]);
        expect(trustedIssuers({ baseUrl: '', dataspaceTrustedIssuers: '' }).size).toBe(0);
    });
    it('a static token names its participant; a wrong one names none', () => {
        const c = { baseUrl: '', dataspaceStaticTokens: 'did:web:x=tok=1;TCK_PARTICIPANT=t2' };
        expect(staticParticipantFor(c, 'tok=1')).toBe('did:web:x');
        expect(staticParticipantFor(c, 't2')).toBe('TCK_PARTICIPANT');
        expect(staticParticipantFor(c, 'tok')).toBeNull();
        expect(staticParticipantFor(c, '')).toBeNull();
    });
    it('the TCK mode is never in force on a public address or a node that is not a test node', () => {
        expect(tckModeVerdict({ baseUrl: 'https://aimeat.io', dataspaceTckMode: true, testMode: true }).on).toBe(false);
        expect(tckModeVerdict({ baseUrl: 'http://localhost:1', dataspaceTckMode: true }).on).toBe(process.env.NODE_ENV === 'test');
        expect(tckModeVerdict({ baseUrl: 'http://localhost:1', dataspaceTckMode: true, devMode: true }).on).toBe(true);
        expect(tckModeVerdict({ baseUrl: 'http://localhost:1', dataspaceTckMode: false, devMode: true }).on).toBe(false);
    });
    it('the TCK scripts follow the TCK table', () => {
        expect(negotiationScript('ACN0101')?.onRequest).toBe('offer');
        expect(negotiationScript('ACN0104')?.onRequest).toBe('agree');
        expect(negotiationScript('ACN0207')?.onVerified).toBe('terminate');
        expect(negotiationScript('ACN0303')?.onAccepted).toBe('none');
        expect(transferScript('ATP0104')).toEqual(['start', 'suspend', 'start', 'complete']);
        expect(transferScript('ATP0301')).toEqual([]);
        expect(transferScript('urn:x')).toBeNull();
    });
});
