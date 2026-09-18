/**
 * @file visitors-model.js
 * @description The arithmetic behind the Visitors section, kept free of the DOM so it can be
 *   tested from Node (the precedent is data-map-model.js): folding a day series into chart bars,
 *   shading a country by its count, turning a coordinate into a point on the bundled atlas, and
 *   the table that joins the two ways a country is named. The reverse proxy reports ISO 3166-1
 *   alpha-2 (`FI`); the atlas (public/lib/aimeat-atlas@1.json) keys its shapes by ISO numeric
 *   (`246`). Neither side can change, so the join lives here.
 *
 *   The table covers every country the atlas draws. A country that is not in it, or that the atlas
 *   is too coarse to draw (Singapore, Malta), still appears in the list under the map: the list is
 *   the answer and the map is the picture of it.
 * @structure ISO_NUMERIC · numericOf · alpha2Of · WINDOW_MIN/MAX/DEFAULT · clampWindow ·
 *   barsFromSeries · shadeStep · projectPoint · zoomBox · placesOfCountry
 * @usage import { barsFromSeries, numericOf } from './visitors-model.js'
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */

/** ISO 3166-1 alpha-2 → numeric, as the atlas spells the numeric (no leading zeros stripped). */
export var ISO_NUMERIC = {
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

var ALPHA2_BY_NUMERIC = (function () {
  var out = {};
  Object.keys(ISO_NUMERIC).forEach(function (a2) { out[ISO_NUMERIC[a2]] = a2; });
  return out;
})();

/** The atlas id for a country code, or null when the atlas has no shape for it. */
export function numericOf(alpha2) {
  var key = String(alpha2 || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(ISO_NUMERIC, key) ? ISO_NUMERIC[key] : null;
}

/** The country code for an atlas id, or null (the atlas draws three shapes ISO gives no number). */
export function alpha2Of(numeric) {
  var key = String(numeric || '');
  return Object.prototype.hasOwnProperty.call(ALPHA2_BY_NUMERIC, key) ? ALPHA2_BY_NUMERIC[key] : null;
}

export var WINDOW_MIN = 0;
export var WINDOW_MAX = 360;
export var WINDOW_DEFAULT = 30;

/** A day window the node will accept. Anything unreadable is the default, as on the node. */
export function clampWindow(raw) {
  var n = Number(raw);
  if (raw === '' || raw === null || raw === undefined || !isFinite(n) || n < 0 || Math.floor(n) !== n) return WINDOW_DEFAULT;
  return Math.min(n, WINDOW_MAX);
}

function addDays(day, n) {
  var d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Fold a sparse day series into evenly spaced bars over [from, to].
 *
 * The node answers only the days that had something, and a chart that drew only those would make
 * three busy days in a quiet year look like three days. Every day in the window gets a slot, and
 * past 120 days the slots are weeks, so a year is 52 bars and not 360 hairlines.
 *
 * `keys` names the stacked parts of a bar (`['signed_in', 'anonymous']`); each bar carries them
 * and their sum.
 */
export function barsFromSeries(series, from, to, keys) {
  var byDay = {};
  (series || []).forEach(function (row) { byDay[row.day] = row; });
  var days = [];
  for (var d = from; d <= to && days.length <= WINDOW_MAX + 1; d = addDays(d, 1)) days.push(d);
  var step = days.length > 120 ? 7 : 1;
  var bars = [];
  for (var i = 0; i < days.length; i += step) {
    var slice = days.slice(i, i + step);
    var bar = { from: slice[0], to: slice[slice.length - 1], total: 0 };
    keys.forEach(function (k) { bar[k] = 0; });
    slice.forEach(function (day) {
      var row = byDay[day];
      if (!row) return;
      keys.forEach(function (k) { var v = Number(row[k]) || 0; bar[k] += v; bar.total += v; });
    });
    bars.push(bar);
  }
  var max = bars.reduce(function (m, b) { return Math.max(m, b.total); }, 0);
  return { bars: bars, max: max, grain: step === 7 ? 'week' : 'day' };
}

/**
 * Which of five shades a country gets, 1 (fewest) to 5 (most); 0 for none.
 *
 * On a square-root scale, because visitor counts are lopsided: one home country with hundreds and
 * a long tail of ones. A linear scale paints the home country and leaves every other country the
 * same pale shade, which hides exactly the thing a map is for.
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
 * The view box that shows one country with air around it, never tighter than `minSpan`.
 *
 * The floor matters for a small country: zooming Luxembourg to its own bounding box would blow a
 * 110m-resolution outline up into a handful of straight lines. And the box keeps the canvas's
 * 2:1 shape, so the map does not change its height under the reader as they click around.
 */
export function zoomBox(bbox, w, h, minSpan) {
  var cx = (bbox[0] + bbox[2]) / 2;
  var cy = (bbox[1] + bbox[3]) / 2;
  var spanX = Math.max((bbox[2] - bbox[0]) * 1.6, minSpan);
  var spanY = Math.max((bbox[3] - bbox[1]) * 1.6, minSpan / 2);
  var width = Math.min(w, Math.max(spanX, spanY * 2));
  var height = width / 2;
  var x = Math.max(0, Math.min(w - width, cx - width / 2));
  var y = Math.max(0, Math.min(h - height, cy - height / 2));
  return { x: x, y: y, w: width, h: height };
}

/** The regions and cities of one country, most people first. */
export function placesOfCountry(places, alpha2) {
  return (places || [])
    .filter(function (p) { return p.country === alpha2; })
    .slice()
    .sort(function (a, b) { return b.people - a.people; });
}
