/**
 * AulaMap — Interfície
 * Pestanyes, navegació mòbil, tema clar/fosc, zoom i desplaçament del llenç
 * i repintat global.
 */
(function (A) {
'use strict';

const { el, toast, isMobile, appConfirm, isModalOpen, THEME_KEY, flags, DESK_W, DESK_H } = A;

/** Estat de la vista del llenç, compartit amb la selecció de pupitres. */
const view = { current: 'aula', panX: 0, panY: 0, zoom: 1 };

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;

/* ── Tema clar / fosc ────────────────────────────────── */

function storedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = theme;
  const button = el('themeBtn');
  if (button) {
    button.innerHTML = `<span class="mi">${theme === 'light' ? 'dark_mode' : 'light_mode'}</span> ${theme === 'light' ? 'Mode fosc' : 'Mode clar'}`;
  }
}

function initTheme() {
  applyTheme(storedTheme() === 'light' ? 'light' : 'dark');
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* el tema no es podrà recordar */ }
  applyTheme(next);
  toast(next === 'light' ? 'Mode clar activat' : 'Mode fosc activat', 'info');
}

/* ── Repintat global ─────────────────────────────────── */

/** Torna a pintar tota la interfície a partir de l'estat actual. */
function renderAll() {
  A.endTableGesture();
  A.clearTableSelection();
  const data = A.getData();
  A.renderDocentSelect();
  A.renderConfigSelect();

  el('centreName').value = data.centreName || '';
  el('curs').value = data.curs || '';
  el('nivell').value = data.nivell || '';
  el('aula').value = data.aula || '';
  el('layoutRows').value = data.layoutRows;
  el('layoutCols').value = data.layoutCols;
  el('layoutSpacing').value = data.layoutSpacing;
  el('spacingValue').textContent = data.layoutSpacing;

  A.applyTeacherPosition();
  A.renderLayoutOptions();
  A.renderStudentList();
  A.renderRelationsPanel();
  A.renderTeamsPanel();
  A.renderTeamsCanvas();
  A.updateCounts();
  A.updateActiveTeamBadge();
  A.updateUndoButtons();
}

/** Camps de la pestanya Info. */
function updateInfoField(field, value) {
  A.getData()[field] = value;
  A.saveState();
}

function confirmClearAll() {
  appConfirm('Eliminar-ho tot?', 'S\'esborraran alumnes, relacions, assignacions i equips d\'aquesta configuració.', () => {
    A.saveWithUndo();
    const entry = A.currentDocentEntry();
    const previous = entry.configurations[entry.currentConfig].data;
    const fresh = A.defaultConfigData();
    fresh.centreName = previous.centreName;
    fresh.curs = previous.curs;
    fresh.nivell = previous.nivell;
    fresh.aula = previous.aula;
    fresh.layoutType = previous.layoutType;
    fresh.layoutRows = previous.layoutRows;
    fresh.layoutCols = previous.layoutCols;
    fresh.layoutSpacing = previous.layoutSpacing;
    entry.configurations[entry.currentConfig].data = fresh;
    A.saveState();
    renderAll();
  });
}

/* ── Pestanyes i navegació ───────────────────────────── */

function switchTab(tab) {
  document.querySelectorAll('.sidebar-tab').forEach(node => node.classList.toggle('active', node.dataset.tab === tab));
  document.querySelectorAll('.sidebar-panel').forEach(node => node.classList.toggle('active', node.id === 'panel-' + tab));
  document.querySelectorAll('.mobile-nav-btn').forEach(node => node.classList.toggle('active', node.dataset.nav === tab));
  if (tab === 'equips') {
    A.renderTeamsPanel();
    if (view.current !== 'equips') switchCanvasView('equips');
  } else if (view.current !== 'aula') {
    switchCanvasView('aula');
  }
}

/** La classe al cos deixa surar els botons d'acció per damunt del menú obert. */
function openMobileSidebar(tab) {
  el('sidebarPanel').classList.add('mobile-open');
  document.body.classList.add('sidebar-open');
  if (tab) switchTab(tab);
}

