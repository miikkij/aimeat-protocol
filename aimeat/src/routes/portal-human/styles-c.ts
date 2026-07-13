/**
 * @file src/routes/portal-human/styles-c.ts
 * @description Human portal page CSS (part C of 3), a static style string. Extracted from src/routes/portal-human.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-human.ts (max-file-lines)
 */

export const PORTAL_CSS_C = `  border-radius: var(--radius-sm);
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

/* ── Group sections ── */
.group-section {
  max-width: 700px;
  margin: 2.5rem auto;
  padding: 0 1rem;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  padding: 1rem 1.25rem;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
  transition: background 0.2s, border-color 0.2s;
}

.group-header:hover {
  background: var(--card-bg-hover);
  border-color: var(--card-border-hover);
}

.group-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.group-text {
  flex: 1;
}

.group-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-bright);
}

.group-desc {
  font-size: 0.85rem;
  color: var(--text-dim);
  margin-top: 0.25rem;
  line-height: 1.4;
}

.group-arrow {
  font-size: 0.75rem;
  color: var(--text-muted);
  transition: transform 0.3s;
}

.group-section.expanded .group-arrow {
  transform: rotate(180deg);
}

.group-body {
  display: none;
  padding: 1.25rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-top: 0;
  border-radius: 0 0 var(--radius) var(--radius);
}

.group-section.expanded .group-body {
  display: block;
}

.group-body .mega-prompt-area {
  margin-top: 1rem;
}

.mega-prompt-box {
  width: 100%;
  min-height: 200px;
  max-height: 400px;
  font-family: 'Courier New', monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  background: rgba(0, 0, 0, 0.4);
  color: var(--text);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 1rem;
  resize: vertical;
}

.mega-prompt-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}

.mega-copy-btn {
  padding: 0.6rem 1.5rem;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.mega-copy-btn:hover {
  opacity: 0.9;
}

.mega-steps {
  font-size: 0.82rem;
  color: var(--text-dim);
  line-height: 1.5;
  margin-top: 0.5rem;
}

.group-catalog-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1.25rem;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  border-radius: 8px;
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 600;
  margin-top: 1rem;
  transition: opacity 0.2s;
}

.group-catalog-link:hover {
  opacity: 0.9;
}

.group-register-box {
  margin-top: 1.5rem;
  padding: 1.25rem;
  background: rgba(124, 58, 237, 0.12);
  border: 1px solid rgba(124, 58, 237, 0.3);
  border-radius: 12px;
  text-align: center;
}

.group-register-box .group-register-title {
  font-weight: 700;
  font-size: 1rem;
  color: var(--text-bright);
  margin-bottom: 0.5rem;
}

.group-register-box .group-register-desc {
  font-size: 0.85rem;
  color: var(--text-dim);
  margin-bottom: 1rem;
  line-height: 1.4;
}

.group-register-btn {
  display: inline-block;
  padding: 0.5rem 1.5rem;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  transition: opacity 0.2s;
}

.group-register-btn:hover {
  opacity: 0.9;
}

/* ── Welcome board ── */
.welcome-section {
  max-width: 700px;
  margin: 1.5rem auto;
  padding: 0 1rem;
}

.welcome-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-bright);
  margin-bottom: 0.75rem;
}

.welcome-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 0.75rem;
}

.welcome-msg {
  padding: 0.5rem 0.75rem;
  background: var(--card-bg);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.welcome-msg-text {
  font-size: 0.9rem;
  color: var(--text);
  word-break: break-word;
}

.welcome-msg-time {
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.welcome-form {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.welcome-input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: var(--text);
  font-size: 0.9rem;
  outline: none;
}

.welcome-input:focus {
  border-color: var(--accent);
}

.welcome-send-btn {
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.welcome-send-btn:hover {
  opacity: 0.9;
}

.welcome-sent {
  display: none;
  font-size: 0.85rem;
  color: var(--success);
  margin-top: 0.5rem;
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
`;
