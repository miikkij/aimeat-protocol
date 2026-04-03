# Plan: Test Template Scaffolds for Generator Pipeline

**Date:** 2026-04-03
**Status:** Proposal — awaiting review
**Author:** Claude (analysis requested by user)
**Updated:** 2026-04-03 — revised after user feedback on flexibility

---

## The Idea

Instead of having the LLM generate test code from scratch every time (using only a prompt example as guidance), give it a **working starter template** — a complete, runnable test scaffold with known-good boilerplate (translation loading, `await` patterns, result reporting, snapshot capture). The LLM adapts it to the specific component: adds data fetch calls, render props, DOM checks. It can also modify the template structure if needed.

The template is a **starting point, not a straitjacket.** If the first pass doesn't work, the fix-prompt can modify the template freely. The key insight: giving the LLM working code to adapt is fundamentally more reliable than giving it 16 rules to follow from scratch.

This would apply to:
- Cortex data tests
- Cortex component tests
- Cortex app-domain tests
- App tests

---

## Brutal Honest Opinion

**This is a strong idea. It would eliminate the majority of test failures we've seen.**

Here's why: every single test failure in the component cortex phase traces back to the LLM reinventing boilerplate and getting it wrong:

| Failure | Root cause | Template would fix? |
|---------|-----------|---------------------|
| `Result.el is not an HTMLElement` | LLM forgot `await` on async `render()` | **Yes** — `await` is in the starting code |
| Raw translation keys in DOM | LLM didn't load translations from `AIMEAT.data.get()` | **Yes** — translation loading is in the starting code |
| `window.__testResults` not set | Variable ordering wrong, early return paths missed | **Yes** — scaffolding already works |
| Test checked DOM immediately | LLM skipped the 3-second async wait | **Yes** — wait is in the starting code |
| Wrong API call pattern | `dataCortex.getCompany('id')` instead of `({businessId: 'id'})` | **Partially** — template shows correct pattern, LLM adapts |
| Missing `window.__renderSnapshot` | LLM forgot or put it after destroy() | **Yes** — snapshot is at correct position |

The current approach is: write a long prompt with examples and rules, hope the LLM follows all of them. **That is fundamentally fragile.** LLMs are much better at adapting working code than at following 15 simultaneous structural rules from a description.

**Honest risks:**

1. ~~**Rigidity vs. flexibility trade-off.**~~ **Eliminated.** The template is a starting point. The LLM can modify it during initial generation, and the fix-prompt can modify it further during retries. If a component needs drag-and-drop testing or WebSocket events, the LLM adapts the template. The only constraint: a set of "don't break these" rules (keep results reporting, keep snapshot capture, keep `window.__testResults` assignment). These are minimal and structural.

2. ~~**Maintenance cost.**~~ **Minimal.** Since the LLM can adapt the template, it doesn't need to be perfect for every case. If the test page API changes, update the template once. The fix-prompt handles edge cases naturally.

3. **Template quality matters.** The template itself must be correct and well-structured. A buggy template would poison every test. But this is solvable — we test the template itself once, and it's stable code (not LLM-generated).

**Verdict: 9/10 — the flexibility revision removes the main risk. Worth doing.**

---

## Analysis: What Exists Today

### Current test generation flow

```
[Autopilot] → builds prompt from gen-test-cortex-* seed
           → sends to LLM
           → LLM returns raw JavaScript from scratch
           → save as testCode in component record
           → Playwright navigates to test page
           → test page runs testCode in async IIFE
           → checks window.__testResults
```

### Proposed test generation flow

```
[Autopilot] → resolver pre-fills template (lib names, service slug, locale)
           → sends pre-filled template + component context to LLM
           → LLM adapts template (adds data fetch, render props, DOM checks)
           → save as testCode in component record
           → Playwright navigates to test page
           → test page runs testCode in async IIFE
           → checks window.__testResults
           → if FAIL: fix-prompt can modify the adapted template freely
```

### What the LLM must get right EVERY TIME (currently)

For a cortex-component test, the LLM must independently produce ALL of these correctly:

1. `const results = { passed: false, errors: [], details: '' }` — exact shape
2. `log`, `fail`, `pass` helper functions — exact signatures
3. Library existence check with early return
4. Data cortex existence check with early return
5. Real data fetch with object params and error handling
6. Translation loading from `AIMEAT.data.get()` with correct key format
7. Container creation and `document.body.appendChild()`
8. `await lib.render(container, props)` — MUST have await
9. `await new Promise(r => setTimeout(r, 3000))` — async wait
10. DOM content checks (innerHTML length, textContent)
11. Translation key verification in DOM
12. `window.__renderSnapshot = container.innerHTML` — BEFORE destroy
13. Return object check (`result.el instanceof HTMLElement`)
14. `result.destroy()` call with error handling
15. Container cleanup
16. `window.__testResults = results` — LAST statement

That's **16 structural requirements** the LLM must nail. Miss any one → test failure → retry cycle → wasted tokens.

