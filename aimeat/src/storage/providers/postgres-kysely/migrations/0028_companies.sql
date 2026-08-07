-- 0028_companies.sql
--
-- The company registry (company-in-a-box): a company is a first-class entity like an app,
-- and creating one reserves {slug}.co.<apex>. The co family is to companies what the apps
-- family is to apps.
--
--   * The slug lives HERE rather than in "SubdomainSite" on purpose. That table holds one
--     flat label namespace shared by the apps family, and a company named "tinki" must not
--     collide with an app named "tinki" — they are different hosts. Separate registry,
--     separate namespace, no coordination needed between the two.
--   * The unique index on lower("slug") is the arbitration: two founders claiming the same
--     name at the same moment cannot both win, without any read-then-write window.
--   * The legal-identity columns are the seller-party snapshot an invoice needs, so a founder
--     types them once here and every later invoice prefills from them.

CREATE TABLE IF NOT EXISTS "Company" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "ownerGhii" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "organismId" TEXT,
  "frontPageKind" TEXT NOT NULL DEFAULT 'none',
  "frontPageTarget" TEXT NOT NULL DEFAULT '',
  "businessId" TEXT,
  "vatId" TEXT,
  "streetAddress" TEXT,
  "postalCode" TEXT,
  "city" TEXT,
  "country" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "iban" TEXT,
  "bic" TEXT,
  "einvoiceAddress" TEXT,
  "einvoiceOperator" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Company_slug_key" ON "Company"(lower("slug"));
CREATE INDEX IF NOT EXISTS "Company_owner_idx" ON "Company"("ownerGhii", "createdAt");
