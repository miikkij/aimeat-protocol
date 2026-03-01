import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { DirectoryService, DirectoryEntry } from '../services/directory.js';
import { requireAuth } from '../auth/middleware.js';

/* ──────────────────────────────────────────────────────────
   Hobby Directory Portal — Phase 1.6
   Finnish-first, mobile-first, AIMEAT design system
   ────────────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Shared CSS (AIMEAT design system) ───────────────────────

const sharedCss = `
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0a0a1a;
  --bg-grad-top: #12082a;
  --bg-grad-mid: #0a0a1a;
  --card-bg: rgba(255, 255, 255, 0.04);
  --card-bg-hover: rgba(255, 255, 255, 0.07);
  --card-border: rgba(255, 105, 180, 0.15);
  --card-border-hover: rgba(255, 105, 180, 0.4);
  --card-glow: rgba(255, 105, 180, 0.08);
  --accent: #ff69b4;
  --accent-bright: #ff8ecf;
  --accent-deep: #c44569;
  --accent-glow: rgba(255, 105, 180, 0.3);
  --text: #e0e0e0;
  --text-bright: #ffffff;
  --text-dim: #888;
  --text-muted: #6b6b8a;
  --success: #22c55e;
  --success-bg: rgba(34, 197, 94, 0.1);
  --success-border: rgba(34, 197, 94, 0.3);
  --radius: 16px;
  --radius-sm: 10px;
  --radius-xs: 6px;
  --font: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

html { scroll-behavior: smooth; }

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  line-height: 1.65;
  min-height: 100vh;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

.bg-canvas {
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 0; pointer-events: none;
  background: radial-gradient(ellipse at 50% 0%, var(--bg-grad-top) 0%, var(--bg-grad-mid) 60%, var(--bg) 100%);
}

.container {
  position: relative; z-index: 1;
  max-width: 900px; margin: 0 auto;
  padding: 24px 16px 80px;
}

/* ── Navigation ── */
.nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0; margin-bottom: 24px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.nav-brand { color: var(--accent); font-weight: 700; font-size: 1rem; text-decoration: none; letter-spacing: 0.05em; }
.nav-brand:hover { color: var(--accent-bright); }
.nav-links { display: flex; gap: 16px; align-items: center; }
.nav-links a { color: var(--text-dim); text-decoration: none; font-size: 0.85rem; transition: color 0.2s; }
.nav-links a:hover { color: var(--accent); }

/* ── Page title ── */
.page-title {
  font-size: 1.8rem; font-weight: 700;
  background: linear-gradient(135deg, var(--accent), var(--accent-bright));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text; margin-bottom: 8px;
}
.page-subtitle { color: var(--text-dim); font-size: 1rem; margin-bottom: 32px; }

/* ── Cards ── */
.card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
  padding: 24px;
  margin-bottom: 16px;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
}
.card:hover {
  background: var(--card-bg-hover);
  border-color: var(--card-border-hover);
  box-shadow: 0 0 20px var(--card-glow);
}
.card-title { font-size: 1.1rem; font-weight: 600; color: var(--text-bright); margin-bottom: 8px; }
.card-meta { color: var(--text-dim); font-size: 0.85rem; margin-bottom: 8px; }

/* ── Tags ── */
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.tag {
  display: inline-block;
  padding: 4px 12px;
  background: rgba(255, 105, 180, 0.12);
  border: 1px solid rgba(255, 105, 180, 0.25);
  border-radius: 20px;
  font-size: 0.8rem; color: var(--accent-bright);
  white-space: nowrap;
}
.tag-shared {
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.3);
  color: var(--success);
}

/* ── Buttons ── */
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 10px 24px;
  border: none; border-radius: var(--radius-sm);
  font-size: 0.9rem; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
  text-decoration: none;
}
.btn-primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: #fff;
}
.btn-primary:hover { opacity: 0.9; box-shadow: 0 0 16px var(--accent-glow); }
.btn-secondary {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--text);
}
.btn-secondary:hover { background: rgba(255,255,255,0.1); border-color: var(--accent); color: var(--accent); }
.btn-danger {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
}
.btn-danger:hover { background: rgba(239, 68, 68, 0.25); }
.btn-sm { padding: 6px 14px; font-size: 0.8rem; }

/* ── Forms ── */
.form-group { margin-bottom: 16px; }
.form-label { display: block; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 6px; font-weight: 500; }
.form-input, .form-textarea, .form-select {
  width: 100%; padding: 10px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: var(--radius-sm);
  color: var(--text); font-size: 0.9rem;
  font-family: var(--font);
  transition: border-color 0.2s;
}
.form-input:focus, .form-textarea:focus, .form-select:focus {
  outline: none; border-color: var(--accent);
}
.form-textarea { min-height: 80px; resize: vertical; }
.form-select { appearance: auto; }
.form-hint { font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; }

/* ── Pagination ── */
.pagination { display: flex; gap: 8px; justify-content: center; margin-top: 24px; }
.pagination a {
  padding: 8px 16px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  color: var(--text); text-decoration: none; font-size: 0.85rem;
}
.pagination a:hover { border-color: var(--accent); color: var(--accent); }
.pagination .active { border-color: var(--accent); color: var(--accent); background: rgba(255,105,180,0.1); }

