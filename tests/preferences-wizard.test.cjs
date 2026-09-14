const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

/**
 * Recorregut complet de l'assistent amb un DOM simulat: cada node és un objecte
 * amb els camps que llegeix el codi (`value`, `checked`, `innerHTML`...), i les
 * accions es criden com ho faria la delegació d'esdeveniments.
 */
function setupWizard(names) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id, value: '', checked: false, innerHTML: '', textContent: '', disabled: false,
        style: {}, dataset: {}, files: [],
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false }
      });
    }
    return nodes.get(id);
  };

  const data = {
    centreName: 'Institut', curs: '2025-2026', nivell: '1r ESO', aula: 'A12',
    students: names.map((name, index) => ({ id: `s${index}`, name, color: '#000' })),
    relations: [], desks: [], assignments: {}, lockedDesks: {},
    teams: {
      studentsPerGroup: 2, remainderMode: null, competencies: {}, useCompetency: false,
      preferences: null, groups: null, teamNames: {}, positions: {}, layout: null,
      lockedTeams: {}, lockedStudents: {}, constraints: { together: [], separate: [] },
      saved: [], activeSaved: null
    }
  };
  const entry = { configurations: [{ name: 'Configuració 1', data }], currentConfig: 0 };
  const calls = { toast: [], modals: [], renders: 0, arranged: 0, views: [], guarded: 0 };
  let counter = 0;

  const A = {
    DESK_W: 100, DESK_H: 64, REL_TOGETHER: 'together', REL_SEPARATE: 'separate',
    COLORS: ['#111', '#222', '#333'],
    el: node, esc: value => String(value), uid: prefix => `${prefix}_${++counter}`,
    pluralize: (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`,
    toast: (message, kind) => calls.toast.push([message, kind]),
    openModal: html => calls.modals.push(html),
    closeModal() {}, focusModalField() {}, appConfirm: (t, m, run) => run(),
    registerActions: map => Object.assign(A.actions, map),
    actions: {},
    getData: () => entry.configurations[entry.currentConfig].data,
    getTeams: () => entry.configurations[entry.currentConfig].data.teams,
    currentDocentEntry: () => entry,
    defaultConfigData: () => ({
      centreName: '', curs: '', nivell: '', aula: '', students: [], relations: [],
      desks: [], assignments: {}, lockedDesks: {},
      teams: { competencies: {}, preferences: null, groups: null, teamNames: {}, positions: {},
               lockedTeams: {}, lockedStudents: {}, constraints: { together: [], separate: [] },
               saved: [], activeSaved: null }
    }),
    studentName: id => A.getData().students.find(student => student.id === id)?.name || '?',
    removeStudentFromRelations(config, id) {
      config.relations = config.relations.filter(relation => !relation.students.includes(id));
    },
    removeStudentFromTeams() {},
    saveWithUndo() {}, saveState() {}, pushUndo() {},
    renderAll: () => { calls.renders++; },
    renderTeamsPanel() {}, renderTeamsCanvas() {},
    arrangeTeamDesks: () => { calls.arranged++; },
    guardUnsavedTeams: run => { calls.guarded++; run(); },
    switchCanvasView: view => { A.view.current = view; calls.views.push(view); },
    zoomReset() {}, view: { current: 'aula' }, downloadBlob() {}
  };

  const context = vm.createContext({
    window: { AulaMap: A }, document: { addEventListener() {} }, console,
    setTimeout: fn => fn()
  });
  for (const file of ['exports', 'preferences']) {
    vm.runInContext(readFileSync(path.join(root, `assets/js/${file}.js`), 'utf8'), context);
  }

  const run = (name, dataset = {}, extra = {}) => {
    const handler = A.actions[name];
    assert.ok(handler, `acció desconeguda: ${name}`);
    handler({ dataset, value: '', checked: false, ...extra });
  };
  return { A, data, entry, calls, node, run, lastModal: () => calls.modals[calls.modals.length - 1] };
}

/** Full de respostes amb capçalera, una columna buida i un nom de fora la classe. */
const SHEET = [
  'Marca de temps;Nom i cognoms;Comentaris;Preferència 1;Preferència 2;Preferència 3',
  '12/05/2026 9:01;Anna Puig Solà;;Pau Serra Vidal;Nil Roca Camps;Jana Ferrer Mas',
  '12/05/2026 9:02;Pau Serra Vidal;;Anna Puig Solà;Nil Roca Camps;',
  '12/05/2026 9:03;Nil Roca Camps;;Pau Serra Vidal;Anna Puig Solà;',
  '12/05/2026 9:04;"Ferrer Mas, Jana";;Anna Puig Solà;;',
  '12/05/2026 9:05;Lluc Vidal Pons;;Ona Camps Roig;Jana Ferrer Mas;',
  '12/05/2026 9:06;Ona Camps Roig;;Lluc Vidal Pons;Berta Soler;',
  '12/05/2026 9:07;Teo Mas Grau;;Lluc Vidal Pons;Ona Camps Roig;'
].join('\r\n');

const CLASS = ['Anna Puig Solà', 'Pau Serra Vidal', 'Nil Roca Camps', 'Jana Ferrer Mas',
               'Lluc Vidal Pons', 'Ona Camps Roig', 'Marta Gil Puig'];

/** Porta l'assistent fins al pas de configuració dels equips. */
function openSheet(helper, rosterMode) {
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = SHEET;
  helper.run('prefReadSource');
  helper.run('prefColumnsNext');
  if (rosterMode) helper.run('prefSetRosterMode', {}, { value: rosterMode });
  helper.run('prefStudentsNext');
}

test('the wizard reads the sheet, maps the columns and shows the preview', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = SHEET;
  helper.run('prefReadSource');

  const html = helper.lastModal();
  assert.match(html, /7 files de dades i 6 columnes/);
  assert.match(html, /Nom i cognoms/);
  assert.match(html, /Preferència 3/);
  assert.match(html, /pref-col-name/, 'la columna del nom queda destacada');
});

test('the third step counts matches, new names and students with no answer', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = SHEET;
  helper.run('prefReadSource');
  helper.run('prefColumnsNext');

  const html = helper.lastModal();
  // Sis respostes coincideixen (una amb l'ordre del nom canviat), Teo és nou i
  // la Marta no ha respost. "Berta Soler" no és de la classe.
  assert.match(html, /<b>6<\/b><span>coincideixen/);
  assert.match(html, /<b>1<\/b><span>noms nous/);
  assert.match(html, /<b>1<\/b><span>alumnes sense resposta/);
  assert.match(html, /Berta Soler/);
  assert.match(html, /Marta Gil Puig/);
});

test('an unfinished step will not move on', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.run('prefReadSource');
  assert.match(helper.calls.toast.at(-1)[0], /Carrega un fitxer/);

  helper.node('prefText').value = SHEET;
  helper.run('prefReadSource');
  helper.run('prefSetColumn', { role: 'name' }, { value: '-1' });
  helper.run('prefColumnsNext');
  assert.match(helper.calls.toast.at(-1)[0], /quina columna té el nom/);
});

test('the proposal fills the teams, can be repeated and lands on the teams panel', () => {
  const helper = setupWizard(CLASS);
  openSheet(helper, 'merge');

  helper.run('prefSetPlanMode', { value: 'count' });
  helper.run('prefSetPlanValue', {}, { value: '2' });
  const plan = helper.lastModal();
  assert.match(plan, /2 equips de 4/, '8 alumnes en dos equips de quatre');

  helper.run('prefGenerate');
  assert.match(helper.lastModal(), /Preferències acomplertes/);
  helper.run('prefGenerateAgain');
  assert.match(helper.lastModal(), /proposta 2 de 2/);

  helper.run('prefApply');
  const teams = helper.data.teams;
  assert.equal(teams.groups.length, 2);
  assert.deepEqual(Array.from(teams.groups, group => group.length), [4, 4]);
  assert.equal(helper.data.students.length, 8, 'el Teo s\'afegeix a la classe');
  assert.ok(teams.preferences, 'les preferències queden desades');
  assert.deepEqual(Array.from(teams.preferences.unresolved), ['Berta Soler']);
  assert.equal(teams.studentsPerGroup, 4);
  assert.equal(helper.calls.arranged, 1, 'l\'esquema d\'equips es reordena');
  assert.equal(helper.calls.guarded, 1, 'es pregunta pels equips desats amb canvis');
  assert.deepEqual(helper.calls.views, ['equips']);

  // Els indicadors ja es poden pintar al panell lateral.
  const view = helper.A.preferenceTeamView(teams.groups);
  assert.ok(view.summary.includes('%'));
  assert.match(view.member(teams.groups[0][0]), /pref-chip/);
  helper.A.renderPreferencePanel();
  assert.match(helper.node('teamPrefStatus').innerHTML, /respostes carregades/);
});

test('replacing the class removes the students with no answer', () => {
  const helper = setupWizard(CLASS);
  openSheet(helper, 'replace');
  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');
  helper.run('prefApply');

  const names = Array.from(helper.data.students, student => student.name);
  assert.equal(names.includes('Marta Gil Puig'), false, 'qui no surt al full marxa de la classe');
  assert.equal(names.includes('Teo Mas Grau'), true);
  assert.equal(names.length, 7);
});

test('a new configuration leaves the current class untouched', () => {
  const helper = setupWizard(CLASS);
  openSheet(helper, 'newConfig');
  helper.node('prefConfigName').value = 'Sortida de tardor';
  helper.run('prefSetConfigName', {}, { value: 'Sortida de tardor' });
  helper.run('prefSetPlanMode', { value: 'size' });
  helper.run('prefSetPlanValue', {}, { value: '3' });
  helper.run('prefSetRemainder', { value: 'ownGroup' });
  helper.run('prefGenerate');
  helper.run('prefApply');

  assert.equal(helper.calls.guarded, 0, 'una configuració nova no toca els equips actuals');
  assert.equal(helper.entry.configurations.length, 2);
  assert.equal(helper.entry.configurations[1].name, 'Sortida de tardor');
  assert.equal(helper.entry.currentConfig, 1);
  assert.equal(helper.data.students.length, 7, 'la classe original no es toca');
  assert.equal(helper.data.teams.groups, null);

  const fresh = helper.entry.configurations[1].data;
  assert.equal(fresh.students.length, 7, 'els set que han respost');
  assert.deepEqual(Array.from(fresh.teams.groups, group => group.length), [3, 3, 1]);
  assert.equal(fresh.centreName, 'Institut', 'les dades del centre s\'hereten');
});

test('leftover students stay out of the teams and keep their place in the class', () => {
  const helper = setupWizard(CLASS);
  openSheet(helper, 'merge');
  helper.run('prefSetPlanMode', { value: 'size' });
  helper.run('prefSetPlanValue', {}, { value: '3' });
  helper.run('prefSetRemainder', { value: 'leaveOut' });
  assert.match(helper.lastModal(), /2 equips de 3 i 2 alumnes sense equip/);

  helper.run('prefGenerate');
  assert.match(helper.lastModal(), /Sense equip/);
  helper.run('prefApply');
  assert.deepEqual(Array.from(helper.data.teams.groups, group => group.length), [3, 3]);
  assert.equal(helper.data.students.length, 8, 'tothom continua a la classe');
});

test('a second round reuses the stored answers without the sheet', () => {
  const helper = setupWizard(CLASS);
  openSheet(helper, 'merge');
  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');
  helper.run('prefApply');

  helper.run('prefRegenerate');
  assert.match(helper.lastModal(), /Generar proposta/, 'l\'assistent va directe a la configuració');
  helper.run('prefSetPlanValue', {}, { value: '4' });
  helper.run('prefGenerate');
  helper.run('prefApply');
  assert.deepEqual(Array.from(helper.data.teams.groups, group => group.length), [2, 2, 2, 2]);
  assert.equal(helper.data.students.length, 8, 'no es tornen a afegir alumnes');
});

test('separate sets are honoured over the preferences', () => {
  const helper = setupWizard(CLASS);
  helper.data.teams.constraints.separate.push({ id: 'x', students: ['s0', 's1'] });
  openSheet(helper, 'merge');
  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');
  helper.run('prefApply');

  const groups = helper.data.teams.groups;
  const teamOf = id => groups.findIndex(group => group.includes(id));
  assert.notEqual(teamOf('s0'), teamOf('s1'), 'l\'Anna i el Pau es trien, però estan separats');
});
