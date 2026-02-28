import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Locale, TFunction } from '../i18n.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

/* ──────────────────────────────────────────────────────────
   Human-facing portal page — "try it now" experience
   Finnish-first, mobile-first, no jargon
   ────────────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function humanPortalHtml(
  config: MeatConfig,
  t: TFunction,
  locale: Locale,
  stats: { agents: number; actions: number; boards: number },
): string {
  const otherLocale = locale === 'fi' ? 'en' : 'fi';
  const otherLocaleLabel = locale === 'fi' ? 'EN' : 'FI';
  const currentLocaleLabel = locale === 'fi' ? 'FI' : 'EN';

  // Example chips as JSON for JS usage
  const chipsRaw = t('cards.memories.exampleChips');
  const chips = chipsRaw.split(', ');

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="aimeat-node" content="${esc(config.baseUrl)}">
<title>${esc(t('hero.title'))} — AIME AT</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
/* ── Reset & Variables ── */
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
  --accent-glow-strong: rgba(255, 105, 180, 0.5);
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
  --nav-height: 56px;
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

/* ── Main Content ── */
.main {
  position: relative;
  z-index: 1;
  max-width: 720px;
  margin: 0 auto;
  padding: 0 1.25rem;
}

/* ── Hero Section ── */
.hero {
  text-align: center;
  padding: 4rem 0 3rem;
}

.hero-title {
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  font-weight: 800;
  color: var(--text-bright);
  line-height: 1.2;
  letter-spacing: -0.03em;
  margin-bottom: 1rem;
}

.hero-title .accent-word {
  background: linear-gradient(135deg, var(--accent), var(--accent-bright));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-subtitle {
  font-size: clamp(1rem, 2.5vw, 1.15rem);
  color: var(--text);
  max-width: 540px;
  margin: 0 auto;
  line-height: 1.7;
  opacity: 0.85;
}

/* ── Cards ── */
.cards-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 2.5rem;
}

.card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  cursor: pointer;
}

.card:hover {
  background: var(--card-bg-hover);
  border-color: var(--card-border-hover);
  box-shadow: 0 0 30px var(--card-glow), 0 8px 32px rgba(0, 0, 0, 0.3);
  transform: translateY(-2px);
}

.card.expanded {
  border-color: var(--accent);
  box-shadow: 0 0 40px var(--accent-glow), 0 12px 40px rgba(0, 0, 0, 0.4);
  cursor: default;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
}

.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  flex-shrink: 0;
  background: linear-gradient(135deg, rgba(255, 105, 180, 0.15), rgba(196, 69, 105, 0.15));
  border: 1px solid rgba(255, 105, 180, 0.2);
}

.card-icon.apps-icon {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.15));
  border-color: rgba(99, 102, 241, 0.2);
}

.card-icon.services-icon {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(16, 185, 129, 0.15));
  border-color: rgba(34, 197, 94, 0.2);
}

.card-text {
  flex: 1;
  min-width: 0;
}

.card-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-bright);
  margin-bottom: 0.15rem;
}

.card-tagline {
  font-size: 0.88rem;
  color: var(--text-dim);
}

.card-arrow {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-dim);
  font-size: 0.75rem;
  transition: all 0.3s;
}

.card.expanded .card-arrow {
  transform: rotate(180deg);
  background: rgba(255, 105, 180, 0.15);
  color: var(--accent);
}

.card-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94),
              padding 0.35s ease;
  padding: 0 1.5rem;
}

.card.expanded .card-body {
  max-height: 900px;
  padding: 0 1.5rem 1.5rem;
}

.card-desc {
  font-size: 0.92rem;
  color: var(--text);
  line-height: 1.7;
  margin-bottom: 1.25rem;
  opacity: 0.9;
}

/* ── Memory Input ── */
.memory-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.memory-input {
  width: 100%;
  padding: 0.85rem 1rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-sm);
  color: var(--text-bright);
  font-size: 0.95rem;
  font-family: var(--font);
  outline: none;
  transition: all 0.25s;
  resize: none;
}

