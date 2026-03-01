import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import { resolveLocale, createT } from '../i18n.js';
import type { Locale, TFunction } from '../i18n.js';

/* ──────────────────────────────────────────────────────────
   Guide pages, detailed how-to guides for AIMEAT features
   Served at /v1/guide/:slug
   ────────────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function jesc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

interface GuideContent {
  title: string;
  sections: { heading: string; body: string; code?: string }[];
}

type GuideGenerator = (nodeUrl: string, locale: Locale, t: TFunction) => GuideContent;

/* ── Guide: AI News Digest ── */
function guideAiNews(nodeUrl: string, locale: Locale, _t: TFunction): GuideContent {
  const fi = locale === 'fi';
  return {
    title: fi ? 'AI-uutiskooste: Automaattinen uutistiivistelmä' : 'AI News Digest: Automated News Summary',
    sections: [
      {
        heading: fi ? 'Mikä tämä on?' : 'What is this?',
        body: fi
          ? 'Saat joka aamu AI:n tekemän uutiskoosteen suoraan selaimeen. Ei tarvitse avata uutissivustoja itse. Sovellus näyttää päivän tiivistelmät kauniisti selaimessa, ja voit selata myös aikaisempia päivien koosteita.'
          : 'Get an AI-generated news summary every morning in your browser. No need to visit news sites yourself. The app displays the day\'s summaries beautifully in the browser, and you can also browse previous days\' digests.',
      },
      {
        heading: fi ? 'Miten se toimii?' : 'How does it work?',
        body: fi
          ? 'HTML-sovellus lukee uutiskoosteita AIMEAT-muistista ja näyttää ne selaimessa. Jokainen kooste tallennetaan avaimella kuten "news:2026-02-28". Voit tallentaa koosteita itse tai antaa erillisen AI-agentin hoitaa sen. Kirjautuminen tapahtuu automaattisesti aimeat-auth.js -widgetilla.'
          : 'The HTML app reads news digests from AIMEAT memory and displays them in the browser. Each digest is stored with a key like "news:2026-02-28". You can save digests yourself or let a separate AI agent handle it. Login is handled automatically by the aimeat-auth.js widget.',
      },
      {
        heading: fi ? 'Kirjautuminen ja perusrakenne' : 'Authentication and basic structure',
        body: fi
          ? 'Lisää aimeat-auth.js sivullesi. Widget hoitaa kaiken: tilin luonnin, kirjautumisen ja tokenin hallinnan. Sinun ei tarvitse huolehtia avaimista tai tokeneista.'
          : 'Add aimeat-auth.js to your page. The widget handles everything: account creation, login, and token management. You do not need to worry about keys or tokens.',
        code: `<!-- Load AIMEAT auth -->
<script src="${nodeUrl}/v1/libs/aimeat-auth.js"><\/script>

<div id="auth"></div>
<div id="app"></div>

<script>
var NODE = '${nodeUrl}';
var TOKEN = null;

document.addEventListener("DOMContentLoaded", function() {
  AIMEAT.auth.mountLoginButton('#auth', {
    nodeUrl: NODE,
    onLogin: function(session) {
      TOKEN = session.jwt;
      loadTodaysDigest();
    }
  });
  // Auto-restore session if user is already logged in
  AIMEAT.auth.login().then(function(session) {
    if (session) { TOKEN = session.jwt; loadTodaysDigest(); }
  });
});

function apiFetch(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, opts.headers || {});
  return fetch(NODE + path, opts).then(function(r) { return r.json(); });
}
<\/script>`,
      },
      {
        heading: fi ? 'Lue päivän uutiskooste' : 'Read today\'s news digest',
        body: fi
          ? 'Hae päivän kooste muistista avaimella "news:YYYY-MM-DD". Jos kooste löytyy, näytä se sivulla. Jos ei, näytä viesti että kooste ei ole vielä valmis.'
          : 'Fetch today\'s digest from memory with key "news:YYYY-MM-DD". If the digest exists, display it on the page. If not, show a message that the digest is not ready yet.',
        code: `<script>
// TOKEN is set in the onLogin callback (see auth section above)
function loadTodaysDigest() {
  var today = new Date().toISOString().slice(0, 10);
  apiFetch('/v1/memory/news:' + today)
  .then(function(resp) {
    if (!resp.ok || !resp.data) { document.getElementById('app').innerHTML = '<p>Digest not ready yet.</p>'; return; }
    var digest = resp.data.value;
    var html = '<h2>' + digest.headline + '</h2>';
    html += '<p>' + digest.summary + '</p>';
    digest.stories.forEach(function(story) {
      html += '<div class="story">';
      html += '<h3>' + story.title + '</h3>';
      html += '<p>' + story.summary + '</p>';
      html += '<small>' + story.source + '</small>';
      html += '</div>';
    });
    document.getElementById('app').innerHTML = html;
  });
}
<\/script>`,
      },
      {
        heading: fi ? 'Tallenna uutiskooste muistiin' : 'Save a news digest to memory',
        body: fi
          ? 'Tallenna kooste muistiin fetch()-kutsulla. Avaimena käytetään päivämäärää. Arvo on JSON-objekti, jossa on otsikko, tiivistelmä ja jutut.'
          : 'Save a digest to memory with a fetch() call. The date is used as key. The value is a JSON object with headline, summary, and stories.',
        code: `<script>
function saveDigest() {
  var today = new Date().toISOString().slice(0, 10);
  apiFetch('/v1/memory', {
    method: 'POST',
    body: JSON.stringify({
      key: 'news:' + today,
      value: {
        type: 'news_digest',
        date: today,
        headline: 'Today in AI',
        stories: [
          {
            title: 'Example headline',
            summary: 'Short summary of the story...',
            source: 'Example News'
          }
        ],
        summary: 'Overview of today\\'s top stories...',
        created: new Date().toISOString()
      },
      visibility: 'owner',
      tags: ['news', 'daily', 'digest']
    })
  })
  .then(function(resp) { if (resp.ok) alert('Digest saved!'); else alert('Error: ' + resp.error.message); });
}
<\/script>`,
      },
      {
        heading: fi ? 'Selaa aikaisempia koosteita' : 'Browse previous digests',
        body: fi
          ? 'Hae kaikki koosteet hakemalla muistista tagilla "digest". Näytä ne listana, ja klikkaamalla avaat yksittäisen koosteen.'
          : 'Fetch all digests by searching memory with the tag "digest". Display them as a list, and clicking opens an individual digest.',
        code: `<script>
function loadAllDigests() {
  apiFetch('/v1/memory/search?q=digest')
  .then(function(resp) {
    if (!resp.ok || !resp.data || !resp.data.results) return;
    var html = '<h2>Previous digests</h2>';
    resp.data.results.forEach(function(entry) {
      html += '<div class="digest-link" onclick="loadDigest(\\'' + entry.key + '\\')">';
      html += '<strong>' + entry.value.date + '</strong> - ' + entry.value.headline;
      html += '</div>';
    });
    document.getElementById('history').innerHTML = html;
  });
}
<\/script>`,
      },
      {
        heading: fi ? 'Täydellinen HTML-sovellus' : 'Complete HTML app',
        body: fi
          ? 'Kopioi tämä koodi AI-chattiisi ja pyydä sitä rakentamaan sinulle valmis uutiskooste-sovellus. AI voi laajentaa ja muokata sitä tarpeidesi mukaan. Tee siitä ladattava HTML-tiedosto.'
          : 'Copy this code to your AI chat and ask it to build you a complete news digest app. The AI can expand and customize it to your needs. Make it a single downloadable HTML file.',
        code: `<!DOCTYPE html>
<html>
<head>
  <title>AI News Digest</title>
  <script src="${nodeUrl}/v1/libs/aimeat-auth.js"><\/script>
  <style>
    body { font-family: sans-serif; max-width: 700px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; }
    .story { border-left: 3px solid #ff69b4; padding: 0.5rem 1rem; margin: 1rem 0; background: rgba(255,255,255,0.05); }
    .digest-link { cursor: pointer; padding: 0.5rem; margin: 0.25rem 0; background: rgba(255,255,255,0.03); }
    .digest-link:hover { background: rgba(255,255,255,0.08); }
    button { padding: 0.5rem 1rem; background: #ff69b4; color: #fff; border: none; border-radius: 4px; cursor: pointer; margin: 0.25rem; }
  </style>
</head>
<body>
  <h1>AI News Digest</h1>
  <div id="auth"></div>
  <div id="app">
    <button onclick="loadToday()">Today's digest</button>
    <button onclick="loadAll()">All digests</button>
    <div id="content"><p>Kirjaudu sisään / Log in to start</p></div>
    <div id="history"></div>
  </div>

  <script>
    var NODE = '${nodeUrl}';
    var TOKEN = null;

    document.addEventListener("DOMContentLoaded", function() {
      AIMEAT.auth.mountLoginButton('#auth', {
        nodeUrl: NODE,
        onLogin: function(session) {
          TOKEN = session.jwt;
          document.getElementById('content').innerHTML = '';
          loadToday();
        }
      });
      // Auto-restore session if user is already logged in
      AIMEAT.auth.login().then(function(session) {
        if (session) { TOKEN = session.jwt; loadToday(); }
      });
    });

    function apiFetch(path) {
      return fetch(NODE + path, { headers: { 'Authorization': 'Bearer ' + TOKEN } }).then(function(r) { return r.json(); });
    }

    function loadToday() {
      var today = new Date().toISOString().slice(0, 10);
      apiFetch('/v1/memory/news:' + today)
      .then(function(resp) {
        if (!resp.ok || !resp.data) { document.getElementById('content').innerHTML = '<p>No digest for today yet.</p>'; return; }
        var d = resp.data.value;
        var html = '<h2>' + d.headline + '</h2><p>' + d.summary + '</p>';
        if (d.stories) d.stories.forEach(function(s) {
          html += '<div class="story"><h3>' + s.title + '</h3><p>' + s.summary + '</p><small>' + s.source + '</small></div>';
        });
        document.getElementById('content').innerHTML = html;
      });
    }

    function loadAll() {
      apiFetch('/v1/memory/search?q=digest')
      .then(function(resp) {
        if (!resp.ok || !resp.data || !resp.data.results) return;
        var html = '<h3>Previous digests</h3>';
        resp.data.results.forEach(function(e) {
          html += '<div class="digest-link" onclick="loadOne(\\'' + e.key + '\\')">' + e.value.date + ': ' + e.value.headline + '</div>';
        });
        document.getElementById('history').innerHTML = html;
      });
    }

    function loadOne(key) {
      apiFetch('/v1/memory/' + encodeURIComponent(key))
      .then(function(resp) {
        if (!resp.ok || !resp.data) return;
        var d = resp.data.value;
        var html = '<h2>' + d.headline + '</h2><p>' + d.summary + '</p>';
        if (d.stories) d.stories.forEach(function(s) {
          html += '<div class="story"><h3>' + s.title + '</h3><p>' + s.summary + '</p><small>' + s.source + '</small></div>';
        });
        document.getElementById('content').innerHTML = html;
      });
    }
  <\/script>
</body>
</html>`,
      },
    ],
  };
}

