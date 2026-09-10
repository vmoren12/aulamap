/**
 * AulaMap — Distribució de l'aula
 * Plantilles de pupitres, dibuix del llenç, assignació d'alumnes i moviment lliure.
 */
'use strict';

const LAYOUTS = [
  { id: 'rows',    name: 'Files',    icon: 'grid_view' },
  { id: 'pairs',   name: 'Parelles', icon: 'view_column' },
  { id: 'ushape',  name: 'U',        icon: 'crop_free' },
  { id: 'groups4', name: 'Grups 4',  icon: 'dashboard' },
  { id: 'groups6', name: 'Grups 6',  icon: 'grid_on' },
  { id: 'circle',  name: 'Cercle',   icon: 'circle' },
  { id: 'free',    name: 'Lliure',   icon: 'touch_app' }
];

/* ── Plantilles ──────────────────────────────────────── */

function renderLayoutOptions() {
  const data = getData();
  el('layoutGrid').innerHTML = LAYOUTS.map(layout => `
    <div class="layout-option ${data.layoutType === layout.id ? 'selected' : ''}" onclick="selectLayout('${layout.id}')">
      <div class="li"><span class="mi">${layout.icon}</span></div>
      <div class="ln">${layout.name}</div>
    </div>`).join('');
}

function selectLayout(type) {
  const data = getData();
  saveWithUndo();
  data.layoutType = type;
  if (type === 'free') {
    if (!data.desks.length) data.desks = [{ id: uid('d'), x: 0, y: 0 }];
  } else {
    generateDesks();
  }
  saveState();
  renderLayoutOptions();
  renderDesks();
  updateCounts();
}

/** Genera els pupitres de la plantilla activa, conservant les assignacions possibles. */
function generateDesks() {
  const data = getData();
  const { layoutRows: rows, layoutCols: cols, layoutSpacing: spacing } = data;
  const desks = [];
  const stepX = DESK_W + spacing;
  const stepY = DESK_H + spacing;
  const push = (x, y) => desks.push({ id: 'd' + desks.length, x, y });

  switch (data.layoutType) {
    case 'rows':
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) push(c * stepX, r * stepY);
      break;
    case 'pairs':
      for (let r = 0; r < rows; r++) {
        let x = 0;
        for (let p = 0; p < Math.ceil(cols / 2); p++) {
          push(x, r * stepY);
          push(x + DESK_W + 6, r * stepY);
          x += 2 * DESK_W + 6 + spacing + 20;
        }
      }
      break;
    case 'ushape':
      for (let r = 0; r < rows; r++) push(0, r * stepY);
      for (let c = 1; c < cols - 1; c++) push(c * stepX, rows * stepY);
      for (let r = 0; r < rows; r++) push((cols - 1) * stepX, r * stepY);
      break;
    case 'groups4':
      for (let r = 0; r < Math.ceil(rows / 2); r++) {
        for (let c = 0; c < Math.ceil(cols / 2); c++) {
          const bx = c * (2 * DESK_W + spacing + 30);
          const by = r * (2 * DESK_H + spacing + 20);
          push(bx, by); push(bx + DESK_W + 6, by);
          push(bx, by + DESK_H + 6); push(bx + DESK_W + 6, by + DESK_H + 6);
        }
      }
      break;
    case 'groups6':
      for (let r = 0; r < Math.ceil(rows / 2); r++) {
        for (let c = 0; c < Math.ceil(cols / 3); c++) {
          const bx = c * (3 * DESK_W + 2 * 6 + spacing + 30);
          const by = r * (2 * DESK_H + spacing + 20);
          for (let gr = 0; gr < 2; gr++) for (let gc = 0; gc < 3; gc++) push(bx + gc * (DESK_W + 6), by + gr * (DESK_H + 6));
        }
      }
      break;
    case 'circle': {
      const total = rows * cols;
      const radius = Math.max(130, total * 14);
      for (let i = 0; i < total; i++) {
        const angle = (2 * Math.PI * i / total) - Math.PI / 2;
        push(Math.round(radius * Math.cos(angle) + radius), Math.round(radius * Math.sin(angle) + radius));
      }
      break;
    }
    default:
      return; // 'free': els pupitres els col·loca el docent
  }

  centerDesks(desks);

  // Conserva les assignacions dels pupitres que continuen existint.
  const previousAssignments = { ...data.assignments };
  const previousLocks = { ...data.lockedDesks };
  const ids = new Set(desks.map(d => d.id));
  data.desks = desks;
  data.assignments = {};
  data.lockedDesks = {};
  Object.entries(previousAssignments).forEach(([deskId, studentId]) => {
    if (!ids.has(deskId)) return;
    data.assignments[deskId] = studentId;
    if (previousLocks[deskId]) data.lockedDesks[deskId] = true;
  });
}

