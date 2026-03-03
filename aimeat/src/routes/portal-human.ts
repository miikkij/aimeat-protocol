import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Locale, TFunction } from '../i18n.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

/* ──────────────────────────────────────────────────────────
   Human-facing portal page — "try it now" experience
   Finnish-first, mobile-first, no jargon
   ──────────────────────────────────────────────────────────

   ⚠️  ESCAPING RULES — DO NOT REMOVE THIS COMMENT  ⚠️

   This file builds JS code inside HTML template literals.
   There are TWO levels of escaping at play:

   Level 1: TypeScript template literal (backticks)
     - \' is consumed by TS → outputs just '
     - \n is consumed by TS → outputs a real newline

   Level 2: Browser JS string (single quotes in rendered HTML)
     - The rendered JS uses '...' strings that the browser parses

   CORRECT patterns inside template literal JS strings:
     \\n   → renders as \n  (JS newline escape in browser)   ✅
     \\\\'  → renders as \'  (escaped quote in browser)       ✅
     <scr' + 'ipt>  → avoids closing the HTML script block   ✅
     <\\/script>      → avoids closing the HTML script block  ✅

   WRONG patterns (will cause SyntaxError in browser):
     \n   → renders as real newline → breaks JS string        ❌
     \\'   → renders as ' → terminates JS string prematurely  ❌
     </script> → closes the HTML script block early           ❌

   When adding text with apostrophes (e.g. "everyone's",
   "who's", "others' content"), always use \\\\' so the
   rendered output contains \' which the browser treats
   as an escaped quote inside the JS string.

   ────────────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escape for embedding in JS single-quoted strings inside template literals */
function jesc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function humanPortalHtml(
  config: AimeatConfig,
  t: TFunction,
  locale: Locale,
  stats: { agents: number; chatSessions: number; actions: number; boards: number },
): string {
  const otherLocale = locale === 'fi' ? 'en' : 'fi';
  const otherLocaleLabel = locale === 'fi' ? 'EN' : 'FI';
  const currentLocaleLabel = locale === 'fi' ? 'FI' : 'EN';

  // Example chips — t() joins arrays with ', ' so chips must not contain commas
  const chips = t('cards.memory.exampleChips').split(', ');

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
  max-height: 1200px;
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

/* ── Board messages ── */
.board-messages {
  margin-bottom: 1rem;
}

.board-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}

.board-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.2);
}

.board-empty {
  padding: 1rem;
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: italic;
}

.board-msg {
  padding: 0.6rem 0.85rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 0.88rem;
  color: var(--text);
  line-height: 1.5;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
}

.board-msg:last-child {
  border-bottom: none;
}

.board-msg-text {
  flex: 1;
  word-break: break-word;
}

.board-msg-time {
  font-size: 0.7rem;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.board-msg-del {
  font-size: 0.7rem;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0.5;
  flex-shrink: 0;
}

.board-msg-del:hover {
  color: #ef4444;
  opacity: 1;
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

/* ── Use with any AI (post-save) ── */
.use-with-ai {
  margin-top: 1rem;
}

.use-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.instruction-block {
  width: 100%;
  min-height: 60px;
  padding: 0.85rem 1rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-sm);
  color: var(--text-bright);
  font-family: var(--font);
  font-size: 0.88rem;
  line-height: 1.6;
  resize: none;
  outline: none;
}

.instruction-actions {
  margin-top: 0.6rem;
}

.copy-instruction-btn {
  padding: 0.55rem 1.3rem;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 15px rgba(255, 105, 180, 0.25);
  font-family: var(--font);
}

.copy-instruction-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 25px rgba(255, 105, 180, 0.4);
}

.instruction-hint {
  margin-top: 0.6rem;
  font-size: 0.82rem;
  color: var(--text);
  line-height: 1.6;
  opacity: 0.8;
}

.auto-note {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-style: italic;
}

/* ── Upgrade nudge ── */
.upgrade-nudge {
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  background: rgba(124, 58, 237, 0.06);
  border: 1px solid rgba(124, 58, 237, 0.15);
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  color: #c4b5fd;
  line-height: 1.6;
  text-align: center;
}

.upgrade-nudge a {
  display: inline-block;
  margin-top: 0.4rem;
  color: var(--accent-bright);
  text-decoration: underline;
  text-underline-offset: 2px;
  font-weight: 600;
}

/* ── Service action buttons ── */
.service-actions {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.service-btn {
  flex: 1;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-sm);
  text-align: center;
  transition: all 0.2s;
  cursor: pointer;
}

.service-btn:hover {
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.25);
  transform: translateY(-2px);
}

.service-btn-title {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--text-bright);
  margin-bottom: 0.3rem;
}

.service-btn-desc {
  font-size: 0.82rem;
  color: var(--text-dim);
}

/* ── Service form ── */
.service-form {
  display: none;
  margin-top: 0.5rem;
}

.service-form.visible {
  display: block;
  animation: fadeSlideIn 0.3s ease;
}

.service-input {
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

.service-input:focus {
  border-color: var(--success);
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15);
  background: rgba(255, 255, 255, 0.07);
}

.service-input::placeholder {
  color: var(--text-muted);
}

.service-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.6rem;
}

.service-chip {
  padding: 0.4rem 0.85rem;
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: 20px;
  font-size: 0.82rem;
  color: #86efac;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.service-chip:hover {
  background: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.4);
  transform: translateY(-1px);
}

.service-form-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.75rem;
}

.service-submit-btn {
  padding: 0.7rem 1.6rem;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.92rem;
  font-weight: 700;
  font-family: var(--font);
  cursor: pointer;
  transition: all 0.25s;
  box-shadow: 0 4px 15px rgba(34, 197, 94, 0.25);
}

.service-submit-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 25px rgba(34, 197, 94, 0.4);
}

.service-submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.service-submit-btn.loading {
  position: relative;
  color: transparent;
  pointer-events: none;
}

.service-submit-btn.loading::after {
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

.service-back {
  font-size: 0.85rem;
  color: var(--text-dim);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.service-back:hover {
  color: var(--text);
}

.service-result {
  display: none;
  margin-top: 1rem;
}

.service-result.visible {
  display: block;
  animation: fadeSlideIn 0.4s ease;
}

.service-success {
  background: var(--success-bg);
  border: 1px solid var(--success-border);
  border-radius: var(--radius-sm);
  padding: 1rem 1.25rem;
}

.service-success .check {
  color: var(--success);
  font-weight: 700;
  font-size: 0.95rem;
  margin-bottom: 0.4rem;
}

.service-success .note {
  font-size: 0.85rem;
  color: var(--text);
  opacity: 0.85;
  line-height: 1.6;
}

/* ── Service registration CTA ── */
.service-register {
  display: none;
  margin-top: 0.75rem;
}

.service-register.visible {
  display: block;
  animation: fadeSlideIn 0.4s ease;
}

.register-cta {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.06), rgba(34, 197, 94, 0.02));
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: var(--radius);
  padding: 1.5rem;
  text-align: center;
}

