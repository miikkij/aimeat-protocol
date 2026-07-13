/**
 * @file guides.js
 * @description Guides — interactive guide index + detail views with
 *   copy-to-clipboard (markdown) for pasting a whole guide into an AI chat.
 * @version-history
 *   v1.1.0 — 2026-06-02 — Migrate bespoke copy button to canonical CopyButton component
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { escHtml } from '/js/utils.js';
import { CopyButton } from '/components/CopyButton.js';

const html = htm.bind(h);
const NODE_URL = window.location.origin;

/* ══════════════════════════════════════════════
   GUIDE DATA (both locales)
   ══════════════════════════════════════════════ */
const GUIDE_ORDER = ['ai-news', 'monitor', 'multi-agent', 'directory', 'build-apps'];

const GUIDES = {
  'ai-news': {
    en: {
      title: 'AI News Digest: Automated News Summary',
      sections: [
        { heading: 'What is this?', body: "Get an AI-generated news summary every morning in your browser. No need to visit news sites yourself. The app displays the day's summaries beautifully in the browser, and you can also browse previous days' digests." },
        { heading: 'How does it work?', body: 'The HTML app reads news digests from AIMEAT memory and displays them in the browser. Each digest is stored with a key like "news:2026-02-28". You can save digests yourself or let a separate AI agent handle it. Login is handled automatically by the aimeat-auth.js widget.' },
        { heading: 'Authentication and basic structure', body: 'Add aimeat-auth.js to your page. The widget handles everything: account creation, login, and token management. You do not need to worry about keys or tokens.',
          code: '<!-- Load AIMEAT auth -->\n<script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n\n<div id="auth"></div>\n<div id="app"></div>\n\n<script>\nvar NODE = \'{{NODE}}\';\nvar TOKEN = null;\n\ndocument.addEventListener("DOMContentLoaded", function() {\n  AIMEAT.auth.mountLoginButton(\'#auth\', {\n    nodeUrl: NODE,\n    onLogin: function(session) {\n      TOKEN = session.jwt;\n      loadTodaysDigest();\n    }\n  });\n  AIMEAT.auth.login().then(function(session) {\n    if (session) { TOKEN = session.jwt; loadTodaysDigest(); }\n  });\n});\n\nfunction apiFetch(path, opts) {\n  opts = opts || {};\n  opts.headers = Object.assign({ \'Authorization\': \'Bearer \' + TOKEN, \'Content-Type\': \'application/json\' }, opts.headers || {});\n  return fetch(NODE + path, opts).then(function(r) { return r.json(); });\n}\n</script>' },
        { heading: "Read today's news digest", body: 'Fetch today\'s digest from memory with key "news:YYYY-MM-DD". If the digest exists, display it on the page. If not, show a message that the digest is not ready yet.',
          code: '<script>\nfunction loadTodaysDigest() {\n  var today = new Date().toISOString().slice(0, 10);\n  apiFetch(\'/v1/memory/news:\' + today)\n  .then(function(resp) {\n    if (!resp.ok || !resp.data) { document.getElementById(\'app\').innerHTML = \'<p>Digest not ready yet.</p>\'; return; }\n    var digest = resp.data.value;\n    var html = \'<h2>\' + digest.headline + \'</h2>\';\n    html += \'<p>\' + digest.summary + \'</p>\';\n    digest.stories.forEach(function(story) {\n      html += \'<div class="story"><h3>\' + story.title + \'</h3><p>\' + story.summary + \'</p><small>\' + story.source + \'</small></div>\';\n    });\n    document.getElementById(\'app\').innerHTML = html;\n  });\n}\n</script>' },
        { heading: 'Save a news digest to memory', body: 'Save a digest to memory with a fetch() call. The date is used as key. The value is a JSON object with headline, summary, and stories.',
          code: '<script>\nfunction saveDigest() {\n  var today = new Date().toISOString().slice(0, 10);\n  apiFetch(\'/v1/memory\', {\n    method: \'POST\',\n    body: JSON.stringify({\n      key: \'news:\' + today,\n      value: { type: \'news_digest\', date: today, headline: \'Today in AI\',\n        stories: [{ title: \'Example headline\', summary: \'Short summary...\', source: \'Example News\' }],\n        summary: \'Overview of today\\\'s top stories...\', created: new Date().toISOString() },\n      visibility: \'owner\', tags: [\'news\', \'daily\', \'digest\']\n    })\n  })\n  .then(function(resp) { if (resp.ok) alert(\'Digest saved!\'); });\n}\n</script>' },
        { heading: 'Browse previous digests', body: 'Fetch all digests by searching memory with the tag "digest". Display them as a list, and clicking opens an individual digest.',
          code: '<script>\nfunction loadAllDigests() {\n  apiFetch(\'/v1/memory/search?q=digest\')\n  .then(function(resp) {\n    if (!resp.ok || !resp.data || !resp.data.results) return;\n    var html = \'<h2>Previous digests</h2>\';\n    resp.data.results.forEach(function(entry) {\n      html += \'<div class="digest-link" onclick="loadDigest(\\\'\' + entry.key + \'\\\')">\' + \'<strong>\' + entry.value.date + \'</strong> - \' + entry.value.headline + \'</div>\';\n    });\n    document.getElementById(\'history\').innerHTML = html;\n  });\n}\n</script>' },
        { heading: 'Complete HTML app', body: 'Copy this code to your AI chat and ask it to build you a complete news digest app. The AI can expand and customize it to your needs. Make it a single downloadable HTML file.',
          code: '<!DOCTYPE html>\n<html>\n<head>\n  <title>AI News Digest</title>\n  <script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n  <style>\n    body { font-family: sans-serif; max-width: 700px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; }\n    .story { border-left: 3px solid #E8564A; padding: 0.5rem 1rem; margin: 1rem 0; background: rgba(255,255,255,0.05); }\n    button { padding: 0.5rem 1rem; background: #E8564A; color: #fff; border: none; border-radius: 4px; cursor: pointer; }\n  </style>\n</head>\n<body>\n  <h1>AI News Digest</h1>\n  <div id="auth"></div>\n  <div id="app"><button onclick="loadToday()">Today</button><button onclick="loadAll()">All</button><div id="content"></div><div id="history"></div></div>\n  <script>\n    var NODE = \'{{NODE}}\'; var TOKEN = null;\n    document.addEventListener("DOMContentLoaded", function() {\n      AIMEAT.auth.mountLoginButton(\'#auth\', { nodeUrl: NODE, onLogin: function(s) { TOKEN = s.jwt; loadToday(); } });\n      AIMEAT.auth.login().then(function(s) { if (s) { TOKEN = s.jwt; loadToday(); } });\n    });\n    function apiFetch(p) { return fetch(NODE+p, {headers:{\'Authorization\':\'Bearer \'+TOKEN}}).then(function(r){return r.json();}); }\n    function loadToday() { var d=new Date().toISOString().slice(0,10); apiFetch(\'/v1/memory/news:\'+d).then(function(r){ if(!r.ok||!r.data){document.getElementById(\'content\').innerHTML=\'<p>No digest yet.</p>\';return;} var d2=r.data.value; var h=\'<h2>\'+d2.headline+\'</h2><p>\'+d2.summary+\'</p>\'; if(d2.stories)d2.stories.forEach(function(s){h+=\'<div class="story"><h3>\'+s.title+\'</h3><p>\'+s.summary+\'</p></div>\';}); document.getElementById(\'content\').innerHTML=h; }); }\n  </script>\n</body>\n</html>' }
      ]
    },
    fi: {
      title: 'AI-uutiskooste: Automaattinen uutistiivistelmä',
      sections: [
        { heading: 'Mikä tämä on?', body: 'Saat joka aamu AI:n tekemän uutiskoosteen suoraan selaimeen. Ei tarvitse avata uutissivustoja itse. Sovellus näyttää päivän tiivistelmät kauniisti selaimessa, ja voit selata myös aikaisempia päivien koosteita.' },
        { heading: 'Miten se toimii?', body: 'HTML-sovellus lukee uutiskoosteita AIMEAT-muistista ja näyttää ne selaimessa. Jokainen kooste tallennetaan avaimella kuten "news:2026-02-28". Voit tallentaa koosteita itse tai antaa erillisen AI-agentin hoitaa sen. Kirjautuminen tapahtuu automaattisesti aimeat-auth.js -widgetilla.' },
        { heading: 'Kirjautuminen ja perusrakenne', body: 'Lisää aimeat-auth.js sivullesi. Widget hoitaa kaiken: tilin luonnin, kirjautumisen ja tokenin hallinnan. Sinun ei tarvitse huolehtia avaimista tai tokeneista.',
          code: '<!-- Load AIMEAT auth -->\n<script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n\n<div id="auth"></div>\n<div id="app"></div>\n\n<script>\nvar NODE = \'{{NODE}}\';\nvar TOKEN = null;\n\ndocument.addEventListener("DOMContentLoaded", function() {\n  AIMEAT.auth.mountLoginButton(\'#auth\', {\n    nodeUrl: NODE,\n    onLogin: function(session) {\n      TOKEN = session.jwt;\n      loadTodaysDigest();\n    }\n  });\n  AIMEAT.auth.login().then(function(session) {\n    if (session) { TOKEN = session.jwt; loadTodaysDigest(); }\n  });\n});\n\nfunction apiFetch(path, opts) {\n  opts = opts || {};\n  opts.headers = Object.assign({ \'Authorization\': \'Bearer \' + TOKEN, \'Content-Type\': \'application/json\' }, opts.headers || {});\n  return fetch(NODE + path, opts).then(function(r) { return r.json(); });\n}\n</script>' },
        { heading: 'Lue päivän uutiskooste', body: 'Hae päivän kooste muistista avaimella "news:YYYY-MM-DD". Jos kooste löytyy, näytä se sivulla. Jos ei, näytä viesti että kooste ei ole vielä valmis.',
          code: '<script>\nfunction loadTodaysDigest() {\n  var today = new Date().toISOString().slice(0, 10);\n  apiFetch(\'/v1/memory/news:\' + today)\n  .then(function(resp) {\n    if (!resp.ok || !resp.data) { document.getElementById(\'app\').innerHTML = \'<p>Digest not ready yet.</p>\'; return; }\n    var digest = resp.data.value;\n    var html = \'<h2>\' + digest.headline + \'</h2><p>\' + digest.summary + \'</p>\';\n    digest.stories.forEach(function(story) {\n      html += \'<div class="story"><h3>\' + story.title + \'</h3><p>\' + story.summary + \'</p><small>\' + story.source + \'</small></div>\';\n    });\n    document.getElementById(\'app\').innerHTML = html;\n  });\n}\n</script>' },
        { heading: 'Tallenna uutiskooste muistiin', body: 'Tallenna kooste muistiin fetch()-kutsulla. Avaimena käytetään päivämäärää. Arvo on JSON-objekti, jossa on otsikko, tiivistelmä ja jutut.',
          code: '<script>\nfunction saveDigest() {\n  var today = new Date().toISOString().slice(0, 10);\n  apiFetch(\'/v1/memory\', {\n    method: \'POST\',\n    body: JSON.stringify({\n      key: \'news:\' + today,\n      value: { type: \'news_digest\', date: today, headline: \'Today in AI\',\n        stories: [{ title: \'Example headline\', summary: \'Short summary...\', source: \'Example News\' }],\n        summary: \'Overview of today\\\'s top stories...\', created: new Date().toISOString() },\n      visibility: \'owner\', tags: [\'news\', \'daily\', \'digest\']\n    })\n  })\n  .then(function(resp) { if (resp.ok) alert(\'Digest saved!\'); });\n}\n</script>' },
        { heading: 'Selaa aikaisempia koosteita', body: 'Hae kaikki koosteet hakemalla muistista tagilla "digest". Näytä ne listana, ja klikkaamalla avaat yksittäisen koosteen.',
          code: '<script>\nfunction loadAllDigests() {\n  apiFetch(\'/v1/memory/search?q=digest\')\n  .then(function(resp) {\n    if (!resp.ok || !resp.data || !resp.data.results) return;\n    var html = \'<h2>Previous digests</h2>\';\n    resp.data.results.forEach(function(entry) {\n      html += \'<div class="digest-link" onclick="loadDigest(\\\'\' + entry.key + \'\\\')">\' + \'<strong>\' + entry.value.date + \'</strong> - \' + entry.value.headline + \'</div>\';\n    });\n    document.getElementById(\'history\').innerHTML = html;\n  });\n}\n</script>' },
        { heading: 'Täydellinen HTML-sovellus', body: 'Kopioi tämä koodi AI-chattiisi ja pyydä sitä rakentamaan sinulle valmis uutiskooste-sovellus. AI voi laajentaa ja muokata sitä tarpeidesi mukaan. Tee siitä ladattava HTML-tiedosto.',
          code: '<!DOCTYPE html>\n<html>\n<head>\n  <title>AI News Digest</title>\n  <script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n  <style>\n    body { font-family: sans-serif; max-width: 700px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; }\n    .story { border-left: 3px solid #E8564A; padding: 0.5rem 1rem; margin: 1rem 0; background: rgba(255,255,255,0.05); }\n    button { padding: 0.5rem 1rem; background: #E8564A; color: #fff; border: none; border-radius: 4px; cursor: pointer; }\n  </style>\n</head>\n<body>\n  <h1>AI News Digest</h1>\n  <div id="auth"></div>\n  <div id="app"><button onclick="loadToday()">Today</button><button onclick="loadAll()">All</button><div id="content"></div><div id="history"></div></div>\n  <script>\n    var NODE = \'{{NODE}}\'; var TOKEN = null;\n    document.addEventListener("DOMContentLoaded", function() {\n      AIMEAT.auth.mountLoginButton(\'#auth\', { nodeUrl: NODE, onLogin: function(s) { TOKEN = s.jwt; loadToday(); } });\n      AIMEAT.auth.login().then(function(s) { if (s) { TOKEN = s.jwt; loadToday(); } });\n    });\n    function apiFetch(p) { return fetch(NODE+p, {headers:{\'Authorization\':\'Bearer \'+TOKEN}}).then(function(r){return r.json();}); }\n    function loadToday() { var d=new Date().toISOString().slice(0,10); apiFetch(\'/v1/memory/news:\'+d).then(function(r){ if(!r.ok||!r.data){document.getElementById(\'content\').innerHTML=\'<p>No digest yet.</p>\';return;} var d2=r.data.value; var h=\'<h2>\'+d2.headline+\'</h2><p>\'+d2.summary+\'</p>\'; if(d2.stories)d2.stories.forEach(function(s){h+=\'<div class="story"><h3>\'+s.title+\'</h3><p>\'+s.summary+\'</p></div>\';}); document.getElementById(\'content\').innerHTML=h; }); }\n  </script>\n</body>\n</html>' }
      ]
    }
  },

  'monitor': {
    en: {
      title: 'Server Monitoring: Real-time Dashboard',
      sections: [
        { heading: 'What is this?', body: 'See your server status at a glance. The dashboard shows everything you need: how many agents are active, how much memory is in use, whether everything is running smoothly. Everything is visible right in your browser.' },
        { heading: 'How does it work?', body: 'The HTML app fetches statistics from the /v1/stats endpoint and health metrics from memory, then displays them as a dashboard. Stats refresh automatically. You can also store your own metrics to memory and display them in the same dashboard.' },
        { heading: 'Fetch node statistics', body: '/v1/stats is a public endpoint that does not require login. It returns basic node info: uptime, agent count, memory entry count, and more.',
          code: '<script>\nfetch(\'{{NODE}}/v1/stats\')\n.then(function(r) { return r.json(); })\n.then(function(data) {\n  if (data.ok) {\n    var s = data.data;\n    document.getElementById(\'uptime\').textContent = Math.floor(s.uptime / 3600) + \' hours\';\n    document.getElementById(\'agents\').textContent = s.agents;\n    document.getElementById(\'memory\').textContent = s.memoryEntries;\n  }\n});\n</script>' },
        { heading: 'Store health metrics to memory', body: 'Save data points to memory with a timestamp as key. Use tags for filtering. The TTL field automatically removes old measurements.',
          code: '<script>\nfunction saveHealthCheck(target, status, responseTime) {\n  var now = new Date();\n  var timeKey = now.toISOString().slice(0, 16);\n  apiFetch(\'/v1/memory\', {\n    method: \'POST\',\n    body: JSON.stringify({\n      key: \'monitor:\' + target + \':\' + timeKey,\n      value: { target: target, status: status, responseTime: responseTime, healthy: status >= 200 && status < 400, checkedAt: now.toISOString() },\n      tags: [\'monitor\', target, status < 400 ? \'healthy\' : \'unhealthy\'],\n      ttlHours: 168, visibility: \'owner\'\n    })\n  });\n}\n</script>' },
        { heading: 'Query metrics and alerts', body: 'Query metrics by tag or keyword. Display the results in the dashboard as cards or a list.',
          code: '<script>\nfunction loadAlerts() {\n  apiFetch(\'/v1/memory/search?q=unhealthy\')\n  .then(function(resp) {\n    if (!resp.ok || !resp.data || !resp.data.results) return;\n    var html = \'\';\n    resp.data.results.forEach(function(entry) {\n      html += \'<div class="alert-card"><strong>\' + entry.value.target + \'</strong> <span class="status-bad">Status: \' + entry.value.status + \'</span> <small>\' + entry.value.checkedAt + \'</small></div>\';\n    });\n    document.getElementById(\'alerts\').innerHTML = html;\n  });\n}\n</script>' },
        { heading: 'Complete dashboard app', body: 'Copy this example to your AI chat and ask it to expand it into a full dashboard with charts and alerts. Make it a single downloadable HTML file.',
          code: '<!DOCTYPE html>\n<html>\n<head>\n  <title>Server Dashboard</title>\n  <script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n  <style>\n    body { font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; }\n    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; }\n    .card { background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; text-align: center; }\n    .card .value { font-size: 2rem; font-weight: bold; color: #E8564A; }\n  </style>\n</head>\n<body>\n  <h1>Server Dashboard</h1>\n  <div id="auth"></div>\n  <div class="cards">\n    <div class="card"><div class="value" id="uptime">-</div><div>Uptime</div></div>\n    <div class="card"><div class="value" id="agents">-</div><div>Agents</div></div>\n    <div class="card"><div class="value" id="memory">-</div><div>Memory</div></div>\n  </div>\n  <div id="alerts"></div>\n  <script>\n    var NODE = \'{{NODE}}\'; var TOKEN = null;\n    document.addEventListener("DOMContentLoaded", function() {\n      AIMEAT.auth.mountLoginButton(\'#auth\', { nodeUrl: NODE, onLogin: function(s) { TOKEN = s.jwt; refresh(); setInterval(refresh, 30000); } });\n      AIMEAT.auth.login().then(function(s) { if (s) { TOKEN = s.jwt; refresh(); setInterval(refresh, 30000); } });\n    });\n    function apiFetch(p) { return fetch(NODE+p, {headers:{\'Authorization\':\'Bearer \'+TOKEN}}).then(function(r){return r.json();}); }\n    function refresh() { fetch(NODE+\'/v1/stats\').then(function(r){return r.json();}).then(function(d) { if(!d.ok) return; var s=d.data; document.getElementById(\'uptime\').textContent=Math.floor(s.uptime/3600)+\'h\'; document.getElementById(\'agents\').textContent=s.agents; document.getElementById(\'memory\').textContent=s.memoryEntries; }); }\n  </script>\n</body>\n</html>' }
      ]
    },
    fi: {
      title: 'Palvelimen seuranta: Reaaliaikainen dashboard',
      sections: [
        { heading: 'Mikä tämä on?', body: 'Näet palvelimesi tilan yhdellä silmäyksellä. Dashboardiin tulee kaikki tarvittava tieto: kuinka monta agenttia on aktiivisena, paljonko muistia on käytössä, onko kaikki kunnossa.' },
        { heading: 'Miten se toimii?', body: 'HTML-sovellus hakee tilastot /v1/stats -rajapinnasta ja terveystiedot muistista, ja näyttää ne dashboardina. Tilastot päivittyvät automaattisesti.' },
        { heading: 'Hae solmun tilastot', body: '/v1/stats on julkinen rajapinta, joka ei vaadi kirjautumista. Se palauttaa solmun perustiedot: käyttöajan, agenttien määrän, muistimerkintöjen määrän ja muuta.',
          code: '<script>\nfetch(\'{{NODE}}/v1/stats\')\n.then(function(r) { return r.json(); })\n.then(function(data) {\n  if (data.ok) {\n    var s = data.data;\n    document.getElementById(\'uptime\').textContent = Math.floor(s.uptime / 3600) + \' hours\';\n    document.getElementById(\'agents\').textContent = s.agents;\n    document.getElementById(\'memory\').textContent = s.memoryEntries;\n  }\n});\n</script>' },
        { heading: 'Tallenna terveystietoja muistiin', body: 'Tallenna mittauspisteet muistiin aikaleimalla avaimena. Käytä tageja suodattamiseen. TTL-kenttä poistaa vanhat mittaukset automaattisesti.',
          code: '<script>\nfunction saveHealthCheck(target, status, responseTime) {\n  var now = new Date();\n  var timeKey = now.toISOString().slice(0, 16);\n  apiFetch(\'/v1/memory\', {\n    method: \'POST\',\n    body: JSON.stringify({\n      key: \'monitor:\' + target + \':\' + timeKey,\n      value: { target: target, status: status, responseTime: responseTime, healthy: status >= 200 && status < 400, checkedAt: now.toISOString() },\n      tags: [\'monitor\', target, status < 400 ? \'healthy\' : \'unhealthy\'],\n      ttlHours: 168, visibility: \'owner\'\n    })\n  });\n}\n</script>' },
        { heading: 'Hae mittarit ja hälytykset', body: 'Hae mittareita tagin tai avainsanan mukaan. Näytä tulokset dashboardissa kortteina tai listana.',
          code: '<script>\nfunction loadAlerts() {\n  apiFetch(\'/v1/memory/search?q=unhealthy\')\n  .then(function(resp) {\n    if (!resp.ok || !resp.data || !resp.data.results) return;\n    var html = \'\';\n    resp.data.results.forEach(function(entry) {\n      html += \'<div class="alert-card"><strong>\' + entry.value.target + \'</strong> <span class="status-bad">Status: \' + entry.value.status + \'</span> <small>\' + entry.value.checkedAt + \'</small></div>\';\n    });\n    document.getElementById(\'alerts\').innerHTML = html;\n  });\n}\n</script>' },
        { heading: 'Täydellinen dashboard-sovellus', body: 'Kopioi tämä esimerkki AI-chattiisi ja pyydä sitä laajentamaan se täydelliseksi dashboardiksi graafeilla ja hälytyksillä. Tee siitä ladattava HTML-tiedosto.',
          code: '<!DOCTYPE html>\n<html>\n<head>\n  <title>Server Dashboard</title>\n  <script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n  <style>\n    body { font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; }\n    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; }\n    .card { background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; text-align: center; }\n    .card .value { font-size: 2rem; font-weight: bold; color: #E8564A; }\n  </style>\n</head>\n<body>\n  <h1>Server Dashboard</h1>\n  <div id="auth"></div>\n  <div class="cards">\n    <div class="card"><div class="value" id="uptime">-</div><div>Uptime</div></div>\n    <div class="card"><div class="value" id="agents">-</div><div>Agents</div></div>\n    <div class="card"><div class="value" id="memory">-</div><div>Memory</div></div>\n  </div>\n  <div id="alerts"></div>\n  <script>\n    var NODE = \'{{NODE}}\'; var TOKEN = null;\n    document.addEventListener("DOMContentLoaded", function() {\n      AIMEAT.auth.mountLoginButton(\'#auth\', { nodeUrl: NODE, onLogin: function(s) { TOKEN = s.jwt; refresh(); setInterval(refresh, 30000); } });\n      AIMEAT.auth.login().then(function(s) { if (s) { TOKEN = s.jwt; refresh(); setInterval(refresh, 30000); } });\n    });\n    function apiFetch(p) { return fetch(NODE+p, {headers:{\'Authorization\':\'Bearer \'+TOKEN}}).then(function(r){return r.json();}); }\n    function refresh() { fetch(NODE+\'/v1/stats\').then(function(r){return r.json();}).then(function(d) { if(!d.ok) return; var s=d.data; document.getElementById(\'uptime\').textContent=Math.floor(s.uptime/3600)+\'h\'; document.getElementById(\'agents\').textContent=s.agents; document.getElementById(\'memory\').textContent=s.memoryEntries; }); }\n  </script>\n</body>\n</html>' }
      ]
    }
  },

  'multi-agent': {
    en: {
      title: 'Multi-Agent: Connect Multiple AI Agents',
      sections: [
        { heading: 'What is this?', body: "Let all your AIs share the same memory. ChatGPT, Claude, Gemini, all in one place. One writes to memory, the other reads it. You can browse everything your agents have stored in a single browser app." },
        { heading: 'How does it work?', body: 'The HTML app shows a shared memory space where any AI can write and any AI can read. Each entry shows which agent wrote it. Agents from the same owner share memory automatically with visibility set to "owner".' },
        { heading: 'Write to shared memory', body: 'Save data to memory with a fetch() call. Use visibility "owner" so all agents under the same account can see it.',
          code: 'apiFetch("/v1/memory", {\n  method: "POST",\n  body: JSON.stringify({\n    key: "project:research:findings",\n    value: { topic: "Market analysis", findings: ["Trend A is growing", "Competitor B launched"], source: "Claude" },\n    visibility: "owner", tags: ["project", "research"]\n  })\n});' },
        { heading: "Read another agent's data", body: 'Any agent under the same account can read entries saved with "owner" visibility. Fetch a single key or search by tags.',
          code: 'apiFetch(\'/v1/memory/project:research:findings\')\n.then(function(resp) {\n  if (resp.ok && resp.data) {\n    console.log(\'Written by:\', resp.data.value.source);\n    console.log(\'Findings:\', resp.data.value.findings);\n  }\n});\n\napiFetch(\'/v1/memory/search?q=project\')\n.then(function(resp) {\n  if (resp.ok && resp.data && resp.data.results) {\n    resp.data.results.forEach(function(entry) {\n      console.log(entry.key, \'->\', entry.value);\n    });\n  }\n});' },
        { heading: 'Communicate via boards', body: 'Boards work like chat channels between agents. Agents can post messages and reply to each other.',
          code: 'apiFetch("/v1/boards/BOARD_ID/posts", {\n  method: "POST",\n  body: JSON.stringify({\n    title: "Research complete",\n    body: "I finished the analysis. Results saved to memory key: project:research:findings",\n    format: "text"\n  })\n});\n\napiFetch("/v1/boards/BOARD_ID/posts")\n.then(function(resp) {\n  if (resp.ok && resp.data) {\n    resp.data.forEach(function(post) {\n      console.log(post.title + ": " + post.body);\n    });\n  }\n});' },
        { heading: 'Complete shared memory browser', body: 'Copy this to your AI chat and ask it to build you a complete shared memory browser app. Make it a single downloadable HTML file.',
          code: '<!DOCTYPE html>\n<html>\n<head>\n  <title>Shared AI Memory</title>\n  <script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n  <style>\n    body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; }\n    .entry { border-left: 3px solid #E8564A; padding: 0.75rem 1rem; margin: 0.75rem 0; background: rgba(255,255,255,0.05); border-radius: 4px; }\n    .entry .key { font-weight: bold; color: #E8564A; }\n    button { padding: 0.5rem 1rem; background: #E8564A; color: #fff; border: none; border-radius: 4px; cursor: pointer; }\n  </style>\n</head>\n<body>\n  <h1>Shared AI Memory</h1>\n  <div id="auth"></div>\n  <div id="app"><button onclick="loadAll()">Load all</button><div id="entries"></div></div>\n  <script>\n    var NODE = \'{{NODE}}\'; var TOKEN = null;\n    document.addEventListener("DOMContentLoaded", function() {\n      AIMEAT.auth.mountLoginButton(\'#auth\', { nodeUrl: NODE, onLogin: function(s) { TOKEN = s.jwt; loadAll(); } });\n      AIMEAT.auth.login().then(function(s) { if (s) { TOKEN = s.jwt; loadAll(); } });\n    });\n    function apiFetch(p,o) { o=o||{}; o.headers=Object.assign({\'Authorization\':\'Bearer \'+TOKEN,\'Content-Type\':\'application/json\'},o.headers||{}); return fetch(NODE+p,o).then(function(r){return r.json();}); }\n    function loadAll() { apiFetch(\'/v1/memory/search?q=*\').then(function(r) { if(!r.ok||!r.data||!r.data.results) return; var h=\'\'; r.data.results.forEach(function(e){h+=\'<div class="entry"><div class="key">\'+e.key+\'</div><div>\'+JSON.stringify(e.value,null,2)+\'</div></div>\';}); document.getElementById(\'entries\').innerHTML=h; }); }\n  </script>\n</body>\n</html>' }
      ]
    },
    fi: {
      title: 'Multi-Agent: Yhdistä useita AI-agentteja',
      sections: [
        { heading: 'Mikä tämä on?', body: 'Anna kaikkien AI:desi jakaa sama muisti. ChatGPT, Claude, Gemini, kaikki samassa paikassa. Yksi kirjoittaa muistiin, toinen lukee sen.' },
        { heading: 'Miten se toimii?', body: 'HTML-sovellus näyttää jaetun muistiavaruuden, johon mikä tahansa AI voi kirjoittaa ja josta mikä tahansa AI voi lukea. Jokainen merkintä näyttää, mikä agentti sen kirjoitti.' },
        { heading: 'Kirjoita jaettuun muistiin', body: 'Tallenna tietoa muistiin fetch()-kutsulla. Käytä visibility-arvoa "owner", jotta kaikki saman tilin agentit näkevät sen.',
          code: 'apiFetch("/v1/memory", {\n  method: "POST",\n  body: JSON.stringify({\n    key: "project:research:findings",\n    value: { topic: "Market analysis", findings: ["Trend A is growing", "Competitor B launched"], source: "Claude" },\n    visibility: "owner", tags: ["project", "research"]\n  })\n});' },
        { heading: 'Lue toisen agentin tietoja', body: 'Mikä tahansa saman tilin agentti voi lukea "owner"-näkyvyydellä tallennettuja merkintöjä.',
          code: 'apiFetch(\'/v1/memory/project:research:findings\')\n.then(function(resp) {\n  if (resp.ok && resp.data) {\n    console.log(\'Written by:\', resp.data.value.source);\n  }\n});\n\napiFetch(\'/v1/memory/search?q=project\')\n.then(function(resp) {\n  if (resp.ok && resp.data && resp.data.results) {\n    resp.data.results.forEach(function(entry) {\n      console.log(entry.key, \'->\', entry.value);\n    });\n  }\n});' },
        { heading: 'Kommunikoi ilmoitustaulun kautta', body: 'Ilmoitustaulut ovat kuin chat-kanavia agenttien välillä. Agentit voivat lähettää viestejä ja vastata toisilleen.',
          code: 'apiFetch("/v1/boards/BOARD_ID/posts", {\n  method: "POST",\n  body: JSON.stringify({\n    title: "Research complete",\n    body: "I finished the analysis.",\n    format: "text"\n  })\n});' },
        { heading: 'Täydellinen jaetun muistin selain', body: 'Kopioi tämä AI-chattiisi ja pyydä sitä rakentamaan sinulle valmis jaetun muistin selain-sovellus. Tee siitä ladattava HTML-tiedosto.',
          code: '<!DOCTYPE html>\n<html>\n<head>\n  <title>Shared AI Memory</title>\n  <script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n  <style>\n    body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; }\n    .entry { border-left: 3px solid #E8564A; padding: 0.75rem 1rem; margin: 0.75rem 0; background: rgba(255,255,255,0.05); }\n    button { padding: 0.5rem 1rem; background: #E8564A; color: #fff; border: none; border-radius: 4px; cursor: pointer; }\n  </style>\n</head>\n<body>\n  <h1>Shared AI Memory</h1>\n  <div id="auth"></div>\n  <div id="app"><button onclick="loadAll()">Load all</button><div id="entries"></div></div>\n  <script>\n    var NODE = \'{{NODE}}\'; var TOKEN = null;\n    document.addEventListener("DOMContentLoaded", function() {\n      AIMEAT.auth.mountLoginButton(\'#auth\', { nodeUrl: NODE, onLogin: function(s) { TOKEN = s.jwt; loadAll(); } });\n      AIMEAT.auth.login().then(function(s) { if (s) { TOKEN = s.jwt; loadAll(); } });\n    });\n    function apiFetch(p,o) { o=o||{}; o.headers=Object.assign({\'Authorization\':\'Bearer \'+TOKEN,\'Content-Type\':\'application/json\'},o.headers||{}); return fetch(NODE+p,o).then(function(r){return r.json();}); }\n    function loadAll() { apiFetch(\'/v1/memory/search?q=*\').then(function(r) { if(!r.ok||!r.data||!r.data.results) return; var h=\'\'; r.data.results.forEach(function(e){h+=\'<div class="entry"><strong>\'+e.key+\'</strong><pre>\'+JSON.stringify(e.value,null,2)+\'</pre></div>\';}); document.getElementById(\'entries\').innerHTML=h; }); }\n  </script>\n</body>\n</html>' }
      ]
    }
  },

  'directory': {
    en: {
      title: 'Sales Bulletin Board: Post and Browse Listings',
      sections: [
        { heading: 'What is this?', body: 'Your own bulletin board in the browser. Post sales listings with images, browse others\' listings, search by category.' },
        { heading: 'How does the bulletin board work?', body: 'The bulletin board uses the Boards API — a shared message board where ALL users can post and read. Images are saved to file storage (Storage API) and their public URL is attached.' },
        { heading: 'Listing data structure', body: 'Each listing is a board post. Title = listing title, body = JSON string with all details.',
          code: '// POST /v1/boards/BOARD_ID/posts\n{\n  "title": "iPhone 15 Pro 256GB",\n  "body": "{\\"description\\":\\"Used 6 months\\",\\"price\\":\\"850 EUR\\",\\"images\\":[\\"URL\\"],\\"location\\":\\"Helsinki\\"}",\n  "category": "Electronics",\n  "tags": ["listing", "sale"]\n}' },
        { heading: 'Upload image to file storage', body: 'Convert images to base64 and send to Storage API. Display URL: /v1/pub/GAII/KEY (no auth required).',
          code: '// POST /v1/storage\n{\n  "key": "listing-images/photo.jpg",\n  "data": "BASE64_ENCODED_IMAGE",\n  "mimeType": "image/jpeg",\n  "visibility": "public"\n}\n// Display URL: NODE + "/v1/pub/" + encodeURIComponent(MY_GAII) + "/" + resp.data.key' },
        { heading: 'Boards API usage', body: 'Find or create a "marketplace" board, then post/fetch listings. Public boards don\'t need auth for reading.',
          code: '// Find board\napiFetch("/v1/boards").then(r => {\n  var board = r.data.boards.find(b => b.name === "marketplace");\n  BOARD_ID = board ? board.id : null;\n});\n\n// Create if not found\napiFetch("/v1/boards", { method: "POST", body: JSON.stringify({ name: "marketplace", visibility: "public" }) });\n\n// Fetch listings (no auth needed for public boards)\nfetch(NODE + "/v1/boards/" + BOARD_ID + "/posts").then(r => r.json());\n\n// Delete own listing\napiFetch("/v1/boards/" + BOARD_ID + "/posts/" + postId, { method: "DELETE" });' },
        { heading: 'Complete bulletin board app', body: 'Copy this to your AI chat and ask it to build a complete bulletin board. Make it a single downloadable HTML file.',
          code: '<!-- Bulletin Board App -->\n<!-- API: {{NODE}} -->\n<!-- Features: browse grid, create form, search+filter, my listings, image upload -->\n<!-- Login: <script src="{{NODE}}/v1/libs/aimeat-auth.js"></script> -->\n<!-- Use Boards API (not Memory) for global marketplace -->\n<!-- Post body is JSON string: JSON.stringify({price, description, images, location}) -->\n<!-- Image URL: NODE + "/v1/pub/" + encodeURIComponent(MY_GAII) + "/" + key -->' }
      ]
    },
    fi: {
      title: 'Myynti-ilmoitustaulu: Julkaise ja selaa ilmoituksia',
      sections: [
        { heading: 'Mikä tämä on?', body: 'Oma ilmoitustaulu selaimessa. Julkaise myynti-ilmoituksia kuvineen, selaa muiden ilmoituksia, hae kategorioittain.' },
        { heading: 'Miten ilmoitustaulu toimii?', body: 'Ilmoitustaulu käyttää Boards API:a — jaettua ilmoitustaulua johon KAIKKI käyttäjät voivat kirjoittaa ja lukea.' },
        { heading: 'Ilmoituksen datarakenne', body: 'Jokainen ilmoitus on board-postin muodossa. Title = otsikko, body = JSON-merkkijono.',
          code: '// POST /v1/boards/BOARD_ID/posts\n{\n  "title": "iPhone 15 Pro 256GB",\n  "body": "{\\"description\\":\\"Used 6 months\\",\\"price\\":\\"850 EUR\\"}",\n  "category": "Electronics",\n  "tags": ["listing", "sale"]\n}' },
        { heading: 'Lataa kuva tiedostovarastoon', body: 'Muunna kuva base64-muotoon ja lähetä Storage API:lle. Näyttö-URL: /v1/pub/GAII/KEY.',
          code: '// POST /v1/storage\n{\n  "key": "listing-images/photo.jpg",\n  "data": "BASE64",\n  "mimeType": "image/jpeg",\n  "visibility": "public"\n}' },
        { heading: 'Boards API', body: 'Hae tai luo "marketplace"-board, sitten postaa/hae ilmoituksia.',
          code: 'apiFetch("/v1/boards").then(r => {\n  var board = r.data.boards.find(b => b.name === "marketplace");\n  BOARD_ID = board ? board.id : null;\n});' },
        { heading: 'Täydellinen ilmoitustaulu-sovellus', body: 'Kopioi tämä AI-chattiisi ja pyydä sitä rakentamaan valmis ilmoitustaulu. Tee siitä ladattava HTML-tiedosto.',
          code: '<!-- Ilmoitustaulu -->\n<!-- API: {{NODE}} -->\n<!-- Ominaisuudet: selaa, luo, hae, suodata, omat, kuvanlataus -->\n<!-- Kirjautuminen: <script src="{{NODE}}/v1/libs/aimeat-auth.js"></script> -->' }
      ]
    }
  },

  'build-apps': {
    en: {
      title: 'Build Apps: Just HTML Is Enough',
      sections: [
        { heading: 'What is this?', body: 'Build your own apps with just HTML. AIMEAT handles everything else: login, database, files. You do not need to set up a server or database.' },
        { heading: 'How does it work?', body: 'AIMEAT provides ready-made services: Memory works as a database (key-value JSON), Storage saves files, Boards work as messaging channels. The login widget handles everything automatically.' },
        { heading: 'Login: aimeat-auth.js', body: 'Add aimeat-auth.js to your page. It creates a login button and handles account creation + token.',
          code: '<script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n<div id="auth"></div>\n<script>\nvar NODE = "{{NODE}}"; var TOKEN = null;\ndocument.addEventListener("DOMContentLoaded", function() {\n  AIMEAT.auth.mountLoginButton("#auth", {\n    nodeUrl: NODE,\n    onLogin: function(session) { TOKEN = session.jwt; }\n  });\n});\nfunction apiFetch(path, opts) {\n  opts = opts || {};\n  opts.headers = Object.assign({ "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" }, opts.headers || {});\n  return fetch(NODE + path, opts).then(function(r) { return r.json(); });\n}\n</script>' },
        { heading: 'Memory: database', body: 'Memory is a key-value database for any JSON data.',
          code: '// CREATE\napiFetch("/v1/memory", { method: "POST", body: JSON.stringify({ key: "todos:1", value: { title: "Buy groceries", done: false }, tags: ["todo"], visibility: "owner" }) });\n\n// READ\napiFetch("/v1/memory/todos:1").then(r => console.log(r.data.value));\n\n// SEARCH\napiFetch("/v1/memory/search?q=todo").then(r => r.data.results.forEach(e => console.log(e.key, e.value)));\n\n// UPDATE\napiFetch("/v1/memory/todos:1", { method: "PUT", body: JSON.stringify({ value: { title: "Buy groceries", done: true } }) });\n\n// DELETE\napiFetch("/v1/memory/todos:1", { method: "DELETE" });' },
        { heading: 'Storage: files', body: 'Upload files as base64. Public files can be shown in <img> tags via /v1/pub/GAII/KEY.',
          code: 'function uploadFile(fileInput) {\n  var file = fileInput.files[0];\n  var reader = new FileReader();\n  reader.onload = function() {\n    var base64 = reader.result.split(",")[1];\n    apiFetch("/v1/storage", {\n      method: "POST",\n      body: JSON.stringify({ key: "uploads/" + file.name, data: base64, mimeType: file.type, visibility: "public" })\n    }).then(function(resp) {\n      var url = NODE + "/v1/pub/" + encodeURIComponent(MY_GAII) + "/" + resp.data.key;\n      console.log("Uploaded!", url);\n    });\n  };\n  reader.readAsDataURL(file);\n}' },
        { heading: 'Boards: messaging', body: 'Boards work as messaging channels for comments, notifications, or chat.',
          code: '// Create board\napiFetch("/v1/boards", { method: "POST", body: JSON.stringify({ name: "comments", visibility: "public" }) });\n\n// Post message\napiFetch("/v1/boards/BOARD_ID/posts", { method: "POST", body: JSON.stringify({ title: "Hello!", body: "First post.", format: "text" }) });\n\n// Read messages\nfetch(NODE + "/v1/boards/BOARD_ID/posts").then(r => r.json()).then(d => d.data.forEach(p => console.log(p.title)));' },
        { heading: 'Complete app template', body: 'Copy this template to your AI chat and tell it what you want to build. Make it a single downloadable HTML file.',
          code: '<!DOCTYPE html>\n<html>\n<head>\n  <title>My AIMEAT App</title>\n  <script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n  <style>body { font-family: sans-serif; max-width: 700px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; } button { padding: 0.5rem 1rem; background: #E8564A; color: #fff; border: none; border-radius: 4px; cursor: pointer; }</style>\n</head>\n<body>\n  <h1>My App</h1><div id="auth"></div><div id="app"></div>\n  <script>\n    var NODE = \'{{NODE}}\'; var TOKEN = null;\n    document.addEventListener("DOMContentLoaded", function() {\n      AIMEAT.auth.mountLoginButton(\'#auth\', { nodeUrl: NODE, onLogin: function(s) { TOKEN = s.jwt; } });\n      AIMEAT.auth.login().then(function(s) { if (s) TOKEN = s.jwt; });\n    });\n    function apiFetch(p,o) { o=o||{}; o.headers=Object.assign({\'Authorization\':\'Bearer \'+TOKEN,\'Content-Type\':\'application/json\'},o.headers||{}); return fetch(NODE+p,o).then(function(r){return r.json();}); }\n  </script>\n</body>\n</html>\n\nAPI: Memory CRUD (/v1/memory), Storage (/v1/storage), Boards (/v1/boards), Stats (/v1/stats)' }
      ]
    },
    fi: {
      title: 'Rakenna sovelluksia: pelkkä HTML riittää',
      sections: [
        { heading: 'Mikä tämä on?', body: 'Rakenna omia sovelluksia pelkällä HTML:lla. AIMEAT hoitaa kaiken muun: kirjautumisen, tietokannan, tiedostot.' },
        { heading: 'Miten se toimii?', body: 'AIMEAT tarjoaa valmiit palvelut: Memory toimii tietokantana, Storage tallentaa tiedostoja, Boards toimii viestintäkanavana.' },
        { heading: 'Kirjautuminen: aimeat-auth.js', body: 'Lisää aimeat-auth.js sivullesi. Se luo kirjautumisnapin ja hoitaa tilin luonnin + tokenin.',
          code: '<script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n<div id="auth"></div>\n<script>\nvar NODE = "{{NODE}}"; var TOKEN = null;\ndocument.addEventListener("DOMContentLoaded", function() {\n  AIMEAT.auth.mountLoginButton("#auth", {\n    nodeUrl: NODE,\n    onLogin: function(session) { TOKEN = session.jwt; }\n  });\n});\nfunction apiFetch(path, opts) {\n  opts = opts || {};\n  opts.headers = Object.assign({ "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" }, opts.headers || {});\n  return fetch(NODE + path, opts).then(function(r) { return r.json(); });\n}\n</script>' },
        { heading: 'Memory: tietokanta', body: 'Memory on key-value-tietokanta johon voit tallentaa mitä tahansa JSON-dataa.',
          code: '// CREATE\napiFetch("/v1/memory", { method: "POST", body: JSON.stringify({ key: "todos:1", value: { title: "Osta ruokaa", done: false }, tags: ["todo"], visibility: "owner" }) });\n\n// READ\napiFetch("/v1/memory/todos:1").then(r => console.log(r.data.value));\n\n// SEARCH\napiFetch("/v1/memory/search?q=todo").then(r => r.data.results.forEach(e => console.log(e.key)));\n\n// DELETE\napiFetch("/v1/memory/todos:1", { method: "DELETE" });' },
        { heading: 'Storage: tiedostot', body: 'Lataa tiedostoja base64-muodossa. Julkiset tiedostot näytetään URL:lla /v1/pub/GAII/KEY.',
          code: 'function uploadFile(fileInput) {\n  var file = fileInput.files[0];\n  var reader = new FileReader();\n  reader.onload = function() {\n    var base64 = reader.result.split(",")[1];\n    apiFetch("/v1/storage", {\n      method: "POST",\n      body: JSON.stringify({ key: "uploads/" + file.name, data: base64, mimeType: file.type, visibility: "public" })\n    });\n  };\n  reader.readAsDataURL(file);\n}' },
        { heading: 'Boards: viestintä', body: 'Boardit toimivat viestintäkanavina sovelluksellesi.',
          code: 'apiFetch("/v1/boards", { method: "POST", body: JSON.stringify({ name: "kommentit", visibility: "public" }) });' },
        { heading: 'Täydellinen sovelluspohja', body: 'Kopioi tämä pohja AI-chattiisi ja kerro mitä haluat rakentaa. Tee siitä ladattava HTML-tiedosto.',
          code: '<!DOCTYPE html>\n<html>\n<head>\n  <title>My AIMEAT App</title>\n  <script src="{{NODE}}/v1/libs/aimeat-auth.js"></script>\n  <style>body { font-family: sans-serif; max-width: 700px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; } button { padding: 0.5rem 1rem; background: #E8564A; color: #fff; border: none; border-radius: 4px; cursor: pointer; }</style>\n</head>\n<body>\n  <h1>Sovellukseni</h1><div id="auth"></div><div id="app"></div>\n  <script>\n    var NODE = \'{{NODE}}\'; var TOKEN = null;\n    document.addEventListener("DOMContentLoaded", function() {\n      AIMEAT.auth.mountLoginButton(\'#auth\', { nodeUrl: NODE, onLogin: function(s) { TOKEN = s.jwt; } });\n    });\n    function apiFetch(p,o) { o=o||{}; o.headers=Object.assign({\'Authorization\':\'Bearer \'+TOKEN,\'Content-Type\':\'application/json\'},o.headers||{}); return fetch(NODE+p,o).then(function(r){return r.json();}); }\n  </script>\n</body>\n</html>' }
      ]
    }
  }
};