/** Centra horitzontalment el conjunt de pupitres dins de l'aula. */
function centerDesks(desks) {
  if (!desks.length) return;
  const minX = Math.min(...desks.map(d => d.x));
  const maxX = Math.max(...desks.map(d => d.x + DESK_W));
  const classroom = el('classroom');
  const width = classroom ? classroom.clientWidth - 40 : 800;
  const offset = width / 2 - (minX + maxX) / 2;
  desks.forEach(d => { d.x = Math.round(d.x + offset); });
  const newMinX = Math.min(...desks.map(d => d.x));
  if (newMinX < 0) desks.forEach(d => { d.x -= newMinX; });
}

function applyCustomLayout() {
  const data = getData();
  saveWithUndo();
  data.layoutRows = Math.max(1, Math.min(10, +el('layoutRows').value || 1));
  data.layoutCols = Math.max(1, Math.min(10, +el('layoutCols').value || 1));
  data.layoutSpacing = +el('layoutSpacing').value;
  el('layoutRows').value = data.layoutRows;
  el('layoutCols').value = data.layoutCols;
  if (data.layoutType === 'free') data.layoutType = 'rows';
  generateDesks();
  saveState();
  renderLayoutOptions();
  renderDesks();
  updateCounts();
}

function addFreeDesk() {
  const data = getData();
  saveWithUndo();
  data.layoutType = 'free';
  let x = 20, y = 20;
  if (data.desks.length) {
    const last = data.desks[data.desks.length - 1];
    x = last.x + DESK_W + 20;
    y = last.y;
    if (x > 800) { x = 20; y = last.y + DESK_H + 20; }
  }
  data.desks.push({ id: uid('d'), x, y });
  saveState();
  renderLayoutOptions();
  renderDesks();
  updateCounts();
  toast('Pupitre afegit', 'success');
}

function removeDeskById(id) {
  const data = getData();
  saveWithUndo();
  data.desks = data.desks.filter(d => d.id !== id);
  delete data.assignments[id];
  delete data.lockedDesks[id];
  saveState();
  renderDesks();
  updateCounts();
}

/* ── Dibuix ──────────────────────────────────────────── */

