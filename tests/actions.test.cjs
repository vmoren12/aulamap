const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

/**
 * Carrega tots els mòduls (excepte l'arrencada) en un context sense DOM: cap
 * d'ells toca la pàgina mentre es carrega, només registra accions i funcions.
 */
function loadNamespace() {
  const store = {};
  const context = vm.createContext({
    window: { AulaMap: {}, addEventListener() {} },
    document: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem: (k, v) => { store[k] = v; } },
    console, setTimeout: () => {}
  });
  for (const file of ['core', 'state', 'profiles', 'students', 'relations', 'seating',
                      'autoassign', 'teams', 'teamscanvas', 'preferences', 'exports', 'ui', 'canvasselection']) {
    vm.runInContext(readFileSync(path.join(root, `assets/js/${file}.js`), 'utf8'), context);
  }
  return vm.runInContext('window.AulaMap', context);
}

/** Noms d'acció escrits a l'HTML de la pàgina i al que generen els mòduls. */
function declaredActions() {
  const found = new Map();
  const scan = (source, where) => {
    for (const m of source.matchAll(/data-(?:action|change|input|dblclick|keydown|press)="([^"${]+)"/g)) {
      if (!found.has(m[1])) found.set(m[1], where);
    }
  };
  scan(readFileSync(path.join(root, 'index.html'), 'utf8'), 'index.html');
  for (const file of readdirSync(path.join(root, 'assets/js'))) {
    scan(readFileSync(path.join(root, 'assets/js', file), 'utf8'), file);
  }
  return found;
}

test('every action declared in the interface has a registered handler', () => {
  const registered = new Set(loadNamespace().actionNames());
  assert.ok(registered.size > 40, `només hi ha ${registered.size} accions registrades`);
  const missing = [...declaredActions()]
    .filter(([name]) => !registered.has(name))
    .map(([name, where]) => `${name} (${where})`);
  assert.deepEqual(missing, [], 'accions sense gestor');
});

test('the modules expose the namespace instead of global functions', () => {
  const A = loadNamespace();
  for (const name of ['getData', 'renderDesks', 'renderTeamsCanvas', 'evaluateRelations',
                      'explainRelation', 'moveStudentsToTeam', 'removeDesksByIds', 'importCsvText',
                      'toggleTheme', 'focusDesks', 'tableSelection', 'getCanvasData', 'arrangeTeamDesks']) {
    assert.ok(A[name] !== undefined, `${name} no és a l'espai de noms`);
  }
});

/* ── Senyal d'espera dels botons ─────────────────────── */

/** Només el nucli, amb les passades de pintat a la mà. */
function loadCoreWithFrames() {
  const frames = [];
  const context = vm.createContext({
    window: { AulaMap: {}, addEventListener() {} },
    document: { addEventListener() {} },
    requestAnimationFrame: fn => frames.push(fn),
    console, setTimeout: () => {}
  });
  vm.runInContext(readFileSync(path.join(root, 'assets/js/core.js'), 'utf8'), context);
  return { A: vm.runInContext('window.AulaMap', context), frames };
}

/** Botó de mentida amb el mínim que llegeix runBusy. */
function fakeButton() {
  const classes = new Set();
  const attributes = new Map();
  return {
    innerHTML: '<span>Formar equips</span>', disabled: false, isConnected: true,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name)
    },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    getAttribute: name => attributes.get(name) ?? null
  };
}

test('a long job leaves the button waiting and gives it back afterwards', () => {
  const { A, frames } = loadCoreWithFrames();
  const button = fakeButton();
  const original = button.innerHTML;
  let seen = null;

  A.runBusy(button, 'Formant equips…', () => {
    seen = { html: button.innerHTML, disabled: button.disabled };
  });
  assert.equal(button.disabled, true, 'el botó queda desactivat de seguida');
  assert.ok(button.classList.contains('is-busy'));
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.match(button.innerHTML, /btn-spinner/);
  assert.match(button.innerHTML, /Formant equips…/);
  assert.equal(seen, null, 'la feina espera que el canvi es pinti');

  frames.shift()();
  assert.equal(seen, null, 'encara no: calen dues passades de pintat');
  frames.shift()();
  assert.equal(seen.disabled, true, 'la feina es fa amb el botó ocupat');
  assert.match(seen.html, /btn-spinner/);
  assert.equal(button.innerHTML, original, 'i el botó torna com era');
  assert.equal(button.disabled, false);
  assert.equal(button.classList.contains('is-busy'), false);
  assert.equal(button.getAttribute('aria-busy'), null);
});

test('a button that is gone when the job ends is left alone', () => {
  const { A, frames } = loadCoreWithFrames();
  const button = fakeButton();
  // Els modals es repinten sencers: el botó premut ja no és a la pàgina.
  A.runBusy(button, 'Provant-ho…', () => { button.isConnected = false; });
  frames.shift()();
  frames.shift()();
  assert.match(button.innerHTML, /Provant-ho…/, 'no es toca res del que ja no hi és');
});

test('without a browser the job runs right away', () => {
  const A = loadNamespace();
  let done = false;
  A.runBusy(null, 'Formant equips…', () => { done = true; });
  assert.equal(done, true);
});

test('the interface keeps no inline event handlers', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\son[a-z]+="/, 'index.html no ha de tenir atributs on*');
  for (const file of readdirSync(path.join(root, 'assets/js'))) {
    const source = readFileSync(path.join(root, 'assets/js', file), 'utf8');
    assert.doesNotMatch(source, /\son(click|change|input|pointerdown|dblclick|keydown)="/,
      `${file} genera HTML amb atributs on*`);
    assert.match(source, /\}\)\(window\.AulaMap\);/, `${file} ha de tancar-se sobre l'espai de noms`);
  }
});
