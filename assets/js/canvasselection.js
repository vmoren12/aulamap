/** Selecció i moviment conjunt de pupitres i taules d'equip. */
'use strict';

const tableSelection = new Set();
let tableGesture = null;
let spaceHeld = false;
let suppressCanvasClick = false;

function canvasTables() {
  const container = el('desksContainer');
  return [...container.querySelectorAll('.desk')].map(node => {
    const id = node.dataset.did;
    const position = getCanvasData().desks.find(d => d.id === id);
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

function selectedTeamStudents() {
  const layout = getTeamLayout();
  return [...new Set([...tableSelection].map(id => layout.assignments[id]).filter(Boolean))];
}

function updateSelectionActions() {
  const remove = el('deleteSelectedBtn');
  if (remove) {
    remove.hidden = !tableSelection.size;
    remove.textContent = `Eliminar seleccionats (${tableSelection.size})`;
  }
  const move = el('moveSelectedTeam');
  if (move) {
    move.hidden = currentCanvasView !== 'equips' || !tableSelection.size;
    move.innerHTML = '<option value="">Moure alumnes a…</option>' + (getTeams().groups || []).map((_, index) =>
      `<option value="${index}"${getTeams().lockedTeams[index] ? ' disabled' : ''}>${esc(teamName(index))}</option>`).join('');
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
    const x = Math.max(-Math.min(...gesture.items.map(item => item.x)), Math.round(dx / zoomLevel / 10) * 10);
    const y = Math.max(-Math.min(...gesture.items.map(item => item.y)), Math.round(dy / zoomLevel / 10) * 10);
    if (!gesture.moved) pushUndo();
    gesture.items.forEach(item => {
      item.position.x = item.x + x;
      item.position.y = item.y + y;
      item.node.style.left = item.position.x + 'px';
      item.node.style.top = item.position.y + 'px';
      item.node.classList.add('moving');
    });
    drawRelationLines(getData());
    if (currentCanvasView === 'equips') renderTeamOverlays();
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
    suppressCanvasClick = true;
    setTimeout(() => { suppressCanvasClick = false; }, 0);
    if (gesture.type === 'move') {
      getCanvasData().layoutType = 'free';
      renderLayoutOptions();
      renderDesks();
      saveState();
    }
  }
}

function initTableSelection() {
  const area = el('canvasArea');
  area.addEventListener('pointerdown', event => {
    if (spaceHeld || event.button !== 0 || tableGesture) return;
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
          !(currentCanvasView === 'equips' && event.target.closest('.desk-student'))) {
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
    if (suppressCanvasClick || spaceHeld || event.shiftKey || event.ctrlKey || event.metaKey ||
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
