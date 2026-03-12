# 04 — Frontend Analysis

## 1. Architecture Overview

### 1.1 Stack

| Technology | Purpose |
|-----------|---------|
| Preact 10 | React-like component framework (~3KB) |
| HTM | Tagged template literals (JSX without build step) |
| Native ESM | No bundler, no build step |
| Import maps | Dependency resolution in `spa.html` |
| CSS custom properties | Theming and design tokens |

### 1.2 File Organization

```
public/
├── spa.html                    # SPA shell (import maps, routing)
├── agent-consent.html          # Standalone consent form
├── oauth-consent.html          # OAuth consent form
├── wizard.html                 # Setup wizard (standalone)
├── lib/                        # Framework libraries
│   ├── preact.mjs, preact-hooks.mjs, htm.mjs
│   ├── realtime.js, live-updates.js
│   └── three.min.js
├── js/
│   ├── api.js                  # Centralized HTTP client
│   ├── i18n.js                 # Internationalization
│   ├── hooks.js                # Custom Preact hooks
│   ├── utils.js                # Utilities (escHtml, sanitizeHtml, etc.)
│   └── services/               # 15+ domain-specific API wrappers
│       ├── admin.js, agents.js, auth.js, boards.js
│       ├── catalogue.js, consent.js, cortex.js, federation.js
│       ├── knowledge.js, memory.js, nodes.js, organisms.js
│       ├── security.js, stats.js, wallet.js, work.js
│       └── ...
├── components/                 # Reusable UI components
│   ├── Alert.js, Card.js, CopyButton.js, FormField.js
│   ├── Modal.js, Spinner.js, Toast.js
│   └── useViewCSS.js          # CSS-per-view hook
├── views/
│   ├── _template.js            # Base view template
│   ├── portal.js               # Landing page
│   ├── profile.js              # User profile (20 tabs)
│   ├── admin.js                # Admin dashboard (30 tabs)
│   ├── hobbies.js, marketplace.js, guides.js, ...
│   ├── admin/                  # Admin tab components (30 files)
│   │   ├── shared.js           # Shared admin components
│   │   ├── overview-tab.js, agents-tab.js, ...
│   │   └── ...
│   └── profile/                # Profile tab components (20 files)
│       ├── shared.js           # Shared profile components
│       ├── memory-tab.js, wallet-tab.js, ...
│       └── ...
└── css/
    ├── theme.css               # Global theme variables
    ├── components/tags.css     # Tag styling
    └── views/
        ├── admin.css           # adm-* prefix (14.5 KB)
        ├── profile.css         # pf-* prefix (43.8 KB)
        ├── portal.css, hobbies.css, marketplace.css, ...
        └── ...
```

### 1.3 Routing

Hash-based SPA routing via `spa.html`:
- History API for clean URLs (`/v1/profile`, `/v1/admin`, etc.)
- Internal link interception with `document.addEventListener('click', onClick)`
- Ctrl/Meta/Shift-click preserved for new tab behavior
- View modules lazy-loaded on first navigation, then cached

## 2. Component Quality

### 2.1 Component Library (10 components)

| Component | Purpose | Quality |
|-----------|---------|---------|
| `Alert.js` | Status messages | Clean, accessible |
| `Card.js` | Content card wrapper | Clean |
| `CopyButton.js` | Copy-to-clipboard | Uses Clipboard API properly |
| `FormField.js` | Form field wrapper | Labels, validation |
| `Modal.js` | Modal dialog | Focus management |
| `Spinner.js` | Loading indicator | Accessible |
| `Toast.js` | Toast notifications | Auto-dismiss |
| `useViewCSS.js` | Per-view CSS loading | Prevents style leaks |

### 2.2 Admin Dashboard (30 tabs)

**Pattern:** Each tab exports a default Preact function component:

```javascript
export default function OverviewTab({ data, reload, session, navigate, locale, switchPage }) {
  // ...
}
```

**Props interface:** `{ data, reload, session, navigate, locale, switchPage }`

**Shared components** (`admin/shared.js`):
- `Badge()` — status indicator
- `StatCard()` — metric display
- `StatsGrid()` — metric grid layout
- `ExpandableHelp()` — collapsible help sections
- `DataTable()` — table with safe HTML cells
- `useToast()` — toast notification hook
- `Toast()` — dismissible toast

### 2.3 Profile Page (20 tabs)

**Architecture:** Lazy-loaded tabs with persistent mount:
```
Session Check → Load Stats (Promise.allSettled) → Tab Rendering
     ↓
Live Updates (SSE) → Custom event broadcast → Tab re-fetch
```

Tabs include: Memory, Wallet, Agents, Apps, Boards, Chat Sessions, Data Wallet, Extensions, Federation, Knowledge, MCP, Node Stats, Nodes, Notifications, Organisms, Portfolio, Security, Services, Work.

## 3. API Client Layer

### 3.1 Centralized HTTP Client (`js/api.js`)

**Features:**
- Exponential backoff retry (500ms * 2^attempt)
- JWT expiry pre-check before requests (refreshes if < 60s remaining)
- 30-second timeout via AbortController
- Automatic retry on 429/5xx (up to MAX_RETRIES)
- Does NOT retry 4xx errors (correct behavior)
- Proper error propagation with error codes

