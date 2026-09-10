const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const context = vm.createContext({ localStorage: { getItem: () => null }, STORAGE_KEY: 'test', LEGACY_KEYS: {},
  REL_TOGETHER: 'together', REL_SEPARATE: 'separate' });
vm.runInContext(readFileSync(path.join(__dirname, '../assets/js/state.js'), 'utf8'), context);

test('old saved formations load without borrowing classroom seats', () => {
  const input = { students: [{ id: 's' }], desks: [{ id: 'class', x: 10, y: 20 }], assignments: { class: 's' },
    teams: { groups: [['s']], saved: [{ groups: [['s']] }] } };
  const normalized = context.normalizeConfigData(input);
  assert.equal(normalized.teams.layout, null);
  assert.equal(normalized.teams.saved[0].layout, null);
  assert.deepEqual(normalized.desks, input.desks);
  assert.deepEqual(normalized.assignments, input.assignments);
});

test('saved layouts retain distinct coordinates and sanitize stale or duplicate members', () => {
  const first = { desks: [{ id: 't1', x: 30, y: 40 }], assignments: { t1: 's' } };
  const second = { desks: [{ id: 't2', x: 500, y: 80 }, { id: 'dup', x: 0, y: 0 },
    { id: 'gone', x: 0, y: 0 }, null], assignments: { t2: 's', dup: 's', gone: 'removed' } };
  const data = context.normalizeConfigData({ students: [{ id: 's' }],
    teams: { groups: [['s']], layout: first, saved: [{ groups: [['s']], layout: first }, { groups: [['s']], layout: second }] } });
  assert.equal(data.teams.saved[0].layout.desks[0].x, 30);
  assert.equal(data.teams.saved[1].layout.desks[0].x, 500);
  assert.equal(data.teams.saved[1].layout.desks.length, 1);
  data.teams.layout.desks[0].x = 1000;
  assert.equal(data.teams.saved[0].layout.desks[0].x, 30);
});
