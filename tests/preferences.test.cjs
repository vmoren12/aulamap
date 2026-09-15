const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

/** Carrega exports.js i preferences.js amb una classe concreta i el nucli simulat. */
function setup(students = []) {
  const data = {
    students: students.map((name, index) => ({ id: `s${index}`, name, color: '#000' })),
    relations: [], desks: [], assignments: {}, lockedDesks: {},
    teams: {
      competencies: {}, useCompetency: false, preferences: null, groups: null,
      constraints: { together: [], separate: [] }, saved: []
    }
  };
  const calls = { toast: [], actions: null };
  let counter = 0;
  const A = {
    DESK_W: 100, DESK_H: 64, REL_TOGETHER: 'together', REL_SEPARATE: 'separate',
    COLORS: ['#111', '#222'],
    el: () => null, esc: value => String(value), uid: prefix => `${prefix}_${++counter}`,
    pluralize: (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`,
    toast: (message, kind) => calls.toast.push([message, kind]),
    openModal() {}, closeModal() {}, focusModalField() {}, appConfirm() {},
    registerActions: map => { calls.actions = { ...(calls.actions || {}), ...map }; },
    getData: () => data, getTeams: () => data.teams,
    studentName: id => data.students.find(s => s.id === id)?.name || '?',
    saveWithUndo() {}, saveState() {}, pushUndo() {}, renderAll() {},
    downloadBlob() {}
  };
  const context = vm.createContext({
    window: { AulaMap: A }, document: { addEventListener() {} }, console
  });
  for (const file of ['exports', 'preferences']) {
    vm.runInContext(readFileSync(path.join(root, `assets/js/${file}.js`), 'utf8'), context);
  }
  return { A, data, calls };
}

/** Converteix les estructures que tornen del context aïllat a objectes plans. */
const plain = value => JSON.parse(JSON.stringify(value));

/* ── Lectura del full ────────────────────────────────── */

test('the sheet reader keeps empty columns, quoted cells and line breaks', () => {
  const { A } = setup();
  const text = '﻿Nom;Buida;Preferència 1;Preferència 2\r\n' +
    '"Puig Solà, Anna";;Pau Serra;\r\n' +
    '\r\n' +
    'Pau Serra;;"Diu ""hola""";Anna Puig Solà\r\n';
  const rows = plain(A.parseCsvTable(text));
  assert.equal(rows.length, 3, 'la línia en blanc es descarta');
  assert.deepEqual(rows[1], ['Puig Solà, Anna', '', 'Pau Serra', '']);
  assert.deepEqual(rows[2], ['Pau Serra', '', 'Diu "hola"', 'Anna Puig Solà']);
});

test('a quoted answer with a line break inside stays in one cell', () => {
  const { A } = setup();
  const rows = plain(A.parseCsvTable('Nom,Tria\nAnna,"Pau\nSerra"'));
  assert.deepEqual(rows[1], ['Anna', 'Pau\nSerra']);
});

test('columns are mapped from the header, skipping timestamps and empty columns', () => {
  const { A } = setup();
  const rows = [
    ['Marca de temps', 'Nom i cognoms', 'Notes', 'Preferència 1', 'Preferència 2', 'Preferència 3'],
    ['12/05/2026 9:03', 'Anna Puig', '', 'Pau Serra', 'Nil Roca', ''],
    ['12/05/2026 9:05', 'Pau Serra', '', 'Anna Puig', '', '']
  ];
  assert.equal(A.looksLikeHeader(rows), true);
  const mapping = plain(A.autoMapping(rows, true));
  assert.equal(mapping.name, 1, 'la columna del nom surt de la capçalera');
  assert.deepEqual(mapping.prefs, [3, 4, -1], 'la tercera preferencia, buida a tot el full, queda sense assignar');
  assert.deepEqual([...A.emptyColumns(rows, true)], [2, 5], 'les columnes sense dades queden marcades');
});

test('a sheet with no header falls back to the columns that look like names', () => {
  const { A } = setup();
  const rows = [['Anna Puig', 'Pau Serra', 'Nil Roca'], ['Pau Serra', 'Anna Puig', '']];
  assert.equal(A.looksLikeHeader(rows), false);
  const mapping = plain(A.autoMapping(rows, false));
  assert.equal(mapping.name, 0);
  assert.deepEqual(mapping.prefs, [1, 2, -1]);
});

test('rows without a name are discarded and a repeated answer keeps the newest', () => {
  const { A } = setup();
  const rows = [
    ['Nom', 'P1', 'P2'],
    ['Anna Puig', 'Pau Serra', ''],
    ['', 'Nil Roca', 'Pau Serra'],
    ['Anna Puig', 'Nil Roca', 'Jana Ferrer']
  ];
  const read = plain(A.readEntries(rows, true, { name: 0, prefs: [1, 2] }));
  assert.equal(read.entries.length, 1);
  assert.equal(read.nameless, 1);
  assert.equal(read.duplicates, 1);
  assert.deepEqual(read.entries[0].choices, ['Nil Roca', 'Jana Ferrer']);
});

/* ── Identificació de noms ───────────────────────────── */

test('names are matched without accents, in any order and written by halves', () => {
  const { A, data } = setup(['Anna Puig Solà', 'Pau Serra Vidal', 'Marc Roca', 'Marc Bosch']);
  const index = A.buildNameIndex(data.students);
  const find = name => A.resolveName(name, index);

  assert.equal(find('anna puig sola').student.name, 'Anna Puig Solà');
  assert.equal(find('Puig Solà, Anna').student.name, 'Anna Puig Solà', 'ordre canviat');
  assert.equal(find('Anna').student.name, 'Anna Puig Solà', 'nom de pila únic');
  assert.equal(find('Serra Vidal').student.name, 'Pau Serra Vidal');
  assert.equal(find('Marc').student, null, 'dos Marcs: cal el cognom');
  assert.equal(find('Marc').ambiguous, true);
  assert.equal(find('Marc Bosch').student.name, 'Marc Bosch');
  assert.equal(find('Joana Mas').student, null);
});

test('the roster tells apart matches, new names and students with no answer', () => {
  const { A, data } = setup(['Anna Puig', 'Pau Serra', 'Nil Roca']);
  const entries = [
    { name: 'anna puig', choices: ['Pau Serra'], studentId: null },
    { name: 'Jana Ferrer', choices: ['Anna Puig'], studentId: null }
  ];
  const match = A.matchRoster(entries, data.students);
  assert.deepEqual(plain(match.matched).map(item => item.student.name), ['Anna Puig']);
  assert.deepEqual(plain(match.fresh).map(entry => entry.name), ['Jana Ferrer']);
  assert.deepEqual(plain(match.missing).map(student => student.name), ['Pau Serra', 'Nil Roca']);

  const merged = plain(A.buildRoster('merge', match, data.students, entries));
  assert.equal(merged.students.length, 4, 'la classe conserva tothom i suma la Jana');
  const replaced = plain(A.buildRoster('replace', match, data.students, entries));
  assert.deepEqual(replaced.students.map(item => item.name), ['Anna Puig', 'Jana Ferrer']);
  assert.deepEqual(replaced.removed, ['s1', 's2']);
  const onlyKnown = plain(A.buildRoster('matched', match, data.students, entries));
  assert.deepEqual(onlyKnown.students.map(item => item.name), ['Anna Puig']);
});

test('choices become identifiers and what cannot be identified is reported', () => {
  const { A, data } = setup(['Anna Puig', 'Pau Serra']);
  const entries = [
    { name: 'Anna Puig', choices: ['Pau Serra', 'Anna Puig', 'Pau Serra', 'Joana Mas'], studentId: 's0' },
    { name: 'Pau Serra', choices: ['Anna Puig'], studentId: 's1' }
  ];
  const result = plain(A.buildPreferences(entries, data.students));
  assert.deepEqual(result.prefs.s0, ['s1'], 'ni un mateix ni tries repetides');
  assert.deepEqual(result.prefs.s1, ['s0']);
  assert.deepEqual(result.unresolved.map(item => item.name), ['Joana Mas']);
});

/* ── Mides dels equips ───────────────────────────────── */

test('the teacher decides what happens with the students left over', () => {
  const { A } = setup();
  const sizes = options => plain(A.planPreferenceSizes(26, options));

  assert.deepEqual(sizes({ mode: 'count', count: 4, remainder: 'balanced' }).sizes, [7, 7, 6, 6]);
  const own = sizes({ mode: 'count', count: 4, remainder: 'ownGroup' });
  assert.deepEqual(own.sizes, [6, 6, 6, 6, 2], 'els sobrants fan un equip a part');
  const out = sizes({ mode: 'count', count: 4, remainder: 'leaveOut' });
  assert.deepEqual(out.sizes, [6, 6, 6, 6]);
  assert.equal(out.leftover, 2, 'els sobrants es queden sense equip');

  assert.deepEqual(sizes({ mode: 'size', size: 4, remainder: 'balanced' }).sizes, [5, 5, 4, 4, 4, 4]);
  assert.deepEqual(sizes({ mode: 'size', size: 4, remainder: 'ownGroup' }).sizes, [4, 4, 4, 4, 4, 4, 2]);
  assert.deepEqual(plain(A.planPreferenceSizes(24, { mode: 'count', count: 4 })).sizes, [6, 6, 6, 6]);
  assert.equal(A.describeSizes([7, 7, 6, 6], 0), '2 equips de 7 i 2 equips de 6');
});

/* ── Repartiment i indicadors ────────────────────────── */

/** Classe on cada parella consecutiva es tria mútuament. */
function mutualClass(pairs) {
  const ids = [];
  const prefs = {};
  for (let i = 0; i < pairs * 2; i++) ids.push(`s${i}`);
  for (let i = 0; i < pairs * 2; i += 2) {
    prefs[`s${i}`] = [`s${i + 1}`];
    prefs[`s${i + 1}`] = [`s${i}`];
  }
  return { ids, prefs };
}

test('mutual choices end up in the same team and the same seed repeats the proposal', () => {
  const { A } = setup();
  const { ids, prefs } = mutualClass(6);              // 12 alumnes, 6 parelles
  const first = plain(A.optimizePreferenceGroups({ ids, prefs, sizes: [4, 4, 4], seed: 7 }));
  const second = plain(A.optimizePreferenceGroups({ ids, prefs, sizes: [4, 4, 4], seed: 7 }));
  assert.deepEqual(first.groups, second.groups, 'la mateixa llavor dóna la mateixa proposta');
  assert.deepEqual(first.groups.map(group => group.length), [4, 4, 4]);

  const stats = plain(A.preferenceStats(first.groups, prefs));
  assert.equal(stats.pct, 100, 'totes les preferències es poden acomplir');
  assert.equal(stats.mutual, 6);
  assert.equal(stats.unhappy, 0);
});

test('a separate set beats the preferences and leftovers get no team', () => {
  const { A } = setup();
  const { ids, prefs } = mutualClass(2);             // s0-s1 i s2-s3
  const result = plain(A.optimizePreferenceGroups({
    ids, prefs, sizes: [2, 2], seed: 3,
    constraints: { together: [], separate: [{ students: ['s0', 's1'] }] }
  }));
  const teamOf = id => result.groups.findIndex(group => group.includes(id));
  assert.notEqual(teamOf('s0'), teamOf('s1'), 'els separats no comparteixen equip');

  const withLeftover = plain(A.optimizePreferenceGroups({
    ids, prefs, sizes: [3], leftover: 1, seed: 5
  }));
  assert.equal(withLeftover.groups[0].length, 3);
  assert.equal(withLeftover.leftover.length, 1);
  const stats = plain(A.preferenceStats(withLeftover.groups, prefs, { leftover: withLeftover.leftover }));
  assert.equal(stats.total, 4, 'les tries de qui es queda fora també compten');
  assert.ok(stats.pct < 100);
});

test('the indicators count what each student and each team gets', () => {
  const { A } = setup(['Anna', 'Pau', 'Nil', 'Jana']);
  const prefs = { s0: ['s1', 's2'], s1: ['s0'], s2: ['s3'], s3: [] };
  const stats = plain(A.preferenceStats([['s0', 's1'], ['s2', 's3']], prefs));

  assert.deepEqual(stats.perStudent.s0, {
    met: 1, total: 2, metIds: ['s1'], missIds: ['s2'], first: true,
    avoidTotal: 0, avoidBroken: 0, avoidIds: []
  });
  assert.equal(stats.perStudent.s3.total, 0, 'qui no tria no compta com a insatisfet');
  assert.equal(stats.met, 3);
  assert.equal(stats.total, 4);
  assert.equal(stats.pct, 75);
  assert.equal(stats.answered, 3);
  assert.equal(stats.mutual, 1);
  assert.deepEqual(plain(stats.perGroup[0]),
    { met: 2, total: 3, pct: 67, mutual: 1, avoidBroken: 0, answered: 2, alone: 2, crowded: 0, alonePct: 100 });
  assert.deepEqual(plain(stats.perGroup[1]),
    { met: 1, total: 1, pct: 100, mutual: 0, avoidBroken: 0, answered: 1, alone: 1, crowded: 0, alonePct: 100 });
  assert.equal(A.matchTone(1, 2), 'medium');
  assert.equal(A.matchTone(0, 2), 'bad');
  assert.equal(A.matchTone(2, 2), 'good');
  // Amb el criteri d'una tria per alumne, dues d'acomplertes ja no és el millor.
  assert.equal(A.matchTone(1, 2, 'spread'), 'good');
  assert.equal(A.matchTone(2, 2, 'spread'), 'medium');
  assert.equal(A.matchTone(0, 2, 'spread'), 'bad');
});

test('preferences that name students out of the class are ignored by the counters', () => {
  const { A } = setup(['Anna', 'Pau']);
  const stats = plain(A.preferenceStats([['s0', 's1']], { s0: ['s1', 'fora'], s1: [] }));
  assert.equal(stats.total, 1);
  assert.equal(stats.pct, 100);
});

/* ── Columnes de separació ───────────────────────────── */

test('separation columns are told apart from the preference ones by the header', () => {
  const { A } = setup();
  const rows = [
    ['Marca de temps', 'Nom i cognoms', 'Amb qui vols treballar? (1a)', 'Amb qui vols treballar? (2a)',
     'Amb qui prefereixes NO coincidir? (Separar 1)', 'Separar 2'],
    ['12/05/2026 9:03', 'Anna Puig', 'Pau Serra', 'Nil Roca', 'Teo Mas', ''],
    ['12/05/2026 9:05', 'Pau Serra', 'Anna Puig', '', 'Jana Ferrer', 'Teo Mas']
  ];
  const mapping = plain(A.autoMapping(rows, true));
  assert.equal(mapping.name, 1);
  assert.deepEqual(mapping.prefs, [2, 3, -1], 'les de separar no es colen a les preferències');
  assert.deepEqual(mapping.avoid, [4, 5]);
  assert.equal(A.looksLikeHeader(rows), true);
});

test('a sheet with separation columns only still maps the names', () => {
  const { A } = setup();
  const rows = [
    ['Alumne/a', 'Separar 1'],
    ['Anna Puig', 'Teo Mas'],
    ['Pau Serra', '']
  ];
  const mapping = plain(A.autoMapping(rows, true));
  assert.equal(mapping.name, 0);
  assert.deepEqual(mapping.avoid, [1]);
  assert.deepEqual(mapping.prefs, [-1, -1, -1], 'no hi ha cap columna de preferència');
});

test('without a header no column is guessed as a separation', () => {
  const { A } = setup();
  const rows = [['Anna Puig', 'Pau Serra', 'Nil Roca'], ['Pau Serra', 'Anna Puig', '']];
  const mapping = plain(A.autoMapping(rows, false));
  assert.deepEqual(mapping.avoid, [], 'sense capçalera no hi ha manera de distingir-les');
  assert.deepEqual(mapping.prefs, [1, 2, -1]);
});

test('the reader keeps the separations of the newest answer and drops nameless rows', () => {
  const { A } = setup();
  const rows = [
    ['Nom', 'P1', 'Separar 1'],
    ['Anna Puig', 'Pau Serra', 'Teo Mas'],
    ['', '', 'Nil Roca'],
    ['Anna Puig', 'Nil Roca', 'Jana Ferrer'],
    ['Pau Serra', '', '']
  ];
  const read = plain(A.readEntries(rows, true, { name: 0, prefs: [1], avoid: [2] }));
  assert.equal(read.entries.length, 2);
  assert.equal(read.nameless, 1, 'una fila només amb separació però sense nom també es descarta');
  assert.equal(read.duplicates, 1);
  assert.deepEqual(read.entries[0].avoid, ['Jana Ferrer'], 'mana la resposta més nova');
  assert.deepEqual(read.entries[1].avoid, [], 'qui no en demana cap no en porta');
});

test('a sheet mapped without separation columns reads exactly as before', () => {
  const { A } = setup();
  const rows = [['Nom', 'P1'], ['Anna Puig', 'Pau Serra']];
  const read = plain(A.readEntries(rows, true, { name: 0, prefs: [1] }));
  assert.deepEqual(read.entries[0].avoid, []);
});

test('separations become identifiers and beat a choice that names the same person', () => {
  const { A, data } = setup(['Anna Puig', 'Pau Serra', 'Nil Roca']);
  const entries = [
    { name: 'Anna Puig', choices: ['Pau Serra', 'Nil Roca'], avoid: ['Pau Serra'], studentId: 's0' },
    { name: 'Pau Serra', choices: ['Anna Puig'], avoid: ['Pau Serra', 'Joana Mas'], studentId: 's1' },
    { name: 'Nil Roca', choices: [], avoid: ['anna puig'], studentId: 's2' }
  ];
  const result = plain(A.buildPreferences(entries, data.students));
  assert.deepEqual(result.prefs.s0, ['s2'], 'el Pau surt de les tries perquè el volen separar');
  assert.deepEqual(result.avoid.s0, ['s1']);
  assert.equal(result.avoid.s1, undefined, 'ningú es pot separar de si mateix');
  assert.deepEqual(result.avoid.s2, ['s0'], 'els noms es reconeixen igual que a les tries');
  assert.deepEqual(result.unresolved.map(item => item.name), ['Joana Mas'],
    'un nom de fora la classe s\'informa vingui de la columna que vingui');
  assert.equal(A.avoidLinks(result.avoid), 2);
});

/* ── Repartiment amb separacions ─────────────────────── */

test('two students who ask to be separated do not share a team', () => {
  const { A } = setup();
  const ids = ['s0', 's1', 's2', 's3'];
  const prefs = { s0: ['s1'], s1: ['s0'], s2: ['s3'], s3: ['s2'] };
  const together = plain(A.optimizePreferenceGroups({ ids, prefs, sizes: [2, 2], seed: 4 }));
  assert.equal(together.groups.some(group => group.includes('s0') && group.includes('s1')), true,
    'sense separacions les tries recíproques van juntes');

  const apart = plain(A.optimizePreferenceGroups({
    ids, prefs, avoid: { s0: ['s1'] }, sizes: [2, 2], seed: 4
  }));
  assert.equal(apart.groups.some(group => group.includes('s0') && group.includes('s1')), false,
    'una petició de separació pesa més que la tria recíproca');
});

test('what the teacher writes by hand still beats what the sheet asks', () => {
  const { A } = setup();
  const ids = ['s0', 's1', 's2', 's3'];
  const result = plain(A.optimizePreferenceGroups({
    ids, prefs: {}, avoid: { s0: ['s1'], s1: ['s0'] }, sizes: [2, 2], seed: 9,
    constraints: { together: [{ students: ['s0', 's1'] }], separate: [] }
  }));
  assert.equal(result.groups.some(group => group.includes('s0') && group.includes('s1')), true,
    'el conjunt d\'ajuntar del panell de relacions mana sobre el full');
});

test('the counters report the separations kept, the broken ones and who they pair up', () => {
  const { A } = setup(['Anna', 'Pau', 'Nil', 'Jana']);
  const prefs = { s0: ['s1'], s1: ['s0'] };
  const avoid = { s0: ['s1'], s1: ['s0'], s2: ['s3'] };
  const stats = plain(A.preferenceStats([['s0', 's1'], ['s2'], ['s3']], prefs, { avoid }));

  assert.equal(stats.avoidTotal, 3, 'les tres peticions compten, també les dues de la recíproca');
  assert.equal(stats.avoidBroken, 2);
  assert.equal(stats.avoidKept, 1);
  assert.equal(stats.avoidPct, 33);
  assert.deepEqual(stats.clashes, [['s0', 's1']], 'una parella junta surt una sola vegada');
  assert.equal(stats.perStudent.s0.avoidBroken, 1);
  assert.deepEqual(stats.perStudent.s0.avoidIds, ['s1']);
  assert.equal(stats.perStudent.s2.avoidTotal, 1);
  assert.equal(stats.perStudent.s2.avoidBroken, 0, 'el Nil i la Jana han quedat en equips diferents');
  assert.equal(stats.perGroup[0].avoidBroken, 2);
  assert.equal(stats.perGroup[1].avoidBroken, 0);
  assert.equal(stats.pct, 100, 'els indicadors de preferències no canvien');
});

test('a one-sided separation is reported once and students left out break nothing', () => {
  const { A } = setup(['Anna', 'Pau', 'Nil']);
  const shared = plain(A.preferenceStats([['s0', 's1']], {}, { avoid: { s1: ['s0'] } }));
  assert.deepEqual(shared.clashes, [['s1', 's0']]);
  assert.equal(shared.avoidBroken, 1);

  const out = plain(A.preferenceStats([['s0']], {}, { avoid: { s1: ['s2'] }, leftover: ['s1', 's2'] }));
  assert.equal(out.avoidTotal, 1);
  assert.equal(out.avoidBroken, 0, 'qui es queda sense equip no comparteix taula amb ningú');
  assert.equal(out.avoidPct, 100);
});

test('a sheet with no separations leaves every separation counter at zero', () => {
  const { A } = setup(['Anna', 'Pau']);
  const stats = plain(A.preferenceStats([['s0', 's1']], { s0: ['s1'] }));
  assert.equal(stats.avoidTotal, 0);
  assert.equal(stats.avoidBroken, 0);
  assert.equal(stats.avoidPct, null);
  assert.deepEqual(stats.clashes, []);
});
