// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/prompt/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-prompt.js (with a per-node config prelude).
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

  // src/static/sdk-libs/prompt/extract-json.js
  function extractJson(text) {
    const source = String(text == null ? "" : text).trim();
    if (!source) return void 0;
    const attempt = (candidate) => {
      try {
        return { ok: true, value: JSON.parse(candidate) };
      } catch {
        return { ok: false, value: void 0 };
      }
    };
    const whole = attempt(source);
    if (whole.ok) return whole.value;
    const fence = /(?:^|\n)[ \t]*(?:`{3}|~{3})[^\n]*\n([\s\S]*?)\n[ \t]*(?:`{3}|~{3})/g;
    for (let m = fence.exec(source); m; m = fence.exec(source)) {
      const inFence = attempt(m[1].trim());
      if (inFence.ok) return inFence.value;
    }
    for (let start = 0; start < source.length; start++) {
      const open = source[start];
      if (open !== "{" && open !== "[") continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") {
          depth--;
          if (depth === 0) {
            const found = attempt(source.slice(start, i + 1));
            if (found.ok) return found.value;
            break;
          }
        }
      }
    }
    return void 0;
  }

  // src/static/sdk-libs/prompt/index.js
  var STYLE_ID = "aimeat-prompt-style";
  var CSS = [
    ".aimeat-prompt{display:flex;flex-direction:column;gap:.75rem;padding:1rem;border:1px solid var(--color-base-300,#d4d4d8);border-radius:var(--radius-box,.75rem);background:var(--color-base-100,#fff);color:var(--color-base-content,#18181b);font:inherit;max-width:100%;box-sizing:border-box}",
    ".aimeat-prompt *{box-sizing:border-box}",
    ".aimeat-prompt__label{font-weight:600;margin:0}",
    ".aimeat-prompt__hint{margin:0;font-size:.875rem;opacity:.75}",
    ".aimeat-prompt__text{margin:0;padding:.75rem;max-height:14rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:.8125rem/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--color-base-200,#f4f4f5);border-radius:calc(var(--radius-box,.75rem)/2)}",
    ".aimeat-prompt__row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}",
    ".aimeat-prompt__btn{min-height:2.75rem;padding:.5rem 1rem;border:1px solid var(--color-primary,#4f46e5);border-radius:calc(var(--radius-box,.75rem)/2);background:var(--color-primary,#4f46e5);color:var(--color-primary-content,#fff);font:inherit;font-weight:600;cursor:pointer}",
    ".aimeat-prompt__btn--quiet{background:transparent;color:var(--color-base-content,#18181b);border-color:var(--color-base-300,#d4d4d8)}",
    ".aimeat-prompt__btn:disabled{opacity:.5;cursor:default}",
    ".aimeat-prompt__btn:focus-visible,.aimeat-prompt__answer:focus-visible{outline:2px solid var(--color-primary,#4f46e5);outline-offset:2px}",
    ".aimeat-prompt__answer{width:100%;min-height:7rem;padding:.75rem;border:1px solid var(--color-base-300,#d4d4d8);border-radius:calc(var(--radius-box,.75rem)/2);background:var(--color-base-100,#fff);color:inherit;font:inherit;resize:vertical}",
    ".aimeat-prompt__status{margin:0;font-size:.875rem;min-height:1.25rem}",
    ".aimeat-prompt__status--error{color:var(--color-error,#b91c1c)}"
  ].join("\n");
  var TEXT = {
    en: {
      copy: "Copy the prompt",
      copied: "Copied",
      show: "Show the prompt",
      hide: "Hide the prompt",
      hint: "Copy the prompt, run it in your own AI chat, then paste the whole answer below.",
      hintCopyOnly: "Copy the prompt and run it in your own AI chat.",
      answer: "Paste the answer here",
      use: "Use this answer",
      copyFailed: "Could not copy. Select the prompt text and copy it by hand.",
      empty: "Paste the answer first.",
      notJson: "No JSON found in the answer. Ask your AI to answer with JSON only, then paste again.",
      building: "Preparing the prompt…"
    },
    fi: {
      copy: "Kopioi prompti",
      copied: "Kopioitu",
      show: "Näytä prompti",
      hide: "Piilota prompti",
      hint: "Kopioi prompti, aja se omassa AI-chatissasi ja liitä koko vastaus alle.",
      hintCopyOnly: "Kopioi prompti ja aja se omassa AI-chatissasi.",
      answer: "Liitä vastaus tähän",
      use: "Käytä tätä vastausta",
      copyFailed: "Kopiointi ei onnistunut. Valitse promptin teksti ja kopioi se käsin.",
      empty: "Liitä ensin vastaus.",
      notJson: "Vastauksesta ei löytynyt JSONia. Pyydä AI:ta vastaamaan pelkällä JSONilla ja liitä uudelleen.",
      building: "Valmistellaan promptia…"
    },
    es: {
      copy: "Copiar el prompt",
      copied: "Copiado",
      show: "Mostrar el prompt",
      hide: "Ocultar el prompt",
      hint: "Copia el prompt, ejecútalo en tu propio chat de IA y pega abajo la respuesta completa.",
      hintCopyOnly: "Copia el prompt y ejecútalo en tu propio chat de IA.",
      answer: "Pega aquí la respuesta",
      use: "Usar esta respuesta",
      copyFailed: "No se pudo copiar. Selecciona el texto del prompt y cópialo a mano.",
      empty: "Primero pega la respuesta.",
      notJson: "No se encontró JSON en la respuesta. Pide a tu IA que responda solo con JSON y pega de nuevo.",
      building: "Preparando el prompt…"
    }
  };
  function pageLang() {
    const auth = globalThis.AIMEAT && globalThis.AIMEAT.auth;
    const raw = auth && typeof auth.getLang === "function" && auth.getLang() || document.documentElement.lang || "en";
    const short = String(raw).slice(0, 2).toLowerCase();
    return TEXT[short] ? short : "en";
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  }
  function button(className, text) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = className;
    node.textContent = text;
    return node;
  }
  async function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const done = document.execCommand("copy");
    field.remove();
    if (!done) throw new Error("copy refused");
  }
  function card(target, options) {
    const host = typeof target === "string" ? document.querySelector(target) : target;
    if (!host) throw new Error("AIMEAT.prompt.card: no element matches " + String(target));
    if (!options || typeof options.prompt !== "string" && typeof options.prompt !== "function") {
      throw new Error("AIMEAT.prompt.card: options.prompt is a string or a function that returns one");
    }
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const words = TEXT[TEXT[options.lang] ? options.lang : pageLang()];
    let source = options.prompt;
    const build = async () => String(typeof source === "function" ? await source() : source);
    const root = el("section", "aimeat-prompt");
    if (options.label) root.appendChild(el("h3", "aimeat-prompt__label", options.label));
    const takesAnswer = typeof options.onResult === "function";
    root.appendChild(el("p", "aimeat-prompt__hint", options.hint || (takesAnswer ? words.hint : words.hintCopyOnly)));
    const shown = el("pre", "aimeat-prompt__text");
    const fitTabStop = () => {
      if (!shown.hidden && shown.scrollHeight > shown.clientHeight) shown.tabIndex = 0;
      else shown.removeAttribute("tabindex");
    };
    const row = el("div", "aimeat-prompt__row");
    const copyButton = button("aimeat-prompt__btn", words.copy);
    const toggle = button("aimeat-prompt__btn aimeat-prompt__btn--quiet", words.hide);
    row.append(copyButton, toggle);
    const status = el("p", "aimeat-prompt__status");
    status.setAttribute("role", "status");
    root.append(shown, row);
    const say = (text, isError) => {
      status.textContent = text || "";
      status.classList.toggle("aimeat-prompt__status--error", Boolean(isError));
    };
    const refresh = async () => {
      shown.textContent = words.building;
      try {
        shown.textContent = await build();
      } catch (err) {
        shown.textContent = "";
        say(String(err && err.message || err), true);
      }
      fitTabStop();
    };
    const setShown = (visible) => {
      shown.hidden = !visible;
      toggle.textContent = visible ? words.hide : words.show;
      toggle.setAttribute("aria-expanded", String(visible));
      fitTabStop();
    };
    copyButton.addEventListener("click", async () => {
      copyButton.disabled = true;
      try {
        const text = await build();
        shown.textContent = text;
        fitTabStop();
        await copyText(text);
        copyButton.textContent = words.copied;
        say("");
        setTimeout(() => {
          copyButton.textContent = words.copy;
        }, 2e3);
        if (typeof options.onCopied === "function") options.onCopied(text);
      } catch (err) {
        console.warn("aimeat-prompt: the prompt could not be copied", err);
        say(words.copyFailed, true);
        setShown(true);
      } finally {
        copyButton.disabled = false;
      }
    });
    toggle.addEventListener("click", () => setShown(shown.hidden));
    let answer = null;
    if (typeof options.onResult === "function") {
      answer = /** @type {HTMLTextAreaElement} */
      el("textarea", "aimeat-prompt__answer");
      answer.placeholder = words.answer;
      answer.setAttribute("aria-label", words.answer);
      const useButton = button("aimeat-prompt__btn", words.use);
      useButton.addEventListener("click", async () => {
        const raw = answer ? answer.value.trim() : "";
        if (!raw) {
          say(words.empty, true);
          return;
        }
        let value = raw;
        if (options.expect === "json") {
          const parsed = extractJson(raw);
          if (parsed === void 0) {
            say(words.notJson, true);
            return;
          }
          value = parsed;
        }
        const refusal = typeof options.validate === "function" ? options.validate(value) : null;
        if (refusal) {
          say(String(refusal), true);
          return;
        }
        useButton.disabled = true;
        try {
          await options.onResult(value, raw);
          say("");
        } catch (err) {
          say(String(err && err.message || err), true);
        } finally {
          useButton.disabled = false;
        }
      });
      const useRow = el("div", "aimeat-prompt__row");
      useRow.appendChild(useButton);
      root.append(answer, useRow);
    }
    root.appendChild(status);
    host.replaceChildren(root);
    setShown(options.showPrompt !== false);
    refresh();
    return {
      setPrompt(next) {
        source = next;
        refresh();
      },
      getPrompt: build,
      reset() {
        if (answer) answer.value = "";
        say("");
      },
      destroy() {
        root.remove();
      }
    };
  }
  attach("prompt", { card, extractJson });
})();
