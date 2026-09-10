const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(view = 'aula') {
  const listeners = new Map();
  const node = (id = '') => ({
    dataset: { did: id, teamIdx: id }, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { const key = this === area ? type : `doc:${type}`; listeners.set(key, [...(listeners.get(key) || []), fn]); },
    setPointerCapture() {}, hasPointerCapture: () => false, appendChild() {}, remove() {},
    closest: () => null,
    getBoundingClientRect: () => ({ left: Number(id) * 100, top: 0, right: Number(id) * 100 + 90, bottom: 60 })
  });
  const area = node();
  const nodes = [node('0'), node('1'), node('2')];
  const desks = [{ id: '0', x: 15, y: 20 }, { id: '1', x: 121, y: 25 }, { id: '2', x: 250, y: 20 }];
  const data = { desks, layoutType: 'rows' };
  const teams = { positions: Object.fromEntries(desks.map(d => [d.id, { x: d.x, y: d.y }])) };
  const counters = { undo: 0, save: 0 };
  const container = { querySelectorAll: () => nodes };
  const document = { ...node(), querySelectorAll: () => nodes, createElement: () => node() };
  const context = vm.createContext({ document, window: node(), setTimeout: () => {},
    el: id => id.endsWith('Container') ? container : area,
    getData: () => data, getTeams: () => teams, isModalOpen: () => false,
    pushUndo: () => counters.undo++, saveState: () => counters.save++,
    renderLayoutOptions() {}, renderDesks() {}, renderTeamsCanvas() {}, drawRelationLines() {} });
  for (const file of ['ui', 'canvasselection']) vm.runInContext(readFileSync(path.join(__dirname, `../assets/js/${file}.js`), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  run(`currentCanvasView = '${view}'`);
  const event = (extra = {}) => ({ button: 0, pointerId: 1, clientX: 0, clientY: 0, target: node(), preventDefault() {}, stopPropagation() {}, ...extra });
  const fire = (type, extra) => { const e = event(extra); (listeners.get(type) || []).forEach(fn => fn(e)); return e; };
  return { context, run, event, fire, data, teams, counters, nodes };
}

for (const view of ['aula', 'equips']) test(`${view}: group movement respects zoom, spacing, boundaries and one undo`, () => {
  const h = setup(view);
  h.run("zoomLevel = 0.5; tableSelection.add('0'); tableSelection.add('1');");
  h.context.startTableMove(h.event(), '0');
  h.context.moveTableGesture(h.event({ clientX: 20, clientY: 10 }));
  const positions = view === 'aula' ? h.data.desks : h.teams.positions;
  assert.equal(positions[0].x, 55);
  assert.equal(positions[1].x, 161);
  assert.equal(positions[2].x, 250);
  h.context.moveTableGesture(h.event({ clientX: -100, clientY: -100 }));
  assert.equal(positions[0].x, 0);
  assert.equal(positions[1].x, 106);
  assert.equal(positions[1].y, 5);
  h.context.endTableGesture(h.event());
  assert.deepEqual(h.counters, { undo: 1, save: 1 });
});

test('click without movement neither saves nor changes layout', () => {
  const h = setup();
  h.context.startTableMove(h.event(), '0');
  h.context.moveTableGesture(h.event({ clientX: 2 }));
  h.context.endTableGesture(h.event());
  assert.deepEqual(h.counters, { undo: 0, save: 0 });
  assert.equal(h.data.layoutType, 'rows');
});

test('reverse marquee, additive selection and background deselection', () => {
  const h = setup();
  h.context.initTableSelection();
  h.fire('pointerdown', { clientX: 195, clientY: 70 });
  h.fire('pointermove', { clientX: 0, clientY: 0 });
  h.fire('pointerup');
  assert.equal(h.run("[...tableSelection].join(',')"), '0,1');
  h.fire('pointerdown', { clientX: 220, clientY: 0, shiftKey: true });
  h.fire('pointermove', { clientX: 295, clientY: 70 });
  h.fire('pointerup');
  assert.equal(h.run('tableSelection.size'), 3);
  h.fire('pointerdown');
  h.fire('pointerup');
  assert.equal(h.run('tableSelection.size'), 0);
});

test('mouse pans only with space; typing space leaves canvas alone', () => {
  const h = setup();
  h.context.initCanvasInteractions();
  h.fire('pointerdown');
  h.fire('pointermove', { clientX: 100 });
  h.fire('pointerup');
  assert.equal(h.run('panX'), 0);
  h.fire('doc:keydown', { code: 'Space', target: { closest: () => ({}) } });
  assert.equal(h.run('spaceHeld'), false);
  h.fire('doc:keydown', { code: 'Space' });
  h.fire('pointerdown');
  h.fire('pointermove', { clientX: 100 });
  h.fire('pointerup');
  assert.equal(h.run('panX'), 100);
  assert.equal(h.run('tableGesture'), null);
  h.fire('doc:keyup', { code: 'Space' });
  assert.equal(h.run('spaceHeld'), false);
});

test('modifier click toggles a table without starting movement', () => {
  const h = setup();
  h.context.initTableSelection();
  const target = { closest: selector => selector === '.desk,.team-table' ? h.nodes[1] : null };
  h.fire('pointerdown', { target, ctrlKey: true });
  assert.equal(h.run("tableSelection.has('1')"), true);
  assert.equal(h.run('tableGesture'), null);
  h.fire('pointerdown', { target, shiftKey: true });
  assert.equal(h.run('tableSelection.size'), 0);
});

test('cancellation cleans up movement and ignores other pointers', () => {
  const h = setup();
  h.context.initTableSelection();
  h.context.startTableMove(h.event(), '0');
  h.fire('pointermove', { pointerId: 2, clientX: 100 });
  assert.equal(h.data.desks[0].x, 15);
  h.fire('pointercancel', { pointerId: 2 });
  assert.notEqual(h.run('tableGesture'), null);
  h.fire('pointercancel');
  assert.equal(h.run('tableGesture'), null);
  assert.deepEqual(h.counters, { undo: 0, save: 0 });
});
