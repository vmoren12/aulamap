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
