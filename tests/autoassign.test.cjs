const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

/** Carrega relations.js i autoassign.js amb una aula concreta. */
function setup(data) {
  const A = {
    DESK_W: 100, DESK_H: 64, REL_TOGETHER: 'together', REL_SEPARATE: 'separate',
    REL_LABEL: { together: 'Ajuntar', separate: 'Separar' },
    // El panell de relacions es repinta de debò: només cal que hi hagi nodes.
    el: () => ({ innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
    esc: s => String(s), uid: p => `${p}_test`,
    pluralize: (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`,
    toast() {}, registerActions() {}, openStudentPicker() {}, focusDesks() {},
    getData: () => data, saveWithUndo() {}, saveState() {},
    renderDesks() {}, renderStudentList() {}, renderRelationsPanel() {}, renderRelationScore() {},
    updateCounts() {}, view: { current: 'aula' }, switchCanvasView() {}
  };
  const context = vm.createContext({ window: { AulaMap: A }, console, setTimeout: fn => fn() });
  for (const file of ['relations', 'autoassign']) {
    vm.runInContext(readFileSync(path.join(root, `assets/js/${file}.js`), 'utf8'), context);
  }
  return A;
}

/** Fila de `count` pupitres consecutius, tots veïns dels del costat. */
function classroom(count, relations) {
  return {
    students: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, name: `Alumne ${i}` })),
    desks: Array.from({ length: count }, (_, i) => ({ id: `d${i}`, x: i * 120, y: 0 })),
    assignments: {}, lockedDesks: {}, relations
  };
}

test('the search effort scales with the classroom and never drops below the floor', () => {
  const A = setup(classroom(2, []));
  assert.equal(A.optimizationEffort(2, 4), 20000, 'una aula petita ja fa la cerca mínima');
  assert.ok(A.optimizationEffort(30, 30) > A.optimizationEffort(12, 12), 'més alumnes, més cerca');
  assert.equal(A.optimizationEffort(200, 200), 90000, 'hi ha un sostre de temps de càlcul');
});

test('auto-assignment satisfies every relation it can, with no options to choose', () => {
  // Sis pupitres en fila: s0 i s1 junts, s2 i s3 separats, s4 i s5 junts.
  const data = classroom(6, [
    { id: 'r1', type: 'together', students: ['s0', 's1'] },
    { id: 'r2', type: 'separate', students: ['s2', 's3'] },
    { id: 'r3', type: 'together', students: ['s4', 's5'] }
  ]);
  const A = setup(data);
  A.runAutoAssign();
  const evaluation = A.evaluateRelations(data);
  assert.equal(Object.keys(data.assignments).length, 6, 'tothom té lloc');
  assert.equal(evaluation.pct, 100, `relacions acomplides: ${evaluation.pct}%`);
});

test('locked desks stay untouched while the rest is optimised', () => {
  const data = classroom(4, [{ id: 'r1', type: 'together', students: ['s0', 's3'] }]);
  data.assignments = { d0: 's2' };
  data.lockedDesks = { d0: true };
  const A = setup(data);
  A.runAutoAssign();
  assert.equal(data.assignments.d0, 's2', "l'alumne fixat no es mou");
  assert.equal(data.lockedDesks.d0, true);
  assert.equal(A.evaluateRelations(data).pct, 100);
});

test('the interface asks for no intensity: the button optimises directly', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="autoAssignFab"[^>]*data-action="autoAssign"/);
  assert.doesNotMatch(html, /autoIterations/);
  const source = readFileSync(path.join(root, 'assets/js/autoassign.js'), 'utf8');
  assert.doesNotMatch(source, /Intensitat|openModal/, 'no hi ha d\'haver cap diàleg previ');
});
