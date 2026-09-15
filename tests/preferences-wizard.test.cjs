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
    // El nucli deixa el botó en espera mentre dura la feina; aquí no cal esperar.
    runBusy: (button, label, work) => work(),
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

/** Llegeix les targetes pintades al pas de la proposta. */
const MEMBER = /data-sid="([^"]+)"[\s\S]*?pref-member-name">([^<]*)<[\s\S]*?pref-chip pref-\w+">([^<]*)</g;

function cards(helper) {
  const html = helper.node('prefGroups').innerHTML || helper.lastModal();
  return html.split(/<div class="pref-group(?=["\s])/).slice(1).map(chunk => ({
    leftover: chunk.startsWith(' pref-group-out'),
    pct: (/<b>[^<]*<\/b>\s*<span class="pref-chip pref-\w+">([^<]*)</.exec(chunk) || ['', ''])[1],
    members: [...chunk.matchAll(MEMBER)].map(match => ({ id: match[1], name: match[2], chip: match[3] }))
  }));
}

const sizes = list => list.filter(card => !card.leftover).map(card => card.members.length);
const globalPct = helper => {
  const html = helper.node('prefSummary').innerHTML || helper.lastModal();
  return parseInt(/pref-summary-head">[\s\S]*?<b class="pref-\w+">(\d+)%/.exec(html)[1], 10);
};

/** Deixa la proposta feta, amb dos equips de quatre. */
function proposeTeams(helper) {
  openSheet(helper, 'merge');
  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');
}

test('a student moved between teams updates every percentage on the spot', () => {
  const helper = setupWizard(CLASS);
  proposeTeams(helper);
  const before = cards(helper);
  assert.deepEqual(sizes(before), [4, 4]);

  const moving = before[1].members[0];
  helper.run('prefPick', { sid: moving.id });
  assert.match(helper.node('prefGroups').innerHTML, /pref-picked/, 'el nom triat queda marcat');
  helper.run('prefDropOn', { team: '0' });

  const after = cards(helper);
  assert.deepEqual(sizes(after), [5, 3]);
  assert.equal(after[0].members.some(member => member.id === moving.id), true);
  assert.equal(after[1].members.some(member => member.id === moving.id), false);
  assert.doesNotMatch(helper.node('prefGroups').innerHTML, /pref-picked/, 'la selecció es deixa anar');
  assert.match(helper.node('prefSummary').innerHTML, /retocada a mà/);
  // Els indicadors es refan: cada xip és el recompte de l'equip on ha quedat.
  const chips = after[0].members.map(member => member.chip).concat(after[1].members.map(member => member.chip));
  assert.equal(chips.length, 8);
  assert.ok(chips.every(chip => /^(\d+\/\d+|—)$/.test(chip)), `xips inesperats: ${chips}`);
});

test('dropping a name on a classmate swaps the two and keeps the sizes', () => {
  const helper = setupWizard(CLASS);
  proposeTeams(helper);
  const before = cards(helper);
  const first = before[0].members[0];
  const second = before[1].members[1];

  helper.run('prefPick', { sid: first.id });
  helper.run('prefPick', { sid: second.id });

  const after = cards(helper);
  assert.deepEqual(sizes(after), [4, 4]);
  assert.equal(after[0].members.some(member => member.id === second.id), true);
  assert.equal(after[1].members.some(member => member.id === first.id), true);
});

test('picking the same name twice just lets it go', () => {
  const helper = setupWizard(CLASS);
  proposeTeams(helper);
  const before = cards(helper);
  helper.run('prefPick', { sid: before[0].members[0].id });
  helper.run('prefPick', { sid: before[0].members[0].id });
  assert.doesNotMatch(helper.node('prefGroups').innerHTML, /pref-picked/);
  assert.deepEqual(sizes(cards(helper)), [4, 4]);
  assert.doesNotMatch(helper.node('prefSummary').innerHTML, /retocada a mà/, 'no s\'ha canviat res');
});

test('a hand edit that makes things worse can be undone with the best proposal', () => {
  const helper = setupWizard(CLASS);
  proposeTeams(helper);
  const best = globalPct(helper);
  const happy = cards(helper)[0].members.find(member => /^[1-9]\//.test(member.chip));
  assert.ok(happy, 'cal algú amb alguna preferència acomplerta');

  helper.run('prefPick', { sid: happy.id });
  helper.run('prefDropOn', { team: '-1' });          // fora de tot equip
  assert.ok(globalPct(helper) < best, 'el percentatge baixa');
  assert.deepEqual(sizes(cards(helper)), [3, 4]);
  assert.equal(cards(helper).find(card => card.leftover).members.length, 1);
  assert.match(helper.node('prefSummary').innerHTML, /La millor proposta arriba al/);

  helper.run('prefRestoreBest');
  assert.equal(globalPct(helper), best);
  assert.deepEqual(sizes(cards(helper)), [4, 4]);
  assert.doesNotMatch(helper.node('prefSummary').innerHTML, /La millor proposta arriba al/);
});

test('the teams that reach the panel are the ones left on screen', () => {
  const helper = setupWizard(CLASS);
  proposeTeams(helper);
  const moving = cards(helper)[1].members[0];
  helper.run('prefPick', { sid: moving.id });
  helper.run('prefDropOn', { team: '0' });
  const shown = cards(helper);

  helper.run('prefApply');
  const groups = helper.data.teams.groups;
  assert.deepEqual(Array.from(groups, group => group.length), [5, 3]);
  shown.filter(card => !card.leftover).forEach((card, index) => {
    assert.deepEqual(Array.from(groups[index]), card.members.map(member => member.id));
  });
});

test('a student left out of every team stays in the class', () => {
  const helper = setupWizard(CLASS);
  proposeTeams(helper);
  const out = cards(helper)[0].members[0];
  helper.run('prefPick', { sid: out.id });
  helper.run('prefDropOn', { team: '-1' });
  helper.run('prefApply');

  const groups = helper.data.teams.groups;
  assert.equal(groups.flat().includes(out.id), false, 'no té equip');
  assert.equal(helper.data.students.some(student => student.id === out.id), true, 'però continua a la classe');
  assert.deepEqual(Array.from(groups, group => group.length), [3, 4]);
});

/* ── Memòria de la millor formació ───────────────────── */

const panelHtml = helper => {
  helper.A.renderPreferencePanel();
  return helper.node('teamPrefStatus').innerHTML;
};
const panelPct = helper => parseInt(/<b class="pref-\w+">(\d+)%<\/b>/.exec(panelHtml(helper))[1], 10);

test('the best formation is remembered and can be recovered after trying others', () => {
  const helper = setupWizard(CLASS);
  proposeTeams(helper);
  helper.run('prefApply');
  const applied = Array.from(helper.data.teams.groups, group => Array.from(group));
  const best = panelPct(helper);
  assert.doesNotMatch(panelHtml(helper), /Recuperar la millor/, 'el repartiment d\'ara ja és el millor');

  // El docent continua provant i acaba amb tothom sol: cap preferència acomplerta.
  helper.data.teams.groups = helper.data.students.map(student => [student.id]);
  assert.equal(panelPct(helper), 0);
  assert.match(panelHtml(helper), new RegExp(`Recuperar la millor versió \\(${best}%\\)`));

  helper.run('prefRestoreFormation');
  assert.deepEqual(Array.from(helper.data.teams.groups, group => Array.from(group)), applied);
  assert.equal(panelPct(helper), best);
  assert.doesNotMatch(panelHtml(helper), /Recuperar la millor/, 'ja hi som, no hi ha res a recuperar');
  assert.equal(helper.calls.guarded > 0, true, 'es pregunta pels equips desats amb canvis');
});

test('a weaker proposal loaded afterwards does not erase the best one', () => {
  const helper = setupWizard(CLASS);
  proposeTeams(helper);
  helper.run('prefApply');
  const best = panelPct(helper);
  assert.ok(best > 0);

  // Segona volta amb les respostes ja carregades: vuit equips d'un alumne.
  helper.run('prefRegenerate');
  helper.run('prefSetPlanValue', {}, { value: '8' });
  helper.run('prefGenerate');
  helper.run('prefApply');

  assert.equal(panelPct(helper), 0);
  assert.match(panelHtml(helper), new RegExp(`Recuperar la millor versió \\(${best}%\\)`));
  helper.run('prefRestoreFormation');
  assert.deepEqual(Array.from(helper.data.teams.groups, group => group.length), [4, 4]);
});

test('importing a different sheet starts the memory from scratch', () => {
  const helper = setupWizard(CLASS);
  proposeTeams(helper);
  helper.run('prefApply');
  panelHtml(helper);
  assert.ok(helper.data.teams.preferences.best, 'la primera formació ja es recorda');

  openSheet(helper, 'merge');
  helper.run('prefSetPlanValue', {}, { value: '8' });
  helper.run('prefGenerate');
  helper.run('prefApply');
  panelHtml(helper);
  assert.equal(helper.data.teams.preferences.best.pct, 0, 'el full nou porta la seva pròpia memòria');
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

/* ── Columnes de separació ───────────────────────────── */

/**
 * El mateix full, amb una columna de separació al final. La Jana i el Lluc es
 * volen separar tots dos, l'Ona ho demana pel seu compte i el Teo n'anota algú
 * que no és de la classe.
 */
const AVOID_SHEET = [
  'Marca de temps;Nom i cognoms;Comentaris;Preferència 1;Preferència 2;Amb qui prefereixes NO coincidir? (Separar 1)',
  '12/05/2026 9:01;Anna Puig Solà;;Pau Serra Vidal;Nil Roca Camps;',
  '12/05/2026 9:02;Pau Serra Vidal;;Anna Puig Solà;Nil Roca Camps;',
  '12/05/2026 9:03;Nil Roca Camps;;Pau Serra Vidal;Anna Puig Solà;',
  '12/05/2026 9:04;"Ferrer Mas, Jana";;Lluc Vidal Pons;Anna Puig Solà;Lluc Vidal Pons',
  '12/05/2026 9:05;Lluc Vidal Pons;;Jana Ferrer Mas;Ona Camps Roig;jana ferrer',
  '12/05/2026 9:06;Ona Camps Roig;;Lluc Vidal Pons;Teo Mas Grau;Nil Roca Camps',
  '12/05/2026 9:07;Teo Mas Grau;;Lluc Vidal Pons;Ona Camps Roig;Berta Soler'
].join('\r\n');

/** Porta l'assistent amb el full de separacions fins al pas dels equips. */
function openAvoidSheet(helper) {
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = AVOID_SHEET;
  helper.run('prefReadSource');
  helper.run('prefColumnsNext');
  helper.run('prefStudentsNext');
}

test('the column step maps the separation column on its own and shows it', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = AVOID_SHEET;
  helper.run('prefReadSource');

  const html = helper.lastModal();
  assert.match(html, /<label>Separar 1<\/label>/, 'la columna de separació té el seu propi camp');
  assert.match(html, /pref-col-avoid/, 'i queda destacada a la vista prèvia');
  assert.match(html, /Una separació més/);
});

test('a sheet without separation columns still offers to add one by hand', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = SHEET;
  helper.run('prefReadSource');
  assert.match(helper.lastModal(), /Afegir una columna de separació/);
  assert.doesNotMatch(helper.lastModal(), /<label>Separar 1<\/label>/);

  helper.run('prefAddAvoidColumn');
  assert.match(helper.lastModal(), /<label>Separar 1<\/label>/);
  helper.run('prefSetColumn', { role: 'avoid', idx: '0' }, { value: '5' });
  helper.run('prefColumnsNext');
  // La columna 5 era la tercera preferència: passa a ser de separació.
  assert.match(helper.lastModal(), /peticions de separació/);
});

test('the wizard reads the separations, counts them and keeps them apart', () => {
  const helper = setupWizard(CLASS);
  openAvoidSheet(helper);
  assert.match(helper.calls.modals.at(-2), /<b>3<\/b><span>peticions de separació/,
    'la Jana i el Lluc es demanen mútuament, l\'Ona en demana una i la del Teo no s\'ha identificat');
  assert.match(helper.lastModal(), /Respectar les 3 separacions demanades al full/);

  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');
  const html = helper.lastModal();
  assert.match(html, /3 de 3 separacions respectades/);
  assert.match(html, /Es respecten totes les 3 separacions/);

  const teams = helper.A.getTeams();
  helper.run('prefApply');
  const teamOf = id => teams.groups.findIndex(group => group.includes(id));
  const idOf = name => helper.data.students.find(student => student.name === name).id;
  assert.notEqual(teamOf(idOf('Jana Ferrer Mas')), teamOf(idOf('Lluc Vidal Pons')),
    'la separació recíproca es respecta tot i que es triïn l\'un a l\'altre');
  assert.notEqual(teamOf(idOf('Ona Camps Roig')), teamOf(idOf('Nil Roca Camps')));
});

test('the separations are stored with the answers and reused the next round', () => {
  const helper = setupWizard(CLASS);
  openAvoidSheet(helper);
  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');
  helper.run('prefApply');

  const stored = helper.data.teams.preferences;
  const idOf = name => helper.data.students.find(student => student.name === name).id;
  assert.deepEqual(Array.from(stored.avoid[idOf('Jana Ferrer Mas')]), [idOf('Lluc Vidal Pons')]);
  assert.deepEqual(Array.from(stored.avoid[idOf('Ona Camps Roig')]), [idOf('Nil Roca Camps')]);
  assert.deepEqual(Array.from(stored.unresolved), ['Berta Soler']);

  // El panell lateral en dóna compte sense tornar a llegir el full.
  helper.A.renderPreferencePanel();
  assert.match(helper.node('teamPrefStatus').innerHTML, /3 de 3 separacions respectades/);
  const view = helper.A.preferenceTeamView(helper.data.teams.groups);
  assert.match(view.summary, /separacions respectades/);

  helper.run('prefRegenerate');
  assert.match(helper.lastModal(), /Respectar les 3 separacions demanades al full/,
    'les separacions desades tornen a sortir a la configuració');
  helper.run('prefGenerate');
  assert.match(helper.lastModal(), /3 de 3 separacions respectades/);
});

test('the teacher can switch the separations off and still see what it costs', () => {
  const helper = setupWizard(CLASS);
  openAvoidSheet(helper);
  helper.run('prefToggleAvoid', {}, { checked: false });
  helper.run('prefSetPlanMode', { value: 'size' });
  helper.run('prefSetPlanValue', {}, { value: '4' });
  helper.run('prefGenerate');
  assert.match(helper.lastModal(), /de 3 separacions respectades/,
    'els indicadors les segueixen comptant encara que no s\'apliquin');

  // Amb l'interruptor abaixat, una parella que demanava separar-se pot acabar
  // junta: el resum n'explica el motiu.
  const placed = cards(helper);
  const find = name => {
    for (let index = 0; index < placed.length; index++) {
      if (placed[index].members.some(item => item.name === name)) {
        return { id: placed[index].members.find(item => item.name === name).id, team: index };
      }
    }
    throw new Error('no apareix a la proposta: ' + name);
  };
  const jana = find('Jana Ferrer Mas');
  const lluc = find('Lluc Vidal Pons');
  helper.run('prefPick', { sid: jana.id });
  helper.run('prefDropOn', { team: String(lluc.team) });

  const html = helper.node('prefSummary').innerHTML;
  assert.match(html, /1 separació sense respectar/);
  assert.match(html, /separacions estan desactivades/,
    'i s\'avisa de per què no s\'han pogut respectar');
});

test('a clash shows up on the student, on the team and on the summary', () => {
  const helper = setupWizard(CLASS);
  openAvoidSheet(helper);
  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');

  // El repartiment els havia separat: es forcen al mateix equip a ma.
  const placed = cards(helper);
  const find = name => {
    for (let index = 0; index < placed.length; index++) {
      const member = placed[index].members.find(item => item.name === name);
      if (member) return { id: member.id, team: index };
    }
    throw new Error('no apareix a la proposta: ' + name);
  };
  const jana = find('Jana Ferrer Mas');
  const lluc = find('Lluc Vidal Pons');
  assert.notEqual(jana.team, lluc.team, 'la proposta els havia separat');
  helper.run('prefPick', { sid: jana.id });
  helper.run('prefDropOn', { team: String(lluc.team) });

  const html = helper.node('prefGroups').innerHTML;
  assert.match(html, /pref-member-clash/, 'l\'alumne queda marcat');
  assert.match(html, /pref-chip pref-avoid/);
  assert.match(html, /sense respectar/, 'i l\'equip ho diu');
  assert.match(helper.node('prefSummary').innerHTML, /1 separació sense respectar/);
  assert.match(helper.node('prefSummary').innerHTML, /Recuperar-la/,
    'la millor proposta, sense la parella junta, es pot recuperar');
});

test('a sheet with separations only and no choices is enough to form teams', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = [
    'Alumne/a;Separar 1',
    'Anna Puig Solà;Pau Serra Vidal',
    'Pau Serra Vidal;',
    'Nil Roca Camps;Jana Ferrer Mas',
    'Jana Ferrer Mas;'
  ].join('\r\n');
  helper.run('prefReadSource');
  helper.run('prefColumnsNext');
  helper.run('prefStudentsNext');
  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');
  const proposal = helper.lastModal();
  assert.match(proposal, /<span>Separacions respectades<\/span>/,
    'sense cap tria, el titular de la proposta passa a ser el de les separacions');
  assert.match(proposal, /2 de 2 separacions respectades/);
  assert.doesNotMatch(proposal, /de 0 tries/, 'no es parla de tries que ningú no ha fet');
  helper.run('prefApply');

  const teams = helper.data.teams;
  const teamOf = id => teams.groups.findIndex(group => group.includes(id));
  const idOf = name => helper.data.students.find(student => student.name === name).id;
  assert.notEqual(teamOf(idOf('Anna Puig Solà')), teamOf(idOf('Pau Serra Vidal')));
  assert.notEqual(teamOf(idOf('Nil Roca Camps')), teamOf(idOf('Jana Ferrer Mas')));
  assert.ok(teams.preferences, 'un full només de separacions també es desa');
  assert.equal(Object.keys(teams.preferences.prefs).length, 0, 'no hi ha cap tria');
  assert.equal(Object.keys(teams.preferences.avoid).length, 2);

  // El panell lateral passa a encapçalar-se amb les separacions.
  const view = helper.A.preferenceTeamView(teams.groups);
  assert.match(view.summary, /Separacions respectades/);
  assert.match(view.summary, /100%/);
});

/** Full amb grup d'origen, sexe i necessitats educatives a les columnes 2, 3 i 4. */
const FULL_SHEET = [
  'Nom i cognoms;Grup actual;Sexe;NEE;Preferència 1;Preferència 2',
  'Anna Puig Solà;Aire;D;;Pau Serra Vidal;Nil Roca Camps',
  'Pau Serra Vidal;Terra;H;S;Anna Puig Solà;Nil Roca Camps',
  'Nil Roca Camps;Aire;H;;Pau Serra Vidal;Anna Puig Solà',
  'Jana Ferrer Mas;Terra;D;;Ona Camps Roig;Anna Puig Solà',
  'Lluc Vidal Pons;Aire;H;S;Ona Camps Roig;Nil Roca Camps',
  'Ona Camps Roig;Terra;D;;Lluc Vidal Pons;Jana Ferrer Mas',
  'Marta Gil Puig;Terra;D;;Jana Ferrer Mas;Ona Camps Roig'
].join('\r\n');

test('the wizard maps the composition columns and says what it has read', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = FULL_SHEET;
  helper.run('prefReadSource');

  const columns = helper.lastModal();
  assert.match(columns, /Grup d'origen/);
  assert.match(columns, /Necessitats educatives/);
  assert.match(columns, /pref-col-attr/, 'les columnes de composició queden destacades');

  helper.run('prefColumnsNext');
  const students = helper.lastModal();
  assert.match(students, /Dades per equilibrar els equips/);
  assert.match(students, /Aire \(3\)/);
  assert.match(students, /Necessitats educatives: NEE \(2\)/);
});

test('the teacher can say which column holds which data', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  // Sense capçalera reconeixible no s'endevina res: tot s'assigna a mà.
  helper.node('prefText').value = [
    'Anna Puig Solà;X;D;Pau Serra Vidal',
    'Pau Serra Vidal;Y;H;Anna Puig Solà',
    'Nil Roca Camps;X;H;Pau Serra Vidal',
    'Jana Ferrer Mas;Y;D;Anna Puig Solà'
  ].join('\r\n');
  helper.run('prefReadSource');
  helper.run('prefSetColumn', { role: 'name' }, { value: '0' });
  helper.run('prefSetColumn', { role: 'attr', key: 'group' }, { value: '1' });
  helper.run('prefSetColumn', { role: 'attr', key: 'sex' }, { value: '2' });
  helper.run('prefSetColumn', { role: 'pref', idx: '0' }, { value: '3' });
  helper.run('prefSetColumn', { role: 'pref', idx: '1' }, { value: '-1' });
  helper.run('prefSetColumn', { role: 'pref', idx: '2' }, { value: '-1' });
  helper.run('prefColumnsNext');
  helper.run('prefStudentsNext');
  helper.run('prefSetPlanValue', {}, { value: '2' });

  const plan = helper.lastModal();
  assert.match(plan, /Equilibrar grup d'origen/);
  assert.match(plan, /Equilibrar sexe/);
  assert.doesNotMatch(plan, /Equilibrar necessitats/, 'la columna de NEE no s\'ha assignat');

  helper.run('prefGenerate');
  helper.run('prefApply');
  const preferences = helper.data.teams.preferences;
  assert.deepEqual(Object.keys(preferences.attributes).sort(), ['group', 'sex']);
  const teamOf = id => helper.data.teams.groups.findIndex(group => group.includes(id));
  const idOf = name => helper.data.students.find(student => student.name === name).id;
  assert.notEqual(teamOf(idOf('Anna Puig Solà')), teamOf(idOf('Jana Ferrer Mas')),
    'les dues noies del mateix full es reparteixen');
});

test('the success criterion is chosen before generating and travels with the sheet', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = FULL_SHEET;
  helper.run('prefReadSource');
  helper.run('prefColumnsNext');
  helper.run('prefStudentsNext');
  helper.run('prefSetCriterion', {}, { value: 'spread' });
  assert.match(helper.lastModal(), /Una preferència per alumne/);

  helper.run('prefSetPlanValue', {}, { value: '3' });
  helper.run('prefGenerate');
  const proposal = helper.lastModal();
  assert.match(proposal, /Amb una sola tria acomplerta/);
  assert.match(proposal, /Equilibri · Sexe/, 'els criteris d\'equilibri també hi surten');

  helper.run('prefApply');
  const preferences = helper.data.teams.preferences;
  assert.equal(preferences.criterion, 'spread');
  assert.ok(preferences.attributes.group, 'el grup d\'origen es desa amb les respostes');
  assert.ok(preferences.attributes.nee);

  // I en tornar a proposar, el criteri i les dades ja hi són.
  helper.run('prefRegenerate');
  assert.match(helper.lastModal(), /Equilibrar grup d'origen/);
});

test('the competency column fills the levels panel and can be rescaled', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = [
    'Nom i cognoms;Competència;Preferència 1',
    'Anna Puig Solà;8;Pau Serra Vidal',
    'Pau Serra Vidal;4;Anna Puig Solà',
    'Nil Roca Camps;6;Anna Puig Solà',
    'Jana Ferrer Mas;10;Pau Serra Vidal'
  ].join('\r\n');
  helper.run('prefReadSource');
  assert.match(helper.lastModal(), /Competència \(valor numèric\)/);
  helper.run('prefColumnsNext');
  assert.match(helper.lastModal(), /Competència: 4 valors de 4 a 10/);

  helper.run('prefStudentsNext');
  const plan = helper.lastModal();
  assert.match(plan, /Igualar el nivell mitjà dels equips/);
  assert.match(plan, /value="4"/, "l'interval detectat es proposa com a mínim");
  assert.match(plan, /value="10"/);

  // L'escala real del full és 0–10, no 4–10: el docent la corregeix.
  helper.run('prefSetLevelRange', { key: 'min' }, { value: '0' });
  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');
  assert.match(helper.lastModal(), /Equilibri · Competència/);
  helper.run('prefApply');

  const teams = helper.data.teams;
  const idOf = name => helper.data.students.find(student => student.name === name).id;
  assert.equal(teams.useCompetency, true, 'el panell de nivells s\'activa tot sol');
  assert.equal(teams.heterogeneous, true);
  assert.equal(teams.competencies[idOf('Anna Puig Solà')], 8);
  assert.equal(teams.competencies[idOf('Pau Serra Vidal')], 4);
  assert.equal(teams.preferences.levels[idOf('Jana Ferrer Mas')], 10, 'el valor del full es desa tal qual');
  assert.deepEqual(JSON.parse(JSON.stringify(teams.preferences.levelRange)), { min: 0, max: 10 });
});

