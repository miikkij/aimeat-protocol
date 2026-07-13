/**
 * @file src/routes/portal-human/styles-b.ts
 * @description Human portal page CSS (part B of 3), a static style string. Extracted from src/routes/portal-human.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-human.ts (max-file-lines)
 */

export const PORTAL_CSS_B = `  cursor: pointer;
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
`;