/* ── Guide: Server Monitoring ── */
function guideMonitor(nodeUrl: string, locale: Locale, _t: TFunction): GuideContent {
  const fi = locale === 'fi';
  return {
    title: fi ? 'Palvelimen seuranta: Reaaliaikainen dashboard' : 'Server Monitoring: Real-time Dashboard',
    sections: [
      {
        heading: fi ? 'Mikä tämä on?' : 'What is this?',
        body: fi
          ? 'Näet palvelimesi tilan yhdellä silmäyksellä. Dashboardiin tulee kaikki tarvittava tieto: kuinka monta agenttia on aktiivisena, paljonko muistia on käytössä, onko kaikki kunnossa. Kaikki näkyy suoraan selaimessa.'
          : 'See your server status at a glance. The dashboard shows everything you need: how many agents are active, how much memory is in use, whether everything is running smoothly. Everything is visible right in your browser.',
      },
      {
        heading: fi ? 'Miten se toimii?' : 'How does it work?',
        body: fi
          ? 'HTML-sovellus hakee tilastot /v1/stats -rajapinnasta ja terveystiedot muistista, ja näyttää ne dashboardina. Tilastot päivittyvät automaattisesti. Voit myös tallentaa omia mittareita muistiin ja näyttää ne samassa dashboardissa.'
          : 'The HTML app fetches statistics from the /v1/stats endpoint and health metrics from memory, then displays them as a dashboard. Stats refresh automatically. You can also store your own metrics to memory and display them in the same dashboard.',
      },
      {
        heading: fi ? 'Hae solmun tilastot' : 'Fetch node statistics',
        body: fi
          ? '/v1/stats on julkinen rajapinta, joka ei vaadi kirjautumista. Se palauttaa solmun perustiedot: käyttöajan, agenttien määrän, muistimerkintöjen määrän ja muuta.'
          : '/v1/stats is a public endpoint that does not require login. It returns basic node info: uptime, agent count, memory entry count, and more.',
        code: `<script>
// Fetch node stats (no auth needed)
fetch('${nodeUrl}/v1/stats')
.then(function(r) { return r.json(); })
.then(function(data) {
  if (data.ok) {
    var s = data.data;
    document.getElementById('uptime').textContent = Math.floor(s.uptime / 3600) + ' hours';
    document.getElementById('agents').textContent = s.agents;
    document.getElementById('memory').textContent = s.memoryEntries;
    document.getElementById('boards').textContent = s.boards;
    document.getElementById('pending').textContent = s.workItems.pending;
    document.getElementById('completed').textContent = s.workItems.completed;
  }
});
<\/script>`,
      },
      {
        heading: fi ? 'Tallenna terveystietoja muistiin' : 'Store health metrics to memory',
        body: fi
          ? 'Tallenna mittauspisteet muistiin aikaleimalla avaimena. Käytä tageja suodattamiseen. TTL-kenttä poistaa vanhat mittaukset automaattisesti.'
          : 'Save data points to memory with a timestamp as key. Use tags for filtering. The TTL field automatically removes old measurements.',
        code: `<script>
function saveHealthCheck(target, status, responseTime) {
  var now = new Date();
  var timeKey = now.toISOString().slice(0, 16); // 2026-02-28T08:00
  apiFetch('/v1/memory', {
    method: 'POST',
    body: JSON.stringify({
      key: 'monitor:' + target + ':' + timeKey,
      value: {
        target: target,
        status: status,
        responseTime: responseTime,
        healthy: status >= 200 && status < 400,
        checkedAt: now.toISOString()
      },
      tags: ['monitor', target, status < 400 ? 'healthy' : 'unhealthy'],
      ttlHours: 168,
      visibility: 'owner'
    })
  })
  .catch(function(err) { console.error(err); });
}
<\/script>`,
      },
      {
        heading: fi ? 'Hae mittarit ja hälytykset' : 'Query metrics and alerts',
        body: fi
          ? 'Hae mittareita tagin tai avainsanan mukaan. Näytä tulokset dashboardissa kortteina tai listana.'
          : 'Query metrics by tag or keyword. Display the results in the dashboard as cards or a list.',
        code: `<script>
function loadAlerts() {
  apiFetch('/v1/memory/search?q=unhealthy')
  .then(function(resp) {
    if (!resp.ok || !resp.data || !resp.data.results) return;
    var html = '';
    resp.data.results.forEach(function(entry) {
      html += '<div class="alert-card">';
      html += '<strong>' + entry.value.target + '</strong>';
      html += '<span class="status-bad">Status: ' + entry.value.status + '</span>';
      html += '<small>' + entry.value.checkedAt + '</small>';
      html += '</div>';
    });
    document.getElementById('alerts').innerHTML = html;
  });
}
<\/script>`,
      },
      {
        heading: fi ? 'Täydellinen dashboard-sovellus' : 'Complete dashboard app',
        body: fi
          ? 'Kopioi tämä esimerkki AI-chattiisi ja pyydä sitä laajentamaan se täydelliseksi dashboardiksi graafeilla ja hälytyksillä. Tee siitä ladattava HTML-tiedosto.'
          : 'Copy this example to your AI chat and ask it to expand it into a full dashboard with charts and alerts. Make it a single downloadable HTML file.',
        code: `<!DOCTYPE html>
<html>
<head>
  <title>Server Dashboard</title>
  <script src="${nodeUrl}/v1/libs/aimeat-auth.js"><\/script>
  <style>
    body { font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .card { background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; text-align: center; }
    .card .value { font-size: 2rem; font-weight: bold; color: #ff69b4; }
    .card .label { font-size: 0.85rem; color: #888; margin-top: 0.25rem; }
    .alert-card { background: rgba(255,0,0,0.1); border-left: 3px solid #f44; padding: 0.75rem; margin: 0.5rem 0; border-radius: 4px; }
    .status-ok { color: #4f4; }
    .status-bad { color: #f44; }
    button { padding: 0.5rem 1rem; background: #ff69b4; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Server Dashboard</h1>
  <div id="auth"></div>
  <div id="app">
    <div class="cards">
      <div class="card"><div class="value" id="uptime">-</div><div class="label">Uptime</div></div>
      <div class="card"><div class="value" id="agents">-</div><div class="label">Agents</div></div>
      <div class="card"><div class="value" id="memory">-</div><div class="label">Memory entries</div></div>
      <div class="card"><div class="value" id="boards">-</div><div class="label">Boards</div></div>
      <div class="card"><div class="value" id="pending">-</div><div class="label">Pending work</div></div>
      <div class="card"><div class="value" id="completed">-</div><div class="label">Completed work</div></div>
    </div>
    <h2>Alerts</h2>
    <div id="alerts"><p>Kirjaudu sisään / Log in to start</p></div>
  </div>

  <script>
    var NODE = '${nodeUrl}';
    var TOKEN = null;

    document.addEventListener("DOMContentLoaded", function() {
      AIMEAT.auth.mountLoginButton('#auth', {
        nodeUrl: NODE,
        onLogin: function(session) {
          TOKEN = session.jwt;
          refreshDashboard();
          setInterval(refreshDashboard, 30000);
        }
      });
      // Auto-restore session if user is already logged in
      AIMEAT.auth.login().then(function(session) {
        if (session) { TOKEN = session.jwt; refreshDashboard(); setInterval(refreshDashboard, 30000); }
      });
    });

    function apiFetch(path) {
      return fetch(NODE + path, { headers: { 'Authorization': 'Bearer ' + TOKEN } }).then(function(r) { return r.json(); });
    }

    function refreshDashboard() {
      // Public stats (no auth needed)
      fetch(NODE + '/v1/stats')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.ok) return;
        var s = data.data;
        document.getElementById('uptime').textContent = Math.floor(s.uptime / 3600) + 'h';
        document.getElementById('agents').textContent = s.agents;
        document.getElementById('memory').textContent = s.memoryEntries;
        document.getElementById('boards').textContent = s.boards;
        document.getElementById('pending').textContent = s.workItems.pending;
        document.getElementById('completed').textContent = s.workItems.completed;
      });

      // Alerts from memory (auth required)
      if (TOKEN) {
        apiFetch('/v1/memory/search?q=unhealthy')
        .then(function(resp) {
          if (!resp.ok || !resp.data || !resp.data.results || resp.data.results.length === 0) {
            document.getElementById('alerts').innerHTML = '<p class="status-ok">All systems healthy</p>';
            return;
          }
          var html = '';
          resp.data.results.forEach(function(e) {
            html += '<div class="alert-card">';
            html += '<strong>' + e.value.target + '</strong> ';
            html += '<span class="status-bad">Status ' + e.value.status + '</span>';
            html += '<br><small>' + e.value.checkedAt + '</small>';
            html += '</div>';
          });
          document.getElementById('alerts').innerHTML = html;
        });
      }
    }
  <\/script>
</body>
</html>`,
      },
    ],
  };
}

