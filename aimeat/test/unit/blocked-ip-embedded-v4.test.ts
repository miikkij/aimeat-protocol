/**
 * @file blocked-ip-embedded-v4.test.ts
 * @description The outbound address rules read the IPv4 address that an IPv6 prefix carries
 *   (NAT64, 6to4, IPv4-compatible) and refuse the prefixes no public service needs (local-use
 *   NAT64, Teredo, site-local), plus the IPv4 benchmarking and IETF protocol ranges. A public IPv4
 *   address behind NAT64 and an ordinary global IPv6 address stay allowed.
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, IPv4-embedding IPv6 prefixes).
 */
import { describe, it, expect } from 'vitest';
import { blockedIpReason } from '../../src/utils/blocked-ip.js';
import { validateOutboundUrl } from '../../src/utils/url-validator.js';

describe('blockedIpReason: IPv6 prefixes that carry an IPv4 address', () => {
    const refused = [
        '64:ff9b::a00:1',        // NAT64 of 10.0.0.1
        '64:ff9b::10.0.0.1',     // the same, dotted
        '64:ff9b::7f00:1',       // NAT64 of 127.0.0.1
        '64:ff9b::a9fe:a9fe',    // NAT64 of 169.254.169.254
        '64:ff9b:1::a00:1',      // local-use NAT64
        '2002:a00:1::1',         // 6to4 of 10.0.0.1
        '2002:7f00:1::',         // 6to4 of 127.0.0.1
        '2002:a9fe:a9fe::1',     // 6to4 of 169.254.169.254
        '::a00:1',               // IPv4-compatible 10.0.0.1
        '::10.0.0.1',            // the same, dotted (the form Node's lookup prints)
        '::7f00:1',              // IPv4-compatible 127.0.0.1
        '::169.254.169.254',
        '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
        'fec0::1',               // deprecated site-local
        '198.18.0.1',            // benchmarking
        '198.19.255.254',
        '192.0.0.1',             // IETF protocol assignments
    ];
    for (const ip of refused) {
        it(`refuses ${ip}`, () => { expect(blockedIpReason(ip)).not.toBeNull(); });
    }

    const allowed = [
        '64:ff9b::808:808',      // NAT64 of 8.8.8.8, the IPv6-only node's way to public IPv4
        '64:ff9b::8.8.8.8',
        '2002:808:808::1',       // 6to4 of a public address
        '2606:4700:4700::1111',  // ordinary global IPv6
        '2001:db8::1'.replace('db8', '4860'), // 2001:4860::1, global, outside Teredo's 2001::/32
        '8.8.8.8',
        '198.20.0.1',
        '192.0.1.1',
    ];
    for (const ip of allowed) {
        it(`allows ${ip}`, () => { expect(blockedIpReason(ip)).toBeNull(); });
    }
});

describe('validateOutboundUrl: literal IPv6 hosts that carry a private IPv4 address', () => {
    for (const url of ['http://[64:ff9b::10.0.0.1]/', 'http://[::10.0.0.1]/', 'http://[2002:a00:1::1]/', 'http://[::ffff:10.0.0.1]/']) {
        it(`refuses ${url}`, async () => {
            const r = await validateOutboundUrl(url);
            expect(r.valid).toBe(false);
        });
    }
});
