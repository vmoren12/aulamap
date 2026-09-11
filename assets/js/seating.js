/**
 * AulaMap — Distribució de l'aula
 *
 * Plantilles de pupitres, dibuix del llenç, assignació d'alumnes i moviment
 * lliure. El mateix dibuix serveix per al mode Equips: aleshores els pupitres
 * surten de l'esquema d'equips (`getCanvasData`) i no de la distribució real.
 */
(function (A) {
'use strict';

const { el, esc, uid, toast, pluralize, initialOf, openModal, closeModal, appConfirm, DESK_W, DESK_H } = A;

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
  const data = A.getData();
  el('layoutGrid').innerHTML = LAYOUTS.map(layout => `
    <div class="layout-option ${data.layoutType === layout.id ? 'selected' : ''}" data-action="selectLayout" data-value="${layout.id}">
      <div class="li"><span class="mi">${layout.icon}</span></div>
      <div class="ln">${layout.name}</div>
    </div>`).join('');
}

function selectLayout(type) {
  const data = A.getData();
  A.saveWithUndo();
  data.layoutType = type;
  if (type === 'free') {
    if (!data.desks.length) data.desks = [{ id: uid('d'), x: 0, y: 0 }];
  } else {
    generateDesks();
  }
  A.saveState();
  renderLayoutOptions();
  renderDesks();
  A.updateCounts();
}

/** Genera els pupitres de la plantilla activa, conservant les assignacions possibles. */
function generateDesks() {
  const data = A.getData();
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
  const data = A.getData();
  A.saveWithUndo();
  data.layoutRows = Math.max(1, Math.min(10, +el('layoutRows').value || 1));
  data.layoutCols = Math.max(1, Math.min(10, +el('layoutCols').value || 1));
  data.layoutSpacing = +el('layoutSpacing').value;
  el('layoutRows').value = data.layoutRows;
  el('layoutCols').value = data.layoutCols;
  if (data.layoutType === 'free') data.layoutType = 'rows';
  generateDesks();
  A.saveState();
  renderLayoutOptions();
  renderDesks();
  A.updateCounts();
}

function addFreeDesk() {
  const data = A.getData();
  A.saveWithUndo();
  data.layoutType = 'free';
  let x = 20, y = 20;
  if (data.desks.length) {
    const last = data.desks[data.desks.length - 1];
    x = last.x + DESK_W + 20;
    y = last.y;
    if (x > 800) { x = 20; y = last.y + DESK_H + 20; }
  }
  data.desks.push({ id: uid('d'), x, y });
  A.saveState();
  renderLayoutOptions();
  renderDesks();
  A.updateCounts();
  toast('Pupitre afegit', 'success');
}

/**
 * Paperera conjunta: elimina un pupitre o tota la selecció, sempre amb
 * confirmació i amb una sola entrada de desfer. Els alumnes es conserven.
 */
function removeDesksByIds(ids) {
  const data = A.getCanvasData();
  const selected = [...new Set(ids)].filter(id => data.desks.some(desk => desk.id === id));
  if (!selected.length) return;
  const teamsMode = A.view.current === 'equips';
  const seated = selected.filter(id => data.assignments[id]).length;
  const locked = selected.filter(id => data.lockedDesks[id] && data.assignments[id]).length;
  const detail = teamsMode
    ? `${pluralize(seated, 'alumne')} ${seated === 1 ? 'es quedarà' : 'es quedaran'} sense pupitre a l'esquema, però ${seated === 1 ? 'continua' : 'continuen'} al seu equip: amb "Organitzar taules" hi tornen a tenir lloc.`
    : [seated ? `${pluralize(seated, 'alumne')} ${seated === 1 ? 'es quedarà' : 'es quedaran'} sense lloc.` : 'Cap pupitre està ocupat.',
       locked ? `${pluralize(locked, 'alumne')} ${locked === 1 ? 'està fixat' : 'estan fixats'} amb cadenat.` : ''].filter(Boolean).join(' ');

  appConfirm(`Eliminar ${pluralize(selected.length, 'pupitre')}?`, detail, () => {
    const remove = new Set(selected);
    A.endTableGesture();
    A.saveWithUndo();
    data.desks = data.desks.filter(d => !remove.has(d.id));
    remove.forEach(id => {
      delete data.assignments[id];
      delete data.lockedDesks[id];
    });
    data.layoutType = 'free';
    A.clearTableSelection();
    A.saveState();
    renderLayoutOptions();
    renderDesks();
    A.renderStudentList();
    A.renderRelationsPanel();
    A.updateCounts();
    toast(`${pluralize(selected.length, 'pupitre')} ${selected.length === 1 ? 'eliminat' : 'eliminats'}`, 'success');
  }, 'Eliminar');
}

function removeDeskById(id) { removeDesksByIds([id]); }

function removeSelectedDesks() { removeDesksByIds([...A.tableSelection]); }

/* ── Dibuix ──────────────────────────────────────────── */

function renderDesks() {
  const data = A.getCanvasData();
  const container = el('desksContainer');
  const teamsMode = A.view.current === 'equips';

  if (!data.desks.length && data.layoutType !== 'free') { generateDesks(); A.saveState(); }
  if (!data.desks.length) {
    container.querySelectorAll('.desk').forEach(node => node.remove());
    el('relationSvg').innerHTML = '';
    el('deskCountLabel').textContent = 'Pupitres: 0';
    A.renderRelationScore();
    A.renderTeamOverlays();
    A.refreshTableSelection();
    return;
  }

  const maxX = Math.max(...data.desks.map(d => d.x + DESK_W));
  const maxY = Math.max(...data.desks.map(d => d.y + DESK_H));
  container.style.width = (maxX + 40) + 'px';
  container.style.height = (maxY + 40) + 'px';

  const evaluation = teamsMode ? null : A.evaluateRelations(data);
  const deskDots = evaluation ? A.relationDots(data, evaluation) : {};
  drawRelationLines(data);
  el('relationSvg').setAttribute('width', maxX + 40);
  el('relationSvg').setAttribute('height', maxY + 40);

  const teams = A.getTeams();
  const html = data.desks.map((desk, index) => {
    const studentId = data.assignments[desk.id];
    const student = studentId ? A.findStudent(studentId) : null;
    const teamIndex = teamsMode ? A.teamIndexForDesk(desk.id) : -1;
    const inTeam = teamIndex >= 0;
    const locked = inTeam ? teams.lockedStudents[studentId] !== undefined : !!data.lockedDesks[desk.id];
    const lockAttrs = inTeam
      ? `data-action="toggleStudentLock" data-sid="${esc(studentId)}" data-idx="${teamIndex}"`
      : `data-action="toggleDeskLock" data-did="${esc(desk.id)}"`;
    const dots = teamsMode ? '' : [...new Set(deskDots[desk.id] || [])].map(kind => `<div class="cdot ${kind}"></div>`).join('');
    const occupied = !!student;
    return `<div class="desk ${occupied ? 'occupied' : 'empty'}${locked ? ' locked' : ''}"
        style="left:${desk.x}px;top:${desk.y}px" data-did="${esc(desk.id)}"${inTeam ? ` data-team-idx="${teamIndex}"` : ''} data-action="deskClick">
      <span class="dlbl">${index + 1}</span>
      <div class="mv-btn" title="Moure pupitre" data-action="noop" data-press="deskMove" data-did="${esc(desk.id)}"><span class="mi" style="font-size:10px">open_with</span></div>
      ${occupied ? `
        ${teamsMode ? '' : `<button class="rm-btn" title="Treure alumne" data-action="unseat" data-did="${esc(desk.id)}"><span class="mi" style="font-size:10px">close</span></button>`}
        <div class="desk-student${inTeam ? ' team-table-member' : ''}" draggable="${!locked}"${teamsMode ? '' : ` data-sid="${esc(studentId)}"`}
             title="${teamsMode ? 'Arrossega’l a un altre equip' : 'Arrossega’l a un altre pupitre'}">
          <div class="dav" style="background:${esc(student.color)}">${esc(initialOf(student.name))}</div>
          <div class="sname">${esc(student.name)}</div>
        </div>
        ${inTeam ? `<div class="desk-team-label" title="${esc(A.teamName(teamIndex))}">${esc(A.teamName(teamIndex))}${teams.useCompetency ? ` · ${A.competencyOf(studentId)}` : ''}</div>` : ''}
        <button class="lock-btn" title="${locked ? 'Desbloquejar' : inTeam ? 'Fixar a aquest equip' : 'Fixar alumne'}" ${lockAttrs}><span class="mi" style="font-size:10px">${locked ? 'lock' : 'lock_open'}</span></button>`
      : '<div class="sname">Buit</div>'}
      <button class="del-desk-btn" title="Eliminar pupitre" data-action="removeDesk" data-did="${esc(desk.id)}"><span class="mi" style="font-size:10px">delete</span></button>
      ${dots ? `<div class="cdots">${dots}</div>` : ''}
    </div>`;
  }).join('');

  container.querySelectorAll('.desk').forEach(node => node.remove());
  container.insertAdjacentHTML('beforeend', html);
  el('deskCountLabel').textContent = `Pupitres: ${data.desks.length}`;
  if (evaluation) A.renderRelationScore(evaluation);
  A.refreshTableSelection();
  A.renderTeamOverlays();
}

/** Dibuixa les línies entre alumnes relacionats que seuen a tocar. */
function drawRelationLines(data) {
  if (A.view.current === 'equips') { el('relationSvg').innerHTML = ''; return; }
  const lines = A.relationLines(data);
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

/**
 * Arrossegament a l'aula: des de la llista d'alumnes o des d'un pupitre ocupat
 * (que permet intercanviar-lo amb un altre pupitre). En mode Equips, els
 * alumnes els gestiona el llenç d'equips.
 */
function initSeatingDragAndDrop() {
  document.addEventListener('dragstart', event => {
    if (A.view.current !== 'aula') return;
    const seat = event.target.closest?.('.desk .desk-student');
    const item = event.target.closest?.('.student-item');
    const source = seat || item;
    if (!source) return;
    draggedStudentId = source.dataset.sid;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedStudentId || '');
    }
    item?.classList.add('dragging');
  });

  document.addEventListener('dragend', event => {
    event.target.closest?.('.student-item')?.classList.remove('dragging');
    document.querySelectorAll('.drag-over-desk').forEach(node => node.classList.remove('drag-over-desk'));
    draggedStudentId = null;
  });

  document.addEventListener('dragover', event => {
    const desk = event.target.closest?.('.desk');
    if (!desk || !draggedStudentId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    desk.classList.add('drag-over-desk');
  });

  document.addEventListener('dragleave', event => {
    const desk = event.target.closest?.('.desk');
    if (!desk || desk.contains(event.relatedTarget)) return;
    desk.classList.remove('drag-over-desk');
  });

  document.addEventListener('drop', event => {
    const desk = event.target.closest?.('.desk');
    if (!desk || !draggedStudentId) return;
    event.preventDefault();
    desk.classList.remove('drag-over-desk');
    const studentId = draggedStudentId;
    draggedStudentId = null;
    seatStudent(desk.dataset.did, studentId);
  });
}

/**
 * Asseu un alumne en un pupitre de l'aula. Si el pupitre està ocupat i l'alumne
 * ja en tenia un altre, els dos alumnes s'intercanvien.
 */
function seatStudent(deskId, studentId) {
  const data = A.getData();
  if (!data.desks.some(d => d.id === deskId)) return;
  if (data.assignments[deskId] === studentId) return;
  if (data.lockedDesks[deskId]) { toast('Aquest pupitre està fixat', 'error'); return; }
  const origin = Object.keys(data.assignments).find(k => data.assignments[k] === studentId);
  if (origin && data.lockedDesks[origin]) { toast(`${A.studentName(studentId)} està fixat al seu pupitre`, 'error'); return; }

  A.saveWithUndo();
  const occupant = data.assignments[deskId];
  if (occupant && origin) data.assignments[origin] = occupant;
  else if (origin) { delete data.assignments[origin]; delete data.lockedDesks[origin]; }
  data.assignments[deskId] = studentId;
  A.saveState();
  renderDesks();
  A.renderStudentList();
  A.renderRelationsPanel();
  A.updateCounts();
}

/**
 * Clic sobre un pupitre de l'aula: si és buit, tria l'alumne que hi seurà; si
 * està ocupat, permet substituir-lo, intercanviar-lo o treure'l (millora 1.6).
 */
function onDeskClick(deskId) {
  if (A.view.current === 'equips') return;
  const data = A.getData();
  const index = data.desks.findIndex(d => d.id === deskId);
  if (index === -1) return;
  if (data.lockedDesks[deskId]) { toast('Pupitre fixat: obre el cadenat per canviar-lo', 'info'); return; }

  const occupantId = data.assignments[deskId];
  const occupant = occupantId ? A.findStudent(occupantId) : null;
  const seatedIds = new Set(Object.values(data.assignments));
  const available = data.students.filter(s => !seatedIds.has(s.id));
  const elsewhere = data.students.filter(s => s.id !== occupantId && seatedIds.has(s.id));

  const row = (student, label) => `<div class="student-item" style="cursor:pointer" data-action="seatStudent" data-did="${esc(deskId)}" data-sid="${esc(student.id)}">
      <div class="av" style="background:${esc(student.color)}">${esc(initialOf(student.name))}</div>
      <span class="nm">${esc(student.name)}</span>
      <span style="font-size:10px;color:var(--text3)">${label}</span>
    </div>`;

  if (!occupant) {
    if (!available.length && !elsewhere.length) { toast('No hi ha cap alumne per assignar', 'info'); return; }
    openModal(`<h3><span class="mi">person_pin</span> Assignar alumne al pupitre ${index + 1}</h3>
      <div class="modal-list">
        ${available.map(s => row(s, 'sense lloc')).join('')}
        ${elsewhere.length ? '<p class="modal-note" style="margin:10px 0 4px">Moure’l des d’un altre pupitre:</p>' : ''}
        ${elsewhere.map(s => row(s, 'canvia de lloc')).join('')}
      </div>
      <div class="modal-footer"><button class="btn" data-action="closeModal">Cancel·lar</button></div>`);
    return;
  }

  openModal(`<h3><span class="mi">swap_horiz</span> Pupitre ${index + 1}: ${esc(occupant.name)}</h3>
    <p class="modal-note">Tria un altre alumne per ocupar aquest lloc. Si l'alumne triat ja seia en un altre pupitre, els dos s'intercanvien.</p>
    <div class="modal-list">
      ${available.length ? '<p class="modal-note" style="margin:0 0 4px">Alumnes sense lloc:</p>' : ''}
      ${available.map(s => row(s, 'substitueix')).join('')}
      ${elsewhere.length ? '<p class="modal-note" style="margin:10px 0 4px">Intercanviar amb:</p>' : ''}
      ${elsewhere.map(s => row(s, 'intercanvia')).join('')}
      ${!available.length && !elsewhere.length ? '<div class="cset-empty">No hi ha cap altre alumne</div>' : ''}
    </div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn btn-danger" data-action="unseat" data-did="${esc(deskId)}"><span class="mi mi-xs">person_remove</span> Treure alumne</button>
    </div>`);
}

function unseat(deskId) {
  const data = A.getData();
  A.saveWithUndo();
  delete data.assignments[deskId];
  delete data.lockedDesks[deskId];
  A.saveState();
  closeModal();
  renderDesks();
  A.renderStudentList();
  A.renderRelationsPanel();
  A.updateCounts();
}

function toggleDeskLock(deskId) {
  const data = A.getData();
  A.saveWithUndo();
  if (data.lockedDesks[deskId]) delete data.lockedDesks[deskId];
  else data.lockedDesks[deskId] = true;
  A.saveState();
  renderDesks();
  A.renderRelationsPanel();
}

/** Buida els seients; els pupitres fixats es mantenen. */
function clearAllSeats() {
  const data = A.getData();
  const lockedCount = Object.keys(data.lockedDesks).filter(k => data.assignments[k]).length;
  const detail = lockedCount
    ? `${pluralize(lockedCount, 'alumne')} ${lockedCount === 1 ? 'fixat es mantindrà' : 'fixats es mantindran'} al seu lloc.`
    : 'Tots els alumnes es desassignaran dels pupitres.';
  appConfirm('Buidar els seients?', detail, () => {
    A.saveWithUndo();
    Object.keys(data.assignments).forEach(deskId => {
      if (!data.lockedDesks[deskId]) delete data.assignments[deskId];
    });
    A.saveState();
    renderDesks();
    A.renderStudentList();
    A.renderRelationsPanel();
    A.updateCounts();
  });
}

/* ── Taula del professorat ───────────────────────────── */

function toggleTeacherPosition() {
  const data = A.getData();
  data.teacherAtBottom = !data.teacherAtBottom;
  A.saveState();
  applyTeacherPosition();
}

function applyTeacherPosition() {
  const data = A.getData();
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

A.registerActions({
  noop: () => {},
  selectLayout: node => selectLayout(node.dataset.value),
  applyCustomLayout: () => applyCustomLayout(),
  updateSpacingLabel: node => { el('spacingValue').textContent = node.value; },
  addFreeDesk: () => addFreeDesk(),
  removeDesk: node => removeDeskById(node.dataset.did),
  removeSelectedDesks: () => removeSelectedDesks(),
  deskClick: node => onDeskClick(node.dataset.did),
  deskMove: (node, event) => A.startTableMove(event, node.dataset.did),
  seatStudent: node => { closeModal(); seatStudent(node.dataset.did, node.dataset.sid); },
  unseat: node => unseat(node.dataset.did),
  toggleDeskLock: node => toggleDeskLock(node.dataset.did),
  clearAllSeats: () => clearAllSeats(),
  toggleTeacherPosition: () => toggleTeacherPosition()
});

Object.assign(A, {
  LAYOUTS, renderLayoutOptions, generateDesks, centerDesks, applyCustomLayout, addFreeDesk,
  removeDeskById, removeDesksByIds, removeSelectedDesks, renderDesks, drawRelationLines,
  seatStudent, clearAllSeats, applyTeacherPosition, initSeatingDragAndDrop
});

})(window.AulaMap);
