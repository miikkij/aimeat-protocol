/**
 * aimeat-ui-viewers — Content display components: carousels, grids, lists, galleries, tables, timelines.
 *
 * Components: Carousel, Grid, List, Gallery, DataTable, Timeline
 * Zero external dependencies — pure DOM API.
 *
 * Usage:
 *   <script src="/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></script>
 *   <script>
 *     var ctrl = AIMEAT.ui.viewers.Grid({ target: '#app', items: [...] });
 *     ctrl.destroy();
 *   </script>
 */
(function (AIMEAT) {
  'use strict';

  // ── CSS ───────────────────────────────────────────────
  var stylesInjected = false;
  var CSS = [
    '/* Viewer shared */',
    '.aui-viewer { font-family: "DM Sans", system-ui, sans-serif; color: var(--text, #1A1A2E); box-sizing: border-box; }',
    '.aui-viewer *, .aui-viewer *::before, .aui-viewer *::after { box-sizing: border-box; }',

    '/* Carousel */',
    '.aui-carousel { container-type: inline-size; position: relative; overflow: hidden; }',
    '.aui-carousel-track { display: flex; transition: transform 0.3s ease; }',
    '.aui-carousel-slide { flex: 0 0 100%; min-width: 0; padding: 0.5rem; }',
    '.aui-carousel-slide img { width: 100%; height: auto; border-radius: var(--radius-sm, 10px); display: block; }',
    '.aui-carousel-arrow { position: absolute; top: 50%; transform: translateY(-50%); background: var(--bg-card, #fff); border: 1px solid var(--border, #E5E7EB); border-radius: 50%; width: 36px; height: 36px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1rem; box-shadow: var(--shadow-sm, 0 2px 8px rgba(0,0,0,0.06)); z-index: 2; transition: background 0.15s; }',
    '.aui-carousel-arrow:hover { background: var(--bg-surface, #F3F4F6); }',
    '.aui-carousel-prev { left: 8px; }',
    '.aui-carousel-next { right: 8px; }',
    '.aui-carousel-dots { display: flex; justify-content: center; gap: 6px; padding: 0.75rem 0; }',
    '.aui-carousel-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border, #E5E7EB); border: none; cursor: pointer; transition: background 0.2s; padding: 0; }',
    '.aui-carousel-dot.active { background: var(--accent, #E8564A); }',

    '/* Grid */',
    '.aui-grid { display: grid; container-type: inline-size; }',
    '.aui-grid-card { background: var(--bg-card, #fff); border: 1px solid var(--border, #E5E7EB); border-radius: var(--radius-sm, 10px); overflow: hidden; transition: box-shadow 0.15s; cursor: default; }',
    '.aui-grid-card:hover { box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.06)); }',
    '.aui-grid-card-img { width: 100%; height: 160px; object-fit: cover; display: block; }',
    '.aui-grid-card-body { padding: 0.75rem; }',
    '.aui-grid-card-title { font-weight: 600; font-size: 0.94rem; margin: 0 0 0.25rem; }',
    '.aui-grid-card-subtitle { font-size: 0.8rem; color: var(--text-muted, #9CA3AF); margin: 0; }',
    '.aui-grid-card-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 500; margin-top: 0.4rem; }',
    '.aui-badge-success { background: #d1fae5; color: #065f46; }',
    '.aui-badge-warn { background: #fef3c7; color: #92400e; }',
    '.aui-badge-danger { background: #fee2e2; color: #991b1b; }',
    '.aui-badge-info { background: #dbeafe; color: #1e40af; }',

    '/* List */',
    '.aui-list { display: flex; flex-direction: column; container-type: inline-size; }',
    '.aui-list-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, #E5E7EB); transition: background 0.1s; cursor: default; }',
    '.aui-list-item:hover { background: var(--bg-surface, #F3F4F6); }',
    '.aui-list-item:last-child { border-bottom: none; }',
    '.aui-list-avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: var(--bg-surface, #F3F4F6); }',
    '.aui-list-content { flex: 1; min-width: 0; }',
    '.aui-list-title { font-weight: 600; font-size: 0.94rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.aui-list-subtitle { font-size: 0.8rem; color: var(--text-muted, #9CA3AF); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.aui-list-actions { display: flex; gap: 0.25rem; flex-shrink: 0; }',
    '.aui-list-action { background: none; border: 1px solid var(--border, #E5E7EB); border-radius: var(--radius-xs, 6px); padding: 4px 8px; font-size: 0.75rem; cursor: pointer; font-family: inherit; transition: background 0.1s; }',
    '.aui-list-action:hover { background: var(--bg-surface, #F3F4F6); }',

    '/* Gallery */',
    '.aui-gallery { display: grid; gap: 4px; container-type: inline-size; }',
    '.aui-gallery-thumb { cursor: pointer; overflow: hidden; border-radius: var(--radius-xs, 6px); aspect-ratio: 1; }',
    '.aui-gallery-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }',
    '.aui-gallery-thumb:hover img { transform: scale(1.05); }',
    '.aui-gallery-lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 10000; display: flex; align-items: center; justify-content: center; animation: auiViewerFadeIn 0.15s ease; }',
    '@keyframes auiViewerFadeIn { from { opacity: 0 } to { opacity: 1 } }',
    '.aui-gallery-lightbox img { max-width: 90vw; max-height: 90vh; object-fit: contain; }',
    '.aui-gallery-lightbox-close { position: absolute; top: 1rem; right: 1rem; background: none; border: none; color: white; font-size: 2rem; cursor: pointer; }',
    '.aui-gallery-lightbox-prev, .aui-gallery-lightbox-next { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.2); border: none; color: white; font-size: 1.5rem; cursor: pointer; padding: 0.5rem 0.75rem; border-radius: var(--radius-xs, 6px); }',
    '.aui-gallery-lightbox-prev { left: 1rem; }',
    '.aui-gallery-lightbox-next { right: 1rem; }',

    '/* DataTable */',
    '.aui-table-wrap { container-type: inline-size; overflow-x: auto; }',
    '.aui-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }',
    '.aui-table th { position: sticky; top: 0; background: var(--bg-surface, #F3F4F6); padding: 0.6rem 0.75rem; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border, #E5E7EB); white-space: nowrap; cursor: default; user-select: none; }',
    '.aui-table th.sortable { cursor: pointer; }',
    '.aui-table th.sortable:hover { color: var(--accent, #E8564A); }',
    '.aui-table th .aui-sort-icon { margin-left: 4px; font-size: 0.7rem; }',
    '.aui-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border, #E5E7EB); }',
    '.aui-table tr:nth-child(even) { background: var(--bg-surface-dim, #F9FAFB); }',
    '.aui-table-filter { padding: 0.5rem; border: 1px solid var(--border, #E5E7EB); border-radius: var(--radius-xs, 6px); font-size: 0.875rem; width: 100%; max-width: 300px; margin-bottom: 0.75rem; font-family: inherit; }',
    '.aui-table-pagination { display: flex; align-items: center; justify-content: center; gap: 0.75rem; padding: 0.75rem 0; font-size: 0.875rem; }',
    '.aui-table-page-btn { background: none; border: 1px solid var(--border, #E5E7EB); border-radius: var(--radius-xs, 6px); padding: 4px 10px; cursor: pointer; font-family: inherit; font-size: 0.8rem; }',
    '.aui-table-page-btn:hover { background: var(--bg-surface, #F3F4F6); }',
    '.aui-table-page-btn:disabled { opacity: 0.4; cursor: default; }',

    '/* Timeline */',
    '.aui-timeline { position: relative; padding-left: 32px; container-type: inline-size; }',
    '.aui-timeline::before { content: ""; position: absolute; left: 11px; top: 0; bottom: 0; width: 2px; background: var(--border, #E5E7EB); }',
    '.aui-timeline-event { position: relative; margin-bottom: 1.5rem; }',
    '.aui-timeline-dot { position: absolute; left: -27px; top: 4px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--bg-card, #fff); }',
    '.aui-timeline-dot-default { background: var(--accent, #E8564A); }',
    '.aui-timeline-dot-success { background: var(--success, #10B981); }',
    '.aui-timeline-dot-warn { background: var(--warn, #F59E0B); }',
    '.aui-timeline-dot-error { background: var(--danger, #EF4444); }',
    '.aui-timeline-dot-info { background: var(--blue, #3B82F6); }',
    '.aui-timeline-card { background: var(--bg-card, #fff); border: 1px solid var(--border, #E5E7EB); border-radius: var(--radius-sm, 10px); padding: 0.75rem 1rem; }',
    '.aui-timeline-card-title { font-weight: 600; font-size: 0.94rem; margin: 0 0 0.25rem; }',
    '.aui-timeline-card-time { font-size: 0.75rem; color: var(--text-muted, #9CA3AF); margin: 0 0 0.4rem; }',
    '.aui-timeline-card-body { font-size: 0.875rem; line-height: 1.5; }'
  ].join('\n');

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-aimeat', 'ui-viewers');
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

  function mount(targetSel, el) {
    if (!targetSel) return null;
    var t = typeof targetSel === 'string' ? document.querySelector(targetSel) : targetSel;
    if (t) t.appendChild(el);
    return t;
  }

  function badgeEl(badge) {
    if (!badge) return null;
    var b = mkEl('span', 'aui-grid-card-badge aui-badge-' + (badge.type || 'info'));
    b.textContent = badge.text || '';
    return b;
  }

  // ── Carousel ───────────────────────────────────────────
  function Carousel(opts) {
    injectStyles();
    opts = opts || {};
    var items = opts.items || [];
    var current = 0;
    var autoTimer = null;

    var wrap = mkEl('div', 'aui-viewer aui-carousel');
    var track = mkEl('div', 'aui-carousel-track');

    items.forEach(function(item) {
      var slide = mkEl('div', 'aui-carousel-slide');
      if (item.image) {
        var img = document.createElement('img');
        img.src = item.image;
        img.alt = item.title || '';
        slide.appendChild(img);
      }
      if (item.title) {
        var t = mkEl('div'); t.style.cssText = 'padding:0.5rem 0;font-weight:600;font-size:0.94rem;';
        t.textContent = item.title;
        slide.appendChild(t);
      }
      if (item.subtitle) {
        var s = mkEl('div'); s.style.cssText = 'font-size:0.8rem;color:var(--text-muted,#9CA3AF);';
        s.textContent = item.subtitle;
        slide.appendChild(s);
      }
      track.appendChild(slide);
    });

    wrap.appendChild(track);

    function goTo(idx) {
      if (items.length === 0) return;
      if (opts.loop) {
        current = ((idx % items.length) + items.length) % items.length;
      } else {
        current = Math.max(0, Math.min(idx, items.length - 1));
      }
      track.style.transform = 'translateX(-' + (current * 100) + '%)';
      updateDots();
    }

    // Arrows
    var prevBtn = mkEl('button', 'aui-carousel-arrow aui-carousel-prev');
    prevBtn.innerHTML = '&#8249;';
    prevBtn.addEventListener('click', function() { goTo(current - 1); });
    var nextBtn = mkEl('button', 'aui-carousel-arrow aui-carousel-next');
    nextBtn.innerHTML = '&#8250;';
    nextBtn.addEventListener('click', function() { goTo(current + 1); });
    wrap.appendChild(prevBtn);
    wrap.appendChild(nextBtn);

    // Dots
    var dotsWrap = mkEl('div', 'aui-carousel-dots');
    var dots = [];
    items.forEach(function(_, i) {
      var dot = mkEl('button', 'aui-carousel-dot');
      dot.addEventListener('click', function() { goTo(i); });
      dotsWrap.appendChild(dot);
      dots.push(dot);
    });
    wrap.appendChild(dotsWrap);

    function updateDots() {
      dots.forEach(function(d, i) {
        d.classList.toggle('active', i === current);
      });
    }
    updateDots();

    // Touch swipe
    var touchStartX = 0;
    wrap.addEventListener('touchstart', function(e) { touchStartX = e.touches[0].clientX; }, { passive: true });
    wrap.addEventListener('touchend', function(e) {
      var diff = touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) {
        goTo(current + (diff > 0 ? 1 : -1));
      }
    });

    // Auto-play
    if (opts.autoPlay) {
      autoTimer = setInterval(function() { goTo(current + 1); }, opts.interval || 4000);
    }

    mount(opts.target, wrap);

    return {
      el: wrap,
      destroy: function() {
        if (autoTimer) clearInterval(autoTimer);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      },
      goTo: goTo
    };
  }

  // ── Grid ───────────────────────────────────────────────
  function Grid(opts) {
    injectStyles();
    opts = opts || {};
    var minCol = opts.minColWidth || 200;
    var gap = opts.gap || '1rem';

    var wrap = mkEl('div', 'aui-viewer aui-grid');
    wrap.style.gridTemplateColumns = 'repeat(auto-fit, minmax(' + (typeof minCol === 'number' ? minCol + 'px' : minCol) + ', 1fr))';
    wrap.style.gap = typeof gap === 'number' ? gap + 'px' : gap;

    function renderDefault(item) {
      var card = mkEl('div', 'aui-grid-card');
      if (item.onClick) { card.style.cursor = 'pointer'; card.addEventListener('click', function() { item.onClick(item); }); }
      if (item.image) {
        var img = document.createElement('img');
        img.className = 'aui-grid-card-img';
        img.src = item.image;
        img.alt = item.title || '';
        card.appendChild(img);
      }
      var body = mkEl('div', 'aui-grid-card-body');
      if (item.title) { var t = mkEl('p', 'aui-grid-card-title'); t.textContent = item.title; body.appendChild(t); }
      if (item.subtitle) { var s = mkEl('p', 'aui-grid-card-subtitle'); s.textContent = item.subtitle; body.appendChild(s); }
      var b = badgeEl(item.badge);
      if (b) body.appendChild(b);
      card.appendChild(body);
      return card;
    }

    (opts.items || []).forEach(function(item) {
      var el = opts.renderItem ? opts.renderItem(item) : renderDefault(item);
      wrap.appendChild(el);
    });

    mount(opts.target, wrap);
    return { el: wrap, destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── List ───────────────────────────────────────────────
  function List(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-viewer aui-list');

    (opts.items || []).forEach(function(item) {
      var row = mkEl('div', 'aui-list-item');
      if (item.onClick || opts.onItemClick) {
        row.style.cursor = 'pointer';
        row.addEventListener('click', function() { (item.onClick || opts.onItemClick)(item); });
      }

      if (item.image) {
        var avatar = document.createElement('img');
        avatar.className = 'aui-list-avatar';
        avatar.src = item.image;
        avatar.alt = item.title || '';
        row.appendChild(avatar);
      }

      var content = mkEl('div', 'aui-list-content');
      if (item.title) { var t = mkEl('p', 'aui-list-title'); t.textContent = item.title; content.appendChild(t); }
      if (item.subtitle) { var s = mkEl('p', 'aui-list-subtitle'); s.textContent = item.subtitle; content.appendChild(s); }
      row.appendChild(content);

      var b = badgeEl(item.badge);
      if (b) row.appendChild(b);

      if (item.actions && item.actions.length) {
        var acts = mkEl('div', 'aui-list-actions');
        item.actions.forEach(function(a) {
          var btn = mkEl('button', 'aui-list-action');
          btn.textContent = a.label;
          btn.addEventListener('click', function(e) { e.stopPropagation(); if (a.onClick) a.onClick(item); });
          acts.appendChild(btn);
        });
        row.appendChild(acts);
      }

      wrap.appendChild(row);
    });

    mount(opts.target, wrap);
    return { el: wrap, destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── Gallery ────────────────────────────────────────────
  function Gallery(opts) {
    injectStyles();
    opts = opts || {};
    var images = opts.images || [];
    var cols = opts.cols || 4;
    var lightbox = null;
    var currentIdx = 0;

    var wrap = mkEl('div', 'aui-viewer aui-gallery');
    wrap.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';

    images.forEach(function(src, i) {
      var thumb = mkEl('div', 'aui-gallery-thumb');
      var img = document.createElement('img');
      img.src = typeof src === 'string' ? src : src.src || src.image || '';
      img.alt = typeof src === 'string' ? '' : src.alt || src.title || '';
      thumb.appendChild(img);
      thumb.addEventListener('click', function() { openLightbox(i); });
      wrap.appendChild(thumb);
    });

    function getSrc(i) {
      var s = images[i];
      return typeof s === 'string' ? s : s.src || s.image || '';
    }

    function openLightbox(idx) {
      closeLightbox();
      currentIdx = idx;
      lightbox = mkEl('div', 'aui-gallery-lightbox');

      var img = document.createElement('img');
      img.src = getSrc(idx);
      lightbox.appendChild(img);

      var closeBtn = mkEl('button', 'aui-gallery-lightbox-close');
      closeBtn.textContent = '\u2715';
      closeBtn.addEventListener('click', closeLightbox);
      lightbox.appendChild(closeBtn);

      var prevBtn = mkEl('button', 'aui-gallery-lightbox-prev');
      prevBtn.innerHTML = '&#8249;';
      prevBtn.addEventListener('click', function() { navLightbox(-1); });
      lightbox.appendChild(prevBtn);

      var nextBtn = mkEl('button', 'aui-gallery-lightbox-next');
      nextBtn.innerHTML = '&#8250;';
      nextBtn.addEventListener('click', function() { navLightbox(1); });
      lightbox.appendChild(nextBtn);

      lightbox.addEventListener('click', function(e) { if (e.target === lightbox) closeLightbox(); });
      document.addEventListener('keydown', onLightboxKey);
      document.body.appendChild(lightbox);
    }

    function navLightbox(dir) {
      currentIdx = ((currentIdx + dir) % images.length + images.length) % images.length;
      var img = lightbox.querySelector('img');
      img.src = getSrc(currentIdx);
    }

    function closeLightbox() {
      if (lightbox && lightbox.parentNode) lightbox.parentNode.removeChild(lightbox);
      lightbox = null;
      document.removeEventListener('keydown', onLightboxKey);
    }

    function onLightboxKey(e) {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') navLightbox(-1);
      else if (e.key === 'ArrowRight') navLightbox(1);
    }

    mount(opts.target, wrap);
    return { el: wrap, destroy: function() { closeLightbox(); if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── DataTable ──────────────────────────────────────────
  function DataTable(opts) {
    injectStyles();
    opts = opts || {};
    var columns = opts.columns || [];
    var allRows = opts.rows || [];
    var sortable = opts.sortable !== false;
    var filterable = opts.filterable !== false;
    var pageSize = opts.pageSize || 20;
    var currentPage = 0;
    var sortCol = null;
    var sortDir = 0; // 0=none, 1=asc, -1=desc
    var filterText = '';

    var outer = mkEl('div', 'aui-viewer aui-table-wrap');

    // Filter
    var filterInput = null;
    if (filterable) {
      filterInput = document.createElement('input');
      filterInput.className = 'aui-table-filter';
      filterInput.placeholder = 'Filter...';
      filterInput.addEventListener('input', function() { filterText = filterInput.value.toLowerCase(); currentPage = 0; render(); });
      outer.appendChild(filterInput);
    }

    var table = mkEl('table', 'aui-table');
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    columns.forEach(function(col, ci) {
      var th = document.createElement('th');
      th.textContent = col.label || col.key || '';
      if (sortable) {
        th.className = 'sortable';
        th.addEventListener('click', function() {
          if (sortCol === ci) {
            sortDir = sortDir === 1 ? -1 : sortDir === -1 ? 0 : 1;
          } else {
            sortCol = ci;
            sortDir = 1;
          }
          if (sortDir === 0) sortCol = null;
          currentPage = 0;
          render();
        });
      }
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    outer.appendChild(table);

    // Pagination
    var paginationWrap = mkEl('div', 'aui-table-pagination');
    var prevBtn = mkEl('button', 'aui-table-page-btn');
    prevBtn.textContent = '\u2190 Prev';
    prevBtn.addEventListener('click', function() { if (currentPage > 0) { currentPage--; render(); } });
    var pageInfo = mkEl('span');
    var nextBtn = mkEl('button', 'aui-table-page-btn');
    nextBtn.textContent = 'Next \u2192';
    nextBtn.addEventListener('click', function() { currentPage++; render(); });
    paginationWrap.appendChild(prevBtn);
    paginationWrap.appendChild(pageInfo);
    paginationWrap.appendChild(nextBtn);
    outer.appendChild(paginationWrap);

    function getProcessedRows() {
      var rows = allRows.slice();
      // Filter
      if (filterText) {
        rows = rows.filter(function(row) {
          return columns.some(function(col) {
            var val = row[col.key];
            return val !== undefined && val !== null && String(val).toLowerCase().indexOf(filterText) !== -1;
          });
        });
      }
      // Sort
      if (sortCol !== null && sortDir !== 0) {
        var key = columns[sortCol].key;
        var type = columns[sortCol].type || 'string';
        rows.sort(function(a, b) {
          var va = a[key], vb = b[key];
          if (va == null) va = '';
          if (vb == null) vb = '';
          var cmp = 0;
          if (type === 'number') cmp = Number(va) - Number(vb);
          else if (type === 'date') cmp = new Date(va).getTime() - new Date(vb).getTime();
          else cmp = String(va).localeCompare(String(vb));
          return cmp * sortDir;
        });
      }
      return rows;
    }

    function render() {
      var rows = getProcessedRows();
      var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      if (currentPage >= totalPages) currentPage = totalPages - 1;
      var start = currentPage * pageSize;
      var pageRows = rows.slice(start, start + pageSize);

      tbody.innerHTML = '';
      pageRows.forEach(function(row) {
        var tr = document.createElement('tr');
        columns.forEach(function(col) {
          var td = document.createElement('td');
          td.textContent = row[col.key] !== undefined ? String(row[col.key]) : '';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });

      // Update header sort icons
      var ths = headerRow.querySelectorAll('th');
      ths.forEach(function(th, i) {
        var existing = th.querySelector('.aui-sort-icon');
        if (existing) existing.remove();
        if (sortCol === i && sortDir !== 0) {
          var icon = mkEl('span', 'aui-sort-icon');
          icon.textContent = sortDir === 1 ? '\u25B2' : '\u25BC';
          th.appendChild(icon);
        }
      });

      // Pagination
      prevBtn.disabled = currentPage === 0;
      nextBtn.disabled = currentPage >= totalPages - 1;
      pageInfo.textContent = 'Page ' + (currentPage + 1) + ' of ' + totalPages + ' (' + rows.length + ' rows)';
    }

    render();
    mount(opts.target, outer);

    return {
      el: outer,
      destroy: function() { if (outer.parentNode) outer.parentNode.removeChild(outer); },
      refresh: function(newRows) { allRows = newRows || allRows; currentPage = 0; render(); }
    };
  }

  // ── Timeline ───────────────────────────────────────────
  function Timeline(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-viewer aui-timeline');

    (opts.events || []).forEach(function(evt) {
      var event = mkEl('div', 'aui-timeline-event');

      var dotType = evt.type || 'default';
      var dot = mkEl('div', 'aui-timeline-dot aui-timeline-dot-' + dotType);
      event.appendChild(dot);

      var card = mkEl('div', 'aui-timeline-card');
      if (evt.title) { var t = mkEl('div', 'aui-timeline-card-title'); t.textContent = evt.title; card.appendChild(t); }
      if (evt.time || evt.date) { var time = mkEl('div', 'aui-timeline-card-time'); time.textContent = evt.time || evt.date; card.appendChild(time); }
      if (evt.content || evt.body) {
        var body = mkEl('div', 'aui-timeline-card-body');
        var txt = evt.content || evt.body;
        if (typeof txt === 'string') body.textContent = txt;
        else body.appendChild(txt);
        card.appendChild(body);
      }
      event.appendChild(card);
      wrap.appendChild(event);
    });

    mount(opts.target, wrap);
    return { el: wrap, destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── Register ──────────────────────────────────────────
  var exports = {
    Carousel: Carousel,
    Grid: Grid,
    List: List,
    Gallery: Gallery,
    DataTable: DataTable,
    Timeline: Timeline
  };

  AIMEAT.ui = AIMEAT.ui || {};
  AIMEAT.ui.viewers = exports;

  if (typeof AIMEAT.register !== 'function') {
    AIMEAT.register = function (name, exp) { AIMEAT[name] = exp; };
  }
  AIMEAT.register('aimeat-ui-viewers', exports);

})(window.AIMEAT || (window.AIMEAT = {}));
