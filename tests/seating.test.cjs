const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

/** Carrega seating.js amb una aula de quatre pupitres i el nucli simulat. */
function setup() {
  const data = {
    students: [{ id: 's1', name: 'Anna' }, { id: 's2', name: 'Pau' }, { id: 's3', name: 'Nil' }],
    desks: [0, 1, 2, 3].map(i => ({ id: `d${i}`, x: i * 120, y: 0 })),
    assignments: { d0: 's1', d1: 's2' },
    lockedDesks: {}, relations: [], layoutType: 'rows'
  };
  const calls = { undo: 0, save: 0, confirm: null, toast: [] };
  const elements = {};
  const A = {
    DESK_W: 100, DESK_H: 64,
    el: id => (elements[id] ||= { innerHTML: '', style: {}, textContent: '', classList: { toggle() {} },
      querySelectorAll: () => [], insertAdjacentHTML() {}, setAttribute() {} }),
    esc: s => String(s), uid: p => `${p}_test`, initialOf: n => String(n)[0],
    pluralize: (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`,
    toast: (message, kind) => calls.toast.push([message, kind]),
    openModal: html => { elements.modal = html; }, closeModal() {},
    appConfirm: (title, detail, onConfirm) => { calls.confirm = { title, detail, onConfirm }; },
    registerActions() {}, getData: () => data,
    saveWithUndo: () => calls.undo++, saveState: () => calls.save++,
    findStudent: id => data.students.find(s => s.id === id) || null,
    studentName: id => data.students.find(s => s.id === id)?.name || '?',
    evaluateRelations: () => ({ results: [] }), relationDots: () => ({}), relationLines: () => [],
    getCanvasData: () => data, getTeams: () => ({ lockedStudents: {}, groups: null, useCompetency: false }),
    teamIndexForDesk: () => -1, renderTeamOverlays() {}, endTableGesture() {},
    renderRelationsPanel() {}, renderRelationScore() {}, renderStudentList() {}, updateCounts() {},
    updateSelectionBar() {}, clearTableSelection() {}, refreshTableSelection() {},
    view: { current: 'aula' }, tableSelection: new Set()
  };
  const context = vm.createContext({ window: { AulaMap: A }, document: { addEventListener() {} }, console });
  vm.runInContext(readFileSync(path.join(__dirname, '../assets/js/seating.js'), 'utf8'), context);
  return { A, data, calls, elements };
}

test('the shared trash asks for confirmation and removes every selected desk', () => {
  const h = setup();
  h.A.removeDesksByIds(['d0', 'd1']);
  assert.match(h.calls.confirm.title, /Eliminar 2 pupitres\?/);
  assert.match(h.calls.confirm.detail, /2 alumnes es quedaran sense lloc/);
  assert.equal(h.data.desks.length, 4, 'res no canvia fins que es confirma');

  h.calls.confirm.onConfirm();
  assert.deepEqual(h.data.desks.map(d => d.id), ['d2', 'd3']);
  assert.deepEqual(h.data.assignments, {});
  assert.equal(h.data.layoutType, 'free');
  assert.equal(h.calls.undo, 1, 'una sola entrada de desfer per a tota la selecció');
});

test('deleting desks warns about the students fixed with a padlock', () => {
  const h = setup();
  h.data.lockedDesks = { d0: true };
  h.A.removeDesksByIds(['d0']);
  assert.match(h.calls.confirm.title, /Eliminar 1 pupitre\?/);
  assert.match(h.calls.confirm.detail, /1 alumne està fixat/);
  h.calls.confirm.onConfirm();
  assert.deepEqual(h.data.lockedDesks, {});
});

test('reassigning an occupied desk swaps the two students', () => {
  const h = setup();
  h.A.seatStudent('d0', 's2');            // en Pau seia a d1
  assert.deepEqual(h.data.assignments, { d0: 's2', d1: 's1' });

  h.A.seatStudent('d2', 's3');            // alumne sense lloc a un pupitre buit
  assert.equal(h.data.assignments.d2, 's3');

  h.A.seatStudent('d3', 's3');            // canvi de pupitre buit a pupitre buit
  assert.equal(h.data.assignments.d2, undefined);
  assert.equal(h.data.assignments.d3, 's3');
});

test('a desk fixed with a padlock does not accept another student', () => {
  const h = setup();
  h.data.lockedDesks = { d0: true };
  h.A.seatStudent('d0', 's3');
  assert.equal(h.data.assignments.d0, 's1');
  assert.match(h.calls.toast.at(-1)[0], /fixat/);

  h.A.seatStudent('d2', 's1');            // tampoc es pot treure d'un pupitre fixat
  assert.equal(h.data.assignments.d0, 's1');
  assert.equal(h.data.assignments.d2, undefined);
});
