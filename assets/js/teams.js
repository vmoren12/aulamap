/**
 * AulaMap — Equips de treball
 *
 * Formació d'equips a partir dels alumnes de la configuració activa, amb
 * conjunts d'"ajuntar" i "separar", nivells de competència opcionals i equips
 * o alumnes bloquejats que es mantenen entre repartiments.
 *
 * Els equips són independents de la distribució de l'aula: no comparteixen ni
 * pupitres ni assignacions amb el llenç d'Aula.
 */
(function (A) {
'use strict';

const { el, esc, uid, toast, pluralize, openModal, closeModal, focusModalField, appConfirm,
        REL_TOGETHER, REL_SEPARATE, REL_LABEL } = A;

const TEAM_ATTEMPTS = 60;        // intents de repartiment abans de rendir-se
const TEAM_HETERO_TARGET = 0.15; // variància acceptable entre nivells mitjans

/* ── Utilitats de dades ──────────────────────────────── */

function teamStudents() { return A.getData().students; }

function teamName(index) {
  return A.getTeams().teamNames[index] || `Equip ${index + 1}`;
}

function competencyOf(studentId) {
  const value = A.getTeams().competencies[studentId];
  return typeof value === 'number' ? value : 5;
}

function groupMean(group) {
  if (!group.length) return 0;
  return group.reduce((sum, id) => sum + competencyOf(id), 0) / group.length;
}

/** Equip al qual pertany un alumne, o -1. */
function teamIndexOf(studentId) {
  const groups = A.getTeams().groups;
  if (!groups) return -1;
  return groups.findIndex(group => group.includes(studentId));
}

/** Treu un alumne de tota la informació d'equips. */
function removeStudentFromTeams(teams, studentId) {
  delete teams.competencies[studentId];
  if (teams.preferences) {
    // Tant les tries com les peticions de separació perden l'alumne.
    ['prefs', 'avoid'].forEach(field => {
      const links = teams.preferences[field];
      if (!links) return;
      delete links[studentId];
      Object.keys(links).forEach(id => {
        links[id] = links[id].filter(other => other !== studentId);
        if (!links[id].length) delete links[id];
      });
    });
    // El grup d'origen, el sexe, les necessitats i la competència també se'n
    // van amb l'alumne.
    Object.values(teams.preferences.attributes || {}).forEach(values => { delete values[studentId]; });
    Object.keys(teams.preferences.attributes || {}).forEach(key => {
      if (!Object.keys(teams.preferences.attributes[key]).length) delete teams.preferences.attributes[key];
    });
    if (teams.preferences.levels) delete teams.preferences.levels[studentId];
    const best = teams.preferences.best;
    if (best) {
      best.groups = best.groups.map(group => group.filter(id => id !== studentId)).filter(group => group.length);
      if (!best.groups.length) teams.preferences.best = null;
    }
    if (!Object.keys(teams.preferences.prefs).length &&
        !Object.keys(teams.preferences.avoid || {}).length &&
        !Object.keys(teams.preferences.attributes || {}).length &&
        !Object.keys(teams.preferences.levels || {}).length) teams.preferences = null;
  }
  delete teams.lockedStudents[studentId];
  [REL_TOGETHER, REL_SEPARATE].forEach(type => {
    teams.constraints[type].forEach(set => { set.students = set.students.filter(id => id !== studentId); });
    teams.constraints[type] = teams.constraints[type].filter(set => set.students.length > 0);
  });
  if (teams.groups) teams.groups = teams.groups.map(g => g.filter(id => id !== studentId));
  teams.saved.forEach(saved => { saved.groups = saved.groups.map(g => g.filter(id => id !== studentId)); });
  teams.layout = A.normalizeTeamLayout(teams.layout, new Set((teams.groups || []).flat()));
  teams.saved.forEach(saved => { saved.layout = A.normalizeTeamLayout(saved.layout, new Set(saved.groups.flat())); });
}

/* ── Planificació de mides ───────────────────────────── */

/**
 * Mides objectiu de cada equip segons la configuració.
 * @returns {{total:number, size:number, remainder:number, sizes:number[]}}
 */
function teamPlan() {
  const teams = A.getTeams();
  const total = teamStudents().length;
  const size = Math.max(1, Math.min(teams.studentsPerGroup || 1, Math.max(1, total)));
  if (!total) return { total: 0, size, remainder: 0, sizes: [] };

  const perfect = Math.floor(total / size);
  const remainder = total % size;
  if (!perfect) return { total, size, remainder, sizes: [total] };
  if (!remainder) return { total, size, remainder, sizes: Array(perfect).fill(size) };

  if (teams.remainderMode === 'newGroup') {
    return { total, size, remainder, sizes: [...Array(perfect).fill(size), remainder] };
  }
  if (teams.remainderMode === 'distribute') {
    const base = Math.floor(total / perfect);
    const extra = total % perfect;
    return { total, size, remainder, sizes: Array.from({ length: perfect }, (_, i) => base + (i < extra ? 1 : 0)) };
  }
  return { total, size, remainder, sizes: [] }; // cal triar què fer amb els sobrants
}

/* ── Restriccions ────────────────────────────────────── */

/** Uneix els conjunts d'"ajuntar" que comparteixen alumnes. */
function unifiedTogetherSets() {
  const sets = A.getTeams().constraints.together.map(set => new Set(set.students));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < sets.length && !merged; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        if ([...sets[j]].some(id => sets[i].has(id))) {
          sets[j].forEach(id => sets[i].add(id));
          sets.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  return sets.map(set => [...set]);
}

/** Contradiccions entre conjunts d'ajuntar i de separar. */
function teamContradictions() {
  const teams = A.getTeams();
  const unified = unifiedTogetherSets();
  const conflicts = [];
  unified.forEach(group => {
    teams.constraints.separate.forEach(set => {
      const shared = set.students.filter(id => group.includes(id));
      if (shared.length > 1) conflicts.push(shared);
    });
  });
  return conflicts;
}

/** Motius pels quals no es pot repartir; llista buida vol dir que tot és correcte. */
function teamValidationErrors() {
  const teams = A.getTeams();
  const plan = teamPlan();
  const errors = [];

  if (plan.total < 2) errors.push('Calen com a mínim dos alumnes.');
  if (plan.total && plan.remainder > 0 && !teams.remainderMode) {
    errors.push(`Sobren ${pluralize(plan.remainder, 'alumne')}: tria si vols un equip nou o repartir-los.`);
  }
  if (plan.sizes.length) {
    const maxSize = Math.max(...plan.sizes);
    unifiedTogetherSets().forEach(group => {
      if (group.length > maxSize) {
        errors.push(`El conjunt d'ajuntar amb ${group.map(A.studentName).join(', ')} té ${group.length} alumnes i l'equip més gran en té ${maxSize}.`);
      }
    });
    teams.constraints.separate.forEach(set => {
      if (set.students.length > plan.sizes.length) {
        errors.push(`Un conjunt de separar té ${pluralize(set.students.length, 'alumne')} i només hi ha ${pluralize(plan.sizes.length, 'equip')}.`);
      }
    });
  }
  teamContradictions().forEach(shared => {
    errors.push(`${shared.map(A.studentName).join(' i ')} han d'estar separats però algun conjunt d'ajuntar els uneix.`);
  });
  return errors;
}

/* ── Formació d'equips ───────────────────────────────── */

/**
 * Reparteix els alumnes en equips.
 * @param {number[]} sizes mida objectiu de cada equip
 * @param {{[teamIndex:number]: string[]}} lockedGroups alumnes que ja tenen equip
 * @param {boolean} strict si és fals, s'ignoren els conjunts de separar impossibles
 * @returns {string[][]|null}
 */
function buildTeams(sizes, lockedGroups, strict = true) {
  const teams = A.getTeams();
  const hetero = teams.heterogeneous && teams.useCompetency;
  const groups = sizes.map(() => []);
  const capacity = sizes.slice();
  const fullyLocked = new Set();
  const placed = new Set();

  // 1. Equips i alumnes bloquejats: mantenen el seu índex sempre que es pugui.
  const lockedEntries = Object.entries(lockedGroups).sort((a, b) => b[1].length - a[1].length);
  for (const [rawIndex, members] of lockedEntries) {
    const preferred = parseInt(rawIndex, 10);
    let target = (preferred < groups.length && !groups[preferred].length) ? preferred : -1;
    if (target === -1) target = groups.findIndex(g => !g.length);
    if (target === -1) return null;
    groups[target].push(...members);
    capacity[target] = Math.max(capacity[target], members.length);
    members.forEach(id => placed.add(id));
    if (teams.lockedTeams[preferred]) fullyLocked.add(target);
  }

  const canPlace = (group, students) => {
    if (!strict) return true;
    return !teams.constraints.separate.some(set =>
      students.some(id => set.students.includes(id)) && group.some(id => set.students.includes(id)));
  };

  // 2. Conjunts d'ajuntar (els més grans primer).
  const unified = unifiedTogetherSets()
    .map(group => group.filter(id => !placed.has(id)))
    .filter(group => group.length)
    .sort((a, b) => b.length - a.length);
  for (const group of unified) {
    const order = A.shuffleArray(groups.map((_, i) => i))
      .filter(i => !fullyLocked.has(i))
      .sort((a, b) => (capacity[b] - groups[b].length) - (capacity[a] - groups[a].length));
    const target = order.find(i => groups[i].length + group.length <= capacity[i] && canPlace(groups[i], group));
    if (target === undefined) return null;
    groups[target].push(...group);
    group.forEach(id => placed.add(id));
  }

  // 3. Resta d'alumnes.
  let remaining = teamStudents().map(s => s.id).filter(id => !placed.has(id));
  if (hetero) {
    remaining.sort((a, b) => competencyOf(b) - competencyOf(a));
    const third = Math.ceil(remaining.length / 3);
    const levels = [remaining.slice(0, third), remaining.slice(third, third * 2), remaining.slice(third * 2)];
    while (levels.some(level => level.length)) {
      for (const level of A.shuffleArray([0, 1, 2])) {
        if (!levels[level].length) continue;
        const pick = Math.floor(Math.random() * levels[level].length);
        const studentId = levels[level][pick];
        const target = pickBalancedGroup(groups, capacity, fullyLocked, studentId, canPlace);
        if (target === -1) return null;
        groups[target].push(studentId);
        levels[level].splice(pick, 1);
      }
    }
  } else {
    // Els alumnes amb restriccions de separar es col·loquen primer: si es
    // deixessin per al final podrien quedar-se sense cap equip vàlid.
    const constrained = new Set(teams.constraints.separate.flatMap(set => set.students));
    remaining = [
      ...A.shuffleArray(remaining.filter(id => constrained.has(id))),
      ...A.shuffleArray(remaining.filter(id => !constrained.has(id)))
    ];
    for (const studentId of remaining) {
      const target = pickRoomiestGroup(groups, capacity, fullyLocked, studentId, canPlace);
      if (target === -1) return null;
      groups[target].push(studentId);
    }
  }
  return groups;
}

/** Equip vàlid amb més llocs lliures (reparteix i evita carrerons sense sortida). */
function pickRoomiestGroup(groups, capacity, fullyLocked, studentId, canPlace) {
  let best = -1;
  let bestRoom = -1;
  for (let i = 0; i < groups.length; i++) {
    if (fullyLocked.has(i)) continue;
    const room = capacity[i] - groups[i].length;
    if (room <= 0 || room <= bestRoom) continue;
    if (!canPlace(groups[i], [studentId])) continue;
    best = i;
    bestRoom = room;
  }
  return best;
}

/** Equip on encaixa millor l'alumne per equilibrar els nivells. */
function pickBalancedGroup(groups, capacity, fullyLocked, studentId, canPlace) {
  const globalMean = teamStudents().reduce((sum, s) => sum + competencyOf(s.id), 0) / Math.max(1, teamStudents().length);
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < groups.length; i++) {
    if (fullyLocked.has(i) || groups[i].length >= capacity[i]) continue;
    if (!canPlace(groups[i], [studentId])) continue;
    const score = Math.abs(groupMean([...groups[i], studentId]) - globalMean);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/** Variància entre els nivells mitjans dels equips (com més baixa, més homogènia la barreja). */
function heteroScore(groups) {
  if (groups.length < 2) return 0;
  const means = groups.map(groupMean);
  const average = means.reduce((sum, m) => sum + m, 0) / means.length;
  return means.reduce((sum, m) => sum + (m - average) ** 2, 0) / means.length;
}

/** Millora l'equilibri de nivells intercanviant alumnes sense trencar restriccions. */
function refineTeamsBySwap(groups, lockedIds) {
  let improved = true;
  let rounds = 0;
  while (improved && rounds < 40) {
    improved = false;
    rounds++;
    const current = heteroScore(groups);
    for (let gi = 0; gi < groups.length && !improved; gi++) {
      for (let gj = gi + 1; gj < groups.length && !improved; gj++) {
        for (let si = 0; si < groups[gi].length && !improved; si++) {
          if (lockedIds.has(groups[gi][si])) continue;
          for (let sj = 0; sj < groups[gj].length; sj++) {
            if (lockedIds.has(groups[gj][sj])) continue;
            const a = groups[gi][si], b = groups[gj][sj];
            groups[gi][si] = b; groups[gj][sj] = a;
            const violations = teamViolations(groups);
            const broken = violations.some(v => v.together.length || v.separate.length);
            if (!broken && heteroScore(groups) < current - 0.0001) { improved = true; break; }
            groups[gi][si] = a; groups[gj][sj] = b;
          }
        }
      }
    }
  }
}

/** Alumnes bloquejats agrupats per equip. */
function lockedTeamGroups() {
  const teams = A.getTeams();
  const result = {};
  if (!teams.groups) return result;
  Object.keys(teams.lockedTeams).forEach(index => {
    const i = parseInt(index, 10);
    if (teams.groups[i]?.length) result[i] = [...teams.groups[i]];
  });
  Object.entries(teams.lockedStudents).forEach(([studentId, index]) => {
    if (Object.values(result).some(group => group.includes(studentId))) return;
    (result[index] = result[index] || []).push(studentId);
  });
  return result;
}

function createTeams() {
  const errors = teamValidationErrors();
  if (errors.length) { toast(errors[0], 'error'); return; }
  if (teamsHaveUnsavedChanges()) { guardUnsavedTeams(() => doCreateTeams()); return; }
  doCreateTeams();
}

/**
 * Equips a partir del full de preferències carregat: les tries, les
 * separacions, la composició del grup i el criteri d'èxit que el docent hi va
 * triar es mantenen, i s'hi sumen els conjunts d'ajuntar i separar del panell,
 * els nivells de competència i els cadenats.
 *
 * @returns {string[][]|null}
 */
function buildTeamsFromPreferences(sizes, locked) {
  const teams = A.getTeams();
  const stored = teams.preferences;
  if (!stored || !sizes.length || !A.optimizePreferenceGroups) return null;

  // Cada equip bloquejat conserva el seu índex mentre hi càpiga dins del pla.
  const fixed = {};
  const used = new Set();
  Object.entries(locked).forEach(([rawIndex, members]) => {
    const preferred = parseInt(rawIndex, 10);
    let target = preferred < sizes.length && !used.has(preferred) ? preferred : -1;
    if (target === -1) target = sizes.findIndex((_, index) => !used.has(index));
    if (target === -1) return;
    used.add(target);
    members.forEach(id => { fixed[id] = target; });
  });

  const result = A.optimizePreferenceGroups({
    ids: teamStudents().map(student => student.id),
    sizes,
    prefs: stored.prefs,
    avoid: stored.avoid,
    ranked: stored.ranked,
    attributes: stored.attributes,
    balance: stored.balance,
    criterion: stored.criterion,
    levels: teams.useCompetency && teams.heterogeneous ? teams.competencies : null,
    constraints: teams.constraints,
    fixed,
    seed: Math.floor(Math.random() * 1e9) + 1
  });
  const groups = result.groups.filter(group => group.length);
  return groups.length ? groups : null;
}

function doCreateTeams() {
  const teams = A.getTeams();
  const plan = teamPlan();
  const locked = lockedTeamGroups();
  const lockedIds = new Set(Object.values(locked).flat());
  const hetero = teams.heterogeneous && teams.useCompetency;
  const fromPreferences = !!teams.preferences;

  let best = fromPreferences ? buildTeamsFromPreferences(plan.sizes, locked) : null;
  let bestScore = Infinity;
  if (!fromPreferences) {
    for (let attempt = 0; attempt < TEAM_ATTEMPTS; attempt++) {
      const candidate = buildTeams(plan.sizes, locked, true);
      if (!candidate) continue;
      if (!hetero) { best = candidate; break; }
      const score = heteroScore(candidate);
      if (score < bestScore) { bestScore = score; best = candidate; }
      if (score <= TEAM_HETERO_TARGET) break;
    }
  }

  let relaxed = false;
  if (!best) {
    best = buildTeams(plan.sizes, locked, false);
    relaxed = true;
  }
  if (!best) { toast('No s\'han pogut formar equips amb aquesta configuració', 'error'); return; }
  if (hetero && !fromPreferences) refineTeamsBySwap(best, lockedIds);

  A.saveWithUndo();
  // Els cadenats es reasignen als índexs nous.
  const newLockedTeams = {};
  const newLockedStudents = {};
  Object.entries(locked).forEach(([oldIndex, members]) => {
    const newIndex = best.findIndex(group => members.every(id => group.includes(id)));
    if (newIndex === -1) return;
    if (teams.lockedTeams[oldIndex]) newLockedTeams[newIndex] = true;
    members.forEach(id => { newLockedStudents[id] = newIndex; });
  });

  teams.groups = best;
  teams.lockedTeams = newLockedTeams;
  teams.lockedStudents = newLockedStudents;
  teams.teamNames = {};
  teams.positions = {};
  teams.layout = null;
  teams.activeSaved = null;
  A.arrangeTeamDesks();
  A.saveState();

  if (A.view.current !== 'equips') A.switchCanvasView('equips');
  A.clearTableSelection();
  A.renderLayoutOptions();
  A.renderStudentList();
  A.updateCounts();
  renderTeamsPanel();
  A.renderTeamsCanvas();
  A.updateActiveTeamBadge();
  setTimeout(() => A.zoomReset(), 50);

  if (relaxed) { toast('Equips formats, però alguna restricció de separar no s\'ha pogut complir', 'info'); return; }
  // Amb un full carregat es diu de seguida com ha anat el criteri que s'hi va triar.
  const stats = fromPreferences
    ? A.preferenceStats(teams.groups, teams.preferences.prefs, A.preferenceStatsOptions(teams.preferences))
    : null;
  const headline = stats ? A.criteriaList(stats).find(row => row.main) : null;
  toast(`Equips formats${headline && headline.pct !== null ? ` · ${headline.pct}% · ${headline.label.toLowerCase()}` : ''}${lockedIds.size ? ` (${lockedIds.size} fixats)` : ''}`, 'success');
}

/** Incompliments per equip. */
function teamViolations(groups) {
  const teams = A.getTeams();
  return groups.map(group => {
    const together = [];
    const separate = [];
    teams.constraints.together.forEach(set => {
      const inside = set.students.filter(id => group.includes(id));
      if (inside.length && inside.length !== set.students.length) together.push(...set.students);
    });
    teams.constraints.separate.forEach(set => {
      const inside = set.students.filter(id => group.includes(id));
      if (inside.length > 1) separate.push(...inside);
    });
    return { together: [...new Set(together)], separate: [...new Set(separate)] };
  });
}

/* ── Panell d'equips ─────────────────────────────────── */

function renderTeamsPanel() {
  const teams = A.getTeams();
  const plan = teamPlan();

  el('teamSize').value = teams.studentsPerGroup;
  el('teamSize').max = Math.max(1, plan.total);
  el('teamCount').value = plan.sizes.length;
  el('teamUseCompetency').checked = teams.useCompetency;
  el('teamHeterogeneous').checked = teams.heterogeneous;
  el('teamHeterogeneous').disabled = !teams.useCompetency;
  el('teamCompetencySection').style.display = teams.useCompetency ? 'block' : 'none';

  // Sobrants
  const remainderBox = el('teamRemainderOption');
  if (plan.total && plan.remainder > 0) {
    remainderBox.style.display = 'block';
    remainderBox.innerHTML = `<div class="equips-remaining">
        <span class="mi mi-xs">info</span> Sobren <b>${plan.remainder}</b> ${plan.remainder === 1 ? 'alumne' : 'alumnes'}.
        <div class="equips-remaining-btns">
          <button class="btn btn-sm ${teams.remainderMode === 'newGroup' ? 'selected-opt' : ''}" data-action="setRemainderMode" data-value="newGroup">Equip nou</button>
          <button class="btn btn-sm ${teams.remainderMode === 'distribute' ? 'selected-opt' : ''}" data-action="setRemainderMode" data-value="distribute">Repartir</button>
        </div>
      </div>`;
  } else {
    remainderBox.style.display = 'none';
  }

  renderCompetencyTable();
  renderTeamConstraints();
  if (A.renderPreferencePanel) A.renderPreferencePanel();

  const errors = teamValidationErrors();
  const warning = el('teamWarning');
  if (errors.length) {
    warning.style.display = 'block';
    warning.innerHTML = '<span class="mi mi-xs">warning</span> ' + errors.map(esc).join('<br>');
  } else {
    warning.style.display = 'none';
  }
  el('teamCreateBtn').disabled = errors.length > 0;
  A.updateFabTeamsButton();

  if (teams.groups?.length) renderTeamsSidebar(teams.groups);
  else { el('teamResults').innerHTML = ''; el('teamExportRow').style.display = 'none'; }
  renderSavedTeams();
}

function setTeamSize(value) {
  const teams = A.getTeams();
  const total = teamStudents().length;
  teams.studentsPerGroup = Math.max(1, Math.min(parseInt(value, 10) || 1, Math.max(1, total)));
  if (total % teams.studentsPerGroup === 0) teams.remainderMode = null;
  A.saveState();
  renderTeamsPanel();
}

function setRemainderMode(mode) {
  const teams = A.getTeams();
  teams.remainderMode = teams.remainderMode === mode ? null : mode;
  A.saveState();
  renderTeamsPanel();
}

function toggleUseCompetency() {
  const teams = A.getTeams();
  teams.useCompetency = el('teamUseCompetency').checked;
  if (!teams.useCompetency) teams.heterogeneous = false;
  A.saveState();
  renderTeamsPanel();
  if (teams.groups?.length) A.renderTeamsCanvas();
}

function toggleHeterogeneous() {
  const teams = A.getTeams();
  teams.heterogeneous = el('teamHeterogeneous').checked;
  A.saveState();
}

function renderCompetencyTable() {
  const teams = A.getTeams();
  if (!teams.useCompetency) { el('teamCompetencyBody').innerHTML = ''; return; }
  el('teamCompetencyBody').innerHTML = teamStudents().map(s => `
    <tr><td>${esc(s.name)}</td>
      <td><input type="number" min="0" max="10" step="0.5" value="${competencyOf(s.id)}"
                 data-change="setCompetency" data-sid="${esc(s.id)}"></td></tr>`).join('');
}

function setCompetency(studentId, value) {
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return;
  const teams = A.getTeams();
  teams.competencies[studentId] = Math.max(0, Math.min(10, parsed));
  A.saveState();
  if (teams.groups?.length) { renderTeamsSidebar(teams.groups); A.renderTeamsCanvas(); }
}

/* ── Conjunts de restriccions d'equips ───────────────── */

function renderTeamConstraints() {
  const teams = A.getTeams();
  const students = teamStudents();
  const contradictions = new Set(teamContradictions().flat());

  [REL_TOGETHER, REL_SEPARATE].forEach(type => {
    const container = el(type === REL_TOGETHER ? 'teamTogetherSets' : 'teamSeparateSets');
    const sets = teams.constraints[type];
    container.innerHTML = sets.length ? sets.map((set, index) => {
      const flagged = set.students.some(id => contradictions.has(id));
      const options = students.filter(s => !set.students.includes(s.id))
        .map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
      const tags = set.students.length
        ? set.students.map(id => `<span class="cset-tag">${esc(A.studentName(id))}<button title="Treure" data-action="teamRemoveStudentFromSet" data-type="${esc(type)}" data-set="${esc(set.id)}" data-sid="${esc(id)}">&times;</button></span>`).join('')
        : '<span class="cset-empty">Encara sense alumnes</span>';
      return `<div class="cset ${flagged ? 'incompatible' : ''}">
        <div class="cset-header">
          <span class="cset-name">${REL_LABEL[type]} ${index + 1}</span>
          <button class="btn btn-sm btn-danger" style="padding:2px 5px" title="Eliminar conjunt" data-action="teamRemoveSet" data-type="${esc(type)}" data-set="${esc(set.id)}"><span class="mi mi-xs">close</span></button>
        </div>
        <select data-change="teamAddStudentToSet" data-type="${esc(type)}" data-set="${esc(set.id)}">
          <option value="">Afegir alumne...</option>${options}
        </select>
        <div class="cset-actions">
          <button class="btn btn-sm" data-action="teamAddMultiple" data-type="${esc(type)}" data-set="${esc(set.id)}"><span class="mi mi-xs">checklist</span> Diversos</button>
        </div>
        <div class="cset-tags">${tags}</div>
      </div>`;
    }).join('') : '<div class="cset-empty">Cap conjunt</div>';
  });
}

function teamAddSet(type) {
  const teams = A.getTeams();
  A.saveWithUndo();
  teams.constraints[type].push({ id: uid(type), students: [] });
  A.saveState();
  renderTeamsPanel();
}

function teamRemoveSet(type, setId) {
  const teams = A.getTeams();
  A.saveWithUndo();
  teams.constraints[type] = teams.constraints[type].filter(set => set.id !== setId);
  A.saveState();
  renderTeamsPanel();
}

function teamAddStudentToSet(type, setId, studentId) {
  if (!studentId) return;
  const set = A.getTeams().constraints[type].find(s => s.id === setId);
  if (!set || set.students.includes(studentId)) return;
  A.saveWithUndo();
  set.students.push(studentId);
  A.saveState();
  renderTeamsPanel();
}

function teamRemoveStudentFromSet(type, setId, studentId) {
  const set = A.getTeams().constraints[type].find(s => s.id === setId);
  if (!set) return;
  A.saveWithUndo();
  set.students = set.students.filter(id => id !== studentId);
  A.saveState();
  renderTeamsPanel();
}

/** Tria diversos alumnes de cop per a un conjunt d'equips. */
function teamAddMultiple(type, setId) {
  const set = A.getTeams().constraints[type].find(s => s.id === setId);
  if (!set) return;
  const students = teamStudents();
  if (!students.length) { toast('Afegeix alumnes primer', 'error'); return; }
  A.openStudentPicker({
    title: `${REL_LABEL[type]} — triar alumnes`,
    students,
    preselected: set.students,
    confirmLabel: 'Aplicar',
    onConfirm: ids => {
      A.saveWithUndo();
      set.students = students.filter(s => ids.includes(s.id)).map(s => s.id);
      A.saveState();
      renderTeamsPanel();
    }
  });
}

/** Copia els conjunts del panell Relacions a les restriccions d'equips. */
function copyRelationsToTeams() {
  const data = A.getData();
  if (!data.relations.length) { toast('No hi ha relacions definides', 'error'); return; }
  const teams = A.getTeams();
  A.saveWithUndo();
  let added = 0, skipped = 0;
  data.relations.forEach(rel => {
    if (rel.students.length < 2) return;
    const signature = [...rel.students].sort().join('|');
    const exists = teams.constraints[rel.type].some(set => [...set.students].sort().join('|') === signature);
    if (exists) { skipped++; return; }
    teams.constraints[rel.type].push({ id: uid(rel.type), students: [...rel.students] });
    added++;
  });
  A.saveState();
  renderTeamsPanel();
  if (added) toast(`${pluralize(added, 'conjunt', 'conjunts')} ${added === 1 ? 'copiat' : 'copiats'}${skipped ? ` (${skipped} ja hi eren)` : ''}`, 'success');
  else toast('Tots els conjunts ja hi eren', 'info');
}

/* ── Resultats al panell lateral ─────────────────────── */

function renderTeamsSidebar(groups) {
  const teams = A.getTeams();
  const showCompetency = teams.useCompetency;
  // Indicadors de preferències: nuls mentre no s'hagi importat cap formulari.
  const prefView = A.preferenceTeamView ? A.preferenceTeamView(groups) : null;
  const violations = teamViolations(groups);
  const lockedTeamCount = Object.keys(teams.lockedTeams).length;
  const lockedStudentCount = Object.keys(teams.lockedStudents).length;

  const lockInfo = (lockedTeamCount || lockedStudentCount)
    ? `<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--orange-bg);border:1px solid var(--orange);border-radius:var(--radius-sm);margin-bottom:8px;font-size:11px;color:var(--orange)">
        <span class="mi mi-sm">lock</span>
        ${[lockedTeamCount ? `${pluralize(lockedTeamCount, 'equip')} ${lockedTeamCount === 1 ? 'bloquejat' : 'bloquejats'}` : '',
           lockedStudentCount ? `${pluralize(lockedStudentCount, 'alumne')} ${lockedStudentCount === 1 ? 'fixat' : 'fixats'}` : '']
          .filter(Boolean).join(', ')}
      </div>` : '';

  el('teamResults').innerHTML = lockInfo + (prefView ? prefView.summary : '') + groups.map((group, index) => {
    const violation = violations[index];
    const hasWarning = violation.together.length || violation.separate.length;
    const isLocked = !!teams.lockedTeams[index];
    let violationHtml = '';
    if (violation.together.length) {
      const inside = violation.together.filter(id => group.includes(id)).map(A.studentName);
      const outside = violation.together.filter(id => !group.includes(id)).map(A.studentName);
      violationHtml += `<div class="eq-violation"><span class="mi">warning</span> Haurien d'anar junts: ${esc(inside.join(', '))} amb ${esc(outside.join(', '))}</div>`;
    }
    if (violation.separate.length) {
      violationHtml += `<div class="eq-violation"><span class="mi">warning</span> Haurien d'anar separats: ${esc(violation.separate.map(A.studentName).join(', '))}</div>`;
    }
    const average = showCompetency ? `<div class="eq-group-avg">Nivell mitjà: ${groupMean(group).toFixed(2)}</div>` : '';

    return `<div class="eq-group-card ${hasWarning ? 'has-warnings' : ''}${isLocked ? ' team-locked' : ''}">
      <div class="eq-group-lock-row">
        <h4 style="margin-bottom:0">
          <span class="eq-team-name" data-action="renameTeam" data-idx="${index}" title="Clic per canviar el nom">${esc(teamName(index))}</span>
          <span class="eq-group-size">${pluralize(group.length, 'alumne')}</span>
          ${prefView ? prefView.group(index) : ''}
        </h4>
        <button class="eq-team-lock-btn${isLocked ? ' locked' : ''}" data-action="toggleTeamLock" data-idx="${index}" title="${isLocked ? 'Desbloquejar equip' : 'Bloquejar equip sencer'}">
          <span class="mi mi-xs">${isLocked ? 'lock' : 'lock_open'}</span>${isLocked ? ' Bloquejat' : ' Bloquejar'}
        </button>
      </div>
      ${prefView && prefView.composition ? prefView.composition(index) : ''}
      ${group.map(studentId => {
        const studentLocked = teams.lockedStudents[studentId] !== undefined;
        return `<div class="eq-group-member${studentLocked ? ' student-locked' : ''}">
          <span class="eq-member-name">${esc(A.studentName(studentId))}</span>
          ${prefView ? prefView.member(studentId) : ''}
          ${showCompetency ? `<span class="eq-member-comp">${competencyOf(studentId)}</span>` : ''}
          <button class="eq-member-lock-btn${studentLocked ? ' locked' : ''}" data-action="toggleStudentLock" data-sid="${esc(studentId)}" data-idx="${index}" title="${studentLocked ? 'Desbloquejar alumne' : 'Fixar alumne'}">
            <span class="mi" style="font-size:12px">${studentLocked ? 'lock' : 'lock_open'}</span>
          </button>
          <select data-change="moveStudentToTeam" data-sid="${esc(studentId)}"${studentLocked ? ' disabled' : ''}>
            ${groups.map((_, gi) => `<option value="${gi}" ${gi === index ? 'selected' : ''}>${esc(teamName(gi))}</option>`).join('')}
          </select>
        </div>`;
      }).join('')}
      ${violationHtml}${average}
    </div>`;
  }).join('');

  el('teamExportRow').style.display = 'flex';
}

/** Compatibilitat: mou un sol alumne a un altre equip. */
function moveStudentToTeam(studentId, fromIndex, toIndex) {
  const teams = A.getTeams();
  if (fromIndex === toIndex || !teams.groups?.[fromIndex]?.includes(studentId) || !teams.groups[toIndex]) return false;
  return moveStudentsToTeam([studentId], toIndex);
}

/** Trasllat atòmic de la selecció: un únic desfer, sense saltar cadenats. */
function moveStudentsToTeam(studentIds, toIndex) {
  const teams = A.getTeams();
  if (!teams.groups?.[toIndex]) return false;
  const ids = [...new Set(studentIds)];
  if (ids.some(id => !teams.groups.some(group => group.includes(id)))) return false;
  const moving = ids.filter(id => !teams.groups[toIndex].includes(id));
  if (!moving.length) return false;
  if (teams.lockedTeams[toIndex]) {
    toast(`${teamName(toIndex)} està bloquejat`, 'error');
    renderTeamsSidebar(teams.groups);
    return false;
  }
  if (moving.some(id => teams.lockedStudents[id] !== undefined || teams.lockedTeams[teams.groups.findIndex(group => group.includes(id))])) {
    toast('La selecció conté alumnes fixats. Desbloqueja’ls abans de moure-la.', 'error');
    renderTeamsSidebar(teams.groups);
    return false;
  }
  A.saveWithUndo();
  const movingSet = new Set(moving);
  teams.groups = teams.groups.map(group => group.filter(id => !movingSet.has(id)));
  teams.groups[toIndex].push(...moving);
  moving.forEach((id, index) => A.placeDeskWithTeam(id, toIndex, moving.slice(index)));
  A.saveState();
  A.renderLayoutOptions();
  A.renderStudentList();
  A.updateCounts();
  renderTeamsSidebar(teams.groups);
  A.renderTeamsCanvas();
  return true;
}

function startRenameTeam(index, sourceElement) {
  const teams = A.getTeams();
  const current = teamName(index);
  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.maxLength = 30;
  input.style.cssText = 'background:var(--surface2);border:1px solid var(--accent);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-weight:700;font-size:inherit;padding:1px 5px;width:100%;outline:none;';
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    const next = (value && value !== `Equip ${index + 1}`) ? value : '';
    const previous = teams.teamNames[index] || '';
    if (next !== previous) {
      A.saveWithUndo();
      if (next) teams.teamNames[index] = next; else delete teams.teamNames[index];
      A.saveState();
    }
    // El repintat s'ajorna: el camp pot perdre el focus enmig d'un altre repintat.
    setTimeout(() => {
      renderTeamsSidebar(teams.groups || []);
      A.renderTeamsCanvas();
    }, 0);
  };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    if (event.key === 'Escape') { input.value = current; input.blur(); }
  });
  input.addEventListener('blur', finish, { once: true });
  sourceElement.innerHTML = '';
  sourceElement.appendChild(input);
  input.focus();
  input.select();
}

/* ── Cadenats ────────────────────────────────────────── */

function toggleTeamLock(index) {
  const teams = A.getTeams();
  A.saveWithUndo();
  if (teams.lockedTeams[index]) {
    delete teams.lockedTeams[index];
    (teams.groups?.[index] || []).forEach(id => { delete teams.lockedStudents[id]; });
  } else {
    teams.lockedTeams[index] = true;
    (teams.groups?.[index] || []).forEach(id => { teams.lockedStudents[id] = index; });
  }
  A.saveState();
  renderTeamsSidebar(teams.groups || []);
  A.renderTeamsCanvas();
}

function toggleStudentLock(studentId, index) {
  const teams = A.getTeams();
  A.saveWithUndo();
  if (teams.lockedStudents[studentId] !== undefined) {
    delete teams.lockedStudents[studentId];
    delete teams.lockedTeams[index];
  } else {
    teams.lockedStudents[studentId] = index;
    const group = teams.groups?.[index] || [];
    if (group.length && group.every(id => teams.lockedStudents[id] !== undefined)) teams.lockedTeams[index] = true;
  }
  A.saveState();
  renderTeamsSidebar(teams.groups || []);
  A.renderTeamsCanvas();
}

/* ── Equips desats ───────────────────────────────────── */

function teamsHaveUnsavedChanges() {
  const teams = A.getTeams();
  if (teams.activeSaved === null || !teams.saved[teams.activeSaved]) return false;
  if (!teams.groups?.length) return false;
  const saved = teams.saved[teams.activeSaved];
  if (saved.groups.length !== teams.groups.length) return true;
  for (let i = 0; i < saved.groups.length; i++) {
    const a = [...saved.groups[i]].sort().join('|');
    const b = [...teams.groups[i]].sort().join('|');
    if (a !== b) return true;
  }
  const savedNames = saved.teamNames || {};
  return teams.groups.some((_, i) => (teams.teamNames[i] || '') !== (savedNames[i] || '')) ||
    (!!saved.layout && JSON.stringify(saved.layout) !== JSON.stringify(teams.layout));
}

let _pendingGuard = null;

function guardUnsavedTeams(onContinue) {
  if (!teamsHaveUnsavedChanges()) { onContinue(); return; }
  const teams = A.getTeams();
  const name = teams.saved[teams.activeSaved].name;
  _pendingGuard = { onContinue, name };
  openModal(`<h3><span class="mi" style="color:var(--orange)">warning</span> Canvis sense desar</h3>
    <p class="modal-note">Has modificat <strong>"${esc(name)}"</strong>. Si continues, els canvis es perdran.</p>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn" data-action="guardContinue"><span class="mi mi-xs">forward</span> Continuar sense desar</button>
      <button class="btn btn-primary" data-action="guardSave"><span class="mi mi-xs">save</span> Desar i continuar</button>
    </div>`);
}

function formattedNow() {
  const now = new Date();
  return `${now.toLocaleDateString('ca-ES')} ${now.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Bolca els equips actuals dins d'un registre desat. */
function writeSavedTeam(target, name) {
  const teams = A.getTeams();
  target.name = name;
  target.date = formattedNow();
  target.groups = teams.groups.map(group => [...group]);
  target.teamNames = { ...teams.teamNames };
  target.competencies = teams.useCompetency ? { ...teams.competencies } : null;
  target.layout = JSON.parse(JSON.stringify(A.getTeamLayout()));
}

function saveCurrentTeam() {
  const teams = A.getTeams();
  if (!teams.groups?.length) { toast('No hi ha equips per desar', 'error'); return; }
  const active = teams.activeSaved !== null ? teams.saved[teams.activeSaved] : null;
  const defaultName = active ? active.name : `Equips ${teams.saved.length + 1}`;
  const buttons = active
    ? `<button class="btn" data-action="closeModal">Cancel·lar</button>
       <button class="btn" data-action="doSaveTeam" data-value="overwrite"><span class="mi mi-xs">sync</span> Sobreescriure</button>
       <button class="btn btn-primary" data-action="doSaveTeam" data-value="new"><span class="mi mi-xs">add</span> Desar nou</button>`
    : `<button class="btn" data-action="closeModal">Cancel·lar</button>
       <button class="btn btn-primary" data-action="doSaveTeam" data-value="new"><span class="mi mi-xs">save</span> Desar</button>`;
  openModal(`<h3><span class="mi">save</span> Desar equips</h3>
    <div class="field"><label>Nom</label><input type="text" id="saveTeamName" value="${esc(defaultName)}"></div>
    ${active ? `<p class="modal-note">Tens carregat <strong>"${esc(active.name)}"</strong>.</p>` : ''}
    <div class="modal-footer">${buttons}</div>`);
  focusModalField('saveTeamName');
}

let _pendingSaveName = '';

function doSaveTeam(mode) {
  const name = (el('saveTeamName')?.value || '').trim();
  if (!name) { toast('Cal un nom', 'error'); return; }
  const teams = A.getTeams();

  if (mode === 'overwrite' && teams.activeSaved !== null && teams.saved[teams.activeSaved]) {
    A.saveWithUndo();
    writeSavedTeam(teams.saved[teams.activeSaved], name);
  } else {
    const duplicate = teams.saved.findIndex((t, i) => t.name.toLowerCase() === name.toLowerCase() && i !== teams.activeSaved);
    if (duplicate !== -1) {
      _pendingSaveName = name;
      closeModal();
      openModal(`<h3><span class="mi">warning</span> Nom repetit</h3>
        <p class="modal-note">Ja hi ha uns equips anomenats <strong>"${esc(teams.saved[duplicate].name)}"</strong>.</p>
        <div class="modal-footer">
          <button class="btn" data-action="closeModal">Cancel·lar</button>
          <button class="btn" data-action="overwriteSavedTeam" data-idx="${duplicate}"><span class="mi mi-xs">sync</span> Sobreescriure</button>
          <button class="btn btn-primary" data-action="appendSavedTeam"><span class="mi mi-xs">add</span> Desar com a nou</button>
        </div>`);
      return;
    }
    A.saveWithUndo();
    appendRecord(name);
  }
  A.saveState();
  closeModal();
  renderSavedTeams();
  A.updateActiveTeamBadge();
  toast(`"${name}" desat`, 'success');
}

function appendRecord(name) {
  const teams = A.getTeams();
  const record = { id: uid('team'), name, date: '', groups: [], teamNames: {}, competencies: null };
  writeSavedTeam(record, name);
  teams.saved.push(record);
  teams.activeSaved = teams.saved.length - 1;
}

function overwriteSavedTeam(index) {
  const teams = A.getTeams();
  const name = _pendingSaveName;
  A.saveWithUndo();
  writeSavedTeam(teams.saved[index], name);
  teams.activeSaved = index;
  A.saveState();
  closeModal();
  renderSavedTeams();
  A.updateActiveTeamBadge();
  toast(`"${name}" sobreescrit`, 'success');
}

function appendSavedTeam(name = _pendingSaveName) {
  A.saveWithUndo();
  appendRecord(name);
  A.saveState();
  closeModal();
  renderSavedTeams();
  A.updateActiveTeamBadge();
  toast(`"${name}" desat`, 'success');
}

function renderSavedTeams() {
  const teams = A.getTeams();
  const strip = el('savedTeamsStrip');
  if (!teams.saved.length) { strip.style.display = 'none'; return; }
  strip.style.display = 'block';
  el('savedTeamsScroll').innerHTML = teams.saved.map((saved, index) => {
    const students = saved.groups.reduce((sum, group) => sum + group.length, 0);
    return `<div class="eq-saved-card${index === teams.activeSaved ? ' active' : ''}" data-action="loadSavedTeam" data-idx="${index}" title="${esc(saved.date)}">
      <div class="eq-saved-card-actions"><button title="Eliminar" data-action="deleteSavedTeam" data-idx="${index}"><span class="mi mi-xs">close</span></button></div>
      <div class="eq-saved-card-name"><span class="mi mi-xs" style="flex-shrink:0;color:var(--accent)">groups</span><span>${esc(saved.name)}</span></div>
      <div class="eq-saved-card-meta">${pluralize(saved.groups.length, 'equip')} · ${pluralize(students, 'alumne')}<br>${esc(saved.date)}</div>
    </div>`;
  }).join('');
}

function loadSavedTeam(index) {
  const teams = A.getTeams();
  if (index === teams.activeSaved) return;
  guardUnsavedTeams(() => {
    A.saveWithUndo();
    const saved = teams.saved[index];
    const validIds = new Set(teamStudents().map(s => s.id));
    teams.groups = saved.groups.map(group => group.filter(id => validIds.has(id)));
    if (saved.competencies) Object.assign(teams.competencies, saved.competencies);
    teams.teamNames = { ...(saved.teamNames || {}) };
    teams.lockedTeams = {};
    teams.lockedStudents = {};
    teams.positions = {};
    teams.activeSaved = index;
    teams.layout = saved.layout ? JSON.parse(JSON.stringify(saved.layout)) : null;
    if (!teams.layout) {
      A.arrangeTeamDesks();
      saved.layout = JSON.parse(JSON.stringify(teams.layout));
    }
    A.saveState();
    A.clearTableSelection();
    A.renderLayoutOptions();
    A.renderStudentList();
    A.updateCounts();
    renderTeamsPanel();
    A.renderTeamsCanvas();
    A.updateActiveTeamBadge();
    if (A.view.current === 'equips') setTimeout(() => A.zoomReset(), 50);
    toast(`"${saved.name}" carregat`, 'info');
  });
}

function deleteSavedTeam(index) {
  const teams = A.getTeams();
  const name = teams.saved[index].name;
  appConfirm(`Eliminar "${name}"?`, 'Aquests equips desats es perdran.', () => {
    A.saveWithUndo();
    teams.saved.splice(index, 1);
    if (teams.activeSaved === index) teams.activeSaved = null;
    else if (teams.activeSaved !== null && teams.activeSaved > index) teams.activeSaved--;
    A.saveState();
    renderSavedTeams();
    A.updateActiveTeamBadge();
    toast(`"${name}" eliminat`, 'info');
  });
}

/* ── Exportació ──────────────────────────────────────── */

/**
 * Exportació dels equips: primer es tria el format. El text pla es llegeix a
 * qualsevol pantalla i el CSV s'obre amb el full de càlcul, amb una fila per
 * alumne i els indicadors de cada criteri en columnes.
 */
function exportTeams() {
  const teams = A.getTeams();
  if (!teams.groups?.length) return;
  const hasPreferences = !!teams.preferences;
  openModal(`<h3><span class="mi">download</span> Exportar equips</h3>
    <p class="modal-note">Tria el format. El <b>text</b> és la llista dels equips per llegir o imprimir;
      el <b>CSV</b> porta una fila per alumne${hasPreferences
        ? ", amb les preferències acomplertes, les separacions i les dades de composició que s'hagin carregat"
        : ''} i s'obre amb qualsevol full de càlcul.</p>
    ${teams.useCompetency ? `<label class="equips-toggle">
      <input type="checkbox" id="teamExportLevels" checked>
      <span>Incloure els nivells de competència</span>
    </label>` : ''}
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn" data-action="doExportTeams" data-value="txt"><span class="mi mi-xs">description</span> Text (.txt)</button>
      <button class="btn btn-primary" data-action="doExportTeams" data-value="csv"><span class="mi mi-xs">table_view</span> Full de càlcul (.csv)</button>
    </div>`);
}

/** Exporta en el format triat amb les opcions del quadre de diàleg. */
function exportTeamsAs(format) {
  const teams = A.getTeams();
  const levels = teams.useCompetency && el('teamExportLevels')?.checked !== false;
  closeModal();
  if (format === 'csv') A.exportTeamsCsv({ competency: levels });
  else doExportTeams(levels);
}

/**
 * Text pla sense filets ni requadres: alguns lectors de mòbil els pinten com a
 * caràcters estranys. L'estructura la marquen els títols, el sagnat i les línies
 * en blanc, i la marca d'ordre de bytes assegura que els accents es llegeixin bé.
 */
function doExportTeams(includeCompetency) {
  const teams = A.getTeams();
  const date = new Date().toLocaleDateString('ca-ES');
  const total = teams.groups.reduce((sum, group) => sum + group.length, 0);
  const preferences = teams.preferences;
  const stats = preferences
    ? A.preferenceStats(teams.groups, preferences.prefs, A.preferenceStatsOptions(preferences))
    : null;

  const lines = [
    'EQUIPS DE TREBALL',
    `${date} · ${pluralize(teams.groups.length, 'equip')} · ${pluralize(total, 'alumne')}`
  ];
  // Grau d'assoliment de cada criteri, el mateix que es veu al panell.
  if (stats) {
    A.criteriaList(stats).forEach(row => {
      lines.push(`${row.label}: ${row.pct === null ? '—' : row.pct + '%'} (${row.meta})`);
    });
  }
  teams.groups.forEach((group, index) => {
    const meta = [pluralize(group.length, 'alumne')];
    if (includeCompetency) meta.push(`nivell mitjà ${groupMean(group).toFixed(2)}`);
    if (stats && stats.perGroup[index].pct !== null) meta.push(`${stats.perGroup[index].pct}% de preferències`);
    (stats?.perGroup[index]?.composition || []).forEach(item => {
      if (item && item.values.length) {
        meta.push(`${item.short}: ${item.values.map(value =>
          item.flag ? String(value.count) : `${value.label} ${value.count}`).join(', ')}`);
      }
    });
    lines.push('', '', teamName(index).toUpperCase(), meta.join(' · '), '');
    group.forEach((id, position) => {
      const name = A.studentName(id);
      const marks = [];
      if (includeCompetency) marks.push(String(competencyOf(id)));
      if (stats && stats.perStudent[id]?.total) marks.push(`${stats.perStudent[id].met}/${stats.perStudent[id].total}`);
      lines.push(`   ${String(position + 1).padStart(2, ' ')}. ` +
        (marks.length ? `${name} (${marks.join(', ')})` : name));
    });
  });
  lines.push('');

  const text = '﻿' + lines.join('\r\n');
  A.downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `equips_${date.replace(/\//g, '-')}.txt`);
  toast('Equips exportats', 'success');
}

A.registerActions({
  setTeamSize: node => setTeamSize(node.value),
  setRemainderMode: node => setRemainderMode(node.dataset.value),
  toggleUseCompetency: () => toggleUseCompetency(),
  toggleHeterogeneous: () => toggleHeterogeneous(),
  setCompetency: node => setCompetency(node.dataset.sid, node.value),
  teamAddSet: node => teamAddSet(node.dataset.type),
  teamRemoveSet: node => teamRemoveSet(node.dataset.type, node.dataset.set),
  teamAddStudentToSet: node => { teamAddStudentToSet(node.dataset.type, node.dataset.set, node.value); node.value = ''; },
  teamRemoveStudentFromSet: node => teamRemoveStudentFromSet(node.dataset.type, node.dataset.set, node.dataset.sid),
  teamAddMultiple: node => teamAddMultiple(node.dataset.type, node.dataset.set),
  copyRelationsToTeams: () => copyRelationsToTeams(),
  createTeams: () => createTeams(),
  renameTeam: node => startRenameTeam(+node.dataset.idx, node),
  toggleTeamLock: node => toggleTeamLock(+node.dataset.idx),
  toggleStudentLock: node => toggleStudentLock(node.dataset.sid, +node.dataset.idx),
  moveStudentToTeam: node => moveStudentsToTeam([node.dataset.sid], parseInt(node.value, 10)),
  guardContinue: () => {
    const pending = _pendingGuard;
    _pendingGuard = null;
    closeModal();
    pending?.onContinue();
  },
  guardSave: () => {
    const pending = _pendingGuard;
    _pendingGuard = null;
    closeModal();
    if (!pending) return;
    const teams = A.getTeams();
    writeSavedTeam(teams.saved[teams.activeSaved], pending.name);
    A.saveState();
    renderSavedTeams();
    toast(`"${pending.name}" desat`, 'success');
    pending.onContinue();
  },
  saveCurrentTeam: () => saveCurrentTeam(),
  doSaveTeam: node => doSaveTeam(node.dataset.value),
  overwriteSavedTeam: node => overwriteSavedTeam(+node.dataset.idx),
  appendSavedTeam: () => appendSavedTeam(),
  loadSavedTeam: node => loadSavedTeam(+node.dataset.idx),
  deleteSavedTeam: node => deleteSavedTeam(+node.dataset.idx),
  exportTeams: () => exportTeams(),
  doExportTeams: node => exportTeamsAs(node.dataset.value)
});

Object.assign(A, {
  teamStudents, teamName, competencyOf, groupMean, teamIndexOf, removeStudentFromTeams,
  teamPlan, unifiedTogetherSets, teamContradictions, teamValidationErrors, buildTeams,
  buildTeamsFromPreferences, doCreateTeams,
  createTeams, teamViolations, renderTeamsPanel, renderTeamsSidebar, renderSavedTeams,
  moveStudentsToTeam, moveStudentToTeam, startRenameTeam, toggleTeamLock, toggleStudentLock,
  teamsHaveUnsavedChanges, guardUnsavedTeams, loadSavedTeam, appendSavedTeam, saveCurrentTeam, deleteSavedTeam,
  exportTeams, exportTeamsAs, doExportTeams
});

})(window.AulaMap);
