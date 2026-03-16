/**
 * aimeat-ui-forms — Form inputs, selects, checkboxes, radios, toggles, textareas, and form groups.
 *
 * Components: Input, Select, Checkbox, Radio, Toggle, Textarea, FormGroup
 * Zero external dependencies — pure DOM API.
 *
 * Usage:
 *   <script src="/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js"></script>
 *   <script>
 *     var input = AIMEAT.ui.forms.Input({ label: 'Email', type: 'email', required: true });
 *     document.body.appendChild(input.el);
 *   </script>
 */
(function (AIMEAT) {
  'use strict';

  // ── CSS ───────────────────────────────────────────────
  var stylesInjected = false;
  var CSS = [
    '/* Form container query wrapper */',
    '.aui-form-field {',
    '  container-type: inline-size;',
    '  position: relative;',
    '  margin-bottom: 1rem;',
    '  font-family: "DM Sans", system-ui, sans-serif;',
    '  color: var(--text, #1A1A2E);',
    '}',

    '/* ── Input / Textarea floating label ── */',
    '.aui-input-wrap {',
    '  position: relative;',
    '}',
    '.aui-input-wrap input,',
    '.aui-input-wrap textarea {',
    '  width: 100%; box-sizing: border-box;',
    '  padding: 1rem 0.75rem 0.375rem;',
    '  font-size: 0.9375rem; font-family: inherit;',
    '  border: 1.5px solid var(--border, #E5E7EB);',
    '  border-radius: var(--radius-xs, 6px);',
    '  background: var(--bg-card, #fff);',
    '  color: var(--text, #1A1A2E);',
    '  outline: none;',
    '  transition: border-color 0.2s, box-shadow 0.2s;',
    '}',
    '.aui-input-wrap input:focus,',
    '.aui-input-wrap textarea:focus {',
    '  border-color: var(--accent, #E8564A);',
    '  box-shadow: 0 0 0 3px rgba(232,86,74,0.12);',
    '}',
    '.aui-input-wrap input::placeholder,',
    '.aui-input-wrap textarea::placeholder {',
    '  color: transparent;',
    '}',
    '.aui-input-wrap input:focus::placeholder,',
    '.aui-input-wrap textarea:focus::placeholder {',
    '  color: var(--text-muted, #9CA3AF);',
    '}',

    '/* Floating label */',
    '.aui-float-label {',
    '  position: absolute; left: 0.75rem; top: 50%;',
    '  transform: translateY(-50%);',
    '  font-size: 0.9375rem; color: var(--text-muted, #9CA3AF);',
    '  pointer-events: none;',
    '  transition: all 0.2s ease;',
    '  background: transparent;',
    '  padding: 0 2px;',
    '}',
    '.aui-input-wrap textarea ~ .aui-float-label {',
    '  top: 1rem; transform: none;',
    '}',
    '.aui-input-wrap input:focus ~ .aui-float-label,',
    '.aui-input-wrap input:not(:placeholder-shown) ~ .aui-float-label,',
    '.aui-input-wrap textarea:focus ~ .aui-float-label,',
    '.aui-input-wrap textarea:not(:placeholder-shown) ~ .aui-float-label {',
    '  top: 0; transform: translateY(-50%);',
    '  font-size: 0.75rem; color: var(--accent, #E8564A);',
    '  background: var(--bg-card, #fff);',
    '}',

    '/* Validation states */',
    '.aui-input-wrap.aui-has-error input,',
    '.aui-input-wrap.aui-has-error textarea {',
    '  border-color: var(--danger, #EF4444);',
    '}',
    '.aui-input-wrap.aui-has-error input:focus,',
    '.aui-input-wrap.aui-has-error textarea:focus {',
    '  box-shadow: 0 0 0 3px rgba(239,68,68,0.12);',
    '}',
    '.aui-input-wrap.aui-is-valid input,',
    '.aui-input-wrap.aui-is-valid textarea {',
    '  border-color: var(--success, #10B981);',
    '}',
    '.aui-error-msg {',
    '  font-size: 0.8rem; color: var(--danger, #EF4444);',
    '  margin-top: 0.25rem; min-height: 1.2em;',
    '}',

    '/* ── Custom Select ── */',
    '.aui-select-wrap {',
    '  position: relative;',
    '}',
    '.aui-select-display {',
    '  width: 100%; box-sizing: border-box;',
    '  padding: 0.625rem 2rem 0.625rem 0.75rem;',
    '  font-size: 0.9375rem; font-family: inherit;',
    '  border: 1.5px solid var(--border, #E5E7EB);',
    '  border-radius: var(--radius-xs, 6px);',
    '  background: var(--bg-card, #fff);',
    '  color: var(--text, #1A1A2E);',
    '  cursor: pointer; text-align: left;',
    '  transition: border-color 0.2s, box-shadow 0.2s;',
    '}',
    '.aui-select-display:focus {',
    '  border-color: var(--accent, #E8564A);',
    '  box-shadow: 0 0 0 3px rgba(232,86,74,0.12);',
    '  outline: none;',
    '}',
    '.aui-select-arrow {',
    '  position: absolute; right: 0.75rem; top: 50%;',
    '  transform: translateY(-50%); pointer-events: none;',
    '  font-size: 0.75rem; color: var(--text-muted, #9CA3AF);',
    '  transition: transform 0.2s;',
    '}',
    '.aui-select-wrap.aui-open .aui-select-arrow {',
    '  transform: translateY(-50%) rotate(180deg);',
    '}',
    '.aui-select-label {',
    '  display: block; font-size: 0.8rem; font-weight: 500;',
    '  color: var(--text-muted, #9CA3AF); margin-bottom: 0.25rem;',
    '}',
    '.aui-select-dropdown {',
    '  position: absolute; left: 0; right: 0; top: 100%;',
    '  margin-top: 4px;',
    '  background: var(--bg-card, #fff);',
    '  border: 1px solid var(--border, #E5E7EB);',
    '  border-radius: var(--radius-xs, 6px);',
    '  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.08));',
    '  max-height: 240px; overflow-y: auto;',
    '  z-index: 9999; display: none;',
    '  animation: auiFormsFadeIn 0.12s ease;',
    '}',
    '.aui-select-wrap.aui-open .aui-select-dropdown { display: block }',
    '.aui-select-search {',
    '  width: 100%; box-sizing: border-box;',
    '  padding: 0.5rem 0.75rem;',
    '  font-size: 0.875rem; font-family: inherit;',
    '  border: none; border-bottom: 1px solid var(--border, #E5E7EB);',
    '  outline: none; background: transparent;',
    '  color: var(--text, #1A1A2E);',
    '}',
    '.aui-select-option {',
    '  padding: 0.5rem 0.75rem; cursor: pointer;',
    '  font-size: 0.9375rem; transition: background 0.1s;',
    '}',
    '.aui-select-option:hover { background: var(--bg-surface, #F3F4F6) }',
    '.aui-select-option.aui-selected {',
    '  background: rgba(232,86,74,0.08); color: var(--accent, #E8564A); font-weight: 500;',
    '}',
    '.aui-select-chips {',
    '  display: flex; flex-wrap: wrap; gap: 0.25rem;',
    '}',
    '.aui-select-chip {',
    '  display: inline-flex; align-items: center; gap: 0.25rem;',
    '  padding: 0.125rem 0.5rem; font-size: 0.8rem;',
    '  background: rgba(232,86,74,0.1); color: var(--accent, #E8564A);',
    '  border-radius: 999px;',
    '}',
    '.aui-select-chip-remove {',
    '  cursor: pointer; font-size: 0.9rem; line-height: 1;',
    '  background: none; border: none; color: inherit; padding: 0;',
    '  font-family: inherit;',
    '}',

    '/* ── Checkbox ── */',
    '.aui-checkbox-wrap {',
    '  display: flex; align-items: center; gap: 0.5rem;',
    '  cursor: pointer; font-size: 0.9375rem;',
    '  -webkit-user-select: none; user-select: none;',
    '}',
    '.aui-checkbox-wrap input { position: absolute; opacity: 0; width: 0; height: 0; }',
    '.aui-checkbox-box {',
    '  width: 20px; height: 20px; flex-shrink: 0;',
    '  border: 1.5px solid var(--border, #E5E7EB);',
    '  border-radius: 4px; position: relative;',
    '  transition: background 0.2s, border-color 0.2s;',
    '  display: flex; align-items: center; justify-content: center;',
    '}',
    '.aui-checkbox-wrap input:checked ~ .aui-checkbox-box {',
    '  background: var(--accent, #E8564A); border-color: var(--accent, #E8564A);',
    '}',
    '.aui-checkbox-box svg {',
    '  width: 14px; height: 14px;',
    '}',
    '.aui-checkbox-box svg path {',
    '  stroke: white; stroke-width: 2.5; fill: none;',
    '  stroke-linecap: round; stroke-linejoin: round;',
    '  stroke-dasharray: 20; stroke-dashoffset: 20;',
    '  transition: stroke-dashoffset 0.25s ease;',
    '}',
    '.aui-checkbox-wrap input:checked ~ .aui-checkbox-box svg path {',
    '  stroke-dashoffset: 0;',
    '}',
    '/* Indeterminate dash */',
    '.aui-checkbox-box .aui-check-dash {',
    '  stroke-dasharray: 10; stroke-dashoffset: 10;',
    '}',
    '.aui-checkbox-wrap input:indeterminate ~ .aui-checkbox-box {',
    '  background: var(--accent, #E8564A); border-color: var(--accent, #E8564A);',
    '}',
    '.aui-checkbox-wrap input:indeterminate ~ .aui-checkbox-box .aui-check-dash {',
    '  stroke-dashoffset: 0;',
    '}',
    '.aui-checkbox-wrap input:indeterminate ~ .aui-checkbox-box .aui-check-mark {',
    '  stroke-dashoffset: 20;',
    '}',
    '.aui-checkbox-wrap input:focus-visible ~ .aui-checkbox-box {',
    '  box-shadow: 0 0 0 3px rgba(232,86,74,0.12);',
    '}',

    '/* ── Radio ── */',
    '.aui-radio-group {',
    '  display: flex; flex-direction: column; gap: 0.5rem;',
    '}',
    '.aui-radio-wrap {',
    '  display: flex; align-items: center; gap: 0.5rem;',
    '  cursor: pointer; font-size: 0.9375rem;',
    '  -webkit-user-select: none; user-select: none;',
    '}',
    '.aui-radio-wrap input { position: absolute; opacity: 0; width: 0; height: 0; }',
    '.aui-radio-circle {',
    '  width: 20px; height: 20px; flex-shrink: 0;',
    '  border: 1.5px solid var(--border, #E5E7EB);',
    '  border-radius: 50%; position: relative;',
    '  transition: border-color 0.2s;',
    '  display: flex; align-items: center; justify-content: center;',
    '}',
    '.aui-radio-dot {',
    '  width: 10px; height: 10px; border-radius: 50%;',
    '  background: var(--accent, #E8564A);',
    '  transform: scale(0); transition: transform 0.2s ease;',
    '}',
    '.aui-radio-wrap input:checked ~ .aui-radio-circle {',
    '  border-color: var(--accent, #E8564A);',
    '}',
    '.aui-radio-wrap input:checked ~ .aui-radio-circle .aui-radio-dot {',
    '  transform: scale(1);',
    '}',
    '.aui-radio-wrap input:focus-visible ~ .aui-radio-circle {',
    '  box-shadow: 0 0 0 3px rgba(232,86,74,0.12);',
    '}',

    '/* ── Toggle ── */',
    '.aui-toggle-wrap {',
    '  display: flex; align-items: center; gap: 0.625rem;',
    '  cursor: pointer; font-size: 0.9375rem;',
    '  -webkit-user-select: none; user-select: none;',
    '}',
    '.aui-toggle-wrap input { position: absolute; opacity: 0; width: 0; height: 0; }',
    '.aui-toggle-track {',
    '  width: 44px; height: 24px; flex-shrink: 0;',
    '  border-radius: 12px;',
    '  background: var(--border, #D1D5DB);',
    '  position: relative;',
    '  transition: background 0.25s;',
    '}',
    '.aui-toggle-thumb {',
    '  position: absolute; top: 2px; left: 2px;',
    '  width: 20px; height: 20px; border-radius: 50%;',
    '  background: #fff;',
    '  box-shadow: 0 1px 3px rgba(0,0,0,0.15);',
    '  transition: transform 0.25s ease;',
    '}',
    '.aui-toggle-wrap input:checked ~ .aui-toggle-track {',
    '  background: var(--accent, #E8564A);',
    '}',
    '.aui-toggle-wrap input:checked ~ .aui-toggle-track .aui-toggle-thumb {',
    '  transform: translateX(20px);',
    '}',
    '.aui-toggle-wrap input:focus-visible ~ .aui-toggle-track {',
    '  box-shadow: 0 0 0 3px rgba(232,86,74,0.12);',
    '}',

    '/* ── FormGroup ── */',
    '.aui-form-group {',
    '  container-type: inline-size;',
    '  font-family: "DM Sans", system-ui, sans-serif;',
    '}',
    '.aui-form-submit {',
    '  display: inline-flex; align-items: center; gap: 0.5rem;',
    '  padding: 0.625rem 1.5rem; border-radius: var(--radius-xs, 6px);',
    '  font-size: 0.9375rem; font-weight: 500; cursor: pointer;',
    '  border: none;',
    '  background: var(--accent, #E8564A); color: white;',
    '  font-family: inherit;',
    '  transition: filter 0.15s, box-shadow 0.15s, opacity 0.15s;',
    '}',
    '.aui-form-submit:hover {',
    '  filter: brightness(1.1); box-shadow: 0 4px 14px rgba(232,86,74,0.3);',
    '}',
    '.aui-form-submit:disabled {',
    '  opacity: 0.6; cursor: not-allowed; filter: none; box-shadow: none;',
    '}',
    '.aui-form-spinner {',
    '  display: inline-block; width: 16px; height: 16px;',
    '  border: 2px solid rgba(255,255,255,0.3);',
    '  border-top-color: white; border-radius: 50%;',
    '  animation: auiFormsSpin 0.6s linear infinite;',
    '}',

    '/* ── Animations ── */',
    '@keyframes auiFormsFadeIn { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: translateY(0) } }',
    '@keyframes auiFormsSpin { to { transform: rotate(360deg) } }',

    '/* ── Container query responsive ── */',
    '@container (max-width: 320px) {',
    '  .aui-input-wrap input,',
    '  .aui-input-wrap textarea,',
    '  .aui-select-display {',
    '    font-size: 0.875rem; padding: 0.875rem 0.625rem 0.3125rem;',
    '  }',
    '  .aui-float-label { font-size: 0.875rem; left: 0.625rem }',
    '}'
  ].join('\n');

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-aimeat', 'ui-forms');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ── Helpers ───────────────────────────────────────────
  function mkEl(tag, className, children) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function(c) {
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
    }
    return e;
  }

  var idCounter = 0;
  function uid(prefix) {
    idCounter += 1;
    return 'aui-' + prefix + '-' + idCounter + '-' + Date.now();
  }

  function resolveTarget(target) {
    if (!target) return null;
    if (typeof target === 'string') return document.querySelector(target);
    return target;
  }

  function mountTo(target, el) {
    var t = resolveTarget(target);
    if (t) t.appendChild(el);
  }

  // ── Input ─────────────────────────────────────────────
  /**
   * Input({ target?, label, type?, placeholder?, required?, name? })
   * Returns { el, destroy(), getValue(), setValue(v), setError(msg), clearError() }
   */
  function Input(opts) {
    injectStyles();
    opts = opts || {};
    var id = uid('input');

    var field = mkEl('div', 'aui-form-field');
    var wrap = mkEl('div', 'aui-input-wrap');

    var input = document.createElement('input');
    input.type = opts.type || 'text';
    input.id = id;
    input.placeholder = opts.placeholder || opts.label || ' ';
    if (opts.name) input.name = opts.name;
    if (opts.required) input.required = true;

    var label = document.createElement('label');
    label.className = 'aui-float-label';
    label.setAttribute('for', id);
    label.textContent = opts.label || '';

    var errorId = id + '-error';
    var errorDiv = mkEl('div', 'aui-error-msg');
    errorDiv.id = errorId;
    errorDiv.setAttribute('role', 'alert');
    errorDiv.setAttribute('aria-live', 'polite');
    input.setAttribute('aria-describedby', errorId);

    wrap.appendChild(input);
    wrap.appendChild(label);
    field.appendChild(wrap);
    field.appendChild(errorDiv);

    mountTo(opts.target, field);

    function setError(msg) {
      errorDiv.textContent = msg || '';
      wrap.classList.remove('aui-is-valid');
      if (msg) {
        wrap.classList.add('aui-has-error');
        input.setAttribute('aria-invalid', 'true');
      }
    }

    function clearError() {
      errorDiv.textContent = '';
      wrap.classList.remove('aui-has-error');
      input.removeAttribute('aria-invalid');
    }

    function destroy() {
      if (field.parentNode) field.parentNode.removeChild(field);
    }

    return {
      el: field,
      destroy: destroy,
      getValue: function() { return input.value; },
      setValue: function(v) { input.value = v; },
      setError: setError,
      clearError: clearError,
      _input: input
    };
  }

  // ── Select ────────────────────────────────────────────
  /**
   * Select({ target?, label, options, multiple?, name? })
   * options: [{ value, label }]
   * Returns { el, destroy(), getValue(), setValue(v) }
   */
  function Select(opts) {
    injectStyles();
    opts = opts || {};
    var options = opts.options || [];
    var multiple = !!opts.multiple;
    var selected = multiple ? [] : null;

    var field = mkEl('div', 'aui-form-field');
    var selectWrap = mkEl('div', 'aui-select-wrap');

    // Label
    if (opts.label) {
      var labelEl = mkEl('span', 'aui-select-label');
      labelEl.textContent = opts.label;
      selectWrap.appendChild(labelEl);
    }

    // Hidden native select for form compat
    var nativeSelect = document.createElement('select');
    nativeSelect.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none';
    if (opts.name) nativeSelect.name = opts.name;
    if (multiple) nativeSelect.multiple = true;
    options.forEach(function(o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      nativeSelect.appendChild(opt);
    });
    selectWrap.appendChild(nativeSelect);

    // Display button
    var display = document.createElement('button');
    display.type = 'button';
    display.className = 'aui-select-display';
    display.setAttribute('role', 'combobox');
    display.setAttribute('aria-haspopup', 'listbox');
    display.setAttribute('aria-expanded', 'false');

    var arrow = mkEl('span', 'aui-select-arrow');
    arrow.textContent = '\u25BE'; // ▾

    // Dropdown
    var dropdown = mkEl('div', 'aui-select-dropdown');
    dropdown.setAttribute('role', 'listbox');

    var searchInput = null;
    var showSearch = options.length > 8;
    if (showSearch) {
      searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'aui-select-search';
      searchInput.placeholder = 'Search\u2026';
      searchInput.addEventListener('input', function() { renderOptions(); });
      searchInput.addEventListener('click', function(e) { e.stopPropagation(); });
      dropdown.appendChild(searchInput);
    }

    var optionsList = mkEl('div');
    dropdown.appendChild(optionsList);

    selectWrap.appendChild(display);
    selectWrap.appendChild(arrow);
    selectWrap.appendChild(dropdown);
    field.appendChild(selectWrap);

    function updateDisplay() {
      if (multiple) {
        // Clear display
        while (display.firstChild) display.removeChild(display.firstChild);
        if (selected.length === 0) {
          display.textContent = opts.label ? 'Select\u2026' : '\u00A0';
        } else {
          var chips = mkEl('span', 'aui-select-chips');
          selected.forEach(function(val) {
            var opt = findOption(val);
            var chip = mkEl('span', 'aui-select-chip');
            chip.appendChild(document.createTextNode(opt ? opt.label : val));
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'aui-select-chip-remove';
            remove.textContent = '\u2715';
            remove.addEventListener('click', function(e) {
              e.stopPropagation();
              var idx = selected.indexOf(val);
              if (idx !== -1) selected.splice(idx, 1);
              syncNative();
              updateDisplay();
              renderOptions();
            });
            chip.appendChild(remove);
            chips.appendChild(chip);
          });
          display.appendChild(chips);
        }
      } else {
        var opt = findOption(selected);
        display.textContent = opt ? opt.label : (opts.label ? 'Select\u2026' : '\u00A0');
      }
    }

    function findOption(val) {
      for (var i = 0; i < options.length; i++) {
        if (options[i].value === val) return options[i];
      }
      return null;
    }

    function syncNative() {
      var nativeOpts = nativeSelect.options;
      for (var i = 0; i < nativeOpts.length; i++) {
        if (multiple) {
          nativeOpts[i].selected = selected.indexOf(nativeOpts[i].value) !== -1;
        } else {
          nativeOpts[i].selected = nativeOpts[i].value === selected;
        }
      }
    }

    function renderOptions() {
      while (optionsList.firstChild) optionsList.removeChild(optionsList.firstChild);
      var filter = searchInput ? searchInput.value.toLowerCase() : '';
      options.forEach(function(o) {
        if (filter && o.label.toLowerCase().indexOf(filter) === -1) return;
        var div = mkEl('div', 'aui-select-option');
        div.textContent = o.label;
        div.setAttribute('role', 'option');

        var isSelected = multiple ? selected.indexOf(o.value) !== -1 : selected === o.value;
        if (isSelected) div.classList.add('aui-selected');

        div.addEventListener('click', function(e) {
          e.stopPropagation();
          if (multiple) {
            var idx = selected.indexOf(o.value);
            if (idx !== -1) selected.splice(idx, 1);
            else selected.push(o.value);
          } else {
            selected = o.value;
            toggleOpen(false);
          }
          syncNative();
          updateDisplay();
          renderOptions();
        });
        optionsList.appendChild(div);
      });
    }

    function toggleOpen(open) {
      var isOpen = selectWrap.classList.contains('aui-open');
      var shouldOpen = typeof open === 'boolean' ? open : !isOpen;
      if (shouldOpen) {
        selectWrap.classList.add('aui-open');
        display.setAttribute('aria-expanded', 'true');
        renderOptions();
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        setTimeout(function() {
          document.addEventListener('click', onDocClick);
        }, 0);
      } else {
        selectWrap.classList.remove('aui-open');
        display.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onDocClick);
      }
    }

    function onDocClick(e) {
      if (!selectWrap.contains(e.target)) toggleOpen(false);
    }

    display.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleOpen();
    });

    updateDisplay();
    mountTo(opts.target, field);

    function destroy() {
      document.removeEventListener('click', onDocClick);
      if (field.parentNode) field.parentNode.removeChild(field);
    }

    return {
      el: field,
      destroy: destroy,
      getValue: function() { return multiple ? selected.slice() : selected; },
      setValue: function(v) {
        if (multiple) {
          selected = Array.isArray(v) ? v.slice() : [v];
        } else {
          selected = v;
        }
        syncNative();
        updateDisplay();
      }
    };
  }

  // ── Checkbox ──────────────────────────────────────────
  /**
   * Checkbox({ target?, label, checked?, onChange?, name? })
   * Returns { el, destroy(), getValue(), setValue(v) }
   */
  function Checkbox(opts) {
    injectStyles();
    opts = opts || {};
    var id = uid('check');

    var wrap = document.createElement('label');
    wrap.className = 'aui-checkbox-wrap';
    wrap.setAttribute('for', id);

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    if (opts.name) input.name = opts.name;
    if (opts.checked) input.checked = true;

    var box = mkEl('span', 'aui-checkbox-box');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 14 14');
    var checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    checkPath.setAttribute('d', 'M2 7l3.5 3.5L12 4');
    checkPath.setAttribute('class', 'aui-check-mark');
    var dashPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    dashPath.setAttribute('d', 'M3 7h8');
    dashPath.setAttribute('class', 'aui-check-dash');
    svg.appendChild(checkPath);
    svg.appendChild(dashPath);
    box.appendChild(svg);

    var labelSpan = mkEl('span');
    labelSpan.textContent = opts.label || '';

    wrap.appendChild(input);
    wrap.appendChild(box);
    wrap.appendChild(labelSpan);

    input.addEventListener('change', function() {
      if (opts.onChange) opts.onChange(input.checked);
    });

    var field = mkEl('div', 'aui-form-field');
    field.appendChild(wrap);
    mountTo(opts.target, field);

    function destroy() {
      if (field.parentNode) field.parentNode.removeChild(field);
    }

    return {
      el: field,
      destroy: destroy,
      getValue: function() { return input.checked; },
      setValue: function(v) { input.checked = !!v; },
      _input: input
    };
  }

  // ── Radio ─────────────────────────────────────────────
  /**
   * Radio({ target?, label, options, value?, onChange?, name? })
   * options: [{ value, label }]
   * Returns { el, destroy(), getValue(), setValue(v) }
   */
  function Radio(opts) {
    injectStyles();
    opts = opts || {};
    var radioName = opts.name || uid('radio');
    var options = opts.options || [];

    var field = mkEl('div', 'aui-form-field');

    if (opts.label) {
      var groupLabel = mkEl('span', 'aui-select-label');
      groupLabel.textContent = opts.label;
      groupLabel.id = uid('radio-label');
      field.appendChild(groupLabel);
    }

    var group = mkEl('div', 'aui-radio-group');
    group.setAttribute('role', 'radiogroup');
    if (opts.label) group.setAttribute('aria-labelledby', groupLabel.id);

    var inputs = [];
    options.forEach(function(o) {
      var id = uid('radio-opt');
      var wrap = document.createElement('label');
      wrap.className = 'aui-radio-wrap';
      wrap.setAttribute('for', id);

      var input = document.createElement('input');
      input.type = 'radio';
      input.id = id;
      input.name = radioName;
      input.value = o.value;
      if (opts.value === o.value) input.checked = true;

      var circle = mkEl('span', 'aui-radio-circle');
      circle.appendChild(mkEl('span', 'aui-radio-dot'));

      var labelSpan = mkEl('span');
      labelSpan.textContent = o.label;

      wrap.appendChild(input);
      wrap.appendChild(circle);
      wrap.appendChild(labelSpan);
      group.appendChild(wrap);
      inputs.push(input);

      input.addEventListener('change', function() {
        if (input.checked && opts.onChange) opts.onChange(o.value);
      });
    });

    field.appendChild(group);
    mountTo(opts.target, field);

    function destroy() {
      if (field.parentNode) field.parentNode.removeChild(field);
    }

    return {
      el: field,
      destroy: destroy,
      getValue: function() {
        for (var i = 0; i < inputs.length; i++) {
          if (inputs[i].checked) return inputs[i].value;
        }
        return null;
      },
      setValue: function(v) {
        inputs.forEach(function(inp) { inp.checked = inp.value === v; });
      }
    };
  }

  // ── Toggle ────────────────────────────────────────────
  /**
   * Toggle({ target?, label, checked?, onChange?, name? })
   * Returns { el, destroy(), getValue(), setValue(v) }
   */
  function Toggle(opts) {
    injectStyles();
    opts = opts || {};
    var id = uid('toggle');

    var wrap = document.createElement('label');
    wrap.className = 'aui-toggle-wrap';
    wrap.setAttribute('for', id);

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    if (opts.name) input.name = opts.name;
    if (opts.checked) input.checked = true;

    var track = mkEl('span', 'aui-toggle-track');
    track.appendChild(mkEl('span', 'aui-toggle-thumb'));

    var labelSpan = mkEl('span');
    labelSpan.textContent = opts.label || '';

    wrap.appendChild(input);
    wrap.appendChild(track);
    wrap.appendChild(labelSpan);

    input.addEventListener('change', function() {
      if (opts.onChange) opts.onChange(input.checked);
    });

    var field = mkEl('div', 'aui-form-field');
    field.appendChild(wrap);
    mountTo(opts.target, field);

    function destroy() {
      if (field.parentNode) field.parentNode.removeChild(field);
    }

    return {
      el: field,
      destroy: destroy,
      getValue: function() { return input.checked; },
      setValue: function(v) { input.checked = !!v; },
      _input: input
    };
  }

  // ── Textarea ──────────────────────────────────────────
  /**
   * Textarea({ target?, label, rows?, autoGrow?, name? })
   * Returns { el, destroy(), getValue(), setValue(v) }
   */
  function Textarea(opts) {
    injectStyles();
    opts = opts || {};
    var id = uid('textarea');

    var field = mkEl('div', 'aui-form-field');
    var wrap = mkEl('div', 'aui-input-wrap');

    var textarea = document.createElement('textarea');
    textarea.id = id;
    textarea.rows = opts.rows || 3;
    textarea.placeholder = opts.label || ' ';
    if (opts.name) textarea.name = opts.name;

    var label = document.createElement('label');
    label.className = 'aui-float-label';
    label.setAttribute('for', id);
    label.textContent = opts.label || '';

    wrap.appendChild(textarea);
    wrap.appendChild(label);
    field.appendChild(wrap);

    // Auto-grow
    var mirror = null;
    if (opts.autoGrow) {
      mirror = document.createElement('div');
      mirror.style.cssText = 'position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;padding:1rem 0.75rem 0.375rem;font:inherit;font-size:0.9375rem;width:100%;box-sizing:border-box;border:1.5px solid transparent';
      field.style.position = 'relative';
      field.appendChild(mirror);

      function autoSize() {
        mirror.textContent = textarea.value + '\n';
        var h = mirror.scrollHeight;
        if (h > 0) textarea.style.height = h + 'px';
      }

      textarea.addEventListener('input', autoSize);
      textarea.style.overflow = 'hidden';
      textarea.style.resize = 'none';
      // Initial sizing
      setTimeout(autoSize, 0);
    }

    mountTo(opts.target, field);

    function destroy() {
      if (field.parentNode) field.parentNode.removeChild(field);
    }

    return {
      el: field,
      destroy: destroy,
      getValue: function() { return textarea.value; },
      setValue: function(v) {
        textarea.value = v;
        if (mirror) {
          mirror.textContent = v + '\n';
          var h = mirror.scrollHeight;
          if (h > 0) textarea.style.height = h + 'px';
        }
      },
      _input: textarea
    };
  }

  // ── Built-in validators ───────────────────────────────
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var URL_RE = /^https?:\/\/.+/;

  function validateField(value, fieldCfg) {
    if (fieldCfg.required) {
      if (value === '' || value === null || value === undefined || value === false) {
        return (fieldCfg.label || fieldCfg.name) + ' is required';
      }
    }
    // Skip further validation for empty non-required fields
    if (value === '' || value === null || value === undefined) return null;

    if (fieldCfg.type === 'email' || fieldCfg.validator === 'email') {
      if (!EMAIL_RE.test(value)) return 'Invalid email address';
    }
    if (fieldCfg.validator === 'url') {
      if (!URL_RE.test(value)) return 'Invalid URL';
    }
    if (typeof fieldCfg.min === 'number' && Number(value) < fieldCfg.min) {
      return 'Minimum value is ' + fieldCfg.min;
    }
    if (typeof fieldCfg.max === 'number' && Number(value) > fieldCfg.max) {
      return 'Maximum value is ' + fieldCfg.max;
    }
    if (typeof fieldCfg.minLength === 'number' && String(value).length < fieldCfg.minLength) {
      return 'Must be at least ' + fieldCfg.minLength + ' characters';
    }
    if (typeof fieldCfg.maxLength === 'number' && String(value).length > fieldCfg.maxLength) {
      return 'Must be at most ' + fieldCfg.maxLength + ' characters';
    }
    if (fieldCfg.pattern) {
      var re = new RegExp(fieldCfg.pattern);
      if (!re.test(String(value))) {
        return fieldCfg.patternMessage || 'Invalid format';
      }
    }
    return null;
  }

  // ── FormGroup ─────────────────────────────────────────
  /**
   * FormGroup({ target?, fields, onSubmit, validate?, submitLabel? })
   * fields: [{ name, type, label, required?, options?, ... }]
   * Returns { el, destroy(), getData(), setErrors(errors) }
   */
  function FormGroup(opts) {
    injectStyles();
    opts = opts || {};
    var fields = opts.fields || [];

    var form = mkEl('div', 'aui-form-group');
    var components = {};

    fields.forEach(function(cfg) {
      var comp;

      switch (cfg.type) {
        case 'email':
          comp = Input({ label: cfg.label, type: 'email', name: cfg.name, required: cfg.required, placeholder: cfg.placeholder });
          break;
        case 'password':
          comp = Input({ label: cfg.label, type: 'password', name: cfg.name, required: cfg.required, placeholder: cfg.placeholder });
          break;
        case 'number':
          comp = Input({ label: cfg.label, type: 'number', name: cfg.name, required: cfg.required, placeholder: cfg.placeholder });
          break;
        case 'search':
          comp = Input({ label: cfg.label, type: 'search', name: cfg.name, required: cfg.required, placeholder: cfg.placeholder });
          break;
        case 'select':
          comp = Select({ label: cfg.label, options: cfg.options, multiple: cfg.multiple, name: cfg.name });
          break;
        case 'checkbox':
          comp = Checkbox({ label: cfg.label, checked: cfg.checked, name: cfg.name });
          break;
        case 'radio':
          comp = Radio({ label: cfg.label, options: cfg.options, value: cfg.value, name: cfg.name });
          break;
        case 'toggle':
          comp = Toggle({ label: cfg.label, checked: cfg.checked, name: cfg.name });
          break;
        case 'textarea':
          comp = Textarea({ label: cfg.label, rows: cfg.rows, autoGrow: cfg.autoGrow, name: cfg.name });
          break;
        default:
          comp = Input({ label: cfg.label, type: cfg.type || 'text', name: cfg.name, required: cfg.required, placeholder: cfg.placeholder });
      }

      components[cfg.name] = { comp: comp, cfg: cfg };
      form.appendChild(comp.el);
    });

    // Submit button
    var submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'aui-form-submit';
    submitBtn.textContent = opts.submitLabel || 'Submit';

    var spinner = mkEl('span', 'aui-form-spinner');
    spinner.style.display = 'none';
    submitBtn.insertBefore(spinner, submitBtn.firstChild);

    submitBtn.addEventListener('click', function() {
      // Validate
      var data = getData();
      var errors = {};
      var hasError = false;

      // Built-in validation
      fields.forEach(function(cfg) {
        var err = validateField(data[cfg.name], cfg);
        if (err) { errors[cfg.name] = err; hasError = true; }
      });

      // Custom validation
      if (!hasError && opts.validate) {
        var custom = opts.validate(data);
        if (custom) {
          Object.keys(custom).forEach(function(k) {
            if (custom[k]) { errors[k] = custom[k]; hasError = true; }
          });
        }
      }

      if (hasError) {
        setErrors(errors);
        return;
      }

      // Clear errors and submit
      setErrors({});
      if (opts.onSubmit) {
        var result = opts.onSubmit(data);
        // Handle async onSubmit
        if (result && typeof result.then === 'function') {
          submitBtn.disabled = true;
          spinner.style.display = '';
          result.then(function() {
            submitBtn.disabled = false;
            spinner.style.display = 'none';
          })['catch'](function() {
            submitBtn.disabled = false;
            spinner.style.display = 'none';
          });
        }
      }
    });

    form.appendChild(submitBtn);

    function getData() {
      var data = {};
      Object.keys(components).forEach(function(name) {
        data[name] = components[name].comp.getValue();
      });
      return data;
    }

    function setErrors(errors) {
      Object.keys(components).forEach(function(name) {
        var entry = components[name];
        if (entry.comp.setError) {
          if (errors[name]) entry.comp.setError(errors[name]);
          else entry.comp.clearError();
        }
      });
    }

    mountTo(opts.target, form);

    function destroy() {
      Object.keys(components).forEach(function(name) {
        components[name].comp.destroy();
      });
      if (form.parentNode) form.parentNode.removeChild(form);
    }

    return {
      el: form,
      destroy: destroy,
      getData: getData,
      setErrors: setErrors
    };
  }

  // ── Register ──────────────────────────────────────────
  var exports = {
    Input: Input,
    Select: Select,
    Checkbox: Checkbox,
    Radio: Radio,
    Toggle: Toggle,
    Textarea: Textarea,
    FormGroup: FormGroup
  };

  AIMEAT.ui = AIMEAT.ui || {};
  AIMEAT.ui.forms = exports;

  if (typeof AIMEAT.register !== 'function') {
    AIMEAT.register = function (name, exp) { AIMEAT[name] = exp; };
  }
  AIMEAT.register('aimeat-ui-forms', exports);

})(window.AIMEAT || (window.AIMEAT = {}));
