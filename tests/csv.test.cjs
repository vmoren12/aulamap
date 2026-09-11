const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

/** Carrega exports.js amb un grup buit i el nucli simulat. */
function setup() {
  const data = { students: [], teams: { competencies: {}, useCompetency: false } };
  const calls = { toast: [], renders: 0 };
  let counter = 0;
  const A = {
    DESK_W: 100, DESK_H: 64, REL_TOGETHER: 'together', REL_SEPARATE: 'separate',
    el: () => null, esc: s => String(s), uid: p => `${p}_${++counter}`,
    pluralize: (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`,
    toast: (message, kind) => calls.toast.push([message, kind]),
    openModal() {}, closeModal() {}, focusModalField() {}, registerActions() {},
    getData: () => data, getTeams: () => data.teams,
    saveWithUndo() {}, saveState() {}, pushUndo() {},
    renderAll: () => calls.renders++,
    makeStudent: name => ({ id: `s_${++counter}`, name, color: '#000' })
  };
  const context = vm.createContext({ window: { AulaMap: A }, document: { addEventListener() {} }, console });
  vm.runInContext(readFileSync(path.join(__dirname, '../assets/js/exports.js'), 'utf8'), context);
  return { A, data, calls };
}

test('CSV lines accept semicolons, commas, tabs and quoted names', () => {
  const { A } = setup();
  // Array.from: les cel·les arriben del context aïllat on s'executa el mòdul.
  const cells = line => Array.from(A.parseCsvLine(line));
  assert.deepEqual(cells('Anna Puig;7'), ['Anna Puig', '7']);
  assert.deepEqual(cells('Anna Puig,7'), ['Anna Puig', '7']);
  assert.deepEqual(cells('Anna Puig\t7'), ['Anna Puig', '7']);
  assert.deepEqual(cells('"Puig Solà, Anna";7'), ['Puig Solà, Anna', '7']);
  assert.deepEqual(cells('"Diu ""hola""";'), ['Diu "hola"', '']);
});

test('exported cells are quoted only when they need it', () => {
  const { A } = setup();
  assert.equal(A.csvFrom([['nom', 'nivell'], ['Anna', 7]]), 'nom;nivell\r\nAnna;7');
  assert.equal(A.csvFrom([['Puig; Anna', 7]]), '"Puig; Anna";7');
});

test('importing nom;nivell adds students, levels and skips repeated names', () => {
  const h = setup();
  h.A.importCsvText('nom;nivell\nAnna Puig;7\nPau Serra;5,5\nNil Roca\n');
  assert.deepEqual(h.data.students.map(s => s.name), ['Anna Puig', 'Pau Serra', 'Nil Roca']);
  const [anna, pau, nil] = h.data.students;
  assert.equal(h.data.teams.competencies[anna.id], 7);
  assert.equal(h.data.teams.competencies[pau.id], 5.5, 'la coma decimal s\'accepta');
  assert.equal(h.data.teams.competencies[nil.id], undefined);
  assert.equal(h.data.teams.useCompetency, true, 'el nivell s\'activa si el fitxer en porta');
  assert.equal(h.calls.renders, 1);

  h.A.importCsvText('Anna Puig;3\nJoana Mas;9');
  assert.deepEqual(h.data.students.map(s => s.name).slice(-1), ['Joana Mas']);
  assert.equal(h.data.teams.competencies[anna.id], 7, 'no es toca el nivell de qui ja hi era');
  assert.match(h.calls.toast.at(-1)[0], /1 ja hi eren/);
});

test('levels outside 0-10 are clamped and empty files are rejected', () => {
  const h = setup();
  h.A.importCsvText('Anna;99\nPau;-4');
  const [anna, pau] = h.data.students;
  assert.equal(h.data.teams.competencies[anna.id], 10);
  assert.equal(h.data.teams.competencies[pau.id], 0);

  h.A.importCsvText('   \n\n');
  assert.equal(h.data.students.length, 2);
  assert.match(h.calls.toast.at(-1)[0], /No hi ha dades/);
});