.memory-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
  background: rgba(255, 255, 255, 0.07);
}

.memory-input::placeholder {
  color: var(--text-muted);
}

.example-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.chip {
  padding: 0.4rem 0.85rem;
  background: rgba(255, 105, 180, 0.08);
  border: 1px solid rgba(255, 105, 180, 0.2);
  border-radius: 20px;
  font-size: 0.82rem;
  color: var(--accent-bright);
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.chip:hover {
  background: rgba(255, 105, 180, 0.15);
  border-color: rgba(255, 105, 180, 0.4);
  transform: translateY(-1px);
}

.save-btn {
  align-self: flex-start;
  padding: 0.7rem 1.6rem;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.92rem;
  font-weight: 700;
  font-family: var(--font);
  cursor: pointer;
  transition: all 0.25s;
  box-shadow: 0 4px 15px rgba(255, 105, 180, 0.25);
}

.save-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 25px rgba(255, 105, 180, 0.4);
}

.save-btn:active {
  transform: translateY(0);
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* ── Success Message ── */
.save-result {
  display: none;
  margin-top: 1rem;
}

.save-result.visible {
  display: block;
  animation: fadeSlideIn 0.4s ease;
}

@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.success-box {
  background: var(--success-bg);
  border: 1px solid var(--success-border);
  border-radius: var(--radius-sm);
  padding: 1rem 1.25rem;
}

.success-box .check {
  color: var(--success);
  font-weight: 700;
  font-size: 0.95rem;
  margin-bottom: 0.4rem;
}

.success-box .note {
  font-size: 0.85rem;
  color: var(--text);
  opacity: 0.85;
  line-height: 1.6;
}

.compat-info {
  margin-top: 0.75rem;
  padding: 0.85rem 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-xs);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.compat-info .compat-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.compat-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.82rem;
  margin-bottom: 0.35rem;
  color: var(--text);
  opacity: 0.85;
}

.compat-row .dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 0.4rem;
}

