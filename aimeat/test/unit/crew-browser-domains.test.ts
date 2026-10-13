/**
 * @file test/unit/crew-browser-domains.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a proposal's crew definition must say when a member has the tool `browser`
 *   (services/crew-browser-domains.ts): the hostnames it may open, each a plain public hostname.
 * @version-history
 *   v1.0.0 — 2026-10-13 — Written before the function.
 */
import { describe, it, expect } from 'vitest';
import { browserDomainsError } from '../../src/services/crew-browser-domains.js';

const def = (tools: string[], domains?: unknown) => ({
  agents: [{ name: 'reader', role: 'Reader', tools }],
  tasks: [],
  ...(domains !== undefined ? { browser_domains: domains } : {}),
});

describe('browserDomainsError', () => {
  it('says nothing about a definition with no browser and no list', () => {
    expect(browserDomainsError(def(['web', 'memory']))).toBeNull();
    expect(browserDomainsError({})).toBeNull();
    expect(browserDomainsError(null)).toBeNull();
  });

  it('refuses the tool without the list, naming the member', () => {
    const e = browserDomainsError(def(['browser']));
    expect(e).toContain('reader');
    expect(e).toContain('browser_domains');
    expect(browserDomainsError(def(['browser'], []))).toContain('browser_domains');
  });

  it('refuses the list when no member has the tool', () => {
    expect(browserDomainsError(def(['web'], ['example.com']))).toContain('no member has the tool');
  });

  it('accepts plain public hostnames, exact, up to twenty', () => {
    expect(browserDomainsError(def(['browser'], ['example.com', 'www.example.com', 'shop.example.co.uk', 'xn--hme-qla.fi']))).toBeNull();
    expect(browserDomainsError(def(['browser'], Array.from({ length: 20 }, (_, i) => `site${i}.example.com`)))).toBeNull();
    expect(browserDomainsError(def(['browser'], Array.from({ length: 21 }, (_, i) => `site${i}.example.com`)))).toContain('20');
  });

  it('refuses what is not a hostname, each with its reason', () => {
    const bad = (value: unknown) => browserDomainsError(def(['browser'], [value]));
    expect(bad('https://example.com')).toContain('web address');
    expect(bad('example.com/contact')).toContain('web address');
    expect(bad('example.com:8080')).toContain('port');
    expect(bad('*.example.com')).toContain('wildcard');
    expect(bad('192.168.1.10')).toContain('IP address');
    expect(bad('[::1]')).toContain('IP address');
    expect(bad('localhost')).toContain('this computer');
    expect(bad('printer.local')).toContain('private network');
    expect(bad('wiki.corp')).toContain('private network');
    expect(bad('intranet')).toContain('one word');
    expect(bad('Example.com')).toContain('lower case');
    expect(bad('example.com.')).toContain('dot');
    expect(bad('häme.fi')).toContain('punycode');
    expect(bad(42)).toContain('text');
    expect(bad('')).toContain('text');
  });

  it('refuses a hostname listed twice', () => {
    expect(browserDomainsError(def(['browser'], ['example.com', 'example.com']))).toContain('twice');
  });

  it('refuses a list that is not a list', () => {
    expect(browserDomainsError(def(['browser'], 'example.com'))).toContain('list');
  });
});