### What the LLM ACTUALLY needs to decide (component-specific)

1. Which data cortex method to call and with what params
2. What props to pass to `render()`
3. What DOM content to check for (company names, IDs, etc.)
4. What interactive elements to look for

That's **4 decisions**. The other 12 are pure boilerplate.

### With templates

The LLM receives a **working test** with all 16 structural requirements already satisfied. It needs to:
1. Adapt the data fetch section
2. Adapt the render props
3. Adapt the DOM checks
4. Optionally add/remove/modify test steps

If something doesn't work, the fix-prompt modifies the adapted template. The structural foundation remains intact through the fix cycle unless there's a genuine reason to change it.

---

## Proposal: Template Scaffold System (Option A — Revised)

### Core Principle

**Template = working starter code, not fill-in-the-blanks.**

The resolver pre-fills everything it knows (lib names, service slug, data cortex lib name). The LLM receives near-complete code and adapts the component-specific parts. It CAN modify anything, but it starts from a correct foundation.

### Fix-Prompt Rules

When a test fails and the fix-prompt kicks in, it gets the full adapted test code plus error details. Rules for the fix-prompt:

1. **You may modify any part of the test code** to fix the failure
2. **Do NOT remove** the `window.__testResults` assignment or the `window.__renderSnapshot` capture
3. **Do NOT remove** the `results`/`log`/`fail`/`pass` scaffolding
4. **Do NOT remove** the 3-second async wait after render
5. **Everything else is fair game** — add steps, remove checks, change data fetch, restructure DOM verification

This gives maximum flexibility while protecting the 3-4 things the test page runner absolutely needs.

### Template Types Needed

#### 1. Cortex Data Test Template

**What resolver pre-fills:** lib name, method signatures from spec
**What LLM adapts:** test params for each method, expected return shape checks
**Complexity: Low.** Data cortex tests are method-call-and-verify.

#### 2. Cortex Component Test Template

**What resolver pre-fills:** lib name, data cortex lib name, service slug, locale
**What LLM adapts:** data fetch call, render props, DOM content checks
**Complexity: Medium.** Most of the test is boilerplate (translation loading, render + wait, snapshot, destroy).

Template structure (pre-filled by resolver, adapted by LLM):

```javascript
// ── Test scaffolding (do not remove) ──
const results = { passed: false, errors: [], details: '' };
const log = (msg) => { results.details += msg + '\n'; };
const fail = (msg) => { results.errors.push(msg); log('FAIL: ' + msg); };
const pass = (msg) => { log('PASS: ' + msg); };

// ── Library checks ──
const lib = window.AIMEAT.{{LIB_NAME}};  // pre-filled
if (!lib) { fail('Library not loaded'); window.__testResults = results; return; }
if (typeof lib.render !== 'function') { fail('render is not a function'); window.__testResults = results; return; }
pass('Component library loaded');

const dataCortex = window.AIMEAT.{{DATA_CORTEX_LIB}};  // pre-filled
if (!dataCortex) { fail('Data cortex not loaded'); window.__testResults = results; return; }
pass('Data cortex loaded');

// ── Load translations ──
const translations = await AIMEAT.data.get('{{SERVICE_SLUG}}.i18n.fi') || {};  // pre-filled
log('Loaded ' + Object.keys(translations).length + ' translation keys');

// ── Fetch test data (ADAPT THIS) ──
// TODO: Call data cortex methods to get real test data.
// Available methods: {{METHOD_SIGNATURES}}
// All methods take OBJECT params: dataCortex.method({key: 'value'})
let testData;
try {
  testData = await dataCortex.getItem({ id: 'test-id' });  // <-- CHANGE THIS
  if (!testData) { fail('No test data returned'); window.__testResults = results; return; }
  pass('Test data fetched');
  log('Data: ' + JSON.stringify(testData).substring(0, 200));
} catch (e) {
  fail('Data fetch error: ' + e.message);
  window.__testResults = results;
  return;
}

// ── Render component ──
const container = document.createElement('div');
container.id = 'test-container';
document.body.appendChild(container);

const result = await lib.render(container, {
  // ADAPT THESE PROPS to match the component spec:
  locale: 'fi',
  translations: translations,
  // TODO: add component-specific props from testData
});

// ── Wait for async DOM population (do not remove) ──
await new Promise(r => setTimeout(r, 3000));

// ── Check DOM output ──
log('Container HTML length: ' + container.innerHTML.length);
if (container.innerHTML.length < 50) {
  fail('render: container nearly empty after 3s');
} else {
  pass('render: produced HTML content');
}

const text = container.textContent || '';
log('Container text (first 300): ' + text.substring(0, 300));

// ── Verify component-specific content (ADAPT THIS) ──
// TODO: Check that real data appears in the DOM.
// Use: text.includes(someValue) to verify rendered content.
if (text.length > 50) pass('render: has substantial text');
else fail('render: text too short');

// ── Check translations applied (do not remove) ──
const rawKeyPattern = /app\.[a-z]+\.[a-z]+/g;
const rawKeys = text.match(rawKeyPattern) || [];
if (Object.keys(translations).length > 0 && rawKeys.length > 3) {
  fail('render: ' + rawKeys.length + ' raw translation keys: ' + rawKeys.slice(0,5).join(', '));
} else {
  pass('render: translations applied');
}

// ── Capture snapshot BEFORE destroy (do not remove) ──
window.__renderSnapshot = container.innerHTML;

// ── Check return object ──
if (result && result.el instanceof HTMLElement) {
  pass('render: returned {el} HTMLElement');
} else {
  fail('render: result.el is not HTMLElement');
}

if (result && typeof result.destroy === 'function') {
  try { result.destroy(); pass('destroy: called OK'); }
  catch (e) { fail('destroy threw: ' + e.message); }
} else {
  log('Note: no destroy function');
}

// ── Cleanup (do not remove) ──
if (container.parentNode) container.parentNode.removeChild(container);
if (results.errors.length === 0) results.passed = true;
window.__testResults = results;
```