function closeMobileSidebar() {
  el('sidebarPanel').classList.remove('mobile-open');
  document.body.classList.remove('sidebar-open');
  document.querySelectorAll('.mobile-nav-btn').forEach(node => node.classList.remove('active'));
}

function mobileNav(target) {
  const active = document.querySelector('.mobile-nav-btn.active');
  if (active && active.dataset.nav === target && el('sidebarPanel').classList.contains('mobile-open')) {
    closeMobileSidebar();
    return;
  }
  openMobileSidebar(target);
}

function toggleHeaderMenu() {
  const dropdown = el('headerDropdown');
  dropdown.classList.toggle('show');
  if (dropdown.classList.contains('show')) {
    setTimeout(() => document.addEventListener('click', closeHeaderMenuOutside, { once: true }), 10);
  }
}

function closeHeaderMenu() { el('headerDropdown').classList.remove('show'); }

function closeHeaderMenuOutside(event) {
  if (!event.target.closest('.header-dropdown') && !event.target.closest('#headerMenuBtn')) closeHeaderMenu();
}

/* ── Vista del llenç ─────────────────────────────────── */

function switchCanvasView(next) {
  if (next === view.current) return;
  A.endTableGesture();
  A.clearTableSelection();
  view.current = next;

  const isAula = next === 'aula';
  el('classroom').classList.toggle('teams-mode', !isAula);

  ['toolbarAulaTools', 'toolbarClearBtn', 'toolbarSep1', 'toolbarScore']
    .forEach(id => { const node = el(id); if (node) node.style.display = isAula ? '' : 'none'; });
  el('autoAssignFab').style.display = isAula ? '' : 'none';
  el('fabTeamsBtn').style.display = 'none';
  el('arrangeTeamsBtn').style.display = isAula ? 'none' : '';

  if (isAula) {
    el('activeTeamBadge').style.display = 'none';
    if (document.querySelector('.sidebar-tab[data-tab="equips"].active')) switchTab('layout');
  } else {
    switchTab('equips');
  }
  A.renderTeamsCanvas();
}

/** Porta la vista a uns pupitres concrets i els deixa seleccionats i marcats. */
function focusDesks(deskIds) {
  if (view.current !== 'aula') switchCanvasView('aula');
  A.clearTableSelection();
  deskIds.forEach(id => A.tableSelection.add(id));
  A.refreshTableSelection();

  requestAnimationFrame(() => {
    const nodes = deskIds
      .map(id => document.querySelector(`.desk[data-did="${CSS.escape(id)}"]`))
      .filter(Boolean);
    if (!nodes.length) return;
    const area = el('canvasArea').getBoundingClientRect();
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    nodes.forEach(node => {
      const rect = node.getBoundingClientRect();
      left = Math.min(left, rect.left); top = Math.min(top, rect.top);
      right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
      node.classList.remove('desk-highlight');
      void node.offsetWidth;
      node.classList.add('desk-highlight');
    });
    view.panX += area.left + area.width / 2 - (left + right) / 2;
    view.panY += area.top + area.height / 2 - (top + bottom) / 2;
    applyZoom();
  });
}

/* ── Zoom i desplaçament ─────────────────────────────── */

function applyZoom() {
  el('canvasInner').style.transform = `translate(${view.panX}px,${view.panY}px) scale(${view.zoom})`;
  el('zoomLabel').textContent = Math.round(view.zoom * 100) + '%';
}

function zoomIn() { view.zoom = Math.min(ZOOM_MAX, view.zoom + 0.1); applyZoom(); }
function zoomOut() { view.zoom = Math.max(ZOOM_MIN, view.zoom - 0.1); applyZoom(); }

