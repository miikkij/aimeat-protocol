/**
 * @file front-demo2.js
 * @description The sales-mode experiment's script (front-demo2.html + front-demo2.fi.html),
 *   forked from front-demo.js. What differs: the app grid is CURATED — a featured list with
 *   composed bilingual descriptions leads (TINKI, the Experience Center, TURBO, NOSTE,
 *   CADENCE and friends), local test junk is filtered out, and the remaining slots fill from
 *   the most-opened real apps. The Experience Center renders even when this node's API does
 *   not list it, by its public address. Everything still degrades to the baked-in HTML.
 * @version-history
 *   v1.1.0 - 2026-08-19 - Publish order (TARGET-066): counters are API-only (no baked numbers,
 *     a counting line until the answer lands, dashes on failure), fill cards refuse developer
 *     jargon and untranslated descriptions (LÄHETIN joined the curated list), and the founding
 *     banner + honor wall render behind a flag that is OFF — and even on, only when the store's
 *     founding data source reports at least one member sold.
 *   v1.0.0 - 2026-08-19 - Initial: curated bilingual grid + junk filter; strip and chip as before.
 */
(function () {
  'use strict';

  var FI = document.documentElement.lang === 'fi';
  var GRID_SIZE = 8;

  /** The apps this page insists on showing, with descriptions composed per language.
   *  `match` is tested against the manifest name; `url` is the fallback address for the ones
   *  that live on their own subdomain rather than in this node's app listing. */
  var FEATURED = [
    { match: 'experience center', url: 'https://experience-center.apps.aimeat.io',
      name: 'Experience Center',
      en: 'Learn the whole platform hands-on, free. The guided tour of everything on this page.',
      fi: 'Opi koko alusta kädestä pitäen, ilmaiseksi. Opastettu kierros kaikkeen tällä sivulla.' },
    { match: 'tinki', name: 'TINKI',
      en: 'AI-native auction house: agents bid for you, sealed and fair.',
      fi: 'AI-natiivi huutokauppa: agentit huutavat puolestasi, suljetusti ja reilusti.' },
    { match: 'turbo', name: 'TURBO',
      en: 'Monetize the API you already have: per-call pricing in minutes.',
      fi: 'Muuta nykyinen API:si tuloiksi: kutsukohtainen hinnoittelu minuuteissa.' },
    { match: 'noste', name: 'NOSTE',
      en: 'From zero to your first sale: start a real small business here.',
      fi: 'Nollasta ensimmäiseen kauppaan: aloita oikea pienyritys täällä.' },
    { match: 'cadence', name: 'CADENCE',
      en: 'The CRM that took over from HubSpot: your customers, your pace.',
      fi: 'CRM, joka otti HubSpotin paikan: sinun asiakkaasi, sinun tahtisi.' },
    { match: 'aamukatsaus', name: 'Aamukatsaus',
      en: 'A morning brief that researches, writes and publishes itself on schedule.',
      fi: 'Aamukatsaus, joka tutkii, kirjoittaa ja julkaisee itsensä ajallaan.' },
    { match: 'universe', name: 'UNIVERSE',
      en: 'Persistent 3D worlds your agents build and keep alive.',
      fi: 'Pysyviä 3D-maailmoja, joita agenttisi rakentavat ja pitävät elossa.' },
    { match: 'lähetin', name: 'LÄHETIN',
      en: 'Team social posting: one shared space, per-channel texts, calendar scheduling — and the numbers come back to you.',
      fi: 'Tiimin somejulkaisut: yhteinen tila, kanavakohtaiset tekstit, ajastus kalenterista, ja luvut palaavat sinulle.' },
  ];

  /** A fill card must speak the customer's language. Developer vocabulary (version stamps,
   *  library talk, verify jargon) marks a description as internal, and those apps wait for a
   *  composed description before they get floor space. */
  var JARGON = /v\d+\.\d+|local verify|shared indicator|library|sdk|cortex\b|api\b/i;

  /** Local test debris has no place on a sales floor. */
  function isJunk(a) {
    var m = a.manifest || {};
    var name = (m.name || a.filename || '');
    var desc = (m.description || '');
    return /local test|test copy|^test\b/i.test(desc)
      || /^(m-room|drop|v2|p[0-9]|probe|victim|other|patched)/i.test(name.trim());
  }

  function txt(id, value) {
    var el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.textContent = String(value);
  }

  fetch('/v1/public/node-totals')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var d = j && j.data;
      if (!d) return;
      var fmt = function (n) { return Number(n).toLocaleString(FI ? 'fi-FI' : 'en-US'); };
      txt('fd-n-apps', fmt(d.apps));
      txt('fd-n-opens', fmt(d.downloads));
      txt('fd-n-agents', fmt(d.agents));
      txt('fd-n-online', fmt(d.agents_online));
      txt('fd-strip-note', FI
        ? 'Laskettu täältä juuri äsken. Luvut vain kasvavat.'
        : 'Counted right here just now. They only go up.');
    })
    .catch(function (err) {
      // No baked numbers to fall back on (publish order, item 5): the strip says the count is
      // inside rather than showing a stale figure as if it were live.
      console.warn('[front-demo2] totals not readable:', err.message);
      ['fd-n-apps', 'fd-n-opens', 'fd-n-agents', 'fd-n-online'].forEach(function (id) { txt(id, '–'); });
      txt('fd-strip-note', FI
        ? 'Elävä laskuri on oven takana: astu demoon ja laske itse.'
        : 'The live count is one door away: step into the demo and count for yourself.');
    });

  /**
   * Founding members (TARGET-066). The flag is OFF until the operator opens the programme;
   * sessionStorage 'aimeat.founding' = '1' turns it on for browser verification only.
   *
   * THE DATA SOURCE IS THE STORE'S OWN, read here by the same address (decision recorded in
   * evt-t066-shop-live-20260819): one public memory record, ext:shop key `founders`, shape
   * { total, taken, founders: [{ n, name?, url? }] } — the full ledger stays in the store's
   * private key, and this page sees only what the wall shows. One source, two surfaces.
   *
   * TODO(store): the record lives on the shop node today; when the store deploys, the same
   * data must be reachable from THIS origin (mirror or proxy), because the page CSP allows
   * same-origin fetches only. A missing key (?soft=1) or taken = 0 renders nothing even with
   * the flag on, which is the zero-sold fixture.
   */
  var FOUNDING_ENABLED = false;
  function foundingOn() {
    if (FOUNDING_ENABLED) return true;
    try { return sessionStorage.getItem('aimeat.founding') === '1'; }
    catch (err) { console.warn('[front-demo2] founding override not readable:', err.message); return false; }
  }
  function readFoundingState() {
    return fetch('/v1/memory/ext%3Ashop/founders?soft=1')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var v = j && j.data && (j.data.value !== undefined ? j.data.value : j.data);
        if (!v || typeof v !== 'object') return null;
        return {
          sold: Number(v.taken) || 0,
          cap: Number(v.total) || 50,
          members: (v.founders || []).map(function (f) {
            return {
              label: (FI ? 'Perustaja #' : 'Founder #') + f.n + (f.name ? ' · ' + f.name : ''),
              url: f.url || null,
            };
          }),
        };
      });
  }
  if (foundingOn()) {
    readFoundingState().then(function (st) {
      if (!st || !(st.sold >= 1)) return;
      var banner = document.getElementById('fd-founding');
      if (banner) {
        banner.textContent = (FI ? 'Founding-jäsenet: ' : 'Founding members: ')
          + st.sold + '/' + (st.cap || 50) + (FI ? ' varattu' : ' taken');
        banner.hidden = false;
      }
      var wall = document.getElementById('fd-founding-wall');
      var rows = (st.members || []).filter(function (m) { return m && m.label; });
      if (wall && rows.length > 0) {
        var h = document.createElement('h2');
        h.textContent = FI ? 'Kunniaseinä' : 'The honor wall';
        var ul = document.createElement('ul');
        rows.forEach(function (m) {
          var li = document.createElement('li');
          var el = document.createElement(m.url ? 'a' : 'span');
          if (m.url) { el.setAttribute('href', m.url); el.setAttribute('rel', 'noopener'); el.setAttribute('target', '_blank'); }
          el.textContent = m.label;
          li.appendChild(el);
          ul.appendChild(li);
        });
        wall.appendChild(h);
        wall.appendChild(ul);
        wall.hidden = false;
      }
    }).catch(function (err) { console.warn('[front-demo2] founding state not readable, nothing renders:', err.message); });
  }

  fetch('/v1/apps?sort=popular&limit=60')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var apps = (j && j.data && j.data.apps) || [];
      var grid = document.getElementById('fd-apps');
      if (!grid || apps.length === 0) return;

      var used = [];
      var cards = [];

      var card = function (name, desc, url, meta) {
        var a = document.createElement('a');
        a.className = 'fd-app';
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        var n = document.createElement('span');
        n.className = 'fd-app-name';
        n.textContent = name;
        var d = document.createElement('span');
        d.className = 'fd-app-desc';
        d.textContent = desc;
        var m = document.createElement('span');
        m.className = 'fd-app-meta';
        m.textContent = meta;
        a.appendChild(n); a.appendChild(d); a.appendChild(m);
        return a;
      };

      var appUrl = function (a) {
        return '/v1/apps/' + encodeURIComponent(a.owner) + '/' + encodeURIComponent(a.filename) + '?mode=inline';
      };

      FEATURED.forEach(function (f) {
        var hit = apps.find(function (a) {
          return ((a.manifest || {}).name || a.filename || '').toLowerCase().indexOf(f.match) !== -1;
        });
        if (hit) {
          used.push(hit);
          var opens = hit.downloads || hit.opens || 0;
          cards.push(card(f.name, FI ? f.fi : f.en, appUrl(hit),
            opens > 0 ? (FI ? opens + ' avausta' : opens + ' opens') : (FI ? 'astu sisään' : 'step right in')));
        } else if (f.url) {
          cards.push(card(f.name, FI ? f.fi : f.en, f.url, FI ? 'aina auki' : 'always open'));
        }
      });

      apps.filter(function (a) {
        var dd = (a.manifest || {}).description || '';
        return used.indexOf(a) === -1 && !isJunk(a) && dd.length > 20 && !JARGON.test(dd);
      })
        .slice(0, Math.max(0, GRID_SIZE - cards.length))
        .forEach(function (a) {
          var m = a.manifest || {};
          var dd = m.description || '';
          var opens = a.downloads || a.opens || 0;
          cards.push(card(m.name || a.filename,
            dd.length > 110 ? dd.slice(0, 107) + '…' : dd,
            appUrl(a),
            opens > 0 ? (FI ? opens + ' avausta' : opens + ' opens') : (FI ? 'uusi' : 'fresh')));
        });

      if (cards.length === 0) return;
      grid.textContent = '';
      cards.slice(0, GRID_SIZE).forEach(function (c) { grid.appendChild(c); });
    })
    .catch(function (err) { console.warn('[front-demo2] apps not loaded, the baked-in line stands:', err.message); });

  try {
    var raw = localStorage.getItem('aimeat_session');
    if (raw && JSON.parse(raw).jwt) {
      var chip = document.getElementById('fd-enter');
      if (chip) {
        chip.textContent = FI ? 'Kotiisi' : 'Your home';
        chip.setAttribute('href', '/v1/home');
      }
    }
  } catch (err) { console.warn('[front-demo2] session not readable, staying a guest:', err.message); }
})();
