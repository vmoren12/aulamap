const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

/** Espai de noms amb només el que relations.js necessita del nucli. */
const A = {
  REL_TOGETHER: 'together', REL_SEPARATE: 'separate',
  REL_LABEL: { together: 'Ajuntar', separate: 'Separar' },
  DESK_W: 40, DESK_H: 40,
  pluralize: (n, s) => `${n} ${s}`,
  esc: s => String(s).replaceAll('<', '&lt;'),
  uid: prefix => `${prefix}_test`,
  toast() {}, registerActions() {},
  saveWithUndo() {}, saveState() {}, renderDesks() {}, openStudentPicker() {}, focusDesks() {},
  // El panell escriu sobre aquests nodes simulats i llegeix la configuracio activa.
  el: id => (elements[id] ||= { innerHTML: '' }),
  getData: () => activeData
};
const elements = {};
let activeData = null;
const context = vm.createContext({ window: { AulaMap: A }, console });
vm.runInContext(readFileSync(path.join(root, 'assets/js/relations.js'), 'utf8'), context);

const rel = (id, type, students) => ({ id, type, students });
const together = (...ids) => rel('t', 'together', ids);
const separate = (...ids) => rel('s', 'separate', ids);
const conflicts = relations => A.findRelationContradictions({ relations });

test('empty classroom has a graph on first evaluation', () => {
  assert.equal(A.buildNeighborGraph([]).size, 0);
});

test('direct, combined and overlapping constraints', () => {
  assert.equal(conflicts([together('a', 'b'), separate('a', 'b')]).length, 1);
  assert.equal(conflicts([together('a', 'b', 'c'), separate('a', 'c')]).length, 0);
  assert.equal(conflicts([together('a', 'b', 'c'), separate('a', 'b'), separate('a', 'c')]).length, 1);
  assert.equal(conflicts([together('a', 'b'), together('b', 'c'), separate('a', 'c')]).length, 0);
  assert.equal(conflicts([together('a', 'b'), together('a', 'b', 'c'), separate('a', 'b')]).length, 1);
  assert.equal(conflicts([together('a'), separate('a', 'b')]).length, 0);
});

test('exhaustive comparison against every graph on four students', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const pairs = ids.flatMap((a, i) => ids.slice(i + 1).map(b => [a, b]));
  // Independent oracle: enumerate all possible adjacency graphs and use
  // transitive closure to check each induced together subgraph.
  const connected = (mask, members) => {
    const reach = members.map(a => members.map(b => a === b || pairs.some(([x, y], k) =>
      (mask & (1 << k)) && ((a === x && b === y) || (a === y && b === x)))));
    for (let k = 0; k < members.length; k++)
      for (let i = 0; i < members.length; i++)
        for (let j = 0; j < members.length; j++) reach[i][j] ||= reach[i][k] && reach[k][j];
    return reach.every(row => row.every(Boolean));
  };
  const subsets = Array.from({ length: 16 }, (_, mask) => ids.filter((_, i) => mask & (1 << i)))
    .filter(group => group.length >= 2);
  for (let forbidden = 0; forbidden < 64; forbidden++) {
    const separators = pairs.filter((_, k) => forbidden & (1 << k))
      .map((pair, i) => rel(`s${i}`, 'separate', pair));
    for (const a of subsets) for (const b of subsets) {
      const possible = Array.from({ length: 64 }, (_, graph) => graph).some(graph =>
        !(graph & forbidden) && connected(graph, a) && connected(graph, b));
      assert.equal(conflicts([rel('t1', 'together', a), rel('t2', 'together', b), ...separators]).length === 0,
        possible, JSON.stringify({ forbidden, a, b }));
    }
  }
});

function classroom(assignments) {
  return { students: ['a', 'b', 'c'].map(id => ({ id, name: id })),
    desks: [0, 1, 2].map(i => ({ id: `d${i}`, x: i * 60, y: 0 })),
    assignments, lockedDesks: {}, relations: [separate('a', 'b', 'c')] };
}

