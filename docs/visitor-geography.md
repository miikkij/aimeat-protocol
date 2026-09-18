# Visitor geography: telling a node where its visitors come from

An app's owner can see where the people who open the app come from: on a world map in the App
Catalog, or by asking their own AI (`aimeat_app_visitors`). This page is for the person who runs the
node. It says what the node needs from the reverse proxy for that map to fill in, and what is and is
not kept.

## What is kept, and what never is

- **No address is stored, anywhere.** The node does not look an address up and holds no address
  database. The reverse proxy resolves the visitor's address to a place and sends the place. The node
  reads "FI, Uusimaa, Helsinki" and never the address it came from.
- **Nothing is kept until the app's owner asks.** Measurement is off for every app until its owner
  switches it on, and the place is off until they pick a precision: `country`, `region` or `city`.
- **People only.** A named AI fetcher or another bot is counted, and never placed: its address is a
  data centre, and a map of data centres says nothing about readers.
- **Coarse on purpose.** City coordinates are rounded to one decimal (about 11 km). One month keeps
  at most 300 distinct regions or cities per app; past that the country stays exact and the finer
  place stops growing, and the report says so.
- **Unknown is counted as unknown.** A visit the proxy could not place is filed under the country
  code `ZZ`, so the map does not look more complete than it is.

A place tells where a person's network is, which is not always where the person is. A VPN or a
mobile carrier moves them to another city or country. The report carries that sentence with the
numbers.

The owner who switches this on answers for it towards their visitors. Counting visits by place
belongs in the app's privacy notice, and `city` on an app with a handful of readers comes close to
telling one reader from another. The coarsest precision that answers the question is the right one.

## The contract with the proxy

The node reads five request headers, and only when `AIMEAT_GEO_HEADERS=true`:

| Header | Value | Example |
|---|---|---|
| `X-Geo-Country` | ISO 3166-1 alpha-2 | `FI` |
| `X-Geo-Region` | Subdivision name or code | `Uusimaa` |
| `X-Geo-City` | City name, UTF-8 | `Jyväskylä` |
| `X-Geo-Lat` | Decimal degrees | `62.2415` |
| `X-Geo-Lon` | Decimal degrees | `25.7209` |

Every header is optional. A country that is not two letters is filed as unknown.

**Leave the flag off unless the proxy sets these headers.** A header is a thing any client can send.
Behind a proxy configured as below that does not matter, because `proxy_set_header` replaces whatever
the client sent, and an empty value removes the header. On a node with no such proxy the same header
would come straight from the visitor. What a forged place can do, where the flag is on and the proxy
is missing, is put a wrong row in the app owner's own report. Nothing is granted or refused on it.

## nginx

Needs `ngx_http_geoip2_module` and a city database in MaxMind DB format. Two free ones:
[DB-IP City Lite](https://db-ip.com/db/download/ip-to-city-lite) (CC BY 4.0, no account, monthly) and
MaxMind GeoLite2 City (free account and licence key, its terms ask for an update every 30 days).
Whichever you use, its licence is yours to meet. With DB-IP that is a credit line where the map is
shown, and the App Catalog prints the node's `AIMEAT_GEO_ATTRIBUTION` under the map when it is set.

In the `http` block:

```nginx
geoip2 /var/lib/geoip/city.mmdb {
    auto_reload 60m;
    $geo_country  country iso_code;
    $geo_region   subdivisions 0 names en;
    $geo_city     city names en;
    $geo_lat      location latitude;
    $geo_lon      location longitude;
}
```

In **every** `location` that proxies to the node, for the apex and for the app origin
(`*.apps.<host>`), which is where visitors land:

```nginx
proxy_set_header X-Geo-Country $geo_country;
proxy_set_header X-Geo-Region  $geo_region;
proxy_set_header X-Geo-City    $geo_city;
proxy_set_header X-Geo-Lat     $geo_lat;
proxy_set_header X-Geo-Lon     $geo_lon;
```

`proxy_set_header` directives are inherited from the outer level only when a `location` declares
none of its own. A `location` that already sets `Host` or `X-Subdomain` needs these five lines too,
or that location forwards the client's own headers untouched.

Then set `AIMEAT_GEO_HEADERS=true` and restart the node.

## Checking it

```bash
# Through the proxy, from outside. A place you did not send should come back.
curl -s -H "X-Geo-Country: XX" https://<your-node>/v1/build > /dev/null
```

Then open one of your own apps in a browser with measurement on and the place set to `country`, and
read the report: `GET /v1/apps/visitors?filename=<app>.html`. Your own country should be there, and
`XX` should not. `measurement.geo_available` in the same answer says whether the node reads the
headers at all.

## Any other proxy

Anything that can set request headers works: Caddy with a geo plugin, HAProxy with its own map
files, a CDN that passes `CF-IPCountry` (map it onto `X-Geo-Country` at the proxy). The contract is
the five headers and the rule that the proxy overwrites what the client sent.
