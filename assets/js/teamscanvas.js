/**
 * AulaMap — Llenç d'equips
 * Taules d'equip col·locables, arrossegament d'alumnes entre equips i insígnia
 * de l'equip actiu.
 */
'use strict';

function renderTeamsCanvas() {
  const container = el('teamsContainer');
  if (!container) return;
  const data = getData();
  const teams = data.teams;
  const groups = teams.groups;

  if (!groups || !groups.length) {
    container.innerHTML = `<div class="team-canvas-empty"><span class="mi">groups</span>No hi ha equips actius.<br>
      Ves a la pestanya <strong>Equips</strong> i forma'n.</div>`;
    updateFabTeamsButton();
    return;
  }

  const showCompetency = teams.useCompetency;
  const violations = teamViolations(groups);
  const columns = Math.min(groups.length, isMobile() ? 2 : 4);

  groups.forEach((_, index) => {
    if (!teams.positions[index]) {
      teams.positions[index] = {
        x: 40 + (index % columns) * (isMobile() ? 170 : 200),
        y: 40 + Math.floor(index / columns) * 220
      };
    }
  });
  Object.keys(teams.positions).forEach(key => { if (parseInt(key, 10) >= groups.length) delete teams.positions[key]; });

  let maxX = 0, maxY = 0;
  const html = groups.map((group, index) => {
    const position = teams.positions[index];
    const color = TEAM_COLORS[index % TEAM_COLORS.length];
    const isLocked = !!teams.lockedTeams[index];
    const violation = violations[index];
    const hasWarning = violation.together.length || violation.separate.length;

    const members = group.map(studentId => {
      const student = findStudent(studentId);
      const studentLocked = teams.lockedStudents[studentId] !== undefined;
      return `<div class="team-table-member${studentLocked ? ' student-locked' : ''}"
          draggable="${studentLocked ? 'false' : 'true'}" data-student="${esc(studentId)}" data-from-team="${index}"
          ondragstart="onTeamMemberDragStart(event,'${esc(studentId)}',${index})" ondragend="onTeamMemberDragEnd(event)">
        <div class="tm-av" style="background:${esc(student?.color || '#6B7280')}">${esc(initialOf(student?.name))}</div>
        <span class="tm-name">${esc(student?.name || '?')}</span>
        ${showCompetency ? `<span class="tm-comp">${competencyOf(studentId)}</span>` : ''}
        <button class="tm-lock-btn${studentLocked ? ' locked' : ''}" title="${studentLocked ? 'Desbloquejar' : 'Fixar a aquest equip'}"
                onclick="event.stopPropagation();toggleStudentLock('${esc(studentId)}',${index})">
          <span class="mi" style="font-size:12px">${studentLocked ? 'lock' : 'lock_open'}</span>
        </button>
      </div>`;
    }).join('');

    const estimatedHeight = 36 + group.length * 26 + (showCompetency ? 28 : 0);
    maxX = Math.max(maxX, position.x + 160);
    maxY = Math.max(maxY, position.y + estimatedHeight);

    return `<div class="team-table${hasWarning ? ' has-warnings' : ''}${isLocked ? ' team-locked' : ''}" data-team-idx="${index}"
        style="left:${position.x}px;top:${position.y}px;${!isLocked && !hasWarning ? `border-color:${color}40;` : ''}"
        ondragover="onTeamDragOver(event,${index})" ondragleave="onTeamDragLeave(event)" ondrop="onTeamDrop(event,${index})">
      <div class="team-table-header" style="${!isLocked ? `background:${color}18;` : ''}">
        <div class="team-mv" title="Moure equip" onpointerdown="onTeamMoveStart(event,${index})"><span class="mi mi-xs">open_with</span></div>
        <span class="team-title" style="color:${isLocked ? 'var(--orange)' : color}" ondblclick="event.stopPropagation();startRenameTeam(${index},this)">${esc(teamName(index))}</span>
        <button class="team-lock-btn${isLocked ? ' locked' : ''}" title="${isLocked ? 'Desbloquejar equip' : 'Bloquejar equip'}"
                onclick="event.stopPropagation();toggleTeamLock(${index})"><span class="mi" style="font-size:14px">${isLocked ? 'lock' : 'lock_open'}</span></button>
        <span class="team-count">${group.length}</span>
      </div>
      <div class="team-table-members">${members}</div>
      ${showCompetency ? `<div class="team-table-avg">Nivell mitjà: ${groupMean(group).toFixed(2)}</div>` : ''}
    </div>`;
  }).join('');

  container.style.width = Math.max(maxX + 60, 800) + 'px';
  container.style.height = Math.max(maxY + 60, 600) + 'px';
  container.innerHTML = html;
  if (currentCanvasView === 'equips') refreshTableSelection();
  updateFabTeamsButton();
}

/* ── Moviment de les taules d'equip ──────────────────── */

function onTeamMoveStart(event, index) {
  startTableMove(event, index);
}

/* ── Arrossegament d'alumnes entre equips ────────────── */

let teamDrag = { studentId: null, fromIndex: null };

function onTeamMemberDragStart(event, studentId, fromIndex) {
  if (getTeams().lockedStudents[studentId] !== undefined) { event.preventDefault(); return; }
  teamDrag = { studentId, fromIndex };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', studentId);
  event.target.closest('.team-table-member')?.classList.add('tm-dragging');
  event.target.closest('.team-table')?.classList.add('drag-source');
}

function onTeamMemberDragEnd(event) {
  event.target.closest('.team-table-member')?.classList.remove('tm-dragging');
  document.querySelectorAll('.team-table.drag-source,.team-table.drag-over-team')
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
  moveStudentToTeam(studentId, fromIndex, toIndex);
  toast(`${studentName(studentId)} → ${teamName(toIndex)}`, 'success');
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
    badge.style.display = 'none';
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
