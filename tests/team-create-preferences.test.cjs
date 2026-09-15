const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

/**
 * El botó "Formar equips" del panell quan la configuració té un full de
 * preferències carregat: ha de mantenir les tries, les separacions, la
 * composició del grup i el criteri d'èxit, i sumar-hi el que el docent hagi
 * afegit després (conjunts, nivells i cadenats).
 */
function setup(count, preferences, options = {}) {
  const students = Array.from({ length: count }, (_, index) => ({
    id: `s${index}`, name: `Alumne ${index}`, color: '#000'
  }));
  const data = {
    students, relations: [], desks: [], assignments: {}, lockedDesks: {},
    teams: {
      groups: options.groups || null, teamNames: {}, lockedTeams: options.lockedTeams || {},
      lockedStudents: options.lockedStudents || {}, competencies: options.competencies || {},
      positions: {}, constraints: options.constraints || { together: [], separate: [] },
      saved: [], activeSaved: null, studentsPerGroup: options.size || 3, remainderMode: null,
      useCompetency: !!options.useCompetency, heterogeneous: !!options.heterogeneous,
      layout: null, preferences: preferences || null
    }
  };
  const calls = { toast: [], modals: [] };
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      nodes.set(id, { id, innerHTML: '', textContent: '', value: '', checked: false, style: {},
                      disabled: false, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
                      querySelectorAll: () => [], insertAdjacentHTML() {} });
    }
    return nodes.get(id);
  };
  const A = {
    DESK_W: 100, DESK_H: 64, REL_TOGETHER: 'together', REL_SEPARATE: 'separate',
    REL_LABEL: { together: 'Ajuntar', separate: 'Separar' }, COLORS: ['#111'],
    el: node, esc: value => String(value), uid: prefix => `${prefix}_1`, isMobile: () => false,
    pluralize: (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`,
    initialOf: name => String(name)[0],
    toast: (message, kind) => calls.toast.push([message, kind]),
    openModal: html => calls.modals.push(html), closeModal() {}, focusModalField() {}, appConfirm() {},
    openStudentPicker() {},
    // El nucli deixa el botó en espera mentre dura la feina; aquí no cal esperar.
    runBusy: (button, label, work) => work(),
    registerActions: map => Object.assign(A.actions, map), actions: {},
    shuffleArray: list => list,
    getData: () => data, getTeams: () => data.teams,
    studentName: id => students.find(student => student.id === id).name,
    saveWithUndo() {}, saveState() {}, pushUndo() {},
    centerDesks() {}, renderLayoutOptions() {}, renderStudentList() {}, updateCounts() {},
    renderDesks() {}, renderAll() {}, renderTeamsCanvas() {}, updateFabTeamsButton() {},
    updateActiveTeamBadge() {}, arrangeTeamDesks() {}, placeDeskWithTeam() {},
    endTableGesture() {}, clearTableSelection() {}, zoomReset() {}, switchCanvasView() {},
    normalizeTeamLayout: layout => layout, canvasTables: () => [],
    tableSelection: new Set(), flags: { spaceHeld: false }, view: { current: 'equips' }
  };
  const context = vm.createContext({
    window: { AulaMap: A }, console,
    document: { addEventListener() {}, querySelectorAll: () => [], createElement: () => ({ click() {} }) },
    Blob: class {}, URL: { createObjectURL: () => '', revokeObjectURL() {} }, setTimeout: () => 0
  });
  for (const name of ['exports', 'teams', 'preferences']) {
    vm.runInContext(readFileSync(path.join(root, `assets/js/${name}.js`), 'utf8'), context);
  }
  return { A, data, calls, node };
}

/** Preferències desades com les que deixa l'assistent. */
function sheet(extra = {}) {
  return {
    updated: '', source: 'full.csv', ranked: true, criterion: 'max',
    prefs: {}, avoid: {}, attributes: {}, levels: {}, levelRange: { min: null, max: null },
    balance: {}, unresolved: [], best: null, ...extra
  };
}

const teamOf = (data, id) => data.teams.groups.findIndex(group => group.includes(id));

test('forming teams from the panel keeps the choices and separations of the sheet', () => {
  const preferences = sheet({
    prefs: { s0: ['s1'], s1: ['s0'], s2: ['s3'], s3: ['s2'] },
    avoid: { s4: ['s5'] }
  });
  const { A, data } = setup(8, preferences, { size: 2 });
  A.createTeams();

  assert.equal(data.teams.groups.length, 4);
  assert.equal(teamOf(data, 's0'), teamOf(data, 's1'), 'la parella recíproca es manté');
  assert.equal(teamOf(data, 's2'), teamOf(data, 's3'));
  assert.notEqual(teamOf(data, 's4'), teamOf(data, 's5'), 'la separació demanada es respecta');
});

test('the composition of the sheet is still balanced from the panel', () => {
  const attributes = { sex: {}, group: {} };
  for (let index = 0; index < 8; index++) {
    attributes.sex[`s${index}`] = index < 4 ? 'D' : 'H';
    attributes.group[`s${index}`] = index % 2 ? 'Aire' : 'Terra';
  }
  const { A, data } = setup(8, sheet({ attributes }), { size: 2 });
  A.createTeams();

  const stats = A.preferenceStats(data.teams.groups, {}, A.preferenceStatsOptions(data.teams.preferences));
  assert.equal(stats.balance.find(entry => entry.key === 'sex').pct, 100);
  assert.equal(stats.balance.find(entry => entry.key === 'group').pct, 100);
});

test('the success criterion of the sheet survives the panel button', () => {
  // Tres alumnes es trien entre ells: amb el criteri d'una tria per alumne no
  // poden acabar tots junts.
  const preferences = sheet({
    criterion: 'spread',
    prefs: { s0: ['s1', 's2'], s1: ['s0', 's2'], s2: ['s0', 's1'],
             s3: ['s0'], s4: ['s1'], s5: ['s2'] }
  });
  const { A, data } = setup(6, preferences, { size: 2 });
  A.createTeams();

  const stats = A.preferenceStats(data.teams.groups, preferences.prefs,
    A.preferenceStatsOptions(data.teams.preferences));
  assert.equal(stats.crowded, 0, "ningú no coincideix amb més d'una de les seves tries");
  assert.equal(stats.criterion, 'spread');
});

test('constraints and locks added after the import are taken into account', () => {
  const preferences = sheet({ prefs: { s0: ['s1'], s1: ['s0'] } });
  const { A, data } = setup(8, preferences, {
    size: 2,
    groups: [['s6', 's7'], ['s0', 's2'], ['s1', 's3'], ['s4', 's5']],
    lockedTeams: { 0: true },
    constraints: { together: [{ id: 't1', students: ['s2', 's3'] }],
                   separate: [{ id: 'p1', students: ['s0', 's1'] }] }
  });
  A.createTeams();

  assert.equal(teamOf(data, 's6'), teamOf(data, 's7'), "l'equip bloquejat es manté sencer");
  assert.equal(teamOf(data, 's2'), teamOf(data, 's3'), 'el conjunt d\'ajuntar mana');
  assert.notEqual(teamOf(data, 's0'), teamOf(data, 's1'),
    'el conjunt de separar del panell pesa més que la tria recíproca del full');
});

test('a locked student stays in their team when the teams are formed again', () => {
  const { A, data } = setup(6, sheet({ prefs: { s0: ['s5'], s5: ['s0'] } }), {
    size: 2,
    groups: [['s0', 's1'], ['s2', 's3'], ['s4', 's5']],
    lockedStudents: { s0: 0, s5: 2 }
  });
  A.createTeams();
  assert.notEqual(teamOf(data, 's0'), teamOf(data, 's5'),
    'els dos fixats es queden on eren, tot i haver-se triat');
  assert.equal(Object.keys(data.teams.lockedStudents).length, 2, 'els cadenats es conserven');
});

test('the levels of the panel make the teams heterogeneous when asked', () => {
  const competencies = { s0: 10, s1: 9, s2: 8, s3: 2, s4: 1, s5: 0 };
  const { A, data } = setup(6, sheet(), {
    size: 2, competencies, useCompetency: true, heterogeneous: true
  });
  A.createTeams();

  const means = data.teams.groups.map(group =>
    group.reduce((sum, id) => sum + competencies[id], 0) / group.length);
  assert.ok(Math.max(...means) - Math.min(...means) <= 1,
    `els nivells mitjans queden igualats (${means.join(', ')})`);
});

test('without a sheet the usual team building still runs', () => {
  const { A, data } = setup(6, null, { size: 3 });
  A.createTeams();
  assert.deepEqual(Array.from(data.teams.groups, group => group.length), [3, 3]);
  assert.equal(data.teams.preferences, null);
});
