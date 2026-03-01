import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { VALID_CATEGORIES, CATEGORY_LABELS, type MarketplaceCategory } from '../services/marketplace.js';

/* ──────────────────────────────────────────────────────────
   Marketplace Portal — Phase 2.6
   Finnish-first, mobile-first, AIMEAT design system
   ────────────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Shared CSS (AIMEAT design system — matches portal-hobbies) ───

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
  --warning: #eab308;
  --warning-bg: rgba(234, 179, 8, 0.1);
  --warning-border: rgba(234, 179, 8, 0.3);
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
.card-desc { color: var(--text); font-size: 0.9rem; line-height: 1.6; margin-bottom: 12px; }

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

/* ── Price badge ── */
.price-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 14px;
  background: rgba(255, 105, 180, 0.15);
  border: 1px solid rgba(255, 105, 180, 0.3);
  border-radius: 20px;
  font-size: 0.9rem; font-weight: 600;
  color: var(--accent-bright);
}

/* ── Status badge ── */
.status-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.75rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.03em;
}
.status-active { background: var(--success-bg); border: 1px solid var(--success-border); color: var(--success); }
.status-sold { background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); color: #818cf8; }
.status-pending { background: var(--warning-bg); border: 1px solid var(--warning-border); color: var(--warning); }
.status-delivered { background: var(--success-bg); border: 1px solid var(--success-border); color: var(--success); }
.status-completed { background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); color: #818cf8; }
.status-delisted { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; }

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

/* ── Categories grid ── */
.categories-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 32px; }
.category-card {
  background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius);
  padding: 20px; text-align: center; text-decoration: none;
  transition: all 0.2s; cursor: pointer;
}
.category-card:hover { background: var(--card-bg-hover); border-color: var(--card-border-hover); box-shadow: 0 0 16px var(--card-glow); }
.category-icon { font-size: 2rem; margin-bottom: 8px; }
.category-name { font-size: 0.95rem; font-weight: 600; color: var(--text-bright); }
.category-count { font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; }

/* ── Stats grid ── */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 32px; }
.stat-card {
  background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-sm);
  padding: 16px; text-align: center;
}
.stat-value { font-size: 1.5rem; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; }

/* ── Stars rating ── */
.stars { color: #eab308; font-size: 1.1rem; letter-spacing: 2px; }

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

/* ── Card layout for listing ── */
.listing-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.listing-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }

/* ── Responsive ── */
@media (max-width: 600px) {
  .page-title { font-size: 1.4rem; }
  .container { padding: 16px 12px 60px; }
  .categories-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
}
`;

// ── Shared HTML layout wrapper ───────────────────────────

function layoutHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="fi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — AIME AT Tori</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${sharedCss}</style>
</head>
<body>
<div class="bg-canvas"></div>
<div class="container">
  <nav class="nav">
    <a href="/v1/portal/human/marketplace" class="nav-brand">AIME AT Tori</a>
    <div class="nav-links">
      <a href="/v1/portal/human/marketplace/search">Haku</a>
      <a href="/v1/portal/human/marketplace/sell">Myy</a>
      <a href="/v1/portal/human/marketplace/my-listings">Omat</a>
      <a href="/v1/portal/human">Portaali</a>
    </div>
  </nav>
  ${bodyHtml}
</div>
</body>
</html>`;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: 'Aktiivinen',
    sold: 'Myyty',
    expired: 'Vanhentunut',
    hidden: 'Piilotettu',
    delisted: 'Poistettu',
    pending_delivery: 'Odottaa toimitusta',
    delivered: 'Toimitettu',
    disputed: 'Riitautettu',
    completed: 'Valmis',
    cancelled: 'Peruttu',
  };
  return labels[status] ?? status;
}

function statusClass(status: string): string {
  const classes: Record<string, string> = {
    active: 'status-active',
    sold: 'status-sold',
    pending_delivery: 'status-pending',
    delivered: 'status-delivered',
    completed: 'status-completed',
    delisted: 'status-delisted',
  };
  return classes[status] ?? '';
}

