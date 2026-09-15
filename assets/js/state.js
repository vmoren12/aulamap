/**
 * AulaMap — Estat de l'aplicació
 * Model de dades, persistència a localStorage, migració de versions antigues
 * i pila única de desfer/refer.
 */
(function (A) {
'use strict';

const { el, uid, toast, STORAGE_KEY, LEGACY_KEYS, REL_TOGETHER, REL_SEPARATE } = A;

/* ── Model ───────────────────────────────────────────── */

/** Dades d'equips per a una configuració. */
function defaultTeamsData() {
  return {
    studentsPerGroup: 2,
    remainderMode: null,          // null | 'newGroup' | 'distribute'
    useCompetency: false,
    heterogeneous: false,
    competencies: {},             // { studentId: 0..10 }
    preferences: null,            // { updated, source, ranked, criterion, prefs:{ studentId:[studentId] },
                                  //   avoid:{ studentId:[studentId] }, unresolved:[],
                                  //   attributes:{ group|sex|nee: { studentId: valor } },
                                  //   levels:{ studentId: número }, levelRange:{ min, max },
                                  //   balance:{ group|sex|nee|level: boolean } }
    constraints: { together: [], separate: [] }, // [{ id, students:[studentId] }]
    groups: null,                 // [[studentId]]
    teamNames: {},                // { teamIndex: nom }
    positions: {},                // { teamIndex: {x,y} }
    layout: null,                 // esquema de pupitres propi de la formació activa
    lockedTeams: {},              // { teamIndex: true }
    lockedStudents: {},           // { studentId: teamIndex }
    saved: [],                    // [{ id, name, date, groups, teamNames, competencies }]
    activeSaved: null             // índex dins de saved
  };
}

/** Dades d'una configuració d'aula. */
function defaultConfigData() {
  return {
    centreName: '', curs: '', nivell: '', aula: '',
    students: [],                 // [{ id, name, color }]
    relations: [],                // [{ id, type:'together'|'separate', students:[studentId] }]
    desks: [], assignments: {}, lockedDesks: {},
    layoutType: 'rows', layoutRows: 4, layoutCols: 5, layoutSpacing: 20,
    teacherAtBottom: false,
    teams: defaultTeamsData()
  };
}

function defaultState() {
  return {
    version: 5,
    docents: ['Grup 1'],
    currentDocent: 0,
    configs: { 'Grup 1': { configurations: [{ name: 'Configuració 1', data: defaultConfigData() }], currentConfig: 0 } }
  };
}

/* ── Normalització i migració ────────────────────────── */

/** Esquema d'equips net: un pupitre per alumne vàlid, sense duplicats. */
function normalizeTeamLayout(layout, validStudents) {
  if (!layout || !Array.isArray(layout.desks)) return null;
  const seenDesks = new Set(), seenStudents = new Set();
  const result = { desks: [], assignments: {}, lockedDesks: {}, layoutType: 'free' };
  layout.desks.forEach(desk => {
    if (!desk || typeof desk !== 'object') return;
    const student = layout.assignments?.[desk.id];
    if (typeof desk.id !== 'string' || seenDesks.has(desk.id) || !validStudents.has(student) || seenStudents.has(student)) return;
    if (!Number.isFinite(desk.x) || !Number.isFinite(desk.y)) return;
    result.desks.push({ id: desk.id, x: Math.max(0, desk.x), y: Math.max(0, desk.y) });
    result.assignments[desk.id] = student;
    seenDesks.add(desk.id);
    seenStudents.add(student);
  });
  return result;
}

/**
 * Preferències i separacions d'alumnat netes: només parelles d'identificadors
 * que existeixen. Un alumne no es pot triar ni separar d'ell mateix, ni repetir
 * cap nom. Un full només amb separacions també és vàlid.
 */
function normalizePreferences(preferences, validIds) {
  if (!preferences || typeof preferences !== 'object') return null;
  const links = source => {
    const clean = {};
    Object.entries(source || {}).forEach(([studentId, list]) => {
      if (!validIds.has(studentId) || !Array.isArray(list)) return;
      const ids = [...new Set(list.filter(id => id !== studentId && validIds.has(id)))];
      if (ids.length) clean[studentId] = ids;
    });
    return clean;
  };
  const prefs = links(preferences.prefs);
  const avoid = links(preferences.avoid);

  // Grup d'origen, sexe i necessitats educatives: un text curt per alumne.
  const attributes = {};
  ['group', 'sex', 'nee'].forEach(key => {
    const source = preferences.attributes?.[key];
    if (!source || typeof source !== 'object') return;
    const clean = {};
    Object.entries(source).forEach(([studentId, value]) => {
      const text = String(value ?? '').trim();
      if (validIds.has(studentId) && text) clean[studentId] = text.slice(0, 40);
    });
    if (Object.keys(clean).length) attributes[key] = clean;
  });
  const balance = {};
  ['group', 'sex', 'nee', 'level'].forEach(key => {
    if (preferences.balance && preferences.balance[key] === false) balance[key] = false;
  });

  // Competència: un número per alumne i els extrems de l'escala del full.
  const levels = {};
  Object.entries(preferences.levels || {}).forEach(([studentId, value]) => {
    const number = Number(value);
    if (validIds.has(studentId) && Number.isFinite(number)) levels[studentId] = number;
  });
  const bound = value => (Number.isFinite(Number(value)) && value !== null ? Number(value) : null);
  const levelRange = { min: bound(preferences.levelRange?.min), max: bound(preferences.levelRange?.max) };

  // Un full només amb la composició del grup també val: encara es pot equilibrar.
  if (!Object.keys(prefs).length && !Object.keys(avoid).length &&
      !Object.keys(attributes).length && !Object.keys(levels).length) return null;

  let best = null;
  const storedGroups = preferences.best?.groups;
  if (Array.isArray(storedGroups)) {
    const groups = storedGroups
      .map(group => (Array.isArray(group) ? group.filter(id => validIds.has(id)) : []))
      .filter(group => group.length);
    if (groups.length) {
      best = {
        groups,
        pct: Number(preferences.best.pct) || 0,
        broken: Number(preferences.best.broken) || 0,
        balance: Number.isFinite(Number(preferences.best.balance)) && preferences.best.balance !== null
          ? Number(preferences.best.balance) : null,
        updated: preferences.best.updated || ''
      };
    }
  }

  return {
    updated: preferences.updated || '',
    source: preferences.source || '',
    ranked: preferences.ranked !== false,
    criterion: preferences.criterion === 'spread' ? 'spread' : 'max',
    prefs,
    avoid,
    attributes,
    levels,
    levelRange,
    balance,
    unresolved: Array.isArray(preferences.unresolved) ? preferences.unresolved.map(String) : [],
    best
  };
}

/** Completa una configuració amb els camps que hi puguin faltar. */
function normalizeConfigData(data) {
  const base = defaultConfigData();
  const out = { ...base, ...(data || {}) };
  out.students = Array.isArray(out.students) ? out.students : [];
  out.desks = Array.isArray(out.desks) ? out.desks : [];
  out.assignments = out.assignments || {};
  out.lockedDesks = out.lockedDesks || {};
  out.teams = { ...defaultTeamsData(), ...(out.teams || {}) };
  out.teams.constraints = {
    together: out.teams.constraints?.together || [],
    separate: out.teams.constraints?.separate || []
  };

  // v4 → v5: les parelles "positive/negative" passen a conjunts "ajuntar/separar".
  if (!Array.isArray(out.relations)) out.relations = [];
  if (Array.isArray(data?.compatibilities) && data.compatibilities.length) {
    data.compatibilities.forEach(c => {
      if (!c || !c.a || !c.b) return;
      out.relations.push({
        id: uid('rel'),
        type: c.type === 'negative' ? REL_SEPARATE : REL_TOGETHER,
        students: [c.a, c.b]
      });
    });
  }
  delete out.compatibilities;

  // Descarta referències a alumnes que ja no existeixen.
  const ids = new Set(out.students.map(s => s.id));
  out.teams.preferences = normalizePreferences(out.teams.preferences, ids);
  out.teams.layout = normalizeTeamLayout(out.teams.layout, new Set((out.teams.groups || []).flat().filter(id => ids.has(id))));
  out.teams.saved.forEach(saved => {
    saved.layout = normalizeTeamLayout(saved.layout, new Set(saved.groups.flat().filter(id => ids.has(id))));
  });
  out.relations = out.relations
    .map(r => ({
      id: r.id || uid('rel'),
      type: r.type === REL_SEPARATE ? REL_SEPARATE : REL_TOGETHER,
      students: [...new Set((r.students || []).filter(id => ids.has(id)))]
    }))
    .filter(r => r.students.length > 0);
  Object.keys(out.assignments).forEach(deskId => {
    if (!ids.has(out.assignments[deskId])) { delete out.assignments[deskId]; delete out.lockedDesks[deskId]; }
  });
  return out;
}

/** Converteix les dades d'equips heretades (basades en noms) a identificadors. */
function migrateLegacyTeams(data) {
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEYS.teams) || 'null'); } catch (e) { legacy = null; }
  if (!legacy) return;

  const byName = new Map(data.students.map(s => [s.name.toLowerCase(), s.id]));
  const toId = name => byName.get(String(name).toLowerCase());
  const mapList = list => (list || []).map(toId).filter(Boolean);
  const teams = data.teams;

  if (legacy.competencies) {
    Object.entries(legacy.competencies).forEach(([name, value]) => {
      const id = toId(name);
      if (id) teams.competencies[id] = value;
    });
  }
  [REL_TOGETHER, REL_SEPARATE].forEach(type => {
    (legacy.constraints?.[type] || []).forEach(set => {
      const students = mapList(set.students);
      if (students.length) teams.constraints[type].push({ id: uid(type), students });
    });
  });
  if (Array.isArray(legacy.savedTeams)) {
    teams.saved = legacy.savedTeams.map(t => ({
      id: t.id || uid('team'),
      name: t.name,
      date: t.date,
      groups: (t.groups || []).map(mapList),
      teamNames: t.teamNames || {},
      competencies: null
    })).filter(t => t.groups.length);
  }
  if (legacy.studentsPerGroup) teams.studentsPerGroup = legacy.studentsPerGroup;
  teams.useCompetency = !!legacy.enableCompetency;
  teams.heterogeneous = !!legacy.heterogeneous;
  teams.remainderMode = legacy.selectedOption || null;
}