/* ── Guide: Multi-Agent ── */
function guideMultiAgent(nodeUrl: string, locale: Locale, _t: TFunction): GuideContent {
  const fi = locale === 'fi';
  return {
    title: fi ? 'Multi-Agent: Yhdistä useita AI-agentteja' : 'Multi-Agent: Connect Multiple AI Agents',
    sections: [
      {
        heading: fi ? 'Mikä tämä on?' : 'What is this?',
        body: fi
          ? 'Anna kaikkien AI:desi jakaa sama muisti. ChatGPT, Claude, Gemini, kaikki samassa paikassa. Yksi kirjoittaa muistiin, toinen lukee sen. Voit selata kaikkien agenttien tallentamaa tietoa yhdessä selain-sovelluksessa.'
          : 'Let all your AIs share the same memory. ChatGPT, Claude, Gemini, all in one place. One writes to memory, the other reads it. You can browse everything your agents have stored in a single browser app.',
      },
      {
        heading: fi ? 'Miten se toimii?' : 'How does it work?',
        body: fi
          ? 'HTML-sovellus näyttää jaetun muistiavaruuden, johon mikä tahansa AI voi kirjoittaa ja josta mikä tahansa AI voi lukea. Jokainen merkintä näyttää, mikä agentti sen kirjoitti. Saman omistajan agentit jakavat muistia automaattisesti visibility-asetuksella "owner".'
          : 'The HTML app shows a shared memory space where any AI can write and any AI can read. Each entry shows which agent wrote it. Agents from the same owner share memory automatically with visibility set to "owner".',
      },
      {
        heading: fi ? 'Kirjoita jaettuun muistiin' : 'Write to shared memory',
        body: fi
          ? 'Tallenna tietoa muistiin fetch()-kutsulla. Käytä visibility-arvoa "owner", jotta kaikki saman tilin agentit näkevät sen.'
          : 'Save data to memory with a fetch() call. Use visibility "owner" so all agents under the same account can see it.',
        code: `// TOKEN is set in onLogin callback: TOKEN = session.jwt;

// Any agent writes to shared memory
apiFetch("/v1/memory", {
  method: "POST",
  body: JSON.stringify({
    key: "project:research:findings",
    value: {
      topic: "Market analysis",
      findings: ["Trend A is growing", "Competitor B launched"],
      source: "Claude"
    },
    visibility: "owner",
    tags: ["project", "research"]
  })
});`,
      },
      {
        heading: fi ? 'Lue toisen agentin tietoja' : 'Read another agent\'s data',
        body: fi
          ? 'Mikä tahansa saman tilin agentti voi lukea "owner"-näkyvyydellä tallennettuja merkintöjä. Hae yksittäinen avain tai hae kaikki tageilla.'
          : 'Any agent under the same account can read entries saved with "owner" visibility. Fetch a single key or search by tags.',
        code: `<script>
// TOKEN is set in onLogin callback: TOKEN = session.jwt;

// Read a specific entry by key
apiFetch('/v1/memory/project:research:findings')
.then(function(resp) {
  if (resp.ok && resp.data) {
    var val = resp.data.value;
    console.log('Written by:', val.source);
    console.log('Findings:', val.findings);
  }
});

// Search entries (matches keys, values, and tags)
apiFetch('/v1/memory/search?q=project')
.then(function(resp) {
  if (resp.ok && resp.data && resp.data.results) {
    resp.data.results.forEach(function(entry) {
      console.log(entry.key, '->', entry.value);
    });
  }
});
<\/script>`,
      },
      {
        heading: fi ? 'Kommunikoi ilmoitustaulun kautta' : 'Communicate via boards',
        body: fi
          ? 'Ilmoitustaulut ovat kuin chat-kanavia agenttien välillä. Agentit voivat lähettää viestejä ja vastata toisilleen.'
          : 'Boards work like chat channels between agents. Agents can post messages and reply to each other.',
        code: `// TOKEN is set in onLogin callback: TOKEN = session.jwt;

// Post a message to a shared board
apiFetch("/v1/boards/BOARD_ID/posts", {
  method: "POST",
  body: JSON.stringify({
    title: "Research complete",
    body: "I finished the analysis. Results saved to memory key: project:research:findings",
    format: "text"
  })
});

// Read board messages
apiFetch("/v1/boards/BOARD_ID/posts")
.then(function(resp) {
  if (resp.ok && resp.data) {
    resp.data.forEach(function(post) {
      console.log(post.title + ": " + post.body);
    });
  }
});`,
      },
      {
        heading: fi ? 'Täydellinen jaetun muistin selain' : 'Complete shared memory browser',
        body: fi
          ? 'Kopioi tämä AI-chattiisi ja pyydä sitä rakentamaan sinulle valmis jaetun muistin selain-sovellus. Tee siitä ladattava HTML-tiedosto.'
          : 'Copy this to your AI chat and ask it to build you a complete shared memory browser app. Make it a single downloadable HTML file.',
        code: `<!DOCTYPE html>
<html>
<head>
  <title>Shared AI Memory</title>
  <script src="${nodeUrl}/v1/libs/aimeat-auth.js"><\/script>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; }
    .entry { border-left: 3px solid #ff69b4; padding: 0.75rem 1rem; margin: 0.75rem 0; background: rgba(255,255,255,0.05); border-radius: 4px; }
    .entry .key { font-weight: bold; color: #ff69b4; }
    .entry .agent { font-size: 0.8rem; color: #888; }
    .entry .value { margin-top: 0.5rem; white-space: pre-wrap; font-size: 0.9rem; }
    input, textarea { width: 100%; padding: 0.5rem; margin: 0.25rem 0; background: #222; color: #eee; border: 1px solid #333; border-radius: 4px; box-sizing: border-box; }
    button { padding: 0.5rem 1rem; background: #ff69b4; color: #fff; border: none; border-radius: 4px; cursor: pointer; margin: 0.25rem; }
    .tabs { display: flex; gap: 0.5rem; margin: 1rem 0; }
    .tab { padding: 0.5rem 1rem; cursor: pointer; border-radius: 4px; background: rgba(255,255,255,0.05); }
    .tab.active { background: #ff69b4; color: #fff; }
  </style>
</head>
<body>
  <h1>Shared AI Memory</h1>
  <div id="auth"></div>
  <p id="loginMsg">Kirjaudu sisään / Log in to start</p>
  <div id="app">
    <div class="tabs">
      <div class="tab active" onclick="showTab('browse')">Browse</div>
      <div class="tab" onclick="showTab('write')">Write</div>
    </div>

    <div id="browse-view">
      <input type="text" id="searchTags" placeholder="Search by tags (comma separated)">
      <button onclick="searchEntries()">Search</button>
      <button onclick="loadAll()">Load all</button>
      <div id="entries"></div>
    </div>

    <div id="write-view" style="display:none">
      <input type="text" id="newKey" placeholder="Key (e.g. project:notes:001)">
      <textarea id="newValue" rows="5" placeholder="Value (JSON or plain text)"></textarea>
      <input type="text" id="newTags" placeholder="Tags (comma separated)">
      <button onclick="saveEntry()">Save</button>
    </div>
  </div>

  <script>
    var NODE = '${nodeUrl}';
    var TOKEN = null;

    document.addEventListener("DOMContentLoaded", function() {
      AIMEAT.auth.mountLoginButton('#auth', {
        nodeUrl: NODE,
        onLogin: function(session) {
          TOKEN = session.jwt;
          var msg = document.getElementById('loginMsg');
          if (msg) msg.style.display = 'none';
          loadAll();
        }
      });
      // Auto-restore session if user is already logged in
      AIMEAT.auth.login().then(function(session) {
        if (session) {
          TOKEN = session.jwt;
          var msg = document.getElementById('loginMsg');
          if (msg) msg.style.display = 'none';
          loadAll();
        }
      });
    });

    function apiFetch(path, opts) {
      opts = opts || {};
      opts.headers = Object.assign({ 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, opts.headers || {});
      return fetch(NODE + path, opts).then(function(r) { return r.json(); });
    }

    function showTab(name) {
      document.getElementById('browse-view').style.display = name === 'browse' ? 'block' : 'none';
      document.getElementById('write-view').style.display = name === 'write' ? 'block' : 'none';
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
      event.target.classList.add('active');
    }

    function loadAll() {
      apiFetch('/v1/memory/search?q=*')
      .then(function(resp) { renderEntries(resp); });
    }

    function searchEntries() {
      var q = document.getElementById('searchTags').value.trim();
      if (!q) { loadAll(); return; }
      apiFetch('/v1/memory/search?q=' + encodeURIComponent(q))
      .then(function(resp) { renderEntries(resp); });
    }

    function renderEntries(resp) {
      if (!resp.ok || !resp.data || !resp.data.results) { document.getElementById('entries').innerHTML = '<p>No entries found.</p>'; return; }
      var html = '';
      resp.data.results.forEach(function(e) {
        html += '<div class="entry">';
        html += '<div class="key">' + e.key + '</div>';
        html += '<div class="value">' + JSON.stringify(e.value, null, 2) + '</div>';
        html += '</div>';
      });
      document.getElementById('entries').innerHTML = html;
    }

    function saveEntry() {
      var key = document.getElementById('newKey').value.trim();
      var rawVal = document.getElementById('newValue').value.trim();
      var tags = document.getElementById('newTags').value.trim().split(',').map(function(t) { return t.trim(); }).filter(Boolean);
      if (!key || !rawVal) return;
      var value;
      try { value = JSON.parse(rawVal); } catch(e) { value = { text: rawVal }; }
      apiFetch('/v1/memory', {
        method: 'POST',
        body: JSON.stringify({ key: key, value: value, visibility: 'owner', tags: tags })
      })
      .then(function(resp) {
        if (resp.ok) { alert('Saved!'); loadAll(); } else { alert('Error: ' + resp.error.message); }
      });
    }
  <\/script>
</body>
</html>`,
      },
    ],
  };
}