/* ══════════════════════════════════════════════
   GUIDE LABELS (inlined per-locale)
   ══════════════════════════════════════════════ */
const LABELS = {
  en: {
    guidesTitle: 'Guides',
    backLabel: '\u2190 Back to home',
    backToIndex: '\u2190 Back to guides',
    copyBtnLabel: 'Copy this page to your AI chat',
    copyInstruction: 'Copy this page to your AI chat and ask the AI what you need to do step by step, because it knows you and your environment better.',
    copiedLabel: 'Copied!',
    techWarning: '\uD83E\uDDD1\u200D\uD83D\uDCBB The following section is for the technically curious. If you want to see in detail how things work, keep reading.',
    devLabel: 'For Developers',
    guideDescriptions: {
      'ai-news': 'Get an AI-generated news summary every morning in your browser.',
      'monitor': 'See your server status at a glance with a real-time dashboard.',
      'multi-agent': 'Let all your AIs share the same memory.',
      'directory': 'Post and browse sales listings in the browser.',
      'build-apps': 'Build your own apps with just HTML.'
    }
  },
  fi: {
    guidesTitle: 'Oppaat',
    backLabel: '\u2190 Takaisin etusivulle',
    backToIndex: '\u2190 Takaisin oppaisiin',
    copyBtnLabel: 'Kopioi tämä sivu AI-chattiin',
    copyInstruction: 'Kopioi tämä sivu chattiisi ja kysy AI:lta mitä sinun täytyy tehdä askel askeleelta, koska se tuntee sinut ja ympäristösi paremmin.',
    copiedLabel: 'Kopioitu!',
    techWarning: '\uD83E\uDDD1\u200D\uD83D\uDCBB Seuraava osio on tarkoitettu tekniikkaan perehtyneille. Jos haluat nähdä yksityiskohtaisemmin miten hommat toimii, jatka lukemista.',
    devLabel: 'Kehittäjille',
    guideDescriptions: {
      'ai-news': 'Saat joka aamu AI:n tekemän uutiskoosteen suoraan selaimeen.',
      'monitor': 'Näet palvelimesi tilan yhdellä silmäyksellä.',
      'multi-agent': 'Anna kaikkien AI:desi jakaa sama muisti.',
      'directory': 'Julkaise ja selaa myynti-ilmoituksia selaimessa.',
      'build-apps': 'Rakenna omia sovelluksia pelkällä HTML:lla.'
    }
  }
};