/** Carrega l'estat des de localStorage, migrant formats antics si cal. */
function loadState() {
  let raw = null;
  let isLegacy = false;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { raw = localStorage.getItem(LEGACY_KEYS.state); isLegacy = !!raw; }
  } catch (e) { raw = null; }

  if (!raw) return defaultState();

  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return defaultState(); }
  if (!parsed || !Array.isArray(parsed.docents) || !parsed.docents.length) return defaultState();

  parsed.version = 5;
  parsed.currentDocent = Math.min(Math.max(0, parsed.currentDocent | 0), parsed.docents.length - 1);
  parsed.configs = parsed.configs || {};
  parsed.docents.forEach(name => {
    const entry = parsed.configs[name];
    if (!entry || !Array.isArray(entry.configurations) || !entry.configurations.length) {
      parsed.configs[name] = { configurations: [{ name: 'Configuració 1', data: defaultConfigData() }], currentConfig: 0 };
      return;
    }
    entry.currentConfig = Math.min(Math.max(0, entry.currentConfig | 0), entry.configurations.length - 1);
    entry.configurations.forEach(cfg => { cfg.data = normalizeConfigData(cfg.data); });
  });

  if (isLegacy) {
    // Les dades d'equips antigues eren globals: s'assignen a la configuració activa.
    const entry = parsed.configs[parsed.docents[parsed.currentDocent]];
    const data = entry.configurations[entry.currentConfig].data;
    migrateLegacyTeams(data);
    try {
      const pos = JSON.parse(localStorage.getItem(LEGACY_KEYS.positions) || 'null');
      if (pos) data.teams.positions = pos;
    } catch (e) { /* les posicions són opcionals */ }
  }
  return parsed;
}

