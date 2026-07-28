#!/usr/bin/env bash
# @file check-agent-readiness.sh
# @description Checks every agent-readability surface this node publishes, over HTTP, against any
#   host — a local dev server, production, or an app origin. The E2E suite (test/e2e-agent-readiness.ts)
#   proves the same things against a fresh test server; this proves them against whatever is actually
#   deployed, which is the question a report answers and a test does not.
# @usage
#   ./scripts/check-agent-readiness.sh                          # http://localhost:40050
#   ./scripts/check-agent-readiness.sh https://aimeat.io
#   ./scripts/check-agent-readiness.sh https://nuotta.apps.aimeat.io --app
# @version-history
#   v1.0.0 — 2026-07-28 — Initial (agent-readability phase 11)
set -u
B="${1:-http://localhost:40050}"; B="${B%/}"
APP_MODE="${2:-}"
pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
code() { curl -s -o /dev/null -w '%{http_code}' -m 20 "$1"; }
ctype(){ curl -s -o /dev/null -w '%{content_type}' -m 20 ${2:+-H "$2"} "$1"; }
body() { curl -s -m 20 ${2:+-H "$2"} "$1"; }

if [ "$APP_MODE" = "--app" ]; then
  echo "== App origin: $B =="
  # A sitemap may only list URLs from the host that serves it. The node's sitemap answering here
  # is the failure this checks for, not a stylistic preference.
  foreign=$(body "$B/sitemap.xml" | grep -o 'https\?://[^<]*' | grep -cv "^${B}" || true)
  [ "${foreign:-1}" -eq 0 ] && ok "sitemap.xml lists only this origin" || bad "sitemap.xml has $foreign foreign URLs"
  body "$B/robots.txt" | grep -q "Sitemap: ${B}/sitemap.xml" && ok "robots.txt points at this origin" || bad "robots.txt points elsewhere"
  card=$(body "$B/.well-known/mcp.json")
  echo "$card" | grep -q '"app"' && ok "mcp.json describes the app" || bad "mcp.json is the node's card"
  echo "$card" | grep -q '"name"' && ok "mcp.json has a root name" || bad "mcp.json has no root name"
  html=$(body "$B/")
  for t in '<html lang' 'rel="canonical"' 'name="description"' 'og:title' 'application/ld+json'; do
    echo "$html" | grep -q -- "$t" && ok "head: $t" || bad "head: $t missing"
  done
  n=$(echo "$html" | grep -c '<h1[ >]')
  [ "$n" -eq 1 ] && ok "exactly one h1" || bad "$n h1 elements, expected 1"
  echo "$html" | grep -o 'rel="canonical" href="[^"]*"' | grep -q "$B" && ok "canonical points here" || bad "canonical points elsewhere"
  for p in /llms.txt /AGENTS.md /sitemap.md /llms-full.txt; do
    [ "$(code "$B$p")" = "200" ] && ok "$p" || bad "$p → $(code "$B$p")"
  done
  echo; echo "PASS: $pass  FAIL: $fail"; [ "$fail" -eq 0 ] || exit 1; exit 0
fi

echo "== Node: $B =="
echo "-- Site-wide documents --"
for p in /llms.txt /llms-full.txt /sitemap.xml /sitemap.md /AGENTS.md /agents.md /robots.txt /v1/glossary.md /v1/glossary.json; do
  c=$(code "$B$p"); [ "$c" = "200" ] && ok "$p" || bad "$p → $c"
done

echo "-- llmstxt.org --"
L=$(body "$B/llms.txt")
[ "$(printf '%s' "$L" | grep -c '^> ')" -ge 1 ]  && ok "L4 blockquote summary" || bad "L4 blockquote summary"
[ "$(printf '%s' "$L" | grep -c '](')" -ge 15 ]  && ok "L6 markdown links"     || bad "L6 markdown links"
printf '%s' "$L" | grep -A3 '^## Documentation' | grep -q '^- \[' && ok "L5 H2 link list" || bad "L5 H2 link list"
diff <(body "$B/llms.txt") <(body "$B/llms-full.txt") >/dev/null && ok "L10 llms-full.txt matches" || bad "L10 llms-full.txt differs"
echo "  -- L7: every absolute link resolves --"
printf '%s' "$L" | grep -o '](https\?://[^)]*)' | tr -d '](' | tr -d ')' | sort -u | while read -r u; do
  c=$(code "$u"); [ "$c" -lt 400 ] 2>/dev/null || echo "    FAIL $c $u"
done

echo "-- Protocol discovery --"
[ "$(curl -sI -m 20 "$B/.well-known/mcp.json" | grep -ci access-control-allow-origin)" -ge 1 ] \
  && ok "C1 mcp.json CORS" || bad "C1 mcp.json CORS"
body "$B/.well-known/mcp.json" | grep -q '"name"' && ok "C2 mcp.json root name" || bad "C2 mcp.json root name"
body "$B/.well-known/ucp" | grep -q '"capabilities":{' && ok "C8 ucp capabilities is an object" || bad "C8 ucp capabilities is not an object"
A=$(body "$B/.well-known/acp.json")
for f in '"protocol"' '"api_base_url"' '"transports"' '"services"'; do
  echo "$A" | grep -q "$f" && ok "C21 acp $f" || bad "C21 acp $f missing"
done

echo "-- Root content negotiation --"
case "$(ctype "$B/" 'Accept: */*')"            in text/html*)      ok "wildcard Accept → HTML";;      *) bad "wildcard Accept → $(ctype "$B/" 'Accept: */*')";; esac
case "$(ctype "$B/" 'Accept: application/json')" in application/json*) ok "JSON Accept → JSON";;       *) bad "JSON Accept → wrong type";; esac
case "$(ctype "$B/?format=json")"              in application/json*) ok "?format=json → JSON";;        *) bad "?format=json → wrong type";; esac
case "$(ctype "$B/" 'Accept: text/markdown')"  in text/markdown*)  ok "markdown Accept → markdown";;  *) bad "markdown Accept → wrong type";; esac

echo "-- Pages --"
for u in $(body "$B/sitemap.xml" | grep -o '<loc>[^<]*' | sed 's/<loc>//'); do
  path="${u#"$B"}"; echo "  $path"
  h=$(body "$u" 'Accept: text/html')
  for t in '<html lang' 'rel="canonical"' 'name="description"' 'og:title' 'og:description' 'application/ld+json' 'v1/glossary'; do
    echo "$h" | grep -q -- "$t" && ok "    $t" || bad "    $t"
  done
  n=$(echo "$h" | grep -c '<h1[ >]'); [ "$n" -eq 1 ] && ok "    one h1" || bad "    $n h1 elements"
  echo "$h" | grep -o 'rel="canonical" href="[^"]*"' | grep -q "$u" && ok "    canonical is self" || bad "    canonical is not self"
  md="$u.md"; [ "$path" = "/" ] && md="$B/index.md"
  c=$(code "$md"); [ "$c" = "200" ] && ok "    .md mirror" || bad "    .md mirror → $c"
  case "$(ctype "$u" 'Accept: text/markdown')" in text/markdown*) ok "    negotiates markdown";; *) bad "    negotiates markdown";; esac
  curl -sI -m 20 "$md" | grep -qi 'link:.*canonical' && ok "    .md canonical Link header" || bad "    .md canonical Link header"
  body "$md" | grep -q '^## Site map' && ok "    .md site-map section" || bad "    .md site-map section"
done

echo; echo "PASS: $pass  FAIL: $fail"
[ "$fail" -eq 0 ] || exit 1
