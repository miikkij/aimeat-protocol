/**
 * AIMEAT View Template
 * ─────────────────────────────────────────────────────────────────────────────
 * Copy this file to create a new view:
 *   cp public/views/_template.js public/views/myview.js
 *
 * Then:
 *   1. Rename the export function: MyView → YourView
 *   2. Add a route case in spa.html matchRoute() and the import map
 *   3. Add a server-side fallback route in src/routes/portal.ts
 *   4. Add a nav link in spa.html header (if the view needs one)
 *   5. Add translation keys under "myview.*" in locales/en.json + locales/fi.json
 *   6. Create public/css/views/myview.css for view-specific styles
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { h }                       from 'preact';
import htm                         from 'htm';
import { useState, useEffect }     from 'preact/hooks';
const html = htm.bind(h);
import { t }                       from '/js/i18n.js';
import { escHtml }                 from '/js/utils.js';
import { apiGet, apiPost }         from '/js/api.js';
import { useApiCall }              from '/js/hooks.js';

/**
 * MyView — replace with your view's name and description.
 *
 * @param {object}   props
 * @param {function} props.navigate - SPA router, e.g. navigate('/v1/profile')
 * @param {string}   props.locale   - Active locale ('en' | 'fi')
 */
export default function MyView({ navigate, locale }) {

  // ── Load view CSS ──────────────────────────────────────────────────────────
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/views/myview.css';
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  // ── Data fetching (Option A: useApiCall hook) ──────────────────────────────
  const { data, error, loading, reload } = useApiCall('/v1/your-endpoint');

  // ── Data fetching (Option B: manual — use when you need multiple endpoints) ─
  // const [items, setItems] = useState([]);
  // useEffect(() => {
  //   apiGet('/v1/your-endpoint').then(r => { if (r.ok) setItems(r.data); });
  // }, []);

  // ── Local state ────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    const r = await apiPost('/v1/your-endpoint', { key: 'value' });
    setSubmitting(false);
    if (r.ok) reload();
  }

  // ── Render states ──────────────────────────────────────────────────────────
  if (loading) return html`<div class="view-loading">${t('loading')}</div>`;
  if (error)   return html`<div class="alert alert-error">${escHtml(error)}</div>`;

  // ── Main render ────────────────────────────────────────────────────────────
  return html`
    <div class="myview-container">
      <h1>${t('myview.title')}</h1>

      ${data && html`
        <p>${escHtml(data.someField)}</p>
      `}

      <form onSubmit=${handleSubmit}>
        <button type="submit" class="btn btn-primary" disabled=${submitting}>
          ${submitting ? t('saving') : t('myview.submit')}
        </button>
      </form>

      <button class="btn btn-ghost" onClick=${() => navigate('/v1/portal')}>
        ${t('nav.back')}
      </button>
    </div>
  `;
}
