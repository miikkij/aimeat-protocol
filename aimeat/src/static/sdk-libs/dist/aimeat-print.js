// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/print/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-print.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns = namespace();
    ns[key] = value;
    return ns;
  }

  // src/static/sdk-libs/print/content.js
  var ALLOWED = new Set("P DIV SECTION ARTICLE H1 H2 H3 H4 H5 H6 SPAN STRONG B EM I U S SMALL SUB SUP BR HR UL OL LI BLOCKQUOTE PRE CODE TABLE THEAD TBODY TFOOT TR TH TD CAPTION IMG A FIGURE FIGCAPTION DL DT DD".split(" "));
  var DROP = new Set("SCRIPT STYLE IFRAME OBJECT EMBED LINK META NOSCRIPT TEMPLATE SVG MATH VIDEO AUDIO".split(" "));
  function element(doc, tag, text, className) {
    const e = doc.createElement(tag);
    if (text != null) e.textContent = String(text);
    if (className) e.className = className;
    return e;
  }
  function safeUrl(value) {
    if (!value) return null;
    try {
      const u = new URL(value, document.baseURI);
      return ["https:", "http:", "blob:"].includes(u.protocol) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value) ? u.href : null;
    } catch {
      return null;
    }
  }
  function copyContent(source, doc) {
    if (source.nodeType === 3) return doc.createTextNode(source.textContent || "");
    if (source.nodeType !== 1) return doc.createDocumentFragment();
    const tag = source.tagName;
    if (DROP.has(tag) || source.hasAttribute("data-print-ignore")) return doc.createDocumentFragment();
    if (tag === "CANVAS") {
      const img = element(doc, "img");
      try {
        img.src = source.toDataURL("image/png");
      } catch {
        throw new Error("A canvas could not be printed because its image is cross-origin");
      }
      return img;
    }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) {
      if (source.type === "password" || source.type === "hidden") return doc.createDocumentFragment();
      return element(doc, "span", source.type === "checkbox" ? source.checked ? "✓" : "" : source.value);
    }
    if (tag === "BUTTON") return doc.createDocumentFragment();
    const e = ALLOWED.has(tag) ? element(doc, tag.toLowerCase()) : doc.createDocumentFragment();
    if (e.nodeType === 1) {
      if (tag === "IMG") {
        const url = safeUrl(source.getAttribute("src"));
        if (url) e.setAttribute("src", url);
        e.setAttribute("alt", source.getAttribute("alt") || "");
      }
      if (tag === "A") {
        const url = safeUrl(source.getAttribute("href"));
        if (url) e.setAttribute("href", url);
      }
      for (const name of ["colspan", "rowspan", "start"]) {
        const n = Number(source.getAttribute(name));
        if (Number.isInteger(n) && n > 0 && n <= 100) e.setAttribute(name, String(n));
      }
      if (source.getAttribute("data-print-break") === "before") e.setAttribute("data-print-break", "before");
      if (source.hasAttribute("data-print-keep")) e.setAttribute("data-print-keep", "");
    }
    for (const child of source.childNodes) e.appendChild(copyContent(child, doc));
    return e;
  }
  function htmlContent(html, doc) {
    const parsed = new DOMParser().parseFromString(String(html), "text/html");
    const fragment = doc.createDocumentFragment();
    for (const node of parsed.body.childNodes) fragment.appendChild(copyContent(node, doc));
    return fragment;
  }
  function table(block, doc) {
    const t = element(doc, "table"), head = element(doc, "thead"), row = element(doc, "tr"), body = element(doc, "tbody");
    for (const c of block.columns || []) row.appendChild(element(doc, "th", typeof c === "string" ? c : c.label));
    head.appendChild(row);
    t.appendChild(head);
    for (const data of block.rows || []) {
      const tr = element(doc, "tr");
      (block.columns || []).forEach((c, i) => tr.appendChild(element(doc, "td", Array.isArray(data) ? data[i] : data[typeof c === "string" ? c : c.key])));
      body.appendChild(tr);
    }
    t.appendChild(body);
    return t;
  }
  function blockContent(block, doc) {
    if (block.type === "pageBreak") {
      const e = element(doc, "div");
      e.setAttribute("data-print-break", "before");
      return e;
    }
    if (block.type === "heading") return element(doc, "h" + Math.max(1, Math.min(6, block.level || 2)), block.text);
    if (block.type === "text") return element(doc, "p", block.text);
    if (block.type === "html") return htmlContent(block.html, doc);
    if (block.type === "markdown") {
      if (!window.AIMEAT?.md?.renderToString) throw new Error("Load aimeat-markdown.js to print Markdown");
      return htmlContent(window.AIMEAT.md.renderToString(block.text), doc);
    }
    if (block.type === "image") {
      const image = element(doc, "img");
      const url = safeUrl(block.src);
      if (!url) throw new Error("Invalid print image URL");
      image.src = url;
      image.alt = block.alt || "";
      return image;
    }
    if (block.type === "table") return table(block, doc);
    if (block.type === "cards") {
      const list = element(doc, "section", null, "ap-cards");
      for (const item of block.items || []) {
        const card = element(doc, "article", null, "ap-card");
        card.setAttribute("data-print-keep", "");
        card.appendChild(element(doc, "h3", item.title));
        card.appendChild(element(doc, "p", item.text));
        if (item.meta) card.appendChild(element(doc, "small", item.meta));
        list.appendChild(card);
      }
      return list;
    }
    if (block.type === "calendar") {
      const section = element(doc, "section", null, "ap-calendar");
      const groups = /* @__PURE__ */ new Map();
      for (const event of block.events || []) {
        const day = event.localStart?.slice(0, 10) || event.start?.slice(0, 10);
        if (!day) throw new Error("Calendar printing needs occurrence start dates");
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day).push(event);
      }
      for (const day of [...groups.keys()].sort()) {
        const group = element(doc, "section", null, "ap-calendar-day");
        group.appendChild(element(doc, "h3", new Intl.DateTimeFormat(block.locale || "en", { dateStyle: "full", timeZone: "UTC" }).format(/* @__PURE__ */ new Date(day + "T12:00:00Z"))));
        for (const event of groups.get(day)) {
          const time = event.allDay ? block.allDayLabel || "All day" : (event.localStart || event.start).slice(11, 16) + "–" + (event.localEnd || event.end).slice(11, 16);
          group.appendChild(element(doc, "p", time + "  " + (event.title || "") + (event.location ? " · " + event.location : "")));
        }
        section.appendChild(group);
      }
      return section;
    }
    throw new Error("Unknown print block type: " + block.type);
  }
  function content(spec, doc) {
    const root = element(doc, "div");
    if (spec.title) root.appendChild(element(doc, "h1", spec.title));
    if (spec.subtitle) root.appendChild(element(doc, "p", spec.subtitle, "ap-subtitle"));
    if (spec.element) {
      const source = typeof spec.element === "string" ? document.querySelector(spec.element) : spec.element;
      if (!source) throw new Error("Print element was not found");
      root.appendChild(copyContent(source, doc));
    }
    if (spec.html != null) root.appendChild(htmlContent(spec.html, doc));
    if (spec.markdown != null) root.appendChild(blockContent({ type: "markdown", text: spec.markdown }, doc));
    for (const block of spec.blocks || []) root.appendChild(blockContent(block, doc));
    return root;
  }

  // src/static/sdk-libs/print/paginate.js
  function paginate(root, doc, spec) {
    const pages = [], columns = spec.columns || 1, maxPages = spec.maxPages || 500;
    let page, columnIndex = 0;
    let target;
    const replace = (s, n, total) => String(s ?? "").replace(/\{(page|pages|title|date)\}/g, (_, key) => ({ page: n, pages: total, title: spec.title || "", date: spec.date || "" })[key]);
    function chrome(tag, config, n) {
      const e = element(doc, tag, null, "ap-" + tag);
      const c = typeof config === "string" ? { left: config } : config || {};
      for (const key of ["left", "center", "right"]) {
        const part = element(doc, "div");
        part.dataset.template = String(c[key] || "");
        part.textContent = replace(part.dataset.template, n, "888");
        e.appendChild(part);
      }
      if (tag === "header" && spec.logo) {
        const url = safeUrl(spec.logo);
        if (!url) throw new Error("Invalid logo URL");
        const img = element(doc, "img");
        img.src = url;
        img.alt = "";
        e.firstElementChild.prepend(img);
      }
      return e;
    }
    function newPage() {
      if (pages.length >= maxPages) throw new RangeError("Print page limit exceeded");
      page = element(doc, "section", null, "ap-page");
      page.appendChild(chrome("header", pages.length === 0 && spec.firstHeader !== void 0 ? spec.firstHeader : spec.header ?? { left: "{title}", right: "{date}" }, pages.length + 1));
      const body = element(doc, "main", null, "ap-body");
      for (let i = 0; i < columns; i++) body.appendChild(element(doc, "div", null, "ap-column"));
      page.appendChild(body);
      page.appendChild(chrome("footer", pages.length === 0 && spec.firstFooter !== void 0 ? spec.firstFooter : spec.footer ?? { right: "{page} / {pages}" }, pages.length + 1));
      doc.body.appendChild(page);
      pages.push(page);
      columnIndex = 0;
      target = body.firstElementChild;
    }
    function next() {
      if (columnIndex + 1 < columns) {
        columnIndex++;
        target = page.querySelectorAll(".ap-column")[columnIndex];
      } else newPage();
    }
    const fits = () => target.scrollHeight <= target.clientHeight + 1;
    const occupied = () => target.childNodes.length > 0;
    function append(node) {
      target.appendChild(node);
      if (fits()) return true;
      node.remove();
      return false;
    }
    function splitText(node) {
      const texts = [];
      const walker = doc.createTreeWalker(node, 4);
      let text;
      while (text = walker.nextNode()) texts.push(text);
      const length = node.textContent.length;
      if (!length) throw new RangeError("Print block is taller than a page");
      function slice(end, tail = false) {
        const range = doc.createRange();
        range.selectNodeContents(node);
        let pos = end;
        for (const t of texts) {
          if (pos <= t.length) {
            if (tail) range.setStart(t, pos);
            else range.setEnd(t, pos);
            break;
          }
          pos -= t.length;
        }
        const part = node.cloneNode(false);
        part.appendChild(range.cloneContents());
        return part;
      }
      let lo = 0, hi = length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2), candidate = slice(mid);
        target.appendChild(candidate);
        const ok = fits();
        candidate.remove();
        if (ok) lo = mid;
        else hi = mid - 1;
      }
      if (lo === 0) {
        if (occupied()) {
          next();
          place(node);
          return;
        }
        throw new RangeError("Print text cannot fit; reduce font size or margins");
      }
      const breakAt = node.textContent.lastIndexOf(" ", lo);
      if (breakAt > lo * 0.6) lo = breakAt + 1;
      target.appendChild(slice(lo));
      if (lo < length) {
        next();
        place(slice(lo, true));
      }
    }
    function splitTable(table2) {
      if (table2.querySelector("[rowspan]")) throw new RangeError("A table with row spans must fit one page; split it before printing");
      const rows = [...table2.querySelectorAll(":scope > tbody > tr, :scope > tr")];
      if (!rows.length) {
        splitText(table2);
        return;
      }
      function shell() {
        const t = table2.cloneNode(false);
        for (const head of table2.querySelectorAll(":scope > caption, :scope > thead")) t.appendChild(head.cloneNode(true));
        const body = element(doc, "tbody");
        t.appendChild(body);
        return { t, body };
      }
      let chunk = shell();
      target.appendChild(chunk.t);
      for (const row of rows) {
        chunk.body.appendChild(row.cloneNode(true));
        if (fits()) continue;
        chunk.body.lastElementChild.remove();
        if (!chunk.body.children.length) chunk.t.remove();
        next();
        chunk = shell();
        target.appendChild(chunk.t);
        chunk.body.appendChild(row.cloneNode(true));
        if (!fits()) throw new RangeError("A table row is taller than one page; reduce font size, widen the page or shorten the row");
      }
      const foot = table2.querySelector(":scope > tfoot");
      if (foot) place(foot.cloneNode(true));
    }
    function place(node) {
      if (node.nodeType === 3) {
        if (!node.textContent.trim()) return;
        const p = element(doc, "p", node.textContent);
        place(p);
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.getAttribute("data-print-break") === "before" && occupied()) {
        newPage();
        node.removeAttribute("data-print-break");
      }
      if (append(node)) return;
      if (node.tagName === "TABLE") {
        splitTable(node);
        return;
      }
      if (node.hasAttribute("data-print-keep") || node.tagName === "IMG") {
        if (occupied()) next();
        if (!append(node)) throw new RangeError("A kept print block is taller than one page");
        return;
      }
      if (["DIV", "SECTION", "ARTICLE", "UL", "OL"].includes(node.tagName) && node.children.length) {
        for (const child of [...node.childNodes]) place(child);
        return;
      }
      splitText(node);
    }
    newPage();
    const nodes = [...root.childNodes];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.nodeType === 1 && /^H[1-6]$/.test(node.nodeName) && nodes[i + 1] && occupied()) {
        const probe = element(doc, "div");
        probe.appendChild(node.cloneNode(true));
        const nextBlock = nodes[i + 1];
        probe.appendChild(element(doc, "p", (nextBlock.textContent || "").slice(0, 180)));
        target.appendChild(probe);
        const ok = fits();
        probe.remove();
        if (!ok) next();
      }
      place(node);
    }
    pages.forEach((p, i) => p.querySelectorAll("[data-template]").forEach((el) => {
      const logo = el.querySelector("img");
      el.textContent = replace(el.dataset.template, i + 1, pages.length);
      if (logo) el.prepend(logo);
    }));
    for (const p of pages) for (const c of p.querySelectorAll(".ap-header,.ap-footer")) if (c.scrollHeight > c.clientHeight + 1) throw new RangeError("Print header or footer exceeds its reserved height");
    return pages;
  }

  // src/static/sdk-libs/print/print.css
  var print_default = "/**\n * @file print/print.css\n * @description Physical print pages and their preview. App branding enters through scoped variables.\n * @version-history v1.0.0 - 2026-09-18 - Initial paged document styles.\n */\n:root { color-scheme: light; }\n* { box-sizing: border-box; }\nhtml, body { margin: 0; padding: 0; }\nbody { background: #e7e9ed; color: var(--ap-ink, #18212d); font: var(--ap-font-size, 11pt)/1.45 var(--ap-font, Arial, sans-serif); }\n.ap-page { width: var(--ap-width); height: var(--ap-height); padding: var(--ap-margin); background: var(--ap-paper, white); margin: 16px auto; display: flex; flex-direction: column; break-after: page; box-shadow: 0 2px 12px #0002; }\n.ap-page:last-child { break-after: auto; }\n.ap-header, .ap-footer { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center; gap: 8px; flex: 0 0 var(--ap-header-height); font-size: 9pt; overflow-wrap: anywhere; }\n.ap-header { border-bottom: 1px solid var(--ap-line, #c9ced5); padding-bottom: 3mm; margin-bottom: 4mm; }\n.ap-footer { flex-basis: var(--ap-footer-height); border-top: 1px solid var(--ap-line, #c9ced5); padding-top: 3mm; margin-top: 4mm; }\n.ap-header > :nth-child(2), .ap-footer > :nth-child(2) { text-align: center; }\n.ap-header > :nth-child(3), .ap-footer > :nth-child(3) { text-align: right; }\n.ap-header img { max-height: 12mm; max-width: 35mm; vertical-align: middle; margin-right: 3mm; }\n.ap-body { flex: 1 1 0; min-height: 0; display: grid; grid-template-columns: repeat(var(--ap-columns), minmax(0, 1fr)); gap: 7mm; }\n.ap-column { min-width: 0; min-height: 0; overflow-wrap: anywhere; }\n.ap-column > :first-child { margin-top: 0; }\nh1, h2, h3, h4, h5, h6 { color: var(--ap-heading, var(--ap-ink, #18212d)); line-height: 1.2; margin: 0 0 3mm; }\nh1 { font-size: 24pt; } h2 { font-size: 17pt; } h3 { font-size: 12pt; }\np, ul, ol, blockquote, pre, dl { margin: 0 0 3mm; }\np { white-space: pre-wrap; }\npre { white-space: pre-wrap; }\nimg { display: block; max-width: 100%; max-height: var(--ap-image-height, 180mm); object-fit: contain; }\ntable { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 4mm; }\nth, td { border: 1px solid var(--ap-line, #c9ced5); padding: 2mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }\nth { background: var(--ap-tint, #eff2f5); font-weight: 700; }\na { color: inherit; text-decoration: underline; }\n.ap-card { border: 1px solid var(--ap-line, #c9ced5); border-radius: 2mm; padding: 4mm; margin-bottom: 4mm; }\n.ap-calendar-day { border-top: 2px solid var(--ap-line, #c9ced5); padding-top: 3mm; margin-bottom: 4mm; }\n.ap-subtitle { color: var(--ap-muted, #536174); }\n.ap-compact { --ap-font-size: 9pt; }\n@media print {\n  html, body { width: var(--ap-width); background: transparent; }\n  .ap-page { margin: 0; box-shadow: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }\n}\n";

  // src/static/sdk-libs/print/preview.css
  var preview_default = "/**\n * @file print/preview.css\n * @description Keyboard-accessible print preview on the host page, including short and mobile viewports.\n * @version-history v1.0.0 - 2026-09-18 - Initial preview.\n */\n.ap-preview { position: fixed; inset: 0; width: min(1100px, 100%); height: 100dvh; max-width: 100%; max-height: 100dvh; margin: auto; padding: 0; border: 0; background: var(--card, #fff); color: var(--text, #18212d); }\n.ap-preview::backdrop { background: #0008; }\n.ap-preview[open] { display: flex; flex-direction: column; }\n.ap-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px; flex: 0 0 auto; border-bottom: 1px solid var(--border, #c9ced5); }\n.ap-toolbar strong { flex: 1; min-width: 100px; overflow-wrap: anywhere; }\n.ap-toolbar button { font: inherit; min-height: 44px; padding: 8px 16px; border: 1px solid var(--border, #c9ced5); border-radius: 6px; color: inherit; background: var(--bg, #fff); cursor: pointer; }\n.ap-toolbar button:focus-visible { outline: 3px solid var(--accent, #2563eb); outline-offset: 2px; }\n.ap-preview-host { flex: 1; min-height: 0; }\n.ap-preview-host iframe { display: block; width: 100%; height: 100%; border: 0; }\n.ap-status { padding: 12px; }\n.ap-build-frame { position: fixed; left: -20000px; top: 0; width: 1200px; height: 1000px; border: 0; }\n";

  // src/static/sdk-libs/print/index.js
  var templates = /* @__PURE__ */ new Map([
    ["document", {}],
    ["table", { orientation: "landscape", fontSize: 10 }],
    ["cards", { columns: 2 }],
    ["calendar", { orientation: "landscape" }]
  ]);
  var words = {
    en: { preview: "Print preview", print: "Print / Save as PDF", close: "Close", loading: "Preparing pages…" },
    fi: { preview: "Tulostuksen esikatselu", print: "Tulosta / tallenna PDF", close: "Sulje", loading: "Muodostetaan sivuja…" },
    es: { preview: "Vista previa", print: "Imprimir / Guardar PDF", close: "Cerrar", loading: "Preparando páginas…" }
  };
  function hostStyles() {
    if (document.querySelector("style[data-aimeat-print]")) return;
    const style = element(document, "style", preview_default);
    style.dataset.aimeatPrint = "";
    document.head.appendChild(style);
  }
  function number(value, fallback, min, max, name) {
    const n = value ?? fallback;
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw new RangeError("Invalid print " + name);
    return n;
  }
  function options(input) {
    const preset = templates.get(input.template || "document");
    if (!preset) throw new Error("Unknown print template");
    const s = { ...preset, ...input };
    const sizes = { A4: [210, 297], A3: [297, 420], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
    const size = sizes[s.paper || "A4"];
    if (!size) throw new RangeError("Unknown paper size");
    if (s.orientation && !["portrait", "landscape"].includes(s.orientation)) throw new RangeError("Invalid orientation");
    const [width, height] = s.orientation === "landscape" ? [size[1], size[0]] : size;
    const margin = number(s.margin, 15, 4, 50, "margin"), headerHeight = number(s.headerHeight, 12, 5, 50, "header height"), footerHeight = number(s.footerHeight, 10, 5, 50, "footer height");
    const columns = number(s.columns, 1, 1, 3, "columns");
    if (!Number.isInteger(columns)) throw new RangeError("Columns must be an integer");
    if (height - 2 * margin - headerHeight - footerHeight - 8 < 30) throw new RangeError("Margins leave no printable content area");
    const maxPages = number(s.maxPages, 500, 1, 1e3, "page limit");
    if (!Number.isInteger(maxPages)) throw new RangeError("Page limit must be an integer");
    return { ...s, width, height, margin, headerHeight, footerHeight, columns, fontSize: number(s.fontSize, 11, 7, 30, "font size"), maxPages };
  }
  async function loadImages(root) {
    await Promise.all([...root.querySelectorAll("img")].map(async (img) => {
      if (!img.getAttribute("src")) return;
      let timer;
      try {
        await Promise.race([img.decode(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Print image timed out")), 15e3);
        })]);
      } catch {
        throw new Error("A print image could not load: " + (img.alt || img.getAttribute("src")));
      } finally {
        clearTimeout(timer);
      }
    }));
  }
  async function prepare(input, config = {}) {
    hostStyles();
    const spec = options(input), frame = element(document, "iframe");
    frame.title = spec.title || "Print document";
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    const host = typeof config.target === "string" ? document.querySelector(config.target) : config.target;
    if (config.target && !host) throw new Error("Print target was not found");
    if (!host) frame.className = "ap-build-frame";
    let loadTimer;
    const loaded = new Promise((resolve, reject) => {
      loadTimer = setTimeout(() => reject(new Error("Print frame could not load")), 15e3);
      frame.addEventListener("load", () => {
        clearTimeout(loadTimer);
        resolve();
      }, { once: true });
    });
    frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
    (host || document.body).appendChild(frame);
    try {
      await loaded;
      const doc = frame.contentDocument;
      doc.documentElement.lang = spec.locale || document.documentElement.lang || "en";
      const style = element(doc, "style", print_default + "\n@page { size: " + spec.width + "mm " + spec.height + "mm; margin: 0; }\n@media print {body {zoom:1!important}}");
      doc.head.appendChild(style);
      doc.title = spec.title || "Print document";
      const vars = { "width": spec.width + "mm", "height": spec.height + "mm", "margin": spec.margin + "mm", "header-height": spec.headerHeight + "mm", "footer-height": spec.footerHeight + "mm", "columns": spec.columns, "font-size": spec.fontSize + "pt", "image-height": spec.height - 2 * spec.margin - spec.headerHeight - spec.footerHeight - 12 + "mm" };
      for (const [key, value] of Object.entries(vars)) doc.documentElement.style.setProperty("--ap-" + key, String(value));
      for (const key of ["ink", "paper", "line", "heading", "tint", "muted"]) if (spec.brand?.[key]) {
        if (!CSS.supports("color", spec.brand[key])) throw new RangeError("Invalid brand color");
        doc.documentElement.style.setProperty("--ap-" + key, spec.brand[key]);
      }
      if (spec.font) {
        if (!/^[\w ,'-]+$/.test(spec.font)) throw new RangeError("Use a font-family name");
        doc.documentElement.style.setProperty("--ap-font", spec.font);
      }
      const source = content(spec, doc);
      doc.body.appendChild(source);
      await loadImages(source);
      await doc.fonts.ready;
      source.remove();
      const pages = paginate(source, doc, spec);
      await loadImages(doc.body);
      for (const el of doc.querySelectorAll(".ap-header,.ap-footer")) if (el.scrollHeight > el.clientHeight + 1) throw new RangeError("Header or footer is too tall");
      const resize = () => {
        if (host) doc.body.style.setProperty("zoom", String(Math.min(1, frame.clientWidth / (spec.width * 96 / 25.4 + 32))));
      };
      const observer = new ResizeObserver(resize);
      if (host) observer.observe(frame);
      resize();
      let destroyed = false;
      const assertLive = () => {
        if (destroyed) throw new Error("Print document has been destroyed");
      };
      return {
        iframe: frame,
        document: doc,
        pages: pages.length,
        print() {
          assertLive();
          frame.contentWindow.focus();
          frame.contentWindow.print();
        },
        toHTML() {
          assertLive();
          const clone = doc.documentElement.cloneNode(true);
          clone.querySelector("body").style.removeProperty("zoom");
          return "<!doctype html>\n" + clone.outerHTML;
        },
        destroy() {
          if (destroyed) return;
          destroyed = true;
          observer.disconnect();
          frame.remove();
        }
      };
    } catch (error) {
      clearTimeout(loadTimer);
      frame.remove();
      throw error;
    }
  }
  async function preview(spec) {
    hostStyles();
    const lang = (spec.locale || document.documentElement.lang || "en").slice(0, 2), t = words[lang] || words.en;
    const dialog = element(document, "dialog", null, "ap-preview"), bar = element(document, "div", null, "ap-toolbar");
    const title = element(document, "strong", spec.title || t.preview), printButton = element(document, "button", t.print), close = element(document, "button", t.close);
    dialog.setAttribute("aria-label", t.preview);
    printButton.disabled = true;
    bar.append(title, printButton, close);
    dialog.appendChild(bar);
    const host = element(document, "div", null, "ap-preview-host"), status = element(document, "p", t.loading, "ap-status");
    host.appendChild(status);
    dialog.appendChild(host);
    document.body.appendChild(dialog);
    const previous = document.activeElement;
    dialog.showModal();
    close.focus();
    let built, closed = false;
    const destroy = () => {
      if (closed) return;
      closed = true;
      built?.destroy();
      dialog.close();
      dialog.remove();
      if (previous instanceof HTMLElement) previous.focus();
    };
    close.addEventListener("click", destroy);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      destroy();
    });
    try {
      built = await prepare(spec, { target: host });
      if (closed) {
        built.destroy();
        throw new Error("Print preview was closed");
      }
      status.remove();
      printButton.disabled = false;
      printButton.addEventListener("click", () => built.print());
      return { ...built, dialog, destroy };
    } catch (error) {
      destroy();
      throw error;
    }
  }
  function registerTemplate(name, defaults) {
    if (typeof name !== "string" || !name.trim() || name.length > 80) throw new RangeError("Template needs a name");
    templates.set(name, structuredClone(defaults));
  }
  attach("print", { version: "1.0.0", prepare, preview, registerTemplate, templates: () => [...templates.keys()] });
})();
