const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

/**
 * Exportació dels equips: el quadre de diàleg que tria el format i el que
 * acaba escrivint cada fitxer. Es carreguen teams.js, preferences.js i
 * exports.js junts, que és com treballen a l'aplicació.
 */
function setup() {
  const students = ['Anna Puig', 'Pau Serra', 'Nil Roca', 'Jana Ferrer']
    .map((name, index) => ({ id: `s${index}`, name, color: '#000' }));
  const data = {
    students, relations: [], desks: [], assignments: {}, lockedDesks: {},
    teams: {
      groups: [['s0', 's1'], ['s2', 's3']], teamNames: {}, lockedTeams: {}, lockedStudents: {},
      competencies: { s0: 8, s1: 4, s2: 6, s3: 2 }, positions: {},
      constraints: { together: [], separate: [] }, saved: [], activeSaved: null,
      studentsPerGroup: 2, remainderMode: null, useCompetency: true, heterogeneous: false, layout: null,
      preferences: {
        updated: '', source: 'full.csv', ranked: true, criterion: 'spread',
        prefs: { s0: ['s1'], s1: ['s0'], s2: ['s0'] }, avoid: { s3: ['s2'] },
        attributes: { group: { s0: 'Aire', s1: 'Terra', s2: 'Aire', s3: 'Terra' },
                      sex: { s0: 'D', s1: 'H', s2: 'H', s3: 'D' },
                      nee: { s1: 'S' } },
        balance: {}, unresolved: [], best: null
      }
    }
  };
  const calls = { modals: [], files: [], texts: [] };
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      nodes.set(id, { id, innerHTML: '', textContent: '', value: '', checked: true, style: {},
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
    initialOf: name => String(name)[0], toast() {},
    openModal: html => calls.modals.push(html), closeModal() {}, focusModalField() {}, appConfirm() {},
    openStudentPicker() {}, registerActions: map => Object.assign(A.actions, map), actions: {},
    shuffleArray: list => list,
    getData: () => data, getTeams: () => data.teams,
    studentName: id => students.find(student => student.id === id).name,
    saveWithUndo() {}, saveState() {}, pushUndo() {},
    centerDesks() {}, renderLayoutOptions() {}, renderStudentList() {}, updateCounts() {}, renderDesks() {},
    endTableGesture() {}, clearTableSelection() {}, zoomReset() {}, switchCanvasView() {}, renderAll() {},
    renderTeamsCanvas() {}, updateFabTeamsButton() {},
    normalizeTeamLayout: layout => layout, canvasTables: () => [], placeDeskWithTeam() {},
    tableSelection: new Set(), flags: { spaceHeld: false }, view: { current: 'equips' }
  };
  const context = vm.createContext({
    window: { AulaMap: A }, console,
    document: {
      addEventListener() {}, querySelectorAll: () => [],
      createElement: () => ({ click() { calls.files.push(this.download); } })
    },
    Blob: class { constructor(parts) { calls.texts.push(String(parts[0])); } },
    URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} },
    setTimeout: () => 0
  });
  for (const name of ['exports', 'teams', 'preferences']) {
    vm.runInContext(readFileSync(path.join(root, `assets/js/${name}.js`), 'utf8'), context);
  }
  const run = (name, dataset = {}) => A.actions[name]({ dataset, value: '', checked: true });
  return { A, data, calls, node, run, lastText: () => calls.texts[calls.texts.length - 1] };
}

test('exporting the teams asks for the format first', () => {
  const helper = setup();
  helper.run('exportTeams');
  const modal = helper.calls.modals[0];
  assert.match(modal, /Text \(\.txt\)/);
  assert.match(modal, /Full de càlcul \(\.csv\)/);
  assert.match(modal, /Incloure els nivells/, 'amb nivells carregats, també es pregunta');
  assert.equal(helper.calls.texts.length, 0, 'encara no s\'ha escrit cap fitxer');
});

test('the text file carries every criterion and how each team is made up', () => {
  const helper = setup();
  helper.run('exportTeams');
  helper.run('doExportTeams', { value: 'txt' });
  const text = helper.lastText();
  assert.match(text, /Preferències acomplertes: \d+% /);
  assert.match(text, /Amb una sola tria acomplerta: \d+%/);
  assert.match(text, /Separacions respectades: 0% \(0 de 1 separació respectada\)/);
  assert.match(text, /Equilibri · Sexe: 100%/);
  assert.match(text, /Grup: Aire 1, Terra 1/, 'la composició de cada equip');
  assert.match(text, /NEE: 1/);
  assert.match(text, /nivell mitjà 6\.00/);
  assert.match(helper.calls.files[0], /^equips_/);
});

test('the CSV file has one row per student with the composition columns', () => {
  const helper = setup();
  helper.run('exportTeams');
  helper.run('doExportTeams', { value: 'csv' });
  const lines = helper.lastText().replace(/^﻿/, '').split('\r\n');
  assert.deepEqual(lines[0].split(';'),
    ['equip', 'alumne', 'nivell', 'grup', 'sexe', 'nee',
     'preferencies acomplertes', 'preferencies indicades',
     'separacions demanades', 'separacions sense respectar']);
  assert.deepEqual(lines[1].split(';'), ['Equip 1', 'Anna Puig', '8', 'Aire', 'D', '', '1', '1', '0', '0']);
  assert.deepEqual(lines[2].split(';'), ['Equip 1', 'Pau Serra', '4', 'Terra', 'H', 'S', '1', '1', '0', '0']);
  assert.equal(lines.length, 5);
  assert.match(helper.calls.files[0], /^aulamap_equips_/);
});

test('the levels stay out of the file when the box is cleared', () => {
  const helper = setup();
  helper.run('exportTeams');
  helper.node('teamExportLevels').checked = false;
  helper.run('doExportTeams', { value: 'csv' });
  assert.deepEqual(helper.lastText().replace(/^﻿/, '').split('\r\n')[0].split(';'),
    ['equip', 'alumne', 'grup', 'sexe', 'nee',
     'preferencies acomplertes', 'preferencies indicades',
     'separacions demanades', 'separacions sense respectar']);
});

test('the side panel indicators follow the teams as they change', () => {
  const helper = setup();
  const before = helper.A.preferenceTeamView(helper.data.teams.groups);
  assert.match(before.summary, /Amb una sola tria acomplerta/);
  assert.match(before.summary, /Equilibri · Grup d'origen/);

  // En Pau se'n va a l'altre equip: els indicadors es tornen a comptar.
  helper.A.moveStudentsToTeam(['s1'], 1);
  const after = helper.A.preferenceTeamView(helper.data.teams.groups);
  assert.notEqual(after.summary, before.summary);
  assert.match(after.composition(1), /Terra 2/, "el segon equip es queda amb dos de Terra");
});
