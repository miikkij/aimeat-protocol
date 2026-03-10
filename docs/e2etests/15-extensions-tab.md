# E2E Test Cases: Extensions Tab

**Tab file:** `public/views/profile/extensions-tab.js`
**Service file:** `public/js/services/cortex.js`
**APIs tested:**
- `GET /v1/cortex` — list installed extensions
- `POST /v1/cortex` — install extension (YAML manifest + optional libs)
- `GET /v1/cortex/:name` — get extension detail
- `GET /v1/cortex/:name/prompts/:promptName` — get prompt content
- `GET /v1/cortex/:name/ontology` — get extension ontology
- `POST /v1/cortex/:name/activate` — activate extension
- `POST /v1/cortex/:name/deactivate` — deactivate extension
- `DELETE /v1/cortex/:name` — uninstall extension
- `POST /v1/cortex/:name/visibility` — toggle visibility public/private

---

## Success Cases

### TC-1501: Full lifecycle: install, activate, deactivate, uninstall
- **Precondition:** Authenticated owner; no extensions installed
- **Steps:**
  1. Call `POST /v1/cortex` with a valid YAML manifest and no libs
  2. Call `GET /v1/cortex` — verify extension appears in the list
  3. Call `POST /v1/cortex/:name/activate`
  4. Call `GET /v1/cortex/:name` — verify `status` is `"active"`
  5. Call `POST /v1/cortex/:name/deactivate`
  6. Call `GET /v1/cortex/:name` — verify `status` is `"inactive"`
  7. Call `DELETE /v1/cortex/:name`
  8. Call `GET /v1/cortex` — verify extension is gone
- **Expected:** Each step returns `ok: true`; extension transitions through all states correctly
- **Type:** success

### TC-1502: Install extension via YAML paste
- **Precondition:** Authenticated owner
- **Steps:**
  1. Call `POST /v1/cortex` with `{ manifest: "<valid YAML string>" }`
- **Expected:** Returns `ok: true`; extension is installed and appears in `GET /v1/cortex` list
- **Type:** success

### TC-1503: Install bundled extension
- **Precondition:** Authenticated owner; bundled extension YAML and JS files exist at `/cortex-bundled/aimeat-charts.yaml` and `/cortex-bundled/aimeat-charts.js`
- **Steps:**
  1. Fetch `/cortex-bundled/aimeat-charts.yaml` — get manifest YAML
  2. Replace namespace with owner's namespace
  3. Fetch `/cortex-bundled/aimeat-charts.js` — get library JS
  4. Call `POST /v1/cortex` with `{ manifest: "<yaml>", libs: { "aimeat-charts.js": "<js>" } }`
- **Expected:** Returns `ok: true`; extension appears in installed list; bundled card disappears from the "ready extensions" grid
- **Type:** success

### TC-1504: View extension detail with manifest, components, prompts, and ontology
- **Precondition:** Authenticated owner with an installed extension that has schema, prompt, lib, and ontology components
- **Steps:**
  1. Call `GET /v1/cortex/:name` — get base detail
  2. Call `GET /v1/cortex/:name/prompts/:promptName` — get prompt content
  3. Call `GET /v1/cortex/:name/ontology` — get ontology data
- **Expected:** Detail view shows extension name, version, description, author, license, tags, status; components list all types; prompt content is loaded; ontology concepts are displayed
- **Type:** success

### TC-1505: Toggle visibility from private to public
- **Precondition:** Authenticated owner with a private extension installed
- **Steps:**
  1. Call `POST /v1/cortex/:name/visibility` with `{ visibility: "public" }`
  2. Call `GET /v1/cortex/:name` — verify visibility changed
- **Expected:** Returns `ok: true`; extension visibility is now `"public"`
- **Type:** success

### TC-1506: Toggle visibility from public to private
- **Precondition:** Authenticated owner with a public extension installed
- **Steps:**
  1. Call `POST /v1/cortex/:name/visibility` with `{ visibility: "private" }`
  2. Call `GET /v1/cortex/:name` — verify visibility changed
- **Expected:** Returns `ok: true`; extension visibility is now `"private"`
- **Type:** success

---

## Failure Cases

### TC-1507: Install invalid YAML manifest
- **Precondition:** Authenticated owner
- **Steps:**
  1. Call `POST /v1/cortex` with `{ manifest: "this is not valid: yaml: [[" }`
- **Expected:** Returns error with parse/validation message; no extension is installed
- **Type:** failure

### TC-1508: Install duplicate extension name
- **Precondition:** Authenticated owner with extension `"my-ext"` already installed
- **Steps:**
  1. Call `POST /v1/cortex` with a manifest whose `metadata.name` is `"my-ext"`
- **Expected:** Returns 409 conflict or error indicating the name already exists
- **Type:** failure

### TC-1509: Activate non-existent extension
- **Precondition:** Authenticated owner
- **Steps:**
  1. Call `POST /v1/cortex/nonexistent-ext/activate`
- **Expected:** Returns 404 with `ok: false`
- **Type:** failure

### TC-1510: Uninstall non-existent extension
- **Precondition:** Authenticated owner
- **Steps:**
  1. Call `DELETE /v1/cortex/nonexistent-ext`
- **Expected:** Returns 404 with `ok: false`
- **Type:** failure

### TC-1511: Unauthenticated access
- **Precondition:** No authentication token
- **Steps:**
  1. Call `GET /v1/cortex` without Authorization header
  2. Call `POST /v1/cortex` without Authorization header
  3. Call `DELETE /v1/cortex/:name` without Authorization header
- **Expected:** All return 401 Unauthorized
- **Type:** failure

---

## Edge Cases

### TC-1512: Extension with many components
- **Precondition:** Authenticated owner
- **Steps:**
  1. Install an extension with 15+ components (mix of schema, prompt, action, board-template, ontology, seed-data, lib)
  2. View extension detail
- **Expected:** All components are listed in the detail view; component type badges render correctly for each type
- **Type:** edge

### TC-1513: Extension with libraries and schemas
- **Precondition:** Authenticated owner
- **Steps:**
  1. Install an extension with `libs` containing multiple JS files and schemas with `key_pattern` and `apply_to`
  2. View extension detail
- **Expected:** Each library shows filename, exports, script tag URL, and API surface; each schema shows key pattern and apply_to target
- **Type:** edge

### TC-1514: Empty extensions list
- **Precondition:** Authenticated owner; no extensions installed; all bundled extensions already installed
- **Steps:**
  1. Call `GET /v1/cortex` — returns empty list
  2. Load the Extensions tab
- **Expected:** UI shows the hero section with "Create with AI" and "Install" buttons; no extension grid is rendered; bundled section only shows extensions not yet installed
- **Type:** edge

### TC-1515: Install extension with empty manifest
- **Precondition:** Authenticated owner
- **Steps:**
  1. Click Install in paste mode with an empty textarea
- **Expected:** Client-side validation catches the empty manifest and shows "Manifest is empty" error before making any API call
- **Type:** edge
