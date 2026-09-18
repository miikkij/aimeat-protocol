/**
 * @file src/utils/geo-headers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads WHERE a request came from, out of headers the reverse proxy set.
 *
 *   THE NODE DOES NOT LOCATE ANYBODY. It holds no address database and makes no lookup: the proxy in
 *   front of it (nginx with the geoip2 module) resolves the visitor's address to a place and hands
 *   over the place. What arrives here is "FI, Uusimaa, Helsinki", and the address it was derived
 *   from is never read in this file or stored anywhere. Ruled 2026-09-18.
 *
 *   OFF UNLESS THE OPERATOR SAYS THE PROXY SETS THEM (`AIMEAT_GEO_HEADERS=true`). A header is a
 *   thing any client can send. Behind a proxy configured as documented that does not matter, because
 *   `proxy_set_header` replaces what the client sent and an empty value removes it. On a node with no
 *   such proxy the same header would come straight from the visitor, so an unset flag means these
 *   headers are not read at all. What a forged place buys, where the flag is on and the proxy is
 *   not, is a wrong row in the page owner's own report. Nothing is granted or refused on it.
 *
 *   NAMES ARRIVE AS BYTES. nginx forwards `Jyväskylä` as UTF-8 and Node reads a header as latin1, so
 *   the value reaches JavaScript as mojibake. It is re-read as UTF-8 when that round trip is clean.
 * @structure GEO_HEADER_NAMES · geoFromHeaders(enabled, get)
 * @usage
 *   const geo = geoFromHeaders(config.geoHeaders, (name) => req.get(name));
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial, for the place a signal stream may keep per visit.
 */
import type { SignalGeoInput } from '../models/signal-schemas.js';

/** The contract with the proxy. Documented for operators in docs/visitor-geography.md. */
export const GEO_HEADER_NAMES = {
  country: 'x-geo-country',
  region: 'x-geo-region',
  city: 'x-geo-city',
  lat: 'x-geo-lat',
  lon: 'x-geo-lon',
} as const;

/** A header value as text: latin1 bytes re-read as UTF-8, kept only when nothing was lost. */
function text(raw: string | undefined): string | null {
  if (!raw) return null;
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  const value = decoded.includes('�') ? raw : decoded;
  return value.trim().slice(0, 128) || null;
}

function number(raw: string | undefined): number | null {
  if (!raw || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The place the proxy reported for this request, or null when the node is not told.
 *
 * `get` is a header reader rather than a request, so a service or a test can call this without an
 * Express object. Validation of the values (two capital letters, coordinate range, name length)
 * happens where they are stored, in signal-service.ts: this reads, that decides.
 */
export function geoFromHeaders(
  enabled: boolean, get: (name: string) => string | undefined,
): SignalGeoInput | null {
  if (!enabled) return null;
  const country = text(get(GEO_HEADER_NAMES.country));
  const region = text(get(GEO_HEADER_NAMES.region));
  const city = text(get(GEO_HEADER_NAMES.city));
  // Told-but-unknown is an answer, and it is not null: the proxy looked and found nothing (a
  // private address, a fresh allocation), which the report counts as an unknown place. Null is
  // kept for "this node is not told at all", where counting unknowns would fill a map with noise.
  return {
    country: country ? country.toUpperCase() : null,
    region, city,
    lat: number(get(GEO_HEADER_NAMES.lat)),
    lon: number(get(GEO_HEADER_NAMES.lon)),
  };
}
