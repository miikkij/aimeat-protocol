/**
 * @file vendored-media.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The media half of the vendored packs: hls (HLS playback in a <video> element on
 *   every browser, not only Safari). Its own file rather than more entries in vendored.ts, which
 *   is at 713 lines and would cross the 800-line rule with the next pack. vendored.ts spreads this
 *   array into VENDORED_PACKS, so every consumer sees one list.
 * @structure MEDIA_PACKS: LibraryPack[]
 * @usage Imported by ./vendored.ts only. Do not import directly.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial: hls.js 1.7.3 vendored under /lib/hls@1/ for published apps
 *     that play a live stream in the browser (wish-tv-opas-ilmaisstreameille-ja-oma-tv-kalenteri).
 */
import type { LibraryPack } from '../library-packs.js';

export const MEDIA_PACKS: LibraryPack[] = [
  {
    id: 'hls',
    kind: 'vendored',
    category: 'media',
    title: 'HLS player (hls.js)',
    description: 'hls.js 1.7 (window.Hls) self-hosted: plays an HLS stream (an .m3u8 address, the shape of nearly every live TV and radio stream) in a plain <video> element on Chrome, Edge, Firefox and Android, where the browser cannot play it on its own. Safari plays HLS natively and the recipe below uses that path there.',
    url: '/lib/hls@1/hls.min.js',
    include: ['<script src="{{BASE_URL}}/lib/hls@1/hls.min.js"></script>'],
    requires: [],
    version: '1.7.3',
    majorPin: 'hls@1/ (a future hls.js 2 ships as hls@2/, this directory never changes)',
    license: 'Apache-2.0',
    sourceUrl: 'https://github.com/video-dev/hls.js',
    apiSurface: 'window.Hls (Hls.isSupported, new Hls(config), hls.loadSource, hls.attachMedia, hls.on(Hls.Events.*), hls.destroy)',
    aiDoc: [
      'hls.js 1.7 as window.Hls (UMD, self-hosted, never load it from a CDN). The one working recipe:',
      '  var video = document.querySelector("video");   // give it playsinline, controls and muted',
      '  function play(url) {',
      '    if (window.current) { window.current.destroy(); window.current = null; }   // ONE player per <video>',
      '    if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = url; video.play(); return; }  // Safari, iOS',
      '    if (!Hls.isSupported()) { /* tell the person: this browser cannot play the stream; offer the address for VLC */ return; }',
      '    var hls = new Hls({ enableWorker: true, lowLatencyMode: false });',
      '    window.current = hls;',
      '    hls.on(Hls.Events.ERROR, function (_e, data) {',
      '      if (!data.fatal) return;',
      '      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();          // a dropped segment: retry',
      '      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();',
      '      else { hls.destroy(); /* say the stream did not play, and offer the address */ }',
      '    });',
      '    hls.loadSource(url);',
      '    hls.attachMedia(video);',
      '    hls.on(Hls.Events.MANIFEST_PARSED, function () { video.play().catch(function () {}); });',
      '  }',
      'TWO THINGS THAT DECIDE WHETHER A FREE STREAM PLAYS, and neither is in your code:',
      '  1. CORS. hls.js fetches the playlist and every segment with XHR, so the stream host must answer',
      '     Access-Control-Allow-Origin for the app origin. Many free streams do not; the browser console',
      '     then shows a CORS refusal and hls.js reports a fatal NETWORK_ERROR on the manifest. There is no',
      '     client-side way around it: show the person the address with "Open in VLC" and "Copy address".',
      '  2. Autoplay. A browser plays sound only after a tap: start muted (the muted attribute) and let',
      '     the person unmute, or call play() from a click handler.',
      'Switching channels: destroy() the previous Hls before creating the next one, or two players fight',
      'over the same <video>. A stream marked "Not 24/7" in its playlist is often offline: a fatal error',
      'within a few seconds is that, not a bug, so say "this channel is off the air right now".',
      'The app CSP already allows this: media-src and connect-src permit https:, worker-src permits blob:.',
      'http:// stream addresses are mixed content on an https app and never load; show them as VLC-only.',
    ].join('\n'),
    changelog: [
      { version: '1.7.3', date: '2026-10-09', summary: 'Initial vendoring: dist/hls.min.js under /lib/hls@1/. First consumer: the TV guide app (in-browser playback of free HLS streams beside Open in VLC).' },
    ],
    tierHint: 'T1',
    interviewTriggers: ['hls', 'm3u8', 'stream', 'striimi', 'live tv', 'iptv', 'video player', 'soitin', 'suoratoisto', 'radio stream'],
    sizeEstimate: '~605KB',
    status: 'preview',   // policy: new packs start preview; flip stable with an AEB result
    modelTier: 'any',
  },
];
