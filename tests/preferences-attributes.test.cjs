const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

/**
 * Composició dels equips (grup d'origen, sexe i necessitats educatives) i
 * criteri d'èxit triable. Es carrega el mòdul de preferències amb el nucli
 * simulat, igual que a `preferences.test.cjs`.
 */
function setup(students = []) {
  const data = {
    students: students.map((name, index) => ({ id: `s${index}`, name, color: '#000' })),
    relations: [], desks: [], assignments: {}, lockedDesks: {},
    teams: {
      competencies: {}, useCompetency: false, preferences: null, groups: null, teamNames: {},
      constraints: { together: [], separate: [] }, saved: []
    }
  };
  const calls = { toast: [], files: [] };
  let counter = 0;
  const A = {
    DESK_W: 100, DESK_H: 64, REL_TOGETHER: 'together', REL_SEPARATE: 'separate',
    COLORS: ['#111', '#222'],
    el: () => null, esc: value => String(value), uid: prefix => `${prefix}_${++counter}`,
    pluralize: (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`,
    toast: (message, kind) => calls.toast.push([message, kind]),
    openModal() {}, closeModal() {}, focusModalField() {}, appConfirm() {},
    registerActions() {},
    getData: () => data, getTeams: () => data.teams,
    studentName: id => data.students.find(s => s.id === id)?.name || '?',
    teamName: index => `Equip ${index + 1}`,
    competencyOf: () => 5,
    saveWithUndo() {}, saveState() {}, pushUndo() {}, renderAll() {},
    downloadBlob: (blob, filename) => calls.files.push(filename)
  };
  const context = vm.createContext({
    window: { AulaMap: A }, console,
    // La descàrrega real crea un enllaç i el prem: n'anotem el nom de fitxer.
    document: {
      addEventListener() {},
      createElement: () => ({ click() { calls.files.push(this.download); } })
    },
    Blob: class { constructor(parts) { calls.blob = String(parts[0]); } },
    URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} },
    setTimeout: () => 0
  });
  for (const file of ['exports', 'preferences']) {
    vm.runInContext(readFileSync(path.join(root, `assets/js/${file}.js`), 'utf8'), context);
  }
  return { A, data, calls };
}

const plain = value => JSON.parse(JSON.stringify(value));

/** Llista d'alumnes amb els seus atributs, per als repartiments de prova. */
function rosterOf(count) {
  return Array.from({ length: count }, (_, index) => `A${index}`);
}

/* ── Lectura de les columnes ─────────────────────────── */

test('the mapper recognises the origin group, the sex and the needs columns', () => {
  const { A } = setup();
  const rows = [
    ['Marca de temps', 'Nom i cognoms', 'Grup actual', 'Sexe', 'NEE', 'Preferència 1', 'Separar 1'],
    ['9:02', 'Anna Puig', 'Aire', 'D', '', 'Pau Serra', ''],
    ['9:03', 'Pau Serra', 'Terra', 'H', 'S', 'Anna Puig', 'Nil Roca'],
    ['9:04', 'Nil Roca', 'Aigua', 'H', '', 'Pau Serra', '']
  ];
  const mapping = plain(A.autoMapping(rows, true));
  assert.equal(mapping.name, 1);
  assert.deepEqual(mapping.attrs, { group: 2, sex: 3, nee: 4 });
  assert.deepEqual(mapping.avoid, [6]);
  assert.equal(mapping.prefs[0], 5, 'la columna de preferència no es confon amb cap altra');
});

test('a column of names is never taken for a group column', () => {
  const { A } = setup();
  const rows = [
    ['Nom', 'Grup de treball preferit'],
    ['Anna Puig', 'Pau Serra Vidal'],
    ['Pau Serra', 'Anna Puig Solà'],
    ['Nil Roca', 'Jana Ferrer Mas'],
    ['Jana Ferrer', 'Nil Roca Camps']
  ];
  const mapping = plain(A.autoMapping(rows, true));
  assert.equal(mapping.attrs.group, -1, 'els valors són noms llargs i tots diferents');
});

test('the read values reach each student and empty needs cells count for nobody', () => {
  const { A } = setup();
  const rows = [
    ['Nom', 'Grup', 'Sexe', 'NEE', 'Preferència 1'],
    ['Anna Puig', 'Aire', 'D', 'S', 'Pau Serra'],
    ['Pau Serra', 'Terra', 'H', '', 'Anna Puig'],
    ['Nil Roca', 'Aire', 'H', 'no', 'Anna Puig']
  ];
  const mapping = plain(A.autoMapping(rows, true));
  const entries = A.readEntries(rows, true, mapping).entries;
  const roster = [{ id: 's0', name: 'Anna Puig' }, { id: 's1', name: 'Pau Serra' }, { id: 's2', name: 'Nil Roca' }];
  Array.from(entries).forEach((entry, index) => { entry.studentId = roster[index].id; });
  const attributes = plain(A.buildAttributes(entries, roster));
  assert.deepEqual(attributes.group, { s0: 'Aire', s1: 'Terra', s2: 'Aire' });
  assert.deepEqual(attributes.sex, { s0: 'D', s1: 'H', s2: 'H' });
  assert.deepEqual(attributes.nee, { s0: 'S' }, 'la casella buida i el "no" no marquen ningú');
});

/* ── Equilibri ───────────────────────────────────────── */

test('teams are balanced by origin group, sex and needs', () => {
  const ids = rosterOf(12);
  const { A } = setup();
  const attributes = { group: {}, sex: {}, nee: {} };
  ids.forEach((id, index) => {
    attributes.group[id] = ['Aire', 'Terra', 'Aigua'][index % 3];
    attributes.sex[id] = index % 2 ? 'H' : 'D';
    if (index < 3) attributes.nee[id] = 'S';
  });
  const result = plain(A.optimizePreferenceGroups({
    ids, prefs: {}, attributes, sizes: [4, 4, 4], seed: 11
  }));
  const stats = plain(A.preferenceStats(result.groups, {}, { attributes }));
  const byKey = Object.fromEntries(stats.balance.map(entry => [entry.key, entry.pct]));
  assert.equal(byKey.group, 100, "cada equip té un alumne de cada grup d'origen");
  assert.equal(byKey.sex, 100, 'cada equip queda 2 a 2');
  assert.equal(byKey.nee, 100, 'els tres alumnes marcats van a equips diferents');
});

test('the balance indicator marks the worst possible split with a zero', () => {
  const { A } = setup();
  const attributes = { sex: { A0: 'D', A1: 'D', A2: 'H', A3: 'H' } };
  const worst = plain(A.balanceStats([['A0', 'A1'], ['A2', 'A3']], attributes));
  assert.equal(worst[0].pct, 0, 'les dues noies juntes i els dos nois junts');
  const best = plain(A.balanceStats([['A0', 'A2'], ['A1', 'A3']], attributes));
  assert.equal(best[0].pct, 100);
});

test('an attribute nobody shares does not drag the teams around', () => {
  const { A } = setup();
  const attributes = { group: { A0: 'Aire', A1: 'Terra' } };
  const balance = plain(A.balanceStats([['A0'], ['A1']], attributes));
  assert.equal(balance[0].pct, 100);
  assert.equal(A.balanceAverage(balance), 100);
});

test('the balance can be switched off for one attribute', () => {
  const ids = rosterOf(8);
  const { A } = setup();
  const attributes = { sex: {} };
  ids.forEach((id, index) => { attributes.sex[id] = index < 4 ? 'D' : 'H'; });
  // Quatre terceres opcions d'una sola banda, sempre cap a algú del mateix
  // sexe: són prou fluixes perquè l'equilibri s'hi imposi si està actiu.
  const prefs = { A0: ['fora', 'fora', 'A1'], A2: ['fora', 'fora', 'A3'],
                  A4: ['fora', 'fora', 'A5'], A6: ['fora', 'fora', 'A7'] };
  const options = { ids, prefs, attributes, sizes: [2, 2, 2, 2], seed: 5 };
  const off = plain(A.optimizePreferenceGroups({ ...options, balance: { sex: false } }));
  const offStats = plain(A.preferenceStats(off.groups, prefs, { attributes }));
  const on = plain(A.optimizePreferenceGroups(options));
  const onStats = plain(A.preferenceStats(on.groups, prefs, { attributes }));

  assert.equal(offStats.pct, 100, 'sense equilibri es respecten totes les tries');
  assert.equal(onStats.balance[0].pct, 100, 'amb equilibri els equips queden repartits');
  assert.ok(onStats.balance[0].pct > offStats.balance[0].pct,
    `i sense, no (${offStats.balance[0].pct}%)`);
  assert.ok(offStats.balance.length, "l'indicador d'equilibri es compta igualment");
});

/* ── Criteri d'èxit ──────────────────────────────────── */

test('the "one choice each" criterion spreads the choices instead of piling them up', () => {
  const ids = rosterOf(9);
  const { A } = setup();
  // Tres alumnes es trien entre ells i la resta els volen a tots tres: amb el
  // criteri de màxim tendeixen a anar junts; amb l'altre, es reparteixen.
  const prefs = {
    A0: ['A1', 'A2'], A1: ['A0', 'A2'], A2: ['A0', 'A1'],
    A3: ['A0'], A4: ['A1'], A5: ['A2'], A6: ['A0'], A7: ['A1'], A8: ['A2']
  };
  const spread = plain(A.optimizePreferenceGroups({
    ids, prefs, sizes: [3, 3, 3], criterion: 'spread', seed: 3
  }));
  const spreadStats = plain(A.preferenceStats(spread.groups, prefs, { criterion: 'spread' }));
  const max = plain(A.optimizePreferenceGroups({ ids, prefs, sizes: [3, 3, 3], seed: 3 }));
  const maxStats = plain(A.preferenceStats(max.groups, prefs, {}));

  assert.equal(spreadStats.crowded, 0, "ningú no coincideix amb més d'una de les seves tries");
  assert.ok(spreadStats.alone >= maxStats.alone,
    `n'hi ha més amb exactament una tria acomplerta (${spreadStats.alone} vs ${maxStats.alone})`);
  assert.ok(spreadStats.unhappy <= maxStats.unhappy, 'i no hi ha més gent sense ningú');
});

test('the headline figure follows the chosen criterion', () => {
  const { A } = setup();
  const prefs = { A0: ['A1', 'A2'], A1: ['A0'], A2: ['A0'] };
  const groups = [['A0', 'A1', 'A2'], ['A3']];
  const max = plain(A.preferenceStats(groups, prefs, {}));
  const spread = plain(A.preferenceStats(groups, prefs, { criterion: 'spread' }));
  assert.equal(max.mainPct, max.pct);
  assert.equal(spread.mainPct, spread.alonePct);
  assert.equal(spread.crowded, 1, 'A0 té les dues tries al mateix equip');
  assert.equal(spread.alone, 2);
});

test('separations still beat any criterion', () => {
  const ids = rosterOf(4);
  const { A } = setup();
  const prefs = { A0: ['A1'], A1: ['A0'] };
  const avoid = { A0: ['A1'] };
  const result = plain(A.optimizePreferenceGroups({
    ids, prefs, avoid, sizes: [2, 2], criterion: 'spread', seed: 2
  }));
  const together = result.groups.some(group => group.includes('A0') && group.includes('A1'));
  assert.equal(together, false);
});

/* ── Indicadors ──────────────────────────────────────── */

test('the criteria list carries one row per criterion, with the chosen one first', () => {
  const { A } = setup();
  const prefs = { A0: ['A1'], A1: ['A0'] };
  const attributes = { sex: { A0: 'D', A1: 'H', A2: 'D', A3: 'H' } };
  const stats = plain(A.preferenceStats([['A0', 'A1'], ['A2', 'A3']], prefs,
    { avoid: { A2: ['A3'] }, attributes, criterion: 'spread' }));
  const rows = plain(A.criteriaList(stats));
  assert.deepEqual(rows.map(row => row.key),
    ['prefs', 'alone', 'avoid', 'balance:sex']);
  assert.equal(rows.find(row => row.main).key, 'alone');
  assert.equal(rows[2].pct, 0, 'la separació demanada no s\'ha respectat');
});

test('each team knows how it is made up', () => {
  const { A } = setup();
  const attributes = { group: { A0: 'Aire', A1: 'Terra', A2: 'Aire' }, nee: { A0: 'S' } };
  const stats = plain(A.preferenceStats([['A0', 'A1'], ['A2']], {}, { attributes }));
  const first = stats.perGroup[0].composition;
  assert.deepEqual(first[0].values, [{ label: 'Aire', count: 1 }, { label: 'Terra', count: 1 }]);
  assert.deepEqual(first[1].values, [{ label: 'NEE', count: 1 }]);
  assert.deepEqual(stats.perGroup[1].composition[1].values, [], 'el segon equip no té ningú marcat');
});

/* ── Exportació ──────────────────────────────────────── */

test('the teams CSV carries the composition columns and the counts', () => {
  const { A, data, calls } = setup(['Anna Puig', 'Pau Serra', 'Nil Roca', 'Jana Ferrer']);
  data.teams.groups = [['s0', 's1'], ['s2', 's3']];
  data.teams.preferences = {
    prefs: { s0: ['s1'], s1: ['s0'] }, avoid: { s2: ['s3'] },
    attributes: { group: { s0: 'Aire', s1: 'Terra' }, nee: { s0: 'S' } },
    criterion: 'max'
  };
  A.exportTeamsCsv({ competency: false });
  const lines = calls.blob.replace(/^﻿/, '').split('\r\n');
  assert.deepEqual(lines[0].split(';'),
    ['equip', 'alumne', 'grup', 'nee', 'preferencies acomplertes', 'preferencies indicades',
     'separacions demanades', 'separacions sense respectar']);
  assert.deepEqual(lines[1].split(';'), ['Equip 1', 'Anna Puig', 'Aire', 'S', '1', '1', '0', '0']);
  assert.deepEqual(lines[3].split(';'), ['Equip 2', 'Nil Roca', '', '', '0', '0', '1', '1']);
  assert.match(calls.files[0], /^aulamap_equips_\d{4}-\d{2}-\d{2}\.csv$/);
});

test('the levels column only shows up when it is asked for', () => {
  const { A, data, calls } = setup(['Anna Puig', 'Pau Serra']);
  data.teams.groups = [['s0', 's1']];
  A.exportTeamsCsv();
  assert.deepEqual(calls.blob.replace(/^﻿/, '').split('\r\n')[0].split(';'),
    ['equip', 'alumne', 'nivell']);
});