### 3.2 Service Layer (15+ services)

Each domain has a dedicated API service:
```javascript
// js/services/memory.js
export async function deleteMemory(key) {
  return apiDelete(`/v1/memory/${encodeURIComponent(key)}`);
}
```

All parameters properly URL-encoded before API calls.

### 3.3 Live Updates

SSE connection via single-use tickets (not JWT in URL):
```javascript
// 1. Get ticket via authenticated POST
const resp = await fetch('/v1/events/ticket', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${jwt}` },
});
const ticket = body.data.ticket;

// 2. Open EventSource with ticket
es = new EventSource(`/v1/events?ticket=${encodeURIComponent(ticket)}`);
```

Reference-counted connection management with proper cleanup.

## 4. Security Analysis

### 4.1 XSS Prevention

**Rating: Excellent**

| Control | Status | Details |
|---------|--------|---------|
| `escHtml()` | Applied everywhere | All user data HTML-escaped |
| HTM auto-escaping | Default behavior | Template literals escape by default |
| `sanitizeHtml()` | Where raw HTML needed | Strips dangerous tags/attributes |
| No `eval()` / `Function()` | Verified | Zero instances found |
| No inline event handlers | Verified | All use `.addEventListener()` |
| `dangerouslySetInnerHTML` | 3 instances, all safe | Documented + sanitized |

**`dangerouslySetInnerHTML` audit:**

| File | Usage | Safety |
|------|-------|--------|
| `admin/shared.js:112` | DataTable `_html` cells | Caller-responsibility (documented) |
| `portal-dev.js` (7 instances) | `sanitizeHtml()` wrapper | Safe |
| `profile/agents-tab.js:395` | Hardcoded constant (PLATFORMS) | Safe |

### 4.2 Token Handling

**Primary pattern** (used in most of codebase):
```javascript
// Centralized auth via window.AIMEAT.auth
export function getSession() {
  const s = window.AIMEAT?.auth?.getSession();
  return (s && s.jwt) ? s : null;
}
```

**Legacy pattern** (1 file only):
```javascript
// hobbies.js — uses localStorage directly
const token = localStorage.getItem('aimeat-token');
```

**Recommendation:** Migrate `hobbies.js` to use centralized auth service.

### 4.3 No Sensitive Data Exposure

- Tokens not logged
- No credentials in URLs
- API keys not in frontend source
- Error responses don't leak internal details

## 5. Code Quality

### 5.1 Strengths

1. **Modular architecture** — clear separation of services, components, views
2. **No build step** — Preact + HTM + native ESM reduces complexity
3. **Consistent patterns** — all tabs follow same prop interface
4. **Error boundaries** — Preact ErrorBoundary for graceful failures
5. **i18n support** — centralized translation loading with fallback to English
6. **CSS namespacing** — `adm-*` and `pf-*` prevent style conflicts
7. **Lazy loading** — views loaded on first navigation

### 5.2 Concerns

1. **Large CSS files** — `profile.css` at 43.8 KB could benefit from code splitting
2. **No TypeScript** — frontend is pure JavaScript (no type checking)
3. **No test coverage** — frontend components have no unit tests
4. **hobbies.js legacy auth** — should use centralized auth service
5. **DataTable `_html` pattern** — relies on caller discipline (not enforced)

### 5.3 Accessibility

| Feature | Status |
|---------|--------|
| Semantic HTML | Used (form elements, headings, nav) |
| ARIA labels | Partial (some components, not all) |
| Keyboard navigation | Tab navigation works for forms |
| Screen reader support | Not explicitly tested |
| Color contrast | CSS custom properties allow theming |
| Focus management | Modal component handles focus |

**Recommendation:** Add ARIA labels to interactive components and test with screen reader.

## 6. Performance

### 6.1 Loading Strategy

- Import maps resolve dependencies without bundling
- Views lazy-loaded on first navigation, cached after
- CSS loaded per-view via `useViewCSS` hook
- No unnecessary re-renders (Preact + hooks pattern)

### 6.2 Caching

- Server sets `Cache-Control: no-cache` with ETag for JS/CSS/HTML
- Browser revalidates on every load (304 if unchanged)
- 7-day cache for static assets (images, icons)

### 6.3 Bundle Size

No bundling — each module loaded individually. Trade-off:
- **Pro:** No build step, instant dev feedback, easy debugging
- **Con:** Many HTTP requests on initial load, no tree-shaking

For a protocol reference implementation, this is an acceptable trade-off. Production SPAs might benefit from bundling.

## 7. File-Level Summary

| Category | Files | Status |
|----------|-------|--------|
| HTML | 4 | Secure, semantic, CSP-compliant |
| JavaScript | 101 | Good quality, 1 legacy auth pattern |
| CSS | 12 | Clean, namespaced, large profile.css |
| Components | 10 | Clean, reusable |
| Admin Tabs | 30 | Consistent, well-structured |
| Profile Tabs | 20 | Consistent, lazy-loaded |
| Service Layer | 15+ | Proper URL encoding, error handling |
