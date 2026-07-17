/**
 * @file public/views/_template.js
 * @description Scaffold template for a new AIMEAT SPA view (Preact + HTM) — copy-and-rename
 *   starting point demonstrating view CSS loading, data fetching, form submit, and render states.
 *
 * @structure
 *   - MyView (default export): example view showing useApiCall data fetch + manual apiPost submit
 *   - Header block: step-by-step checklist for wiring a new view (route, import map, portal fallback, i18n, css)
 *
 * @usage cp public/views/_template.js public/views/myview.js, then follow the numbered steps below.
 *
 * @version-history
 *   v1.1.0 — 2026-07-17 — Teach the canonical patterns instead of anti-patterns:
 *     buttons use `.btn-primary`/`.btn-ghost` directly (there is NO `.btn` base class),
 *     the header uses `.page-title`/`.section-title`+`.section-desc`, and the render
 *     states delegate to the canonical <Spinner>/<EmptyState> components. Copying this
 *     scaffold now seeds good habits, not `class="btn btn-*"` + raw <h1>.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
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
import { apiPost }                 from '/js/api.js';
import { useApiCall }              from '/js/hooks.js';
// Canonical primitives — prefer these over hand-rolled spinners/empty divs/dots.
// Import each component directly (every view does; each has its own importmap entry).
import { Spinner }                 from '/components/Spinner.js';
import { EmptyState }              from '/components/EmptyState.js';

/**
 * MyView — replace with your view's name and description.
 *
 * @param {object}   props
 * @param {function} props.navigate - SPA router, e.g. navigate('/v1/profile')
 * @param {string}   props.locale   - Active locale ('en' | 'fi')
 */
export default function MyView({ navigate }) {

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

  // ── Render states (canonical: <Spinner> for loading, <Alert> markup for error) ─
  if (loading) return html`<${Spinner} text=${t('loading')} />`;
  if (error)   return html`<div class="alert alert-error">${escHtml(error)}</div>`;

  // ── Main render ────────────────────────────────────────────────────────────
  // Header pattern: `.page-title` at the top of a standalone view, or
  // `.section-title` + `.section-desc` for each section inside a tab. Buttons use
  // the canonical `.btn-*` classes directly — there is NO `.btn` base class.
  return html`
    <div class="myview-container">
      <div class="page-title">${t('myview.title')}</div>
      <div class="section-desc">${t('myview.desc')}</div>

      ${data
        ? html`<p>${escHtml(data.someField)}</p>`
        : html`<${EmptyState} text=${t('myview.empty')} />`}

      <form onSubmit=${handleSubmit}>
        <button type="submit" class="btn-primary" disabled=${submitting}>
          ${submitting ? t('saving') : t('myview.submit')}
        </button>
      </form>

      <button class="btn-ghost" onClick=${() => navigate('/v1/portal')}>
        ${t('nav.back')}
      </button>
    </div>
  `;
}
