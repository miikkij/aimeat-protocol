/**
 * @file portfolio-themes.js
 * @description Ready-made company portfolio themes — generate a complete, self-contained public
 *   portfolio HTML page client-side from the company's data, so an admin can publish a portfolio
 *   WITHOUT the AI round-trip (the AI-prompt path stays for full custom designs). Each theme is a
 *   pure function `render(data) → htmlString`; the page is fully inline (no external deps) and
 *   responsive. User-supplied text is HTML-escaped (the result is served as a standalone public file).
 * @structure esc() · buildPortfolioData() · THEMES = [{ id, name, render }]
 * @usage imported by views/my-company.js (PortfolioPanel theme picker).
 * @version-history
 *   v0.1.0 — 2026-06-23 — initial: minimal, midnight, corporate themes
 */

/** Escape for safe interpolation into the generated HTML document. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Build the theme input from the selected company + offerings + the builder's include choices. */
export function buildPortfolioData(org, offerings, choices) {
  const origin = (typeof window !== 'undefined' && window.location.origin) || '';
  return {
    name: org.name || '',
    businessId: choices.includeInfo ? (org.businessId || '') : '',
    description: choices.includeInfo ? (org.description || '') : '',
    logo: (choices.useLogo && org.logo) ? (origin + org.logo) : '',
    offerings: choices.includeOfferings
      ? (offerings || []).map(o => ({ title: o.offer?.title || '', price: o.offer?.price?.morsels || 0, agent: o.agentName || '', ask: o.offer?.ask || '' }))
      : [],
  };
}

const priceLabel = (p) => p > 0 ? `${p} morsels` : 'Contact for pricing';

const doc = (title, css, body) =>
  `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${esc(title)}</title>\n<style>${css}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

// ── Theme: Minimal (light, clean, editorial) ─────────────────────────────────────────────────────
function minimal(d) {
  const css = `*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#fff;line-height:1.65}.wrap{max-width:760px;margin:0 auto;padding:72px 24px}header{display:flex;align-items:center;gap:20px}.logo{width:72px;height:72px;border-radius:14px;object-fit:cover;border:1px solid #eee}h1{font-size:2.3rem;margin:0;letter-spacing:-.02em}.yt{color:#777;font-size:.9rem;margin-top:6px}.about{font-size:1.15rem;color:#333;margin:28px 0 56px;max-width:60ch}h2{font-size:1.25rem;border-bottom:2px solid #E8564A;display:inline-block;padding-bottom:4px;margin:0 0 18px}.svc{border:1px solid #ececec;border-radius:14px;padding:18px 22px;margin:14px 0;transition:border-color .15s}.svc h3{margin:0 0 6px;font-size:1.05rem}.svc p{margin:0;color:#666;font-size:.95rem}.price{color:#E8564A;font-weight:700;white-space:nowrap}.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}footer{margin-top:72px;color:#999;font-size:.85rem;border-top:1px solid #eee;padding-top:20px}a{color:#E8564A}`;
  const logo = d.logo ? `<img class="logo" src="${esc(d.logo)}" alt="${esc(d.name)} logo">` : '';
  const yt = d.businessId ? `<div class="yt">Business ID ${esc(d.businessId)}</div>` : '';
  const about = d.description ? `<p class="about">${esc(d.description)}</p>` : '';
  const services = d.offerings.length ? `<section><h2>Services</h2>${d.offerings.map(o => `<div class="svc"><div class="row"><h3>${esc(o.title)}</h3><span class="price">${esc(priceLabel(o.price))}</span></div>${o.ask ? `<p>${esc(o.ask)}</p>` : ''}</div>`).join('')}</section>` : '';
  const body = `<div class="wrap"><header>${logo}<div><h1>${esc(d.name)}</h1>${yt}</div></header>${about}${services}<footer>Powered by AIMEAT</footer></div>`;
  return doc(d.name, css, body);
}