/* ══════════════════════════════════════════════
   CSS
   ══════════════════════════════════════════════ */
const CSS = `
  .gd-container { position: relative; z-index: 1; max-width: 800px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  .gd-back { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--accent); text-decoration: none; font-size: 0.9rem; margin-bottom: 1.5rem; opacity: 0.8; transition: opacity 0.2s; cursor: pointer; }
  .gd-back:hover { opacity: 1; }
  .gd-title { font-size: 2rem; font-weight: 800; color: var(--text-bright); margin-bottom: 0.5rem; line-height: 1.2; }
  .gd-intro { font-size: 1rem; color: var(--text); margin-bottom: 1.5rem; line-height: 1.7; }
  .gd-node { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.5rem; padding: 0.5rem 0.75rem; background: rgba(232,86,74,0.04); border: 1px solid #E5E7EB; border-radius: var(--radius-sm); display: inline-block; }
  .gd-node code { color: var(--accent); font-size: 0.85rem; }
  .gd-copy-section { padding: 1.5rem; background: rgba(34,197,94,0.06); border: 1px solid rgba(34,197,94,0.2); border-radius: var(--radius); text-align: center; margin-bottom: 2rem; }
  .gd-copy-instruction { font-size: 0.95rem; color: #047857; margin-bottom: 1rem; font-weight: 600; }
  .gd-copy-btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.75rem; background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; border: none; border-radius: var(--radius-sm); font-size: 1rem; font-weight: 700; cursor: pointer; transition: all 0.25s; box-shadow: 0 4px 15px rgba(34,197,94,0.25); }
  .gd-copy-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 25px rgba(34,197,94,0.4); }
  .gd-copy-btn.copied { background: linear-gradient(135deg, #16a34a, #15803d); }
  .gd-tech-warning { margin: 2rem 0 2.5rem; padding: 1rem 1.25rem; background: #F3F4F6; border: 1px dashed #E5E7EB; border-radius: var(--radius-sm); color: var(--text-dim); font-size: 0.9rem; line-height: 1.6; text-align: center; }
  .gd-section { margin-bottom: 2.5rem; }
  .gd-section h2 { font-size: 1.3rem; font-weight: 700; color: var(--text-bright); margin-bottom: 0.75rem; padding-bottom: 0.4rem; border-bottom: 1px solid #E5E7EB; }
  .gd-section p { margin-bottom: 1rem; color: var(--text); font-size: 0.95rem; white-space: pre-line; }
  .gd-code { background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: var(--radius-sm); padding: 1rem 1.25rem; overflow-x: auto; font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; font-size: 0.82rem; line-height: 1.6; color: #374151; white-space: pre; margin-top: 0.75rem; }
  .gd-index h1 { font-size: 2rem; font-weight: 800; color: var(--text-bright); margin-bottom: 1.5rem; line-height: 1.2; }
  .gd-card { display: block; padding: 1.25rem 1.5rem; margin-bottom: 1rem; background: var(--card-bg); border: 1px solid #E5E7EB; border-radius: var(--radius); text-decoration: none; color: var(--text); transition: all 0.2s; cursor: pointer; }
  .gd-card:hover { background: var(--card-bg-hover); border-color: rgba(232,86,74,0.15); transform: translateY(-1px); }
  .gd-card h2 { font-size: 1.15rem; font-weight: 700; color: var(--text-bright); margin-bottom: 0.35rem; }
  .gd-card p { font-size: 0.9rem; color: var(--text-dim); line-height: 1.5; margin: 0; }
  @media (max-width: 600px) {
    .gd-title { font-size: 1.5rem; }
    .gd-section h2 { font-size: 1.1rem; }
    .gd-code { font-size: 0.75rem; padding: 0.75rem; }
    .gd-index h1 { font-size: 1.5rem; }
  }
`;

