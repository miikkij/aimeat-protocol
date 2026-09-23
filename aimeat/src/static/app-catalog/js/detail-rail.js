/**
 * @file detail-rail.js
 * @description The App Detail view's page frame and its "On this page" rail. The frame is the set's
 *   Page (public/components/poster-parts.js) written as a string: the masthead above, then the page
 *   body with the sections in the main column and the rail in the trailing one. The rail is the
 *   set's Rail kind="index": the ink panel with one numbered link per section, kept in view while the
 *   page scrolls, the section being read marked with aria-current. The links are read from the
 *   rendered sections (every [data-dtl-section] slot, labelled by its .poster-section-title) rather
 *   than listed by hand, so a section that appears only for an own published app gets its link and
 *   number without anyone keeping a second list.
 *
 *   This file writes the set's classes by hand because it is the catalog's copy of Page and Rail,
 *   which parts-html.js does not carry; it emits exactly what those two components emit.
 * @structure detailRailPage(headHtml, mainHtml) · renderDetailRail(bodyEl) · resetDetailRail()
 * @usage import { detailRailPage, renderDetailRail, resetDetailRail } from './detail-rail.js';
 * @version-history
 *   v1.2.0 — 2026-09-22 — The set's Page and Rail markup (poster-page, poster-page-body with the
 *     rail trailing, poster-rail data-kind="index" with numbered links) instead of the local
 *     dtl-page grid and dtl-rail box; the sections are found by their [data-dtl-section] slot and
 *     named by their .poster-section-title, and the lit entry is marked by aria-current alone.
 *   v1.1.0 — 2026-09-13 — A click lights the section clicked and keeps it lit until the person
 *     scrolls on their own. Lighting by position alone showed a neighbour whenever the target sat
 *     too near the bottom to reach the reading line.
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import { escapeHtml } from './util.js';
import { t } from './i18n.js';

/** The page: the masthead, then two columns, the sections and the rail the render fills in after assembly. */
export function detailRailPage(headHtml, mainHtml) {
  return '<div class="poster-page" data-width="normal">' + headHtml +
      '<div class="poster-page-body" data-rail="yes" data-rail-side="trailing" data-navigation="no">' +
        '<div class="poster-page-main">' + mainHtml + '</div>' +
        '<div class="poster-page-rail"><nav class="poster-rail" data-kind="index" id="detail-rail" aria-label="' + escapeHtml(t('detail.railTitle')) + '"></nav></div>' +
      '</div>' +
    '</div>';
}

/** The headline's own words: the first node of the title, so a count or a badge beside it stays out. */
function sectionLabel(title) {
  var first = title.firstChild;
  var text = first ? (first.nodeType === 3 ? first.nodeValue : first.textContent) : '';
  return (text || title.textContent || '').trim();
}

/** Each section slot with its title element, in page order. */
function sectionsOf(bodyEl) {
  return Array.prototype.slice.call(bodyEl.querySelectorAll('.poster-page-main [data-dtl-section]'))
    .map(function (slot) { return { el: slot, title: slot.querySelector('.poster-section-title') }; })
    .filter(function (s) { return s.title; });
}

// The section the person last clicked in the rail. While it is set, the rail lights that one and
// not the one the scroll position suggests: a section near the bottom can never reach the reading
// line, so the guess would light a neighbour of what was asked for. The person's own scrolling
// (wheel, touch, keys, the scrollbar) clears it, and from then on the position decides again.
var pinned = -1;

/** A new app opens with nothing pinned. */
export function resetDetailRail() {
  pinned = -1;
}

/** Scroll the detail body, which is the element that scrolls here, so the headline lands under its top. */
function goToSection(bodyEl, index) {
  var sec = sectionsOf(bodyEl)[index];
  if (!sec) return;
  pinned = index;
  markCurrent(bodyEl);
  var top = bodyEl.scrollTop + sec.title.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - 24;
  bodyEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

/** The section being read: the pinned one, or else the last whose headline has passed the upper third of the view. */
function markCurrent(bodyEl) {
  var rail = document.getElementById('detail-rail');
  if (!rail) return;
  var secs = sectionsOf(bodyEl);
  var current = -1;
  if (pinned >= 0 && pinned < secs.length) {
    current = pinned;
  } else {
    var box = bodyEl.getBoundingClientRect();
    var line = box.top + box.height / 3;
    for (var i = 0; i < secs.length; i++) {
      if (secs[i].title.getBoundingClientRect().top <= line) current = i;
    }
    // At the very bottom the last sections may never reach the line; the last one is then the one read.
    if (bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 4 && secs.length) current = secs.length - 1;
  }
  var links = rail.querySelectorAll('a[data-chapter]');
  for (var j = 0; j < links.length; j++) {
    if (j === current) links[j].setAttribute('aria-current', 'location');
    else links[j].removeAttribute('aria-current');
  }
}

/**
 * Fill the rail from the sections just rendered into bodyEl. Called at the end of every full
 * render; the scroll listener goes on bodyEl once, because bodyEl outlives every render.
 */
export function renderDetailRail(bodyEl) {
  var rail = document.getElementById('detail-rail');
  if (!rail) return;
  var secs = sectionsOf(bodyEl);
  rail.innerHTML =
    '<p class="poster-rail-title">' + escapeHtml(t('detail.railTitle')) + '</p>' +
    '<ol>' + secs.map(function (sec, i) {
      var n = i + 1;
      return '<li><a href="#" data-chapter="' + i + '">' +
          '<span class="poster-rail-number" aria-hidden="true">' + (n < 10 ? '0' : '') + n + '</span>' +
          '<span>' + escapeHtml(sectionLabel(sec.title)) + '</span>' +
        '</a></li>';
    }).join('') + '</ol>';
  rail.addEventListener('click', function (e) {
    var link = e.target.closest('a[data-chapter]');
    if (!link) return;
    e.preventDefault();
    goToSection(bodyEl, Number(link.getAttribute('data-chapter')));
  });
  if (!bodyEl.dataset.railWatch) {
    bodyEl.dataset.railWatch = '1';
    var queued = false;
    var remark = function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; markCurrent(bodyEl); });
    };
    bodyEl.addEventListener('scroll', remark, { passive: true });
    // Only a scroll the person makes releases the pin; the smooth scroll a click started fires
    // scroll events too, and those must leave the clicked section lit.
    var release = function () {
      if (pinned < 0) return;
      pinned = -1;
      remark();
    };
    bodyEl.addEventListener('wheel', release, { passive: true });
    bodyEl.addEventListener('touchmove', release, { passive: true });
    // A press on the scrollbar lands on the body itself, right of its content box.
    bodyEl.addEventListener('pointerdown', function (e) {
      if (e.target === bodyEl && e.offsetX >= bodyEl.clientWidth) release();
    });
    document.addEventListener('keydown', function (e) {
      if (pinned < 0 || document.getElementById('detail-view').hidden) return;
      if (!/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(e.key)) return;
      // Keys typed into a field move a caret, and a space on a button presses it; neither scrolls.
      var el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === ' ' && el && /^(BUTTON|A)$/.test(el.tagName)) return;
      release();
    });
  }
  markCurrent(bodyEl);
}