/* ── Facets ── */
.facets { margin-bottom: 24px; }
.facet-group { margin-bottom: 12px; }
.facet-label { font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.facet-items { display: flex; flex-wrap: wrap; gap: 6px; }
.facet-item {
  padding: 4px 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px;
  font-size: 0.78rem; color: var(--text-dim);
  text-decoration: none; transition: all 0.2s;
}
.facet-item:hover { border-color: var(--accent); color: var(--accent); }
.facet-count { color: var(--text-muted); margin-left: 4px; }

/* ── Profile detail ── */
.profile-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.profile-avatar { font-size: 2.5rem; }
.profile-name { font-size: 1.5rem; font-weight: 700; color: var(--text-bright); }
.profile-ghii { font-size: 0.85rem; color: var(--text-muted); font-family: monospace; }
.profile-section { margin-bottom: 20px; }
.profile-section-label { font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.profile-bio { color: var(--text); line-height: 1.7; }
.profile-detail { color: var(--text-dim); font-size: 0.9rem; }

/* ── Stats grid ── */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 32px; }
.stat-card {
  background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-sm);
  padding: 16px; text-align: center;
}
.stat-value { font-size: 1.5rem; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; }

/* ── Categories grid ── */
.categories-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 32px; }
.category-card {
  background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius);
  padding: 20px; text-align: center; text-decoration: none;
  transition: all 0.2s; cursor: pointer;
}
.category-card:hover { background: var(--card-bg-hover); border-color: var(--card-border-hover); box-shadow: 0 0 16px var(--card-glow); }
.category-icon { font-size: 2rem; margin-bottom: 8px; }
.category-name { font-size: 0.95rem; font-weight: 600; color: var(--text-bright); }
.category-count { font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; }

/* ── Empty state ── */
.empty-state { text-align: center; padding: 48px 16px; }
.empty-icon { font-size: 3rem; margin-bottom: 16px; opacity: 0.4; }
.empty-text { color: var(--text-dim); font-size: 1rem; }

/* ── Alert / message ── */
.alert {
  padding: 12px 16px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.9rem;
}
.alert-success { background: var(--success-bg); border: 1px solid var(--success-border); color: var(--success); }
.alert-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; }

/* ── Hidden profile ── */
.hidden-profile { opacity: 0.5; pointer-events: none; }

/* ── Responsive ── */
@media (max-width: 600px) {
  .page-title { font-size: 1.4rem; }
  .container { padding: 16px 12px 60px; }
  .categories-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
}
`;

// ── Shared HTML layout wrapper ───────────────────────────

function layoutHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="fi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — AIME AT Harrastehakemisto</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${sharedCss}</style>
</head>
<body>
<div class="bg-canvas"></div>
<div class="container">
  <nav class="nav">
    <a href="/v1/portal/human/hobbies" class="nav-brand">AIME AT Harrasteet</a>
    <div class="nav-links">
      <a href="/v1/portal/human/hobbies/search">Haku</a>
      <a href="/v1/portal/human/hobbies/join">Liity</a>
      <a href="/v1/portal/human">Portaali</a>
    </div>
  </nav>
  ${bodyHtml}
</div>
</body>
</html>`;
}

// ── Hobby category mapping ──────────────────────────────

interface HobbyCategory {
  key: string;
  icon: string;
  name: string;
}

const HOBBY_CATEGORIES: HobbyCategory[] = [
  { key: 'liikunta', icon: '\u26BD', name: 'Liikunta & Urheilu' },
  { key: 'musiikki', icon: '\uD83C\uDFB5', name: 'Musiikki' },
  { key: 'taide', icon: '\uD83C\uDFA8', name: 'Taide & Askartelu' },
  { key: 'teknologia', icon: '\uD83D\uDCBB', name: 'Teknologia' },
  { key: 'luonto', icon: '\uD83C\uDF3F', name: 'Luonto & Retkeily' },
  { key: 'ruoka', icon: '\uD83C\uDF73', name: 'Ruoka & Kokkaus' },
  { key: 'pelit', icon: '\uD83C\uDFAE', name: 'Pelit' },
  { key: 'kirjallisuus', icon: '\uD83D\uDCDA', name: 'Kirjallisuus' },
  { key: 'valokuvaus', icon: '\uD83D\uDCF7', name: 'Valokuvaus' },
  { key: 'puutarha', icon: '\uD83C\uDF31', name: 'Puutarhanhoito' },
  { key: 'matkailu', icon: '\u2708\uFE0F', name: 'Matkailu' },
  { key: 'muu', icon: '\u2728', name: 'Muu' },
];

// ── Availability labels ─────────────────────────────────

const AVAILABILITY_LABELS: Record<string, string> = {
  anytime: 'Milloin vain',
  mornings: 'Aamut',
  evenings: 'Illat',
  weekends: 'Viikonloput',
  'evenings-weekends': 'Illat & viikonloput',
};

// ── Shared interests helper ─────────────────────────────

function countSharedInterests(a: string[], b: string[]): number {
  const lower = new Set(a.map(i => i.toLowerCase()));
  return b.filter(i => lower.has(i.toLowerCase())).length;
}

// ── Router ──────────────────────────────────────────────

