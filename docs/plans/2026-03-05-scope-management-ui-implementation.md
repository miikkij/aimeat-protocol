# Scope Management UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a scope management UI inside the Agents tab so operators, owners, and end users can view and edit agent scopes through the web interface.

**Architecture:** Summary + Modal pattern integrated into existing Preact+HTM profile view. Agent cards show scope badges at a glance; clicking "Manage" opens a modal with template presets and a granular advanced editor. Backend needs one small change: add `default_scopes` to the GET /v1/agents response.

**Tech Stack:** Preact + HTM (zero-build ESM), Express 5, existing AIMEAT envelope API, i18n via `t()` function.

---

### Task 1: Add `default_scopes` to GET /v1/agents Response

The GET /v1/agents endpoint currently does NOT return the agent's scopes. The frontend needs this data.

**Files:**
- Modify: `aimeat/src/routes/agents.ts` (lines 202-220)

**Step 1: Add the field to the response mapping**

In `agents.ts`, find the GET /v1/agents handler (around line 207). The `agents.map()` callback builds the response object. Add `default_scopes: a.defaultScopes ?? ['*']` to the returned object:

```typescript
agents: agents.map(a => ({
  gaii: a.gaii,
  name: a.name,
  display_name: a.displayName,
  description: a.description,
  capabilities: a.capabilities,
  trust_score: a.trustScore,
  morsel_balance: a.morselBalance,
  created_at: a.createdAt,
  last_seen: a.lastSeen,
  default_scopes: a.defaultScopes ?? ['*'],  // NEW
})),
```

Note: also add `name: a.name` if missing — the frontend uses `a.name` for the PATCH endpoint path.

**Step 2: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: Clean (or only pre-existing Prisma errors).

**Step 3: Commit**

```bash
git add src/routes/agents.ts
git commit -m "feat: include default_scopes in GET /v1/agents response"
```

---

### Task 2: Add i18n Strings for Scope Management UI

Add all translation keys needed by the scope management modal and summary row.

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

**Step 1: Add English strings**

Add a new `scopeUi` object inside the `profile.agents` section of `en.json`. Place it after the existing `"loadingAgents"` key:

```json
"scopeUi": {
  "manage": "Manage",
  "scopes": "scopes",
  "scopeProfile": "Scope Profile",
  "readOnly": "Read-only",
  "standard": "Standard",
  "fullAccess": "Full access",
  "custom": "Custom",
  "advanced": "Advanced scope editor",
  "save": "Save",
  "cancel": "Cancel",
  "saving": "Saving...",
  "saved": "Scopes updated successfully",
  "saveError": "Failed to update scopes",
  "notAvailable": "Not available on this node",
  "alwaysOn": "Always enabled (Tier 0)",
  "readOnlyView": "Your current permissions",
  "domainMemory": "Memory",
  "domainWork": "Work",
  "domainSocial": "Social",
  "domainWallet": "Wallet",
  "domainConsent": "Consent",
  "domainTunnel": "Tunnel",
  "domainAgent": "Agent",
  "domainCatalogue": "Catalogue",
  "permRead": "Read",
  "permWrite": "Write",
  "permDelete": "Delete",
  "permRequest": "Request",
  "permAccept": "Accept",
  "permPublish": "Publish",
  "permManage": "Manage",
  "permConnect": "Connect",
  "permRegister": "Register"
}
```

**Step 2: Add Finnish strings**

Add the equivalent `scopeUi` object inside the `profile.agents` section of `fi.json`:

