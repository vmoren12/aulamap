/**
 * AulaMap — Mode d'equips sobre els pupitres de l'aula.
 * Agrupació, moviment i canvi de membres al mateix llenç.
 */
'use strict';

function desksForTeam(index) {
  const data = getData();
  const members = new Set(getTeams().groups?.[index] || []);
  return data.desks.filter(desk => members.has(data.assignments[desk.id]));
}

function teamIndexForDesk(deskId) {
  const studentId = getData().assignments[deskId];
  return (getTeams().groups || []).findIndex(group => group.includes(studentId));
}

/** Seu els membres sense lloc, conservant els alumnes i cadenats dels pupitres ocupats. */
function seatTeamMembers() {
  const data = getData();
  const seated = new Set(data.desks.map(desk => data.assignments[desk.id]).filter(Boolean));
  const valid = new Set(data.students.map(student => student.id));
  const free = data.desks.filter(desk => !data.assignments[desk.id]);
  (getTeams().groups || []).flat().forEach(studentId => {
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

/** Agrupa els pupitres reals; els sobrants es conserven al final. */
function arrangeTeamDesks() {
  const data = getData();
  const groups = getTeams().groups || [];
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
  centerDesks(data.desks);
  data.layoutType = 'free';
}

function autoArrangeTeamDesks() {
  if (!getTeams().groups?.length) return;
  endTableGesture();
  saveWithUndo();
  arrangeTeamDesks();
  clearTableSelection();
  saveState();
  renderLayoutOptions();
  renderTeamsCanvas();
  renderStudentList();
  updateCounts();
  zoomReset();
}

/** Canviar de grup mou només el pupitre del membre a un lloc lliure proper. */
function placeDeskWithTeam(studentId, index) {
  seatTeamMembers();
  const data = getData();
  const desk = data.desks.find(item => data.assignments[item.id] === studentId);
  if (!desk) return;
  const others = desksForTeam(index).filter(item => item !== desk);
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
  renderDesks();
  updateActiveTeamBadge();
  updateFabTeamsButton();
}

/** Capçaleres sobre els pupitres reals, sense un segon llenç. */
function renderTeamOverlays() {
  const container = el('desksContainer');
  container.querySelectorAll('.team-zone').forEach(node => node.remove());
  el('classroom').classList.toggle('teams-mode', currentCanvasView === 'equips');
  const arrange = el('arrangeTeamsBtn');
  if (arrange) arrange.disabled = !getTeams().groups?.length;
  if (currentCanvasView !== 'equips') return;
  const teams = getTeams();
  const groups = teams.groups || [];
  const violations = teamViolations(groups);
  const right = Math.max(20, ...getData().desks.map(desk => desk.x + DESK_W + 40));
  container.insertAdjacentHTML('beforeend', groups.map((group, index) => {
    const desks = desksForTeam(index);
    const x = desks.length ? Math.min(...desks.map(desk => desk.x)) : right;
    const y = desks.length ? Math.min(...desks.map(desk => desk.y)) - 36 : 12 + index * 48;
    const locked = !!teams.lockedTeams[index];
    const warning = violations[index].together.length || violations[index].separate.length;
    const missing = group.length - desks.length;
    return `<div class="team-zone" style="left:${x}px;top:${y}px" data-team-idx="${index}"
        ondragover="onTeamDragOver(event,${index})" ondragleave="onTeamDragLeave(event)" ondrop="onTeamDrop(event,${index})">
      <div class="team-zone-header">
        <button class="team-mv" title="Moure tots els pupitres de l'equip" onpointerdown="onTeamMoveStart(event,${index})"><span class="mi mi-xs">open_with</span></button>
        <span class="team-title" title="Doble clic per canviar el nom" ondblclick="startRenameTeam(${index},this)">${esc(teamName(index))}</span>
        <span class="team-count">${group.length}</span>
        ${teams.useCompetency ? `<span class="team-mean" title="Nivell mitjà">${groupMean(group).toFixed(2)}</span>` : ''}
        ${warning ? '<span class="mi mi-xs" title="Hi ha restriccions incomplertes; consulta el panell">warning</span>' : ''}
        ${missing > 0 ? `<span class="team-count" title="Organitza les taules per donar-los lloc">${missing} sense lloc</span>` : ''}
        <button class="team-lock-btn${locked ? ' locked' : ''}" title="${locked ? 'Desbloquejar equip' : 'Bloquejar equip'}"
          onclick="toggleTeamLock(${index})"><span class="mi mi-xs">${locked ? 'lock' : 'lock_open'}</span></button>
      </div>
    </div>`;
  }).join(''));
}

function onTeamMoveStart(event, index) {
  if (event.button !== 0 || spaceHeld || tableGesture) return;
  const desks = desksForTeam(index);
  if (!desks.length) return;
  clearTableSelection();
  desks.forEach(desk => tableSelection.add(desk.id));
  startTableMove(event, desks[0].id);
}

let teamDrag = { studentId: null, fromIndex: null };

function onTeamMemberDragStart(event, studentId, fromIndex) {
  if (spaceHeld || tableGesture || getTeams().lockedStudents[studentId] !== undefined) { event.preventDefault(); return; }
  teamDrag = { studentId, fromIndex };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', studentId);
  event.target.closest('.team-table-member')?.classList.add('tm-dragging');
  event.target.closest('.desk')?.classList.add('drag-source');
}

function onTeamMemberDragEnd(event) {
  event.target.closest('.team-table-member')?.classList.remove('tm-dragging');
  document.querySelectorAll('.drag-source,.drag-over-team')
          .forEach(node => node.classList.remove('drag-source', 'drag-over-team'));
  teamDrag = { studentId: null, fromIndex: null };
}

function onTeamDragOver(event, toIndex) {
  if (teamDrag.studentId === null || teamDrag.fromIndex === toIndex) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('drag-over-team');
}

function onTeamDragLeave(event) {
  if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
  event.currentTarget.classList.remove('drag-over-team');
}

function onTeamDrop(event, toIndex) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over-team');
  const { studentId, fromIndex } = teamDrag;
  if (studentId === null || fromIndex === null || fromIndex === toIndex) return;
  if (moveStudentToTeam(studentId, fromIndex, toIndex)) toast(`${studentName(studentId)} → ${teamName(toIndex)}`, 'success');
  teamDrag = { studentId: null, fromIndex: null };
}

/* ── Indicadors ──────────────────────────────────────── */

function updateActiveTeamBadge() {
  const badge = el('activeTeamBadge');
  if (!badge) return;
  const teams = getTeams();
  if (currentCanvasView !== 'equips') { badge.style.display = 'none'; return; }
  if (teams.activeSaved !== null && teams.saved[teams.activeSaved]) {
    badge.innerHTML = `<span class="mi mi-xs">bookmark</span> ${esc(teams.saved[teams.activeSaved].name)}`;
    badge.style.display = '';
  } else if (teams.groups?.length) {
    badge.innerHTML = '<span class="mi mi-xs">groups</span> Equips actius';
    badge.style.display = '';
  } else {
    badge.innerHTML = '<span class="mi mi-xs">groups</span> Mode de formació d’equips';
    badge.style.display = '';
  }
}

function updateFabTeamsButton() {
  const fab = el('fabTeamsBtn');
  if (!fab) return;
  if (currentCanvasView !== 'equips') { fab.style.display = 'none'; return; }
  const valid = teamValidationErrors().length === 0;
  fab.style.display = valid ? 'flex' : 'none';
  fab.disabled = !valid;
}

function createTeamsFromFab() {
  if (currentCanvasView !== 'equips') switchCanvasView('equips');
  createTeams();
}
