const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');

/** Espai de noms amb només el que state.js necessita del nucli. */
const A = {
  STORAGE_KEY: 'test', LEGACY_KEYS: {}, THEME_KEY: 'theme',
  REL_TOGETHER: 'together', REL_SEPARATE: 'separate',
  el: () => ({ disabled: false }), uid: prefix => `${prefix}_test`, toast() {}, registerActions() {}
};
const context = vm.createContext({
  window: { AulaMap: A }, localStorage: { getItem: () => null, setItem() {} }, console
});
vm.runInContext(readFileSync(path.join(__dirname, '../assets/js/state.js'), 'utf8'), context);

test('old saved formations load without borrowing classroom seats', () => {
  const input = { students: [{ id: 's' }], desks: [{ id: 'class', x: 10, y: 20 }], assignments: { class: 's' },
    teams: { groups: [['s']], saved: [{ groups: [['s']] }] } };
  const normalized = A.normalizeConfigData(input);
  assert.equal(normalized.teams.layout, null);
  assert.equal(normalized.teams.saved[0].layout, null);
  assert.deepEqual(Array.from(normalized.desks), input.desks);
  assert.deepEqual({ ...normalized.assignments }, input.assignments);
});

test('saved layouts retain distinct coordinates and sanitize stale or duplicate members', () => {
  const first = { desks: [{ id: 't1', x: 30, y: 40 }], assignments: { t1: 's' } };
  const second = { desks: [{ id: 't2', x: 500, y: 80 }, { id: 'dup', x: 0, y: 0 },
    { id: 'gone', x: 0, y: 0 }, null], assignments: { t2: 's', dup: 's', gone: 'removed' } };
  const data = A.normalizeConfigData({ students: [{ id: 's' }],
    teams: { groups: [['s']], layout: first, saved: [{ groups: [['s']], layout: first }, { groups: [['s']], layout: second }] } });
  assert.equal(data.teams.saved[0].layout.desks[0].x, 30);
  assert.equal(data.teams.saved[1].layout.desks[0].x, 500);
  assert.equal(data.teams.saved[1].layout.desks.length, 1);
  data.teams.layout.desks[0].x = 1000;
  assert.equal(data.teams.saved[0].layout.desks[0].x, 30);
});

/** Converteix les estructures que tornen del context aïllat a objectes plans. */
const plain = value => JSON.parse(JSON.stringify(value));

test('the stored answers keep the separations and drop the names that no longer exist', () => {
  const data = A.normalizeConfigData({
    students: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    teams: {
      preferences: {
        updated: '01/09/2026 10:00', source: 'formulari.csv',
        prefs: { a: ['b', 'fora'] },
        avoid: { b: ['c', 'b', 'fora'], fora: ['a'] },
        unresolved: ['Berta Soler'],
        best: { groups: [['a', 'b'], ['fora']], pct: 80, broken: 1, updated: '01/09/2026 10:00' }
      }
    }
  });
  const stored = data.teams.preferences;
  assert.deepEqual(plain(stored.prefs), { a: ['b'] });
  assert.deepEqual(plain(stored.avoid), { b: ['c'] }, 'ni un mateix ni identificadors morts');
  assert.deepEqual(plain(stored.best.groups), [['a', 'b']]);
  assert.equal(stored.best.broken, 1);
});

test('a sheet that only asked who to separate is still worth keeping', () => {
  const data = A.normalizeConfigData({
    students: [{ id: 'a' }, { id: 'b' }],
    teams: { preferences: { prefs: {}, avoid: { a: ['b'] }, unresolved: [] } }
  });
  assert.ok(data.teams.preferences, 'sense cap tria, les separacions ja justifiquen desar-ho');
  assert.deepEqual(plain(data.teams.preferences.avoid), { a: ['b'] });

  const empty = A.normalizeConfigData({
    students: [{ id: 'a' }],
    teams: { preferences: { prefs: { a: ['fantasma'] }, avoid: {}, unresolved: [] } }
  });
  assert.equal(empty.teams.preferences, null, 'sense res aprofitable no es desa res');
});