```json
"scopeUi": {
  "manage": "Hallinnoi",
  "scopes": "oikeutta",
  "scopeProfile": "Oikeusprofiili",
  "readOnly": "Vain luku",
  "standard": "Vakio",
  "fullAccess": "Täysi pääsy",
  "custom": "Mukautettu",
  "advanced": "Yksityiskohtainen oikeusmuokkain",
  "save": "Tallenna",
  "cancel": "Peruuta",
  "saving": "Tallennetaan...",
  "saved": "Oikeudet päivitetty onnistuneesti",
  "saveError": "Oikeuksien päivitys epäonnistui",
  "notAvailable": "Ei saatavilla tässä nodessa",
  "alwaysOn": "Aina käytössä (Taso 0)",
  "readOnlyView": "Nykyiset oikeutesi",
  "domainMemory": "Muisti",
  "domainWork": "Työ",
  "domainSocial": "Sosiaalinen",
  "domainWallet": "Lompakko",
  "domainConsent": "Suostumus",
  "domainTunnel": "Tunneli",
  "domainAgent": "Agentti",
  "domainCatalogue": "Hakemisto",
  "permRead": "Luku",
  "permWrite": "Kirjoitus",
  "permDelete": "Poisto",
  "permRequest": "Pyyntö",
  "permAccept": "Hyväksyntä",
  "permPublish": "Julkaisu",
  "permManage": "Hallinta",
  "permConnect": "Yhdistäminen",
  "permRegister": "Rekisteröinti"
}
```

**Step 3: Commit**

```bash
git add locales/en.json locales/fi.json
git commit -m "feat: add i18n strings for scope management UI (EN + FI)"
```

---

### Task 3: Add Scope CSS Styles to Profile

Add CSS for scope summary row, modal sections, domain groups, and custom checkboxes.

**Files:**
- Modify: `aimeat/public/views/profile.js` (PROFILE_CSS constant, around lines 9-180)

**Step 1: Add scope-related CSS**

Append the following CSS rules to the end of the PROFILE_CSS template literal (before its closing backtick), maintaining the `.pf` scoping prefix used throughout:

```css
/* === Scope Management UI === */

/* Scope summary row on agent cards */
.pf .scope-summary {
  display:flex; align-items:center; gap:.5rem;
  margin-top:.65rem; padding-top:.5rem;
  border-top:1px solid rgba(255,107,157,.1);
  font-size:.8rem;
}
.pf .scope-summary .scope-badge {
  background:rgba(255,107,157,.12); color:var(--love4,#f48fb1);
  padding:.15rem .5rem; border-radius:5px; font-weight:600; font-size:.72rem;
}
.pf .scope-summary .scope-count {
  color:var(--muted,#c4a6d0); font-size:.78rem;
}
.pf .scope-summary .scope-manage-btn {
  margin-left:auto; background:none; border:1px solid var(--border,rgba(255,107,157,.25));
  color:var(--love4,#f48fb1); border-radius:6px; padding:3px 10px;
  cursor:pointer; font-size:.72rem; font-weight:600; transition:all .2s;
}
.pf .scope-summary .scope-manage-btn:hover {
  border-color:var(--love1,#ff6b9d); color:var(--love1,#ff6b9d);
}

/* Read-only scope badges (for agents viewing themselves) */
.pf .scope-readonly-list {
  display:flex; flex-wrap:wrap; gap:.35rem; margin-top:.5rem;
}
.pf .scope-readonly-list .scope-tag {
  font-size:.68rem; background:rgba(255,107,157,.08);
  color:var(--muted,#c4a6d0); padding:.12rem .4rem; border-radius:4px;
}

/* Scopes modal extensions */
.pf .scope-modal { max-width:560px; }
.pf .scope-modal h3 { margin-bottom:.25rem; }
.pf .scope-modal .scope-agent-info {
  color:var(--muted,#c4a6d0); font-size:.8rem; margin-bottom:1.25rem;
  font-family:monospace;
}

/* Template selector buttons */
.pf .scope-templates {
  display:flex; gap:.5rem; flex-wrap:wrap; margin-bottom:1.25rem;
}
.pf .scope-tpl-btn {
  flex:1; min-width:100px; padding:.6rem .75rem;
  background:var(--card,rgba(30,20,40,.85));
  border:1px solid var(--border,rgba(255,107,157,.25));
  border-radius:8px; cursor:pointer;
  color:var(--muted,#c4a6d0); font-size:.8rem; font-weight:600;
  transition:all .2s; text-align:center;
}
.pf .scope-tpl-btn:hover {
  color:var(--text,#f0e6f6); border-color:var(--love4,#f48fb1);
}
.pf .scope-tpl-btn.active {
  color:var(--love1,#ff6b9d); border-color:var(--love1,#ff6b9d);
  background:rgba(255,107,157,.1);
}

/* Advanced toggle */
.pf .scope-advanced-toggle {
  background:none; border:1px solid var(--border,rgba(255,107,157,.25));
  color:var(--love4,#f48fb1); border-radius:8px; padding:6px 14px;
  cursor:pointer; font-size:.8rem; font-weight:600; transition:all .2s;
  display:inline-flex; align-items:center; gap:6px; margin-bottom:1rem;
}
.pf .scope-advanced-toggle:hover {
  border-color:var(--love1,#ff6b9d); color:var(--love1,#ff6b9d);
}

/* Domain groups */
.pf .scope-domain {
  background:rgba(15,10,20,.5); border:1px solid rgba(255,107,157,.1);
  border-radius:8px; padding:.75rem; margin-bottom:.5rem;
}
.pf .scope-domain-header {
  display:flex; align-items:center; gap:.5rem; margin-bottom:.5rem;
  cursor:pointer;
}
.pf .scope-domain-header .domain-label {
  font-weight:600; font-size:.85rem; color:var(--text,#f0e6f6);
}
.pf .scope-domain-header .domain-toggle {
  font-size:.65rem; color:var(--muted,#c4a6d0);
}

/* Scope checkboxes */
.pf .scope-row {
  display:flex; align-items:center; gap:.6rem; padding:.3rem 0;
}
.pf .scope-row label {
  display:flex; align-items:center; gap:.5rem; cursor:pointer; flex:1;
}
.pf .scope-row input[type="checkbox"] {
  accent-color:var(--love1,#ff6b9d); width:16px; height:16px; cursor:pointer;
}
.pf .scope-row .scope-friendly {
  font-size:.82rem; color:var(--text,#f0e6f6);
}
.pf .scope-row .scope-technical {
  font-size:.7rem; color:var(--muted,#c4a6d0); font-family:monospace;
}
.pf .scope-row.disabled {
  opacity:.45; pointer-events:none;
}
.pf .scope-row .scope-lock {
  font-size:.7rem; color:var(--muted,#c4a6d0);
}
```

