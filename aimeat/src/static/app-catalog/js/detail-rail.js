/**
 * @file detail-rail.js
 * @description The "On this page" rail beside the App Detail view: one link per section, numbered
 *   like the chapter numbers over the headlines, kept in view while the page scrolls, with the
 *   section being read lit. The same ink box with the sun shadow the profile pages carry (.og-rail
 *   in public/css/views/organism.css); this page cannot read that stylesheet, so the look is
 *   repeated as .dtl-rail in app-catalog-poster.css. The links are read from the rendered
 *   sections rather than listed by hand, so a section that appears only for an own published app
 *   gets its link and number without anyone keeping a second list.
 * @structure detailRailPage(mainHtml) · renderDetailRail(bodyEl)
 * @usage import { detailRailPage, renderDetailRail } from './detail-rail.js';
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import { escapeHtml } from './util.js';
import { t } from './i18n.js';

/** The page as two columns: the sections, and the rail the render fills in after assembly. */
export function detailRailPage(mainHtml) {
  return '<div class="dtl-page">' +
      '<div class="dtl-main">' + mainHtml + '</div>' +
      '<nav class="dtl-rail" id="detail-rail" aria-label="' + escapeHtml(t('detail.railTitle')) + '"></nav>' +
    '</div>';
}

/** The headline's own words: the first node of the h3, so an edit button or a badge beside it stays out. */
function sectionLabel(h3) {
  var first = h3.firstChild;
  var text = first ? (first.nodeType === 3 ? first.nodeValue : first.textContent) : '';
  return (text || h3.textContent || '').trim();
}

function sectionsOf(bodyEl) {
  return Array.prototype.slice.call(bodyEl.querySelectorAll('.dtl-main .dtl-section'))
    .filter(function (sec) { return sec.querySelector(':scope > h3'); });
}

/** Scroll the detail body, which is the element that scrolls here, so the headline lands under its top. */
function goToSection(bodyEl, index) {
  var sec = sectionsOf(bodyEl)[index];
  if (!sec) return;
  var top = bodyEl.scrollTop + sec.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - 24;
  bodyEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

/** The section being read: the last one whose headline has passed the upper third of the view. */
function markCurrent(bodyEl) {
  var rail = document.getElementById('detail-rail');
  if (!rail) return;
  var secs = sectionsOf(bodyEl);
  var box = bodyEl.getBoundingClientRect();
  var line = box.top + box.height / 3;
  var current = -1;
  for (var i = 0; i < secs.length; i++) {
    if (secs[i].getBoundingClientRect().top <= line) current = i;
  }
  // At the very bottom the last sections may never reach the line; the last one is then the one read.
  if (bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 4 && secs.length) current = secs.length - 1;
  var links = rail.querySelectorAll('.dtl-rail-link');
  for (var j = 0; j < links.length; j++) {
    var on = j === current;
    links[j].classList.toggle('on', on);
    if (on) links[j].setAttribute('aria-current', 'location');
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
    '<span class="dtl-rail-label">' + escapeHtml(t('detail.railTitle')) + '</span>' +
    secs.map(function (sec, i) {
      var n = i + 1;
      return '<button type="button" class="dtl-rail-link" data-chapter="' + i + '">' +
          '<i>' + (n < 10 ? '0' : '') + n + '</i>' + escapeHtml(sectionLabel(sec.querySelector(':scope > h3'))) +
        '</button>';
    }).join('');
  rail.addEventListener('click', function (e) {
    var link = e.target.closest('.dtl-rail-link');
    if (link) goToSection(bodyEl, Number(link.getAttribute('data-chapter')));
  });
  if (!bodyEl.dataset.railWatch) {
    bodyEl.dataset.railWatch = '1';
    var queued = false;
    bodyEl.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; markCurrent(bodyEl); });
    }, { passive: true });
  }
  markCurrent(bodyEl);
}