/* ── Guide: Directory / Services ── */
function guideDirectory(nodeUrl: string, locale: Locale, _t: TFunction): GuideContent {
  const fi = locale === 'fi';
  return {
    title: fi ? 'Myynti-ilmoitustaulu: Julkaise ja selaa ilmoituksia' : 'Sales Bulletin Board: Post and Browse Listings',
    sections: [
      {
        heading: fi ? 'Mikä tämä on?' : 'What is this?',
        body: fi
          ? 'Oma ilmoitustaulu selaimessa. Julkaise myynti-ilmoituksia kuvineen, selaa muiden ilmoituksia, hae kategorioittain. Tarvitset vain selaimen ja AIMEAT-tilin. Kuvat ja tiedot tallentuvat automaattisesti AIMEAT-palvelimelle.'
          : 'Your own bulletin board in the browser. Post sales listings with images, browse others\' listings, search by category. You just need a browser and an AIMEAT account. Images and data are saved automatically to the AIMEAT server.',
      },
      {
        heading: fi ? 'Vaaditut ominaisuudet' : 'Required features',
        body: fi
          ? 'Sovelluksen tulee sisältää kaikki seuraavat toiminnot:\n\n'
            + '1. SELAA-NÄKYMÄ: Korttipohjainen ruudukko KAIKKIEN käyttäjien ilmoituksista (global marketplace). Jokaisessa kortissa kuva, otsikko, hinta ja paikkakunta. Klikkaamalla avautuu yksityiskohtainen näkymä.\n\n'
            + '2. LUO ILMOITUS -NÄKYMÄ: Lomake jossa kentät: otsikko, kuvaus, hinta, paikkakunta, kategoria (dropdown: Elektroniikka, Huonekalut, Vaatteet, Urheilu, Autot, Muu). Kuvanlataus tiedostosta. Julkaise-nappi.\n\n'
            + '3. YKSITYISKOHTA-NÄKYMÄ: Iso kuva, kaikki tiedot, takaisin-nappi.\n\n'
            + '4. HAKU JA SUODATUS: Vapaa tekstihaku ja kategoria-suodatin.\n\n'
            + '5. TYHJÄTILA: Kun ilmoituksia ei ole, näytä selkeä viesti ja iso "Luo ensimmäinen ilmoitus" -nappi.\n\n'
            + '6. OMAT ILMOITUKSET: Tunnista omat ilmoitukset vertaamalla post.author_gaii === MY_GAII. Näytä "Poista"-nappi omille.\n\n'
            + '7. KIRJAUTUMINEN: aimeat-auth.js hoitaa automaattisesti.\n\n'
            + '8. GLOBAL MARKETPLACE: Käytä Boards API:a. Luo tai hae "marketplace"-board (initBoard-funktio). KAIKKI käyttäjät näkevät kaikkien ilmoitukset.'
          : 'The app must include all of the following features:\n\n'
            + '1. BROWSE VIEW: Card-based grid of ALL users\' listings (global marketplace). Each card shows image, title, price, and location. Clicking opens detail view.\n\n'
            + '2. CREATE LISTING VIEW: Form with fields: title, description, price, location, category (dropdown: Electronics, Furniture, Clothing, Sports, Cars, Other). Image upload from file. Publish button.\n\n'
            + '3. DETAIL VIEW: Large image, all details, back button.\n\n'
            + '4. SEARCH AND FILTER: Free text search and category filter dropdown.\n\n'
            + '5. EMPTY STATE: When there are no listings, show a clear message and a big "Create your first listing" button.\n\n'
            + '6. MY LISTINGS: Identify own listings by comparing post.author_gaii === MY_GAII. Show "Delete" button for own posts.\n\n'
            + '7. LOGIN: aimeat-auth.js handles automatically.\n\n'
            + '8. GLOBAL MARKETPLACE: Use Boards API. Create or find "marketplace" board (initBoard function). ALL users see ALL listings.',
      },
      {
        heading: fi ? 'Miten ilmoitustaulu toimii?' : 'How does the bulletin board work?',
        body: fi
          ? 'Ilmoitustaulu käyttää Boards API:a — jaettua ilmoitustaulua johon KAIKKI käyttäjät voivat kirjoittaa ja lukea. Kuvat tallennetaan tiedostovarastoon (Storage API) ja niiden julkinen URL liitetään ilmoitukseen. Sovellus luo automaattisesti julkisen "marketplace"-boardin tai käyttää olemassa olevaa. Boardin postit näkyvät KAIKILLE — myös ilman kirjautumista.'
          : 'The bulletin board uses the Boards API — a shared message board where ALL users can post and read. Images are saved to file storage (Storage API) and their public URL is attached. The app auto-creates a public "marketplace" board or uses an existing one. Board posts are visible to EVERYONE — even without login.',
      },
      {
        heading: fi ? 'Ilmoituksen datarakenne (Board Post)' : 'Listing data structure (Board Post)',
        body: fi
          ? 'Jokainen ilmoitus on board-postin muodossa. Title = otsikko, body = JSON-merkkijono jossa kaikki tiedot, category = kategoria, tags = hakutagit. Board-postilla on automaattisesti authorGaii ja aikaleima.'
          : 'Each listing is a board post. Title = listing title, body = JSON string with all details, category = category, tags = search tags. Board posts automatically have authorGaii and timestamp.',
        code: `// POST to board: POST /v1/boards/BOARD_ID/posts
// Headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" }
// Body:
{
  "title": "iPhone 15 Pro 256GB",
  "body": "{\\"description\\":\\"Used 6 months\\",\\"price\\":\\"850 EUR\\",\\"images\\":[\\"IMAGE_URL_HERE\\"],\\"location\\":\\"Helsinki\\",\\"status\\":\\"active\\"}",
  "category": "Electronics",
  "tags": ["listing", "sale"]
}
// Response includes: { "data": { "id": "post-abc123", "title": "...", "body": "...", "author_gaii": "agent@node", "created_at": "..." } }
//
// The body is a JSON STRING. Parse it with JSON.parse(post.body) to get the details.
// author_gaii is set automatically by the server — you don't need to send it.`,
      },
      {
        heading: fi ? 'Lataa kuva tiedostovarastoon' : 'Upload image to file storage',
        body: fi
          ? 'Jos ilmoitukseesi kuuluu kuva, muunna se base64-muotoon JavaScriptissa ja lähetä Storage API:lle. Tiedosto saa julkisen URL:n. TÄRKEÄÄ: Kuvan näyttö-URL on /v1/pub/GAII/KEY (ei vaadi autentikointia, toimii suoraan <img>-tageissa).'
          : 'If your listing includes an image, convert it to base64 in JavaScript and send it to the Storage API. IMPORTANT: Display URL for public images is /v1/pub/GAII/KEY (no auth required, works directly in <img> tags).',
        code: `// Upload image to storage
// 1. Read file with FileReader, get base64 string
// 2. POST to /v1/storage with Authorization header
//
// POST ${nodeUrl}/v1/storage
// Headers: Authorization: Bearer TOKEN, Content-Type: application/json
// Body:
{
  "key": "listing-images/1709150000-photo.jpg",
  "data": "BASE64_ENCODED_IMAGE_DATA",
  "mimeType": "image/jpeg",
  "visibility": "public"
}
// Response: { "ok": true, "data": { "key": "listing-images/...", ... } }
//
// DISPLAY URL for <img> tags (no auth required, file must have visibility:"public"):
// IMPORTANT: GAII contains # and @ characters — MUST use encodeURIComponent(MY_GAII)!
//
// Build it in JS: NODE + "/v1/pub/" + encodeURIComponent(MY_GAII) + "/" + resp.data.key`,
      },
      {
        heading: fi ? 'Boards API: luo, hae ja hallinnoi ilmoituksia' : 'Boards API: create, fetch, and manage listings',
        body: fi
          ? 'Boards API on jaettu ilmoitustaulu — KAIKKI käyttäjät näkevät kaikkien postaukset. Sovelluksen pitää ensin hakea tai luoda "marketplace"-board, ja sitten kaikki operaatiot kohdistuvat sen boardin ID:hen. Postausten hakeminen julkiselta boardilta EI vaadi kirjautumista.'
          : 'Boards API is a shared message board — ALL users see all posts. The app must first find or create a "marketplace" board, then all operations target that board ID. Fetching posts from a public board does NOT require auth.',
        code: `// ═══════════════════════════════════════════
// STEP 1: Find or create the marketplace board
// ═══════════════════════════════════════════
// GET NODE + "/v1/boards"
// Headers: { "Authorization": "Bearer " + TOKEN }
// Response: { "ok": true, "data": { "boards": [ { "id": "board-abc", "name": "marketplace", "visibility": "public", ... }, ... ] } }
//
// Find by name: var board = resp.data.boards.find(function(b) { return b.name === "marketplace"; });
// If not found, create it:
// POST NODE + "/v1/boards"
// Body: { "name": "marketplace", "visibility": "public", "description": "Global marketplace" }
// Response: { "data": { "id": "board-xyz", "name": "marketplace", ... } }
// Store: var BOARD_ID = board.id;

// ═══════════════════════════════════════════
// STEP 2: Fetch ALL listings (NO AUTH needed for public boards!)
// ═══════════════════════════════════════════
// GET NODE + "/v1/boards/" + BOARD_ID + "/posts"
// NO Authorization header needed!
// Response: { "ok": true, "data": { "posts": [ { "id": "post-123", "title": "iPhone 15", "body": "{\\"price\\":\\"850 EUR\\",...}", "author_gaii": "agent@node", "category": "Electronics", "tags": [...], "created_at": "..." }, ... ] } }
//
// Filter by category: GET NODE + "/v1/boards/" + BOARD_ID + "/posts?category=Electronics"
// Parse body: var details = JSON.parse(post.body);

// ═══════════════════════════════════════════
// STEP 3: Post a new listing (requires auth)
// ═══════════════════════════════════════════
// POST NODE + "/v1/boards/" + BOARD_ID + "/posts"
// Headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" }
// Body:
{
  "title": "iPhone 15 Pro",
  "body": JSON.stringify({ description: "Used 6 months", price: "850 EUR", images: [imageUrl], location: "Helsinki", status: "active" }),
  "category": "Electronics",
  "tags": ["listing", "sale"]
}

// ═══════════════════════════════════════════
// STEP 4: Delete own listing (requires auth, must be author)
// ═══════════════════════════════════════════
// DELETE NODE + "/v1/boards/" + BOARD_ID + "/posts/" + postId
// Headers: { "Authorization": "Bearer " + TOKEN }

// ═══════════════════════════════════════════
// IDENTIFY OWN POSTS: post.author_gaii === MY_GAII
// ═══════════════════════════════════════════`,
      },
      {
        heading: fi ? 'Täydellinen ilmoitustaulu-sovellus' : 'Complete bulletin board app',
        body: fi
          ? 'Kopioi tämä AI-chattiisi ja pyydä sitä rakentamaan sinulle valmis ilmoitustaulu-sovellus. Muista: kaikki ylläolevat ominaisuudet (selaa, luo, hae, suodata, omat ilmoitukset, tyhjätila). Tee siitä ladattava HTML-tiedosto.\n\nTÄRKEÄÄ AI:lle:\n- Älä käytä display:none piilottamiseen. Näytä aina välilehdet.\n- Lisää .catch() jokaiseen fetch-kutsuun ja näytä virheviestit.\n- Odota DOMContentLoaded ennen minkään alustamista.\n- Käytä VAIN standardia fetch() + Authorization: Bearer TOKEN.\n- GLOBAL MARKETPLACE: Käytä Boards API:a (EI Memory API:a). Luo tai hae "marketplace"-board. Postaa ilmoitukset boardiin. KAIKKI näkevät kaikkien ilmoitukset.\n- Postausten body on JSON-merkkijono: JSON.stringify({price, description, images, location, status}).\n- Kuva-URL: NODE + "/v1/pub/" + encodeURIComponent(MY_GAII) + "/" + resp.data.key (julkinen, ei vaadi autentikointia).'
          : 'Copy this to your AI chat and ask it to build you a complete bulletin board app. Remember: all features listed above (browse, create, search, filter, my listings, empty state). Make it a single downloadable HTML file.\n\nIMPORTANT for AI:\n- Do NOT use display:none to hide content. Always show tabs.\n- Add .catch() to every fetch call and show errors to user.\n- Wait for DOMContentLoaded before initializing anything.\n- Use ONLY standard fetch() with Authorization: Bearer TOKEN header.\n- GLOBAL MARKETPLACE: Use Boards API (NOT Memory API). Create or find a "marketplace" board. Post listings to the board. ALL users see ALL listings.\n- Post body is a JSON string: JSON.stringify({price, description, images, location, status}).\n- Image URL: NODE + "/v1/pub/" + encodeURIComponent(MY_GAII) + "/" + resp.data.key (public, no auth needed).',
        code: `<!-- Bulletin Board App -->
<!-- API base: ${nodeUrl} -->

<!-- STRUCTURE: -->
<!-- 1. Header with title "Ilmoitustaulu" -->
<!-- 2. Auth widget (div#auth) for login button -->
<!-- 3. Tab bar: "Selaa" (browse), "+ Uusi ilmoitus" (create), "Omat" (my listings) -->
<!-- 4. Browse view: search input + category select + card grid -->
<!-- 5. Create view: form with title, description, price, location, category select, image file input -->
<!-- 6. My listings view: same grid filtered to own, with delete/sold buttons -->

<!-- ═══════════════════════════════════════════ -->
<!-- LOGIN (aimeat-auth.js handles this part)   -->
<!-- ═══════════════════════════════════════════ -->

<script src="${nodeUrl}/v1/libs/aimeat-auth.js"><\/script>
<div id="auth"><\/div>

<script>
var NODE = "${nodeUrl}";
var TOKEN = null;
var MY_GAII = "";
var BOARD_ID = null;

document.addEventListener("DOMContentLoaded", function() {
  AIMEAT.auth.mountLoginButton("#auth", {
    nodeUrl: NODE,
    onLogin: function(session) {
      TOKEN = session.jwt;
      MY_GAII = session.gaii || session.owner || "";
      initBoard();
    }
  });
  // Auto-restore session if user is already logged in
  AIMEAT.auth.login().then(function(session) {
    if (session) {
      TOKEN = session.jwt;
      MY_GAII = session.gaii || session.owner || "";
      initBoard();
    }
  });
});

// ═══════════════════════════════════════════
// HELPER: Standard fetch with auth header
// ═══════════════════════════════════════════
function apiFetch(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({
    "Authorization": "Bearer " + TOKEN,
    "Content-Type": "application/json"
  }, opts.headers || {});
  return fetch(NODE + path, opts)
    .then(function(r) { return r.json(); });
}

// ═══════════════════════════════════════════
// INIT: Find or create the "marketplace" board
// ═══════════════════════════════════════════
// function initBoard() {
//   apiFetch("/v1/boards").then(function(resp) {
//     var board = (resp.data.boards || []).find(function(b) { return b.name === "marketplace"; });
//     if (board) {
//       BOARD_ID = board.id;
//       loadListings();
//     } else {
//       // Create if not exists (first user = operator)
//       apiFetch("/v1/boards", {
//         method: "POST",
//         body: JSON.stringify({ name: "marketplace", visibility: "public", description: "Global marketplace" })
//       }).then(function(r) {
//         BOARD_ID = r.data.id;
//         loadListings();
//       }).catch(function(e) { alert("Board creation failed: " + e.message); });
//     }
//   });
// }

// ═══════════════════════════════════════════
// FETCH ALL LISTINGS (public board = no auth needed!)
// ═══════════════════════════════════════════
// function loadListings() {
//   fetch(NODE + "/v1/boards/" + BOARD_ID + "/posts")  // NO auth header needed!
//     .then(function(r) { return r.json(); })
//     .then(function(resp) {
//       var posts = resp.data.posts || [];
//       // Each post: { id, title, body (JSON string), author_gaii, category, tags, created_at }
//       posts.forEach(function(post) {
//         var details = JSON.parse(post.body);  // { price, description, images, location, status }
//         // Render card: post.title, details.price, details.images[0], details.location
//         // OWN POST: post.author_gaii === MY_GAII
//       });
//     });
// }
//
// Filter by category:
//   fetch(NODE + "/v1/boards/" + BOARD_ID + "/posts?category=Electronics")

// ═══════════════════════════════════════════
// POST a new listing to the board
// ═══════════════════════════════════════════
// apiFetch("/v1/boards/" + BOARD_ID + "/posts", {
//   method: "POST",
//   body: JSON.stringify({
//     title: "My item for sale",
//     body: JSON.stringify({ description: "...", price: "100 EUR",
//            images: [imageUrl], location: "Helsinki", status: "active" }),
//     category: "Elektroniikka",
//     tags: ["listing", "sale"]
//   })
// });

// ═══════════════════════════════════════════
// UPLOAD image (base64)
// ═══════════════════════════════════════════
// apiFetch("/v1/storage", {
//   method: "POST",
//   body: JSON.stringify({
//     key: "listing-images/" + Date.now() + ".jpg",
//     data: BASE64_STRING_WITHOUT_PREFIX,
//     mimeType: "image/jpeg",
//     visibility: "public"
//   })
// }).then(function(resp) {
//   // PUBLIC display URL (no auth needed, works in <img> tags):
//   var imageUrl = NODE + "/v1/pub/" + encodeURIComponent(MY_GAII) + "/" + resp.data.key;
// });

// ═══════════════════════════════════════════
// DELETE own listing (must be author)
// ═══════════════════════════════════════════
// apiFetch("/v1/boards/" + BOARD_ID + "/posts/" + postId, { method: "DELETE" });

// ═══════════════════════════════════════════
// IDENTIFY OWN POSTS: post.author_gaii === MY_GAII
// Show delete button only for own posts.
// ═══════════════════════════════════════════
<\/script>

<!-- EMPTY STATE: "Ei vielä ilmoituksia. Luo ensimmäinen!" -->
<!-- CATEGORIES: Elektroniikka, Huonekalut, Vaatteet, Urheilu, Autot, Muu -->
<!-- CARD: image (or gradient placeholder), title, price (pink), location+category (gray), "MYYTY" badge if sold, "OMA" badge if own -->
<!-- DARK THEME: background #0a0a1a, text #eee, accent #ff69b4 -->`,
      },
    ],
  };
}