.register-cta-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-bright);
  margin-bottom: 0.5rem;
}

.register-cta-desc {
  font-size: 0.88rem;
  color: var(--text);
  line-height: 1.6;
  margin-bottom: 1rem;
  opacity: 0.85;
}

.register-benefits {
  list-style: none;
  text-align: left;
  max-width: 320px;
  margin: 0 auto 1.25rem;
}

.register-benefits li {
  padding: 0.35rem 0;
  font-size: 0.88rem;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.register-benefits li::before {
  content: '\u2714';
  color: var(--success);
  font-weight: 700;
  font-size: 0.9rem;
  flex-shrink: 0;
}

.register-cta-btn {
  display: inline-block;
  padding: 0.75rem 2rem;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 1rem;
  font-weight: 700;
  font-family: var(--font);
  cursor: pointer;
  text-decoration: none;
  transition: all 0.25s;
  box-shadow: 0 4px 20px rgba(34, 197, 94, 0.3);
}

.register-cta-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 30px rgba(34, 197, 94, 0.5);
  color: #fff;
  text-decoration: none;
}

.register-signin {
  margin-top: 0.75rem;
  font-size: 0.82rem;
  color: var(--text-dim);
}

.register-signin a {
  color: #86efac;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.register-signin a:hover {
  color: #22c55e;
}

/* ── "What can you do" features section ── */
.more-section {
  max-width: 700px;
  margin: 2rem auto 3rem;
  padding: 0 1rem;
}

.more-section-title {
  text-align: center;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-bright);
  margin-bottom: 1.25rem;
}

.more-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
}

.more-item {
  padding: 1rem;
  background: var(--card-bg);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-sm);
  transition: background 0.2s, border-color 0.2s;
}

.more-item:hover {
  background: var(--card-bg-hover);
  border-color: rgba(255, 255, 255, 0.12);
}

.more-item-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text);
}