test('with one choice each, nobody who answered is left empty-handed', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = SHEET;
  helper.run('prefReadSource');
  helper.run('prefColumnsNext');
  helper.run('prefSetRosterMode', {}, { value: 'merge' });
  helper.run('prefStudentsNext');
  helper.run('prefSetCriterion', {}, { value: 'spread' });
  helper.run('prefSetPlanMode', { value: 'count' });
  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');

  const proposal = helper.lastModal();
  assert.match(proposal, /0 sense cap/, 'ningú es queda sense la seva tria');
  assert.doesNotMatch(proposal, /sense cap tria acomplerta<\/b>/, 'i per tant no hi ha cap avís');

  helper.run('prefApply');
  const stats = helper.A.preferenceStats(helper.data.teams.groups, helper.data.teams.preferences.prefs,
    helper.A.preferenceStatsOptions(helper.data.teams.preferences));
  assert.equal(stats.unhappy, 0);
});

test('when it is impossible, the proposal says who has been left out', () => {
  const helper = setupWizard(['Anna Puig Solà', 'Pau Serra Vidal', 'Nil Roca Camps', 'Jana Ferrer Mas']);
  helper.run('startPreferenceWizard');
  // Tres volen la mateixa persona i els equips són de dos: algú s'hi quedarà.
  helper.node('prefText').value = [
    'Nom i cognoms;Preferència 1',
    'Anna Puig Solà;Pau Serra Vidal',
    'Pau Serra Vidal;Anna Puig Solà',
    'Nil Roca Camps;Anna Puig Solà',
    'Jana Ferrer Mas;'
  ].join('\r\n');
  helper.run('prefReadSource');
  helper.run('prefColumnsNext');
  helper.run('prefStudentsNext');
  helper.run('prefSetCriterion', {}, { value: 'spread' });
  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');

  const proposal = helper.lastModal();
  assert.match(proposal, /1 alumne sense cap tria acomplerta/);
  assert.match(proposal, /Nil Roca Camps/);
  assert.match(proposal, /pref-member-none/, "el nom queda marcat a la seva targeta");
});

