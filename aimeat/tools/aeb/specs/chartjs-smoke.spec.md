# chartjs smoke test set

Minimal single-page component proving a mid-tier model produces WORKING Chart.js code.
Model builds one-shot, fetches `GET /v1/library-packs/chartjs` ai_doc, loads ONLY from the node.

Task: a self-contained page that renders TWO Chart.js charts from sample data — (1) a bar chart
(~8 months of sales), (2) a line chart with 2 datasets. Colors follow the light/dark theme via CSS
variables. NO login / no AIMEAT.auth/data (pure client render). Zero console errors on load.

Pass = both canvases draw (non-blank) + `window.Chart` present + 0 app-attributable console errors,
verified in a real browser.