/** Enquadra la vista activa. */
function zoomReset() {
  view.zoom = isMobile() ? 0.7 : 1;
  const area = el('canvasArea');
  if (view.current === 'equips') {
    const positions = A.getTeamLayout().desks;
    if (positions.length && area) {
      const minX = Math.min(...positions.map(p => p.x));
      const minY = Math.min(...positions.map(p => p.y));
      const maxX = Math.max(...positions.map(p => p.x + DESK_W));
      const maxY = Math.max(...positions.map(p => p.y + DESK_H));
      view.zoom = Math.min(view.zoom, Math.max(ZOOM_MIN, Math.min((area.clientWidth - 80) / (maxX - minX), (area.clientHeight - 100) / (maxY - minY + 40))));
      const canvas = el('desksContainer');
      const classroom = el('classroom');
      view.panX = area.clientWidth / 2 - ((minX + maxX) / 2 + canvas.offsetLeft + classroom.offsetLeft) * view.zoom;
      view.panY = area.clientHeight / 2 - ((minY + maxY - 32) / 2 + canvas.offsetTop + classroom.offsetTop) * view.zoom;
    } else { view.panX = 0; view.panY = 0; }
  } else {
    const classroom = el('classroom');
    const teacher = classroom.querySelector('.teacher-desk');
    if (teacher && area) {
      view.panX = area.clientWidth / 2 - (teacher.offsetLeft + classroom.offsetLeft + teacher.offsetWidth / 2) * view.zoom;
      view.panY = A.getData().teacherAtBottom
        ? area.clientHeight * 0.92 - (classroom.offsetTop + classroom.offsetHeight) * view.zoom
        : area.clientHeight * 0.08 - (classroom.offsetTop + teacher.offsetTop) * view.zoom;
    } else { view.panX = 0; view.panY = 0; }
  }
  applyZoom();
}

/** Zoom centrat en un punt de la pantalla. */
function zoomAt(nextZoom, clientX, clientY) {
  const rect = el('canvasArea').getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const previous = view.zoom;
  view.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nextZoom));
  view.panX = x - (x - view.panX) * (view.zoom / previous);
  view.panY = y - (y - view.panY) * (view.zoom / previous);
  applyZoom();
}

/* ── Interaccions del llenç ──────────────────────────── */