function renderDesks() {
  const data = getData();
  const container = el('desksContainer');

  if (!data.desks.length && data.layoutType !== 'free') { generateDesks(); saveState(); }
  if (!data.desks.length) {
    container.querySelectorAll('.desk').forEach(node => node.remove());
    el('relationSvg').innerHTML = '';
    el('deskCountLabel').textContent = 'Pupitres: 0';
    renderRelationScore();
    renderTeamOverlays();
    refreshTableSelection();
    return;
  }

  const maxX = Math.max(...data.desks.map(d => d.x + DESK_W));
  const maxY = Math.max(...data.desks.map(d => d.y + DESK_H));
  container.style.width = (maxX + 40) + 'px';
  container.style.height = (maxY + 40) + 'px';

  const evaluation = evaluateRelations(data);
  const deskDots = relationDots(data, evaluation);
  drawRelationLines(data);
  el('relationSvg').setAttribute('width', maxX + 40);
  el('relationSvg').setAttribute('height', maxY + 40);

  const html = data.desks.map((desk, index) => {
    const studentId = data.assignments[desk.id];
    const student = studentId ? findStudent(studentId) : null;
    const teamIndex = currentCanvasView === 'equips' ? teamIndexForDesk(desk.id) : -1;
    const inTeam = teamIndex >= 0;
    const locked = inTeam ? getTeams().lockedStudents[studentId] !== undefined : !!data.lockedDesks[desk.id];
    const lockAction = inTeam ? `toggleStudentLock('${esc(studentId)}',${teamIndex})` : `toggleDeskLock('${esc(desk.id)}')`;
    const dots = currentCanvasView === 'equips' ? '' : [...new Set(deskDots[desk.id] || [])].map(kind => `<div class="cdot ${kind}"></div>`).join('');
    const occupied = !!student;
    return `<div class="desk ${occupied ? 'occupied' : 'empty'}${locked ? ' locked' : ''}"
        style="left:${desk.x}px;top:${desk.y}px" data-did="${esc(desk.id)}" ${inTeam ? `data-team-idx="${teamIndex}"` : ''}
        ondragover="onDeskDragOver(event)" ondragleave="onDeskDragLeave(event)" ondrop="onDeskDrop(event,'${esc(desk.id)}')"
        onclick="onDeskClick('${esc(desk.id)}')">
      <span class="dlbl">${index + 1}</span>
      <div class="mv-btn" title="Moure pupitre" onpointerdown="onDeskMoveStart(event,'${esc(desk.id)}')"><span class="mi" style="font-size:10px">open_with</span></div>
      ${occupied ? `
        <button class="rm-btn" title="Treure alumne" onclick="event.stopPropagation();unseat('${esc(desk.id)}')"><span class="mi" style="font-size:10px">close</span></button>
        <div class="desk-student${inTeam ? ' team-table-member' : ''}" ${inTeam ? `draggable="${!locked}" ondragstart="onTeamMemberDragStart(event,'${esc(studentId)}',${teamIndex})" ondragend="onTeamMemberDragEnd(event)"` : ''}>
          <div class="dav" style="background:${esc(student.color)}">${esc(initialOf(student.name))}</div>
          <div class="sname">${esc(student.name)}</div>
        </div>
        ${inTeam ? `<div class="desk-team-label" title="${esc(teamName(teamIndex))}">${esc(teamName(teamIndex))}${getTeams().useCompetency ? ` · ${competencyOf(studentId)}` : ''}</div>` : ''}
        <button class="lock-btn" title="${locked ? 'Desbloquejar' : inTeam ? 'Fixar a aquest equip' : 'Fixar alumne'}" onclick="event.stopPropagation();${lockAction}"><span class="mi" style="font-size:10px">${locked ? 'lock' : 'lock_open'}</span></button>`
      : '<div class="sname">Buit</div>'}
      <button class="del-desk-btn" title="Eliminar pupitre" onclick="event.stopPropagation();removeDeskById('${esc(desk.id)}')"><span class="mi" style="font-size:10px">delete</span></button>
      ${dots ? `<div class="cdots">${dots}</div>` : ''}
    </div>`;
  }).join('');

  container.querySelectorAll('.desk').forEach(node => node.remove());
  container.insertAdjacentHTML('beforeend', html);
  el('deskCountLabel').textContent = `Pupitres: ${data.desks.length}`;
  renderRelationScore(evaluation);
  refreshTableSelection();
  renderTeamOverlays();
}

/** Dibuixa les línies entre alumnes relacionats que seuen a tocar. */
function drawRelationLines(data) {
  if (currentCanvasView === 'equips') { el('relationSvg').innerHTML = ''; return; }
  const lines = relationLines(data);
  const deskById = new Map(data.desks.map(d => [d.id, d]));
  const drawn = new Set();
  let svg = '';
  lines.forEach(line => {
    const key = [line.deskA, line.deskB].sort().join('|') + line.kind;
    if (drawn.has(key)) return;
    drawn.add(key);
    const a = deskById.get(line.deskA), b = deskById.get(line.deskB);
    if (!a || !b) return;
    svg += `<line x1="${a.x + DESK_W / 2}" y1="${a.y + DESK_H / 2}" x2="${b.x + DESK_W / 2}" y2="${b.y + DESK_H / 2}"
            class="compat-line ${line.kind}" stroke-width="2.5" opacity="0.5"/>`;
  });
  el('relationSvg').innerHTML = svg;
}

/* ── Assignació d'alumnes ────────────────────────────── */

let draggedStudentId = null;

function onStudentDragStart(event, studentId) {
  draggedStudentId = studentId;
  event.dataTransfer.effectAllowed = 'move';
  event.target.closest('.student-item')?.classList.add('dragging');
}

function onStudentDragEnd(event) {
  event.target.closest?.('.student-item')?.classList.remove('dragging');
  draggedStudentId = null;
}

function onDeskDragOver(event) {
  if (currentCanvasView === 'equips' && teamDrag.studentId !== null) {
    const index = teamIndexForDesk(event.currentTarget.dataset.did);
    if (index >= 0) onTeamDragOver(event, index);
    return;
  }
  if (!draggedStudentId) return;
  event.preventDefault();
  event.currentTarget.classList.add('drag-over-desk');
}

function onDeskDragLeave(event) {
  event.currentTarget.classList.remove('drag-over-desk');
  onTeamDragLeave(event);
}

