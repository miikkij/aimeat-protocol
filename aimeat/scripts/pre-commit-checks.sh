#!/usr/bin/env bash
# @file pre-commit-checks.sh
# @description Pre-commit quality checks for AIMEAT project.
#   Validates file headers, file sizes, i18n sync, and runs lint + typecheck.
#
# @usage
#   bash scripts/pre-commit-checks.sh           # Check staged files only
#   bash scripts/pre-commit-checks.sh --all     # Check all source files
#
# @version-history
#   v1.0.0 — 2026-03-13 — Initial implementation

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

warn() { echo -e "${YELLOW}⚠ WARNING:${NC} $1"; ((WARNINGS++)) || true; }
fail() { echo -e "${RED}✘ ERROR:${NC} $1"; ((ERRORS++)) || true; }
pass() { echo -e "${GREEN}✔${NC} $1"; }

echo "━━━ AIMEAT Pre-Commit Checks ━━━"
echo ""

# ── 1. File Header Check ──
echo "📋 Checking file headers..."

if [ "${1:-}" = "--all" ]; then
  FILES=$(find src/ -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null || true)
else
  FILES=$(git diff --cached --name-only --diff-filter=ACM -- 'src/**/*.ts' 2>/dev/null || true)
fi

MISSING_HEADERS=0
for f in $FILES; do
  if [ -f "$f" ]; then
    # Check if file has @file and @description in first 10 lines
    if ! head -10 "$f" | grep -q '@file\|@description'; then
      warn "Missing header: $f"
      ((MISSING_HEADERS++)) || true
    fi
  fi
done

if [ "$MISSING_HEADERS" -eq 0 ]; then
  pass "All checked files have headers"
else
  warn "$MISSING_HEADERS file(s) missing headers (see docs/coding-guidelines/file-headers.md)"
fi

# ── 2. File Size Check ──
echo ""
echo "📏 Checking file sizes..."

LARGE_FILES=0
MAX_LINES=500

for f in $FILES; do
  if [ -f "$f" ]; then
    LINES=$(wc -l < "$f" 2>/dev/null || echo 0)
    if [ "$LINES" -gt "$MAX_LINES" ]; then
      warn "Large file ($LINES lines): $f"
      ((LARGE_FILES++)) || true
    fi
  fi
done

if [ "$LARGE_FILES" -eq 0 ]; then
  pass "All files under $MAX_LINES lines"
else
  warn "$LARGE_FILES file(s) exceed $MAX_LINES lines — consider splitting"
fi

# ── 3. i18n Sync Check ──
echo ""
echo "🌐 Checking i18n sync..."

if [ -f "locales/en.json" ] && [ -f "locales/fi.json" ]; then
  EN_KEYS=$(node -e "
    const en = JSON.parse(require('fs').readFileSync('locales/en.json','utf8'));
    function keys(obj, prefix='') {
      return Object.entries(obj).flatMap(([k,v]) =>
        typeof v === 'object' && v !== null ? keys(v, prefix+k+'.') : [prefix+k]
      );
    }
    console.log(keys(en).length);
  " 2>/dev/null || echo "?")
  FI_KEYS=$(node -e "
    const fi = JSON.parse(require('fs').readFileSync('locales/fi.json','utf8'));
    function keys(obj, prefix='') {
      return Object.entries(obj).flatMap(([k,v]) =>
        typeof v === 'object' && v !== null ? keys(v, prefix+k+'.') : [prefix+k]
      );
    }
    console.log(keys(fi).length);
  " 2>/dev/null || echo "?")

  if [ "$EN_KEYS" = "$FI_KEYS" ]; then
    pass "i18n files in sync ($EN_KEYS keys each)"
  else
    warn "i18n mismatch: en.json has $EN_KEYS keys, fi.json has $FI_KEYS keys"
  fi
else
  warn "Could not find locale files"
fi

# ── 4. TypeScript Type Check ──
echo ""
echo "🔧 Running type check..."

if npx tsc --noEmit 2>/dev/null; then
  pass "TypeScript compilation clean"
else
  fail "TypeScript compilation errors found"
fi

# ── 5. ESLint ──
echo ""
echo "🔍 Running ESLint..."

if npx eslint src/ --max-warnings=0 2>/dev/null; then
  pass "ESLint passed (0 warnings)"
elif npx eslint src/ 2>/dev/null; then
  warn "ESLint passed with warnings"
else
  fail "ESLint found errors"
fi

# ── Summary ──
echo ""
echo "━━━ Summary ━━━"
echo -e "Errors:   ${ERRORS}"
echo -e "Warnings: ${WARNINGS}"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo -e "${RED}Pre-commit checks FAILED. Fix errors before committing.${NC}"
  exit 1
else
  echo ""
  echo -e "${GREEN}Pre-commit checks passed.${NC}"
  exit 0
fi