function initCanvasInteractions() {
  const area = el('canvasArea');

  // El llenç pren el focus abans de preventDefault: espai no reactiva l'últim botó.
  area.addEventListener('pointerdown', event => {
    if (event.button === 0 && !event.target.closest('button,input,select,textarea,[contenteditable="true"]')) {
      area.focus({ preventScroll: true });
    }
  }, true);

  area.addEventListener('wheel', event => {
    event.preventDefault();
    if (A.isTableGesture()) return;
    zoomAt(view.zoom + (event.deltaY > 0 ? -0.07 : 0.07), event.clientX, event.clientY);
  }, { passive: false });

  let pinchDistance = 0;
  let pinchZoom = 1;
  let pinchX = 0;
  let pinchY = 0;
  const touchDistance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  area.addEventListener('touchstart', event => {
    if (event.touches.length !== 2) return;
    A.endTableGesture();
    endPan();
    event.preventDefault();
    pinchDistance = touchDistance(event.touches[0], event.touches[1]);
    pinchZoom = view.zoom;
    pinchX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    pinchY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
  }, { passive: false });

  area.addEventListener('touchmove', event => {
    if (event.touches.length !== 2 || !pinchDistance) return;
    event.preventDefault();
    zoomAt(pinchZoom * (touchDistance(event.touches[0], event.touches[1]) / pinchDistance), pinchX, pinchY);
  }, { passive: false });

  let panning = false;
  let panPointer = null;
  let startX = 0, startY = 0, startPanX = 0, startPanY = 0;
  const noPanSelector = '.desk,.team-zone-header,button,input,select,textarea';

  area.addEventListener('pointerdown', event => {
    if (event.button !== 0 || panning || A.isTableGesture()) return;
    if (!flags.spaceHeld && !(event.pointerType === 'touch' && !event.target.closest(noPanSelector))) return;
    if (event.target.closest('input,select,textarea')) return;
    event.stopPropagation();
    panPointer = event.pointerId;
    if (document.activeElement?.tagName === 'INPUT') document.activeElement.blur();
    panning = true;
    startX = event.clientX; startY = event.clientY;
    startPanX = view.panX; startPanY = view.panY;
    area.classList.add('panning');
    area.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, true);

  area.addEventListener('pointermove', event => {
    if (!panning || event.pointerId !== panPointer) return;
    view.panX = startPanX + (event.clientX - startX);
    view.panY = startPanY + (event.clientY - startY);
    applyZoom();
  });

  const endPan = () => {
    if (!panning) return;
    panning = false;
    if (area.hasPointerCapture(panPointer)) area.releasePointerCapture(panPointer);
    panPointer = null;
    flags.suppressClick = true;
    setTimeout(() => { flags.suppressClick = false; }, 0);
    area.classList.remove('panning');
  };
  area.addEventListener('pointerup', endPan);
  area.addEventListener('pointercancel', endPan);
  area.addEventListener('lostpointercapture', endPan);
  document.addEventListener('keydown', event => {
    if (event.code === 'Space' && !event.target.closest('input,textarea,select,[contenteditable="true"]') && !isModalOpen()) {
      event.preventDefault();
      area.focus({ preventScroll: true });
      flags.spaceHeld = true;
      area.classList.add('pan-ready');
    }
    if (event.key === 'Escape' && !isModalOpen()) {
      A.endTableGesture();
      A.clearTableSelection();
    }
  });
  const releaseSpace = () => {
    flags.spaceHeld = false;
    area.classList.remove('pan-ready');
    endPan();
  };
  document.addEventListener('keyup', event => {
    if (event.code === 'Space') {
      if (flags.spaceHeld) event.preventDefault();
      releaseSpace();
    }
  });
  window.addEventListener('blur', releaseSpace);
  A.initTableSelection();
}

/* ── Amplada de la barra lateral (escriptori) ────────── */

function initSidebarResize() {
  const handle = el('sidebarResize');
  const sidebar = el('sidebarPanel');
  let resizing = false, startX = 0, startWidth = 0;

  handle.addEventListener('pointerdown', event => {
    if (isMobile()) return;
    resizing = true;
    startX = event.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('active');
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.preventDefault();
  });

  handle.addEventListener('pointermove', event => {
    if (!resizing) return;
    sidebar.style.width = Math.min(600, Math.max(220, startWidth + (event.clientX - startX))) + 'px';
  });

  const stop = () => {
    if (!resizing) return;
    resizing = false;
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

/* ── Dreceres de teclat ──────────────────────────────── */

function initKeyboardShortcuts() {
  document.addEventListener('keydown', event => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && !isModalOpen() && A.tableSelection.size) {
      event.preventDefault();
      A.removeSelectedDesks();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault(); A.undo();
    } else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
      event.preventDefault(); A.redo();
    } else if (event.key === 'Escape' && !typing && isModalOpen()) {
      A.closeModal();
    }
  });
}

A.registerActions({
  switchTab: node => switchTab(node.dataset.tab),
  mobileNav: node => mobileNav(node.dataset.nav),
  closeMobileSidebar: () => closeMobileSidebar(),
  toggleHeaderMenu: () => toggleHeaderMenu(),
  toggleTheme: () => { toggleTheme(); closeHeaderMenu(); },
  updateInfoField: node => updateInfoField(node.dataset.field, node.value),
  confirmClearAll: () => confirmClearAll(),
  zoomIn: () => zoomIn(),
  zoomOut: () => zoomOut(),
  zoomReset: () => zoomReset()
});

Object.assign(A, {
  view, renderAll, updateInfoField, switchTab, switchCanvasView, closeHeaderMenu, focusDesks,
  applyZoom, zoomIn, zoomOut, zoomReset, zoomAt,
  initCanvasInteractions, initSidebarResize, initKeyboardShortcuts, initTheme, applyTheme, toggleTheme
});

})(window.AulaMap);
