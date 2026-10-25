/**
 * @file vendored-maps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The map half of the vendored packs that extends the leaflet pack: proj4leaflet, a
 *   Leaflet map in a projected coordinate system (Finland's ETRS-TM35FIN, EPSG:3067, first). Its own
 *   file rather than more entries in vendored.ts, which is at 749 lines and would cross the 800-line
 *   rule with this pack. vendored.ts spreads this array into VENDORED_PACKS, so every consumer sees
 *   one list.
 * @structure MAP_PACKS: LibraryPack[]
 * @usage Imported by ./vendored.ts only. Do not import directly.
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial: proj4 2.22.0 under /lib/proj4@2/ and Proj4Leaflet 1.0.2 under
 *     /lib/proj4leaflet@1/. First consumer: jussil/riistakartta.html, which drew MML's maps in
 *     EPSG:3067 with both loaded from a CDN (support thread fad37516, 2026-10-24).
 */
import type { LibraryPack } from './types.js';

export const MAP_PACKS: LibraryPack[] = [
  {
    id: 'proj4leaflet',
    kind: 'vendored',
    category: 'maps',
    title: 'Projected maps (proj4 + Proj4Leaflet)',
    description: 'A Leaflet map in a national projection instead of Web Mercator: Finland\'s ETRS-TM35FIN (EPSG:3067), the projection the National Land Survey (MML) draws its maps in, or any other proj4 definition. proj4 also converts coordinates between systems on its own. Loads after the leaflet pack.',
    url: '/lib/proj4leaflet@1/proj4leaflet.js',
    include: [
      '<script src="{{BASE_URL}}/lib/proj4@2/proj4.js"></script>',
      '<script src="{{BASE_URL}}/lib/proj4leaflet@1/proj4leaflet.js"></script>',
    ],
    requires: ['leaflet'],
    version: '1.0.2',
    majorPin: 'proj4@2/ and proj4leaflet@1/ (a future major ships beside them as proj4@3/ or proj4leaflet@2/; these directories never change)',
    license: 'MIT (proj4 2.22.0) + BSD-2-Clause (Proj4Leaflet 1.0.2)',
    sourceUrl: 'https://github.com/kartena/Proj4Leaflet',
    apiSurface: 'window.proj4 (proj4(from, to, [x, y]), proj4.defs) and L.Proj (L.Proj.CRS, L.Proj.geoJson)',
    aiDoc: [
      'Load order matters: leaflet.css, leaflet.js, then proj4.js, then proj4leaflet.js. Proj4Leaflet',
      'throws "Leaflet and proj4 must be loaded first" otherwise. All three are served by this node.',
      'Finland, ETRS-TM35FIN (EPSG:3067) on the national JHS 180 tile grid, the one MML\'s maps use:',
      "  var crs = new L.Proj.CRS('EPSG:3067',",
      "    '+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', {",
      '    resolutions: [8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0.5, 0.25],',
      '    origin: [-548576, 8388608],',
      '    bounds: L.bounds([-548576, 6291456], [1548576, 8388608]) });',
      "  var map = L.map(el, { crs: crs, maxZoom: 15 }).setView([61.5, 25.5], 3);   // still [lat, lon]",
      'The map keeps taking [lat, lon] in setView, markers and GeoJSON: the CRS converts them. Zoom',
      'levels are the 16 resolutions above (0 to 15), not Web Mercator\'s 0 to 19.',
      'Tiles MUST be drawn in the same projection. OpenStreetMap\'s tile.openstreetmap.org tiles are',
      'Web Mercator and do not fit this CRS. MML\'s maps in EPSG:3067, served by Kapsi ry over WMS:',
      "  L.tileLayer.wms('https://tiles.kartat.kapsi.fi/peruskartta', { layers: 'peruskartta',",
      "    format: 'image/png', tileSize: 512 }).addTo(map);   // also taustakartta, ortokuva",
      'Leaflet sends the CRS code (EPSG:3067) in the WMS request by itself. The attribution is REQUIRED:',
      "  'Maps © National Land Survey of Finland (CC BY 4.0), served by Kapsi ry'.",
      'Coordinates without a map: proj4(\'EPSG:4326\', crs.code, [lon, lat]) after',
      "  proj4.defs('EPSG:3067', '+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');",
      'gives [easting, northing] in metres; proj4 takes [lon, lat], LON FIRST, unlike Leaflet.',
      'GeoJSON already in EPSG:3067 (a "crs" member naming it): L.Proj.geoJson(data).addTo(map).',
    ].join('\n'),
    changelog: [
      { version: '1.0.2', date: '2026-10-25', summary: 'Initial vendoring: proj4 2.22.0 (dist/proj4.js) under /lib/proj4@2/ and Proj4Leaflet 1.0.2 (src/proj4leaflet.js) under /lib/proj4leaflet@1/, both as published on npm (the repository stores Proj4Leaflet with LF line endings, upstream has CRLF; nothing else differs). First consumer: a hunting-area map drawing MML\'s maps in EPSG:3067.' },
    ],
    tierHint: 'T1',
    interviewTriggers: ['epsg:3067', 'tm35fin', 'etrs-tm35fin', 'proj4', 'projection', 'projektio', 'maanmittauslaitos', 'mml', 'peruskartta', 'kapsi'],
    sizeEstimate: '~137KB',
    status: 'preview',   // policy: new packs start preview; flip stable with an AEB result
    modelTier: 'any',
  },
];