let state = loadState();

/* ── Accés i persistència ────────────────────────────── */

function getState() { return state; }

/** Configuració activa (dades de l'aula que s'estan editant). */
function getData() {
  const docent = state.docents[state.currentDocent];
  const entry = state.configs[docent];
  return entry.configurations[entry.currentConfig].data;
}

/** Dades d'equips de la configuració activa. */
function getTeams() { return getData().teams; }

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('No s\'ha pogut desar l\'estat', e);
    toast('No s\'ha pogut desar: emmagatzematge ple', 'error');
  }
}

/* ── Desfer / refer ──────────────────────────────────── */

const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

/** Desa una instantània abans d'aplicar un canvi. */
function pushUndo() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}

/** Instantània + persistència per a canvis ja aplicats a l'estat. */
function saveWithUndo() { pushUndo(); saveState(); }

function applySnapshot(snapshot) {
  state = JSON.parse(snapshot);
  saveState();
  A.renderAll();
  updateUndoButtons();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(state));
  applySnapshot(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state));
  applySnapshot(redoStack.pop());
}

/** Nombre de passos que es poden desfer (per a les proves). */
function undoDepth() { return undoStack.length; }

function updateUndoButtons() {
  el('undoBtn').disabled = !undoStack.length;
  el('redoBtn').disabled = !redoStack.length;
}

A.registerActions({ undo: () => undo(), redo: () => redo() });

Object.assign(A, {
  defaultTeamsData, defaultConfigData, defaultState, normalizeConfigData, normalizeTeamLayout, normalizePreferences,
  getState, getData, getTeams, saveState, pushUndo, saveWithUndo, undo, redo, undoDepth, updateUndoButtons
});

})(window.AulaMap);
