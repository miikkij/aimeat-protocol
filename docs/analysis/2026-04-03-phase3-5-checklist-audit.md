# Phase 3-5 Checklist Audit — 2026-04-03

## Item 1: Prompt seeds exist and match browser JS

| Seed | Status | Notes |
|------|--------|-------|
| gen-cortex-data | ✅ | Has spec_section, callExt pattern, object params |
| gen-cortex-component | ✅ | Has spec_section (just added), all use cases/views |
| gen-cortex-app-domain | ✅ | Has spec_section (just added) |
| gen-test-cortex-spec | ✅ | Data cortex only — cortex methods at top, no callExt |
| gen-test-cortex-component | ✅ | NEW — tests render() with real data |
| gen-test-cortex-app-domain | ✅ | NEW — tests init() + render() |
| gen-app | ✅ | Exists, has cortex_script_loads, translation_keys |

## Item 2: Resolver produces ALL variables with real content

| Resolver | Status | Issues Found |
|----------|--------|-------------|
| resolveCortexData | ✅ | warnFallback on all paths |
| resolveCortexComponent | ✅ | warnFallback added for use_case, view_section, data_cortex_api. Use case now passes ALL use cases (fixed language matching). |
| resolveCortexAppDomain | ⚠️ | `dataCortexSection` fallback is plain string "No data cortex available" — NOT using warnFallback |
| resolveApp | ⚠️ | `c.subtype === 'app-domain'` lookup at line 435 will fail without enrichment. App resolver gets completedComponents from autopilot (enriched) but NOT from UI route. |
| resolveTestCortexComponent | ✅ | Has warnFallback for data_cortex_info |
| resolveTestCortexAppDomain | ⚠️ | `dataCortexInfo` fallback is plain string, not warnFallback |

**ACTION NEEDED:** Add warnFallback to resolveCortexAppDomain and resolveTestCortexAppDomain fallbacks.

## Item 3: Autopilot passes correct data

| Data | Status | Notes |
|------|--------|-------|
| extensionSpec for cortex-data spec | ✅ | Loaded from completed extension |
| dataApiSpec for component spec | ✅ | Loaded from completed data cortex (after subtype enrichment) |
| componentSpecs for app-domain spec | ✅ | Loaded from completed component cortexes |
| translationKeys | ✅ | Loaded from completed translations |
| selfSpec | ✅ | Passed to code and test prompts |
| componentLabel | ✅ | Passed to test prompts |
| completedComponents enriched with subtype | ✅ | Enriched in main loop and code gen section |

## Item 4: Validation works

| Validator | Status | Issues |
|-----------|--------|--------|
| Extension spec (validateExtensionSpec) | ✅ | Called by autopilot, checks actions/memory |
| Data API spec (validateDataApiSpec) | ✅ | NOW called by autopilot. ASCII name check added. |
| Component spec (validateComponentSpec) | ✅ | NOW called by autopilot. ASCII name check added. |
| App-domain spec (validateAppDomainSpec) | ✅ | NOW called by autopilot. ASCII name check added. |
| Cortex code (validators.cortex) | ✅ | Checks YAML, JS, LIB_NAME, IIFE, exports |
| App code (validators.app) | ❓ | NOT YET TESTED — app phase not enabled |

**Fixed this session:** Non-ASCII names (ä, ö, å) rejected by all spec validators. Autopilot now validates ALL cortex specs.

## Item 5: Registration works

| Type | Status | Notes |
|------|--------|-------|
| Cortex initial registration | ✅ | POST /v1/cortex with manifest+libs, deactivate+delete+retry on 409 |
| Cortex fix-cycle re-registration | ✅ | Deactivates old name, registers new, updates registeredAs |
| Cortex fresh-gen re-registration | ✅ | Same pattern as fix-cycle |
| App registration | ❓ | NOT YET TESTED |

## Item 6: stripCodeblock

| Type | Status | Notes |
|------|--------|-------|
| Cortex code | ✅ | stripCodeblock SKIPPED — validator needs fenced blocks |
| Cortex test code | ✅ | stripCodeblock called normally |
| App code | ❓ | NOT YET TESTED — single HTML block should work |

## Item 7: Test uses correct methods

| Type | Status | Notes |
|------|--------|-------|
| Data cortex test | ✅ | Tests API methods via window.AIMEAT.libName |
| Component cortex test | ✅ | Tests render() with real data from data cortex |
| App-domain cortex test | ✅ | Tests init() + render() |
| Extension test | ✅ | Tests actions via callExt in server sandbox |
| App test | ❌ NOT YET IMPLEMENTED | App not in test gate |

## Item 8: Golden samples / spec passed to test

| Type | Status | Notes |
|------|--------|-------|
| Data cortex | ✅ | Golden samples labeled as extension data, spec passed |
| Component cortex | ✅ | Data cortex info passed for getting real data |
| App-domain cortex | ✅ | Feature components and data cortex info passed |

## Item 9: Test failure stops pipeline

| Status | Notes |
|--------|-------|
| ✅ | Pipeline stops on test failure for all types. Fix cycle runs 2 rounds + fresh gen before stopping. |

## Item 10: Debug artifacts

| Artifact | Status |
|----------|--------|
| spec-prompt | ✅ |
| spec-raw-response | ✅ |
| spec.txt | ✅ |
| prompt.txt | ✅ |
| ai-raw-response.txt | ✅ |
| generated.txt | ✅ |
| test-prompt.txt | ✅ |
| test-raw-response.txt | ✅ |
| test-code.js | ✅ |
| test-result.json | ✅ |
| validation-fix-N-prompt/response | ✅ |
| test-fix-N-reflection-prompt/response | ✅ |
| test-fix-N-fix-prompt/response | ✅ |
| fresh-generation-prompt/response | ✅ |

## Item 11: UI shows correct workflow

| Feature | Status | Notes |
|---------|--------|-------|
| Spec section for cortex | ✅ | Shows for extension and cortex types |
| Spec section NOT for app | ✅ | hasSpec check excludes app |
| Spec state resets on component switch | ✅ | Fixed this session |
| Code prompt loads from backend | ✅ | |
| Test prompt loads from backend | ✅ | |

## Item 12: Phase gate

| Gate | Status |
|------|--------|
| cortex in ENABLED_TYPES | ✅ |
| ENABLED_CORTEX_SUBTYPES = data, component, app-domain | ✅ |
| app NOT in ENABLED_TYPES | ✅ (intentional — not ready) |

## Item 13: Terminal logging

| Feature | Status |
|---------|--------|
| Test pass/fail with errors | ✅ |
| Per-component status in summary | ✅ |
| Fix round logging | ✅ |
| warnFallback visible | ✅ |

---

## REMAINING ISSUES

### Must fix now:
1. **subtype not saved in component records** — JUST FIXED in generator-tab.js. But existing projects need re-creation.
2. **warnFallback missing** in resolveCortexAppDomain line 406 and resolveTestCortexAppDomain line 1015

### Must fix before app phase:
3. **App not in test gate** — line 625 only checks extension+cortex
4. **App test prompt doesn't exist** — need gen-test-app
5. **App validator not verified** — validators.app exists but untested in autopilot flow