/** Titular i avís de la millor proposta, tal com es pinten al pas final. */
function summaryOf(html) {
  const head = /<div class="pref-summary-head">\s*<span>([^<]*)<\/span>\s*<b class="pref-\w+">([^<]*)</.exec(html);
  const notice = /pref-note-warn"><span class="mi mi-xs">history<\/span>\s*<div>([\s\S]*?)\.\s*<button/.exec(html);
  return {
    label: head ? head[1].trim() : '',
    pct: head ? parseInt(head[2], 10) : null,
    notice: notice ? notice[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null
  };
}

test('the best proposal notice quotes the figure of the chosen criterion', () => {
  // El full d'exemple del repositori: prou gran perquè les propostes surtin
  // desiguals i l'avís tingui ocasió d'aparèixer.
  const sheet = readFileSync(path.join(root, 'exemples/preferencies-30-alumnes-complet.csv'), 'utf8');
  for (const criterion of ['max', 'spread']) {
    const helper = setupWizard([]);
    helper.run('startPreferenceWizard');
    helper.node('prefText').value = sheet;
    helper.run('prefReadSource');
    helper.run('prefColumnsNext');
    helper.run('prefStudentsNext');
    helper.run('prefSetCriterion', {}, { value: criterion });
    helper.run('prefSetPlanMode', { value: 'size' });
    helper.run('prefSetPlanValue', {}, { value: '5' });

    const seen = [];
    let checked = 0;
    for (let round = 0; round < 8; round++) {
      helper.run(round ? 'prefGenerateAgain' : 'prefGenerate');
      const summary = summaryOf(helper.lastModal());
      if (summary.notice) {
        const quoted = parseInt(/(\d+)%/.exec(summary.notice)[1], 10);
        assert.ok(seen.includes(quoted),
          `l'avís diu ${quoted}%, que no és cap dels titulars vistos (${seen.join(', ')})`);
        assert.ok(quoted >= summary.pct,
          `la millor proposta (${quoted}%) no pot anar per sota de la d'ara (${summary.pct}%)`);
        checked++;
      }
      seen.push(summary.pct);
    }
    // El full de proves dóna propostes desiguals: l'avís ha de sortir alguna vegada.
    assert.ok(checked > 0, `amb el criteri ${criterion} no s'ha arribat a veure cap avís`);
  }
});

test('changing the criterion forgets the best proposal of the previous one', () => {
  const helper = setupWizard(CLASS);
  openSheet(helper, 'merge');
  helper.run('prefSetPlanValue', {}, { value: '2' });
  for (let round = 0; round < 6; round++) helper.run(round ? 'prefGenerateAgain' : 'prefGenerate');

  helper.run('prefBack', { step: '4' });
  helper.run('prefSetCriterion', {}, { value: 'spread' });
  helper.run('prefGenerate');
  assert.equal(summaryOf(helper.lastModal()).notice, null,
    'la millor proposta de l\'altre criteri ja no serveix de referència');
});

test('the side panel shows the achievement of every criterion', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = FULL_SHEET;
  helper.run('prefReadSource');
  helper.run('prefColumnsNext');
  helper.run('prefStudentsNext');
  helper.run('prefSetPlanValue', {}, { value: '2' });
  helper.run('prefGenerate');
  helper.run('prefApply');

  const view = helper.A.preferenceTeamView(helper.data.teams.groups);
  assert.match(view.summary, /Grau d'assoliment de cada criteri/);
  assert.match(view.summary, /Equilibri · Grup d'origen/);
  assert.match(view.summary, /Equilibri · Necessitats educatives/);
  assert.match(view.composition(0), /pref-compo/);
  assert.match(view.composition(0), /Grup/);
});

test('a step with neither choices nor separations will not move on', () => {
  const helper = setupWizard(CLASS);
  helper.run('startPreferenceWizard');
  helper.node('prefText').value = AVOID_SHEET;
  helper.run('prefReadSource');
  helper.run('prefSetColumn', { role: 'pref', idx: '0' }, { value: '-1' });
  helper.run('prefSetColumn', { role: 'pref', idx: '1' }, { value: '-1' });
  helper.run('prefSetColumn', { role: 'avoid', idx: '0' }, { value: '-1' });
  helper.run('prefColumnsNext');
  assert.match(helper.calls.toast.at(-1)[0], /preferència o de separació/);
});
