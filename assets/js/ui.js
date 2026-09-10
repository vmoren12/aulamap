/**
 * AulaMap — Interfície
 * Pestanyes, navegació mòbil, zoom i desplaçament del llenç, i repintat global.
 */
'use strict';

let zoomLevel = 1;
let panX = 0;
let panY = 0;
let currentCanvasView = 'aula';

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;

/* ── Repintat global ─────────────────────────────────── */

/** Torna a pintar tota la interfície a partir de l'estat actual. */
function renderAll() {
  endTableGesture();
  clearTableSelection();
  const data = getData();
  renderDocentSelect();
  renderConfigSelect();

  el('centreName').value = data.centreName || '';
  el('curs').value = data.curs || '';
  el('nivell').value = data.nivell || '';
  el('aula').value = data.aula || '';
  el('layoutRows').value = data.layoutRows;
  el('layoutCols').value = data.layoutCols;
  el('layoutSpacing').value = data.layoutSpacing;
  el('spacingValue').textContent = data.layoutSpacing;

  applyTeacherPosition();
  renderLayoutOptions();
  renderStudentList();
  renderRelationsPanel();
  renderTeamsPanel();
  renderTeamsCanvas();
  updateCounts();
  updateActiveTeamBadge();
  updateUndoButtons();
}

/** Camps de la pestanya Info. */
function updateInfoField(field, value) {
  getData()[field] = value;
  saveState();
}

function updateSpacingLabel(value) {
  el('spacingValue').textContent = value;
}

function confirmClearAll() {
  appConfirm('Eliminar-ho tot?', 'S\'esborraran alumnes, relacions, assignacions i equips d\'aquesta configuració.', () => {
    saveWithUndo();
    const entry = currentDocentEntry();
    const previous = entry.configurations[entry.currentConfig].data;
    const fresh = defaultConfigData();
    fresh.centreName = previous.centreName;
    fresh.curs = previous.curs;
    fresh.nivell = previous.nivell;
    fresh.aula = previous.aula;
    fresh.layoutType = previous.layoutType;
    fresh.layoutRows = previous.layoutRows;
    fresh.layoutCols = previous.layoutCols;
    fresh.layoutSpacing = previous.layoutSpacing;
    entry.configurations[entry.currentConfig].data = fresh;
    saveState();
    renderAll();
  });
}

/* ── Pestanyes i navegació ───────────────────────────── */

function switchTab(tab) {
  document.querySelectorAll('.sidebar-tab').forEach(node => node.classList.toggle('active', node.dataset.tab === tab));
  document.querySelectorAll('.sidebar-panel').forEach(node => node.classList.toggle('active', node.id === 'panel-' + tab));
  document.querySelectorAll('.mobile-nav-btn').forEach(node => node.classList.toggle('active', node.dataset.nav === tab));
  if (tab === 'equips') {
    renderTeamsPanel();
    if (currentCanvasView !== 'equips') switchCanvasView('equips');
  } else if (currentCanvasView !== 'aula') {
    switchCanvasView('aula');
  }
}

function openMobileSidebar(tab) {
  el('sidebarPanel').classList.add('mobile-open');
  if (tab) switchTab(tab);
}

