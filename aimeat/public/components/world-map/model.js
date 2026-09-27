/**
 * @file public/components/world-map/model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The arithmetic behind the world map, free of the DOM: the table that joins the two ways
 *   a country is named, a country's shade from its count, a coordinate as a point on the atlas, and
 *   the view box that shows one country. The reverse proxy reports ISO 3166-1 alpha-2 (`FI`); the
 *   node's atlas (public/lib/aimeat-atlas@1.json, Natural Earth, projected once at build time) keys its
 *   shapes by ISO numeric (`246`). Neither side can change, so the join lives here.
 *
 *   The table covers every country the atlas draws. A country that is not in it, or that the atlas is
 *   too coarse to draw (Singapore, Malta), still appears in the list under the map: the list is the
 *   answer and the map is the picture of it.
 * @structure ISO_NUMERIC · numericOf · alpha2Of · shadeStep · projectPoint · zoomBox · placesOfCountry
 * @usage import { numericOf, shadeStep } from '/components/world-map/model.js'
 * @version-history
 *   v1.0.0 — 2026-09-27 — Moved from the old app catalogue (src/static/app-catalog/js/visitors-model.js),
 *     the map's half unchanged, for components/WorldMap.js (appcat detail builder B).
 */

/** ISO 3166-1 alpha-2 → numeric, as the atlas spells the numeric (leading zeros kept). */
export const ISO_NUMERIC = {
  AF: '004', AL: '008', DZ: '012', AO: '024', AQ: '010', AR: '032', AM: '051', AU: '036', AT: '040',
  AZ: '031', BS: '044', BD: '050', BY: '112', BE: '056', BZ: '084', BJ: '204', BT: '064', BO: '068',
  BA: '070', BW: '072', BR: '076', BN: '096', BG: '100', BF: '854', BI: '108', KH: '116', CM: '120',
  CA: '124', CF: '140', TD: '148', CL: '152', CN: '156', CO: '170', CG: '178', CD: '180', CR: '188',
  CI: '384', HR: '191', CU: '192', CY: '196', CZ: '203', DK: '208', DJ: '262', DO: '214', EC: '218',
  EG: '818', SV: '222', GQ: '226', ER: '232', EE: '233', SZ: '748', ET: '231', FK: '238', FJ: '242',
  FI: '246', FR: '250', TF: '260', GA: '266', GM: '270', GE: '268', DE: '276', GH: '288', GR: '300',
  GL: '304', GT: '320', GN: '324', GW: '624', GY: '328', HT: '332', HN: '340', HU: '348', IS: '352',
  IN: '356', ID: '360', IR: '364', IQ: '368', IE: '372', IL: '376', IT: '380', JM: '388', JP: '392',
  JO: '400', KZ: '398', KE: '404', KP: '408', KR: '410', KW: '414', KG: '417', LA: '418', LV: '428',
  LB: '422', LS: '426', LR: '430', LY: '434', LT: '440', LU: '442', MG: '450', MW: '454', MY: '458',
  ML: '466', MR: '478', MX: '484', MD: '498', MN: '496', ME: '499', MA: '504', MZ: '508', MM: '104',
  NA: '516', NP: '524', NL: '528', NC: '540', NZ: '554', NI: '558', NE: '562', NG: '566', MK: '807',
  NO: '578', OM: '512', PK: '586', PS: '275', PA: '591', PG: '598', PY: '600', PE: '604', PH: '608',
  PL: '616', PT: '620', PR: '630', QA: '634', RO: '642', RU: '643', RW: '646', SA: '682', SN: '686',
  RS: '688', SL: '694', SK: '703', SI: '705', SB: '090', SO: '706', ZA: '710', SS: '728', ES: '724',
  LK: '144', SD: '729', SR: '740', SE: '752', CH: '756', SY: '760', TW: '158', TJ: '762', TZ: '834',
  TH: '764', TL: '626', TG: '768', TT: '780', TN: '788', TR: '792', TM: '795', UG: '800', UA: '804',
  AE: '784', GB: '826', US: '840', UY: '858', UZ: '860', VU: '548', VE: '862', VN: '704', EH: '732',
  YE: '887', ZM: '894', ZW: '716',
};

const ALPHA2_BY_NUMERIC = Object.fromEntries(Object.entries(ISO_NUMERIC).map(([a2, n]) => [n, a2]));

/** The atlas id for a country code, or null when the atlas has no shape for it. */
export function numericOf(alpha2) {
  const key = String(alpha2 || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(ISO_NUMERIC, key) ? ISO_NUMERIC[key] : null;
}

/** The country code for an atlas id, or null (the atlas draws three shapes ISO gives no number). */
export function alpha2Of(numeric) {
  const key = String(numeric || '');
  return Object.prototype.hasOwnProperty.call(ALPHA2_BY_NUMERIC, key) ? ALPHA2_BY_NUMERIC[key] : null;
}

/**
 * Which of five shades a country gets, 1 (fewest) to 5 (most); 0 for none. On a square-root scale,
 * because visitor counts are lopsided: a linear scale paints the home country and leaves every other
 * country the same pale shade, which hides exactly the thing a map is for.
 */
export function shadeStep(count, max) {
  if (!count || !max) return 0;
  return Math.max(1, Math.min(5, Math.ceil(Math.sqrt(count / max) * 5)));
}

/** A coordinate as a point on the atlas canvas (equirectangular, the projection it was built in). */
export function projectPoint(lat, lon, w, h) {
  return { x: ((Number(lon) + 180) / 360) * w, y: ((90 - Number(lat)) / 180) * h };
}

/**
 * The view box that shows one country with air around it, never tighter than `minSpan`, and always
 * in the canvas's 2:1 shape, so the map does not change its height as the reader clicks around.
 */
export function zoomBox(bbox, w, h, minSpan) {
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;
  const spanX = Math.max((bbox[2] - bbox[0]) * 1.6, minSpan);
  const spanY = Math.max((bbox[3] - bbox[1]) * 1.6, minSpan / 2);
  const width = Math.min(w, Math.max(spanX, spanY * 2));
  const height = width / 2;
  const x = Math.max(0, Math.min(w - width, cx - width / 2));
  const y = Math.max(0, Math.min(h - height, cy - height / 2));
  return { x, y, w: width, h: height };
}

/** The regions and cities of one country, most first. */
export function placesOfCountry(places, alpha2) {
  return (places || []).filter((p) => p.country === alpha2).slice().sort((a, b) => (b.count || 0) - (a.count || 0));
}
