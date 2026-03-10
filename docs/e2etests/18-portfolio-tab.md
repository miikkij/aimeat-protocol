# E2E Test Cases: Portfolio Tab

**Tab file:** `public/views/profile/portfolio-tab.js` (launcher)
**Builder file:** `public/views/portfolio.js` (full PortfolioBuilder SPA)
**APIs tested:**
- `GET /v1/portfolio/catalog` — load content catalog (images, apps, boards, cortex, memories)
- `GET /v1/portfolio/config` — get saved portfolio configuration
- `PUT /v1/portfolio/config` — save portfolio configuration
- `PUT /v1/portfolio/upload` — upload HTML file or paste HTML content
- `GET /v1/portfolio/:owner` — view public portfolio page

---

## Success Cases

### TC-1801: Load catalog, select content, generate prompt, and copy
- **Precondition:** Authenticated owner with some images, apps, and boards published
- **Steps:**
  1. Navigate to `/v1/portfolio` (Portfolio Builder)
  2. Call `GET /v1/portfolio/catalog` — returns available content
  3. Select images, apps, boards from the catalog checkboxes
  4. Choose a portfolio type (e.g., "cv") and design style (e.g., "minimal")
  5. Click "Generate Prompt" / copy prompt button
- **Expected:** Prompt is built containing the owner's GHII, display name, node URL, selected image URLs, selected app URLs, selected board info, selected portfolio type and style; prompt is copied to clipboard with toast
- **Type:** success

### TC-1802: Upload HTML file to publish portfolio
- **Precondition:** Authenticated owner
- **Steps:**
  1. Navigate to Portfolio Builder
  2. Select or drag-drop a valid `.html` file
  3. File content is sent via `PUT /v1/portfolio/upload`
- **Expected:** Returns `ok: true`; portfolio is now enabled and viewable at `/v1/portfolio/:owner`
- **Type:** success

### TC-1803: Paste HTML directly to publish portfolio
- **Precondition:** Authenticated owner
- **Steps:**
  1. Navigate to Portfolio Builder
  2. Paste valid HTML content into the textarea
  3. Click publish/upload button, triggering `PUT /v1/portfolio/upload`
- **Expected:** Returns `ok: true`; portfolio is now enabled and served at `/v1/portfolio/:owner`
- **Type:** success

### TC-1804: Download prompt as .txt file
- **Precondition:** Authenticated owner with catalog loaded and content selected
- **Steps:**
  1. Build the portfolio prompt by selecting content and options
  2. Click the download prompt button
- **Expected:** Browser initiates download of a `.txt` file containing the full portfolio prompt
- **Type:** success

### TC-1805: View existing portfolio link
- **Precondition:** Authenticated owner with a published portfolio
- **Steps:**
  1. Navigate to Portfolio tab
  2. Click "View Public Portfolio" link
- **Expected:** Opens `/v1/portfolio/:owner` in a new tab; the published HTML is rendered
- **Type:** success

### TC-1806: Save and load portfolio config
- **Precondition:** Authenticated owner
- **Steps:**
  1. Call `PUT /v1/portfolio/config` with `{ type: "cv", style: "dark", authGates: ["contact"] }`
  2. Call `GET /v1/portfolio/config`
- **Expected:** Config is persisted; GET returns the same values that were saved
- **Type:** success

---

## Failure Cases

### TC-1807: Upload non-HTML file
- **Precondition:** Authenticated owner
- **Steps:**
  1. Attempt to upload a `.png` or `.pdf` file via the file picker
- **Expected:** Client-side or server-side validation rejects the file; error message is shown; no portfolio is published
- **Type:** failure

### TC-1808: Paste empty HTML content
- **Precondition:** Authenticated owner
- **Steps:**
  1. Open paste mode in the Portfolio Builder
  2. Leave textarea empty or whitespace-only
  3. Click publish/upload
- **Expected:** Validation catches empty content; error message shown; `PUT /v1/portfolio/upload` is not called or returns error
- **Type:** failure

### TC-1809: Upload while unauthenticated
- **Precondition:** No authentication token
- **Steps:**
  1. Call `PUT /v1/portfolio/upload` without Authorization header
  2. Call `GET /v1/portfolio/catalog` without Authorization header
  3. Call `PUT /v1/portfolio/config` without Authorization header
- **Expected:** All return 401 Unauthorized
- **Type:** failure

---

## Edge Cases

### TC-1810: Empty catalog (no content to select)
- **Precondition:** Authenticated owner with no images, apps, boards, cortex extensions, or memories published
- **Steps:**
  1. Call `GET /v1/portfolio/catalog`
  2. Load Portfolio Builder
- **Expected:** Catalog returns `{ images: [], apps: [], boards: [], cortex: [], memories: [] }`; UI shows empty sections or prompts the user to create content first; prompt can still be generated (with "no images" note)
- **Type:** edge

### TC-1811: Very large HTML file upload
- **Precondition:** Authenticated owner with an HTML file > 1MB
- **Steps:**
  1. Upload the large HTML file via `PUT /v1/portfolio/upload`
- **Expected:** Either upload succeeds if within server limits, or server returns a clear size limit error (413 or similar)
- **Type:** edge

### TC-1812: Re-upload replaces existing portfolio
- **Precondition:** Authenticated owner with an already-published portfolio
- **Steps:**
  1. Upload a new HTML file via `PUT /v1/portfolio/upload`
  2. Visit `/v1/portfolio/:owner`
- **Expected:** The old portfolio is replaced; the new HTML is served at the same URL
- **Type:** edge

### TC-1813: Portfolio config persistence across sessions
- **Precondition:** Authenticated owner who saved portfolio config in a previous session
- **Steps:**
  1. Log out and log back in
  2. Navigate to Portfolio Builder
  3. Call `GET /v1/portfolio/config`
- **Expected:** Previously saved config (type, style, authGates) is loaded and reflected in the UI selections
- **Type:** edge

### TC-1814: Portfolio public access without authentication
- **Precondition:** Owner has a published portfolio
- **Steps:**
  1. Visit `/v1/portfolio/:owner` without any authentication
- **Expected:** The published portfolio HTML is served publicly (no auth required for viewing)
- **Type:** edge