// ── Theme: Midnight (dark, bold, accent gradient) ────────────────────────────────────────────────
function midnight(d) {
  const css = `*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;color:#e8e8ea;background:#0d0d12;line-height:1.6}.hero{padding:88px 24px 56px;text-align:center;background:radial-gradient(120% 120% at 50% 0%,#1c1530 0%,#0d0d12 60%)}.logo{width:88px;height:88px;border-radius:18px;object-fit:cover;border:1px solid #2a2a3a;margin-bottom:20px}h1{font-size:2.8rem;margin:0;background:linear-gradient(90deg,#fff,#b59cff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-.02em}.yt{color:#8a8aa0;font-size:.9rem;margin-top:10px}.about{max-width:62ch;margin:22px auto 0;color:#c4c4d4;font-size:1.12rem}.wrap{max-width:880px;margin:0 auto;padding:8px 24px 80px}h2{font-size:1.4rem;margin:48px 0 20px;color:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}.svc{background:#15151f;border:1px solid #26263a;border-radius:16px;padding:20px}.svc h3{margin:0 0 8px;color:#fff;font-size:1.05rem}.svc p{margin:0 0 12px;color:#9a9ab0;font-size:.92rem}.price{display:inline-block;background:#2a1f44;color:#c4a8ff;font-weight:700;border-radius:999px;padding:4px 12px;font-size:.85rem}footer{text-align:center;color:#6a6a80;font-size:.85rem;padding:32px 0}`;
  const logo = d.logo ? `<img class="logo" src="${esc(d.logo)}" alt="${esc(d.name)} logo">` : '';
  const yt = d.businessId ? `<div class="yt">Business ID ${esc(d.businessId)}</div>` : '';
  const about = d.description ? `<p class="about">${esc(d.description)}</p>` : '';
  const services = d.offerings.length ? `<div class="wrap"><h2>Services</h2><div class="grid">${d.offerings.map(o => `<div class="svc"><h3>${esc(o.title)}</h3>${o.ask ? `<p>${esc(o.ask)}</p>` : ''}<span class="price">${esc(priceLabel(o.price))}</span></div>`).join('')}</div></div>` : '';
  const body = `<div class="hero">${logo}<h1>${esc(d.name)}</h1>${yt}${about}</div>${services}<footer>Powered by AIMEAT</footer>`;
  return doc(d.name, css, body);
}

// ── Theme: Corporate (professional, header bar, two-tone) ─────────────────────────────────────────
function corporate(d) {
  const css = `*{box-sizing:border-box}body{margin:0;font-family:Georgia,"Times New Roman",serif;color:#222;background:#f7f6f3;line-height:1.65}.bar{background:#14213d;color:#fff;padding:22px 24px}.bar .inner{max-width:920px;margin:0 auto;display:flex;align-items:center;gap:16px}.logo{width:56px;height:56px;border-radius:8px;object-fit:cover;background:#fff}.bar h1{font-size:1.6rem;margin:0;font-family:Georgia,serif}.bar .yt{color:#aeb6c8;font-size:.82rem;margin-top:2px}.wrap{max-width:920px;margin:0 auto;padding:48px 24px 72px}.about{font-size:1.15rem;color:#333;border-left:4px solid #fca311;padding-left:18px;margin:0 0 48px;max-width:62ch}h2{font-size:1.3rem;color:#14213d;margin:0 0 20px;font-family:Georgia,serif}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e0d8}td,th{text-align:left;padding:14px 18px;border-bottom:1px solid #eee;font-family:-apple-system,Segoe UI,sans-serif}th{background:#14213d;color:#fff;font-weight:600}.price{color:#14213d;font-weight:700;white-space:nowrap;font-family:-apple-system,Segoe UI,sans-serif}.ask{color:#777;font-size:.9rem;font-family:-apple-system,Segoe UI,sans-serif}footer{max-width:920px;margin:0 auto;padding:24px;color:#999;font-size:.85rem;font-family:-apple-system,Segoe UI,sans-serif}`;
  const logo = d.logo ? `<img class="logo" src="${esc(d.logo)}" alt="${esc(d.name)} logo">` : '';
  const yt = d.businessId ? `<div class="yt">Business ID ${esc(d.businessId)}</div>` : '';
  const about = d.description ? `<p class="about">${esc(d.description)}</p>` : '';
  const services = d.offerings.length ? `<section><h2>Services &amp; Pricing</h2><table><thead><tr><th>Service</th><th>Price</th></tr></thead><tbody>${d.offerings.map(o => `<tr><td><strong>${esc(o.title)}</strong>${o.ask ? `<div class="ask">${esc(o.ask)}</div>` : ''}</td><td class="price">${esc(priceLabel(o.price))}</td></tr>`).join('')}</tbody></table></section>` : '';
  const body = `<div class="bar"><div class="inner">${logo}<div><h1>${esc(d.name)}</h1>${yt}</div></div></div><div class="wrap">${about}${services}</div><footer>Powered by AIMEAT</footer>`;
  return doc(d.name, css, body);
}

export const THEMES = [
  { id: 'minimal', name: 'Minimal', render: minimal },
  { id: 'midnight', name: 'Midnight', render: midnight },
  { id: 'corporate', name: 'Corporate', render: corporate },
];
