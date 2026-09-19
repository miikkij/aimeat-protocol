/**
 * @file test/unit/screenshot-browser-env.test.ts
 * @description The environment the node's headless browser starts with
 *   (services/screenshot-capture.ts, browserLaunchEnv). The production unit file preloads jemalloc
 *   into the node process, a child inherits it, and Chromium dies before it opens a page: 21 apps
 *   on aimeat.io had no thumbnail on 2026-09-19 because of it.
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { browserLaunchEnv } from '../../src/services/screenshot-capture.js';

describe('browserLaunchEnv', () => {
  it('drops what deploy/aimeat.service sets for the node process only', () => {
    const env = browserLaunchEnv({
      LD_PRELOAD: '/usr/lib/x86_64-linux-gnu/libjemalloc.so.2',
      MALLOC_CONF: 'background_thread:true,dirty_decay_ms:10000,muzzy_decay_ms:10000',
      NODE_OPTIONS: '--max-old-space-size=4096 --heapsnapshot-signal=SIGUSR2',
      HOME: '/home/aimeat',
      PATH: '/usr/bin',
    });
    expect(env).toEqual({ HOME: '/home/aimeat', PATH: '/usr/bin' });
  });

  it('keeps everything else, because the browser finds its cache and its display through it', () => {
    const env = browserLaunchEnv({ HOME: '/home/aimeat', PLAYWRIGHT_BROWSERS_PATH: '/opt/pw', LANG: 'C.UTF-8' });
    expect(env).toEqual({ HOME: '/home/aimeat', PLAYWRIGHT_BROWSERS_PATH: '/opt/pw', LANG: 'C.UTF-8' });
  });

  it('leaves out a variable that has no value, which the launch option refuses', () => {
    expect(browserLaunchEnv({ HOME: '/home/aimeat', EMPTY: undefined })).toEqual({ HOME: '/home/aimeat' });
  });
});