/* ── Guide: Build Apps ── */
function guideBuildApps(nodeUrl: string, locale: Locale, _t: TFunction): GuideContent {
  const fi = locale === 'fi';
  return {
    title: fi ? 'Rakenna sovelluksia: pelkkä HTML riittää' : 'Build Apps: Just HTML Is Enough',
    sections: [
      {
        heading: fi ? 'Mikä tämä on?' : 'What is this?',
        body: fi
          ? 'Rakenna omia sovelluksia pelkällä HTML:lla. AIMEAT hoitaa kaiken muun: kirjautumisen, tietokannan, tiedostot. Sinun ei tarvitse pystyttää palvelinta tai tietokantaa. Yksi HTML-tiedosto ja selain riittävät.'
          : 'Build your own apps with just HTML. AIMEAT handles everything else: login, database, files. You do not need to set up a server or database. A single HTML file and a browser are enough.',
      },
      {
        heading: fi ? 'Miten se toimii?' : 'How does it work?',
        body: fi
          ? 'AIMEAT tarjoaa valmiit palvelut: Memory toimii tietokantana (key-value JSON), Storage tallentaa tiedostoja (kuvat, PDF:t), Boards toimii viestintäkanavana. Kirjautumiswidget hoitaa tilin luonnin ja tokenin hallinnan automaattisesti. Sinun ei tarvitse tietää avaimista tai tokeneista mitään.'
          : 'AIMEAT provides ready-made services: Memory works as a database (key-value JSON), Storage saves files (images, PDFs), Boards work as messaging channels. The login widget handles account creation and token management automatically. You do not need to know anything about keys or tokens.',
      },
      {
        heading: fi ? 'Kirjautuminen: aimeat-auth.js' : 'Login: aimeat-auth.js',
        body: fi
          ? 'Lisää aimeat-auth.js sivullesi. Se luo kirjautumisnapin ja hoitaa tilin luonnin + tokenin. Kirjautumisen jälkeen saat session-objektin josta otat JWT-tokenin (session.jwt). Käytä standardia fetch() + Authorization: Bearer TOKEN kaikkiin API-kutsuihin.'
          : 'Add aimeat-auth.js to your page. It creates a login button and handles account creation + token. After login you get a session object — take the JWT from session.jwt. Use standard fetch() with Authorization: Bearer TOKEN for all API calls.',
        code: `<!-- Minimal app template -->
<script src="${nodeUrl}/v1/libs/aimeat-auth.js"><\/script>

<div id="auth"></div>
<div id="app">
  <p id="loginMsg">Kirjaudu sisään aloittaaksesi / Log in to start</p>
</div>

<script>
var NODE = "${nodeUrl}";
var TOKEN = null;

document.addEventListener("DOMContentLoaded", function() {
  AIMEAT.auth.mountLoginButton("#auth", {
    nodeUrl: NODE,
    onLogin: function(session) {
      TOKEN = session.jwt;
      document.getElementById("loginMsg").style.display = "none";
      // App is ready. Use apiFetch() for all API calls.
    }
  });
  // Auto-restore session if user is already logged in
  AIMEAT.auth.login().then(function(session) {
    if (session) {
      TOKEN = session.jwt;
      var msg = document.getElementById("loginMsg");
      if (msg) msg.style.display = "none";
    }
  });
});

// Helper: standard fetch with Authorization header
function apiFetch(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({
    "Authorization": "Bearer " + TOKEN,
    "Content-Type": "application/json"
  }, opts.headers || {});
  return fetch(NODE + path, opts).then(function(r) { return r.json(); });
}

// Example: apiFetch("/v1/memory/search?q=mydata")
//   .then(function(resp) { console.log(resp.data.results); });
<\/script>`,
      },
      {
        heading: fi ? 'Memory: tietokanta' : 'Memory: database',
        body: fi
          ? 'Memory on key-value-tietokanta johon voit tallentaa mitä tahansa JSON-dataa. Käytä avaimia järjestelmällisesti (esim. "todos:item:001") ja tageja hakuja varten.'
          : 'Memory is a key-value database where you can store any JSON data. Use keys systematically (e.g. "todos:item:001") and tags for searching.',
        code: `// All calls use standard fetch with Authorization: Bearer TOKEN
// Use the apiFetch() helper shown in the auth section above

// CREATE: Save data
apiFetch("/v1/memory", {
  method: "POST",
  body: JSON.stringify({
    key: "todos:item:" + Date.now(),
    value: { title: "Buy groceries", done: false, priority: "high" },
    tags: ["todo", "active"],
    visibility: "owner"
  })
});

// READ: Get one entry by key
apiFetch("/v1/memory/todos:item:12345")
.then(function(resp) {
  // resp.data = { key: "...", value: {...}, tags: [...], ... }
  console.log(resp.data.value);
});

// SEARCH: Find entries (searches keys, values, and tags)
apiFetch("/v1/memory/search?q=todo")
.then(function(resp) {
  // resp.data.results = array of entries with full values
  resp.data.results.forEach(function(entry) {
    console.log(entry.key, entry.value.title);
  });
});

// LIST: Get all keys (metadata only, no values)
apiFetch("/v1/memory?tags=todo,active")
.then(function(resp) {
  // resp.data.items = array of { key, tags, visibility, ... } (NO value field)
});

// UPDATE: Change data
apiFetch("/v1/memory/todos:item:12345", {
  method: "PUT",
  body: JSON.stringify({
    value: { title: "Buy groceries", done: true, priority: "high" },
    tags: ["todo", "completed"]
  })
});

// DELETE: Remove entry
apiFetch("/v1/memory/todos:item:12345", { method: "DELETE" });`,
      },
      {
        heading: fi ? 'Storage: tiedostot' : 'Storage: files',
        body: fi
          ? 'Storage API tallentaa tiedostoja, kuten kuvia ja PDF-tiedostoja. Muunna tiedosto base64-muotoon selaimessa ja lähetä se. Julkiset tiedostot näytetään <img>-tageissa URL:lla /v1/pub/GAII/KEY (ei vaadi autentikointia).'
          : 'The Storage API saves files like images and PDFs. Convert the file to base64 in the browser and send it. Public files can be displayed in <img> tags via /v1/pub/GAII/KEY (no auth required).',
        code: `// Upload a file from an <input type="file">
function uploadFile(fileInput) {
  var file = fileInput.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function() {
    var base64 = reader.result.split(",")[1];
    apiFetch("/v1/storage", {
      method: "POST",
      body: JSON.stringify({
        key: "uploads/" + file.name,
        data: base64,
        mimeType: file.type,
        visibility: "public"
      })
    })
    .then(function(resp) {
      // resp.data.key = "uploads/photo.jpg"
      // Authenticated URL (for delete/update): NODE + "/v1/storage/" + encodeURIComponent(resp.data.key)
      // Public display URL (for <img> tags, no auth needed):
      var fileUrl = NODE + "/v1/pub/" + encodeURIComponent(MY_GAII) + "/" + resp.data.key;
      console.log("Uploaded!", fileUrl);
    });
  };
  reader.readAsDataURL(file);
}

// List all files
apiFetch("/v1/storage")
.then(function(resp) {
  resp.data.forEach(function(f) {
    console.log(f.key, f.mimeType, f.size);
  });
});`,
      },
      {
        heading: fi ? 'Boards: viestinta' : 'Boards: messaging',
        body: fi
          ? 'Boardit toimivat viestintäkanavina. Sovelluksesi voi luoda tauluja kommenteille, ilmoituksille tai chat-viestinnälle.'
          : 'Boards work as messaging channels. Your app can create boards for comments, notifications, or chat messaging.',
        code: `// Create a board
apiFetch("/v1/boards", {
  method: "POST",
  body: JSON.stringify({
    name: "app-comments",
    description: "User comments",
    visibility: "public"
  })
})
.then(function(resp) { console.log("Board ID:", resp.data.id); });

// Post a message to a board
apiFetch("/v1/boards/BOARD_ID/posts", {
  method: "POST",
  body: JSON.stringify({
    title: "Hello!",
    body: "This is my first post.",
    format: "text"
  })
});

// Read messages
fetch(NODE + '/v1/boards/BOARD_ID/posts')
.then(function(r) { return r.json(); })
.then(function(data) {
  data.data.forEach(function(post) {
    console.log(post.title + ': ' + post.body);
  });
});
<\/script>`,
      },
      {
        heading: fi ? 'Täydellinen sovelluspohja' : 'Complete app template',
        body: fi
          ? 'Kopioi tämä pohja AI-chattiisi ja kerro mitä haluat rakentaa. AI osaa laajentaa sen valmiiksi sovellukseksi, joka käyttää AIMEAT:ia backendina. Tee siitä ladattava HTML-tiedosto.'
          : 'Copy this template to your AI chat and tell it what you want to build. The AI can expand it into a complete app that uses AIMEAT as a backend. Make it a single downloadable HTML file.',
        code: `<!DOCTYPE html>
<html>
<head>
  <title>My AIMEAT App</title>
  <script src="${nodeUrl}/v1/libs/aimeat-auth.js"><\/script>
  <style>
    body { font-family: sans-serif; max-width: 700px; margin: 0 auto; padding: 1rem; background: #111; color: #eee; }
    button { padding: 0.5rem 1rem; background: #ff69b4; color: #fff; border: none; border-radius: 4px; cursor: pointer; margin: 0.25rem; }
    input, textarea { width: 100%; padding: 0.5rem; margin: 0.25rem 0; background: #222; color: #eee; border: 1px solid #333; border-radius: 4px; box-sizing: border-box; }
    .item { background: rgba(255,255,255,0.05); padding: 0.75rem; margin: 0.5rem 0; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>My Notes App</h1>
  <div id="auth"></div>
  <p id="loginMsg">Kirjaudu sisään / Log in to start</p>
  <div id="app">
    <textarea id="noteText" rows="4" placeholder="Write a note..."></textarea>
    <button onclick="saveNote()">Save note</button>
    <button onclick="loadNotes()">Refresh</button>
    <div id="notes"></div>
  </div>

  <script>
    var NODE = '${nodeUrl}';
    var TOKEN = null;

    document.addEventListener("DOMContentLoaded", function() {
      AIMEAT.auth.mountLoginButton('#auth', {
        nodeUrl: NODE,
        onLogin: function(session) {
          TOKEN = session.jwt;
          var msg = document.getElementById('loginMsg');
          if (msg) msg.style.display = 'none';
          loadNotes();
        }
      });
      // Auto-restore session if user is already logged in
      AIMEAT.auth.login().then(function(session) {
        if (session) {
          TOKEN = session.jwt;
          var msg = document.getElementById('loginMsg');
          if (msg) msg.style.display = 'none';
          loadNotes();
        }
      });
    });

    function apiFetch(path, opts) {
      opts = opts || {};
      opts.headers = Object.assign({ 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, opts.headers || {});
      return fetch(NODE + path, opts).then(function(r) { return r.json(); });
    }

    function saveNote() {
      var text = document.getElementById('noteText').value.trim();
      if (!text) return;
      apiFetch('/v1/memory', {
        method: 'POST',
        body: JSON.stringify({
          key: 'note:' + Date.now(),
          value: { text: text, created: new Date().toISOString() },
          tags: ['note'],
          visibility: 'owner'
        })
      })
      .then(function(resp) {
        if (resp.ok) { document.getElementById('noteText').value = ''; loadNotes(); }
        else { alert('Error: ' + (resp.error ? resp.error.message : 'Unknown')); }
      });
    }

    function loadNotes() {
      apiFetch('/v1/memory/search?q=note')
      .then(function(resp) {
        var html = '';
        if (resp.ok && resp.data && resp.data.results) {
          resp.data.results.forEach(function(m) {
            html += '<div class="item">';
            html += '<p>' + m.value.text + '</p>';
            html += '<small style="color:#888">' + m.value.created + '</small>';
            html += '<button onclick="deleteNote(\\'' + m.key + '\\')">Delete</button>';
            html += '</div>';
          });
        }
        document.getElementById('notes').innerHTML = html || '<p>No notes yet.</p>';
      });
    }

    function deleteNote(key) {
      apiFetch('/v1/memory/' + encodeURIComponent(key), { method: 'DELETE' })
      .then(function() { loadNotes(); });
    }
  <\/script>
</body>
</html>

API reference for your AI:

Node URL: ${nodeUrl}
Auth: <script src="${nodeUrl}/v1/libs/aimeat-auth.js"><\/script>
Login: AIMEAT.auth.mountLoginButton("#auth", { nodeUrl: NODE, onLogin: function(session) { TOKEN = session.jwt; } })
Auth header for all API calls: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" }
Search memory: GET /v1/memory/search?q=QUERY → response.data.results = [{key, value, tags}, ...]
List memory keys: GET /v1/memory?tags=TAG → response.data.items = [{key, tags}, ...] (no values)
Read one entry: GET /v1/memory/KEY → response.data = {key, value, tags, ...}
Save to memory: POST /v1/memory body: {key, value, tags, visibility: "owner"|"public"|"private"}
Update: PUT /v1/memory/KEY body: {value, tags}
Delete: DELETE /v1/memory/KEY
Upload file: POST /v1/storage body: {key, data (base64), mimeType, visibility}
Public file URL (for <img> tags, no auth): GET /v1/pub/GAII/KEY
Boards: GET/POST /v1/boards, posts at /v1/boards/ID/posts
Stats: GET /v1/stats (public, no auth needed)`,
      },
    ],
  };
}

