/**
 * @file Card.js
 * @description Canonical themed card container (.card). Renders an optional
 *   header (title/subtitle) and arbitrary children. The `variant` prop selects
 *   a tokenized modifier — `variant="glass"` adds `.card-glass` (the former
 *   profile `.pf-glass-card` appearance) so profile's GlassCard can delegate here.
 * @structure Card({ title, subtitle, onClick, hoverable, className, variant, children })
 * @usage import { Card } from '/components/Card.js';  html`<${Card} variant="glass">…<//>`
 * @version-history
 *   v1.0.0 — prior — Initial canonical card (title/subtitle/hoverable/className).
 *   v1.1.0 — 2026-06-02 — Component unification (#22): add `variant` prop;
 *     `variant="glass"` appends `.card-glass` so profile's GlassCard folds into Card.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * Card — themed card container.
 * @param {{ title?: string, subtitle?: string, onClick?: () => void, hoverable?: boolean, className?: string, variant?: 'glass', children: any }} props
 */
export function Card({ title, subtitle, onClick, hoverable = true, className = '', variant, children }) {
  const variantClass = variant === 'glass' ? 'card-glass' : '';
  return html`
    <div class="card ${variantClass} ${hoverable ? 'card-hoverable' : ''} ${className}" onClick=${onClick}>
      ${(title || subtitle) && html`
        <div class="card-header">
          ${title && html`<span class="card-title">${title}</span>`}
          ${subtitle && html`<span class="card-subtitle">${subtitle}</span>`}
        </div>`}
      ${children}
    </div>`;
}