The `// pre-filled` values come from the resolver (zero LLM involvement). The `// ADAPT THIS` and `// TODO` sections are what the LLM modifies.

#### 3. Cortex App-Domain Test Template

**What resolver pre-fills:** lib name, feature component list, data cortex lib
**What LLM adapts:** init() expectations, navigation checks, sub-component verification
**Complexity: Medium.** Tests init() + render() + navigation.

#### 4. App Test Template

**What resolver pre-fills:** All cortex lib names, expected views from spec
**What LLM adapts:** View navigation tests, interaction verification
**Complexity: Medium-High.** But the template handles the hard parts (loading all scripts, auth setup).

---

## Implementation Steps

### Phase 1: Cortex Component Template (start here)

1. Create the template as a new prompt seed (`gen-test-cortex-component-template`)
2. Resolver pre-fills: `LIB_NAME`, `DATA_CORTEX_LIB`, `SERVICE_SLUG`, `METHOD_SIGNATURES`
3. LLM prompt says: "Here is a working test template. Adapt the marked sections for this specific component. You may modify any part, but keep the scaffolding structure."
4. Autopilot uses this template-based prompt instead of the current example-based prompt
5. Fix-prompt gets the adapted template + errors, follows the "don't break these" rules

### Phase 2: Cortex Data Template

6. Same pattern but simpler — method-call-and-verify structure
7. Resolver pre-fills method signatures from spec

### Phase 3: Cortex App-Domain + App Templates

8. Build on component template pattern
9. App-domain adds init() + navigation testing
10. App template handles full HTML page verification

### Phase 4: Code Generation Templates (future consideration)

11. The same principle could apply to CODE generation, not just tests
12. A cortex component code template with translation loading, render structure, IIFE wrapping
13. This would prevent the "LLM ignored translation loading instruction" problem permanently
14. **Evaluate after test templates prove the concept**

---

## Effort Estimate (Revised)

| Task | Effort | Impact |
|------|--------|--------|
| Cortex component test template + prompt | 2-3 hours | **Very high** — fixes the #1 failure source |
| Wire template into autopilot | 1-2 hours | Required infrastructure |
| Cortex data test template | 1-2 hours | Medium — data tests mostly work |
| Cortex app-domain test template | 2-3 hours | High — prevents issues in untested territory |
| App test template | 2-3 hours | High — app is complex |
| Fix-prompt rules update | 1 hour | Required for retry cycle |
| Template self-tests | 1-2 hours | Verify templates are correct |

**Total: ~10-16 hours**

Lower than the original estimate because:
- No "template engine" to build — templates are just pre-filled strings
- No rigid fill-in-the-blanks mechanism — LLM adapts freely
- Fix-prompt already exists — just needs updated rules

---

## What This Does NOT Solve

Templates fix **structural** test errors. They don't fix:

1. **Wrong component code** — if render() has a bug, the test will correctly fail
2. **Wrong spec** — if the spec says the wrong thing, code and test will both be wrong
3. **External API changes** — if an API changes, tests fail for legitimate reasons
4. **LLM creativity limits** — the LLM still needs to understand what to test

But that's fine — those are the problems we WANT to have. Structural boilerplate errors are the problems we want to eliminate.

---

## Summary

| Aspect | Before (current) | After (templates) |
|--------|------------------|-------------------|
| LLM task | Generate 100+ lines from rules | Adapt 20 lines in working code |
| Structural errors | Common (await, translations, ordering) | Near-zero (baked into template) |
| Fix cycle | Fix structural errors + logic errors | Fix only logic errors |
| Flexibility | Unlimited (LLM writes anything) | Unlimited (LLM can modify anything) |
| Reliability | Depends on LLM following 16 rules | Depends on LLM making 4 decisions |
| Token cost | High (long prompt + retries) | Lower (shorter prompt, fewer retries) |
