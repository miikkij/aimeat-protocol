# Known Gaps

This document tracks known technical gaps, limitations, and deferred fixes in the AIMEAT codebase. Each entry has a structured format that must be followed.

## Document Rules

1. **Remove entries when fixed.** If a gap has been resolved, delete it from this file entirely. Do not leave "fixed" entries here.
2. **Every entry must have a reason.** A gap cannot be added without a clear explanation of why it is deferred. "We'll do it later" is not a reason.
3. **Only the developer can add entries.** The AI assistant must not add gaps to this file on its own. If a gap is discovered during development, inform the developer and let them decide whether to add it here or fix it now.
4. **Keep it honest.** If the reason for deferral no longer applies (e.g., the blocking dependency was resolved), the gap should be addressed, not left here.

---

## Entry Format

Each gap must include all of these fields:

- **ID:** Short identifier (e.g., GAP-001)
- **Discovered:** Date when the gap was identified
- **Related to:** Which system, feature, or audit finding this relates to
- **Description:** What the gap is and what it means in practice
- **Impact:** What could go wrong if this is not fixed
- **Severity:** CRITICAL / HIGH / MEDIUM / LOW -- with a one-sentence justification
- **What needs to be done:** Concrete steps to resolve the gap
- **Why deferred:** The specific reason this is not being fixed right now
- **Revisit when:** Condition or timeframe for re-evaluating

---

## Active Gaps

No active entries. Resolved gaps are removed under rule 1 above; this is not a claim that the codebase has no defects.