/* ── Page wrapper ── */
function renderGuidePage(
  config: AimeatConfig,
  locale: Locale,
  guide: GuideContent,
): string {
  const fi = locale === 'fi';
  const copyBtnLabel = fi ? 'Kopioi tämä sivu AI-chattiin' : 'Copy this page to your AI chat';
  const copyInstruction = fi
    ? 'Kopioi tämä sivu chattiisi ja kysy AI:lta mitä sinun täytyy tehdä askel askeleelta, koska se tuntee sinut ja ympäristösi paremmin.'
    : 'Copy this page to your AI chat and ask the AI what you need to do step by step, because it knows you and your environment better.';
  const copiedLabel = fi ? 'Kopioitu!' : 'Copied!';
  const backLabel = fi ? '\u2190 Takaisin etusivulle' : '\u2190 Back to home';
  const techWarning = fi
    ? '\u{1F9D1}\u200D\u{1F4BB} Seuraava osio on tarkoitettu tekniikkaan perehtyneille. Jos haluat nähdä yksityiskohtaisemmin miten hommat toimii, jatka lukemista.'
    : '\u{1F9D1}\u200D\u{1F4BB} The following section is for the technically curious. If you want to see in detail how things work, keep reading.';
  const otherLocale = fi ? 'en' : 'fi';
  const devLabel = fi ? 'Kehittäjille' : 'For Developers';

  // Build markdown version for copy
  let md = `# ${guide.title}\n\n`;
  md += `Node URL: ${config.baseUrl}\n\n`;
  md += `IMPORTANT: Make it a single downloadable HTML file.\n\n`;
  for (const s of guide.sections) {
    md += `## ${s.heading}\n\n${s.body}\n\n`;
    if (s.code) {
      md += '```\n' + s.code + '\n```\n\n';
    }
  }

  // Escape </script> so it doesn't break the inline <script> block
  const mdEscaped = JSON.stringify(md).replace(/<\//g, '<\\/');

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(guide.title)} | AIME AT</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0a0a1a;
  --bg-grad-top: #12082a;
  --bg-grad-mid: #0a0a1a;
  --card-bg: rgba(255, 255, 255, 0.04);
  --card-bg-hover: rgba(255, 255, 255, 0.07);
  --text: #e0e0e0;
  --text-bright: #ffffff;
  --text-dim: #888;
  --text-muted: #6b6b8a;
  --accent: #ff69b4;
  --accent-glow: rgba(255, 105, 180, 0.3);
  --success: #22c55e;
  --radius: 16px;
  --radius-sm: 10px;
  --radius-xs: 6px;
  --nav-height: 56px;
  --font: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

html { scroll-behavior: smooth; }

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  line-height: 1.7;
  min-height: 100vh;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

/* ── Animated background ── */
.bg-canvas {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 0%, var(--bg-grad-top) 0%, var(--bg-grad-mid) 60%, var(--bg) 100%);
}