test('separate remains pending until all students are seated, unless already violated', () => {
  const partial = A.evaluateRelations(classroom({ d0: 'a', d2: 'b' }));
  assert.equal(partial.results[0].status, 'pend');
  assert.equal(partial.pct, null);
  assert.equal(A.evaluateRelations(classroom({ d0: 'a', d1: 'b' })).results[0].status, 'viol');
  const data = classroom({ d0: 'a', d2: 'b' });
  data.relations = [separate('a', 'b')];
  assert.equal(A.evaluateRelations(data).results[0].status, 'sat');
  data.assignments.d1 = 'c';
  data.relations = [together('a', 'b')];
  assert.equal(A.evaluateRelations(data).results[0].status, 'viol');
  data.relations = [together('a', 'b', 'c')];
  assert.equal(A.evaluateRelations(data).results[0].status, 'sat');
});

test('panel explains contradictions before seating and clears them after editing', () => {
  const data = classroom({});
  data.students[0].name = '<Anna>';
  data.relations = [together('a', 'b'), separate('a', 'b')];
  activeData = data;
  A.renderRelationsPanel();
  assert.match(elements.relConflictSummary.innerHTML, /Ajuntar 1 és incompatible amb Separar 1/);
  assert.match(elements.relConflictSummary.innerHTML, /&lt;Anna>/);
  assert.match(elements.relTogetherSets.innerHTML, /incompatible/);
  assert.match(elements.relSeparateSets.innerHTML, /incompatible/);
  data.relations.pop();
  A.renderRelationsPanel();
  assert.equal(elements.relConflictSummary.innerHTML, '');
  assert.doesNotMatch(elements.relTogetherSets.innerHTML, /incompatible/);
});

test('every unsatisfied relation explains why and offers a way to the desks', () => {
  // Pendent: encara hi ha membres sense lloc.
  const pending = classroom({ d0: 'a' });
  pending.relations = [together('a', 'b')];
  const pendingWhy = A.explainRelation(pending, A.evaluateRelations(pending).results[0]);
  assert.match(pendingWhy.text, /b no té lloc assignat/);
  assert.deepEqual(pendingWhy.deskIds, ['d0']);

  // Ajuntar incomplert perquè un company fixat bloqueja el bloc lliure.
  const blocked = classroom({ d0: 'a', d2: 'b', d1: 'c' });
  blocked.lockedDesks = { d1: true };
  blocked.relations = [together('a', 'b')];
  const blockedWhy = A.explainRelation(blocked, A.evaluateRelations(blocked).results[0]);
  assert.match(blockedWhy.text, /no hi ha cap bloc de 2 pupitres veïns disponible/i);

  // Separar incomplert: s'anomenen la parella i els cadenats que ho impedeixen.
  const adjacent = classroom({ d0: 'a', d1: 'b' });
  adjacent.lockedDesks = { d0: true, d1: true };
  adjacent.relations = [separate('a', 'b')];
  const adjacentWhy = A.explainRelation(adjacent, A.evaluateRelations(adjacent).results[0]);
  assert.match(adjacentWhy.text, /seuen en pupitres veïns: a i b/i);
  assert.match(adjacentWhy.text, /fixats amb cadenat/);
  assert.deepEqual(adjacentWhy.deskIds.sort(), ['d0', 'd1']);

  // Una relació complerta no necessita cap explicació.
  const fine = classroom({ d0: 'a', d2: 'b' });
  fine.relations = [separate('a', 'b')];
  assert.equal(A.explainRelation(fine, A.evaluateRelations(fine).results[0]), null);
});

test('relations panel uses declarative actions, not global handlers', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const panel = html.split('id="panel-relacions"')[1].split('<!-- DISSENY -->')[0];
  assert.equal((panel.match(/data-action="relAddSet"/g) || []).length, 2);
  assert.doesNotMatch(panel, /relAddSetWithStudents/);
  assert.doesNotMatch(html, /\son(click|change|input|pointerdown|dragstart|drop)=/);
});