function starsHtml(score: number): string {
  let html = '<span class="stars">';
  for (let i = 1; i <= 5; i++) {
    html += i <= score ? '\u2605' : '\u2606';
  }
  html += '</span>';
  return html;
}

// ── Router ──────────────────────────────────────────────

export function portalMarketplaceRouter(
  config: AimeatConfig,
  storage: Storage,
): Router {
  const router = Router();

  // ── GET /v1/portal/human/marketplace — Browse listings with category filter ──
  router.get('/v1/portal/human/marketplace', async (req, res) => {
    try {
      const allListings = await storage.listListings({ status: 'active', page: 1, perPage: 10000 });

      // Category counts
      const categoryCounts: Record<string, number> = {};
      for (const l of allListings) {
        categoryCounts[l.category] = (categoryCounts[l.category] ?? 0) + 1;
      }

      const categoryCards = VALID_CATEGORIES.map(cat => {
        const label = CATEGORY_LABELS[cat];
        const count = categoryCounts[cat] ?? 0;
        return `
          <a href="/v1/portal/human/marketplace/search?category=${encodeURIComponent(cat)}" class="category-card">
            <div class="category-icon">${label.icon}</div>
            <div class="category-name">${esc(label.fi)}</div>
            ${count > 0 ? `<div class="category-count">${count} ilmoitusta</div>` : ''}
          </a>`;
      }).join('');

      // Recent listings (latest 6)
      const recent = allListings.slice(0, 6);
      const recentCards = recent.map(l => {
        const catLabel = CATEGORY_LABELS[l.category as MarketplaceCategory];
        const tagsHtml = (l.tags ?? []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('');
        return `
          <a href="/v1/portal/human/marketplace/listing/${encodeURIComponent(l.id)}" class="card" style="text-decoration:none;">
            <div class="listing-header">
              <div>
                <div class="card-title">${esc(l.title)}</div>
                <div class="card-meta">${catLabel?.icon ?? ''} ${esc(catLabel?.fi ?? l.category)} ${l.location?.city ? '&middot; ' + esc(l.location.city) : ''}</div>
              </div>
              <div class="price-badge">${l.priceMorsels} morsels</div>
            </div>
            ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
          </a>`;
      }).join('');

      const body = `
        <h1 class="page-title">Tori</h1>
        <p class="page-subtitle">AIMEAT-markkinapaikka — osta ja myy morsel-valuutalla</p>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${allListings.length}</div>
            <div class="stat-label">Ilmoitusta</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${Object.keys(categoryCounts).length}</div>
            <div class="stat-label">Kategoriaa</div>
          </div>
        </div>

        <h2 style="font-size:1.1rem; color:var(--text-bright); margin-bottom:16px;">Kategoriat</h2>
        <div class="categories-grid">${categoryCards}</div>

        ${recent.length > 0 ? `
        <h2 style="font-size:1.1rem; color:var(--text-bright); margin-bottom:16px;">Uusimmat ilmoitukset</h2>
        ${recentCards}
        ` : `
        <div class="empty-state">
          <div class="empty-icon">&#x1F6D2;</div>
          <div class="empty-text">Ei viela ilmoituksia. Ole ensimmainen myyjae!</div>
        </div>
        `}

        <div style="text-align:center; margin-top:32px;">
          <a href="/v1/portal/human/marketplace/search" class="btn btn-primary" style="margin-right:8px;">Selaa ilmoituksia</a>
          <a href="/v1/portal/human/marketplace/sell" class="btn btn-secondary">Luo ilmoitus</a>
        </div>
      `;

      res.type('text/html').send(layoutHtml('Tori', body));
    } catch {
      res.type('text/html').send(layoutHtml('Virhe', '<div class="alert alert-error">Sivua ei voitu ladata.</div>'));
    }
  });

  // ── GET /v1/portal/human/marketplace/search — Search + filter listings ──
  router.get('/v1/portal/human/marketplace/search', async (req, res) => {
    try {
      const category = (req.query.category as string | undefined)?.trim() || undefined;
      const city = (req.query.city as string | undefined)?.trim() || undefined;
      const minPrice = req.query.min_price ? parseInt(req.query.min_price as string, 10) : undefined;
      const maxPrice = req.query.max_price ? parseInt(req.query.max_price as string, 10) : undefined;
      const q = (req.query.q as string | undefined)?.trim() || undefined;
      const page = Math.max(1, parseInt(req.query.page as string || '1', 10) || 1);
      const perPage = 20;

      let listings = await storage.listListings({
        category,
        city,
        minPrice,
        maxPrice,
        status: 'active',
        page,
        perPage,
      });

      // Text search filter (title/description)
      if (q) {
        const lower = q.toLowerCase();
        listings = listings.filter(l =>
          l.title.toLowerCase().includes(lower) ||
          l.description.toLowerCase().includes(lower) ||
          (l.tags ?? []).some(t => t.toLowerCase().includes(lower)),
        );
      }

      // Category options for filter
      const categoryOptions = VALID_CATEGORIES.map(cat => {
        const label = CATEGORY_LABELS[cat];
        const selected = category === cat ? ' selected' : '';
        return `<option value="${cat}"${selected}>${label.icon} ${esc(label.fi)}</option>`;
      }).join('');

      const listingCards = listings.map(l => {
        const catLabel = CATEGORY_LABELS[l.category as MarketplaceCategory];
        const tagsHtml = (l.tags ?? []).slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('');
        return `
          <a href="/v1/portal/human/marketplace/listing/${encodeURIComponent(l.id)}" class="card" style="text-decoration:none;">
            <div class="listing-header">
              <div>
                <div class="card-title">${esc(l.title)}</div>
                <div class="card-meta">${catLabel?.icon ?? ''} ${esc(catLabel?.fi ?? l.category)} ${l.location?.city ? '&middot; ' + esc(l.location.city) : ''} &middot; ${esc(l.sellerGhii)}</div>
              </div>
              <div class="price-badge">${l.priceMorsels} morsels</div>
            </div>
            <div class="card-desc">${esc(l.description.length > 120 ? l.description.slice(0, 120) + '...' : l.description)}</div>
            ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
          </a>`;
      }).join('');

      const body = `
        <h1 class="page-title">Hae ilmoituksia</h1>
        <p class="page-subtitle">Suodata ja selaa markkinapaikan tarjontaa</p>

        <form method="GET" action="/v1/portal/human/marketplace/search" class="card" style="margin-bottom:24px;">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <div class="form-group">
              <label class="form-label">Hakusana</label>
              <input type="text" name="q" value="${escAttr(q ?? '')}" class="form-input" placeholder="Etsi...">
            </div>
            <div class="form-group">
              <label class="form-label">Kategoria</label>
              <select name="category" class="form-select">
                <option value="">Kaikki</option>
                ${categoryOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Kaupunki</label>
              <input type="text" name="city" value="${escAttr(city ?? '')}" class="form-input" placeholder="esim. Espoo">
            </div>
            <div class="form-group">
              <label class="form-label">Hinta (morsels)</label>
              <div style="display:flex; gap:8px;">
                <input type="number" name="min_price" value="${minPrice ?? ''}" class="form-input" placeholder="Min" min="0">
                <input type="number" name="max_price" value="${maxPrice ?? ''}" class="form-input" placeholder="Max" min="0">
              </div>
            </div>
          </div>
          <div style="margin-top:12px;">
            <button type="submit" class="btn btn-primary btn-sm">Hae</button>
            <a href="/v1/portal/human/marketplace/search" class="btn btn-secondary btn-sm" style="margin-left:8px;">Tyhjenna</a>
          </div>
        </form>

        ${listings.length > 0 ? listingCards : `
          <div class="empty-state">
            <div class="empty-icon">&#x1F50D;</div>
            <div class="empty-text">Ei tuloksia. Kokeile eri hakuehtoja.</div>
          </div>
        `}

        ${listings.length >= perPage ? `
        <div class="pagination">
          ${page > 1 ? `<a href="/v1/portal/human/marketplace/search?page=${page - 1}${category ? '&category=' + encodeURIComponent(category) : ''}${city ? '&city=' + encodeURIComponent(city) : ''}${q ? '&q=' + encodeURIComponent(q) : ''}">&laquo; Edellinen</a>` : ''}
          <a class="active">Sivu ${page}</a>
          <a href="/v1/portal/human/marketplace/search?page=${page + 1}${category ? '&category=' + encodeURIComponent(category) : ''}${city ? '&city=' + encodeURIComponent(city) : ''}${q ? '&q=' + encodeURIComponent(q) : ''}">Seuraava &raquo;</a>
        </div>` : ''}
      `;

      res.type('text/html').send(layoutHtml('Hae ilmoituksia', body));
    } catch {
      res.type('text/html').send(layoutHtml('Virhe', '<div class="alert alert-error">Hakua ei voitu suorittaa.</div>'));
    }
  });

  // ── GET /v1/portal/human/marketplace/listing/:id — Single listing detail ──
  router.get('/v1/portal/human/marketplace/listing/:id', async (req, res) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
      const listing = await storage.getListing(id);

      if (!listing) {
        res.type('text/html').send(layoutHtml('Ei loydy', `
          <div class="empty-state">
            <div class="empty-icon">&#x2753;</div>
            <div class="empty-text">Ilmoitusta ei loydy.</div>
          </div>
          <div style="text-align:center;"><a href="/v1/portal/human/marketplace" class="btn btn-secondary">Takaisin</a></div>
        `));
        return;
      }

      const catLabel = CATEGORY_LABELS[listing.category as MarketplaceCategory];
      const tagsHtml = (listing.tags ?? []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
      const feePercent = config.marketplaceTransactionFeePercent;
      const fee = Math.ceil(listing.priceMorsels * feePercent / 100);
      const totalCost = listing.priceMorsels + fee;

      // Check if viewer is the seller
      const isOwner = req.auth?.owner === listing.ownerName;

      // Get purchase history for this listing
      const allPurchases = await storage.listPurchasesBySeller(listing.ownerName);
      const listingPurchases = allPurchases.filter(p => p.listingId === listing.id);

      const body = `
        <div style="margin-bottom:16px;">
          <a href="/v1/portal/human/marketplace" style="color:var(--text-dim); text-decoration:none; font-size:0.85rem;">&laquo; Takaisin torille</a>
        </div>

        <div class="card">
          <div class="listing-header">
            <div>
              <div class="card-title" style="font-size:1.4rem;">${esc(listing.title)}</div>
              <div class="card-meta">
                ${catLabel?.icon ?? ''} ${esc(catLabel?.fi ?? listing.category)}
                ${listing.location?.city ? '&middot; ' + esc(listing.location.city) : ''}
                ${listing.location?.area ? ', ' + esc(listing.location.area) : ''}
                &middot; Myyjae: ${esc(listing.sellerGhii)}
              </div>
            </div>
            <div>
              <div class="price-badge" style="font-size:1.1rem;">${listing.priceMorsels} morsels</div>
              <div style="margin-top:8px;"><span class="status-badge ${statusClass(listing.status)}">${statusLabel(listing.status)}</span></div>
            </div>
          </div>

          <div class="card-desc" style="margin-top:16px; white-space:pre-line;">${esc(listing.description)}</div>

          ${tagsHtml ? `<div class="tags" style="margin-top:12px;">${tagsHtml}</div>` : ''}

          <div style="margin-top:16px; font-size:0.85rem; color:var(--text-dim);">
            ${listing.condition ? 'Kunto: ' + esc(listing.condition) + ' &middot; ' : ''}
            ${listing.availability ? 'Saatavuus: ' + esc(listing.availability) + ' &middot; ' : ''}
            Luotu: ${esc(listing.createdAt.slice(0, 10))}
          </div>

          ${listing.status === 'active' && !isOwner ? `
          <div class="listing-actions">
            <div class="card" style="padding:16px; background:rgba(255,105,180,0.05); border-color:rgba(255,105,180,0.2); flex:1;">
              <div style="font-size:0.85rem; color:var(--text-dim); margin-bottom:8px;">Kokonaishinta sisaltaen palvelumaksun (${feePercent}%)</div>
              <div style="font-size:1.2rem; font-weight:700; color:var(--accent-bright);">${totalCost} morsels</div>
              <div style="font-size:0.78rem; color:var(--text-muted); margin-top:4px;">Hinta: ${listing.priceMorsels} + palvelumaksu: ${fee}</div>
            </div>
          </div>
          <div style="margin-top:16px; text-align:center;">
            <p style="font-size:0.85rem; color:var(--text-dim); margin-bottom:8px;">Ostaminen vaatii kirjautumisen. Kayta API:a: POST /v1/marketplace/listings/${esc(listing.id)}/purchase</p>
          </div>
          ` : ''}

          ${isOwner ? `
          <div class="listing-actions">
            <p style="font-size:0.85rem; color:var(--text-dim);">Tama on oma ilmoituksesi. Hallinnoi API:n kautta.</p>
          </div>
          ` : ''}
        </div>

        ${listingPurchases.length > 0 ? `
        <h2 style="font-size:1.1rem; color:var(--text-bright); margin:24px 0 12px;">Ostokset</h2>
        ${listingPurchases.map(p => `
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-size:0.85rem; color:var(--text-dim);">Ostaja: ${esc(p.buyerOwner)} &middot; ${esc(p.createdAt.slice(0, 10))}</div>
                <div style="font-size:0.9rem; color:var(--text);">${p.totalCostMorsels} morsels</div>
              </div>
              <div>
                <span class="status-badge ${statusClass(p.status)}">${statusLabel(p.status)}</span>
                ${p.rating ? starsHtml(p.rating.score) : ''}
              </div>
            </div>
            ${p.rating?.comment ? `<div style="margin-top:8px; font-size:0.85rem; color:var(--text-dim); font-style:italic;">"${esc(p.rating.comment)}"</div>` : ''}
          </div>
        `).join('')}
        ` : ''}
      `;

      res.type('text/html').send(layoutHtml(listing.title, body));
    } catch {
      res.type('text/html').send(layoutHtml('Virhe', '<div class="alert alert-error">Ilmoitusta ei voitu ladata.</div>'));
    }
  });

  // ── GET /v1/portal/human/marketplace/sell — Create listing form ──
  router.get('/v1/portal/human/marketplace/sell', async (req, res) => {
    try {
      // Check if authenticated
      if (!req.auth?.owner) {
        res.type('text/html').send(layoutHtml('Kirjaudu', `
          <div class="empty-state">
            <div class="empty-icon">&#x1F512;</div>
            <div class="empty-text">Kirjaudu sisaan luodaksesi ilmoituksen.</div>
          </div>
          <div style="text-align:center; margin-top:16px;">
            <a href="/v1/portal/human" class="btn btn-primary">Kirjaudu</a>
          </div>
        `));
        return;
      }

      const categoryOptions = VALID_CATEGORIES.map(cat => {
        const label = CATEGORY_LABELS[cat];
        return `<option value="${cat}">${label.icon} ${esc(label.fi)}</option>`;
      }).join('');

      const body = `
        <h1 class="page-title">Luo ilmoitus</h1>
        <p class="page-subtitle">Listaamismaksu: ${config.marketplaceListingFeeMorsels} morsels</p>

        <div class="card">
          <p style="font-size:0.9rem; color:var(--text-dim); margin-bottom:16px;">
            Ilmoituksen luonti tapahtuu API:n kautta. Tayta tiedot ja lahetae pyynto.
          </p>

          <div class="form-group">
            <label class="form-label">Otsikko *</label>
            <input type="text" id="title" class="form-input" placeholder="Tuotteen tai palvelun nimi" minlength="3" maxlength="200">
          </div>

          <div class="form-group">
            <label class="form-label">Kuvaus *</label>
            <textarea id="description" class="form-textarea" placeholder="Kuvaile tuote tai palvelu..." rows="4" minlength="10" maxlength="5000"></textarea>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <div class="form-group">
              <label class="form-label">Kategoria *</label>
              <select id="category" class="form-select">
                ${categoryOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Hinta (morsels) *</label>
              <input type="number" id="priceMorsels" class="form-input" placeholder="10" min="1">
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <div class="form-group">
              <label class="form-label">Kunto</label>
              <select id="condition" class="form-select">
                <option value="">-</option>
                <option value="new">Uusi</option>
                <option value="used">Kaytetty</option>
                <option value="digital">Digitaalinen</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Saatavuus</label>
              <select id="availability" class="form-select">
                <option value="">-</option>
                <option value="immediate">Heti</option>
                <option value="on_request">Pyydettaessa</option>
                <option value="scheduled">Aikataulutettu</option>
              </select>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <div class="form-group">
              <label class="form-label">Kaupunki</label>
              <input type="text" id="city" class="form-input" placeholder="esim. Helsinki">
            </div>
            <div class="form-group">
              <label class="form-label">Alue</label>
              <input type="text" id="area" class="form-input" placeholder="esim. Kallio">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Tagit (pilkuilla erotetut)</label>
            <input type="text" id="tags" class="form-input" placeholder="esim. koodaus, web, react">
          </div>

          <div id="api-result" style="margin-top:16px; display:none;"></div>

          <div style="margin-top:16px;">
            <button onclick="submitListing()" class="btn btn-primary">Luo ilmoitus (${config.marketplaceListingFeeMorsels} morsels)</button>
          </div>
        </div>

        <script>
        async function submitListing() {
          const data = {
            title: document.getElementById('title').value,
            description: document.getElementById('description').value,
            category: document.getElementById('category').value,
            priceMorsels: parseInt(document.getElementById('priceMorsels').value, 10),
          };
          const condition = document.getElementById('condition').value;
          if (condition) data.condition = condition;
          const availability = document.getElementById('availability').value;
          if (availability) data.availability = availability;
          const city = document.getElementById('city').value;
          const area = document.getElementById('area').value;
          if (city || area) data.location = {};
          if (city) data.location.city = city;
          if (area) data.location.area = area;
          const tags = document.getElementById('tags').value;
          if (tags) data.tags = tags.split(',').map(t => t.trim()).filter(Boolean);

          const el = document.getElementById('api-result');
          el.style.display = 'block';
          el.innerHTML = '<div class="alert" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); color:var(--text-dim);">Lahetetaan...</div>';

          try {
            const resp = await fetch('/v1/marketplace/listings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            const json = await resp.json();
            if (json.ok) {
              el.innerHTML = '<div class="alert alert-success">Ilmoitus luotu! ID: ' + json.data.listingId + '</div>';
              setTimeout(() => {
                window.location.href = '/v1/portal/human/marketplace/listing/' + json.data.listingId;
              }, 1500);
            } else {
              el.innerHTML = '<div class="alert alert-error">' + (json.error?.message ?? 'Tuntematon virhe') + '</div>';
            }
          } catch (err) {
            el.innerHTML = '<div class="alert alert-error">Verkkoyhteys epaeonnistui</div>';
          }
        }
        </script>
      `;

      res.type('text/html').send(layoutHtml('Luo ilmoitus', body));
    } catch {
      res.type('text/html').send(layoutHtml('Virhe', '<div class="alert alert-error">Sivua ei voitu ladata.</div>'));
    }
  });

  // ── GET /v1/portal/human/marketplace/my-listings — Manage own listings ──
  router.get('/v1/portal/human/marketplace/my-listings', async (req, res) => {
    try {
      if (!req.auth?.owner) {
        res.type('text/html').send(layoutHtml('Kirjaudu', `
          <div class="empty-state">
            <div class="empty-icon">&#x1F512;</div>
            <div class="empty-text">Kirjaudu sisaan nahdaksesi omat ilmoituksesi.</div>
          </div>
        `));
        return;
      }

      const ownerName = req.auth.owner;
      const listings = await storage.listListings({ sellerOwner: ownerName, page: 1, perPage: 1000 });

      const listingCards = listings.map(l => {
        const catLabel = CATEGORY_LABELS[l.category as MarketplaceCategory];
        return `
          <a href="/v1/portal/human/marketplace/listing/${encodeURIComponent(l.id)}" class="card" style="text-decoration:none;">
            <div class="listing-header">
              <div>
                <div class="card-title">${esc(l.title)}</div>
                <div class="card-meta">${catLabel?.icon ?? ''} ${esc(catLabel?.fi ?? l.category)} &middot; ${esc(l.createdAt.slice(0, 10))}</div>
              </div>
              <div style="text-align:right;">
                <div class="price-badge">${l.priceMorsels} morsels</div>
                <div style="margin-top:6px;"><span class="status-badge ${statusClass(l.status)}">${statusLabel(l.status)}</span></div>
              </div>
            </div>
          </a>`;
      }).join('');

      const body = `
        <h1 class="page-title">Omat ilmoitukset</h1>
        <p class="page-subtitle">Hallinnoi myynti-ilmoituksiasi</p>

        <div style="margin-bottom:16px;">
          <a href="/v1/portal/human/marketplace/sell" class="btn btn-primary">+ Uusi ilmoitus</a>
        </div>

        ${listings.length > 0 ? listingCards : `
          <div class="empty-state">
            <div class="empty-icon">&#x1F4E6;</div>
            <div class="empty-text">Ei viela ilmoituksia. Luo ensimmainen!</div>
          </div>
        `}
      `;

      res.type('text/html').send(layoutHtml('Omat ilmoitukset', body));
    } catch {
      res.type('text/html').send(layoutHtml('Virhe', '<div class="alert alert-error">Sivua ei voitu ladata.</div>'));
    }
  });

  // ── GET /v1/portal/human/marketplace/my-purchases — Purchase history + rate ──
  router.get('/v1/portal/human/marketplace/my-purchases', async (req, res) => {
    try {
      if (!req.auth?.owner) {
        res.type('text/html').send(layoutHtml('Kirjaudu', `
          <div class="empty-state">
            <div class="empty-icon">&#x1F512;</div>
            <div class="empty-text">Kirjaudu sisaan nahdaksesi ostoksesi.</div>
          </div>
        `));
        return;
      }

      const ownerName = req.auth.owner;
      const purchases = await storage.listPurchasesByBuyer(ownerName);

      const purchaseCards = await Promise.all(purchases.map(async (p) => {
        const listing = await storage.getListing(p.listingId);
        const title = listing?.title ?? 'Tuntematon';
        return `
          <div class="card">
            <div class="listing-header">
              <div>
                <div class="card-title">${esc(title)}</div>
                <div class="card-meta">
                  Myyjae: ${esc(p.sellerOwner)} &middot;
                  ${esc(p.createdAt.slice(0, 10))} &middot;
                  Koodi: ${esc(p.trackingCode)}
                </div>
              </div>
              <div style="text-align:right;">
                <div class="price-badge">${p.totalCostMorsels} morsels</div>
                <div style="margin-top:6px;"><span class="status-badge ${statusClass(p.status)}">${statusLabel(p.status)}</span></div>
              </div>
            </div>
            ${p.rating ? `
              <div style="margin-top:8px;">
                ${starsHtml(p.rating.score)}
                ${p.rating.comment ? `<span style="font-size:0.85rem; color:var(--text-dim); margin-left:8px;">"${esc(p.rating.comment)}"</span>` : ''}
              </div>
            ` : (p.status === 'delivered' || p.status === 'completed') ? `
              <div style="margin-top:12px; font-size:0.85rem; color:var(--text-dim);">
                Arvostele: POST /v1/marketplace/purchases/${esc(p.id)}/rate
              </div>
            ` : ''}
          </div>`;
      }));

      const body = `
        <h1 class="page-title">Omat ostokset</h1>
        <p class="page-subtitle">Ostoshistoria ja arvostelut</p>

        ${purchases.length > 0 ? purchaseCards.join('') : `
          <div class="empty-state">
            <div class="empty-icon">&#x1F6D2;</div>
            <div class="empty-text">Ei viela ostoksia.</div>
          </div>
        `}
      `;

      res.type('text/html').send(layoutHtml('Omat ostokset', body));
    } catch {
      res.type('text/html').send(layoutHtml('Virhe', '<div class="alert alert-error">Sivua ei voitu ladata.</div>'));
    }
  });

  return router;
}