.bg-canvas .star {
  position: absolute;
  width: 2px; height: 2px;
  border-radius: 50%;
  background: #fff;
  animation: twinkle ease-in-out infinite;
}

@keyframes twinkle {
  0%, 100% { opacity: 0.1; transform: scale(0.8); }
  50% { opacity: 0.8; transform: scale(1.2); box-shadow: 0 0 6px 1px rgba(255, 105, 180, 0.4); }
}

.bg-canvas .nebula {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.12;
  animation: nebulaDrift 20s ease-in-out infinite alternate;
}

@keyframes nebulaDrift {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(30px, -20px) scale(1.15); }
}

/* ── Top Navigation ── */
.topnav {
  position: sticky;
  top: 0;
  z-index: 100;
  height: var(--nav-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.25rem;
  background: rgba(10, 10, 26, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255, 105, 180, 0.1);
}

.topnav-brand {
  font-weight: 800;
  font-size: 1.05rem;
  color: var(--text-bright);
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  text-decoration: none;
}

.topnav-brand .heart {
  font-size: 1.1rem;
  filter: drop-shadow(0 0 4px rgba(255, 105, 180, 0.6));
  animation: heartPulse 2s ease-in-out infinite;
}

@keyframes heartPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}

.topnav-center {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 20px;
  padding: 0.2rem 0.25rem;
}

