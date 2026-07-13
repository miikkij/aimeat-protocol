/**
 * @file src/routes/portal-human/styles-a.ts
 * @description Human portal page CSS (part A of 3), a static style string. Extracted from src/routes/portal-human.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-human.ts (max-file-lines)
 */

export const PORTAL_CSS_A = `/* ── Reset & Variables ── */
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

.card-icon.launcher-icon {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(245, 158, 11, 0.15));
  border-color: rgba(251, 191, 36, 0.2);
}

.launcher-features {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin: 1rem 0;
}

.launcher-feature {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--text);
}

.launcher-feature .feat-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
  margin-top: 0.1rem;
}

.launcher-feature .feat-text {
  font-size: 0.85rem;
  color: var(--text-dim);
  line-height: 1.4;
}

.launcher-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding: 0.7rem 1.5rem;
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.2));
  border: 1px solid rgba(251, 191, 36, 0.4);
  border-radius: 10px;
  color: var(--text-bright);
  font-weight: 700;
  font-size: 0.95rem;
  text-decoration: none;
  transition: all 0.2s;
}

.launcher-cta:hover {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.3), rgba(245, 158, 11, 0.3));
  box-shadow: 0 0 20px rgba(251, 191, 36, 0.15);
  transform: translateY(-1px);
}

.launcher-cta.secondary {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.15);
  font-weight: 600;
  font-size: 0.9rem;
}

.launcher-cta.secondary:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(251, 191, 36, 0.4);
  box-shadow: 0 0 16px rgba(251, 191, 36, 0.1);
}

.launcher-or {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 1.25rem 0;
  color: var(--text-dim);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.launcher-or::before,
.launcher-or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--card-border);
}

.launcher-customize {
  background: rgba(251, 191, 36, 0.06);
  border: 1px solid rgba(251, 191, 36, 0.15);
  border-radius: 12px;
  padding: 1.25rem;
}

.launcher-customize-title {
  font-weight: 700;
  font-size: 1rem;
  margin-bottom: 0.5rem;
  color: var(--text-bright);
}

.launcher-customize-desc {
  font-size: 0.85rem;
  color: var(--text-dim);
  line-height: 1.5;
  margin-bottom: 1rem;
}

.launcher-steps {
  font-size: 0.85rem;
  color: var(--text);
  margin: 0 0 1rem 1.25rem;
  padding: 0;
}

.launcher-steps li {
  margin-bottom: 0.35rem;
}

.launcher-badges {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.75rem;
}

.launcher-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 0.25rem 0.6rem;
}

@media (max-width: 500px) {
  .launcher-features {
    grid-template-columns: 1fr;
  }
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
`;