/** Deixa anar un alumne sobre un pupitre; si està ocupat, els alumnes s'intercanvien. */
function onDeskDrop(event, deskId) {
  if (currentCanvasView === 'equips' && teamDrag.studentId !== null) {
    const index = teamIndexForDesk(deskId);
    if (index >= 0) onTeamDrop(event, index);
    return;
  }
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over-desk');
  if (!draggedStudentId) return;
  const data = getData();
  if (data.lockedDesks[deskId]) { toast('Aquest pupitre està fixat', 'error'); return; }
  saveWithUndo();
  const occupant = data.assignments[deskId];
  const origin = Object.keys(data.assignments).find(k => data.assignments[k] === draggedStudentId);
  if (occupant && origin) data.assignments[origin] = occupant;
  else if (origin) { delete data.assignments[origin]; delete data.lockedDesks[origin]; }
  data.assignments[deskId] = draggedStudentId;
  saveState();
  renderDesks();
  renderStudentList();
  renderRelationsPanel();
  updateCounts();
}

function onDeskClick(deskId) {
  const data = getData();
  if (data.assignments[deskId]) return;
  const seated = new Set(Object.values(data.assignments));
  const available = data.students.filter(s => !seated.has(s.id));
  if (!available.length) { toast('Tots els alumnes ja tenen lloc', 'info'); return; }
  openModal(`<h3><span class="mi">person_pin</span> Assignar alumne</h3>
    <div style="max-height:280px;overflow-y:auto">
      ${available.map(s => `<div class="student-item" style="cursor:pointer" onclick="assignStudentToDesk('${esc(deskId)}','${esc(s.id)}')">
        <div class="av" style="background:${esc(s.color)}">${esc(initialOf(s.name))}</div><span class="nm">${esc(s.name)}</span></div>`).join('')}
    </div>
    <div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel·lar</button></div>`);
}

function assignStudentToDesk(deskId, studentId) {
  const data = getData();
  saveWithUndo();
  Object.keys(data.assignments).forEach(k => { if (data.assignments[k] === studentId) { delete data.assignments[k]; delete data.lockedDesks[k]; } });
  data.assignments[deskId] = studentId;
  saveState();
  closeModal();
  renderDesks();
  renderStudentList();
  renderRelationsPanel();
  updateCounts();
}

function unseat(deskId) {
  const data = getData();
  saveWithUndo();
  delete data.assignments[deskId];
  delete data.lockedDesks[deskId];
  saveState();
  renderDesks();
  renderStudentList();
  renderRelationsPanel();
  updateCounts();
}

function toggleDeskLock(deskId) {
  const data = getData();
  saveWithUndo();
  if (data.lockedDesks[deskId]) delete data.lockedDesks[deskId];
  else data.lockedDesks[deskId] = true;
  saveState();
  renderDesks();
}

/** Buida els seients; els pupitres fixats es mantenen. */
function clearAllSeats() {
  const data = getData();
  const lockedCount = Object.keys(data.lockedDesks).filter(k => data.assignments[k]).length;
  const detail = lockedCount
    ? `${pluralize(lockedCount, 'alumne')} ${lockedCount === 1 ? 'fixat es mantindrà' : 'fixats es mantindran'} al seu lloc.`
    : 'Tots els alumnes es desassignaran dels pupitres.';
  appConfirm('Buidar els seients?', detail, () => {
    saveWithUndo();
    Object.keys(data.assignments).forEach(deskId => {
      if (!data.lockedDesks[deskId]) delete data.assignments[deskId];
    });
    saveState();
    renderDesks();
    renderStudentList();
    renderRelationsPanel();
    updateCounts();
  });
}

/* ── Moviment de pupitres ────────────────────────────── */

function onDeskMoveStart(event, deskId) {
  startTableMove(event, deskId);
}

/* ── Taula del professorat ───────────────────────────── */

function toggleTeacherPosition() {
  const data = getData();
  data.teacherAtBottom = !data.teacherAtBottom;
  saveState();
  applyTeacherPosition();
}

function applyTeacherPosition() {
  const data = getData();
  const classroom = el('classroom');
  const desk = classroom.querySelector('.teacher-desk');
  const button = el('invertTeacherBtn');
  if (data.teacherAtBottom) {
    classroom.appendChild(desk);
    button.title = 'Taula del professorat a dalt';
  } else {
    classroom.insertBefore(desk, el('desksContainer'));
    button.title = 'Taula del professorat a baix';
  }
}
