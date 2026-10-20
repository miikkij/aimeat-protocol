/**
 * @file test/unit/cookie-consent-startup.test.ts
 * @description Regression coverage for cookie assets blocking app parsing and first paint.
 *   Executes the generated loader and consent-gated owner tags with controlled DOM/asset events.
 *   A separate real-Chrome check verifies rendering, which this DOM harness cannot prove.
 * @version-history
 *   v1.0.1 - 2026-10-20 - The library address may carry its revision (`?v=`).
 *   v1.0.0 - 2026-10-19 - Assert nonblocking assets, failure isolation and consent initialization.
 */
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { buildStandaloneSnippetJs, cookieConsentSnippet } from '../../src/middleware/cookie-consent.js';
import { ownerTagsSnippet } from '../../src/services/visibility/analytics-tags.js';
import type { AimeatConfig } from '../../src/config.js';

const config = {
  baseUrl: 'https://node.example', cookieConsentEnabled: true,
  cookieConsentCategories: ['necessary', 'analytics'], cookieConsentPolicyUrl: null,
  analyticsTagsEnabled: true,
} as unknown as AimeatConfig;
const options = { assetBase: 'https://node.example', nonce: 'regressionNonce20261019' };

class Element extends EventTarget {
  tagName: string;
  children: Element[] = [];
  attributes = new Map<string, string>();
  src = '';
  href = '';
  rel = '';
  media = '';
  nonce = '';
  id = '';
  async = false;
  innerHTML = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(tag: string) { super(); this.tagName = tag.toUpperCase(); }
  appendChild(child: Element) { this.children.push(child); return child; }
  append(child: Element) { this.appendChild(child); }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
    if (['src', 'href', 'rel', 'media', 'nonce', 'id'].includes(name)) Object.assign(this, { [name]: String(value) });
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? Reflect.get(this, name) ?? null; }
  querySelector(selector: string): Element | null {
    if (selector === 'button' && this.innerHTML.includes('<button')) {
      const button = new Element('button'); this.children.push(button); return button;
    }
    return this.children.find(child => selector.startsWith('#') ? child.id === selector.slice(1) : child.tagName.toLowerCase() === selector) ?? null;
  }
  override dispatchEvent(event: Event) {
    if (event.type === 'load') this.onload?.();
    if (event.type === 'error') this.onerror?.();
    return super.dispatchEvent(event);
  }
}