**Step 2: Commit**

```bash
git add public/views/profile.js
git commit -m "feat: add CSS styles for scope management UI"
```

---

### Task 4: Add Scope Template Definitions and Helper Functions

Add the scope template definitions and a template recognition function as constants near the top of profile.js.

**Files:**
- Modify: `aimeat/public/views/profile.js` (after the imports, before the PROFILE_CSS or component function)

**Step 1: Add scope domain definitions and template helpers**

Add after the imports (around line 7, before PROFILE_CSS):

```javascript
// === Scope Management Constants ===

const SCOPE_DOMAINS = [
  { key: 'memory',    permissions: ['read', 'write', 'delete'] },
  { key: 'work',      permissions: ['request', 'read', 'accept', 'publish'] },
  { key: 'social',    permissions: ['read', 'write'] },
  { key: 'wallet',    permissions: ['read'] },
  { key: 'consent',   permissions: ['manage'] },
  { key: 'tunnel',    permissions: ['connect'] },
  { key: 'agent',     permissions: ['register'] },
  { key: 'catalogue', permissions: ['read'] },
];

const SCOPE_TEMPLATES = {
  readonly:  ['memory:read', 'catalogue:read', 'social:read'],
  standard:  ['memory:read', 'memory:write', 'catalogue:read', 'social:read', 'work:request', 'work:read'],
  full:      ['*'],
};

function detectTemplate(scopes) {
  if (!scopes || scopes.length === 0) return 'full';
  if (scopes.includes('*')) return 'full';
  const sorted = [...scopes].sort();
  for (const [name, tpl] of Object.entries(SCOPE_TEMPLATES)) {
    if (name === 'full') continue;
    const tplSorted = [...tpl].sort();
    if (sorted.length === tplSorted.length && sorted.every((s, i) => s === tplSorted[i])) return name;
  }
  return 'custom';
}

function templateLabel(name) {
  const map = { readonly: 'readOnly', standard: 'standard', full: 'fullAccess', custom: 'custom' };
  return t(`profile.agents.scopeUi.${map[name] || 'custom'}`);
}

function domainLabel(domain) {
  const cap = domain.charAt(0).toUpperCase() + domain.slice(1);
  return t(`profile.agents.scopeUi.domain${cap}`);
}

function permLabel(perm) {
  const cap = perm.charAt(0).toUpperCase() + perm.slice(1);
  return t(`profile.agents.scopeUi.perm${cap}`);
}
```

