const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

/**
 * Nucli, estat, perfils i alumnat de debò, amb el mínim de DOM perquè els
 * modals es puguin pintar en memòria.
 */
function setup() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id, value: '', innerHTML: '', textContent: '', style: {}, dataset: {},
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
        appendChild() {}, remove() {}, focus() {}, select() {}
      });
    }
    return nodes.get(id);
  };
  const A = {};
  const context = vm.createContext({
    window: { AulaMap: A },
    document: {
      getElementById: node,
      addEventListener() {},
      createElement: () => node('scratch')
    },
    localStorage: { getItem: () => null, setItem() {} },
    console,
    requestAnimationFrame: fn => fn(),
    setTimeout: fn => fn()
  });
  for (const file of ['core', 'state', 'profiles', 'students']) {
    vm.runInContext(readFileSync(path.join(root, `assets/js/${file}.js`), 'utf8'), context);
  }
  A.renderAll = () => {};
  A.renderRelationsPanel = () => {};
  A.renderTeamsPanel = () => {};
  return { A, node, state: A.getState(), modal: () => node('modalContent').innerHTML };
}

/** Deixa la configuració activa amb alumnes, nivells i preferències. */
function fillClass(A) {
  const data = A.getData();
  ['Anna Puig', 'Pau Serra', 'Nil Roca'].forEach((name, index) => {
    data.students.push(A.makeStudent(name, index));
  });
  const [anna, pau, nil] = data.students;
  data.teams.competencies[anna.id] = 8;
  data.teams.useCompetency = true;
  data.teams.preferences = {
    updated: '01/09/2026 10:00', source: 'formulari.csv', ranked: true,
    prefs: { [anna.id]: [pau.id, nil.id], [pau.id]: [anna.id] },
    unresolved: ['Berta Soler'], best: null
  };
  data.relations.push({ id: 'r1', type: 'together', students: [anna.id, pau.id] });
  data.desks.push({ id: 'd1', x: 0, y: 0 });
  data.assignments.d1 = anna.id;
  data.teams.groups = [[anna.id, pau.id], [nil.id]];
  return data;
}

test('the new configuration dialog offers every class list, with the current one selected', () => {
  const { A, node, state, modal } = setup();
  fillClass(A);
  state.docents.push('Grup 2');
  state.configs['Grup 2'] = {
    configurations: [{ name: 'Matins', data: A.normalizeConfigData({ students: [{ id: 'x', name: 'Jana', color: '#111' }] }) }],
    currentConfig: 0
  };

  A.runAction('showAddConfig', node('none'), {});
  const html = modal();
  assert.match(html, /<optgroup label="Grup 1">/);
  assert.match(html, /<optgroup label="Grup 2">/);
  assert.match(html, /Configuració 1 — 3 alumnes · actual<\/option>/);
  assert.match(html, /selected/, 'la configuració activa surt triada');
  assert.match(html, /Matins — 1 alumne/);
  assert.match(html, /Començar sense alumnes/);
});

test('a new configuration can still start with nobody', () => {
  const { A, node } = setup();
  fillClass(A);
  A.runAction('showAddConfig', node('none'), {});
  node('newConfigName').value = 'Buida';
  node('newConfigStudents').value = '';
  A.runAction('addConfig', node('none'), {});

  const entry = A.currentDocentEntry();
  assert.equal(entry.configurations.length, 2);
  assert.equal(entry.currentConfig, 1);
  assert.equal(A.getData().students.length, 0);
  assert.equal(A.getData().teams.preferences, null);
});

test('a new configuration inherits the names, the levels and the answers', () => {
  const { A, node } = setup();
  const origin = fillClass(A);
  const [anna, pau, nil] = origin.students;

  A.runAction('showAddConfig', node('none'), {});
  node('newConfigName').value = 'Sortida';
  node('newConfigStudents').value = '0:0';
  A.runAction('addConfig', node('none'), {});

  const data = A.getData();
  assert.deepEqual(Array.from(data.students, student => student.name), ['Anna Puig', 'Pau Serra', 'Nil Roca']);
  assert.equal(data.students[0].color, anna.color, 'es manté el color de cada alumne');
  assert.notEqual(data.students[0].id, anna.id, 'els identificadors són nous');

  const [newAnna, newPau, newNil] = data.students;
  assert.equal(data.teams.competencies[newAnna.id], 8);
  assert.equal(data.teams.useCompetency, true);
  assert.deepEqual(Array.from(data.teams.preferences.prefs[newAnna.id]), [newPau.id, newNil.id],
    'les tries apunten als alumnes copiats');
  assert.deepEqual(Array.from(data.teams.preferences.prefs[newPau.id]), [newAnna.id]);
  assert.deepEqual(Array.from(data.teams.preferences.unresolved), ['Berta Soler']);
  assert.equal(data.teams.preferences.best, null);

  assert.deepEqual(Array.from(data.relations), [], 'les relacions no es copien');
  assert.deepEqual(Array.from(data.desks), [], 'ni la distribució');
  assert.equal(data.teams.groups, null, 'ni els equips ja formats');
  assert.equal(origin.students.length, 3, 'la configuració d\'origen no es toca');
});

test('the list can come from another group', () => {
  const { A, node, state } = setup();
  fillClass(A);
  state.docents.push('Grup 2');
  state.configs['Grup 2'] = {
    configurations: [{ name: 'Matins', data: A.normalizeConfigData({ students: [
      { id: 'x1', name: 'Jana Ferrer', color: '#111' }, { id: 'x2', name: 'Lluc Vidal', color: '#222' }
    ] }) }],
    currentConfig: 0
  };

  A.runAction('showAddConfig', node('none'), {});
  node('newConfigName').value = 'Barreja';
  node('newConfigStudents').value = '1:0';
  A.runAction('addConfig', node('none'), {});

  assert.deepEqual(Array.from(A.getData().students, student => student.name), ['Jana Ferrer', 'Lluc Vidal']);
  assert.equal(A.currentDocentName(), 'Grup 1', 'la configuració es crea al grup on som');
});

test('copying from an empty class leaves the new configuration empty', () => {
  const { A } = setup();
  const data = A.defaultConfigData();
  assert.equal(A.copyStudentsInto(data, '0:0'), 0);
  assert.equal(data.students.length, 0);
  assert.equal(A.copyStudentsInto(data, ''), 0);
  assert.equal(A.copyStudentsInto(data, '9:9'), 0, 'una referència que no existeix no trenca res');
});