function browser(ready = false) {
  const document = Object.assign(new EventTarget(), {
    head: new Element('head'), body: ready ? new Element('body') : null as Element | null,
    readyState: ready ? 'complete' : 'loading', documentElement: { lang: 'fi' },
    currentScript: Object.assign(new Element('script'), { nonce: options.nonce }), cookie: '',
    createElement: (name: string) => new Element(name),
    getElementById(id: string): Element | null {
      return [...this.head.children, ...(this.body?.children ?? [])].find(element => element.id === id) ?? null;
    },
  });
  const window = Object.assign(new EventTarget(), { CookieConsent: undefined as undefined | Record<string, unknown> });
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const warning = vi.fn();
  const reload = vi.fn();
  const context = {
    window, document, navigator: { language: 'fi-FI', globalPrivacyControl: false },
    location: { search: '', hostname: 'game.apps.node.example', reload }, localStorage: { getItem: () => null },
    URLSearchParams, Promise, Event, CustomEvent, Document: class {}, console: { warn: warning, error: warning },
    setTimeout(callback: () => void, delay = 0) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id: number) { timers.delete(id); },
    get CookieConsent() { return window.CookieConsent; },
  };
  const execute = (code: string) => runInNewContext(code, context);
  const finishDocument = () => {
    document.body ??= new Element('body'); document.readyState = 'interactive';
    document.dispatchEvent(new Event('DOMContentLoaded'));
  };
  const inline = (html: string, attribute = 'data-aimeat-cookie-banner') => {
    const match = new RegExp(`<script ${attribute}[^>]*>([\\s\\S]*?)<\\/script>`).exec(html);
    if (!match) throw new Error(`Missing ${attribute} script`);
    execute(match[1]);
  };
  const assets = () => document.head.children.filter(element => /cookieconsent\.(css|umd\.js)(\?v=[\w.-]+)?$/.test(element.href || element.src));
  const asset = (kind: 'css' | 'script') => {
    const result = assets().find(element => kind === 'css' ? element.rel === 'stylesheet' : element.tagName === 'SCRIPT');
    expect(result, `${kind} must load through a dynamically created element`).toBeDefined();
    return result!;
  };
  const loadLibrary = (run: (config: unknown) => unknown = vi.fn(() => Promise.resolve(true)), acceptedCategory = () => false) => {
    window.CookieConsent = { run, acceptedCategory, showPreferences: vi.fn() };
    asset('script').dispatchEvent(new Event('load'));
    return run;
  };
  const runTimeouts = () => {
    for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); }
  };
  return { document, window, timers, warning, reload, execute, inline, finishDocument, assets, asset, loadLibrary, runTimeouts };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('cookie consent startup regression: no parser or first-paint dependency', () => {
  it('emits no parser-inserted external script or render-blocking stylesheet', () => {
    const html = cookieConsentSnippet(config, options);
    expect(html).not.toMatch(/<script\b[^>]*\bsrc=/);
    expect(html).not.toMatch(/<link\b[^>]*\brel=["']stylesheet/);
    expect(html).toContain(`<script data-aimeat-cookie-banner nonce="${options.nonce}">`);
  });

  it.each(['css-first', 'script-first'] as const)('waits for both assets and the body (%s), then initializes exactly once', async order => {
    const page = browser(); page.inline(cookieConsentSnippet(config, options));
    expect(page.assets()).toHaveLength(2);
    expect(page.asset('css').media).toBe('print');
    expect(page.asset('script').async).toBe(true);
    expect(page.asset('script').nonce).toBe(options.nonce);
    const run = vi.fn((_config: unknown) => Promise.resolve(true));
    if (order === 'css-first') { page.asset('css').dispatchEvent(new Event('load')); page.loadLibrary(run); }
    else { page.loadLibrary(run); expect(run).not.toHaveBeenCalled(); page.asset('css').dispatchEvent(new Event('load')); }
    expect(run).not.toHaveBeenCalled();
    page.finishDocument(); await flush();
    expect(page.asset('css').media).toBe('all');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toMatchObject({ language: { default: 'fi' }, categories: { necessary: { readOnly: true }, analytics: {} } });
    page.finishDocument(); page.asset('css').dispatchEvent(new Event('load')); page.asset('script').dispatchEvent(new Event('load'));
    await flush(); expect(run).toHaveBeenCalledTimes(1);
  });

  it('works when the snippet arrives after the document is ready', async () => {
    const page = browser(true); page.inline(cookieConsentSnippet(config, options));
    const run = page.loadLibrary(); expect(run).not.toHaveBeenCalled();
    page.asset('css').dispatchEvent(new Event('load')); await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(['css', 'script'] as const)('keeps analytics closed when the %s asset fails, including a late load event', async kind => {
    const page = browser();
    const snippet = ownerTagsSnippet(config, { enabled: true, clarityProjectId: 'k7x2m9qp1a', ga4MeasurementId: 'G-ABC123XYZ9', updatedAt: '' });
    page.inline(snippet, 'data-aimeat-tags'); page.inline(snippet);
    const consent = vi.fn(); page.window.addEventListener('cc:onConsent', consent);
    const run = vi.fn(() => Promise.resolve(true));
    page.asset(kind).dispatchEvent(new Event('error'));
    page.finishDocument(); page.loadLibrary(run); page.asset('css').dispatchEvent(new Event('load'));
    await flush();
    expect(run).not.toHaveBeenCalled(); expect(consent).not.toHaveBeenCalled();
    expect(page.document.head.children.filter(element => /clarity\.ms|googletagmanager/.test(element.src))).toHaveLength(0);
    expect(page.warning).toHaveBeenCalled();
  });

  it('abandons a timed-out asset and ignores a later load', async () => {
    const page = browser(true); page.inline(cookieConsentSnippet(config, options));
    expect(page.timers.size).toBeGreaterThan(0); page.runTimeouts();
    const run = page.loadLibrary(); page.asset('css').dispatchEvent(new Event('load')); await flush();
    expect(run).not.toHaveBeenCalled(); expect(page.warning).toHaveBeenCalled();
  });

  it.each(['throw', 'reject', 'false'] as const)('contains CookieConsent.run %s and offers an explicit reload without granting consent', async failure => {
    const page = browser(true); page.inline(cookieConsentSnippet(config, { ...options, mark: true }));
    const consent = vi.fn(); page.window.addEventListener('cc:onConsent', consent);
    const run = vi.fn(() => {
      if (failure === 'throw') throw new Error('consent initialization failed');
      if (failure === 'reject') return Promise.reject(new Error('consent initialization failed'));
      return false;
    });
    page.loadLibrary(run); page.asset('css').dispatchEvent(new Event('load')); await flush();
    expect(consent).not.toHaveBeenCalled();
    const mark = page.document.getElementById('aimeat-cookie-mark');
    expect(mark).not.toBeNull();
    const retry = mark!.children.find(element => element.tagName === 'BUTTON');
    expect(retry?.getAttribute('aria-label')).toMatch(/latautuu uudelleen|reload/i);
    retry!.dispatchEvent(new Event('click')); expect(page.reload).toHaveBeenCalledTimes(1);
    expect(page.warning).toHaveBeenCalled();
  });

  it('uses the library consent event to restore prior consent once, without a synthetic acceptance', async () => {
    const page = browser(); let accepted = false;
    const snippet = ownerTagsSnippet(config, { enabled: true, clarityProjectId: 'k7x2m9qp1a', ga4MeasurementId: null, updatedAt: '' });
    page.inline(snippet, 'data-aimeat-tags'); page.inline(snippet);
    const consent = vi.fn(); page.window.addEventListener('cc:onConsent', consent);
    page.finishDocument();
    const run = vi.fn(() => { accepted = true; page.window.dispatchEvent(new Event('cc:onConsent')); return Promise.resolve(true); });
    page.loadLibrary(run, () => accepted);
    expect(page.document.head.children.filter(element => /clarity\.ms/.test(element.src))).toHaveLength(0);
    page.asset('css').dispatchEvent(new Event('load')); await flush();
    expect(run).toHaveBeenCalledTimes(1); expect(consent).toHaveBeenCalledTimes(1);
    expect(page.document.head.children.filter(element => /clarity\.ms/.test(element.src))).toHaveLength(1);
    page.window.dispatchEvent(new Event('cc:onChange'));
    expect(page.document.head.children.filter(element => /clarity\.ms/.test(element.src))).toHaveLength(1);
  });

  it('uses the same nonblocking asset and initialization behavior for the standalone endpoint', async () => {
    const page = browser(true); page.execute(buildStandaloneSnippetJs(config));
    expect(page.asset('css').media).toBe('print'); expect(page.asset('script').async).toBe(true);
    const run = page.loadLibrary(); expect(run).not.toHaveBeenCalled();
    page.asset('css').dispatchEvent(new Event('load')); await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