**Step 2: Commit**

```bash
git add public/views/profile.js
git commit -m "feat: add scope template definitions and helper functions"
```

---

### Task 5: Add Scope Summary Row to Agent Cards

Modify the agent card rendering to show scope information.

**Files:**
- Modify: `aimeat/public/views/profile.js` (renderAgents function, lines 873-890)

**Step 1: Add state for the scopes modal**

Find the existing modal state declarations (around line 379-380):
```javascript
const [editModal, setEditModal] = useState(null);
const [rateModal, setRateModal] = useState(null);
```

Add below them:
```javascript
const [scopesModal, setScopesModal] = useState(null);
```

**Step 2: Add scope summary row to agent cards**

In the `renderAgents` function, find the agent card rendering (the `agents.map(a => ...)` section). After the capabilities section and before the closing `</div>` of the card, add the scope summary row:

Find this block (around lines 884-887):
```javascript
${a.capabilities?.length > 0 && html`
  <div class="caps">${a.capabilities.map(c => html`<span class="cap">${escHtml(c)}</span>`)}</div>
`}
```

Add after it (still inside the agent-card div):
```javascript
${(() => {
  const scopes = a.default_scopes ?? ['*'];
  const tpl = detectTemplate(scopes);
  const count = scopes.includes('*') ? '∞' : scopes.length;
  const isOwnerOrOp = session.roles?.includes('owner') || session.roles?.includes('operator');
  return html`
    <div class="scope-summary">
      <span class="scope-badge">${templateLabel(tpl)}</span>
      <span class="scope-count">${count} ${t('profile.agents.scopeUi.scopes')}</span>
      ${isOwnerOrOp
        ? html`<button class="scope-manage-btn" onClick=${(e) => { e.stopPropagation(); setScopesModal(a); }}>
            ${t('profile.agents.scopeUi.manage')} ▸
          </button>`
        : html`<span class="scope-lock">🔒</span>`
      }
    </div>`;
})()}
```

**Step 3: Add modal rendering**

Find the existing modal rendering section (around lines 1545-1562, where editModal and rateModal are rendered). Add after the rateModal block:

```javascript
${scopesModal && html`
  <${ScopesModal}
    agent=${scopesModal}
    session=${session}
    maxScopes=${null}
    onSave=${async (agentName, newScopes) => {
      try {
        const resp = await apiFetch('/v1/agents/' + encodeURIComponent(agentName) + '/scopes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scopes: newScopes }),
        });
        if (resp?.ok !== false) {
          showToast(t('profile.agents.scopeUi.saved'));
          setScopesModal(null);
          loadAgentsData();
        } else {
          showToast(resp?.error?.message || t('profile.agents.scopeUi.saveError'), true);
        }
      } catch (err) {
        showToast(t('profile.agents.scopeUi.saveError'), true);
      }
    }}
    onCancel=${() => setScopesModal(null)}
  />`}
```

**Step 4: Commit**

```bash
git add public/views/profile.js
git commit -m "feat: add scope summary row to agent cards and wire up modal"
```

---

### Task 6: Create ScopesModal Component

Build the full modal component with template selector and advanced granular editor.

**Files:**
- Modify: `aimeat/public/views/profile.js` (add after existing modals like EditMemoryModal/RateModal, around line 1742)

**Step 1: Create the ScopesModal function component**

Add this component after the existing RateModal function (around line 1742):

