// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/markdown/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-markdown.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/config.js
  function cfg() {
    return window.__AIMEAT_SDK_CFG__ || { nodeId: "", baseUrl: "" };
  }
  function resolveNodeUrl() {
    const meta = document.querySelector('meta[name="aimeat-node"]');
    if (meta) return (meta.getAttribute("content") || "").replace(/\/$/, "");
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

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

  // src/static/sdk-libs/markdown/index.js
  var BT = String.fromCharCode(96);
  var SAFE = /^(https?:|mailto:)/i;
  var SAFE_IMG = /^(https?:|blob:)/i;
  function sanitizeHref(url) {
    if (typeof url !== "string") return null;
    var t = url.trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
    return SAFE.test(t) ? t : null;
  }
  function sanitizeImgSrc(url) {
    if (typeof url !== "string") return null;
    var t = url.trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
    return SAFE_IMG.test(t) ? t : null;
  }
  function txt(s) {
    return document.createTextNode(s == null ? "" : String(s));
  }
  function append(node, kids) {
    if (kids == null) return;
    if (!Array.isArray(kids)) kids = [kids];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? txt(c) : c);
    }
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    append(n, kids);
    return n;
  }
  function parseInline(text) {
    var out = [], i = 0, buf = "";
    function flush() {
      if (buf) {
        out.push(buf);
        buf = "";
      }
    }
    while (i < text.length) {
      var c = text[i];
      if (c === "!" && text[i + 1] === "[") {
        var close = text.indexOf("]", i + 2);
        if (close > i && text[close + 1] === "(") {
          var paren = text.indexOf(")", close + 2);
          if (paren > close) {
            var src = sanitizeImgSrc(text.slice(close + 2, paren));
            flush();
            if (src) out.push(el("img", { src, alt: text.slice(i + 2, close), "class": "md-img", loading: "lazy" }));
            i = paren + 1;
            continue;
          }
        }
      }
      if (c === BT) {
        var endc = text.indexOf(BT, i + 1);
        if (endc > i) {
          flush();
          out.push(el("code", { "class": "md-code" }, text.slice(i + 1, endc)));
          i = endc + 1;
          continue;
        }
      }
      if (c === "[") {
        var lc = text.indexOf("]", i + 1);
        if (lc > i && text[lc + 1] === "(") {
          var lp = text.indexOf(")", lc + 2);
          if (lp > lc) {
            var href = sanitizeHref(text.slice(lc + 2, lp));
            var label = parseInline(text.slice(i + 1, lc));
            flush();
            out.push(href ? el("a", { href, target: "_blank", rel: "noopener noreferrer nofollow" }, label) : el("span", null, label));
            i = lp + 1;
            continue;
          }
        }
      }
      if (c === "*" && text[i + 1] === "*") {
        var be = text.indexOf("**", i + 2);
        if (be > i) {
          flush();
          out.push(el("strong", null, parseInline(text.slice(i + 2, be))));
          i = be + 2;
          continue;
        }
      }
      if (c === "*") {
        var ie = text.indexOf("*", i + 1);
        if (ie > i) {
          flush();
          out.push(el("em", null, parseInline(text.slice(i + 1, ie))));
          i = ie + 1;
          continue;
        }
      }
      if (c === "_" && (i === 0 || !/\w/.test(text[i - 1])) && text[i + 1] && text[i + 1] !== " ") {
        var j = i + 1;
        while ((j = text.indexOf("_", j)) >= 0) {
          var after = text[j + 1];
          if (text[j - 1] !== " " && (after === void 0 || !/\w/.test(after))) break;
          j++;
        }
        if (j >= 0) {
          flush();
          out.push(el("em", null, parseInline(text.slice(i + 1, j))));
          i = j + 1;
          continue;
        }
      }
      buf += c;
      i++;
    }
    flush();
    return out;
  }
  function tableRow(line) {
    var cells = line.trim().split("|");
    if (cells.length && cells[0] === "") cells = cells.slice(1);
    if (cells.length && cells[cells.length - 1] === "") cells = cells.slice(0, -1);
    return cells.map(function(c) {
      return c.trim();
    });
  }
  function isDivider(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
  }
  function fenceInfo(line) {
    var t = line.replace(/^\s+/, ""), ch = t.charAt(0);
    if ((ch === BT || ch === "~") && t.slice(0, 3) === ch + ch + ch) return { marker: ch, lang: t.slice(3).trim().toLowerCase() };
    return null;
  }
  function isFenceLine(line) {
    return fenceInfo(line) !== null;
  }
  function isHeading(line) {
    return /^#{1,6}\s/.test(line);
  }
  function isQuote(line) {
    return /^\s*>/.test(line);
  }
  function isHr(line) {
    return /^\s*([-*_])\1{2,}\s*$/.test(line);
  }
  function isUl(line) {
    return /^(\s*)([-*+])\s+/.test(line);
  }
  function isOl(line) {
    return /^(\s*)(\d+)\.\s+/.test(line);
  }
  function isBlockStart(line) {
    return isFenceLine(line) || isHeading(line) || isQuote(line) || isUl(line) || isOl(line);
  }
  function parseBlocks(src) {
    var lines = src.replace(/\r\n?/g, "\n").split("\n");
    var blocks = [], i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (line.trim() === "") {
        i++;
        continue;
      }
      var fence = fenceInfo(line);
      if (fence) {
        var code = [];
        i++;
        while (i < lines.length && lines[i].trim().split("").join("") !== "" && !(lines[i].trim().length >= 3 && lines[i].trim().split("").every(function(x) {
          return x === fence.marker;
        }))) {
          code.push(lines[i]);
          i++;
        }
        i++;
        if (fence.lang === "aimeat-memory") {
          blocks.push(el("pre", { "class": "md-pre md-mem-src" }, el("code", { "class": "md-code" }, code.join("\n"))));
        } else {
          blocks.push(el("pre", { "class": "md-pre" }, el("code", { "class": "md-code" }, code.join("\n"))));
        }
        continue;
      }
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        blocks.push(el("h" + h[1].length, null, parseInline(h[2].trim())));
        i++;
        continue;
      }
      if (isQuote(line)) {
        var quoted = [];
        while (i < lines.length && isQuote(lines[i])) {
          quoted.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        blocks.push(el("blockquote", null, parseBlocks(quoted.join("\n"))));
        continue;
      }
      if (line.indexOf("|") !== -1 && i + 1 < lines.length && isDivider(lines[i + 1])) {
        var header = tableRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf("|") !== -1 && lines[i].trim() !== "") {
          rows.push(tableRow(lines[i]));
          i++;
        }
        var thead = el("thead", null, el("tr", null, header.map(function(c) {
          return el("th", null, parseInline(c));
        })));
        var tbody = el("tbody", null, rows.map(function(r) {
          return el("tr", null, r.map(function(c) {
            return el("td", null, parseInline(c));
          }));
        }));
        blocks.push(el("table", null, [thead, tbody]));
        continue;
      }
      if (isHr(line)) {
        blocks.push(el("hr", { "class": "md-hr" }));
        i++;
        continue;
      }
      if (isUl(line) || isOl(line)) {
        var ordered = isOl(line), items = [];
        while (i < lines.length && (ordered ? isOl(lines[i]) : isUl(lines[i]))) {
          var m = lines[i].match(ordered ? /^(\s*)(\d+)\.\s+(.*)$/ : /^(\s*)([-*+])\s+(.*)$/);
          var parts = [m[3]];
          i++;
          while (i < lines.length && lines[i].trim() !== "" && !isUl(lines[i]) && !isOl(lines[i]) && !isHeading(lines[i]) && !isFenceLine(lines[i]) && !isQuote(lines[i]) && !isHr(lines[i])) {
            parts.push(lines[i].trim());
            i++;
          }
          items.push(el("li", null, parseInline(parts.join(" "))));
        }
        blocks.push(el(ordered ? "ol" : "ul", null, items));
        continue;
      }
      var para = [];
      while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      blocks.push(el("p", null, parseInline(para.join(" "))));
    }
    return blocks;
  }
  function render(text, target) {
    var div = el("div", { "class": "md-body" }, parseBlocks(typeof text === "string" ? text : ""));
    if (target) {
      var t = typeof target === "string" ? document.querySelector(target) : target;
      if (t) {
        t.innerHTML = "";
        t.appendChild(div);
      }
    }
    return div;
  }
  function renderToString(text) {
    return render(text).outerHTML;
  }
  var RICH_CSS = '.md-body li.task-list-item{list-style:none;margin-left:-1.2rem;}.md-body li.task-list-item input[type=checkbox]{margin-right:.45rem;vertical-align:-1px;}.md-body .footnotes{font-size:.85rem;opacity:.75;}.md-body pre.md-mermaid{position:relative;}.md-body pre.md-mermaid::after{content:"mermaid";position:absolute;top:.35rem;right:.55rem;font-size:.62rem;opacity:.6;}.md-body pre.md-mermaid.md-mermaid-err::after{content:"mermaid — syntax error, showing source";color:#e06c75;opacity:1;}.md-body .md-mermaid-svg{margin:.8rem 0;overflow-x:auto;text-align:center;}.md-body .md-mermaid-svg svg{max-width:100%;height:auto;}.md-body .hljs-comment,.md-body .hljs-quote{color:#7d8799;font-style:italic;}.md-body .hljs-keyword,.md-body .hljs-selector-tag,.md-body .hljs-doctag{color:#a626a4;}.md-body .hljs-string,.md-body .hljs-regexp,.md-body .hljs-addition{color:#50a14f;}.md-body .hljs-number,.md-body .hljs-literal,.md-body .hljs-attr{color:#986801;}.md-body .hljs-title,.md-body .hljs-name,.md-body .hljs-section{color:#4078f2;}.md-body .hljs-built_in,.md-body .hljs-type{color:#c18401;}.md-body .hljs-symbol,.md-body .hljs-bullet,.md-body .hljs-meta,.md-body .hljs-selector-id,.md-body .hljs-variable,.md-body .hljs-template-variable{color:#0184bb;}.md-body .hljs-deletion{color:#ca1243;}.md-body .hljs-emphasis{font-style:italic;}.md-body .hljs-strong{font-weight:700;}[data-theme="dark"] .md-body .hljs-comment,[data-theme="dark"] .md-body .hljs-quote{color:#7f848e;}[data-theme="dark"] .md-body .hljs-keyword,[data-theme="dark"] .md-body .hljs-selector-tag,[data-theme="dark"] .md-body .hljs-doctag{color:#c678dd;}[data-theme="dark"] .md-body .hljs-string,[data-theme="dark"] .md-body .hljs-regexp,[data-theme="dark"] .md-body .hljs-addition{color:#98c379;}[data-theme="dark"] .md-body .hljs-number,[data-theme="dark"] .md-body .hljs-literal,[data-theme="dark"] .md-body .hljs-attr{color:#d19a66;}[data-theme="dark"] .md-body .hljs-title,[data-theme="dark"] .md-body .hljs-name,[data-theme="dark"] .md-body .hljs-section{color:#61afef;}[data-theme="dark"] .md-body .hljs-built_in,[data-theme="dark"] .md-body .hljs-type{color:#e5c07b;}[data-theme="dark"] .md-body .hljs-symbol,[data-theme="dark"] .md-body .hljs-bullet,[data-theme="dark"] .md-body .hljs-meta,[data-theme="dark"] .md-body .hljs-selector-id,[data-theme="dark"] .md-body .hljs-variable,[data-theme="dark"] .md-body .hljs-template-variable{color:#56b6c2;}[data-theme="dark"] .md-body .hljs-deletion{color:#e06c75;}.md-body .md-mem{border:1px solid var(--color-base-300,#d8dde4);border-radius:8px;padding:.5em .8em .7em;margin:1em 0;background:var(--color-base-200,#f4f5f7);}[data-theme="dark"] .md-body .md-mem{border-color:var(--color-base-300,#3a3a3a);background:var(--color-base-200,#1c1c1c);}.md-body .md-mem-head{display:flex;align-items:center;gap:.6em;font-size:.78rem;opacity:.75;margin-bottom:.35em;}.md-body .md-mem-title{font-family:ui-monospace,Menlo,Consolas,monospace;overflow-wrap:anywhere;flex:1;}.md-body .md-mem-refresh{border:none;background:transparent;color:inherit;cursor:pointer;border-radius:4px;padding:0 .3em;font-size:.9rem;}.md-body .md-mem table{margin:.3em 0 0;}.md-body .md-mem-note{opacity:.75;font-size:.88rem;padding:.2em 0;}.md-body .md-mem-err{color:#e06c75;opacity:1;}.md-body .md-mem-more{opacity:.7;font-size:.78rem;margin-top:.3em;}.md-body .md-mem-value{white-space:pre-wrap;overflow-wrap:anywhere;}';
  function injectRichCss() {
    if (document.getElementById("aimeat-md-rich-styles")) return;
    var s = document.createElement("style");
    s.id = "aimeat-md-rich-styles";
    s.textContent = RICH_CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  var _scriptP = {};
  function loadScript(src) {
    if (_scriptP[src]) return _scriptP[src];
    _scriptP[src] = new Promise(function(resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function() {
        resolve(void 0);
      };
      s.onerror = function() {
        delete _scriptP[src];
        reject(new Error("failed to load " + src));
      };
      document.head.appendChild(s);
    });
    return _scriptP[src];
  }
  var _richP = null;
  function ensureRich() {
    if (window.markdownit && window.DOMPurify) return Promise.resolve();
    if (_richP) return _richP;
    _richP = loadScript("https://cdn.jsdelivr.net/npm/markdown-it@14/dist/markdown-it.min.js").then(function() {
      return Promise.all([
        loadScript("https://cdn.jsdelivr.net/npm/markdown-it-task-lists@2/dist/markdown-it-task-lists.min.js").catch(function() {
        }),
        loadScript("https://cdn.jsdelivr.net/npm/markdown-it-footnote@4/dist/markdown-it-footnote.min.js").catch(function() {
        }),
        loadScript("https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"),
        loadScript("https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11/highlight.min.js").catch(function() {
        })
      ]);
    }).catch(function(e) {
      _richP = null;
      throw e;
    });
    return _richP;
  }
  var _mermaidP = null;
  var _mmSeq = 0;
  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (_mermaidP) return _mermaidP;
    _mermaidP = new Promise(function(resolve, reject) {
      var s = document.createElement("script");
      s.src = NODE_URL + "/lib/mermaid/mermaid.min.js";
      s.onload = function() {
        try {
          window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            flowchart: { htmlLabels: false },
            suppressErrorRendering: true,
            // parse errors must NOT inject mermaid's error bomb into <body>
            theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "neutral"
          });
          resolve(window.mermaid);
        } catch (e) {
          reject(e);
        }
      };
      s.onerror = function() {
        _mermaidP = null;
        reject(new Error("mermaid load failed"));
      };
      document.head.appendChild(s);
    });
    return _mermaidP;
  }
  function renderMermaids(container) {
    var nodes = container.querySelectorAll("pre.md-mermaid");
    if (!nodes.length) return;
    loadMermaid().then(function(mm) {
      nodes.forEach(function(preEl) {
        mm.render("aimd-" + _mmSeq++, preEl.textContent || "").then(function(r) {
          if (!preEl.isConnected) return;
          var d = document.createElement("div");
          d.className = "md-mermaid-svg";
          d.innerHTML = r.svg;
          preEl.replaceWith(d);
        }).catch(function() {
          preEl.classList.add("md-mermaid-err");
        });
      });
    }).catch(function() {
    });
  }
  function parseEmbedSpec(text) {
    var spec = {};
    String(text || "").split("\n").forEach(function(line) {
      var m = line.match(/^\s*([a-zA-Z_-]+)\s*[:=]\s*(.+?)\s*$/);
      if (!m) return;
      var k = m[1].toLowerCase();
      if (k === "fields") spec.fields = m[2].split(",").map(function(s) {
        return s.trim();
      }).filter(Boolean);
      else spec[k] = m[2];
    });
    return spec;
  }
  function memCellText(v) {
    if (v == null) return "—";
    var s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.length > 160 ? s.slice(0, 160) + "…" : s;
  }
  function isPlainObj(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }
  function buildMemBody(spec, value) {
    var view = (spec.view || "auto").toLowerCase();
    if (view === "auto") {
      if (Array.isArray(value)) view = value.length && value.every(isPlainObj) ? "table" : "list";
      else if (isPlainObj(value)) view = "props";
      else view = "value";
    }
    if (view === "json") return el("pre", { "class": "md-pre" }, el("code", { "class": "md-code" }, JSON.stringify(value, null, 2)));
    if (view === "table") {
      var rows = (Array.isArray(value) ? value : []).filter(isPlainObj);
      var cols = spec.fields && spec.fields.length ? spec.fields : [];
      if (!cols.length) {
        rows.forEach(function(r) {
          Object.keys(r).forEach(function(k) {
            if (cols.indexOf(k) < 0 && cols.length < 10) cols.push(k);
          });
        });
      }
      var table = el("table", null, [
        el("thead", null, el("tr", null, cols.map(function(c) {
          return el("th", null, c);
        }))),
        el("tbody", null, rows.slice(0, 200).map(function(r) {
          return el("tr", null, cols.map(function(c) {
            return el("td", null, memCellText(r[c]));
          }));
        }))
      ]);
      var out = [table];
      if (rows.length > 200) out.push(el("div", { "class": "md-mem-more" }, "… " + (rows.length - 200) + " more rows"));
      return el("div", null, out);
    }
    if (view === "props") {
      var obj = isPlainObj(value) ? value : {};
      return el("table", null, el("tbody", null, Object.keys(obj).map(function(k) {
        return el("tr", null, [el("th", null, k), el("td", null, memCellText(obj[k]))]);
      })));
    }
    if (view === "list") {
      var arr = Array.isArray(value) ? value : [value];
      return el("ul", null, arr.slice(0, 200).map(function(v) {
        return el("li", null, memCellText(v));
      }));
    }
    return el("div", { "class": "md-mem-value" }, memCellText(value));
  }
  function renderOneEmbed(preEl) {
    var spec = parseEmbedSpec(preEl.textContent || "");
    var box = el("div", { "class": "md-mem" });
    var title = el("span", { "class": "md-mem-title" }, spec.title || spec.key || "aimeat-memory");
    var refresh = el("button", { type: "button", "class": "md-mem-refresh", title: "Refresh" }, "↻");
    box.appendChild(el("div", { "class": "md-mem-head" }, [title, refresh]));
    var body = el("div", { "class": "md-mem-note" }, "Loading…");
    box.appendChild(body);
    function setBody(node) {
      box.replaceChild(node, body);
      body = node;
    }
    function note(msg, err) {
      setBody(el("div", { "class": "md-mem-note" + (err ? " md-mem-err" : "") }, msg));
    }
    async function load() {
      if (!spec.key) {
        note("The block declares no key", true);
        return;
      }
      try {
        var envl;
        if (spec.owner) {
          var r = await fetch(NODE_URL + "/v1/memory/" + encodeURIComponent(spec.owner) + "/" + encodeURIComponent(spec.key));
          envl = await r.json();
        } else {
          var auth = window.AIMEAT && window.AIMEAT.auth;
          var s = auth && auth.getSession && auth.getSession();
          if (!s || !s.jwt) {
            note("Sign in to view this data", true);
            return;
          }
          envl = await s.fetch("/v1/memory/" + encodeURIComponent(spec.key) + "?owner_scope=true");
          if (envl && typeof envl.json === "function") envl = await envl.json();
        }
        if (!envl || envl.ok === false) {
          var code = envl && envl.error && envl.error.code || "";
          if (code === "NOT_FOUND") note("Key not found", true);
          else if (code === "AUTH_REQUIRED") note("Sign in to view this data", true);
          else if (/SCOPE|FORBIDDEN|CONSENT|ACCESS|DENIED/.test(code)) note("🔒 No permission to read this key", true);
          else note("Could not load (" + (envl && envl.error && envl.error.message || code || "?") + ")", true);
          return;
        }
        var value = envl.data ? envl.data.value : void 0;
        if (value == null) {
          note("(empty)");
          return;
        }
        setBody(buildMemBody(spec, value));
      } catch (e) {
        note("Could not load (" + (e && e.message || "?") + ")", true);
      }
    }
    refresh.addEventListener("click", function() {
      note("Loading…");
      load();
    });
    preEl.replaceWith(box);
    load();
  }
  function renderMemoryEmbeds(container) {
    container.querySelectorAll("pre.md-mem-src").forEach(function(p) {
      renderOneEmbed(p);
    });
  }
  var _mdit = null;
  function getMdIt() {
    if (_mdit) return _mdit;
    if (!window.markdownit) return null;
    var m = window.markdownit({
      html: false,
      linkify: true,
      highlight: function(code, lang) {
        if (window.hljs && code.length < 3e4) {
          try {
            if (lang && window.hljs.getLanguage(lang)) return window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
          } catch {
          }
        }
        return "";
      }
    });
    try {
      if (window.markdownitTaskLists) m.use(window.markdownitTaskLists);
    } catch {
    }
    try {
      if (window.markdownitFootnote) m.use(window.markdownitFootnote);
    } catch {
    }
    var defFence = m.renderer.rules.fence || function(t, i, o, e, s) {
      return s.renderToken(t, i, o);
    };
    m.renderer.rules.fence = function(tokens, idx, options, env, self) {
      var t = tokens[idx];
      var info = String(t.info || "").trim().toLowerCase();
      if (info === "mermaid") {
        return '<pre class="md-mermaid">' + m.utils.escapeHtml(t.content) + "</pre>\n";
      }
      if (info === "aimeat-memory") {
        return '<pre class="md-mem-src">' + m.utils.escapeHtml(t.content) + "</pre>\n";
      }
      return defFence(tokens, idx, options, env, self);
    };
    _mdit = m;
    return m;
  }
  async function renderRich(text, target) {
    text = typeof text === "string" ? text : "";
    var div;
    try {
      await ensureRich();
      injectRichCss();
      var m = getMdIt();
      if (!m || !window.DOMPurify) throw new Error("rich pipeline unavailable");
      div = el("div", { "class": "md-body" });
      div.innerHTML = window.DOMPurify.sanitize(m.render(text));
      div.querySelectorAll("a[href]").forEach(function(a) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer nofollow");
      });
      div.querySelectorAll("input[type=checkbox]").forEach(function(cb) {
        cb.disabled = true;
      });
      renderMermaids(div);
    } catch {
      div = render(text);
    }
    injectRichCss();
    renderMemoryEmbeds(div);
    if (target) {
      var t = typeof target === "string" ? document.querySelector(target) : target;
      if (t) {
        t.innerHTML = "";
        t.appendChild(div);
      }
    }
    return div;
  }
  var CSS = ".md-body{line-height:1.6;color:var(--color-base-content,#e6e6e6);word-wrap:break-word;}.md-body>:first-child{margin-top:0;}.md-body>:last-child{margin-bottom:0;}.md-body h1,.md-body h2,.md-body h3,.md-body h4,.md-body h5,.md-body h6{font-weight:700;line-height:1.3;margin:1.8em 0 .6em;}.md-body h1{font-size:1.7rem;padding-bottom:.3em;border-bottom:2px solid var(--color-base-300,#3a3a3a);margin-top:.2em;}.md-body h2{font-size:1.32rem;padding-bottom:.25em;border-bottom:1px solid var(--color-base-300,#3a3a3a);}.md-body h3{font-size:1.13rem;}.md-body h4{font-size:1rem;}.md-body h5{font-size:.9rem;}.md-body h6{font-size:.85rem;opacity:.7;}.md-body p{margin:.85em 0;}.md-body ul,.md-body ol{margin:.7em 0;padding-left:1.7em;}.md-body ul{list-style:disc;}.md-body ol{list-style:decimal;}.md-body li{margin:.32em 0;padding-left:.2em;}.md-body a{color:var(--color-primary,#4f9eff);text-decoration:none;}.md-body a:hover{text-decoration:underline;}.md-body strong{font-weight:700;}.md-body em{font-style:italic;}.md-body .md-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85em;background:var(--color-base-200,#1c1c1c);padding:.12em .42em;border-radius:4px;border:1px solid var(--color-base-300,#3a3a3a);}.md-body .md-pre{background:var(--color-base-200,#1c1c1c);border:1px solid var(--color-base-300,#3a3a3a);border-radius:8px;padding:.9em 1.1em;overflow-x:auto;margin:1em 0;line-height:1.5;}.md-body .md-pre .md-code{background:none;border:none;padding:0;font-size:.84rem;white-space:pre;}.md-body blockquote{margin:1em 0;padding:.3em 1.1em;border-left:3px solid var(--color-primary,#4f9eff);background:var(--color-base-200,#1c1c1c);border-radius:0 6px 6px 0;opacity:.85;}.md-body blockquote p{margin:.4em 0;}.md-body table{border-collapse:collapse;margin:1em 0;width:100%;font-size:.9rem;display:block;overflow-x:auto;}.md-body th,.md-body td{border:1px solid var(--color-base-300,#3a3a3a);padding:.45em .75em;text-align:left;vertical-align:top;}.md-body th{background:var(--color-base-200,#1c1c1c);font-weight:600;}.md-body tbody tr:nth-child(even){background:var(--color-base-200,#1c1c1c);}.md-body .md-img{max-width:100%;height:auto;border-radius:6px;margin:.6em 0;}.md-body hr,.md-body .md-hr{border:none;border-top:1px solid var(--color-base-300,#3a3a3a);margin:1.6em 0;}";
  function injectCss() {
    if (document.getElementById("aimeat-md-styles")) return;
    var s = document.createElement("style");
    s.id = "aimeat-md-styles";
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  injectCss();
  var CITE_URL_RE = /https?:\/\/[^\s,;)\]}"'【】]+/g;
  var SHORTENERS = ["lnkd.in", "bit.ly", "t.co", "ow.ly", "tinyurl.com", "buff.ly", "goo.gl", "is.gd", "rb.gy"];
  function citations(text, opts) {
    var strip = !opts || opts.stripInline !== false;
    var body = String(text == null ? "" : text);
    var seen = /* @__PURE__ */ Object.create(null);
    var out = [];
    function push(u) {
      u = String(u).replace(/[.,;:]+$/, "");
      if (!u || seen[u]) return;
      seen[u] = 1;
      var host;
      try {
        host = new URL(u).hostname.replace(/^www\./, "");
      } catch {
        host = "";
      }
      out.push({ url: u, host, shortened: SHORTENERS.indexOf(host) >= 0 });
    }
    body = body.replace(/【\s*(https?:\/\/[^】\s]+)\s*】/g, function(m, u) {
      push(u);
      return strip ? "" : m;
    });
    body = body.replace(/^[ \t]*Sources?[ \t]*:[ \t]*(.*)$/gim, function(m, rest) {
      (String(rest).match(CITE_URL_RE) || []).forEach(push);
      return strip ? "" : m;
    });
    (body.match(CITE_URL_RE) || []).forEach(push);
    if (strip) body = body.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    return { body, sources: out };
  }
  attach("md", { render, renderToString, renderRich, sanitizeHref, sanitizeImgSrc, citations });
})();
