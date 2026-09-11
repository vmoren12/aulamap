/**
 * AulaMap — Selecció múltiple al llenç
 *
 * Selecciona i mou pupitres, tant a l'aula com a l'esquema d'equips, i manté
 * les accions que depenen de la selecció (paperera conjunta i trasllat
 * d'alumnes a un altre equip).
 */
(function (A) {
'use strict';

const { el, esc, flags } = A;

const tableSelection = new Set();
let tableGesture = null;

function isTableGesture() { return tableGesture !== null; }

function canvasTables() {
  const container = el('desksContainer');
  return [...container.querySelectorAll('.desk')].map(node => {
    const id = node.dataset.did;
    const position = A.getCanvasData().desks.find(d => d.id === id);
    return { id, node, position };
  }).filter(item => item.position);
}

function refreshTableSelection() {
  const tables = canvasTables();
  const ids = new Set(tables.map(item => item.id));
  for (const id of tableSelection) if (!ids.has(id)) tableSelection.delete(id);
  tables.forEach(({ id, node }) => node.classList.toggle('table-selected', tableSelection.has(id)));
  updateSelectionActions();
}

function clearTableSelection() {
  tableSelection.clear();
  document.querySelectorAll('.table-selected').forEach(node => node.classList.remove('table-selected'));
  updateSelectionActions();
}

/** Alumnes que ocupen els pupitres seleccionats a l'esquema d'equips. */
function selectedTeamStudents() {
  const layout = A.getTeamLayout();
  return [...new Set([...tableSelection].map(id => layout.assignments[id]).filter(Boolean))];
}

function updateSelectionActions() {
  const remove = el('deleteSelectedBtn');
  if (remove) {
    remove.hidden = !tableSelection.size;
    remove.innerHTML = `<span class="mi mi-xs">delete</span> Eliminar seleccionats (${tableSelection.size})`;
  }
  const move = el('moveSelectedTeam');
  if (move) {
    move.hidden = A.view.current !== 'equips' || !tableSelection.size;
    move.innerHTML = '<option value="">Moure alumnes a…</option>' + (A.getTeams().groups || []).map((_, index) =>
      `<option value="${index}"${A.getTeams().lockedTeams[index] ? ' disabled' : ''}>${esc(A.teamName(index))}</option>`).join('');
  }
}

function startTableMove(event, id) {
  if (event.button !== 0 || tableGesture) return;
  event.preventDefault();
  event.stopPropagation();
  id = String(id);
  if (!tableSelection.has(id)) {
    tableSelection.clear();
    tableSelection.add(id);
  }
  refreshTableSelection();
  const items = canvasTables().filter(item => tableSelection.has(item.id))
    .map(item => ({ ...item, x: item.position.x, y: item.position.y }));
  if (!items.length) return;
  tableGesture = { type: 'move', pointerId: event.pointerId, x: event.clientX, y: event.clientY, items, moved: false };
  el('canvasArea').setPointerCapture(event.pointerId);
}

function moveTableGesture(event) {
  const gesture = tableGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
  if (gesture.type === 'move') {
    const x = Math.max(-Math.min(...gesture.items.map(item => item.x)), Math.round(dx / A.view.zoom / 10) * 10);
    const y = Math.max(-Math.min(...gesture.items.map(item => item.y)), Math.round(dy / A.view.zoom / 10) * 10);
    if (!gesture.moved) A.pushUndo();
    gesture.items.forEach(item => {
      item.position.x = item.x + x;
      item.position.y = item.y + y;
      item.node.style.left = item.position.x + 'px';
      item.node.style.top = item.position.y + 'px';
      item.node.classList.add('moving');
    });
    A.drawRelationLines(A.getData());
    if (A.view.current === 'equips') A.renderTeamOverlays();
  } else {
    const left = Math.min(gesture.x, event.clientX), top = Math.min(gesture.y, event.clientY);
    const right = Math.max(gesture.x, event.clientX), bottom = Math.max(gesture.y, event.clientY);
    const areaRect = el('canvasArea').getBoundingClientRect();
    Object.assign(gesture.box.style, { left: left - areaRect.left + 'px', top: top - areaRect.top + 'px',
      width: right - left + 'px', height: bottom - top + 'px' });
    tableSelection.clear();
    gesture.previous.forEach(id => tableSelection.add(id));
    canvasTables().forEach(({ id, node }) => {
      const rect = node.getBoundingClientRect();
      if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) tableSelection.add(id);
    });
    refreshTableSelection();
  }
  gesture.moved = true;
}

function endTableGesture(event) {
  const gesture = tableGesture;
  if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
  tableGesture = null;
  const area = el('canvasArea');
  if (area.hasPointerCapture(gesture.pointerId)) area.releasePointerCapture(gesture.pointerId);
  gesture.box?.remove();
  gesture.items?.forEach(item => item.node.classList.remove('moving'));
  if (gesture.moved) {
    flags.suppressClick = true;
    setTimeout(() => { flags.suppressClick = false; }, 0);
    if (gesture.type === 'move') {
      A.getCanvasData().layoutType = 'free';
      A.renderLayoutOptions();
      A.renderDesks();
      A.saveState();
    }
  }
}

function initTableSelection() {
  const area = el('canvasArea');
  area.addEventListener('pointerdown', event => {
    if (flags.spaceHeld || event.button !== 0 || tableGesture) return;
    const table = event.target.closest('.desk');
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (table) {
      const id = table.dataset.did;
      if (additive) {
        event.preventDefault();
        event.stopPropagation();
        if (tableSelection.has(id)) tableSelection.delete(id); else tableSelection.add(id);
        refreshTableSelection();
      } else if (!event.target.closest('button,input') && tableSelection.has(id) &&
          !(A.view.current === 'equips' && event.target.closest('.desk-student'))) {
        startTableMove(event, id);
      }
      return;
    }
    if (event.pointerType === 'touch' || event.target.closest('button,input,select,textarea,.team-zone-header')) return;
    event.preventDefault();
    if (!additive) clearTableSelection();
    const box = document.createElement('div');
    box.className = 'selection-marquee';
    area.appendChild(box);
    tableGesture = { type: 'select', pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      previous: new Set(tableSelection), box, moved: false };
    area.setPointerCapture(event.pointerId);
  }, true);
  area.addEventListener('click', event => {
    if (flags.suppressClick || flags.spaceHeld || event.shiftKey || event.ctrlKey || event.metaKey ||
        (tableSelection.size && event.target.closest('.desk') && !event.target.closest('button'))) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  area.addEventListener('pointermove', moveTableGesture);
  area.addEventListener('pointerup', endTableGesture);
  area.addEventListener('pointercancel', endTableGesture);
  area.addEventListener('lostpointercapture', endTableGesture);
  window.addEventListener('blur', () => endTableGesture());
}

A.registerActions({ clearSelection: () => clearTableSelection() });

Object.assign(A, {
  tableSelection, isTableGesture, canvasTables, selectedTeamStudents, updateSelectionActions,
  refreshTableSelection, clearTableSelection, startTableMove, moveTableGesture, endTableGesture,
  initTableSelection
});

})(window.AulaMap);