```javascript
function ScopesModal({ agent, session, maxScopes, onSave, onCancel }) {
  const scopes = agent.default_scopes ?? ['*'];
  const isFullWildcard = scopes.includes('*');

  // Build initial checked set from scopes
  function expandScopes(scopeList) {
    const set = new Set();
    if (scopeList.includes('*')) {
      // Full wildcard — check everything
      for (const d of SCOPE_DOMAINS) {
        for (const p of d.permissions) set.add(`${d.key}:${p}`);
      }
      return set;
    }
    for (const s of scopeList) {
      const [domain, perm] = s.split(':');
      if (perm === '*') {
        const domDef = SCOPE_DOMAINS.find(d => d.key === domain);
        if (domDef) domDef.permissions.forEach(p => set.add(`${domain}:${p}`));
      } else {
        set.add(s);
      }
    }
    return set;
  }

  const [checked, setChecked] = useState(() => expandScopes(scopes));
  const [advanced, setAdvanced] = useState(() => detectTemplate(scopes) === 'custom');
  const [saving, setSaving] = useState(false);
  const currentTemplate = detectTemplate([...checked]);

  function applyTemplate(name) {
    if (name === 'full') {
      const all = new Set();
      for (const d of SCOPE_DOMAINS) {
        for (const p of d.permissions) all.add(`${d.key}:${p}`);
      }
      setChecked(all);
    } else {
      setChecked(new Set(SCOPE_TEMPLATES[name] || []));
    }
  }

  function toggleScope(scope) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  function toggleDomain(domain) {
    const domDef = SCOPE_DOMAINS.find(d => d.key === domain);
    if (!domDef) return;
    const domScopes = domDef.permissions.map(p => `${domain}:${p}`);
    const allChecked = domScopes.every(s => checked.has(s));
    setChecked(prev => {
      const next = new Set(prev);
      domScopes.forEach(s => allChecked ? next.delete(s) : next.add(s));
      return next;
    });
  }

  function buildScopesArray() {
    const arr = [...checked];
    // Check if all scopes are selected — collapse to ['*']
    const allScopes = SCOPE_DOMAINS.flatMap(d => d.permissions.map(p => `${d.key}:${p}`));
    if (allScopes.every(s => checked.has(s))) return ['*'];
    return arr.length > 0 ? arr : ['catalogue:read'];
  }

  async function handleSave() {
    setSaving(true);
    await onSave(agent.name, buildScopesArray());
    setSaving(false);
  }

  const isReadOnly = !(session.roles?.includes('owner') || session.roles?.includes('operator'));

  return html`
    <div class="modal-overlay" onClick=${e => { if (e.target.className.includes('modal-overlay')) onCancel(); }}>
      <div class="modal scope-modal">
        <h3>${t('profile.agents.scopeUi.scopeProfile')}: ${escHtml(agent.display_name || agent.name)}</h3>
        <div class="scope-agent-info">${escHtml(agent.gaii || '')}</div>

        ${isReadOnly ? html`
          <p style="color:var(--muted);margin-bottom:1rem;font-size:.85rem">${t('profile.agents.scopeUi.readOnlyView')}</p>
          <div class="scope-readonly-list">
            ${scopes.map(s => html`<span class="scope-tag">${escHtml(s)}</span>`)}
          </div>
          <div class="form-actions" style="margin-top:1.5rem">
            <button class="btn-outline" onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}</button>
          </div>
        ` : html`
          <!-- Template selector -->
          <div class="scope-templates">
            ${['readonly', 'standard', 'full'].map(tpl => html`
              <button class="scope-tpl-btn ${currentTemplate === tpl ? 'active' : ''}"
                      onClick=${() => applyTemplate(tpl)}>
                ${templateLabel(tpl)}
              </button>
            `)}
          </div>

          <!-- Advanced toggle -->
          <button class="scope-advanced-toggle" onClick=${() => setAdvanced(!advanced)}>
            <span>${t('profile.agents.scopeUi.advanced')}</span>
            <span style="transition:transform .2s;${advanced ? 'transform:rotate(180deg)' : ''}">▼</span>
          </button>

          ${advanced && html`
            <div class="scope-domains">
              ${SCOPE_DOMAINS.map(d => {
                const domScopes = d.permissions.map(p => `${d.key}:${p}`);
                const allChecked = domScopes.every(s => checked.has(s));
                const isCatalogue = d.key === 'catalogue';
                return html`
                  <div class="scope-domain">
                    <div class="scope-domain-header" onClick=${() => !isCatalogue && toggleDomain(d.key)}>
                      <span class="domain-label">${domainLabel(d.key)}</span>
                      ${!isCatalogue && html`<span class="domain-toggle">${allChecked ? '☑ all' : '☐'}</span>`}
                    </div>
                    ${d.permissions.map(p => {
                      const scope = `${d.key}:${p}`;
                      const isLocked = isCatalogue && p === 'read';
                      return html`
                        <div class="scope-row ${isLocked ? 'disabled' : ''}">
                          <label>
                            <input type="checkbox"
                              checked=${checked.has(scope) || isLocked}
                              onChange=${() => !isLocked && toggleScope(scope)}
                              disabled=${isLocked}
                            />
                            <span class="scope-friendly">${permLabel(p)}</span>
                            <span class="scope-technical">${scope}</span>
                            ${isLocked && html`<span class="scope-lock" title=${t('profile.agents.scopeUi.alwaysOn')}>🔒</span>`}
                          </label>
                        </div>`;
                    })}
                  </div>`;
              })}
            </div>
          `}

          <div class="form-actions" style="margin-top:1.25rem">
            <button class="btn-primary" onClick=${handleSave} disabled=${saving}>
              ${saving ? t('profile.agents.scopeUi.saving') : t('profile.agents.scopeUi.save')}
            </button>
            <button class="btn-outline" onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}</button>
          </div>
        `}
      </div>
    </div>`;
}
```

