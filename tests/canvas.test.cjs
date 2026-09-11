const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(view = 'aula') {
  const listeners = new Map();
  const node = (id = '') => ({
    dataset: { did: id, teamIdx: id }, style: {}, innerHTML: '', hidden: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { const key = this === area ? type : `doc:${type}`; listeners.set(key, [...(listeners.get(key) || []), fn]); },
    setPointerCapture() {}, hasPointerCapture: () => false, appendChild() {}, remove() {},
    closest: () => null,
    focus() { document.activeElement = this; },
    getBoundingClientRect: () => ({ left: Number(id) * 100, top: 0, right: Number(id) * 100 + 90, bottom: 60 })
  });
  const area = node();
  const nodes = [node('0'), node('1'), node('2')];
  const desks = [{ id: '0', x: 15, y: 20 }, { id: '1', x: 121, y: 25 }, { id: '2', x: 250, y: 20 }];
  const data = { desks, layoutType: 'rows' };
  const teams = { layout: { desks: desks.map(d => ({ ...d })), assignments: {} }, groups: [], lockedTeams: {} };
  const counters = { undo: 0, save: 0, removed: 0 };
  const container = { querySelectorAll: () => nodes };
  const document = { ...node(), querySelectorAll: () => nodes, createElement: () => node() };

  // Espai de noms amb només el que ui.js i canvasselection.js necessiten.
  const A = {
    THEME_KEY: 'aulamap_theme', DESK_W: 100, DESK_H: 64,
    flags: { spaceHeld: false, suppressClick: false },
    el: id => id.endsWith('Container') ? container : area,
    esc: s => String(s), toast() {}, isMobile: () => false,
    pluralize: (n, s) => `${n} ${s}`, appConfirm() {}, isModalOpen: () => false,
    registerActions() {}, getData: () => data, getTeams: () => teams,
    getCanvasData: () => (A.view.current === 'equips' ? teams.layout : data),
    getTeamLayout: () => teams.layout, teamName: index => `Equip ${index + 1}`,
    pushUndo: () => counters.undo++, saveState: () => counters.save++,
    removeSelectedDesks: () => counters.removed++,
    renderLayoutOptions() {}, renderDesks() {}, renderTeamsCanvas() {}, renderTeamOverlays() {}, drawRelationLines() {},
    renderDocentSelect() {}, renderConfigSelect() {}, undo() {}, redo() {}
  };
  const windowStub = { ...node(), AulaMap: A };
  const context = vm.createContext({ document, window: windowStub, setTimeout: () => {}, console });
  for (const file of ['ui', 'canvasselection']) {
    vm.runInContext(readFileSync(path.join(__dirname, `../assets/js/${file}.js`), 'utf8'), context);
  }
  A.view.current = view;

  const event = (extra = {}) => ({ button: 0, pointerId: 1, clientX: 0, clientY: 0, target: node(), preventDefault() {}, stopPropagation() {}, ...extra });
  const fire = (type, extra) => { const e = event(extra); (listeners.get(type) || []).forEach(fn => fn(e)); return e; };
  return { A, event, fire, data, teams, counters, nodes, document, area };
}

for (const view of ['aula', 'equips']) test(`${view}: group movement respects zoom, spacing, boundaries and one undo`, () => {
  const h = setup(view);
  h.A.view.zoom = 0.5;
  h.A.tableSelection.add('0');
  h.A.tableSelection.add('1');
  h.A.startTableMove(h.event(), '0');
  h.A.moveTableGesture(h.event({ clientX: 20, clientY: 10 }));
  const positions = view === 'equips' ? h.teams.layout.desks : h.data.desks;
  assert.equal(positions[0].x, 55);
  assert.equal(positions[1].x, 161);
  assert.equal(positions[2].x, 250);
  h.A.moveTableGesture(h.event({ clientX: -100, clientY: -100 }));
  assert.equal(positions[0].x, 0);
  assert.equal(positions[1].x, 106);
  assert.equal(positions[1].y, 5);
  h.A.endTableGesture(h.event());
  assert.deepEqual(h.counters, { undo: 1, save: 1, removed: 0 });
});