.lang-btn {
  padding: 0.25rem 0.65rem;
  border-radius: 16px;
  font-size: 0.78rem;
  font-weight: 700;
  text-decoration: none;
  color: var(--text-dim);
  transition: all 0.2s;
  letter-spacing: 0.04em;
}

.lang-btn.active {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 0 10px var(--accent-glow);
}

.lang-btn:not(.active):hover {
  color: var(--text-bright);
  background: rgba(255, 255, 255, 0.08);
}

.topnav-right a {
  font-size: 0.82rem;
  color: var(--text-dim);
  text-decoration: none;
  padding: 0.35rem 0.75rem;
  border-radius: var(--radius-xs);
  transition: all 0.2s;
  border: 1px solid transparent;
}

.topnav-right a:hover {
  color: var(--accent);
  border-color: rgba(255, 105, 180, 0.2);
  background: rgba(255, 105, 180, 0.05);
}

/* ── Guide content ── */
.guide-container {
  position: relative;
  z-index: 1;
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1.25rem 4rem;
}

.guide-back {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--accent);
  text-decoration: none;
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
  opacity: 0.8;
  transition: opacity 0.2s;
}
.guide-back:hover { opacity: 1; }

.guide-title {
  font-size: 2rem;
  font-weight: 800;
  color: var(--text-bright);
  margin-bottom: 0.5rem;
  line-height: 1.2;
}

.guide-intro {
  font-size: 1rem;
  color: var(--text);
  margin-bottom: 1.5rem;
  line-height: 1.7;
}

.guide-node {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 1.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 105, 180, 0.06);
  border: 1px solid rgba(255, 105, 180, 0.15);
  border-radius: var(--radius-sm);
  display: inline-block;
}
.guide-node code {
  color: var(--accent);
  font-size: 0.85rem;
}

/* ── Copy section (top) ── */
.guide-copy-section {
  padding: 1.5rem;
  background: rgba(34, 197, 94, 0.06);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: var(--radius);
  text-align: center;
  margin-bottom: 2rem;
}

.guide-copy-instruction {
  font-size: 0.95rem;
  color: #86efac;
  margin-bottom: 1rem;
  font-weight: 600;
}

.guide-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.75rem;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 1rem;
  font-weight: 700;
  font-family: var(--font);
  cursor: pointer;
  transition: all 0.25s;
  box-shadow: 0 4px 15px rgba(34, 197, 94, 0.25);
}

.guide-copy-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 25px rgba(34, 197, 94, 0.4);
}

.guide-copy-btn.copied {
  background: linear-gradient(135deg, #16a34a, #15803d);
}

/* ── Tech warning divider ── */
.tech-warning {
  margin: 2rem 0 2.5rem;
  padding: 1rem 1.25rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 0.9rem;
  line-height: 1.6;
  text-align: center;
}

/* ── Guide sections ── */
.guide-section {
  margin-bottom: 2.5rem;
}

.guide-section h2 {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text-bright);
  margin-bottom: 0.75rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.guide-section p {
  margin-bottom: 1rem;
  color: var(--text);
  font-size: 0.95rem;
}

.guide-code {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-sm);
  padding: 1rem 1.25rem;
  overflow-x: auto;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.82rem;
  line-height: 1.6;
  color: #c4c4d4;
  white-space: pre;
  margin-top: 0.75rem;
}

@media (max-width: 600px) {
  .guide-title { font-size: 1.5rem; }
  .guide-section h2 { font-size: 1.1rem; }
  .guide-code { font-size: 0.75rem; padding: 0.75rem; }
}
@media (max-width: 400px) {
  .topnav { padding: 0 0.75rem; }
}
</style>
</head>
<body>

<!-- Background -->
<div class="bg-canvas" id="bgCanvas">
  <div class="nebula" style="width:400px;height:400px;background:radial-gradient(circle,rgba(255,105,180,0.3),transparent);top:5%;left:10%;"></div>
  <div class="nebula" style="width:350px;height:350px;background:radial-gradient(circle,rgba(99,102,241,0.25),transparent);top:40%;right:5%;animation-delay:-8s;"></div>
  <div class="nebula" style="width:300px;height:300px;background:radial-gradient(circle,rgba(196,69,105,0.2),transparent);bottom:10%;left:30%;animation-delay:-14s;"></div>
</div>

<!-- Top Navigation -->
<nav class="topnav">
  <a href="/v1/portal" class="topnav-brand">
    <span class="heart">\u{1F496}</span> AIME AT
  </a>
  <div class="topnav-center">
    <a href="?lang=fi" class="lang-btn ${locale === 'fi' ? 'active' : ''}">${locale === 'fi' ? 'FI' : 'FI'}</a>
    <a href="?lang=en" class="lang-btn ${locale === 'en' ? 'active' : ''}">${locale === 'en' ? 'EN' : 'EN'}</a>
  </div>
  <div class="topnav-right">
    <a href="/v1/portal?view=dev${locale !== 'fi' ? '&lang=' + locale : ''}">${esc(devLabel)}</a>
  </div>
</nav>

<div class="guide-container">
  <a href="/v1/portal" class="guide-back">${esc(backLabel)}</a>
  <h1 class="guide-title">${esc(guide.title)}</h1>

  <!-- First section as intro (plain language) -->
  ${guide.sections.length > 0 ? `<p class="guide-intro">${esc(guide.sections[0].body)}</p>` : ''}

  <div class="guide-node">Node: <code>${esc(config.baseUrl)}</code></div>

  <!-- Copy button at top -->
  <div class="guide-copy-section">
    <div class="guide-copy-instruction">${esc(copyInstruction)}</div>
    <button class="guide-copy-btn" id="copyGuideBtn">\u{1F4CB} ${esc(copyBtnLabel)}</button>
  </div>

  <!-- Tech warning divider -->
  <div class="tech-warning">${esc(techWarning)}</div>

  <!-- Technical sections (skip first intro section) -->
${guide.sections.slice(1).map(s => `  <div class="guide-section">
    <h2>${esc(s.heading)}</h2>
    <p>${esc(s.body)}</p>
${s.code ? `    <div class="guide-code">${esc(s.code)}</div>` : ''}
  </div>`).join('\n\n')}
</div>

<script>
(function() {
  'use strict';

  /* ── Language persistence ── */
  var LANG_KEY = 'aimeat-lang';
  var urlParams = new URLSearchParams(window.location.search);
  var langFromUrl = urlParams.get('lang');

  if (langFromUrl) {
    try { localStorage.setItem(LANG_KEY, langFromUrl); } catch(e) {}
    document.cookie = LANG_KEY + '=' + langFromUrl + ';path=/;max-age=31536000;SameSite=Lax';
  }

  /* ── Starfield background ── */
  var canvas = document.getElementById('bgCanvas');
  if (canvas) {
    for (var i = 0; i < 60; i++) {
      var star = document.createElement('div');
      star.className = 'star';
      star.style.left = (Math.random() * 100) + '%';
      star.style.top = (Math.random() * 100) + '%';
      star.style.animationDuration = (2 + Math.random() * 4) + 's';
      star.style.animationDelay = (Math.random() * 4) + 's';
      star.style.width = star.style.height = (1 + Math.random() * 2) + 'px';
      canvas.appendChild(star);
    }
  }

  /* ── Copy button ── */
  var md = ${mdEscaped};
  var btn = document.getElementById('copyGuideBtn');

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function() { return fallbackCopy(text); });
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  if (btn) {
    btn.addEventListener('click', function() {
      copyToClipboard(md).then(function() {
        btn.textContent = '\\u2714 ${jesc(copiedLabel)}';
        btn.classList.add('copied');
        setTimeout(function() {
          btn.textContent = '\\uD83D\\uDCCB ${jesc(copyBtnLabel)}';
          btn.classList.remove('copied');
        }, 2000);
      });
    });
  }
})();
<\/script>
</body>
</html>`;
}

/* ── Router ── */

const GUIDES: Record<string, GuideGenerator> = {
  'ai-news': guideAiNews,
  'monitor': guideMonitor,
  'multi-agent': guideMultiAgent,
  'directory': guideDirectory,
  'build-apps': guideBuildApps,
};

export function guidesRouter(config: AimeatConfig): Router {
  const router = Router();

  router.get('/v1/guide/:slug', (req: Request, res: Response) => {
    const slug = req.params.slug as string;
    const generator = GUIDES[slug];
    if (!generator) {
      res.status(404).type('text/plain').send('Guide not found');
      return;
    }

    const langParam = req.query.lang as string | undefined;
    const locale = resolveLocale(langParam, req.headers.cookie, req.headers['accept-language'] as string | undefined);
    if (langParam) res.cookie('aimeat-lang', locale, { maxAge: 365 * 24 * 60 * 60 * 1000, path: '/', sameSite: 'lax' });
    const t = createT(locale);
    const guide = generator(config.baseUrl, locale, t);
    const html = renderGuidePage(config, locale, guide);
    res.type('html').send(html);
  });

  return router;
}