**Step 2: Commit**

```bash
git add public/views/profile.js
git commit -m "feat: add ScopesModal component with templates and advanced editor"
```

---

### Task 7: Verify Type-Check and Manual Test

Run type-check on the backend change, and manually verify the UI loads correctly.

**Files:**
- No changes, verification only.

**Step 1: Run TypeScript type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: Clean (or only pre-existing Prisma errors).

**Step 2: Start dev server and verify**

Run: `cd aimeat && pnpm dev`

Test manually:
1. Navigate to profile page → Agents tab
2. Verify agent cards show scope summary row (badge + count)
3. Click "Manage" button → verify modal opens
4. Test template switching (Read-only / Standard / Full access)
5. Toggle "Advanced scope editor" → verify domain checkboxes
6. Save scopes → verify toast notification
7. Verify updated scopes appear on card after save

**Step 3: Run E2E tests**

Run: `cd aimeat && npx tsx test/e2e-full.ts`
Expected: All tests pass (including Phase 8 scope tests from previous implementation).

**Step 4: Commit any fixes needed**

If any fixes were needed during verification, commit them:
```bash
git add -A
git commit -m "fix: address scope UI issues found during verification"
```

---

### Task 8: Final Cleanup and Verification

Ensure everything is clean and ready to merge.

**Files:**
- Verify all modified files.

**Step 1: Run full type-check**

Run: `cd aimeat && npx tsc --noEmit`

**Step 2: Run full E2E test suite**

Run: `cd aimeat && npx tsx test/e2e-full.ts`

**Step 3: Review git log**

Run: `git log --oneline -10`

Verify all commits are clean and well-described.

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/routes/agents.ts` | Add `default_scopes` to GET /v1/agents response |
| `public/views/profile.js` | Add SCOPE_DOMAINS, SCOPE_TEMPLATES, detectTemplate(), templateLabel(), domainLabel(), permLabel() constants/helpers |
| `public/views/profile.js` | Add scope CSS to PROFILE_CSS |
| `public/views/profile.js` | Add scopesModal state, scope summary row on agent cards |
| `public/views/profile.js` | Add ScopesModal component (templates + advanced editor) |
| `public/views/profile.js` | Wire up modal rendering with PATCH API call |
| `locales/en.json` | Add profile.agents.scopeUi.* translation keys |
| `locales/fi.json` | Add profile.agents.scopeUi.* translation keys (Finnish) |