export function portalHobbiesRouter(
  config: AimeatConfig,
  storage: Storage,
  directoryService: DirectoryService,
): Router {
  const router = Router();

  // ── GET /v1/portal/human/hobbies — Browse by category ──
  router.get('/v1/portal/human/hobbies', async (_req, res) => {
    try {
      const stats = directoryService.getStats();

      const categoryCards = HOBBY_CATEGORIES.map(cat => {
        const matchingCount = stats.topInterests
          .filter(i => i.name.toLowerCase().includes(cat.key))
          .reduce((sum, i) => sum + i.count, 0);
        return `
          <a href="/v1/portal/human/hobbies/search?interest=${encodeURIComponent(cat.key)}" class="category-card">
            <div class="category-icon">${cat.icon}</div>
            <div class="category-name">${esc(cat.name)}</div>
            ${matchingCount > 0 ? `<div class="category-count">${matchingCount} henkiloa</div>` : ''}
          </a>`;
      }).join('');

      const topInterestTags = stats.topInterests.slice(0, 12).map(i =>
        `<a href="/v1/portal/human/hobbies/search?interest=${encodeURIComponent(i.name)}" class="tag">${esc(i.name)} <span style="opacity:0.6">(${i.count})</span></a>`,
      ).join('');

      const topCityTags = stats.topCities.slice(0, 10).map(c =>
        `<a href="/v1/portal/human/hobbies/search?city=${encodeURIComponent(c.name)}" class="tag">${esc(c.name)} <span style="opacity:0.6">(${c.count})</span></a>`,
      ).join('');

      const body = `
        <h1 class="page-title">Harrastehakemisto</h1>
        <p class="page-subtitle">Loyda harrastuksia ja samanhenkisia ihmisia laheltasi</p>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${stats.totalPeople}</div>
            <div class="stat-label">Jasentae</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.topInterests.length}</div>
            <div class="stat-label">Harrastuksia</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.topCities.length}</div>
            <div class="stat-label">Kaupunkia</div>
          </div>
        </div>

        <h2 style="font-size:1.1rem; color:var(--text-bright); margin-bottom:16px;">Selaa kategorioittain</h2>
        <div class="categories-grid">${categoryCards}</div>

        ${topInterestTags ? `
        <div class="facets">
          <div class="facet-group">
            <div class="facet-label">Suosituimmat harrastukset</div>
            <div class="tags">${topInterestTags}</div>
          </div>
        </div>` : ''}

        ${topCityTags ? `
        <div class="facets">
          <div class="facet-group">
            <div class="facet-label">Suosituimmat kaupungit</div>
            <div class="tags">${topCityTags}</div>
          </div>
        </div>` : ''}

        <div style="text-align:center; margin-top:32px;">
          <a href="/v1/portal/human/hobbies/search" class="btn btn-primary" style="margin-right:8px;">Hae harrastajia</a>
          <a href="/v1/portal/human/hobbies/join" class="btn btn-secondary">Liity hakemistoon</a>
        </div>
      `;

      res.type('text/html').send(layoutHtml('Harrastehakemisto', body));
    } catch {
      res.type('text/html').send(layoutHtml('Virhe', '<div class="alert alert-error">Sivua ei voitu ladata.</div>'));
    }
  });

  // ── GET /v1/portal/human/hobbies/search — Search ──
  router.get('/v1/portal/human/hobbies/search', async (req, res) => {
    try {
      const interest = (req.query.interest as string | undefined)?.trim() || undefined;
      const city = (req.query.city as string | undefined)?.trim() || undefined;
      const area = (req.query.area as string | undefined)?.trim() || undefined;
      const page = Math.max(1, parseInt(req.query.page as string || '1', 10) || 1);
      const perPage = 20;

      const results = await directoryService.search({
        interest,
        city,
        area,
        page,
        perPage,
      });

      // Determine viewer's interests for shared interest badges
      let viewerInterests: string[] = [];
      if (req.auth?.sub) {
        try {
          const ghii = await storage.getGHIIByOwner(req.auth.owner ?? '');
          if (ghii) {
            const viewerEntry = (await directoryService.search({ perPage: 10000 })).entries.find(e => e.ghii === ghii.ghii);
            if (viewerEntry) viewerInterests = viewerEntry.interests;
          }
        } catch { /* ignore */ }
      }

      // Build result cards
      const entryCards = await Promise.all(results.entries.map(async (entry) => {
        // Check flag count for auto-hide
        const flagSummary = await storage.getFlagSummary('agent', entry.ghii);
        const isHidden = (flagSummary?.totalFlags ?? 0) >= 5;

        if (isHidden) {
          return `<div class="card hidden-profile">
            <div class="card-title" style="opacity:0.4;">Profiili piilotettu</div>
            <div class="card-meta">Tama profiili on piilotettu yhteison ilmoitusten perusteella.</div>
          </div>`;
        }

        const shared = viewerInterests.length > 0
          ? countSharedInterests(viewerInterests, entry.interests)
          : 0;

        const interestTags = entry.interests.map(i => {
          const isShared = viewerInterests.some(vi => vi.toLowerCase() === i.toLowerCase());
          return `<span class="tag${isShared ? ' tag-shared' : ''}">${esc(i)}</span>`;
        }).join('');

        const locationParts: string[] = [];
        if (entry.city) locationParts.push(entry.city);
        if (entry.area) locationParts.push(entry.area);
        const locationStr = locationParts.length > 0 ? locationParts.join(', ') : '';

        return `
          <a href="/v1/portal/human/hobbies/profile/${encodeURIComponent(entry.ghii)}" class="card" style="display:block; text-decoration:none; color:inherit;">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
              <span style="font-size:1.5rem;">${entry.avatar ? esc(entry.avatar) : '\uD83D\uDE0A'}</span>
              <div>
                <div class="card-title">${esc(entry.displayName)}</div>
                ${locationStr ? `<div class="card-meta">${esc(locationStr)}</div>` : ''}
              </div>
              ${shared > 0 ? `<span class="tag tag-shared" style="margin-left:auto;">${shared} yhteista</span>` : ''}
            </div>
            <div class="tags">${interestTags}</div>
          </a>`;
      }));

      // Facets
      const cityFacets = results.facets.cities.slice(0, 10).map(c =>
        `<a href="/v1/portal/human/hobbies/search?city=${encodeURIComponent(c.name)}${interest ? '&interest=' + encodeURIComponent(interest) : ''}" class="facet-item">${esc(c.name)}<span class="facet-count">(${c.count})</span></a>`,
      ).join('');

      const interestFacets = results.facets.interests.slice(0, 15).map(i =>
        `<a href="/v1/portal/human/hobbies/search?interest=${encodeURIComponent(i.name)}${city ? '&city=' + encodeURIComponent(city) : ''}" class="facet-item">${esc(i.name)}<span class="facet-count">(${i.count})</span></a>`,
      ).join('');

      // Pagination
      const totalPages = Math.ceil(results.total / perPage);
      let paginationHtml = '';
      if (totalPages > 1) {
        const params = new URLSearchParams();
        if (interest) params.set('interest', interest);
        if (city) params.set('city', city);
        if (area) params.set('area', area);

        const links: string[] = [];
        if (page > 1) {
          params.set('page', String(page - 1));
          links.push(`<a href="/v1/portal/human/hobbies/search?${params.toString()}">Edellinen</a>`);
        }
        for (let p = 1; p <= Math.min(totalPages, 5); p++) {
          params.set('page', String(p));
          links.push(`<a href="/v1/portal/human/hobbies/search?${params.toString()}" class="${p === page ? 'active' : ''}">${p}</a>`);
        }
        if (page < totalPages) {
          params.set('page', String(page + 1));
          links.push(`<a href="/v1/portal/human/hobbies/search?${params.toString()}">Seuraava</a>`);
        }
        paginationHtml = `<div class="pagination">${links.join('')}</div>`;
      }

      const body = `
        <h1 class="page-title">Hae harrastajia</h1>
        <p class="page-subtitle">Etsi samanhenkisia ihmisia kiinnostuksen tai sijainnin perusteella</p>

        <form method="get" action="/v1/portal/human/hobbies/search" class="card" style="margin-bottom:24px;">
          <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end;">
            <div class="form-group" style="flex:1; min-width:200px; margin-bottom:0;">
              <label class="form-label" for="interest">Kiinnostus</label>
              <input class="form-input" type="text" id="interest" name="interest" value="${escAttr(interest ?? '')}" placeholder="esim. koodaus, pyoraily...">
            </div>
            <div class="form-group" style="flex:1; min-width:150px; margin-bottom:0;">
              <label class="form-label" for="city">Kaupunki</label>
              <input class="form-input" type="text" id="city" name="city" value="${escAttr(city ?? '')}" placeholder="esim. Helsinki">
            </div>
            <div class="form-group" style="flex:0; min-width:150px; margin-bottom:0;">
              <label class="form-label" for="area">Alue</label>
              <input class="form-input" type="text" id="area" name="area" value="${escAttr(area ?? '')}" placeholder="esim. Kallio">
            </div>
            <button type="submit" class="btn btn-primary btn-sm">Hae</button>
          </div>
        </form>

        <div style="display:flex; gap:24px; flex-wrap:wrap;">
          ${cityFacets || interestFacets ? `
          <div class="facets" style="min-width:160px; flex:0 0 auto;">
            ${interestFacets ? `
            <div class="facet-group">
              <div class="facet-label">Harrastukset</div>
              <div class="facet-items">${interestFacets}</div>
            </div>` : ''}
            ${cityFacets ? `
            <div class="facet-group">
              <div class="facet-label">Kaupungit</div>
              <div class="facet-items">${cityFacets}</div>
            </div>` : ''}
          </div>` : ''}

          <div style="flex:1; min-width:0;">
            <div style="color:var(--text-dim); font-size:0.85rem; margin-bottom:12px;">
              ${results.total} tulosta
              ${interest ? ` kiinnostukselle "${esc(interest)}"` : ''}
              ${city ? ` kaupungissa ${esc(city)}` : ''}
            </div>

            ${entryCards.length > 0 ? entryCards.join('') : `
              <div class="empty-state">
                <div class="empty-icon">\uD83D\uDD0D</div>
                <div class="empty-text">Ei tuloksia. Kokeile eri hakuehtoja tai <a href="/v1/portal/human/hobbies/join" style="color:var(--accent);">liity hakemistoon</a>!</div>
              </div>
            `}

            ${paginationHtml}
          </div>
        </div>
      `;

      res.type('text/html').send(layoutHtml('Hae harrastajia', body));
    } catch {
      res.type('text/html').send(layoutHtml('Virhe', '<div class="alert alert-error">Hakua ei voitu suorittaa.</div>'));
    }
  });

  // ── GET /v1/portal/human/hobbies/profile/:ghii — Profile view ──
  router.get('/v1/portal/human/hobbies/profile/:ghii', async (req, res) => {
    try {
      const ghii = req.params.ghii as string;

      // Look up in directory index
      const searchResult = await directoryService.search({ perPage: 10000 });
      const entry = searchResult.entries.find(e => e.ghii === ghii);

      if (!entry) {
        const body = `
          <div class="empty-state">
            <div class="empty-icon">\uD83D\uDE15</div>
            <div class="empty-text">Profiilia ei loytynyt.</div>
            <a href="/v1/portal/human/hobbies/search" class="btn btn-secondary" style="margin-top:16px;">Takaisin hakuun</a>
          </div>`;
        res.type('text/html').send(layoutHtml('Profiilia ei loytynyt', body));
        return;
      }

      // Check if hidden by flags
      const flagSummary = await storage.getFlagSummary('agent', ghii);
      const isHidden = (flagSummary?.totalFlags ?? 0) >= 5;

      if (isHidden) {
        const body = `
          <div class="empty-state">
            <div class="empty-icon">\uD83D\uDEAB</div>
            <div class="empty-text">Tama profiili on piilotettu yhteison ilmoitusten perusteella.</div>
            <a href="/v1/portal/human/hobbies/search" class="btn btn-secondary" style="margin-top:16px;">Takaisin hakuun</a>
          </div>`;
        res.type('text/html').send(layoutHtml('Profiili piilotettu', body));
        return;
      }

      // Load GHII record for extra details
      const ghiiRecord = await storage.getGHII(ghii);

      // Load availability and seeking from memory
      let availability: string | undefined;
      let seeking: string[] = [];
      if (ghiiRecord) {
        const agents = await storage.getAgentsByOwner(ghiiRecord.ownerName);
        for (const agent of agents) {
          const avMem = await storage.getMemory(agent.gaii, `profile.${ghiiRecord.username}.availability`);
          if (avMem?.value && typeof avMem.value === 'string') {
            availability = avMem.value;
          } else if (avMem?.value && typeof avMem.value === 'object' && avMem.value !== null) {
            const v = avMem.value as Record<string, unknown>;
            if (typeof v.availability === 'string') availability = v.availability;
          }
          const seekMem = await storage.getMemory(agent.gaii, `profile.${ghiiRecord.username}.seeking`);
          if (seekMem?.value && Array.isArray(seekMem.value)) {
            seeking = seekMem.value as string[];
          } else if (seekMem?.value && typeof seekMem.value === 'object' && seekMem.value !== null) {
            const v = seekMem.value as Record<string, unknown>;
            if (Array.isArray(v.items)) seeking = v.items as string[];
          }
          if (availability || seeking.length > 0) break;
        }
      }

      // Viewer shared interests
      let viewerInterests: string[] = [];
      let sharedCount = 0;
      if (req.auth?.sub) {
        try {
          const viewerGhii = await storage.getGHIIByOwner(req.auth.owner ?? '');
          if (viewerGhii) {
            const viewerEntry = searchResult.entries.find(e => e.ghii === viewerGhii.ghii);
            if (viewerEntry) {
              viewerInterests = viewerEntry.interests;
              sharedCount = countSharedInterests(viewerInterests, entry.interests);
            }
          }
        } catch { /* ignore */ }
      }

      const interestTags = entry.interests.map(i => {
        const isShared = viewerInterests.some(vi => vi.toLowerCase() === i.toLowerCase());
        return `<span class="tag${isShared ? ' tag-shared' : ''}">${esc(i)}</span>`;
      }).join('');

      const locationParts: string[] = [];
      if (entry.city) locationParts.push(entry.city);
      if (entry.area) locationParts.push(entry.area);
      if (entry.country) locationParts.push(entry.country);
      const locationStr = locationParts.join(', ');

      const seekingTags = seeking.map(s => `<span class="tag">${esc(s)}</span>`).join('');

      // Flag button (only for authenticated users, not own profile)
      let flagHtml = '';
      if (req.auth?.sub) {
        const viewerGhii = await storage.getGHIIByOwner(req.auth.owner ?? '');
        const isOwnProfile = viewerGhii?.ghii === ghii;
        if (!isOwnProfile) {
          flagHtml = `
            <div style="margin-top:24px; padding-top:16px; border-top:1px solid rgba(255,255,255,0.06);">
              <button onclick="flagProfile()" class="btn btn-danger btn-sm">Ilmianna profiili</button>
              <div id="flagResult" style="margin-top:8px;"></div>
              <script>
              function flagProfile() {
                var reason = prompt('Syy ilmiantoon (unreliable, inappropriate, spam, other):');
                if (!reason) return;
                var validReasons = ['unreliable', 'inappropriate', 'illegal', 'spam', 'other'];
                if (validReasons.indexOf(reason) === -1) reason = 'other';
                fetch('/v1/flags', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + (localStorage.getItem('aimeat-token') || '')
                  },
                  body: JSON.stringify({
                    target_type: 'agent',
                    target_id: '${ghii.replace(/'/g, "\\'")}',
                    reason: reason
                  })
                }).then(function(r) { return r.json(); })
                  .then(function(data) {
                    document.getElementById('flagResult').innerHTML = data.ok
                      ? '<span style="color:var(--success);">Ilmianto lahetetty.</span>'
                      : '<span style="color:#ef4444;">' + (data.error?.message || 'Virhe') + '</span>';
                  })
                  .catch(function() {
                    document.getElementById('flagResult').innerHTML = '<span style="color:#ef4444;">Verkkovirhe.</span>';
                  });
              }
              </script>
            </div>`;
        }
      }

      const body = `
        <div class="profile-header">
          <span class="profile-avatar">${entry.avatar ? esc(entry.avatar) : '\uD83D\uDE0A'}</span>
          <div>
            <div class="profile-name">${esc(entry.displayName)}</div>
            <div class="profile-ghii">${esc(ghii)}</div>
          </div>
          ${sharedCount > 0 ? `<span class="tag tag-shared" style="margin-left:auto; font-size:0.9rem;">${sharedCount} yhteista kiinnostusta</span>` : ''}
        </div>

        ${entry.bio ? `
        <div class="profile-section">
          <div class="profile-section-label">Kuvaus</div>
          <div class="profile-bio">${esc(entry.bio)}</div>
        </div>` : ''}

        <div class="profile-section">
          <div class="profile-section-label">Kiinnostukset</div>
          <div class="tags">${interestTags}</div>
        </div>

        ${locationStr ? `
        <div class="profile-section">
          <div class="profile-section-label">Sijainti</div>
          <div class="profile-detail">${esc(locationStr)}</div>
        </div>` : ''}

        ${availability ? `
        <div class="profile-section">
          <div class="profile-section-label">Saatavuus</div>
          <div class="profile-detail">${esc(AVAILABILITY_LABELS[availability] ?? availability)}</div>
        </div>` : ''}

        ${seeking.length > 0 ? `
        <div class="profile-section">
          <div class="profile-section-label">Etsii</div>
          <div class="tags">${seekingTags}</div>
        </div>` : ''}

        ${flagHtml}

        <div style="margin-top:24px;">
          <a href="/v1/portal/human/hobbies/search" class="btn btn-secondary">Takaisin hakuun</a>
        </div>
      `;

      res.type('text/html').send(layoutHtml(entry.displayName, body));
    } catch {
      res.type('text/html').send(layoutHtml('Virhe', '<div class="alert alert-error">Profiilia ei voitu ladata.</div>'));
    }
  });

  // ── GET /v1/portal/human/hobbies/join — Join form ──
  router.get('/v1/portal/human/hobbies/join', async (req, res) => {
    try {
      const body = `
        <h1 class="page-title">Liity hakemistoon</h1>
        <p class="page-subtitle">Luo profiili ja loyda samanhenkisia ihmisia</p>

        <div id="authNotice" class="alert alert-error" style="display:none;">
          Kirjaudu sisaan liittyaksesi. <a href="/v1/portal/human" style="color:var(--accent);">Kirjaudu tai rekisteroidy tasta.</a>
        </div>

        <form id="joinForm" class="card" style="display:none;">
          <div class="form-group">
            <label class="form-label" for="interests">Kiinnostukset *</label>
            <input class="form-input" type="text" id="interests" name="interests" placeholder="esim. koodaus, pyoraily, musiikki" required>
            <div class="form-hint">Erota pilkuilla. Vahintaan yksi.</div>
          </div>
          <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <div class="form-group" style="flex:1; min-width:150px;">
              <label class="form-label" for="joinCity">Kaupunki *</label>
              <input class="form-input" type="text" id="joinCity" name="city" placeholder="esim. Helsinki" required>
            </div>
            <div class="form-group" style="flex:0 0 100px;">
              <label class="form-label" for="joinCountry">Maa</label>
              <input class="form-input" type="text" id="joinCountry" name="country" value="FI" placeholder="FI">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="bio">Kuvaus</label>
            <textarea class="form-textarea" id="bio" name="bio" placeholder="Kerro itsestasi..." maxlength="500"></textarea>
            <div class="form-hint">Enintaan 500 merkkia.</div>
          </div>
          <div class="form-group">
            <label class="form-label" for="availability">Saatavuus</label>
            <select class="form-select" id="availability" name="availability">
              <option value="">Ei valittu</option>
              <option value="anytime">Milloin vain</option>
              <option value="mornings">Aamut</option>
              <option value="evenings">Illat</option>
              <option value="weekends">Viikonloput</option>
              <option value="evenings-weekends">Illat & viikonloput</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="seeking">Etsii (valinnainen)</label>
            <input class="form-input" type="text" id="seeking" name="seeking" placeholder="esim. harjoituskaveri, tiimijasenia">
            <div class="form-hint">Erota pilkuilla.</div>
          </div>
          <div style="margin-top:8px; margin-bottom:16px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.85rem; color:var(--text-dim);">
              <input type="checkbox" id="consentCheck" required>
              Hyvaksyn, etta profiilini nakyy hakemistossa (community-discovery).
            </label>
          </div>
          <button type="submit" class="btn btn-primary">Liity hakemistoon</button>
          <div id="joinResult" style="margin-top:12px;"></div>
        </form>

        <div id="joinSuccess" class="card" style="display:none;">
          <div class="alert alert-success">Profiilisi on luotu! Se nakyy hakemistossa, kun hakemisto paivitetaan seuraavan kerran.</div>
          <a href="/v1/portal/human/hobbies/search" class="btn btn-primary" style="margin-top:12px;">Selaa hakemistoa</a>
        </div>

        <script>
        (function() {
          var token = localStorage.getItem('aimeat-token');
          var gaii = localStorage.getItem('aimeat-gaii');
          var owner = localStorage.getItem('aimeat-owner');

          if (!token || !gaii || !owner) {
            document.getElementById('authNotice').style.display = 'block';
            return;
          }

          document.getElementById('joinForm').style.display = 'block';

          document.getElementById('joinForm').addEventListener('submit', function(e) {
            e.preventDefault();
            var resultEl = document.getElementById('joinResult');
            resultEl.innerHTML = '<span style="color:var(--text-dim);">Tallennetaan...</span>';

            var interests = document.getElementById('interests').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
            var city = document.getElementById('joinCity').value.trim();
            var country = document.getElementById('joinCountry').value.trim() || 'FI';
            var bio = document.getElementById('bio').value.trim();
            var availability = document.getElementById('availability').value;
            var seeking = document.getElementById('seeking').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);

            if (interests.length === 0) {
              resultEl.innerHTML = '<span style="color:#ef4444;">Lisaa vahintaan yksi kiinnostus.</span>';
              return;
            }
            if (!city) {
              resultEl.innerHTML = '<span style="color:#ef4444;">Kaupunki on pakollinen.</span>';
              return;
            }

            var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

            // Step 1: Create consent grant
            fetch('/v1/consent', {
              method: 'POST',
              headers: headers,
              body: JSON.stringify({
                data_pattern: 'profile.**',
                recipient: '*',
                purpose: 'community-discovery',
                scope: 'federation'
              })
            }).then(function(r) { return r.json(); })
            .then(function(consentData) {
              if (!consentData.ok) {
                // Consent might already exist, continue anyway
              }

              // Step 2: Write profile interests to memory
              var username = owner;
              var memPromises = [];

              memPromises.push(fetch('/v1/memory/profile.' + encodeURIComponent(username) + '.interests', {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify({ value: interests, visibility: 'public', tags: ['profile', 'interests'] })
              }));

              memPromises.push(fetch('/v1/memory/profile.' + encodeURIComponent(username) + '.location', {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify({ value: { city: city, country: country }, visibility: 'public', tags: ['profile', 'location'] })
              }));

              if (bio) {
                memPromises.push(fetch('/v1/memory/profile.' + encodeURIComponent(username) + '.bio', {
                  method: 'PUT',
                  headers: headers,
                  body: JSON.stringify({ value: bio, visibility: 'public', tags: ['profile', 'bio'] })
                }));
              }

              if (availability) {
                memPromises.push(fetch('/v1/memory/profile.' + encodeURIComponent(username) + '.availability', {
                  method: 'PUT',
                  headers: headers,
                  body: JSON.stringify({ value: availability, visibility: 'public', tags: ['profile', 'availability'] })
                }));
              }

              if (seeking.length > 0) {
                memPromises.push(fetch('/v1/memory/profile.' + encodeURIComponent(username) + '.seeking', {
                  method: 'PUT',
                  headers: headers,
                  body: JSON.stringify({ value: seeking, visibility: 'public', tags: ['profile', 'seeking'] })
                }));
              }

              return Promise.all(memPromises);
            })
            .then(function(responses) {
              var allOk = responses.every(function(r) { return r.ok || r.status === 200; });
              if (allOk) {
                document.getElementById('joinForm').style.display = 'none';
                document.getElementById('joinSuccess').style.display = 'block';
              } else {
                resultEl.innerHTML = '<span style="color:#ef4444;">Tallennus epaonnistui. Yrita uudelleen.</span>';
              }
            })
            .catch(function(err) {
              resultEl.innerHTML = '<span style="color:#ef4444;">Verkkovirhe: ' + err.message + '</span>';
            });
          });
        })();
        </script>
      `;

      res.type('text/html').send(layoutHtml('Liity hakemistoon', body));
    } catch {
      res.type('text/html').send(layoutHtml('Virhe', '<div class="alert alert-error">Lomaketta ei voitu ladata.</div>'));
    }
  });

  // ── GET /v1/portal/human/hobbies/me — View/edit own profile ──
  router.get('/v1/portal/human/hobbies/me', requireAuth(), async (req, res) => {
    try {
      const ownerName = req.auth!.owner as string;
      const ghiiRecord = await storage.getGHIIByOwner(ownerName);

      if (!ghiiRecord) {
        const body = `
          <div class="empty-state">
            <div class="empty-icon">\uD83D\uDE15</div>
            <div class="empty-text">Et ole viela luonut GHII-profiilia. <a href="/v1/portal/human" style="color:var(--accent);">Rekisteroidy ensin.</a></div>
          </div>`;
        res.type('text/html').send(layoutHtml('Oma profiili', body));
        return;
      }

      // Look up directory entry
      const searchResult = await directoryService.search({ perPage: 10000 });
      const entry = searchResult.entries.find(e => e.ghii === ghiiRecord.ghii);

      if (!entry) {
        const body = `
          <h1 class="page-title">Oma profiili</h1>
          <div class="card">
            <p style="color:var(--text-dim);">Profiiliasi ei loytynyt hakemistosta. Tama voi johtua siita, etta et ole viela liittynyt tai hakemistoindeksi ei ole paivittynyt.</p>
            <a href="/v1/portal/human/hobbies/join" class="btn btn-primary" style="margin-top:12px;">Liity hakemistoon</a>
          </div>`;
        res.type('text/html').send(layoutHtml('Oma profiili', body));
        return;
      }

      // Load extra profile data
      const gaii = req.auth!.sub;
      let availability = '';
      let seeking: string[] = [];

      const avMem = await storage.getMemory(gaii, `profile.${ghiiRecord.username}.availability`);
      if (avMem?.value && typeof avMem.value === 'string') availability = avMem.value;
      else if (avMem?.value && typeof avMem.value === 'object' && avMem.value !== null) {
        const v = avMem.value as Record<string, unknown>;
        if (typeof v.availability === 'string') availability = v.availability;
      }

      const seekMem = await storage.getMemory(gaii, `profile.${ghiiRecord.username}.seeking`);
      if (seekMem?.value && Array.isArray(seekMem.value)) seeking = seekMem.value as string[];
      else if (seekMem?.value && typeof seekMem.value === 'object' && seekMem.value !== null) {
        const v = seekMem.value as Record<string, unknown>;
        if (Array.isArray(v.items)) seeking = v.items as string[];
      }

      const interestTags = entry.interests.map(i => `<span class="tag">${esc(i)}</span>`).join('');
      const seekingTags = seeking.map(s => `<span class="tag">${esc(s)}</span>`).join('');

      const locationParts: string[] = [];
      if (entry.city) locationParts.push(entry.city);
      if (entry.area) locationParts.push(entry.area);
      if (entry.country) locationParts.push(entry.country);
      const locationStr = locationParts.join(', ');

      const body = `
        <h1 class="page-title">Oma profiili</h1>

        <div class="card">
          <div class="profile-header">
            <span class="profile-avatar">${entry.avatar ? esc(entry.avatar) : '\uD83D\uDE0A'}</span>
            <div>
              <div class="profile-name">${esc(entry.displayName)}</div>
              <div class="profile-ghii">${esc(ghiiRecord.ghii)}</div>
            </div>
          </div>

          ${entry.bio ? `
          <div class="profile-section">
            <div class="profile-section-label">Kuvaus</div>
            <div class="profile-bio">${esc(entry.bio)}</div>
          </div>` : ''}

          <div class="profile-section">
            <div class="profile-section-label">Kiinnostukset</div>
            <div class="tags">${interestTags || '<span style="color:var(--text-muted);">Ei asetettu</span>'}</div>
          </div>

          ${locationStr ? `
          <div class="profile-section">
            <div class="profile-section-label">Sijainti</div>
            <div class="profile-detail">${esc(locationStr)}</div>
          </div>` : ''}

          ${availability ? `
          <div class="profile-section">
            <div class="profile-section-label">Saatavuus</div>
            <div class="profile-detail">${esc(AVAILABILITY_LABELS[availability] ?? availability)}</div>
          </div>` : ''}

          ${seeking.length > 0 ? `
          <div class="profile-section">
            <div class="profile-section-label">Etsii</div>
            <div class="tags">${seekingTags}</div>
          </div>` : ''}
        </div>

        <h2 style="font-size:1rem; color:var(--text-bright); margin:24px 0 12px;">Muokkaa profiilia</h2>

        <form id="editForm" class="card">
          <div class="form-group">
            <label class="form-label" for="editInterests">Kiinnostukset</label>
            <input class="form-input" type="text" id="editInterests" value="${escAttr(entry.interests.join(', '))}">
            <div class="form-hint">Erota pilkuilla.</div>
          </div>
          <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <div class="form-group" style="flex:1; min-width:150px;">
              <label class="form-label" for="editCity">Kaupunki</label>
              <input class="form-input" type="text" id="editCity" value="${escAttr(entry.city ?? '')}">
            </div>
            <div class="form-group" style="flex:0 0 100px;">
              <label class="form-label" for="editCountry">Maa</label>
              <input class="form-input" type="text" id="editCountry" value="${escAttr(entry.country ?? 'FI')}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="editBio">Kuvaus</label>
            <textarea class="form-textarea" id="editBio" maxlength="500">${esc(entry.bio ?? '')}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label" for="editAvailability">Saatavuus</label>
            <select class="form-select" id="editAvailability">
              <option value="">Ei valittu</option>
              <option value="anytime"${availability === 'anytime' ? ' selected' : ''}>Milloin vain</option>
              <option value="mornings"${availability === 'mornings' ? ' selected' : ''}>Aamut</option>
              <option value="evenings"${availability === 'evenings' ? ' selected' : ''}>Illat</option>
              <option value="weekends"${availability === 'weekends' ? ' selected' : ''}>Viikonloput</option>
              <option value="evenings-weekends"${availability === 'evenings-weekends' ? ' selected' : ''}>Illat & viikonloput</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="editSeeking">Etsii</label>
            <input class="form-input" type="text" id="editSeeking" value="${escAttr(seeking.join(', '))}">
          </div>
          <button type="submit" class="btn btn-primary">Tallenna muutokset</button>
          <div id="editResult" style="margin-top:12px;"></div>
        </form>

        <script>
        (function() {
          var token = localStorage.getItem('aimeat-token');
          var owner = localStorage.getItem('aimeat-owner') || '${escAttr(ghiiRecord.username)}';
          if (!token) return;

          var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

          document.getElementById('editForm').addEventListener('submit', function(e) {
            e.preventDefault();
            var resultEl = document.getElementById('editResult');
            resultEl.innerHTML = '<span style="color:var(--text-dim);">Tallennetaan...</span>';

            var interests = document.getElementById('editInterests').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
            var city = document.getElementById('editCity').value.trim();
            var country = document.getElementById('editCountry').value.trim() || 'FI';
            var bio = document.getElementById('editBio').value.trim();
            var av = document.getElementById('editAvailability').value;
            var sk = document.getElementById('editSeeking').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);

            var promises = [];
            promises.push(fetch('/v1/memory/profile.' + encodeURIComponent(owner) + '.interests', {
              method: 'PUT', headers: headers,
              body: JSON.stringify({ value: interests, visibility: 'public', tags: ['profile', 'interests'] })
            }));
            promises.push(fetch('/v1/memory/profile.' + encodeURIComponent(owner) + '.location', {
              method: 'PUT', headers: headers,
              body: JSON.stringify({ value: { city: city, country: country }, visibility: 'public', tags: ['profile', 'location'] })
            }));
            promises.push(fetch('/v1/memory/profile.' + encodeURIComponent(owner) + '.bio', {
              method: 'PUT', headers: headers,
              body: JSON.stringify({ value: bio, visibility: 'public', tags: ['profile', 'bio'] })
            }));
            promises.push(fetch('/v1/memory/profile.' + encodeURIComponent(owner) + '.availability', {
              method: 'PUT', headers: headers,
              body: JSON.stringify({ value: av, visibility: 'public', tags: ['profile', 'availability'] })
            }));
            promises.push(fetch('/v1/memory/profile.' + encodeURIComponent(owner) + '.seeking', {
              method: 'PUT', headers: headers,
              body: JSON.stringify({ value: sk, visibility: 'public', tags: ['profile', 'seeking'] })
            }));

            Promise.all(promises).then(function(responses) {
              var allOk = responses.every(function(r) { return r.ok; });
              resultEl.innerHTML = allOk
                ? '<span style="color:var(--success);">Muutokset tallennettu! Hakemisto paivittyy seuraavassa paivityksessa.</span>'
                : '<span style="color:#ef4444;">Osa tallennuksista epaonnistui.</span>';
            }).catch(function(err) {
              resultEl.innerHTML = '<span style="color:#ef4444;">Virhe: ' + err.message + '</span>';
            });
          });
        })();
        </script>

        <div style="margin-top:24px;">
          <a href="/v1/portal/human/hobbies/profile/${encodeURIComponent(ghiiRecord.ghii)}" class="btn btn-secondary">Nayta julkinen profiili</a>
        </div>
      `;

      res.type('text/html').send(layoutHtml('Oma profiili', body));
    } catch {
      res.type('text/html').send(layoutHtml('Virhe', '<div class="alert alert-error">Profiilia ei voitu ladata.</div>'));
    }
  });

  return router;
}