function closeMobileSidebar() {
  el('sidebarPanel').classList.remove('mobile-open');
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

function switchCanvasView(view) {
  if (view === currentCanvasView) return;
  endTableGesture();
  clearTableSelection();
  currentCanvasView = view;

  const isAula = view === 'aula';
  el('viewToggleAula').classList.toggle('active', isAula);
  el('viewToggleEquips').classList.toggle('active', !isAula);
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
  renderTeamsCanvas();
}

/* ── Zoom i desplaçament ─────────────────────────────── */

function applyZoom() {
  el('canvasInner').style.transform = `translate(${panX}px,${panY}px) scale(${zoomLevel})`;
  el('zoomLabel').textContent = Math.round(zoomLevel * 100) + '%';
}

function zoomIn() { zoomLevel = Math.min(ZOOM_MAX, zoomLevel + 0.1); applyZoom(); }
function zoomOut() { zoomLevel = Math.max(ZOOM_MIN, zoomLevel - 0.1); applyZoom(); }

/** Enquadra la vista activa. */
function zoomReset() {
  zoomLevel = isMobile() ? 0.7 : 1;
  const area = el('canvasArea');
  if (currentCanvasView === 'equips') {
    const positions = getTeamLayout().desks;
    if (positions.length && area) {
      const minX = Math.min(...positions.map(p => p.x));
      const minY = Math.min(...positions.map(p => p.y));
      const maxX = Math.max(...positions.map(p => p.x + DESK_W));
      const maxY = Math.max(...positions.map(p => p.y + DESK_H));
      zoomLevel = Math.min(zoomLevel, Math.max(ZOOM_MIN, Math.min((area.clientWidth - 80) / (maxX - minX), (area.clientHeight - 100) / (maxY - minY + 40))));
      const canvas = el('desksContainer');
      const classroom = el('classroom');
      panX = area.clientWidth / 2 - ((minX + maxX) / 2 + canvas.offsetLeft + classroom.offsetLeft) * zoomLevel;
      panY = area.clientHeight / 2 - ((minY + maxY - 32) / 2 + canvas.offsetTop + classroom.offsetTop) * zoomLevel;
    } else { panX = 0; panY = 0; }
  } else {
    const classroom = el('classroom');
    const teacher = classroom.querySelector('.teacher-desk');
    if (teacher && area) {
      panX = area.clientWidth / 2 - (teacher.offsetLeft + classroom.offsetLeft + teacher.offsetWidth / 2) * zoomLevel;
      panY = getData().teacherAtBottom
        ? area.clientHeight * 0.92 - (classroom.offsetTop + classroom.offsetHeight) * zoomLevel
        : area.clientHeight * 0.08 - (classroom.offsetTop + teacher.offsetTop) * zoomLevel;
    } else { panX = 0; panY = 0; }
  }
  applyZoom();
}

/** Zoom centrat en un punt de la pantalla. */
function zoomAt(nextZoom, clientX, clientY) {
  const rect = el('canvasArea').getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const previous = zoomLevel;
  zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nextZoom));
  panX = x - (x - panX) * (zoomLevel / previous);
  panY = y - (y - panY) * (zoomLevel / previous);
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
    if (tableGesture) return;
    zoomAt(zoomLevel + (event.deltaY > 0 ? -0.07 : 0.07), event.clientX, event.clientY);
  }, { passive: false });

  let pinchDistance = 0;
  let pinchZoom = 1;
  let pinchX = 0;
  let pinchY = 0;
  const touchDistance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  area.addEventListener('touchstart', event => {
    if (event.touches.length !== 2) return;
    endTableGesture();
    endPan();
    event.preventDefault();
    pinchDistance = touchDistance(event.touches[0], event.touches[1]);
    pinchZoom = zoomLevel;
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
    if (event.button !== 0 || panning || tableGesture) return;
    if (!spaceHeld && !(event.pointerType === 'touch' && !event.target.closest(noPanSelector))) return;
    if (event.target.closest('input,select,textarea')) return;
    event.stopPropagation();
    panPointer = event.pointerId;
    if (document.activeElement?.tagName === 'INPUT') document.activeElement.blur();
    panning = true;
    startX = event.clientX; startY = event.clientY;
    startPanX = panX; startPanY = panY;
    area.classList.add('panning');
    area.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, true);

  area.addEventListener('pointermove', event => {
    if (!panning || event.pointerId !== panPointer) return;
    panX = startPanX + (event.clientX - startX);
    panY = startPanY + (event.clientY - startY);
    applyZoom();
  });

  const endPan = () => {
    if (!panning) return;
    panning = false;
    if (area.hasPointerCapture(panPointer)) area.releasePointerCapture(panPointer);
    panPointer = null;
    suppressCanvasClick = true;
    setTimeout(() => { suppressCanvasClick = false; }, 0);
    area.classList.remove('panning');
  };
  area.addEventListener('pointerup', endPan);
  area.addEventListener('pointercancel', endPan);
  area.addEventListener('lostpointercapture', endPan);
  document.addEventListener('keydown', event => {
    if (event.code === 'Space' && !event.target.closest('input,textarea,select,[contenteditable="true"]') && !isModalOpen()) {
      event.preventDefault();
      area.focus({ preventScroll: true });
      spaceHeld = true;
      area.classList.add('pan-ready');
    }
    if (event.key === 'Escape' && !isModalOpen()) {
      endTableGesture();
      clearTableSelection();
    }
  });
  const releaseSpace = () => {
    spaceHeld = false;
    area.classList.remove('pan-ready');
    endPan();
  };
  document.addEventListener('keyup', event => {
    if (event.code === 'Space') {
      if (spaceHeld) event.preventDefault();
      releaseSpace();
    }
  });
  window.addEventListener('blur', releaseSpace);
  initTableSelection();
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
    if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && !isModalOpen() && tableSelection.size) {
      event.preventDefault();
      removeSelectedDesks();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault(); undo();
    } else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
      event.preventDefault(); redo();
    } else if (event.key === 'Escape' && !typing && isModalOpen()) {
      closeModal();
    }
  });
}