.more-item-desc {
  font-size: 0.82rem;
  color: var(--text-dim);
  margin-top: 0.25rem;
  line-height: 1.4;
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

    <!-- Card 1: Memory (shared public board) -->
    <div class="card" id="card-memory" data-card="memory">
      <div class="card-header">
        <div class="card-icon">\u{1F4AC}</div>
        <div class="card-text">
          <div class="card-title">${esc(t('cards.memory.title'))}</div>
          <div class="card-tagline">${esc(t('cards.memory.tagline'))}</div>
        </div>
        <div class="card-arrow">\u25BC</div>
      </div>
      <div class="card-body">
        <p class="card-desc">${esc(t('cards.memory.desc'))}</p>

        <!-- Recent messages -->
        <div class="board-messages" id="boardMessages">
          <div class="board-title">${esc(t('cards.memory.recentTitle'))}</div>
          <div class="board-list" id="boardList">
            <div class="board-empty" id="boardEmpty">${esc(t('cards.memory.emptyBoard'))}</div>
          </div>
        </div>

        <!-- Send form -->
        <div class="memory-form">
          <textarea class="memory-input" id="memoryInput" rows="2"
                    placeholder="${esc(t('cards.memory.inputPlaceholder'))}"
                    maxlength="280" onclick="event.stopPropagation()"></textarea>
          <div class="example-chips" id="exampleChips">
            ${chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}
          </div>
          <button class="save-btn" id="sendBtn" type="button" onclick="event.stopPropagation()">
            ${esc(t('cards.memory.sendBtn'))}
          </button>
        </div>

        <!-- Post-send: prompt to build app -->
        <div class="save-result" id="sendResult">
          <div class="success-box">
            <div class="check">\u2714 ${esc(t('cards.memory.sent'))}</div>
            <div class="note">${esc(t('cards.memory.sentNote'))}</div>
          </div>
          <div class="use-with-ai">
            <div class="use-title">${esc(t('cards.memory.buildApp'))}</div>
            <textarea class="instruction-block" id="instructionBlock" readonly onclick="event.stopPropagation()"></textarea>
            <div class="instruction-actions">
              <button class="copy-instruction-btn" id="copyInstructionBtn" type="button" onclick="event.stopPropagation()">${esc(t('cards.memory.copyInstructions'))}</button>
            </div>
            <div class="instruction-hint">${esc(t('cards.memory.pasteHint'))}</div>
          </div>
          <div class="upgrade-nudge">
            ${esc(t('cards.memory.upgradeNote'))}
            <a href="/v1/portal?view=dev">${esc(t('hero.createAccount'))}</a>
          </div>
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
            <div class="cat-card" data-category="band" onclick="event.stopPropagation()">
              <div class="cat-icon">\u{1F3B5}</div>
              <div class="cat-name">${esc(t('cards.apps.categories.band'))}</div>
              <div class="cat-desc">${esc(t('cards.apps.categories.bandDesc'))}</div>
            </div>
            <div class="cat-card" data-category="realtime" onclick="event.stopPropagation()">
              <div class="cat-icon">\u{1F4E1}</div>
              <div class="cat-name">${esc(t('cards.apps.categories.realtime'))}</div>
              <div class="cat-desc">${esc(t('cards.apps.categories.realtimeDesc'))}</div>
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
          <div style="font-size:.8rem;color:var(--text-muted);margin-top:.5rem;font-style:italic">${esc(t('cards.apps.promptLangNote'))}</div>
          <div class="prompt-steps">
            <ol>
              <li>${esc(t('cards.apps.step1'))}</li>
              <li>${esc(t('cards.apps.step2'))}</li>
              <li>${esc(t('cards.apps.step3'))}</li>
              <li>${esc(t('cards.apps.step4'))}</li>
            </ol>
          </div>
          <div style="margin-top:1.5rem;padding:1.25rem;background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);border-radius:12px">
            <div style="font-weight:700;font-size:1rem;margin-bottom:.75rem">${esc(t('cards.apps.returnTitle'))}</div>
            <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:.75rem">${esc(t('cards.apps.returnMotivation'))}</div>
            <ol style="font-size:.85rem;color:var(--text-muted);margin:0 0 1rem 1.25rem;padding:0">
              <li style="margin-bottom:.25rem">${esc(t('cards.apps.returnStep1'))}</li>
              <li style="margin-bottom:.25rem">${esc(t('cards.apps.returnStep2'))}</li>
              <li>${esc(t('cards.apps.returnStep3'))}</li>
            </ol>
            <button class="copy-prompt-btn" id="return-app-btn" data-auth-text="${esc(t('cards.apps.returnBtnAuth'))}" style="font-size:.85rem;padding:.5rem 1.25rem">${esc(t('cards.apps.returnBtnAnon'))}</button>
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
        <div class="service-actions" id="serviceChoices">
          <div class="service-btn" id="needHelpBtn" onclick="event.stopPropagation()">
            <div class="service-btn-title">${esc(t('cards.services.needHelp'))}</div>
            <div class="service-btn-desc">${esc(t('cards.services.needHelpDesc'))}</div>
          </div>
          <div class="service-btn" id="offerHelpBtn" onclick="event.stopPropagation()">
            <div class="service-btn-title">${esc(t('cards.services.offerHelp'))}</div>
            <div class="service-btn-desc">${esc(t('cards.services.offerHelpDesc'))}</div>
          </div>
        </div>

        <!-- Need help form -->
        <div class="service-form" id="needHelpForm" onclick="event.stopPropagation()">
          <textarea class="service-input" id="needHelpInput" rows="3" placeholder="${esc(t('cards.services.needHelpPlaceholder'))}"></textarea>
          <div class="service-chips" id="needHelpChips"></div>
          <div class="service-form-actions">
            <button class="service-submit-btn" id="submitRequestBtn">${esc(t('cards.services.submitRequest'))}</button>
            <span class="back-link" onclick="hideServiceForm()">${esc(t('cards.services.backToChoices'))}</span>
          </div>
          <div class="service-result" id="needHelpResult" style="display:none;margin-top:0.75rem;padding:0.75rem;background:rgba(34,197,94,0.1);border-radius:8px;color:#86efac;font-size:0.9rem"></div>
        </div>

        <!-- Offer help form -->
        <div class="service-form" id="offerHelpForm" onclick="event.stopPropagation()">
          <textarea class="service-input" id="offerHelpInput" rows="3" placeholder="${esc(t('cards.services.offerHelpPlaceholder'))}"></textarea>
          <div class="service-chips" id="offerHelpChips"></div>
          <div class="service-form-actions">
            <button class="service-submit-btn" id="submitOfferBtn">${esc(t('cards.services.submitOffer'))}</button>
            <span class="back-link" onclick="hideServiceForm()">${esc(t('cards.services.backToChoices'))}</span>
          </div>
          <div class="service-result" id="offerHelpResult" style="display:none;margin-top:0.75rem;padding:0.75rem;background:rgba(34,197,94,0.1);border-radius:8px;color:#86efac;font-size:0.9rem"></div>
        </div>
      </div>
    </div>

  </div><!-- .cards-grid -->

  <!-- Morsels summary -->
  <div class="morsels-footer">
    <span class="heart-icon">\u{1F496}</span> ${esc(t('morsels.summary'))}
  </div>

  <!-- What can you do with AIMEAT section -->
  <div class="more-section">
    <div class="more-section-title">${esc(t('more.sectionTitle'))}</div>
    <div class="more-grid">
      <a href="/v1/guide/ai-news" class="more-item" style="text-decoration:none;color:inherit">
        <div class="more-item-title">${esc(t('more.aiNews'))}</div>
        <div class="more-item-desc">${esc(t('more.aiNewsDesc'))}</div>
      </a>
      <a href="/v1/guide/monitor" class="more-item" style="text-decoration:none;color:inherit">
        <div class="more-item-title">${esc(t('more.monitor'))}</div>
        <div class="more-item-desc">${esc(t('more.monitorDesc'))}</div>
      </a>
      <a href="/v1/guide/multi-agent" class="more-item" style="text-decoration:none;color:inherit">
        <div class="more-item-title">${esc(t('more.multiAgent'))}</div>
        <div class="more-item-desc">${esc(t('more.multiAgentDesc'))}</div>
      </a>
      <a href="/v1/guide/directory" class="more-item" style="text-decoration:none;color:inherit">
        <div class="more-item-title">${esc(t('more.directory'))}</div>
        <div class="more-item-desc">${esc(t('more.directoryDesc'))}</div>
      </a>
      <a href="/v1/guide/build-apps" class="more-item" style="text-decoration:none;color:inherit">
        <div class="more-item-title">${esc(t('more.buildApps'))}</div>
        <div class="more-item-desc">${esc(t('more.buildAppsDesc'))}</div>
      </a>
    </div>
  </div>

</div><!-- .main -->

<script src="${config.baseUrl}/v1/libs/aimeat-auth.js"></script>
<script>
(function() {
  'use strict';

  /* ── Modal i18n strings ── */
  var __modalI18n = {
    title: '${jesc(t('modal.title'))}',
    descNew: '${jesc(t('modal.descNew'))}',
    descReturning: '${jesc(t('modal.descReturning'))}',
    usernamePlaceholder: '${jesc(t('modal.usernamePlaceholder'))}',
    passwordPlaceholder: '${jesc(t('modal.passwordPlaceholder'))}',
    displayNamePlaceholder: '${jesc(t('modal.displayNamePlaceholder'))}',
    signInBtn: '${jesc(t('modal.signInBtn'))}',
    cancelBtn: '${jesc(t('modal.cancelBtn'))}',
    working: '${jesc(t('modal.working'))}',
    errUserShort: '${jesc(t('modal.errUserShort'))}',
    errPassShort: '${jesc(t('modal.errPassShort'))}',
    errWrongPass: '${jesc(t('modal.errWrongPass'))}',
    loggedIn: '${jesc(t('modal.loggedIn'))}',
    logoutBtn: '${jesc(t('modal.logoutBtn'))}',
    whyTitle: '${jesc(t('modal.whyTitle'))}',
    whyGhii: '${jesc(t('modal.whyGhii'))}',
    whyPrivacy: '${jesc(t('modal.whyPrivacy'))}',
    whyControl: '${jesc(t('modal.whyControl'))}',
    whyAgents: '${jesc(t('modal.whyAgents'))}',
    whyMorsels: '${jesc(t('modal.whyMorsels'))}'
  };

  /* ── Clipboard helper (fallback for HTTP) ── */
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

  /* ── Board: fetch recent messages ── */
  var boardList = document.getElementById('boardList');
  var boardEmpty = document.getElementById('boardEmpty');
  var BOARD_KEY = 'board.public';

  function timeAgo(iso) {
    var sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return sec + 's';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h';
    return Math.floor(hr / 24) + 'd';
  }

  function renderBoard(messages) {
    if (!boardList) return;
    if (!messages || messages.length === 0) {
      boardList.innerHTML = '<div class="board-empty">${jesc(t('cards.memory.emptyBoard'))}</div>';
      return;
    }
    boardList.innerHTML = '';
    messages.slice(-20).reverse().forEach(function(m) {
      var div = document.createElement('div');
      div.className = 'board-msg';
      div.innerHTML = '<span class="board-msg-text"></span><span class="board-msg-time">' + timeAgo(m.t) + '</span>';
      div.querySelector('.board-msg-text').textContent = m.msg;
      boardList.appendChild(div);
    });
  }

  function loadBoard() {
    fetch('/v1/memory/' + BOARD_KEY)
      .then(function(r) {
        if (!r.ok) return null;
        return r.json();
      })
      .then(function(d) {
        if (d && d.ok && d.data && d.data.value && d.data.value.messages) {
          renderBoard(d.data.value.messages);
        }
      })
      .catch(function() {});
  }

  loadBoard();

  /* ── Send message to board ── */
  var sendBtn = document.getElementById('sendBtn');
  var sendResult = document.getElementById('sendResult');
  var instructionBlock = document.getElementById('instructionBlock');

  if (sendBtn && memoryInput) {
    sendBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var text = memoryInput.value.trim();
      if (!text) { memoryInput.focus(); return; }
      if (text.length > 280) return;

      sendBtn.disabled = true;
      sendBtn.classList.add('loading');

      fetch('/v1/portal/try-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        sendBtn.disabled = false;
        sendBtn.classList.remove('loading');
        if (data.ok) {
          memoryInput.value = '';
          /* Reload board to show new message */
          loadBoard();
          /* Show prompt section */
          if (sendResult) sendResult.classList.add('visible');
          if (instructionBlock) {
            var listUrl = nodeUrl + '/v1/memory/' + BOARD_KEY;
            var writeUrl = nodeUrl + '/v1/memory';
            instructionBlock.value =
              'There is an AIME AT protocol server at ' + nodeUrl + ' with a public message board.\\n\\n' +
              '## Data structure\\n' +
              'Read the board: GET ' + listUrl + '\\n' +
              'Response JSON: { ok: true, data: { value: { messages: [ { msg: "text", t: "ISO timestamp" }, ... ] } } }\\n' +
              'Messages are in data.value.messages — an array of objects, each with "msg" (the message text) and "t" (ISO 8601 timestamp). Newest messages are last in the array.\\n\\n' +
              'Post / update the board: POST ' + writeUrl + '\\n' +
              'Content-Type: application/json\\n' +
              'Body: {"key":"' + BOARD_KEY + '","value":{"messages":[...existing messages..., {"msg":"NEW MESSAGE","t":"2026-01-15T12:00:00.000Z"}]},"visibility":"public"}\\n' +
              'IMPORTANT: Always read the existing messages first (GET), then append the new one to the array, and POST the full updated array back. This is a read-modify-write pattern.\\n\\n' +
              '## OPTION A — If you can fetch URLs (Claude Pro, Grok):\\n' +
              'Fetch the board URL above, show me the messages, and help me post new ones using the POST method described above.\\n\\n' +
              '## OPTION B — If you cannot fetch URLs:\\n' +
              'Before building, ask me two questions:\\n' +
              '1. What should the board be called? (e.g. "Neighborhood Board", "Game Night Chat", "Family Messages")\\n' +
              '2. How should it feel? (e.g. "cozy and warm", "sleek and minimal", "fun and colorful", "professional")\\n' +
              'Use my answers to customize the title, colors, fonts, and overall vibe of the board.\\n\\n' +
              'Then build a single self-contained HTML file that I will save and open in my browser. Requirements:\\n\\n' +
              '1. On load, fetch GET ' + listUrl + ' and display all messages from data.value.messages\\n' +
              '2. Show each message with its text and a human-readable relative time (e.g. "2 minutes ago"), newest first\\n' +
              '3. Show a "Last updated: [time]" label so the user knows when data was last fetched\\n' +
              '4. A "Refresh" button that manually re-fetches and updates the message list\\n' +
              '5. An auto-refresh toggle (checkbox or button) — when enabled, re-fetches every 15 seconds. Default: off\\n' +
              '6. A text input + Send button to post new messages\\n' +
              '7. To send: GET existing board, append new {msg, t} to the messages array, POST the full updated object back to ' + writeUrl + '\\n' +
              '8. After sending, immediately refresh the message list to show the new message\\n' +
              '9. Dark theme (#0a0a1a background, #ff69b4 pink accent), mobile-friendly, clean readable layout\\n\\n' +
              'Make the HTML a downloadable file. This is a live API — the URLs work right now.';
          }
        }
      })
      .catch(function() {
        sendBtn.disabled = false;
        sendBtn.classList.remove('loading');
      });
    });
  }

  /* ── Copy instruction to clipboard ── */
  var copyInstructionBtn = document.getElementById('copyInstructionBtn');
  var copyInstructionLabel = '${jesc(t('cards.memory.copyInstructions'))}';
  var copiedInstructionLabel = '${jesc(t('cards.memory.copiedInstructions'))}';

  if (copyInstructionBtn && instructionBlock) {
    copyInstructionBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      copyToClipboard(instructionBlock.value).then(function() {
        copyInstructionBtn.textContent = copiedInstructionLabel;
        setTimeout(function() { copyInstructionBtn.textContent = copyInstructionLabel; }, 2000);
      });
    });
  }

  /* ── Apps: Category selection & prompt templates ── */
  var catCards = document.querySelectorAll('.cat-card');
  var appCategories = document.getElementById('appCategories');
  var promptArea = document.getElementById('promptArea');
  var promptBox = document.getElementById('promptBox');
  var copyPromptBtn = document.getElementById('copyPromptBtn');
  var backToCats = document.getElementById('backToCats');
  var copyLabel = '${jesc(t('cards.apps.copyPrompt'))}';
  var copiedLabel = '${jesc(t('cards.apps.copied'))}';

  var nodeUrl = (document.querySelector('meta[name="aimeat-node"]') || {}).content || window.location.origin;
  var anonGaii = encodeURIComponent('shared#anonymous@${jesc(config.nodeId)}');

  var askUser = 'Before building, ask me:\\n' +
    '1. What should the app be called?\\n' +
    '2. How should it look and feel? (e.g. "cozy and warm", "sleek and minimal", "fun and colorful", "professional")\\n' +
    '3. Memory area: Should this app use its OWN private space, or a SHARED community space where I can see what others have made and add mine?\\n' +
    '   - OWN: create a unique key like "apps.[type].[my-unique-id]" — only I see my data\\n' +
    '   - SHARED: use the community key given below — I see others\\' content and can add mine\\n' +
    'Use my answers to customize everything.\\n\\n';

  var apiRef = '## Data storage API\\n' +
    'Server: ' + nodeUrl + ' (no authentication needed, anonymous mode)\\n' +
    'Save data: POST ' + nodeUrl + '/v1/memory\\n' +
    'Content-Type: application/json\\n' +
    'Body: {"key": "apps.[TYPE].[ID]", "value": {...your data...}, "visibility": "public", "ttl_hours": 24}\\n' +
    'Read data: GET ' + nodeUrl + '/v1/memory/apps.[TYPE].[ID]\\n' +
    'Response: { ok: true, data: { key: "...", value: {...your data...}, ... } }\\n' +
    'List keys: GET ' + nodeUrl + '/v1/memory?prefix=apps.[TYPE]\\n' +
    'IMPORTANT: When updating, always GET first, modify, then POST back (read-modify-write).\\n\\n';

  var baseReqs = 'General requirements:\\n' +
    '- Single HTML file, all CSS and JS inline, no external dependencies\\n' +
    '- Mobile-friendly, works on any screen size\\n' +
    '- Clean, modern UI\\n' +
    '- Works immediately when opened in a browser\\n';

  var realtimeRef = '## Realtime P2P API (optional \\u2014 for live multiplayer)\\n' +
    'Your app can create real-time rooms where multiple users interact live (no polling needed).\\n' +
    'Client library: <scr' + 'ipt src="' + nodeUrl + '/lib/realtime.js"><\\/scr' + 'ipt>\\n\\n' +
    'Quick start:\\n' +
    '  const rt = new AimeatRealtime("' + nodeUrl + '", token);\\n' +
    '  // token comes from: POST ' + nodeUrl + '/v1/auth/anonymous \\u2192 response.data.token\\n' +
    '  const room = await rt.createRoom({ app_type: "[TYPE]", name: "My Room" });\\n' +
    '  rt.connect(room.id, playerName);\\n' +
    '  rt.on("joined", (msg) => console.log("My peer ID:", msg.peerId, "Peers:", msg.peers));\\n' +
    '  rt.on("peer-joined", (msg) => console.log("New peer:", msg.nick));\\n' +
    '  rt.on("peer-left", (msg) => console.log("Peer left:", msg.peerId));\\n' +
    '  rt.on("broadcast", (msg) => console.log("From", msg.from, ":", msg.payload));\\n' +
    '  rt.broadcast({ action: "move", x: 10, y: 20 }); // send to all peers\\n' +
    '  rt.presence({ status: "ready", cursor: {x:100, y:200} }); // share state\\n' +
    '  rt.on("peer-presence", (msg) => console.log(msg.peerId, "state:", msg.state));\\n\\n' +
    'Room lifecycle:\\n' +
    '  - Create: rt.createRoom({ app_type, name, max_peers, is_public, tags })\\n' +
    '  - List: rt.listRooms({ app_type }) \\u2192 rooms array\\n' +
    '  - Connect: rt.connect(roomId, nickname)\\n' +
    '  - Disconnect: rt.disconnect()\\n' +
    '  - Broadcast (to all): rt.broadcast(payload)\\n' +
    '  - Signal (to one peer): rt.signal(peerId, payload) \\u2014 for WebRTC handshake\\n' +
    '  - Presence (share state): rt.presence({ key: value })\\n' +
    '  - Leave: rt.leave()\\n\\n' +
    'Events: joined, peer-joined, peer-left, peer-presence, broadcast, signal, error, open, close\\n' +
    'IMPORTANT: Get an anonymous auth token FIRST, then pass it to AimeatRealtime constructor:\\n' +
    '  const authRes = await fetch("' + nodeUrl + '/v1/auth/anonymous", { method: "POST" });\\n' +
    '  const { data: { token } } = await authRes.json();\\n\\n';

  var baseEnd = '\\nMake the HTML a downloadable file. This is a live API — the URLs work right now.' +
    '\\n\\n## If Something Doesn\\'t Work\\n' +
    'After giving the user the download link or HTML file, always add this message at the end:\\n' +
    '"If the app doesn\\'t work as expected or you see errors, don\\'t worry — tell me what happened and we\\'ll fix it together!\\n\\n' +
    'Here\\'s how to check for errors:\\n' +
    '1. Open the app in your browser\\n' +
    '2. Press F12 (or right-click → Inspect) to open Developer Tools\\n' +
    '3. Click the \\'Console\\' tab\\n' +
    '4. If you see red error messages, copy them and paste them here\\n' +
    '5. I\\'ll analyze the errors and give you a fixed version\\n\\n' +
    'Even if there are no console errors — just describe what\\'s wrong (e.g. \\'the button doesn\\'t do anything\\', \\'I see a blank page\\', \\'the data doesn\\'t save\\') and I\\'ll investigate."';

  var prompts = {
    games: 'Before building, ask me:\\n' +
      '1. What should the game be called?\\n' +
      '2. What type of game? (e.g. "tic-tac-toe", "connect four", "battleship", "trivia quiz", "word game")\\n' +
      '3. How should it look and feel? (e.g. "retro arcade", "cozy board game", "sleek and minimal", "fun and colorful")\\n' +
      '4. Memory area: SHARED community lobby (default \u2014 all players see the same lobby and can join each other), or PRIVATE lobby (only people with the link)?\\n' +
      'Use my answers to customize the title, game type, colors, fonts, and overall vibe.\\n\\n' +
      'I want a multiplayer game with a lobby system as a single self-contained HTML file.\\n\\n' +
      apiRef +
      realtimeRef +
      'NOTE: For real-time multiplayer (instant moves, no polling) use the Realtime P2P API above. ' +
      'For turn-based games, the memory API polling approach below also works fine.\\n\\n' +
      'NOTE: The lobby is already a shared community space by default \u2014 all players see the same lobby and can join each other\\'s games.\\n' +
      'If user wants a PRIVATE lobby, use a unique key like "apps.games.[gametype].private.[uniqueId].lobby" instead.\\n\\n' +
      '## Data structure\\n\\n' +
      'Each game type gets its own memory area. The key format is:\\n' +
      '- Lobby: "apps.games.[gametype].lobby"\\n' +
      '- Individual game: "apps.games.[gametype].[gameId]"\\n\\n' +
      'Lobby format (stored at apps.games.[gametype].lobby):\\n' +
      '{"games": [{"id": "abc123", "name": "My Game Room", "host": "Mika", "status": "waiting", "players": 1, "maxPlayers": 2, "created": "ISO timestamp"}, ...]}\\n\\n' +
      'Game data format (stored at apps.games.[gametype].[gameId]):\\n' +
      '{"id": "abc123", "name": "My Game Room", "type": "[gametype]", "players": [{"name": "Mika", "joinedAt": "ISO"}, {"name": "Liisa", "joinedAt": "ISO"}], "state": {...game-specific state...}, "turn": "Mika", "status": "playing", "winner": null, "created": "ISO", "updated": "ISO"}\\n\\n' +
      'Game requirements:\\n' +
      '1. On first visit, ask the player their name (save to localStorage)\\n' +
      '2. Show lobby screen: list of open games (fetched from lobby key), with host name, status, and player count\\n' +
      '3. "Create Game" button — creates a new game, adds it to the lobby, and waits for opponent\\n' +
      '4. "Join" button on each waiting game — joins the game, updates lobby status\\n' +
      '5. Once two players are in, the game starts. Poll every 2 seconds for opponent moves\\n' +
      '6. Show game status: waiting for opponent, your turn, opponent\\'s turn, you won, you lost, draw\\n' +
      '7. When game ends, update lobby to remove it or mark as finished\\n' +
      '8. "Back to Lobby" button to return and play again\\n' +
      '9. Lobby auto-refreshes every 5 seconds to show new games\\n\\n' +
      'General requirements:\\n' +
      '- Single HTML file, all CSS and JS inline, no external dependencies\\n' +
      '- Mobile-friendly, works on any screen size\\n' +
      '- Game-like UI — bold visuals, fun animations, satisfying interactions, sound effects if possible\\n' +
      '- Works immediately when opened in a browser\\n' + baseEnd,

    notes: askUser +
      'I want a note-taking app as a single self-contained HTML file.\\n\\n' +
      apiRef +
      '## Shared community board (if user chooses SHARED):\\n' +
      'Key: "apps.notes.community.board"\\n' +
      'Read: GET ' + nodeUrl + '/v1/memory/apps.notes.community.board\\n' +
      'Format: {"items": [{"id":"unique","author":"Name","title":"Note title","body":"Note content","created":"ISO timestamp"},...]}\\n' +
      'To add: GET existing items, append new item to items array, POST full updated object back.\\n' +
      'Show all community notes in a feed/list. Each note shows author name and time. Let user add their own with their name.\\n\\n' +
      'App requirements:\\n' +
      '- Create, view, edit, and delete notes\\n' +
      '- If OWN: each note stored as "apps.notes.[note-id]" with value: {title, body, created, updated}\\n' +
      '- If SHARED: all notes stored at "apps.notes.community.board" in items array — show everyone\\'s notes\\n' +
      '- Sidebar or list view showing all saved notes with titles and timestamps\\n' +
      '- Click a note to view or edit it\\n' +
      '- Search or filter notes\\n\\n' +
      baseReqs + baseEnd,

    trackers: askUser +
      'I want a tracker app as a single self-contained HTML file.\\n\\n' +
      apiRef +
      '## Shared community dashboard (if user chooses SHARED):\\n' +
      'Key: "apps.tracker.community.dashboard"\\n' +
      'Read: GET ' + nodeUrl + '/v1/memory/apps.tracker.community.dashboard\\n' +
      'Format: {"items": [{"id":"unique","author":"Name","category":"habit or expense or custom","entries":[{"date":"ISO","value":"..."}],"created":"ISO"},...]}\\n' +
      'To add: GET existing items, append new item to items array, POST full updated object back.\\n' +
      'Show a shared leaderboard/dashboard of everyone\\'s tracked items. Let user add theirs with their name.\\n\\n' +
      'App requirements:\\n' +
      '- Track daily habits, expenses, or anything the user wants\\n' +
      '- If OWN: each entry stored as "apps.tracker.[date]" with value: {items: [...], date}\\n' +
      '- If SHARED: all entries stored at "apps.tracker.community.dashboard" in items array — show everyone\\'s progress\\n' +
      '- Calendar or list view of past entries\\n' +
      '- Simple charts or progress indicators\\n' +
      '- Add and remove tracked items\\n\\n' +
      baseReqs + baseEnd,

    family: askUser +
      'I want a shared family tool as a single self-contained HTML file.\\n\\n' +
      apiRef +
      'NOTE: This category is already shared via URL hash — family members access the same data.\\n' +
      'If user chooses SHARED, it means a PUBLIC community list visible to everyone (not just family).\\n\\n' +
      '## Public community lists (if user chooses SHARED):\\n' +
      'Key: "apps.family.community.lists"\\n' +
      'Read: GET ' + nodeUrl + '/v1/memory/apps.family.community.lists\\n' +
      'Format: {"items": [{"id":"unique","author":"Name","listName":"Shopping list","entries":[{"text":"Milk","done":false,"addedBy":"Name"}],"created":"ISO"},...]}\\n' +
      'To add: GET existing items, append new item to items array, POST full updated object back.\\n' +
      'Show all public lists. Let user create and contribute to shared lists with their name.\\n\\n' +
      'App requirements:\\n' +
      '- Shareable via URL so family members can access the same data (use URL hash #listId)\\n' +
      '- Auto-refresh by polling memory every 3 seconds to see others\\' changes\\n' +
      '- Add and check off items (shopping list, to-do, etc.)\\n' +
      '- If OWN: all data under shared key "apps.family.[list-id]"\\n' +
      '- If SHARED: public lists at "apps.family.community.lists" — visible to all visitors\\n' +
      '- Ask for name on first visit so items show who added them\\n\\n' +
      baseReqs + baseEnd,

    creative: askUser +
      'I want a creative tool as a single self-contained HTML file.\\n\\n' +
      apiRef +
      '## File storage API (for images)\\n' +
      'Use the storage API to save images — it supports much larger files than memory.\\n' +
      'Upload image: POST ' + nodeUrl + '/v1/storage\\n' +
      'Content-Type: application/json\\n' +
      'Body: {"key": "apps/art/[unique-id].png", "data": "<base64-encoded-image>", "mime_type": "image/png", "visibility": "public"}\\n' +
      'Response: { ok: true, data: { key: "apps/art/[unique-id].png", size: 12345, ... } }\\n' +
      'Public image URL (for <img> tags): ' + nodeUrl + '/v1/pub/' + anonGaii + '/apps/art/[unique-id].png\\n' +
      'IMPORTANT: To convert canvas to base64 for upload, use canvas.toDataURL("image/png").split(",")[1] to get the raw base64 WITHOUT the data:image/png;base64, prefix.\\n\\n' +
      '## Shared community gallery (if user chooses SHARED):\\n' +
      'Store the gallery INDEX (metadata only, no image data) in memory:\\n' +
      'Key: "apps.art.community.gallery"\\n' +
      'Read: GET ' + nodeUrl + '/v1/memory/apps.art.community.gallery\\n' +
      'Format: {"items": [{"id":"unique","author":"Name","title":"Artwork title","storageKey":"apps/art/[id].png","created":"ISO timestamp"},...]}\\n' +
      'To add: First upload image to storage, then GET existing gallery items, append new item with storageKey (NOT base64 data), POST gallery back to memory.\\n' +
      'Display images using the public URL: <img src="' + nodeUrl + '/v1/pub/' + anonGaii + '/[storageKey]">\\n' +
      'Show all community artwork in a gallery grid. Each piece shows author name, title and time. Let user save their drawing alongside others.\\n\\n' +
      'App requirements:\\n' +
      '- Drawing canvas with color picker and brush size\\n' +
      '- Upload images to storage API (not memory) — storage supports large files\\n' +
      '- If OWN: upload to storage with key "apps/art/[drawing-id].png", store metadata in memory at "apps.art.[drawing-id]"\\n' +
      '- If SHARED: upload to storage, then add metadata (with storageKey) to "apps.art.community.gallery" items array\\n' +
      '- Gallery view: load metadata from memory, display images via public storage URL\\n' +
      '- Clear canvas, undo, and download image\\n\\n' +
      baseReqs + baseEnd,

    custom: askUser +
      'I want [DESCRIBE YOUR IDEA HERE] as a single self-contained HTML file.\\n\\n' +
      apiRef +
      '## Shared community option (if user chooses SHARED):\\n' +
      'Ask the user what to call the shared space (e.g. "apps.custom.community.[name]").\\n' +
      'Use the same pattern: store data as {"items": [...]} at the shared key.\\n' +
      'Read: GET ' + nodeUrl + '/v1/memory/apps.custom.community.[name]\\n' +
      'To add: GET existing items, append new item to items array, POST full updated object back.\\n' +
      'Show all community items and let user add theirs with their name.\\n\\n' +
      baseReqs + '\\n' +
      'Ask me what the app should do before building it.' + baseEnd,

    band: 'Before building, ask me:\\n' +
      '1. What should the jam session be called?\\n' +
      '2. What instruments should be available? (e.g. "drums, guitar, bass, synth, piano")\\n' +
      '3. How should it look and feel? (e.g. "dark neon studio", "cozy wooden stage", "retro arcade")\\n' +
      '4. How many musicians at once? (2\\u201320)\\n' +
      'Use my answers to customize everything.\\n\\n' +
      'I want a real-time jam session app where multiple people can play music together simultaneously.\\n\\n' +
      apiRef +
      realtimeRef +
      '## How it should work\\n' +
      '1. On first visit, ask for a musician name (save to localStorage)\\n' +
      '2. Show a "Stage Finder": list of active rooms via rt.listRooms({ app_type: "band" })\\n' +
      '3. "Create Session" and "Join" buttons\\n' +
      '4. Once connected, show a virtual instrument panel (touchable keyboard/pads/strings)\\n' +
      '5. Each player picks an instrument. Broadcast note events in real-time\\n' +
      '6. Use Web Audio API to synthesize sounds locally\\n' +
      '7. Show all connected musicians with their instrument choice (via presence)\\n' +
      '8. Broadcast format: { instrument: "guitar", note: "C4", velocity: 0.7, duration: 0.5 }\\n' +
      '9. Each peer renders incoming notes to audio locally (Web Audio API)\\n' +
      '10. Show "Now Playing" indicator when peers play notes\\n' +
      '11. "Leave Session" button to disconnect\\n\\n' +
      '## Architecture Notes\\n' +
      '- Audio does NOT travel through the server \\u2014 each client synthesizes sound locally from note events\\n' +
      '- Note events (instrument, note, velocity) are tiny JSON messages via WebSocket broadcast\\n' +
      '- This keeps latency minimal (only a few ms for the JSON message vs. streaming raw audio)\\n' +
      '- For full audio streaming (e.g. real microphone input), use WebRTC P2P audio channels\\n\\n' +
      '## Instruments\\n' +
      'Implement at least 3 instruments using Web Audio API:\\n' +
      '- Drums: Grid of pads (kick, snare, hi-hat, tom) that trigger percussion sounds via OscillatorNode/noise\\n' +
      '- Synth/Keys: Chromatic keyboard (1-2 octaves) with OscillatorNode (sine/square/sawtooth)\\n' +
      '- Bass: Simple bass synth with lower octave notes\\n\\n' +
      'Each instrument should produce short, recognizable sounds even with basic oscillators.\\n\\n' +
      '## Auth setup\\n' +
      'The app must first get an anonymous auth token:\\n' +
      '  const authRes = await fetch("' + nodeUrl + '/v1/auth/anonymous", { method: "POST" });\\n' +
      '  const { data: { token } } = await authRes.json();\\n' +
      'Then create the realtime client: new AimeatRealtime("' + nodeUrl + '", token)\\n\\n' +
      baseReqs +
      '- Include <scr' + 'ipt src="' + nodeUrl + '/lib/realtime.js"><\\/scr' + 'ipt> for the realtime client library\\n' +
      '- Use WebSocket-based realtime API (NOT polling) for all live interactions\\n' +
      '- Mobile-friendly \\u2014 pads/keys work on touch screens\\n' +
      '- Dark, studio-like UI\\n' + baseEnd,

    realtime: 'Before building, ask me:\\n' +
      '1. What should the app be called?\\n' +
      '2. What type of real-time experience? (e.g. "collaborative whiteboard", "live chat room", "multiplayer game", "jam session", "shared timer")\\n' +
      '3. How should it look and feel? (e.g. "sleek and minimal", "fun and colorful", "dark mode gaming")\\n' +
      '4. How many people at once? (2–20)\\n' +
      'Use my answers to customize everything.\\n\\n' +
      'I want a real-time collaborative app where multiple people interact simultaneously — no page refreshing, instant updates.\\n\\n' +
      apiRef +
      realtimeRef +
      '## How it should work\\n' +
      '1. On first visit, ask the user for a display name (save to localStorage)\\n' +
      '2. Show a room browser: list of active rooms (via rt.listRooms({ app_type: "[TYPE]" }))\\n' +
      '3. "Create Room" button — creates a new room and connects to it\\n' +
      '4. "Join" button on each room — connects to that room\\n' +
      '5. Once connected, show the live experience with peer list sidebar\\n' +
      '6. All interactions broadcast instantly to all peers (NO polling)\\n' +
      '7. Show who\\'s online and their status via presence\\n' +
      '8. Handle peer join/leave gracefully with notifications\\n' +
      '9. "Leave Room" button to disconnect and return to room browser\\n\\n' +
      '## Auth setup\\n' +
      'The app must first get an anonymous auth token:\\n' +
      '  const authRes = await fetch("' + nodeUrl + '/v1/auth/anonymous", { method: "POST" });\\n' +
      '  const { data: { token } } = await authRes.json();\\n' +
      'Then create the realtime client: new AimeatRealtime("' + nodeUrl + '", token)\\n\\n' +
      baseReqs +
      '- Include <scr' + 'ipt src="' + nodeUrl + '/lib/realtime.js"><\\/scr' + 'ipt> for the realtime client library\\n' +
      '- Use WebSocket-based realtime API (NOT polling) for all live interactions\\n' +
      '- Show connection status indicator (connected / disconnected / reconnecting)\\n' + baseEnd
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
      copyToClipboard(promptBox.value).then(function() {
        copyPromptBtn.textContent = copiedLabel;
        setTimeout(function() { copyPromptBtn.textContent = copyLabel; }, 2000);
      });
    });
  }

  /* ── Apps: Return flow button ── */
  var returnBtn = document.getElementById('return-app-btn');
  if (returnBtn) {
    returnBtn.addEventListener('click', function() {
      if (typeof AIMEAT === 'undefined' || !AIMEAT.auth) return;
      var existing = AIMEAT.auth.getSession();

      /* Already logged in → go to profile apps tab */
      if (existing && existing.token) {
        window.location.href = '/v1/profile?tab=apps';
        return;
      }

      /* Not logged in → open sign-in modal */
      var tmp = document.createElement('div');
      tmp.id = 'aimeat-return-auth';
      tmp.style.position = 'fixed';
      tmp.style.top = '-9999px';
      document.body.appendChild(tmp);
      AIMEAT.auth.mountLoginButton('#aimeat-return-auth', {
        nodeUrl: '${jesc(config.baseUrl)}',
        i18n: __modalI18n,
        onLogin: function(session) {
          tmp.remove();
          window.location.href = '/v1/profile?tab=apps';
        }
      });
      var loginBtn = document.getElementById('aimeat-login-btn');
      if (loginBtn) loginBtn.click();
    });
    // Update text if already logged in
    setTimeout(function() {
      if (typeof AIMEAT !== 'undefined' && AIMEAT.auth && AIMEAT.auth.hasSession) {
        returnBtn.textContent = returnBtn.dataset.authText;
      }
    }, 500);
  }

  /* ── Services: need help / offer help ── */
  var needHelpBtn = document.getElementById('needHelpBtn');
  var offerHelpBtn = document.getElementById('offerHelpBtn');
  var needHelpForm = document.getElementById('needHelpForm');
  var offerHelpForm = document.getElementById('offerHelpForm');
  var serviceChoices = document.getElementById('serviceChoices');

  /* Populate example chips */
  var needHelpExamples = [${t('cards.services.needHelpExamples').split(', ').map(s => `'${jesc(s)}'`).join(',')}];
  var offerHelpExamples = [${t('cards.services.offerHelpExamples').split(', ').map(s => `'${jesc(s)}'`).join(',')}];

  function populateChips(containerId, examples, inputId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    examples.forEach(function(ex) {
      var chip = document.createElement('span');
      chip.className = 'service-chip';
      chip.textContent = ex;
      chip.addEventListener('click', function() {
        var input = document.getElementById(inputId);
        if (input) input.value = ex;
      });
      container.appendChild(chip);
    });
  }
  populateChips('needHelpChips', needHelpExamples, 'needHelpInput');
  populateChips('offerHelpChips', offerHelpExamples, 'offerHelpInput');

  function showServiceForm(mode) {
    if (typeof AIMEAT === 'undefined' || !AIMEAT.auth) return;
    var existing = AIMEAT.auth.getSession();

    /* Not logged in → open sign-in modal */
    if (!existing || !existing.token) {
      var tmp = document.createElement('div');
      tmp.id = 'aimeat-service-auth';
      tmp.style.position = 'fixed';
      tmp.style.top = '-9999px';
      document.body.appendChild(tmp);
      AIMEAT.auth.mountLoginButton('#aimeat-service-auth', {
        nodeUrl: '${jesc(config.baseUrl)}',
        i18n: __modalI18n,
        onLogin: function(session) {
          tmp.remove();
          showServiceForm(mode);
        }
      });
      var loginBtn = document.getElementById('aimeat-login-btn');
      if (loginBtn) loginBtn.click();
      return;
    }

    /* Logged in → show the form */
    if (serviceChoices) serviceChoices.style.display = 'none';
    if (mode === 'request') {
      if (needHelpForm) needHelpForm.classList.add('visible');
      if (offerHelpForm) offerHelpForm.classList.remove('visible');
    } else {
      if (offerHelpForm) offerHelpForm.classList.add('visible');
      if (needHelpForm) needHelpForm.classList.remove('visible');
    }
  }

  function hideServiceForm() {
    if (needHelpForm) needHelpForm.classList.remove('visible');
    if (offerHelpForm) offerHelpForm.classList.remove('visible');
    if (serviceChoices) serviceChoices.style.display = '';
  }

  if (needHelpBtn) {
    needHelpBtn.addEventListener('click', function(e) { e.stopPropagation(); showServiceForm('request'); });
  }
  if (offerHelpBtn) {
    offerHelpBtn.addEventListener('click', function(e) { e.stopPropagation(); showServiceForm('offer'); });
  }

  /* Submit request */
  var submitRequestBtn = document.getElementById('submitRequestBtn');
  if (submitRequestBtn) {
    submitRequestBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var input = document.getElementById('needHelpInput');
      var text = input ? input.value.trim() : '';
      if (!text) return;
      var session = AIMEAT.auth.getSession();
      if (!session || !session.token) return;
      submitRequestBtn.disabled = true;
      submitRequestBtn.textContent = '...';
      fetch('${jesc(config.baseUrl)}/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.token },
        body: JSON.stringify({ key: 'service-request:' + Date.now(), value: { type: 'service_request', text: text, created: new Date().toISOString() }, visibility: 'node' })
      }).then(function(r) { return r.json(); }).then(function(data) {
        var result = document.getElementById('needHelpResult');
        if (result) {
          result.textContent = '${jesc(t('cards.services.posted'))} ${jesc(t('cards.services.requestPosted'))}';
          result.style.display = 'block';
        }
        if (input) input.value = '';
        submitRequestBtn.disabled = false;
        submitRequestBtn.textContent = '${jesc(t('cards.services.submitRequest'))}';
      }).catch(function() {
        submitRequestBtn.disabled = false;
        submitRequestBtn.textContent = '${jesc(t('cards.services.submitRequest'))}';
      });
    });
  }

  /* Submit offer */
  var submitOfferBtn = document.getElementById('submitOfferBtn');
  if (submitOfferBtn) {
    submitOfferBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var input = document.getElementById('offerHelpInput');
      var text = input ? input.value.trim() : '';
      if (!text) return;
      var session = AIMEAT.auth.getSession();
      if (!session || !session.token) return;
      submitOfferBtn.disabled = true;
      submitOfferBtn.textContent = '...';
      fetch('${jesc(config.baseUrl)}/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.token },
        body: JSON.stringify({ key: 'service-offer:' + Date.now(), value: { type: 'service_offer', text: text, created: new Date().toISOString() }, visibility: 'node' })
      }).then(function(r) { return r.json(); }).then(function(data) {
        var result = document.getElementById('offerHelpResult');
        if (result) {
          result.textContent = '${jesc(t('cards.services.posted'))} ${jesc(t('cards.services.offerPosted'))}';
          result.style.display = 'block';
        }
        if (input) input.value = '';
        submitOfferBtn.disabled = false;
        submitOfferBtn.textContent = '${jesc(t('cards.services.submitOffer'))}';
      }).catch(function() {
        submitOfferBtn.disabled = false;
        submitOfferBtn.textContent = '${jesc(t('cards.services.submitOffer'))}';
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

export function humanPortalRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.post('/v1/portal/try-memory', requireAuth(), async (req, res) => {
    const text = req.body?.text;
    if (!text || typeof text !== 'string' || text.length > 280) {
      res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Text required (max 280 chars)'));
      return;
    }

    const gaii = req.auth!.sub;
    const boardKey = 'board.public';

    // Read existing board
    const existing = await storage.getMemory(gaii, boardKey);
    const val = existing?.value as Record<string, unknown> | undefined;
    let messages: { msg: string; t: string }[] = [];
    if (val?.messages && Array.isArray(val.messages)) {
      messages = val.messages as { msg: string; t: string }[];
    }

    // Append new message, keep last 20
    messages.push({ msg: text, t: new Date().toISOString() });
    if (messages.length > 20) messages = messages.slice(-20);

    // Write back
    await storage.setMemory({
      key: boardKey,
      ownerGaii: gaii,
      value: { messages },
      visibility: 'public',
      tags: ['board'],
      ttlHours: 72,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, { posted: true, count: messages.length }));
  });

  return router;
}