.compat-row .dot.green { background: var(--success); }
.compat-row .dot.yellow { background: #f59e0b; }
.compat-row .dot.red { background: #ef4444; }

.cost-line {
  margin-top: 0.6rem;
  font-size: 0.82rem;
  color: var(--text-dim);
  font-style: italic;
}

/* ── Placeholder (Services) ── */
.coming-soon {
  text-align: center;
  padding: 1.5rem 0 0.5rem;
  color: var(--text-dim);
  font-size: 0.9rem;
}

.coming-soon .coming-badge {
  display: inline-block;
  padding: 0.3rem 0.8rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 0.75rem;
}

/* ── Apps: Category grid ── */
.cat-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  margin-top: 0.75rem;
}

@media (min-width: 768px) {
  .card.expanded .cat-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.cat-card {
  padding: 1rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.cat-card:hover {
  background: rgba(255, 105, 180, 0.08);
  border-color: rgba(255, 105, 180, 0.25);
  transform: translateY(-2px);
}

.cat-card .cat-icon { font-size: 1.5rem; margin-bottom: 0.4rem; }
.cat-card .cat-name { font-weight: 600; font-size: 0.9rem; color: var(--text-bright); }
.cat-card .cat-desc { font-size: 0.78rem; color: var(--text-dim); margin-top: 0.2rem; }

.prompt-area { display: none; margin-top: 1rem; }
.prompt-area.visible { display: block; animation: fadeSlideIn 0.3s ease; }

.prompt-box {
  width: 100%;
  min-height: 200px;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: 'Courier New', monospace;
  font-size: 0.82rem;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}

.prompt-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
}

.copy-prompt-btn {
  padding: 0.6rem 1.4rem;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 15px rgba(255, 105, 180, 0.25);
}

.copy-prompt-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 25px rgba(255, 105, 180, 0.4);
}

.back-to-cats {
  font-size: 0.85rem;
  color: var(--text-dim);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.back-to-cats:hover {
  color: var(--text);
}

.prompt-steps {
  margin-top: 0.75rem;
  font-size: 0.82rem;
  color: var(--text-dim);
  line-height: 1.7;
}

.prompt-steps ol {
  padding-left: 1.2rem;
}

.any-ai-note {
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  color: #a5b4fc;
  line-height: 1.6;
}

/* ── Morsels Footer ── */
.morsels-footer {
  text-align: center;
  padding: 2rem 0 3.5rem;
  font-size: 0.85rem;
  color: var(--text-dim);
  line-height: 1.7;
  max-width: 500px;
  margin: 0 auto;
}

.morsels-footer .heart-icon {
  display: inline-block;
  color: var(--accent);
  font-size: 0.9rem;
  margin: 0 0.15rem;
  animation: heartPulse 2s ease-in-out infinite;
}

/* ── Anonymous note ── */
.anon-banner {
  text-align: center;
  padding: 0.65rem 1rem;
  background: rgba(124, 58, 237, 0.08);
  border: 1px solid rgba(124, 58, 237, 0.2);
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  color: #c4b5fd;
  margin-bottom: 1.5rem;
}

.anon-banner a {
  color: var(--accent-bright);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* ── Responsive ── */
@media (min-width: 768px) {
  .cards-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }

  .card-header {
    flex-direction: column;
    text-align: center;
    padding: 1.5rem 1.25rem 1.25rem;
  }

  .card-text {
    text-align: center;
  }

  .card-arrow {
    align-self: center;
  }

  .card.expanded {
    grid-column: 1 / -1;
  }

  .card.expanded .card-header {
    flex-direction: row;
    text-align: left;
  }

  .card.expanded .card-text {
    text-align: left;
  }

  .hero {
    padding: 5rem 0 3.5rem;
  }

  .main {
    max-width: 800px;
  }
}

@media (max-width: 400px) {
  .topnav {
    padding: 0 0.75rem;
  }

  .card-header {
    padding: 1rem 1.15rem;
    gap: 0.75rem;
  }

  .card.expanded .card-body {
    padding: 0 1.15rem 1.15rem;
  }
}

/* ── Loading spinner for save button ── */
.save-btn.loading {
  position: relative;
  color: transparent;
  pointer-events: none;
}

.save-btn.loading::after {
  content: '';
  position: absolute;
  top: 50%; left: 50%;
  width: 18px; height: 18px;
  margin: -9px 0 0 -9px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Fade in on load ── */
.main { animation: pageIn 0.6s ease; }
@keyframes pageIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
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
    <a href="?lang=fi" class="lang-btn ${locale === 'fi' ? 'active' : ''}">${locale === 'fi' ? currentLocaleLabel : otherLocaleLabel}</a>
    <a href="?lang=en" class="lang-btn ${locale === 'en' ? 'active' : ''}">${locale === 'en' ? currentLocaleLabel : otherLocaleLabel}</a>
  </div>
  <div class="topnav-right">
    <a href="?view=dev${locale !== 'fi' ? '&lang=' + locale : ''}">${esc(t('nav.devView'))}</a>
  </div>
</nav>

<!-- Main Content -->
<div class="main">

  <!-- Hero -->
  <section class="hero">
    <h1 class="hero-title">${esc(t('hero.title'))}</h1>
    <p class="hero-subtitle">${esc(t('hero.subtitle'))}</p>
  </section>

  <!-- Anonymous note -->
  <div class="anon-banner">
    ${esc(t('hero.anonNote'))}
  </div>

  <!-- Three Cards -->
  <div class="cards-grid">

    <!-- Card 1: Memories -->
    <div class="card" id="card-memories" data-card="memories">
      <div class="card-header">
        <div class="card-icon">\u{1F4AD}</div>
        <div class="card-text">
          <div class="card-title">${esc(t('cards.memories.title'))}</div>
          <div class="card-tagline">${esc(t('cards.memories.tagline'))}</div>
        </div>
        <div class="card-arrow">\u25BC</div>
      </div>
      <div class="card-body">
        <p class="card-desc">${esc(t('cards.memories.desc'))}</p>
        <div class="memory-form">
          <textarea class="memory-input" id="memoryInput" rows="2"
                    placeholder="${esc(t('cards.memories.inputPlaceholder'))}"
                    maxlength="500"></textarea>
          <div class="example-chips" id="exampleChips">
            ${chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}
          </div>
          <button class="save-btn" id="saveBtn" type="button">
            ${esc(t('cards.memories.saveBtn'))}
          </button>
        </div>
        <div class="save-result" id="saveResult">
          <div class="success-box">
            <div class="check">\u2714 ${esc(t('cards.memories.saved'))}</div>
            <div class="note">${esc(t('cards.memories.savedNote'))}</div>
          </div>
          <div class="compat-info">
            <div class="compat-title">${esc(t('compat.title'))}</div>
            <div class="compat-row"><span class="dot green"></span> ${esc(t('compat.worksNote'))}</div>
            <div class="compat-row"><span class="dot yellow"></span> ${esc(t('compat.sometimesNote'))}</div>
            <div class="compat-row"><span class="dot red"></span> ${esc(t('compat.notYetNote'))}</div>
            <div class="compat-row" style="margin-top:0.4rem;opacity:0.7;">\u{1F504} ${esc(t('compat.workaroundNote'))}</div>
          </div>
          <div class="cost-line" id="costLine"></div>
        </div>
      </div>
    </div>

    <!-- Card 2: Apps -->
    <div class="card" id="card-apps" data-card="apps">
      <div class="card-header">
        <div class="card-icon apps-icon">\u{1F4F1}</div>
        <div class="card-text">
          <div class="card-title">${esc(t('cards.apps.title'))}</div>
          <div class="card-tagline">${esc(t('cards.apps.tagline'))}</div>
        </div>
        <div class="card-arrow">\u25BC</div>
      </div>
      <div class="card-body">
        <p class="card-desc">${esc(t('cards.apps.desc'))}</p>
        <div id="appCategories">
          <div class="cat-grid">
            <div class="cat-card" data-category="games" onclick="event.stopPropagation()">
              <div class="cat-icon">\u{1F3AE}</div>
              <div class="cat-name">${esc(t('cards.apps.categories.games'))}</div>
              <div class="cat-desc">${esc(t('cards.apps.categories.gamesDesc'))}</div>
            </div>
            <div class="cat-card" data-category="notes" onclick="event.stopPropagation()">
              <div class="cat-icon">\u{1F4DD}</div>
              <div class="cat-name">${esc(t('cards.apps.categories.notes'))}</div>
              <div class="cat-desc">${esc(t('cards.apps.categories.notesDesc'))}</div>
            </div>
            <div class="cat-card" data-category="trackers" onclick="event.stopPropagation()">
              <div class="cat-icon">\u{1F4CA}</div>
              <div class="cat-name">${esc(t('cards.apps.categories.trackers'))}</div>
              <div class="cat-desc">${esc(t('cards.apps.categories.trackersDesc'))}</div>
            </div>
            <div class="cat-card" data-category="family" onclick="event.stopPropagation()">
              <div class="cat-icon">\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}</div>
              <div class="cat-name">${esc(t('cards.apps.categories.family'))}</div>
              <div class="cat-desc">${esc(t('cards.apps.categories.familyDesc'))}</div>
            </div>
            <div class="cat-card" data-category="creative" onclick="event.stopPropagation()">
              <div class="cat-icon">\u{1F3A8}</div>
              <div class="cat-name">${esc(t('cards.apps.categories.creative'))}</div>
              <div class="cat-desc">${esc(t('cards.apps.categories.creativeDesc'))}</div>
            </div>
            <div class="cat-card" data-category="custom" onclick="event.stopPropagation()">
              <div class="cat-icon">\u{1F4A1}</div>
              <div class="cat-name">${esc(t('cards.apps.categories.custom'))}</div>
              <div class="cat-desc">${esc(t('cards.apps.categories.customDesc'))}</div>
            </div>
          </div>
          <div class="any-ai-note">${esc(t('cards.apps.anyAiWorks'))}</div>
        </div>
        <div class="prompt-area" id="promptArea">
          <textarea class="prompt-box" id="promptBox" readonly onclick="event.stopPropagation()"></textarea>
          <div class="prompt-actions">
            <button class="copy-prompt-btn" id="copyPromptBtn" type="button" onclick="event.stopPropagation()">${esc(t('cards.apps.copyPrompt'))}</button>
            <span class="back-to-cats" id="backToCats" onclick="event.stopPropagation()">\u2190 ${esc(t('cards.apps.backToCategories'))}</span>
          </div>
          <div class="prompt-steps">
            <ol>
              <li>${esc(t('cards.apps.step1'))}</li>
              <li>${esc(t('cards.apps.step2'))}</li>
              <li>${esc(t('cards.apps.step3'))}</li>
              <li>${esc(t('cards.apps.step4'))}</li>
            </ol>
          </div>
        </div>
      </div>
    </div>

    <!-- Card 3: Services -->
    <div class="card" id="card-services" data-card="services">
      <div class="card-header">
        <div class="card-icon services-icon">\u{1F91D}</div>
        <div class="card-text">
          <div class="card-title">${esc(t('cards.services.title'))}</div>
          <div class="card-tagline">${esc(t('cards.services.tagline'))}</div>
        </div>
        <div class="card-arrow">\u25BC</div>
      </div>
      <div class="card-body">
        <p class="card-desc">${esc(t('cards.services.desc'))}</p>
        <div class="coming-soon">
          <div class="coming-badge">${esc(t('comingSoon'))}</div>
        </div>
      </div>
    </div>

  </div><!-- .cards-grid -->

  <!-- Morsels summary -->
  <div class="morsels-footer">
    <span class="heart-icon">\u{1F496}</span> ${esc(t('morsels.summary'))}
  </div>

</div><!-- .main -->

<script>
(function() {
  'use strict';

  /* ── Language persistence ── */
  var LANG_KEY = 'aimeat-lang';
  var urlParams = new URLSearchParams(window.location.search);
  var langFromUrl = urlParams.get('lang');

  if (langFromUrl) {
    try { localStorage.setItem(LANG_KEY, langFromUrl); } catch(e) {}
  } else {
    try {
      var stored = localStorage.getItem(LANG_KEY);
      if (stored && (stored === 'fi' || stored === 'en')) {
        window.location.replace(window.location.pathname + '?lang=' + stored);
      }
    } catch(e) {}
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

  /* ── Card expand / collapse ── */
  var cards = document.querySelectorAll('.card');
  cards.forEach(function(card) {
    var header = card.querySelector('.card-header');
    if (!header) return;
    header.addEventListener('click', function() {
      var isExpanded = card.classList.contains('expanded');
      // Collapse all others
      cards.forEach(function(c) { c.classList.remove('expanded'); });
      // Toggle this one
      if (!isExpanded) {
        card.classList.add('expanded');
        // Scroll into view smoothly
        setTimeout(function() {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
      }
    });
  });

  /* ── Example chips fill input ── */
  var chips = document.querySelectorAll('.chip');
  var memoryInput = document.getElementById('memoryInput');
  chips.forEach(function(chip) {
    chip.addEventListener('click', function(e) {
      e.stopPropagation();
      if (memoryInput) {
        memoryInput.value = chip.textContent;
        memoryInput.focus();
      }
    });
  });

  /* ── Save memory ── */
  var saveBtn = document.getElementById('saveBtn');
  var saveResult = document.getElementById('saveResult');
  var costLine = document.getElementById('costLine');

  if (saveBtn && memoryInput) {
    saveBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var text = memoryInput.value.trim();
      if (!text) { memoryInput.focus(); return; }
      if (text.length > 500) return;

      saveBtn.disabled = true;
      saveBtn.classList.add('loading');

      fetch('/v1/portal/try-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        saveBtn.disabled = false;
        saveBtn.classList.remove('loading');
        if (data.ok && saveResult) {
          saveResult.classList.add('visible');
          if (costLine) {
            costLine.textContent = '';
          }
        }
      })
      .catch(function() {
        saveBtn.disabled = false;
        saveBtn.classList.remove('loading');
      });
    });

    // Prevent card toggle when interacting with form elements
    memoryInput.addEventListener('click', function(e) { e.stopPropagation(); });
  }

  /* ── Apps: Category selection & prompt templates ── */
  var catCards = document.querySelectorAll('.cat-card');
  var appCategories = document.getElementById('appCategories');
  var promptArea = document.getElementById('promptArea');
  var promptBox = document.getElementById('promptBox');
  var copyPromptBtn = document.getElementById('copyPromptBtn');
  var backToCats = document.getElementById('backToCats');
  var copyLabel = '${esc(t('cards.apps.copyPrompt'))}';
  var copiedLabel = '${esc(t('cards.apps.copied'))}';

  var nodeUrl = (document.querySelector('meta[name="aimeat-node"]') || {}).content || window.location.origin;

  var basePrompt = function(catDesc, extras) {
    return 'Build me ' + catDesc + ' as a single self-contained HTML file with CSS and JavaScript.\\n\\n' +
      'The app should store its data using this memory API:\\n' +
      '- Server: ' + nodeUrl + '\\n' +
      '- Save data: POST ' + nodeUrl + '/v1/memory with body: {"key": "apps.[APP_TYPE].[UNIQUE_ID]", "value": {...your data...}, "visibility": "public", "ttl_hours": 24}\\n' +
      '- Read data: GET ' + nodeUrl + '/v1/memory/[key]\\n' +
      '- List keys: GET ' + nodeUrl + '/v1/memory?prefix=apps.[APP_TYPE]\\n' +
      '- No authentication needed (anonymous mode is enabled)\\n' +
      '- Content-Type: application/json for POST requests\\n' +
      '- The API returns JSON wrapped in: { "ok": true, "data": { ... } }\\n\\n' +
      'Requirements:\\n' +
      '- Single HTML file, all CSS and JS inline\\n' +
      '- Dark theme with dark background (#0a0a1a) and pink accent (#ff69b4)\\n' +
      '- Mobile-friendly, works on any screen size\\n' +
      '- Clean, modern UI\\n' +
      '- The app should work immediately when opened in a browser\\n' +
      extras + '\\n\\n' +
      'After generating the file, I will save it as .html and open it in my browser.';
  };

  var prompts = {
    games: basePrompt('a multiplayer tic-tac-toe game',
      '- Multiplayer game where Player 1 creates a game and gets a shareable link (use URL hash #gameId)\\n' +
      '- Player 2 opens the link to join\\n' +
      '- Poll every 2 seconds for opponent moves\\n' +
      '- Game state stored in memory with key like "apps.ttt.[random-id]"\\n' +
      '- Show game status: waiting for opponent, your turn, opponent turn, you won, you lost, draw'),
    notes: basePrompt('a simple note-taking app',
      '- Create, read, and list notes\\n' +
      '- Each note stored as a separate memory key: "apps.notes.[note-id]"\\n' +
      '- Show a list of saved notes with timestamps\\n' +
      '- Click a note to view or edit it\\n' +
      '- Add a delete button for each note'),
    trackers: basePrompt('a habit and budget tracker',
      '- Daily entries for habits or expenses\\n' +
      '- Each entry stored as: "apps.tracker.[date]"\\n' +
      '- Show a list view of past entries\\n' +
      '- Simple progress indicators or summary stats\\n' +
      '- Add and remove tracked items'),
    family: basePrompt('a shared family shopping list',
      '- Shareable via URL so family members can access the same list\\n' +
      '- Real-time updates by polling memory every 3 seconds\\n' +
      '- Add and check off items\\n' +
      '- All data stored under a shared key like "apps.family.[list-id]"\\n' +
      '- Show who added what (use a simple name prompt on first visit)'),
    creative: basePrompt('a drawing canvas app',
      '- Simple drawing canvas with color picker and brush size\\n' +
      '- Save drawings to memory for persistence\\n' +
      '- Gallery view of past creations (store as data URLs)\\n' +
      '- Clear canvas and undo functionality\\n' +
      '- Each drawing stored as "apps.art.[drawing-id]"'),
    custom: 'Build me [DESCRIBE WHAT YOU WANT] as a single self-contained HTML file with CSS and JavaScript.\\n\\n' +
      'The app should store its data using this memory API:\\n' +
      '- Server: ' + nodeUrl + '\\n' +
      '- Save data: POST ' + nodeUrl + '/v1/memory with body: {"key": "apps.[APP_TYPE].[UNIQUE_ID]", "value": {...your data...}, "visibility": "public", "ttl_hours": 24}\\n' +
      '- Read data: GET ' + nodeUrl + '/v1/memory/[key]\\n' +
      '- List keys: GET ' + nodeUrl + '/v1/memory?prefix=apps.[APP_TYPE]\\n' +
      '- No authentication needed (anonymous mode is enabled)\\n' +
      '- Content-Type: application/json for POST requests\\n' +
      '- The API returns JSON wrapped in: { "ok": true, "data": { ... } }\\n\\n' +
      'Requirements:\\n' +
      '- Single HTML file, all CSS and JS inline\\n' +
      '- Dark theme with dark background (#0a0a1a) and pink accent (#ff69b4)\\n' +
      '- Mobile-friendly, works on any screen size\\n' +
      '- Clean, modern UI\\n' +
      '- The app should work immediately when opened in a browser\\n\\n' +
      'After generating the file, I will save it as .html and open it in my browser.'
  };

  catCards.forEach(function(cat) {
    cat.addEventListener('click', function(e) {
      e.stopPropagation();
      var catId = cat.dataset.category;
      if (prompts[catId] && promptBox) {
        promptBox.value = prompts[catId];
        if (appCategories) appCategories.style.display = 'none';
        if (promptArea) promptArea.classList.add('visible');
      }
    });
  });

  if (backToCats) {
    backToCats.addEventListener('click', function(e) {
      e.stopPropagation();
      if (promptArea) promptArea.classList.remove('visible');
      if (appCategories) appCategories.style.display = '';
    });
  }

  if (copyPromptBtn && promptBox) {
    copyPromptBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      navigator.clipboard.writeText(promptBox.value).then(function() {
        copyPromptBtn.textContent = copiedLabel;
        setTimeout(function() { copyPromptBtn.textContent = copyLabel; }, 2000);
      });
    });
  }

})();
<\/script>
</body>
</html>`;
}

/* ──────────────────────────────────────────────────────────
   Router — anonymous memory save endpoint
   ────────────────────────────────────────────────────────── */

export function humanPortalRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  router.post('/v1/portal/try-memory', requireAuth(), async (req, res) => {
    const text = req.body?.text;
    if (!text || typeof text !== 'string' || text.length > 500) {
      res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Text required (max 500 chars)'));
      return;
    }

    const gaii = req.auth!.sub;
    const key = `try.${Date.now()}`;

    await storage.setMemory({
      key,
      ownerGaii: gaii,
      value: { text },
      visibility: 'public',
      tags: [],
      ttlHours: 24,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, { key, saved: true }));
  });

  return router;
}
