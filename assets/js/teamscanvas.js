/**
 * AulaMap — Esquemes d'equips independents de la distribució de l'aula.
 *
 * El llenç és el mateix que el de l'aula, però en mode Equips els pupitres i
 * els seients surten de `teams.layout`: formar, moure o esborrar equips no
 * toca mai la distribució del grup classe.
 */
(function (A) {
'use strict';

const { el, esc, uid, toast, pluralize, isMobile, DESK_W, DESK_H } = A;

function getTeamLayout() {
  const teams = A.getTeams();
  if (!teams.layout) teams.layout = { desks: [], assignments: {}, lockedDesks: {}, layoutType: 'free' };
  return teams.layout;
}

/** Dades del llenç actiu: l'esquema d'equips o la distribució de l'aula. */
function getCanvasData() {
  return A.view.current === 'equips' ? getTeamLayout() : A.getData();
}

function desksForTeam(index) {
  const data = getTeamLayout();
  const members = new Set(A.getTeams().groups?.[index] || []);
  return data.desks.filter(desk => members.has(data.assignments[desk.id]));
}

function teamIndexForDesk(deskId) {
  const studentId = getTeamLayout().assignments[deskId];
  return (A.getTeams().groups || []).findIndex(group => group.includes(studentId));
}

/** Cada membre té un pupitre a l'esquema, independent del seu seient a l'aula. */
function seatTeamMembers(studentIds = (A.getTeams().groups || []).flat()) {
  const data = getTeamLayout();
  const members = new Set((A.getTeams().groups || []).flat());
  data.desks = data.desks.filter(desk => members.has(data.assignments[desk.id]));
  const deskIds = new Set(data.desks.map(desk => desk.id));
  Object.keys(data.assignments).forEach(id => { if (!deskIds.has(id)) delete data.assignments[id]; });
  const seated = new Set(data.desks.map(desk => data.assignments[desk.id]).filter(Boolean));
  const valid = new Set(A.getData().students.map(student => student.id));
  const free = data.desks.filter(desk => !data.assignments[desk.id]);
  studentIds.forEach(studentId => {
    if (seated.has(studentId) || !valid.has(studentId)) return;
    let desk = free.shift();
    if (!desk) {
      desk = { id: uid('d'), x: 20, y: 48 };
      data.desks.push(desk);
    }
    data.assignments[desk.id] = studentId;
    seated.add(studentId);
  });
}

/** Ordena només els pupitres de la formació activa. */
function arrangeTeamDesks() {
  const data = getTeamLayout();
  const groups = A.getTeams().groups || [];
  if (!groups.length) return;
  seatTeamMembers();
  const columns = isMobile() ? 2 : 3;
  const groupWidth = DESK_W * 2 + 12;
  const used = new Set();
  let rowY = 48;
  for (let start = 0; start < groups.length; start += columns) {
    let rowHeight = DESK_H;
    for (let index = start; index < Math.min(start + columns, groups.length); index++) {
      const desks = desksForTeam(index);
      desks.forEach((desk, position) => {
        desk.x = 20 + (index - start) * (groupWidth + 64) + (position % 2) * (DESK_W + 12);
        desk.y = rowY + Math.floor(position / 2) * (DESK_H + 12);
        used.add(desk.id);
      });
      rowHeight = Math.max(rowHeight, Math.ceil(desks.length / 2) * (DESK_H + 12) - 12);
    }
    rowY += rowHeight + 80;
  }
  data.desks.filter(desk => !used.has(desk.id)).forEach((desk, index) => {
    desk.x = 20 + (index % (columns * 2)) * (DESK_W + 20);
    desk.y = rowY + Math.floor(index / (columns * 2)) * (DESK_H + 20);
  });
  A.centerDesks(data.desks);
  data.layoutType = 'free';
}

function autoArrangeTeamDesks() {
  if (!A.getTeams().groups?.length) return;
  A.endTableGesture();
  A.saveWithUndo();
  arrangeTeamDesks();
  A.clearTableSelection();
  A.saveState();
  A.renderLayoutOptions();
  renderTeamsCanvas();
  A.renderStudentList();
  A.updateCounts();
  A.zoomReset();
}

/** Canviar de grup mou només el pupitre del membre a un lloc lliure proper. */
function placeDeskWithTeam(studentId, index, movingIds = []) {
  seatTeamMembers([studentId]);
  const data = getTeamLayout();
  const desk = data.desks.find(item => data.assignments[item.id] === studentId);
  if (!desk) return;
  const others = desksForTeam(index).filter(item => item !== desk && !movingIds.includes(data.assignments[item.id]));
  const originX = others.length ? Math.min(...others.map(item => item.x)) : 20;
  const originY = others.length ? Math.min(...others.map(item => item.y)) : Math.max(48, ...data.desks.map(item => item.y + DESK_H + 80));
  for (let slot = 0; ; slot++) {
    const x = originX + (slot % 2) * (DESK_W + 12);
    const y = originY + Math.floor(slot / 2) * (DESK_H + 12);
    const overlaps = data.desks.some(item => item !== desk &&
      x < item.x + DESK_W + 6 && x + DESK_W + 6 > item.x &&
      y < item.y + DESK_H + 6 && y + DESK_H + 6 > item.y);
    if (!overlaps) { desk.x = x; desk.y = y; break; }
  }
  data.layoutType = 'free';
}

function renderTeamsCanvas() {
  if (A.view.current === 'equips' && !A.getTeams().layout) {
    arrangeTeamDesks();
    const teams = A.getTeams();
    const saved = teams.saved[teams.activeSaved];
    if (saved && !saved.layout) saved.layout = JSON.parse(JSON.stringify(teams.layout));
    A.saveState();
  }
  A.renderDesks();
  updateActiveTeamBadge();
  updateFabTeamsButton();
}

/** Capçaleres sobre els pupitres reals, sense un segon llenç. */
function renderTeamOverlays() {
  const container = el('desksContainer');
  // isConnected: un camp de nom obert pot reordenar els nodes en perdre el focus.
  container.querySelectorAll('.team-zone').forEach(node => { if (node.isConnected) node.remove(); });
  el('classroom').classList.toggle('teams-mode', A.view.current === 'equips');
  const arrange = el('arrangeTeamsBtn');
  if (arrange) arrange.disabled = !A.getTeams().groups?.length;
  if (A.view.current !== 'equips') return;
  const teams = A.getTeams();
  const groups = teams.groups || [];
  const violations = A.teamViolations(groups);
  const prefView = A.preferenceTeamView ? A.preferenceTeamView(groups) : null;
  const right = Math.max(20, ...getTeamLayout().desks.map(desk => desk.x + DESK_W + 40));
  container.insertAdjacentHTML('beforeend', groups.map((group, index) => {
    const desks = desksForTeam(index);
    const x = desks.length ? Math.min(...desks.map(desk => desk.x)) : right;
    const y = desks.length ? Math.min(...desks.map(desk => desk.y)) - 36 : 12 + index * 48;
    const locked = !!teams.lockedTeams[index];
    const warning = violations[index].together.length || violations[index].separate.length;
    const missing = group.length - desks.length;
    return `<div class="team-zone" style="left:${x}px;top:${y}px" data-team-idx="${index}">
      <div class="team-zone-header">
        <button class="team-mv" title="Moure tots els pupitres de l'equip" data-action="noop" data-press="teamMove" data-idx="${index}"><span class="mi mi-xs">open_with</span></button>
        <span class="team-title" title="Doble clic per canviar el nom" data-dblclick="renameTeam" data-idx="${index}">${esc(A.teamName(index))}</span>
        <span class="team-count">${group.length}</span>
        ${teams.useCompetency ? `<span class="team-mean" title="Nivell mitjà">${A.groupMean(group).toFixed(2)}</span>` : ''}
        ${prefView ? prefView.group(index) : ''}
        ${warning ? '<span class="mi mi-xs" title="Hi ha restriccions incomplertes; consulta el panell">warning</span>' : ''}
        ${missing > 0 ? `<span class="team-count" title="Organitza les taules per donar-los lloc">${missing} sense lloc</span>` : ''}
        <button class="team-lock-btn${locked ? ' locked' : ''}" title="${locked ? 'Desbloquejar equip' : 'Bloquejar equip'}"
          data-action="toggleTeamLock" data-idx="${index}"><span class="mi mi-xs">${locked ? 'lock' : 'lock_open'}</span></button>
      </div>
    </div>`;
  }).join(''));
}

function onTeamMoveStart(event, index) {
  if (event.button !== 0 || A.flags.spaceHeld || A.isTableGesture()) return;
  const desks = desksForTeam(index);
  if (!desks.length) return;
  A.clearTableSelection();
  desks.forEach(desk => A.tableSelection.add(desk.id));
  A.startTableMove(event, desks[0].id);
}

/* ── Arrossegament d'alumnes entre equips ────────────── */

let teamDrag = { studentId: null, studentIds: [] };

function isTeamDragging() { return teamDrag.studentId !== null; }

function onTeamMemberDragStart(event, studentId) {
  if (A.flags.spaceHeld || A.isTableGesture() || A.getTeams().lockedStudents[studentId] !== undefined) {
    event.preventDefault();
    return;
  }
  const selected = A.selectedTeamStudents();
  const studentIds = selected.includes(studentId) ? selected : [studentId];
  if (studentIds.some(id => A.getTeams().lockedStudents[id] !== undefined)) {
    event.preventDefault();
    toast('La selecció conté alumnes fixats. Desbloqueja’ls abans de moure-la.', 'error');
    return;
  }
  teamDrag = { studentId, studentIds };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', studentId);
  }
  event.target.closest('.team-table-member')?.classList.add('tm-dragging');
  A.canvasTables().forEach(({ id, node }) => {
    if (studentIds.includes(getTeamLayout().assignments[id])) node.classList.add('drag-source');
  });
}

function onTeamMemberDragEnd(event) {
  event.target.closest?.('.team-table-member')?.classList.remove('tm-dragging');
  document.querySelectorAll('.drag-source,.drag-over-team')
          .forEach(node => node.classList.remove('drag-source', 'drag-over-team'));
  teamDrag = { studentId: null, studentIds: [] };
}

function onTeamDragOver(event, toIndex, node) {
  if (!teamDrag.studentIds.some(id => !A.getTeams().groups[toIndex]?.includes(id)) || A.getTeams().lockedTeams[toIndex]) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  node.classList.add('drag-over-team');
}

function onTeamDragLeave(event, node) {
  if (event.relatedTarget && node.contains(event.relatedTarget)) return;
  node.classList.remove('drag-over-team');
}

function onTeamDrop(event, toIndex, node) {
  event.preventDefault();
  node.classList.remove('drag-over-team');
  const { studentIds } = teamDrag;
  teamDrag = { studentId: null, studentIds: [] };
  if (A.moveStudentsToTeam(studentIds, toIndex)) {
    toast(`${pluralize(studentIds.length, 'alumne')} → ${A.teamName(toIndex)}`, 'success');
  }
}

/**
 * Arrossegament dels alumnes en mode Equips: el nom d'un pupitre es deixa anar
 * sobre un pupitre de l'equip de destí o sobre la seva capçalera.
 */
function initTeamsDragAndDrop() {
  const targetOf = node => {
    const zone = node.closest?.('.team-zone');
    if (zone) return { index: +zone.dataset.teamIdx, node: zone };
    const desk = node.closest?.('.desk');
    if (!desk) return null;
    const index = teamIndexForDesk(desk.dataset.did);
    return index >= 0 ? { index, node: desk } : null;
  };

  document.addEventListener('dragstart', event => {
    const member = event.target.closest?.('.team-table-member');
    if (!member || A.view.current !== 'equips') return;
    const studentId = getTeamLayout().assignments[member.closest('.desk')?.dataset.did];
    if (studentId) onTeamMemberDragStart(event, studentId);
  });

  document.addEventListener('dragend', event => {
    if (isTeamDragging() || event.target.closest?.('.team-table-member')) onTeamMemberDragEnd(event);
  });

  document.addEventListener('dragover', event => {
    if (!isTeamDragging()) return;
    const target = targetOf(event.target);
    if (target) onTeamDragOver(event, target.index, target.node);
  });

  document.addEventListener('dragleave', event => {
    if (!isTeamDragging()) return;
    const target = targetOf(event.target);
    if (target) onTeamDragLeave(event, target.node);
  });

  document.addEventListener('drop', event => {
    if (!isTeamDragging()) return;
    const target = targetOf(event.target);
    if (target) onTeamDrop(event, target.index, target.node);
  });
}

/* ── Indicadors ──────────────────────────────────────── */

function updateActiveTeamBadge() {
  const badge = el('activeTeamBadge');
  if (!badge) return;
  const teams = A.getTeams();
  if (A.view.current !== 'equips') { badge.style.display = 'none'; return; }
  if (teams.activeSaved !== null && teams.saved[teams.activeSaved]) {
    badge.innerHTML = `<span class="mi mi-xs">bookmark</span> ${esc(teams.saved[teams.activeSaved].name)}`;
    badge.style.display = '';
  } else if (teams.groups?.length) {
    badge.innerHTML = '<span class="mi mi-xs">groups</span> Equips actius';
    badge.style.display = '';
  } else {
    badge.innerHTML = '<span class="mi mi-xs">groups</span> Mode equips';
    badge.style.display = '';
  }
}

function updateFabTeamsButton() {
  const fab = el('fabTeamsBtn');
  if (!fab) return;
  if (A.view.current !== 'equips') { fab.style.display = 'none'; return; }
  const valid = A.teamValidationErrors().length === 0;
  fab.style.display = valid ? 'flex' : 'none';
  fab.disabled = !valid;
}

function createTeamsFromFab() {
  if (A.view.current !== 'equips') A.switchCanvasView('equips');
  A.createTeams();
}

A.registerActions({
  teamMove: (node, event) => onTeamMoveStart(event, +node.dataset.idx),
  arrangeTeamDesks: () => autoArrangeTeamDesks(),
  createTeamsFromFab: () => createTeamsFromFab(),
  moveSelectedTeam: node => {
    const index = parseInt(node.value, 10);
    node.value = '';
    if (Number.isNaN(index)) return;
    const students = A.selectedTeamStudents();
    if (A.moveStudentsToTeam(students, index)) {
      toast(`${pluralize(students.length, 'alumne')} → ${A.teamName(index)}`, 'success');
    }
  }
});

Object.assign(A, {
  getTeamLayout, getCanvasData, desksForTeam, teamIndexForDesk, seatTeamMembers,
  arrangeTeamDesks, autoArrangeTeamDesks, placeDeskWithTeam,
  renderTeamsCanvas, renderTeamOverlays, initTeamsDragAndDrop, isTeamDragging,
  updateActiveTeamBadge, updateFabTeamsButton, createTeamsFromFab
});

})(window.AulaMap);
