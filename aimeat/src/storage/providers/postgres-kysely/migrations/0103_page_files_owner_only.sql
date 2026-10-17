-- 0103_page_files_owner_only.sql
--
-- A portfolio page and a company page are the owner's files, not public ones.
--
-- Both pages are served by their own origin ({user}.portfolio.<apex>, {slug}.co.<apex>), which reads
-- the file from storage and decides on the page's own switch (portfolio.config.enabled, the company's
-- frontPage). The file was also written with visibility 'public', so GET /v1/pub/<owner>/<key>
-- served it to anyone, including a page its owner had taken off the web (plan doc-mvcn6c7e4e5q, V0.3).
--
-- The keys are exact: 'portfolio/index.html' (routes/portfolio.ts PORTFOLIO_HTML_KEY) and
-- 'company/<id>/index.html' (services/company/company-portfolio.ts companyPortfolioKey). Nothing
-- else is touched. Running it twice changes nothing the second time.
--
-- Mirrors the SQLite statement in schema.ts.
UPDATE "StorageFile" SET "visibility" = 'owner'
WHERE "visibility" = 'public'
  AND ("key" = 'portfolio/index.html' OR ("key" LIKE 'company/%' AND "key" LIKE '%/index.html'));