test('the classroom keeps its desks while the teams diagram moves', () => {
  const h = setup('equips');
  const classroom = JSON.stringify(h.data.desks);
  h.A.tableSelection.add('0');
  h.A.startTableMove(h.event(), '0');
  h.A.moveTableGesture(h.event({ clientX: 40, clientY: 40 }));
  h.A.endTableGesture(h.event());
  assert.equal(JSON.stringify(h.data.desks), classroom);
  assert.equal(h.teams.layout.desks[0].x, 55);
});

test('click without movement neither saves nor changes layout', () => {
  const h = setup();
  h.A.startTableMove(h.event(), '0');
  h.A.moveTableGesture(h.event({ clientX: 2 }));
  h.A.endTableGesture(h.event());
  assert.deepEqual(h.counters, { undo: 0, save: 0, removed: 0 });
  assert.equal(h.data.layoutType, 'rows');
});

test('reverse marquee, additive selection and background deselection', () => {
  const h = setup();
  h.A.initTableSelection();
  h.fire('pointerdown', { clientX: 195, clientY: 70 });
  h.fire('pointermove', { clientX: 0, clientY: 0 });
  h.fire('pointerup');
  assert.equal([...h.A.tableSelection].join(','), '0,1');
  h.fire('pointerdown', { clientX: 220, clientY: 0, shiftKey: true });
  h.fire('pointermove', { clientX: 295, clientY: 70 });
  h.fire('pointerup');
  assert.equal(h.A.tableSelection.size, 3);
  h.fire('pointerdown');
  h.fire('pointerup');
  assert.equal(h.A.tableSelection.size, 0);
});

test('mouse pans only with space; typing space leaves canvas alone', () => {
  const h = setup();
  h.A.initCanvasInteractions();
  h.fire('pointerdown');
  h.fire('pointermove', { clientX: 100 });
  h.fire('pointerup');
  assert.equal(h.A.view.panX, 0);
  h.fire('doc:keydown', { code: 'Space', target: { closest: () => ({}) } });
  assert.equal(h.A.flags.spaceHeld, false);
  h.fire('doc:keydown', { code: 'Space' });
  h.fire('pointerdown');
  h.fire('pointermove', { clientX: 100 });
  h.fire('pointerup');
  assert.equal(h.A.view.panX, 100);
  assert.equal(h.A.isTableGesture(), false);
  h.fire('doc:keyup', { code: 'Space' });
  assert.equal(h.A.flags.spaceHeld, false);
});

test('modifier click toggles a table without starting movement', () => {
  const h = setup();
  h.A.initTableSelection();
  const target = { closest: selector => selector === '.desk' ? h.nodes[1] : null };
  h.fire('pointerdown', { target, ctrlKey: true });
  assert.equal(h.A.tableSelection.has('1'), true);
  assert.equal(h.A.isTableGesture(), false);
  h.fire('pointerdown', { target, shiftKey: true });
  assert.equal(h.A.tableSelection.size, 0);
});

test('cancellation cleans up movement and ignores other pointers', () => {
  const h = setup();
  h.A.initTableSelection();
  h.A.startTableMove(h.event(), '0');
  h.fire('pointermove', { pointerId: 2, clientX: 100 });
  assert.equal(h.data.desks[0].x, 15);
  h.fire('pointercancel', { pointerId: 2 });
  assert.equal(h.A.isTableGesture(), true);
  h.fire('pointercancel');
  assert.equal(h.A.isTableGesture(), false);
  assert.deepEqual(h.counters, { undo: 0, save: 0, removed: 0 });
});

test('canvas click releases a previously focused button; space cannot repeat its action', () => {
  const h = setup();
  h.A.initCanvasInteractions();
  h.document.activeElement = { tagName: 'BUTTON' };
  h.fire('pointerdown');
  h.fire('pointerup');
  assert.equal(h.document.activeElement, h.area);
  let prevented = false;
  h.fire('doc:keydown', { code: 'Space', target: { closest: () => null }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.A.flags.spaceHeld, true);
  prevented = false;
  h.fire('doc:keyup', { code: 'Space', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('the Delete key sends the selection to the shared trash', () => {
  const h = setup();
  h.A.initKeyboardShortcuts();
  h.fire('doc:keydown', { key: 'Delete' });
  assert.equal(h.counters.removed, 0, 'sense selecció no esborra res');
  h.A.tableSelection.add('0');
  h.fire('doc:keydown', { key: 'Delete' });
  assert.equal(h.counters.removed, 1);
});
