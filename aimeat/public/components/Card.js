import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * Card — themed card container.
 * @param {{ title?: string, subtitle?: string, onClick?: () => void, hoverable?: boolean, className?: string, children: any }} props
 */
export function Card({ title, subtitle, onClick, hoverable = true, className = '', children }) {
  return html`
    <div class="card ${hoverable ? 'card-hoverable' : ''} ${className}" onClick=${onClick}>
      ${(title || subtitle) && html`
        <div class="card-header">
          ${title && html`<span class="card-title">${title}</span>`}
          ${subtitle && html`<span class="card-subtitle">${subtitle}</span>`}
        </div>`}
      ${children}
    </div>`;
}