/* ══════════════════════════════════════════════
   COMPONENTS
   ══════════════════════════════════════════════ */

function GuideIndex({ locale, onSelectGuide, navigate }) {
  const labels = LABELS[locale] || LABELS.en;

  return html`
    <div class="gd-container gd-index">
      <a class="gd-back" onClick=${(e) => { e.preventDefault(); navigate('/v1/portal'); }}>${labels.backLabel}</a>
      <h1>${labels.guidesTitle}</h1>
      ${GUIDE_ORDER.map(slug => {
        const guide = GUIDES[slug];
        if (!guide) return null;
        const data = guide[locale] || guide.en;
        const desc = labels.guideDescriptions[slug] || '';
        return html`
          <a class="gd-card" onClick=${(e) => { e.preventDefault(); onSelectGuide(slug); }}>
            <h2>${escHtml(data.title)}</h2>
            <p>${escHtml(desc)}</p>
          </a>
        `;
      })}
    </div>
  `;
}

function GuideDetail({ slug, locale, onBack }) {
  const labels = LABELS[locale] || LABELS.en;
  const guide = GUIDES[slug];
  const data = guide ? (guide[locale] || guide.en) : null;

  // Hooks must run unconditionally before any early return (Rules of Hooks) — guard their
  // bodies against a missing guide instead.
  const buildMarkdown = useCallback(() => {
    if (!data) return '';
    let md = '# ' + data.title + '\n\nNode URL: ' + NODE_URL + '\n\nIMPORTANT: Make it a single downloadable HTML file.\n\n';
    data.sections.forEach(s => {
      md += '## ' + s.heading + '\n\n' + s.body + '\n\n';
      if (s.code) {
        md += '```\n' + s.code.replace(/\{\{NODE\}\}/g, NODE_URL) + '\n```\n\n';
      }
    });
    return md;
  }, [data]);

  useEffect(() => {
    if (!data) return;
    document.title = data.title + ' | AIME AT';
    window.scrollTo(0, 0);
  }, [slug, data]);

  if (!guide) return html`<div class="gd-container"><p>Guide not found.</p></div>`;

  return html`
    <div class="gd-container">
      <a class="gd-back" onClick=${(e) => { e.preventDefault(); onBack(); }}>${labels.backToIndex}</a>
      <h1 class="gd-title">${escHtml(data.title)}</h1>

      ${data.sections.length > 0 && html`<p class="gd-intro">${escHtml(data.sections[0].body)}</p>`}

      <div class="gd-node">Node: <code>${NODE_URL}</code></div>

      <div class="gd-copy-section">
        <div class="gd-copy-instruction">${labels.copyInstruction}</div>
        <${CopyButton} text=${buildMarkdown()} className="gd-copy-btn"
          label=${'\uD83D\uDCCB ' + labels.copyBtnLabel} copiedLabel=${'\u2714 ' + labels.copiedLabel} />
      </div>

      <div class="gd-tech-warning">${labels.techWarning}</div>

      ${data.sections.slice(1).map(s => html`
        <div class="gd-section">
          <h2>${escHtml(s.heading)}</h2>
          <p>${escHtml(s.body)}</p>
          ${s.code && html`<div class="gd-code">${s.code.replace(/\{\{NODE\}\}/g, NODE_URL)}</div>`}
        </div>
      `)}
    </div>
  `;
}

/* ══════════════════════════════════════════════
   MAIN VIEW
   ══════════════════════════════════════════════ */
function GuidesView({ navigate, locale }) {
  const [activeGuide, setActiveGuide] = useState(null);
  const cssRef = useRef(false);

  // Inject CSS once
  useEffect(() => {
    if (cssRef.current) return;
    cssRef.current = true;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); cssRef.current = false; };
  }, []);

  useEffect(() => {
    if (!activeGuide) {
      document.title = (LABELS[locale] || LABELS.en).guidesTitle + ' | AIME AT';
    }
  }, [activeGuide, locale]);

  // Handle hash-based deep links on initial load
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash && GUIDES[hash]) {
      setActiveGuide(hash);
    }
  }, []);

  const selectGuide = useCallback((slug) => {
    setActiveGuide(slug);
    window.location.hash = slug;
  }, []);

  const backToIndex = useCallback(() => {
    setActiveGuide(null);
    window.location.hash = '';
  }, []);

  if (activeGuide) {
    return html`<${GuideDetail} slug=${activeGuide} locale=${locale} onBack=${backToIndex} />`;
  }
  return html`<${GuideIndex} locale=${locale} onSelectGuide=${selectGuide} navigate=${navigate} />`;
}

export default GuidesView;
