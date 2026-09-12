/**
 * @file msm-grouping.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the admin MSM page is arranged by: where a manifest points, what it offers, and
 *   which manifests therefore describe the same thing.
 *
 *   THE FIXTURE IS REAL. All ten manifests below were read off aimeat.io on 2026-09-12, with their
 *   own hosts and action names, because the arrangement is only worth anything if it separates what
 *   is actually there: five descriptions of one RSS feed written over two days by two people, three
 *   that geocode a place across two different services, and two that stand alone.
 *
 *   BOTH HALVES OF THE RULE ARE NEEDED. Host alone splits the three geocoders, two of which go to
 *   OpenStreetMap and one to OpenCage. Action name alone splits the five RSS manifests, two of
 *   which say fetch-feed and three fetch-rss. These tests pin both failures.
 * @usage cd aimeat && pnpm exec vitest run test/unit/msm-grouping.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the MSM page in the poster face).
 */
import { describe, it, expect } from 'vitest';
import { msmHosts, msmActionIds } from '../../src/services/msm-parser.js';
import { relatedSets, loneOnes, hostsOf, actionsOf } from '../../public/views/admin/msm-tab.groups.js';

describe('msmHosts', () => {
    it('names the host each action would call, once', () => {
        expect(msmHosts({
            actions: [
                { id: 'a', endpoint: { method: 'GET', url: 'https://nominatim.openstreetmap.org/search?q={input.q}' } },
                { id: 'b', endpoint: { method: 'GET', url: 'https://nominatim.openstreetmap.org/reverse?lat={input.lat}' } },
            ],
        })).toEqual(['nominatim.openstreetmap.org']);
    });

    it('leaves out an address that is a template end to end', () => {
        // happyadmin/MML Municipalities Dataset Integration really has one of these.
        expect(msmHosts({
            actions: [
                { id: 'meta', endpoint: { method: 'GET', url: 'https://www.maanmittauslaitos.fi/api/x' } },
                { id: 'file', endpoint: { method: 'GET', url: '{input.url}' } },
            ],
        })).toEqual(['www.maanmittauslaitos.fi']);
    });

    it('drops credentials and a port, and lowercases', () => {
        expect(msmHosts({ actions: [{ id: 'a', endpoint: { url: 'https://user:pw@API.Example.COM:8443/v1' } }] }))
            .toEqual(['api.example.com']);
    });

    it('answers for a manifest that has nothing to read', () => {
        expect(msmHosts(undefined)).toEqual([]);
        expect(msmHosts({})).toEqual([]);
        expect(msmHosts({ actions: 'not a list' })).toEqual([]);
        expect(msmHosts({ actions: [null, { id: 'a' }, { id: 'b', endpoint: {} }] })).toEqual([]);
    });
});

describe('msmActionIds', () => {
    it('lists what a manifest offers, once each', () => {
        expect(msmActionIds({ actions: [{ id: 'fetch-rss' }, { id: 'fetch-incident-page' }, { id: 'fetch-rss' }] }))
            .toEqual(['fetch-rss', 'fetch-incident-page']);
    });

    it('answers for a manifest that has nothing to read', () => {
        expect(msmActionIds(null)).toEqual([]);
        expect(msmActionIds({ actions: [{}, { id: 7 }] })).toEqual([]);
    });
});

// ── The ten on aimeat.io, by their own names, hosts and actions ──────────────────────────────
const TH = 'www.tilannehuone.fi';
const OSM = 'nominatim.openstreetmap.org';

const TEN = [
    { name: 'Tilannehuone RSS Feed Integration', hosts: [TH], actions: ['fetch-feed'] },
    { name: 'Geocoding Service Integration (OSM Nominatim)', hosts: [OSM], actions: ['geocode-municipality'] },
    { name: 'Tilannehuone RSS Integration', hosts: [TH], actions: ['fetch-rss'] },
    { name: 'Geocoding Service MSM (OpenCage)', hosts: ['api.opencagedata.com'], actions: ['geocode-municipality'] },
    { name: 'Tilannehuone RSS MSM', hosts: [TH], actions: ['fetch-rss'] },
    { name: 'Municipality Geocoding MSM', hosts: [OSM], actions: ['geocode-municipality', 'reverse-geocode'] },
    { name: 'Tilannehuone RSS MSM2', hosts: [TH], actions: ['fetch-rss', 'fetch-incident-page'] },
    { name: 'happyadmin/MML Municipalities Dataset Integration', hosts: ['www.maanmittauslaitos.fi'], actions: ['get-product-metadata', 'fetch-dataset-file', 'head-dataset-file'] },
    { name: 'happyadmin/Tilannehuone RSS Integration', hosts: [TH], actions: ['fetch-feed'] },
    { name: 'happyadmin/Digitransit GraphQL API', hosts: ['api.digitransit.fi'], actions: ['stop-departures', 'search-stops'] },
];

describe('relatedSets', () => {
    const sets = relatedSets(TEN);

    it('finds the two piles and nothing else', () => {
        expect(sets.map(s => s.items.length)).toEqual([5, 3]);
    });

    it('gathers the five that describe one RSS feed, and says it was the address', () => {
        const five = sets[0];
        expect(five.items.map(m => m.name).sort()).toEqual([
            'Tilannehuone RSS Feed Integration',
            'Tilannehuone RSS Integration',
            'Tilannehuone RSS MSM',
            'Tilannehuone RSS MSM2',
            'happyadmin/Tilannehuone RSS Integration',
        ]);
        expect(five.sharedHosts).toEqual([TH]);
        expect(five.sharedActions).toEqual([]);
    });

    it('gathers the three that geocode a place across two services, and says it was the action', () => {
        const three = sets[1];
        expect(three.items.map(m => m.name).sort()).toEqual([
            'Geocoding Service Integration (OSM Nominatim)',
            'Geocoding Service MSM (OpenCage)',
            'Municipality Geocoding MSM',
        ]);
        expect(three.sharedHosts).toEqual([]);
        expect(three.sharedActions).toEqual(['geocode-municipality']);
    });

    it('leaves the two that describe nothing anybody else describes on their own', () => {
        expect(loneOnes(TEN, sets).map(m => m.name)).toEqual([
            'happyadmin/MML Municipalities Dataset Integration',
            'happyadmin/Digitransit GraphQL API',
        ]);
    });

    it('never puts one manifest in two piles', () => {
        const seen = sets.flatMap(s => s.items.map(m => m.name));
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen.length + loneOnes(TEN, sets).length).toBe(TEN.length);
    });

    /**
     * The address alone would split the three geocoders, because two go to OpenStreetMap and one to
     * OpenCage. This is the half of the rule that keeps them together.
     */
    it('joins two manifests that call different services but offer the same action', () => {
        const pair = relatedSets([
            { name: 'osm', hosts: [OSM], actions: ['geocode-municipality'] },
            { name: 'opencage', hosts: ['api.opencagedata.com'], actions: ['geocode-municipality'] },
        ]);
        expect(pair).toHaveLength(1);
        expect(pair[0].sharedActions).toEqual(['geocode-municipality']);
    });

    /**
     * The action name alone would split the five RSS manifests, because two of them say fetch-feed
     * and three say fetch-rss. This is the other half.
     */
    it('joins two manifests that call one address under different action names', () => {
        const pair = relatedSets([
            { name: 'feed', hosts: [TH], actions: ['fetch-feed'] },
            { name: 'rss', hosts: [TH], actions: ['fetch-rss'] },
        ]);
        expect(pair).toHaveLength(1);
        expect(pair[0].sharedHosts).toEqual([TH]);
    });

    it('carries a relation through a third manifest', () => {
        const chain = relatedSets([
            { name: 'a', hosts: ['one.example'], actions: ['x'] },
            { name: 'b', hosts: ['one.example'], actions: ['y'] },
            { name: 'c', hosts: ['two.example'], actions: ['y'] },
        ]);
        expect(chain).toHaveLength(1);
        expect(chain[0].items).toHaveLength(3);
        expect(chain[0].sharedHosts).toEqual([]);
        expect(chain[0].sharedActions).toEqual([]);
    });

    it('answers with nothing when no two describe the same thing', () => {
        expect(relatedSets([TEN[7], TEN[9]])).toEqual([]);
        expect(relatedSets([])).toEqual([]);
    });

    it('reads a row that carries neither list without falling over', () => {
        expect(hostsOf({})).toEqual([]);
        expect(actionsOf({ actions: null })).toEqual([]);
        expect(relatedSets([{ name: 'a' }, { name: 'b' }])).toEqual([]);
    });
});
