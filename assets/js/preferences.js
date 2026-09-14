/**
 * AulaMap — Equips per preferències de l'alumnat (sociograma)
 *
 * El docent passa un formulari on cada alumne escriu el seu nom i les persones
 * amb qui voldria treballar. Aquest mòdul llegeix el full de respostes (CSV,
 * TSV o Excel), el concilia amb la llista d'alumnes de la configuració activa i
 * proposa un repartiment que maximitza les preferències acomplertes.
 *
 * La proposta es pot tornar a generar tantes vegades com calgui i, en aplicar-la,
 * es carrega al panell d'Equips com qualsevol altra formació.
 */
(function (A) {
'use strict';

const { el, esc, uid, toast, pluralize, openModal, closeModal, appConfirm,
        COLORS, REL_TOGETHER, REL_SEPARATE } = A;

/* ── Constants ───────────────────────────────────────── */

const MAX_PREF_COLUMNS = 6;      // columnes de preferència que es poden mapar
const RANK_WEIGHTS = [3, 2, 1];  // pes de la 1a, 2a i 3a tria
const TAIL_WEIGHT = 1;           // pes de la 4a tria en endavant
const MUTUAL_BONUS = 2;          // premi quan la tria és recíproca
const CONSTRAINT_WEIGHT = 500;   // ajuntar/separar pesen més que cap preferència
const SHEETJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

/** Capçaleres que solen identificar cada mena de columna. */
const NAME_HINT = /(nom|alumn|estudiant|name|cognom)/i;
const PREF_HINT = /(prefer|opci|tria|elecc|company|amic|amiga|choice|escull|treballar)/i;
const SKIP_HINT = /(marca.*temps|timestamp|correu|e-?mail|adre|hora|data|^id$|curs|grup|classe|nivell|puntuaci)/i;

/* ── Noms: normalització i cerca ─────────────────────── */

/** Text comparable: sense accents, símbols ni majúscules. */
function normalizeNameText(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value) {
  return normalizeNameText(value).split(' ').filter(Boolean);
}

/** Clau independent de l'ordre: "Puig Solà, Anna" i "Anna Puig Sola" coincideixen. */
function nameKey(value) {
  return nameTokens(value).slice().sort().join(' ');
}

/** Índex de cerca sobre una llista d'alumnes. */
function buildNameIndex(students) {
  const byKey = new Map();
  const entries = students.map(student => {
    const key = nameKey(student.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(student);
    return { student, tokens: new Set(nameTokens(student.name)) };
  });
  return { byKey, entries };
}

/**
 * Cerca un nom escrit a mà dins d'un índex d'alumnes. Accepta l'ordre canviat,
 * els accents que falten i els noms escrits a mitges ("Anna" per "Anna Puig"),
 * sempre que no hi hagi més d'un candidat possible.
 * @returns {{student:object|null, ambiguous:boolean}}
 */
function resolveName(value, index) {
  const key = nameKey(value);
  if (!key) return { student: null, ambiguous: false };

  const exact = index.byKey.get(key);
  if (exact) return { student: exact[0], ambiguous: exact.length > 1 };

  const tokens = new Set(nameTokens(value));
  const candidates = index.entries
    .map(entry => ({ entry, shared: [...tokens].filter(token => entry.tokens.has(token)).length }))
    .filter(item => item.shared > 0 && (item.shared === tokens.size || item.shared === item.entry.tokens.size));

  if (candidates.length === 1) return { student: candidates[0].entry.student, ambiguous: false };
  if (candidates.length > 1) {
    const strong = candidates.filter(item => item.shared >= 2);
    if (strong.length === 1) return { student: strong[0].entry.student, ambiguous: false };
    return { student: null, ambiguous: true };
  }
  return { student: null, ambiguous: false };
}

/* ── Estructura del full de respostes ────────────────── */

function dataRowsOf(rows, hasHeader) { return hasHeader ? rows.slice(1) : rows; }

function tableWidth(rows) { return rows.reduce((max, row) => Math.max(max, row.length), 0); }

/** Etiqueta de cada columna: la capçalera del full o "Columna N". */
function columnLabels(rows, hasHeader) {
  return Array.from({ length: tableWidth(rows) }, (_, index) => {
    const header = hasHeader ? String(rows[0]?.[index] || '').trim() : '';
    return header || `Columna ${index + 1}`;
  });
}

function columnValues(rows, hasHeader, index) {
  return dataRowsOf(rows, hasHeader).map(row => String(row[index] || '').trim());
}

/** Columnes sense cap valor: el full pot venir amb columnes buides enmig. */
function emptyColumns(rows, hasHeader) {
  const empty = new Set();
  for (let index = 0; index < tableWidth(rows); index++) {
    if (columnValues(rows, hasHeader, index).every(value => value === '')) empty.add(index);
  }
  return empty;
}

/** Els valors d'una columna semblen noms de persona? */
function looksLikeNames(values) {
  const sample = values.filter(Boolean).slice(0, 12);
  if (!sample.length) return false;
  return sample.every(value => /[a-zà-ÿ]{2,}/i.test(value) && !/@/.test(value) &&
    !/^\d/.test(value) && !/\d{1,2}[:/]\d/.test(value));
}

/** La primera fila és una capçalera? */
function looksLikeHeader(rows) {
  if (rows.length < 2) return false;
  return (rows[0] || []).some(cell => {
    const text = String(cell || '');
    return NAME_HINT.test(text) || PREF_HINT.test(text) || SKIP_HINT.test(text);
  });
}

/** Proposta de correspondència entre columnes i camps. */
function autoMapping(rows, hasHeader) {
  const labels = columnLabels(rows, hasHeader);
  const empty = emptyColumns(rows, hasHeader);
  const usable = labels.map((_, index) => index).filter(index => !empty.has(index));
  const isSkipped = index => hasHeader && SKIP_HINT.test(labels[index]);

  let name = -1;
  if (hasHeader) {
    name = usable.find(index => NAME_HINT.test(labels[index]) && !PREF_HINT.test(labels[index]) && !isSkipped(index)) ?? -1;
  }
  if (name === -1) {
    name = usable.find(index => !isSkipped(index) && looksLikeNames(columnValues(rows, hasHeader, index))) ?? -1;
  }
  if (name === -1) name = usable[0] ?? -1;

  let prefs = hasHeader
    ? usable.filter(index => index !== name && PREF_HINT.test(labels[index]))
    : [];
  if (!prefs.length) {
    prefs = usable.filter(index => index !== name && !isSkipped(index) &&
      looksLikeNames(columnValues(rows, hasHeader, index)));
  }
  prefs = prefs.slice(0, MAX_PREF_COLUMNS);
  while (prefs.length < 3) prefs.push(-1);
  return { name, prefs };
}

/**
 * Files del full convertides a respostes.
 * Si algú respon dues vegades, es queda la resposta més nova.
 * @returns {{entries:Array<{name:string,choices:string[]}>, duplicates:number, nameless:number}}
 */
function readEntries(rows, hasHeader, mapping) {
  const seen = new Map();
  const entries = [];
  let duplicates = 0;
  let nameless = 0;
  dataRowsOf(rows, hasHeader).forEach(row => {
    const name = String(row[mapping.name] || '').trim();
    const choices = mapping.prefs.filter(index => index >= 0)
      .map(index => String(row[index] || '').trim())
      .filter(Boolean);
    if (!name) {
      if (choices.length) nameless++;
      return;
    }
    const key = nameKey(name);
    const previous = seen.get(key);
    if (previous) {
      duplicates++;
      previous.name = name;
      if (choices.length) previous.choices = choices;
      return;
    }
    const entry = { name, choices, studentId: null };
    seen.set(key, entry);
    entries.push(entry);
  });
  return { entries, duplicates, nameless };
}

/**
 * Compara les respostes amb la llista d'alumnes de la classe.
 * @returns {{matched:Array, fresh:Array, missing:Array}}
 */
function matchRoster(entries, students) {
  const index = buildNameIndex(students);
  const used = new Set();
  const matched = [];
  const fresh = [];
  entries.forEach(entry => {
    const { student } = resolveName(entry.name, index);
    if (student && !used.has(student.id)) {
      used.add(student.id);
      entry.studentId = student.id;
      matched.push({ entry, student });
    } else {
      entry.studentId = null;
      fresh.push(entry);
    }
  });
  return { matched, fresh, missing: students.filter(student => !used.has(student.id)) };
}

/**
 * Llista d'alumnes amb qui es formaran els equips, segons què vulgui fer el
 * docent amb els noms que no coincideixen. Els alumnes nous reben un
 * identificador provisional que només es desa si s'aplica la proposta.
 * @param {'merge'|'replace'|'matched'|'newConfig'} mode
 */
function buildRoster(mode, match, students, entries) {
  const byEntry = new Map();
  match.matched.forEach(item => byEntry.set(item.entry, { id: item.student.id, name: item.student.name, isNew: false }));
  match.fresh.forEach(entry => {
    const item = { id: uid('s'), name: entry.name, isNew: true };
    entry.studentId = item.id;
    byEntry.set(entry, item);
  });
  const fileOrder = entries.map(entry => byEntry.get(entry)).filter(Boolean);

  if (mode === 'matched') {
    match.fresh.forEach(entry => { entry.studentId = null; });
    return { students: fileOrder.filter(item => !item.isNew), removed: [] };
  }
  if (mode === 'replace') return { students: fileOrder, removed: match.missing.map(student => student.id) };
  if (mode === 'newConfig') return { students: fileOrder, removed: [] };

  const current = students.map(student => ({ id: student.id, name: student.name, isNew: false }));
  const known = new Set(current.map(item => item.id));
  return { students: [...current, ...fileOrder.filter(item => item.isNew && !known.has(item.id))], removed: [] };
}

/**
 * Tries convertides a identificadors d'alumne.
 * @returns {{prefs:Object<string,string[]>, unresolved:Array<{name:string,count:number,ambiguous:boolean}>}}
 */
function buildPreferences(entries, roster) {
  const index = buildNameIndex(roster);
  const ids = new Set(roster.map(student => student.id));
  const prefs = {};
  const unresolved = new Map();
  entries.forEach(entry => {
    if (!entry.studentId || !ids.has(entry.studentId)) return;
    const list = [];
    entry.choices.forEach(choice => {
      const { student, ambiguous } = resolveName(choice, index);
      if (student && ids.has(student.id)) {
        if (student.id !== entry.studentId && !list.includes(student.id)) list.push(student.id);
        return;
      }
      const key = nameKey(choice);
      const found = unresolved.get(key);
      if (found) found.count++;
      else unresolved.set(key, { name: choice, count: 1, ambiguous });
    });
    if (list.length) prefs[entry.studentId] = list;
  });
  return { prefs, unresolved: [...unresolved.values()].sort((a, b) => b.count - a.count) };
}

/* ── Mides dels equips ───────────────────────────────── */

/**
 * Mides de cada equip a partir del que demana el docent.
 * @param {number} total alumnes a repartir
 * @param {{mode:'count'|'size', count:number, size:number,
 *          remainder:'balanced'|'ownGroup'|'leaveOut'}} options
 * @returns {{sizes:number[], leftover:number, remainder:number}}
 */
function planPreferenceSizes(total, options) {
  const remainderMode = options.remainder || 'balanced';
  if (total < 1) return { sizes: [], leftover: 0, remainder: 0 };

  const spread = (count, amount) => {
    const base = Math.floor(amount / count);
    const extra = amount % count;
    return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
  };

  if (options.mode === 'size') {
    const size = Math.max(1, Math.min(Math.round(options.size) || 1, total));
    const full = Math.floor(total / size);
    const remainder = total % size;
    if (!full) return { sizes: [total], leftover: 0, remainder: 0 };
    if (!remainder) return { sizes: Array(full).fill(size), leftover: 0, remainder: 0 };
    if (remainderMode === 'ownGroup') return { sizes: [...Array(full).fill(size), remainder], leftover: 0, remainder };
    if (remainderMode === 'leaveOut') return { sizes: Array(full).fill(size), leftover: remainder, remainder };
    return { sizes: spread(full, total), leftover: 0, remainder };
  }

  const count = Math.max(1, Math.min(Math.round(options.count) || 1, total));
  const remainder = total % count;
  if (!remainder) return { sizes: Array(count).fill(total / count), leftover: 0, remainder: 0 };
  const base = Math.floor(total / count);
  if (remainderMode === 'ownGroup') return { sizes: [...Array(count).fill(base), remainder], leftover: 0, remainder };
  if (remainderMode === 'leaveOut') return { sizes: Array(count).fill(base), leftover: remainder, remainder };
  return { sizes: spread(count, total), leftover: 0, remainder };
}

/** "3 equips de 4 i 2 equips de 3" */
function describeSizes(sizes, leftover) {
  const counts = new Map();
  sizes.forEach(size => counts.set(size, (counts.get(size) || 0) + 1));
  const parts = [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, amount]) => `${pluralize(amount, 'equip')} de ${size}`);
  if (leftover) parts.push(`${pluralize(leftover, 'alumne')} sense equip`);
  return parts.join(' i ') || '—';
}

/* ── Matriu d'afinitats ──────────────────────────────── */

/**
 * Pes de cada parella d'alumnes: les tries sumen segons la posició, les
 * recíproques tenen premi i els conjunts d'ajuntar i separar pesen prou com per
 * imposar-se a qualsevol preferència.
 */
function preferenceWeights(ids, prefs, options = {}) {
  const ranked = options.ranked !== false;
  const index = new Map(ids.map((id, position) => [id, position]));
  const weights = ids.map(() => new Array(ids.length).fill(0));

  const add = (a, b, value) => {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined || i === j) return;
    weights[i][j] += value;
    weights[j][i] += value;
  };

  Object.entries(prefs || {}).forEach(([studentId, list]) => {
    (list || []).forEach((targetId, rank) => {
      add(studentId, targetId, ranked ? (RANK_WEIGHTS[rank] ?? TAIL_WEIGHT) : 1);
      if ((prefs[targetId] || []).includes(studentId)) add(studentId, targetId, MUTUAL_BONUS / 2);
    });
  });

  const constraints = options.constraints;
  if (constraints) {
    const eachPair = (list, value) => {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) add(list[i], list[j], value);
      }
    };
    (constraints[REL_TOGETHER] || []).forEach(set => eachPair(set.students || [], CONSTRAINT_WEIGHT));
    (constraints[REL_SEPARATE] || []).forEach(set => eachPair(set.students || [], -CONSTRAINT_WEIGHT));
  }
  return { ids, index, weights };
}

/* ── Repartiment ─────────────────────────────────────── */

/** Generador pseudoaleatori amb llavor: la mateixa llavor dóna la mateixa proposta. */
function seededRandom(seed) {
  let state = (seed || 1) >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, random) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

/** Afinitat d'un alumne amb els membres d'un equip. */
function affinity(studentId, group, model, excludeId) {
  const row = model.weights[model.index.get(studentId)];
  let sum = 0;
  for (const other of group) {
    if (other === excludeId || other === studentId) continue;
    sum += row[model.index.get(other)];
  }
  return sum;
}

/** Suma de les afinitats internes de tots els equips (el darrer calaix no compta). */
function totalScore(groups, model, realGroups) {
  let total = 0;
  for (let g = 0; g < realGroups; g++) {
    const group = groups[g];
    for (let i = 0; i < group.length; i++) {
      const row = model.weights[model.index.get(group[i])];
      for (let j = i + 1; j < group.length; j++) total += row[model.index.get(group[j])];
    }
  }
  return total;
}

/** Construcció voraç: a cada pas, la parella alumne–equip que més suma. */
function greedyAssign(ids, model, buckets, realGroups, random) {
  const groups = buckets.map(() => []);
  const pending = new Set(shuffled(ids, random));
  while (pending.size) {
    let bestStudent = null;
    let bestGroup = -1;
    let bestScore = -Infinity;
    for (const studentId of pending) {
      for (let g = 0; g < groups.length; g++) {
        if (groups[g].length >= buckets[g]) continue;
        const gain = g < realGroups ? affinity(studentId, groups[g], model) : 0;
        // Es completen els equips començats abans d'obrir-ne un altre.
        const score = gain - (groups[g].length ? 0 : 0.001) + random() * 0.0005;
        if (score > bestScore) { bestScore = score; bestStudent = studentId; bestGroup = g; }
      }
    }
    if (bestStudent === null) break;
    groups[bestGroup].push(bestStudent);
    pending.delete(bestStudent);
  }
  return groups;
}

/** Refinament: intercanvis entre equips mentre el resultat millori. */
function improveAssignment(groups, model, realGroups, rounds) {
  for (let round = 0; round < rounds; round++) {
    let bestDelta = 1e-9;
    let move = null;
    for (let gi = 0; gi < groups.length; gi++) {
      for (let gj = gi + 1; gj < groups.length; gj++) {
        for (let ai = 0; ai < groups[gi].length; ai++) {
          const a = groups[gi][ai];
          for (let bj = 0; bj < groups[gj].length; bj++) {
            const b = groups[gj][bj];
            const left = gi < realGroups ? affinity(b, groups[gi], model, a) - affinity(a, groups[gi], model, a) : 0;
            const right = gj < realGroups ? affinity(a, groups[gj], model, b) - affinity(b, groups[gj], model, b) : 0;
            const delta = left + right;
            if (delta > bestDelta) { bestDelta = delta; move = [gi, ai, gj, bj]; }
          }
        }
      }
    }
    if (!move) return;
    const [gi, ai, gj, bj] = move;
    const swap = groups[gi][ai];
    groups[gi][ai] = groups[gj][bj];
    groups[gj][bj] = swap;
  }
}

/**
 * Reparteix els alumnes maximitzant les preferències acomplertes.
 *
 * Formar els equips òptims és un problema NP-complet: es fan diverses
 * construccions voraces amb punts de partida diferents i cadascuna es refina
 * amb intercanvis fins que no millora. Per a una classe sencera el càlcul dura
 * mil·lisegons i el resultat sol ser òptim o molt a prop.
 *
 * @param {{ids:string[], prefs:Object, sizes:number[], leftover?:number,
 *          ranked?:boolean, constraints?:Object, seed?:number, restarts?:number}} options
 * @returns {{groups:string[][], leftover:string[], score:number}}
 */
function optimizePreferenceGroups(options) {
  const ids = (options.ids || []).slice();
  const sizes = (options.sizes || []).slice();
  const leftoverSize = Math.max(0, options.leftover || 0);
  const model = preferenceWeights(ids, options.prefs || {}, {
    ranked: options.ranked !== false,
    constraints: options.constraints
  });
  if (!ids.length || !sizes.length) return { groups: sizes.map(() => []), leftover: ids, score: 0 };

  const buckets = leftoverSize > 0 ? [...sizes, leftoverSize] : sizes.slice();
  const realGroups = sizes.length;
  const random = seededRandom(options.seed || 1);
  const restarts = options.restarts || (ids.length > 90 ? 4 : 8);
  const rounds = options.rounds || (ids.length > 90 ? 25 : 60);

  let best = null;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < restarts; attempt++) {
    const candidate = greedyAssign(ids, model, buckets, realGroups, random);
    improveAssignment(candidate, model, realGroups, rounds);
    const score = totalScore(candidate, model, realGroups);
    if (score > bestScore) {
      bestScore = score;
      best = candidate.map(group => group.slice());
    }
  }
  return {
    groups: best.slice(0, realGroups),
    leftover: leftoverSize > 0 ? best[realGroups] : [],
    score: bestScore
  };
}

/* ── Indicadors ──────────────────────────────────────── */

/**
 * Preferències acomplertes per alumne, per equip i en conjunt. Només es
 * compten les tries d'alumnes que participen en el repartiment.
 * @returns {{met:number, total:number, pct:number|null, perStudent:Object,
 *            perGroup:Array, answered:number, unhappy:number, mutual:number}}
 */
function preferenceStats(groups, prefs, options = {}) {
  const teamOf = new Map();
  groups.forEach((group, index) => group.forEach(id => teamOf.set(id, index)));
  (options.leftover || []).forEach(id => { if (!teamOf.has(id)) teamOf.set(id, -1); });

  const placed = new Set(teamOf.keys());
  const perStudent = {};
  const perGroup = groups.map(() => ({ met: 0, total: 0, pct: null, mutual: 0 }));
  let met = 0;
  let total = 0;
  let answered = 0;
  let unhappy = 0;
  let mutual = 0;

  placed.forEach(id => {
    const index = teamOf.get(id);
    const list = (prefs[id] || []).filter(other => placed.has(other) && other !== id);
    const metIds = index >= 0 ? list.filter(other => teamOf.get(other) === index) : [];
    const missIds = list.filter(other => !metIds.includes(other));
    perStudent[id] = {
      met: metIds.length,
      total: list.length,
      metIds,
      missIds,
      first: list.length ? metIds.includes(list[0]) : false
    };
    met += metIds.length;
    total += list.length;
    if (list.length) {
      answered++;
      if (!metIds.length) unhappy++;
    }
    if (index >= 0) {
      perGroup[index].met += metIds.length;
      perGroup[index].total += list.length;
      metIds.forEach(other => {
        if ((prefs[other] || []).includes(id) && id < other) { mutual++; perGroup[index].mutual++; }
      });
    }
  });

  perGroup.forEach(entry => { entry.pct = entry.total ? Math.round(entry.met * 100 / entry.total) : null; });
  return {
    met, total, answered, unhappy, mutual, perStudent, perGroup,
    pct: total ? Math.round(met * 100 / total) : null
  };
}

/** "3 parelles recíproques" amb la concordança correcta. */
function mutualLabel(count) {
  return `${pluralize(count, 'parella', 'parelles')} recípro${count === 1 ? 'ca' : 'ques'}`;
}

/** Classe de color segons les preferències acomplertes. */
function matchTone(met, total) {
  if (!total) return 'none';
  if (met >= total) return 'good';
  return met > 0 ? 'medium' : 'bad';
}

function matchChip(entry, name) {
  if (!entry) return '';
  const tone = matchTone(entry.met, entry.total);
  const label = entry.total ? `${entry.met}/${entry.total}` : '—';
  const title = !entry.total
    ? `${name}: no va indicar cap preferència`
    : [`${name}: ${entry.met} de ${entry.total} preferències acomplertes`,
       entry.metIds.length ? `Amb: ${entry.metIds.map(A.studentName).join(', ')}` : '',
       entry.missIds.length ? `Sense: ${entry.missIds.map(A.studentName).join(', ')}` : '']
      .filter(Boolean).join(' · ');
  return `<span class="pref-chip pref-${tone}" title="${esc(title)}">${esc(label)}</span>`;
}

function matchBar(pct) {
  const value = pct === null ? 0 : pct;
  const tone = pct === null ? 'none' : (pct >= 75 ? 'good' : pct >= 40 ? 'medium' : 'bad');
  return `<div class="pref-bar"><span class="pref-${tone}" style="width:${value}%"></span></div>`;
}

function storedPreferences() { return A.getTeams().preferences || null; }

/**
 * Indicadors per al panell lateral d'equips. Retorna `null` quan la
 * configuració activa no té preferències carregades.
 */
function preferenceTeamView(groups) {
  const stored = storedPreferences();
  if (!stored || !groups || !groups.length) return null;
  const stats = preferenceStats(groups, stored.prefs);
  if (!stats.total) return null;
  return {
    stats,
    summary: `<div class="pref-summary">
        <div class="pref-summary-head">
          <span><span class="mi mi-xs">diversity_3</span> Preferències acomplertes</span>
          <b class="pref-${matchTone(stats.met, stats.total)}">${stats.pct}%</b>
        </div>
        ${matchBar(stats.pct)}
        <div class="pref-summary-meta">${stats.met} de ${stats.total} tries · ${mutualLabel(stats.mutual)}${stats.unhappy ? ` · ${stats.unhappy} sense cap tria acomplerta` : ''}</div>
      </div>`,
    group: index => {
      const entry = stats.perGroup[index];
      if (!entry || entry.pct === null) return '';
      return `<span class="pref-chip pref-${entry.pct >= 75 ? 'good' : entry.pct >= 40 ? 'medium' : 'bad'}"
        title="${esc(`${entry.met} de ${entry.total} preferències de l'equip`)}">${entry.pct}%</span>`;
    },
    member: id => matchChip(stats.perStudent[id], A.studentName(id))
  };
}

/* ── Secció del panell d'equips ──────────────────────── */

/**
 * Memòria de la millor formació carregada. Mentre el docent fa proves
 * (repartiments nous, canvis a mà), la versió amb més preferències
 * acomplertes es guarda per poder-hi tornar.
 */
function rememberFormation(teams, stats) {
  if (!stats || !stats.total || !teams.groups?.length) return;
  const best = teams.preferences.best;
  if (best && stats.pct <= best.pct) return;
  teams.preferences.best = {
    groups: teams.groups.map(group => group.slice()),
    pct: stats.pct,
    updated: formattedNow()
  };
  A.saveState();
}

/** Torna a carregar la millor formació desada. */
function restoreFormation() {
  const stored = storedPreferences();
  if (!stored?.best) return;
  const write = () => {
    const teams = A.getTeams();
    const valid = new Set(A.getData().students.map(student => student.id));
    const groups = stored.best.groups
      .map(group => group.filter(id => valid.has(id)))
      .filter(group => group.length);
    if (!groups.length) { toast('Aquesta versió ja no té cap alumne de la classe', 'error'); return; }
    A.saveWithUndo();
    teams.groups = groups;
    teams.lockedTeams = {};
    teams.lockedStudents = {};
    teams.positions = {};
    teams.layout = null;
    teams.activeSaved = null;
    A.arrangeTeamDesks();
    A.saveState();
    if (A.view.current !== 'equips') A.switchCanvasView('equips');
    A.renderAll();
    setTimeout(() => A.zoomReset(), 60);
    toast(`Versió recuperada · ${stored.best.pct}% de preferències`, 'success');
  };
  if (A.guardUnsavedTeams) A.guardUnsavedTeams(write);
  else write();
}

function renderPreferencePanel() {
  const box = el('teamPrefStatus');
  if (!box) return;
  const stored = storedPreferences();
  if (!stored) {
    box.innerHTML = `<p class="panel-hint" style="margin-bottom:6px">Carrega el full de respostes del formulari (nom i fins a tres companys) i
      l'aplicació proposarà els equips que acompleixin més preferències.</p>`;
    return;
  }
  const teams = A.getTeams();
  const answered = Object.keys(stored.prefs).length;
  const stats = teams.groups?.length ? preferenceStats(teams.groups, stored.prefs) : null;
  const current = stats && stats.total ? stats.pct : null;
  rememberFormation(teams, stats);

  const best = stored.best;
  const canRestore = !!best && (current === null || best.pct > current);
  box.innerHTML = `<div class="pref-status">
      <div class="pref-status-head">
        <span><span class="mi mi-xs">check_circle</span> ${pluralize(answered, 'resposta', 'respostes')} carregades</span>
        ${current === null ? '' : `<b class="pref-${matchTone(stats.met, stats.total)}">${current}%</b>`}
      </div>
      <div class="pref-status-meta">${esc(stored.source || 'Full de preferències')}${stored.updated ? ` · ${esc(stored.updated)}` : ''}${stored.unresolved?.length ? ` · ${pluralize(stored.unresolved.length, 'nom')} sense identificar` : ''}</div>
      <div class="pref-status-actions">
        <button class="btn btn-sm" data-action="prefRegenerate"><span class="mi mi-xs">auto_awesome</span> Tornar a proposar</button>
        <button class="btn btn-sm btn-danger" data-action="prefForget" title="Esborrar les preferències carregades"><span class="mi mi-xs">delete</span></button>
      </div>
      ${canRestore ? `<button class="btn btn-sm pref-restore" data-action="prefRestoreFormation"
        title="${esc(`Equips del ${best.updated} amb el ${best.pct}% de preferències acomplertes`)}">
        <span class="mi mi-xs">history</span> Recuperar la millor versió (${best.pct}%)</button>` : ''}
    </div>`;
}

function forgetPreferences() {
  appConfirm('Esborrar les preferències?', 'Els equips ja formats es mantindran, però es perdran els indicadors de preferències.', () => {
    A.saveWithUndo();
    A.getTeams().preferences = null;
    A.saveState();
    A.renderTeamsPanel();
    A.renderTeamsCanvas();
    toast('Preferències esborrades', 'info');
  });
}

/* ── Assistent ───────────────────────────────────────── */

let W = null;

function formattedNow() {
  const now = new Date();
  return `${now.toLocaleDateString('ca-ES')} ${now.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' })}`;
}

function defaultTeamCount(total) {
  return Math.max(2, Math.min(total, Math.round(total / 4) || 2));
}

function newWizard() {
  return {
    step: 1, text: '', source: '', rows: [], hasHeader: true,
    mapping: { name: -1, prefs: [-1, -1, -1] },
    entries: [], duplicates: 0, nameless: 0, match: null,
    rosterMode: 'merge', newConfigName: '', roster: [], prefs: {}, unresolved: [],
    plan: { mode: 'count', count: 4, size: 4, remainder: 'balanced' },
    ranked: true, useConstraints: true,
    proposal: null, best: null, attempts: 0, picked: null, fromStored: false
  };
}

function startWizard(options = {}) {
  const students = A.getData().students;
  const stored = storedPreferences();
  if (options.fromStored) {
    if (!stored) { toast('Encara no hi ha preferències carregades', 'error'); return; }
    W = newWizard();
    W.fromStored = true;
    W.source = stored.source;
    W.ranked = stored.ranked !== false;
    W.roster = students.map(student => ({ id: student.id, name: student.name, isNew: false }));
    W.prefs = stored.prefs;
    W.unresolved = (stored.unresolved || []).map(name => ({ name, count: 1, ambiguous: false }));
    W.plan.count = defaultTeamCount(W.roster.length);
    W.step = 4;
    renderWizard();
    return;
  }
  W = newWizard();
  W.plan.count = defaultTeamCount(Math.max(4, students.length));
  renderWizard();
}

function renderWizard() {
  if (!W) return;
  const body = W.step === 2 ? stepColumns()
    : W.step === 3 ? stepStudents()
    : W.step === 4 ? stepPlan()
    : W.step === 5 ? stepResult()
    : stepSource();
  openModal(body);
  if (W.step === 1) A.focusModalField('prefText');
}

function wizardShell(body, footer) {
  const steps = ['Origen', 'Columnes', 'Alumnat', 'Equips', 'Proposta'];
  const items = steps.map((label, index) => {
    const position = index + 1;
    const state = position === W.step ? 'active' : position < W.step ? 'done' : '';
    return `<li class="${state}"><span>${position}</span>${esc(label)}</li>`;
  }).join('');
  return `<div class="pref-wizard">
    <h3><span class="mi">diversity_3</span> Equips per preferències</h3>
    <ol class="pref-steps">${items}</ol>
    ${body}
    <div class="modal-footer">${footer}</div>
  </div>`;
}

/* Pas 1 — origen de les dades */

function stepSource() {
  return wizardShell(`
    <p class="modal-note">Carrega el full amb les respostes de l'alumnat: una fila per alumne, amb el seu nom i
      les persones amb qui voldria treballar. S'accepten fitxers <b>CSV</b>, <b>TSV</b> i <b>Excel</b> (.xlsx),
      i també hi pots enganxar les dades directament des del full de càlcul. Les columnes buides i les
      respostes incompletes no són cap problema.</p>
    <div class="field"><label>Fitxer</label>
      <input type="file" id="prefFile" accept=".csv,.tsv,.txt,.xlsx,.xls" data-change="prefFileChosen"></div>
    <div class="field"><label>O enganxa-hi les dades</label>
      <textarea id="prefText" rows="7" style="resize:vertical" placeholder="Nom;Preferència 1;Preferència 2;Preferència 3&#10;Anna Puig;Pau Serra;Nil Roca;Jana Ferrer">${esc(W.text)}</textarea></div>
    ${W.rows.length ? `<div class="pref-note"><span class="mi mi-xs">description</span>
      <div>Ja hi ha un full llegit: <b>${esc(W.source || 'dades enganxades')}</b>, ${pluralize(W.rows.length, 'fila', 'files')}.
      Continua per tornar a les columnes, o carrega'n un altre.</div></div>` : ''}`,
    `<button class="btn" data-action="closeModal">Cancel·lar</button>
     <button class="btn" data-action="prefTemplate" title="Descarregar un full d'exemple"><span class="mi mi-xs">download</span> Plantilla</button>
     <button class="btn btn-primary" data-action="prefReadSource">Continuar <span class="mi mi-xs">arrow_forward</span></button>`);
}

function downloadTemplate() {
  const rows = [
    ['Nom i cognoms', 'Preferència 1', 'Preferència 2', 'Preferència 3'],
    ['Anna Puig Solà', 'Pau Serra', 'Nil Roca', 'Jana Ferrer'],
    ['Pau Serra Vidal', 'Anna Puig Solà', 'Nil Roca', ''],
    ['Nil Roca Camps', 'Pau Serra Vidal', '', '']
  ];
  A.downloadBlob(new Blob(['\uFEFF' + A.csvFrom(rows)], { type: 'text/csv;charset=utf-8' }),
                 'aulamap_plantilla_preferencies.csv');
  toast('Plantilla descarregada', 'success');
}

/** Full de càlcul .xlsx: la biblioteca es carrega només quan cal. */
let _sheetJs = null;

function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_sheetJs) return _sheetJs;
  _sheetJs = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SHEETJS_URL;
    script.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('no disponible')));
    script.onerror = () => { _sheetJs = null; reject(new Error('sense connexió')); };
    document.head.appendChild(script);
  });
  return _sheetJs;
}

function readSheetFile(file) {
  toast('Llegint el full de càlcul...', 'info');
  loadSheetJs().then(XLSX => {
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const book = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
        const sheet = book.Sheets[book.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false, defval: '' })
          .map(row => (row || []).map(cell => String(cell ?? '').trim()));
        acceptRows(rows.filter(row => row.some(cell => cell !== '')));
      } catch (error) {
        toast('No s\'ha pogut llegir el full: ' + error.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }).catch(() => toast('Els fitxers .xlsx necessiten connexió. Desa el full com a CSV i torna-ho a provar.', 'error'));
}

function readTextFile(file) {
  const read = encoding => {
    const reader = new FileReader();
    reader.onload = event => {
      const text = String(event.target.result || '');
      // Els CSV que exporta l'Excel en Windows solen venir en ANSI: si es veuen
      // caràcters de substitució, es torna a llegir amb la codificació antiga.
      if (encoding === 'utf-8' && text.includes('\uFFFD')) { read('windows-1252'); return; }
      W.text = text;
      acceptRows(A.parseCsvTable(text));
    };
    reader.onerror = () => toast('No s\'ha pogut llegir el fitxer', 'error');
    reader.readAsText(file, encoding);
  };
  read('utf-8');
}

function fileChosen(input) {
  const file = input.files && input.files[0];
  if (!file || !W) return;
  W.source = file.name;
  if (/\.xlsx?$/i.test(file.name)) readSheetFile(file);
  else readTextFile(file);
}

/** Desa les files llegides i passa al mapatge de columnes. */
function acceptRows(rows) {
  if (!rows || !rows.length) { toast('El full no conté dades', 'error'); return; }
  W.rows = rows;
  W.hasHeader = looksLikeHeader(rows);
  W.mapping = autoMapping(rows, W.hasHeader);
  W.step = 2;
  renderWizard();
}

function readPastedSource() {
  const text = el('prefText')?.value || W.text;
  W.text = text;
  if (!text.trim()) {
    // En tornar enrere, el full que ja s'havia llegit segueix disponible.
    if (W.rows.length) { W.step = 2; renderWizard(); return; }
    toast('Carrega un fitxer o enganxa-hi les dades', 'error');
    return;
  }
  if (!W.source) W.source = 'Dades enganxades';
  acceptRows(A.parseCsvTable(text));
}

/* Pas 2 — columnes */

function stepColumns() {
  const labels = columnLabels(W.rows, W.hasHeader);
  const empty = emptyColumns(W.rows, W.hasHeader);
  const rows = dataRowsOf(W.rows, W.hasHeader);
  const option = (index, selected) =>
    `<option value="${index}"${index === selected ? ' selected' : ''}>${esc(labels[index])}${empty.has(index) ? ' (buida)' : ''}</option>`;
  const columnSelect = (role, selected, position, allowNone) =>
    `<select data-change="prefSetColumn" data-role="${role}"${position === undefined ? '' : ` data-idx="${position}"`}>
      ${allowNone ? `<option value="-1"${selected < 0 ? ' selected' : ''}>— cap —</option>` : ''}
      ${labels.map((_, index) => option(index, selected)).join('')}
    </select>`;

  const preview = rows.slice(0, 5).map(row => `<tr>${labels.map((_, index) => {
    const role = index === W.mapping.name ? ' class="pref-col-name"'
      : W.mapping.prefs.includes(index) ? ' class="pref-col-pref"' : '';
    return `<td${role}>${esc(row[index] || '')}</td>`;
  }).join('')}</tr>`).join('');

  const prefRows = W.mapping.prefs.map((selected, position) => `
    <div class="field"><label>Preferència ${position + 1}</label>${columnSelect('pref', selected, position, true)}</div>`).join('');

  return wizardShell(`
    <p class="modal-note">${pluralize(rows.length, 'fila', 'files')} de dades i ${pluralize(labels.length, 'columna', 'columnes')}.
      Comprova que les columnes estiguin ben assignades.</p>
    <label class="equips-toggle" style="margin-bottom:10px">
      <input type="checkbox" ${W.hasHeader ? 'checked' : ''} data-change="prefToggleHeader">
      <span>La primera fila és la capçalera</span>
    </label>
    <div class="pref-grid">
      <div class="field"><label>Nom de l'alumne/a</label>${columnSelect('name', W.mapping.name, undefined, false)}</div>
      ${prefRows}
    </div>
    ${W.mapping.prefs.length < MAX_PREF_COLUMNS
      ? '<button class="btn btn-sm" data-action="prefAddColumn"><span class="mi mi-xs">add</span> Una preferència més</button>'
      : ''}
    <div class="pref-preview"><table>
      <thead><tr>${labels.map((label, index) => {
        const role = index === W.mapping.name ? ' class="pref-col-name"'
          : W.mapping.prefs.includes(index) ? ' class="pref-col-pref"' : '';
        return `<th${role}>${esc(label)}</th>`;
      }).join('')}</tr></thead>
      <tbody>${preview}</tbody>
    </table></div>`,
    `<button class="btn" data-action="prefBack" data-step="1"><span class="mi mi-xs">arrow_back</span> Enrere</button>
     <button class="btn btn-primary" data-action="prefColumnsNext">Continuar <span class="mi mi-xs">arrow_forward</span></button>`);
}

function setColumn(role, position, value) {
  const index = parseInt(value, 10);
  if (role === 'name') W.mapping.name = index;
  else W.mapping.prefs[position] = index;
  renderWizard();
}

function toggleHeader(checked) {
  W.hasHeader = checked;
  W.mapping = autoMapping(W.rows, W.hasHeader);
  renderWizard();
}

function columnsNext() {
  if (W.mapping.name < 0) { toast('Indica quina columna té el nom', 'error'); return; }
  const prefs = W.mapping.prefs.filter(index => index >= 0 && index !== W.mapping.name);
  if (!prefs.length) { toast('Indica com a mínim una columna de preferència', 'error'); return; }
  W.mapping.prefs = W.mapping.prefs.map(index => (index === W.mapping.name ? -1 : index));

  const read = readEntries(W.rows, W.hasHeader, W.mapping);
  if (!read.entries.length) { toast('No s\'ha trobat cap nom a la columna triada', 'error'); return; }
  W.entries = read.entries;
  W.duplicates = read.duplicates;
  W.nameless = read.nameless;
  W.match = matchRoster(W.entries, A.getData().students);
  W.rosterMode = 'merge';
  refreshRoster();
  W.step = 3;
  renderWizard();
}

/** Recalcula la llista de treball i les preferències segons el mode triat. */
function refreshRoster() {
  const built = buildRoster(W.rosterMode, W.match, A.getData().students, W.entries);
  W.roster = built.students;
  const result = buildPreferences(W.entries, W.roster);
  W.prefs = result.prefs;
  W.unresolved = result.unresolved;
  W.plan.count = Math.min(W.plan.count || defaultTeamCount(W.roster.length), Math.max(1, W.roster.length));
}

/* Pas 3 — alumnat */

function rosterModeOptions() {
  const students = A.getData().students;
  const fresh = W.match.fresh.length;
  const missing = W.match.missing.length;
  const matched = W.match.matched.length;
  const options = [];
  if (!students.length) {
    options.push(['merge', 'Crear la llista amb els alumnes del full', `S'afegiran ${pluralize(fresh, 'alumne')} a la configuració activa.`]);
    return options;
  }
  options.push(['merge', fresh ? 'Afegir els alumnes nous i conservar la resta' : 'Conservar la llista d\'alumnes actual',
    fresh ? `${pluralize(fresh, 'alumne')} ${fresh === 1 ? 'nou' : 'nous'} s'afegiran a la classe.` : 'No es modificarà la llista d\'alumnes.']);
  if (fresh || missing) {
    options.push(['replace', 'Substituir la llista per la del full',
      `La classe passarà a tenir ${pluralize(W.match.matched.length + fresh, 'alumne')}${missing ? ` i s'eliminaran ${pluralize(missing, 'alumne')} que no surten al full` : ''}.`]);
  }
  if (fresh && matched) {
    options.push(['matched', 'Fer equips només amb els que ja hi són',
      `S'ignoraran ${pluralize(fresh, 'nom')} que no consten a la classe.`]);
  }
  options.push(['newConfig', 'Crear una configuració nova amb aquest full',
    'La classe actual es queda intacta i el full s\'obre en una configuració a part.']);
  return options;
}

function stepStudents() {
  const { matched, fresh, missing } = W.match;
  const options = rosterModeOptions();
  if (!options.some(option => option[0] === W.rosterMode)) { W.rosterMode = options[0][0]; refreshRoster(); }

  const cards = `<div class="pref-cards">
    <div class="pref-card"><b>${matched.length}</b><span>coincideixen amb la classe</span></div>
    <div class="pref-card${fresh.length ? ' pref-medium' : ''}"><b>${fresh.length}</b><span>noms nous al full</span></div>
    <div class="pref-card${missing.length ? ' pref-medium' : ''}"><b>${missing.length}</b><span>alumnes sense resposta</span></div>
  </div>`;

  const warnings = [];
  if (W.duplicates) warnings.push(`${pluralize(W.duplicates, 'fila', 'files')} ${W.duplicates === 1 ? 'repetida' : 'repetides'}: s'ha conservat la resposta més nova.`);
  if (W.nameless) warnings.push(`${pluralize(W.nameless, 'fila', 'files')} sense nom que s'han descartat.`);
  if (missing.length && W.rosterMode !== 'replace') {
    warnings.push(`Sense resposta: ${missing.slice(0, 8).map(student => student.name).join(', ')}${missing.length > 8 ? '…' : ''}. Entraran als equips sense cap preferència.`);
  }

  const unresolvedBox = W.unresolved.length
    ? `<div class="pref-note pref-note-warn"><span class="mi mi-xs">help</span>
        <div><b>${pluralize(W.unresolved.length, 'nom')} de preferència sense identificar</b>
        <div class="pref-unresolved">${W.unresolved.slice(0, 12).map(item =>
          `<span title="${esc(item.ambiguous ? 'Coincideix amb més d\'un alumne' : 'No s\'ha trobat a la llista')}">${esc(item.name)}${item.count > 1 ? ` ×${item.count}` : ''}${item.ambiguous ? ' (ambigu)' : ''}</span>`).join('')}${W.unresolved.length > 12 ? '<span>…</span>' : ''}</div>
        <div class="pref-note-meta">Aquestes tries no es tindran en compte. Sovint és un nom mal escrit o algú d'un altre grup.</div></div></div>`
    : '';

  return wizardShell(`
    ${cards}
    ${warnings.map(text => `<div class="pref-note"><span class="mi mi-xs">info</span><div>${esc(text)}</div></div>`).join('')}
    <div class="field" style="margin-top:10px"><label>Què vols fer amb l'alumnat?</label></div>
    <div class="pref-options">
      ${options.map(([mode, title, detail]) => `<label class="pref-option${W.rosterMode === mode ? ' selected' : ''}">
        <input type="radio" name="prefRoster" value="${mode}" ${W.rosterMode === mode ? 'checked' : ''} data-change="prefSetRosterMode">
        <div><b>${esc(title)}</b><span>${esc(detail)}</span></div>
      </label>`).join('')}
    </div>
    ${W.rosterMode === 'newConfig'
      ? `<div class="field"><label>Nom de la configuració nova</label>
          <input type="text" id="prefConfigName" value="${esc(W.newConfigName || defaultConfigName())}" data-input="prefSetConfigName"></div>`
      : ''}
    ${unresolvedBox}`,
    `<button class="btn" data-action="prefBack" data-step="2"><span class="mi mi-xs">arrow_back</span> Enrere</button>
     <button class="btn btn-primary" data-action="prefStudentsNext">Continuar <span class="mi mi-xs">arrow_forward</span></button>`);
}

function defaultConfigName() {
  const base = (W.source || 'Preferències').replace(/\.[a-z0-9]+$/i, '').trim();
  return base ? base.slice(0, 40) : 'Preferències';
}

function setRosterMode(mode) {
  W.rosterMode = mode;
  refreshRoster();
  renderWizard();
}

function studentsNext() {
  if (W.roster.length < 2) { toast('Calen com a mínim dos alumnes', 'error'); return; }
  if (W.rosterMode === 'newConfig' && !W.newConfigName) W.newConfigName = defaultConfigName();
  W.plan.count = Math.min(Math.max(2, W.plan.count || defaultTeamCount(W.roster.length)), W.roster.length);
  W.step = 4;
  renderWizard();
}

/* Pas 4 — equips */

function currentConstraints() {
  if (!W.useConstraints) return null;
  const constraints = A.getTeams().constraints;
  const ids = new Set(W.roster.map(student => student.id));
  const filter = list => (list || [])
    .map(set => ({ students: (set.students || []).filter(id => ids.has(id)) }))
    .filter(set => set.students.length > 1);
  return { [REL_TOGETHER]: filter(constraints[REL_TOGETHER]), [REL_SEPARATE]: filter(constraints[REL_SEPARATE]) };
}

function constraintCount() {
  const constraints = currentConstraints();
  if (!constraints) return 0;
  return constraints[REL_TOGETHER].length + constraints[REL_SEPARATE].length;
}

function stepPlan() {
  const total = W.roster.length;
  const plan = planPreferenceSizes(total, W.plan);
  const withoutPrefs = W.roster.filter(student => !(W.prefs[student.id] || []).length).length;
  const teams = A.getTeams();
  const hasConstraints = (teams.constraints[REL_TOGETHER].length + teams.constraints[REL_SEPARATE].length) > 0;

  const remainderBox = plan.remainder > 0 ? `
    <div class="equips-remaining">
      <span class="mi mi-xs">info</span> ${pluralize(total, 'alumne')} no es reparteixen en parts iguals:
      sobren <b>${plan.remainder}</b>. Què en vols fer?
      <div class="equips-remaining-btns">
        <button class="btn btn-sm ${W.plan.remainder === 'balanced' ? 'selected-opt' : ''}" data-action="prefSetRemainder" data-value="balanced">Equips desiguals (±1)</button>
        <button class="btn btn-sm ${W.plan.remainder === 'ownGroup' ? 'selected-opt' : ''}" data-action="prefSetRemainder" data-value="ownGroup">Un equip a part</button>
        <button class="btn btn-sm ${W.plan.remainder === 'leaveOut' ? 'selected-opt' : ''}" data-action="prefSetRemainder" data-value="leaveOut">Deixar-los sense equip</button>
      </div>
    </div>` : '';

  return wizardShell(`
    <p class="modal-note">${pluralize(total, 'alumne')} a repartir${withoutPrefs ? `, ${withoutPrefs} sense cap preferència indicada` : ''}.</p>
    <div class="pref-modes">
      <button class="btn btn-sm ${W.plan.mode === 'count' ? 'selected-opt' : ''}" data-action="prefSetPlanMode" data-value="count">Nombre d'equips</button>
      <button class="btn btn-sm ${W.plan.mode === 'size' ? 'selected-opt' : ''}" data-action="prefSetPlanMode" data-value="size">Alumnes per equip</button>
    </div>
    <div class="pref-grid">
      <div class="field"><label>${W.plan.mode === 'count' ? 'Quants equips' : 'Alumnes per equip'}</label>
        <input type="number" id="prefPlanValue" min="1" max="${Math.max(1, total)}"
               value="${W.plan.mode === 'count' ? W.plan.count : W.plan.size}" data-change="prefSetPlanValue"></div>
      <div class="field"><label>Resultat</label><input type="text" value="${esc(describeSizes(plan.sizes, plan.leftover))}" readonly style="opacity:0.7"></div>
    </div>
    ${remainderBox}
    <label class="equips-toggle">
      <input type="checkbox" ${W.ranked ? 'checked' : ''} data-change="prefToggleRanked">
      <span>Prioritzar les primeres preferències</span>
    </label>
    ${hasConstraints ? `<label class="equips-toggle">
      <input type="checkbox" ${W.useConstraints ? 'checked' : ''} data-change="prefToggleConstraints">
      <span>Respectar els conjunts d'ajuntar i separar (${constraintCount() || 0})</span>
    </label>` : ''}`,
    `<button class="btn" data-action="prefBack" data-step="${W.fromStored ? 0 : 3}"><span class="mi mi-xs">${W.fromStored ? 'close' : 'arrow_back'}</span> ${W.fromStored ? 'Cancel·lar' : 'Enrere'}</button>
     <button class="btn btn-primary" data-action="prefGenerate"><span class="mi mi-xs">auto_awesome</span> Generar proposta</button>`);
}

function setPlanMode(mode) {
  W.plan.mode = mode;
  W.plan.remainder = 'balanced';
  renderWizard();
}

function setPlanValue(value) {
  const parsed = Math.max(1, Math.min(parseInt(value, 10) || 1, Math.max(1, W.roster.length)));
  if (W.plan.mode === 'count') W.plan.count = parsed;
  else W.plan.size = parsed;
  W.plan.remainder = 'balanced';
  renderWizard();
}

function generateProposal(newSeed) {
  const total = W.roster.length;
  const plan = planPreferenceSizes(total, W.plan);
  if (!plan.sizes.length) { toast('No hi ha prou alumnes', 'error'); return; }
  const seed = newSeed || Math.floor(Math.random() * 1e9) + 1;
  const result = optimizePreferenceGroups({
    ids: W.roster.map(student => student.id),
    prefs: W.prefs,
    sizes: plan.sizes,
    leftover: plan.leftover,
    ranked: W.ranked,
    constraints: currentConstraints(),
    seed
  });
  W.attempts++;
  W.picked = null;
  W.proposal = rateProposal({ ...result, seed, attempt: W.attempts, edited: false });
  keepIfBest();
  W.step = 5;
  renderWizard();
}

/** Còpia independent: la millor proposta no ha de canviar si es retoca a mà. */
function cloneProposal(proposal) {
  return {
    ...proposal,
    groups: proposal.groups.map(group => group.slice()),
    leftover: proposal.leftover.slice()
  };
}

/** Recompta els indicadors d'una proposta. */
function rateProposal(proposal) {
  proposal.stats = preferenceStats(proposal.groups, W.prefs, { leftover: proposal.leftover });
  return proposal;
}

function keepIfBest() {
  const current = W.proposal.stats.pct || 0;
  if (!W.best || current > (W.best.stats.pct || 0)) W.best = cloneProposal(W.proposal);
}

function restoreBest() {
  if (!W.best) return;
  W.proposal = rateProposal(cloneProposal(W.best));
  W.picked = null;
  refreshResult();
}

function nameOf(id) {
  return W.roster.find(student => student.id === id)?.name || A.studentName(id);
}

/* ── Retocs a mà de la proposta ──────────────────────── */

/** Equips de la proposta, amb el calaix de "sense equip" al final. */
function proposalBuckets() {
  return [...W.proposal.groups, W.proposal.leftover];
}

function bucketOf(studentId) {
  return proposalBuckets().findIndex(list => list.includes(studentId));
}

/** Després de cada canvi: recompte, millor versió i repintat. */
function afterEdit() {
  W.proposal.edited = true;
  rateProposal(W.proposal);
  keepIfBest();
  W.picked = null;
  refreshResult();
}

function moveMember(studentId, teamIndex) {
  const buckets = proposalBuckets();
  const from = bucketOf(studentId);
  const to = teamIndex < 0 ? buckets.length - 1 : teamIndex;
  if (from === -1 || to < 0 || to >= buckets.length || from === to) {
    W.picked = null;
    refreshResult();
    return;
  }
  buckets[from].splice(buckets[from].indexOf(studentId), 1);
  buckets[to].push(studentId);
  afterEdit();
}

function swapMembers(first, second) {
  const buckets = proposalBuckets();
  const a = bucketOf(first);
  const b = bucketOf(second);
  if (a === -1 || b === -1) return;
  if (a === b) { W.picked = null; refreshResult(); return; }
  buckets[a][buckets[a].indexOf(first)] = second;
  buckets[b][buckets[b].indexOf(second)] = first;
  afterEdit();
}

/** Primer toc: es tria l'alumne. Segon: intercanvi amb un company o trasllat. */
function pickMember(studentId) {
  if (!isResultStep()) return;
  if (!W.picked || W.picked === studentId) {
    W.picked = W.picked === studentId ? null : studentId;
    refreshResult();
    return;
  }
  swapMembers(W.picked, studentId);
}

function dropOnTeam(teamIndex) {
  if (!isResultStep() || !W.picked) return;
  moveMember(W.picked, teamIndex);
}

/* ── Arrossegament dins de l'assistent ───────────────── */

let dragged = null;

function isResultStep() { return !!W && W.step === 5; }

function clearDragMarks() {
  document.querySelectorAll('.pref-dragging,.pref-drop-target')
    .forEach(node => node.classList.remove('pref-dragging', 'pref-drop-target'));
}

/** L'equip on ha caigut el nom, si el gest ve d'un alumne de la proposta. */
function dropCard(event) {
  if (!dragged || !isResultStep()) return null;
  return event.target.closest?.('.pref-group[data-team]') || null;
}

function initProposalDragAndDrop() {
  document.addEventListener('dragstart', event => {
    const member = event.target.closest?.('.pref-member[data-sid]');
    if (!member || !isResultStep()) return;
    dragged = member.dataset.sid;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragged);
    }
    member.classList.add('pref-dragging');
  });

  document.addEventListener('dragend', () => { dragged = null; clearDragMarks(); });

  document.addEventListener('dragover', event => {
    const card = dropCard(event);
    if (!card) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (card.classList.contains('pref-drop-target')) return;
    clearDragMarks();
    card.classList.add('pref-drop-target');
  });

  document.addEventListener('drop', event => {
    const card = dropCard(event);
    if (!card) return;
    event.preventDefault();
    const moving = dragged;
    dragged = null;
    clearDragMarks();
    const member = event.target.closest?.('.pref-member[data-sid]');
    // Sobre un company s'intercanvien; sobre la resta de l'equip, s'hi trasllada.
    if (member && member.dataset.sid !== moving) swapMembers(moving, member.dataset.sid);
    else moveMember(moving, parseInt(card.dataset.team, 10));
  });
}

initProposalDragAndDrop();

/* ── Pas 5 — proposta ────────────────────────────────── */

function memberRowHtml(id, stats) {
  const entry = stats.perStudent[id];
  const tone = matchTone(entry.met, entry.total);
  const detail = [
    entry.metIds.length ? `Amb: ${entry.metIds.map(nameOf).join(', ')}` : '',
    entry.missIds.length ? `Sense: ${entry.missIds.map(nameOf).join(', ')}` : ''
  ].filter(Boolean).join(' · ') || 'Sense preferències indicades';
  return `<div class="pref-member${W.picked === id ? ' pref-picked' : ''}" draggable="true"
      data-action="prefPick" data-sid="${esc(id)}" title="${esc(detail)}">
      <span class="pref-member-name">${esc(nameOf(id))}</span>
      <span class="pref-chip pref-${tone}">${entry.total ? `${entry.met}/${entry.total}` : '—'}</span>
    </div>`;
}

function resultSummaryHtml() {
  const { stats, attempt, edited } = W.proposal;
  const best = W.best ? (W.best.stats.pct || 0) : 0;
  const current = stats.pct || 0;
  const meta = [
    `${stats.met} de ${stats.total} tries`,
    mutualLabel(stats.mutual),
    stats.unhappy ? `${pluralize(stats.unhappy, 'alumne')} sense cap tria acomplerta` : 'tothom té algú de la seva llista',
    `proposta ${attempt}${W.attempts > 1 ? ` de ${W.attempts}` : ''}${edited ? ', retocada a mà' : ''}`
  ];
  return `<div class="pref-summary pref-summary-big">
      <div class="pref-summary-head">
        <span>Preferències acomplertes</span>
        <b class="pref-${current >= 75 ? 'good' : current >= 40 ? 'medium' : 'bad'}">${stats.pct === null ? '—' : current + '%'}</b>
      </div>
      ${matchBar(stats.pct)}
      <div class="pref-summary-meta">${meta.join(' · ')}</div>
    </div>
    ${current < best
      ? `<div class="pref-note pref-note-warn"><span class="mi mi-xs">history</span>
          <div>La millor proposta arriba al <b>${best}%</b>.
          <button class="btn btn-sm" data-action="prefRestoreBest" style="margin-left:6px">Recuperar-la</button></div></div>`
      : ''}`;
}

function resultGroupsHtml() {
  const { groups, leftover, stats } = W.proposal;
  const cards = groups.map((group, index) => {
    const entry = stats.perGroup[index];
    const tone = entry.pct === null ? 'none' : entry.pct >= 75 ? 'good' : entry.pct >= 40 ? 'medium' : 'bad';
    return `<div class="pref-group" data-team="${index}" data-action="prefDropOn">
      <div class="pref-group-head">
        <b>Equip ${index + 1}</b>
        <span class="pref-chip pref-${tone}">${entry.pct === null ? '—' : entry.pct + '%'}</span>
      </div>
      <div class="pref-group-meta">${pluralize(group.length, 'alumne')}${entry.mutual ? ` · ${mutualLabel(entry.mutual)}` : ''}</div>
      ${group.map(id => memberRowHtml(id, stats)).join('')}
    </div>`;
  }).join('');

  return cards + `<div class="pref-group pref-group-out" data-team="-1" data-action="prefDropOn">
      <div class="pref-group-head"><b>Sense equip</b></div>
      <div class="pref-group-meta">${leftover.length
        ? pluralize(leftover.length, 'alumne')
        : 'Deixa-hi qui no hagi d\'anar a cap equip'}</div>
      ${leftover.map(id => memberRowHtml(id, stats)).join('')}
    </div>`;
}

/** Repinta només els indicadors i les targetes: no es perd el desplaçament. */
function refreshResult() {
  const summary = el('prefSummary');
  const groups = el('prefGroups');
  if (!summary || !groups) { renderWizard(); return; }
  summary.innerHTML = resultSummaryHtml();
  groups.innerHTML = resultGroupsHtml();
}

function stepResult() {
  return wizardShell(`
    <div id="prefSummary">${resultSummaryHtml()}</div>
    <div class="pref-hint"><span class="mi mi-xs">swap_horiz</span>
      <div>Arrossega un nom a un altre equip per moure'l, o a sobre d'un company per
        intercanviar-los. En pantalla tàctil, toca el nom i després el destí.
        Els percentatges es refan a cada canvi.</div></div>
    <div class="pref-groups" id="prefGroups">${resultGroupsHtml()}</div>`,
    `<button class="btn" data-action="prefBack" data-step="4"><span class="mi mi-xs">tune</span> Canviar equips</button>
     <button class="btn" data-action="prefGenerateAgain"><span class="mi mi-xs">casino</span> Una altra proposta</button>
     <button class="btn btn-primary" data-action="prefApply"><span class="mi mi-xs">check</span> Carregar als equips</button>`);
}

/* ── Aplicació a l'aplicació ─────────────────────────── */

/** Treu un alumne de relacions, seients i equips (com fa el botó d'eliminar). */
function detachStudent(data, studentId) {
  A.removeStudentFromRelations(data, studentId);
  Object.keys(data.assignments).forEach(deskId => {
    if (data.assignments[deskId] === studentId) {
      delete data.assignments[deskId];
      delete data.lockedDesks[deskId];
    }
  });
  A.removeStudentFromTeams(data.teams, studentId);
}

/** Desa la llista d'alumnes triada i retorna la configuració on van els equips. */
function commitRoster() {
  if (W.fromStored) return A.getData();

  if (W.rosterMode === 'newConfig') {
    const entry = A.currentDocentEntry();
    const source = A.getData();
    const fresh = A.defaultConfigData();
    fresh.centreName = source.centreName;
    fresh.curs = source.curs;
    fresh.nivell = source.nivell;
    fresh.aula = source.aula;
    fresh.students = W.roster.map((student, index) => ({
      id: student.id, name: student.name, color: COLORS[index % COLORS.length]
    }));
    entry.configurations.push({ name: W.newConfigName || defaultConfigName(), data: fresh });
    entry.currentConfig = entry.configurations.length - 1;
    return fresh;
  }

  const data = A.getData();
  if (W.rosterMode === 'replace') {
    const keep = new Set(W.roster.map(student => student.id));
    data.students.filter(student => !keep.has(student.id)).forEach(student => detachStudent(data, student.id));
    data.students = data.students.filter(student => keep.has(student.id));
  }
  W.roster.filter(student => student.isNew).forEach(student => {
    data.students.push({ id: student.id, name: student.name, color: COLORS[data.students.length % COLORS.length] });
  });
  if (W.rosterMode === 'replace') {
    const order = new Map(W.roster.map((student, index) => [student.id, index]));
    data.students.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  return data;
}

/** Mida d'equip més freqüent: manté coherent la configuració del panell. */
function commonSize(sizes) {
  const counts = new Map();
  sizes.forEach(size => counts.set(size, (counts.get(size) || 0) + 1));
  let best = sizes[0] || 1;
  let bestCount = 0;
  counts.forEach((count, size) => {
    if (count > bestCount || (count === bestCount && size > best)) { best = size; bestCount = count; }
  });
  return best;
}

function applyProposal() {
  if (!W?.proposal) return;
  // Si hi ha uns equips desats amb canvis, primer es pregunta (com en formar-los).
  if (W.rosterMode !== 'newConfig' && A.guardUnsavedTeams) {
    A.guardUnsavedTeams(() => writeProposal());
    return;
  }
  writeProposal();
}

function writeProposal() {
  if (!W?.proposal) return;
  const proposal = W.proposal;
  A.saveWithUndo();

  const data = commitRoster();
  const teams = data.teams;
  const valid = new Set(data.students.map(student => student.id));
  const groups = proposal.groups.map(group => group.filter(id => valid.has(id))).filter(group => group.length);

  teams.preferences = {
    updated: formattedNow(),
    source: W.source || '',
    ranked: W.ranked !== false,
    prefs: JSON.parse(JSON.stringify(W.prefs)),
    unresolved: W.unresolved.map(item => item.name),
    // En tornar a proposar amb les mateixes respostes, la millor versio es conserva.
    best: W.fromStored ? (teams.preferences?.best || null) : null
  };
  teams.groups = groups;
  teams.teamNames = {};
  teams.positions = {};
  teams.layout = null;
  teams.lockedTeams = {};
  teams.lockedStudents = {};
  teams.activeSaved = null;

  const sizes = groups.map(group => group.length);
  const size = commonSize(sizes);
  teams.studentsPerGroup = Math.max(1, size);
  const total = data.students.length;
  teams.remainderMode = total % Math.max(1, size) === 0 ? null
    : (sizes.filter(value => value !== size).length === 1 && sizes[sizes.length - 1] < size ? 'newGroup' : 'distribute');

  A.arrangeTeamDesks();
  A.saveState();
  closeModal();

  if (A.view.current !== 'equips') A.switchCanvasView('equips');
  A.renderAll();
  setTimeout(() => A.zoomReset(), 60);

  const pct = proposal.stats.pct === null ? '' : ` · ${proposal.stats.pct}% de preferències`;
  toast(`${pluralize(groups.length, 'equip')} ${groups.length === 1 ? 'format' : 'formats'}${pct}`, 'success');
  W = null;
}

/* ── Accions ─────────────────────────────────────────── */

A.registerActions({
  startPreferenceWizard: () => startWizard(),
  prefRegenerate: () => startWizard({ fromStored: true }),
  prefForget: () => forgetPreferences(),
  prefRestoreFormation: () => restoreFormation(),
  prefFileChosen: node => fileChosen(node),
  prefTemplate: () => downloadTemplate(),
  prefReadSource: () => readPastedSource(),
  prefBack: node => {
    const step = parseInt(node.dataset.step, 10);
    if (!step) { closeModal(); W = null; return; }
    W.step = step;
    renderWizard();
  },
  prefToggleHeader: node => toggleHeader(node.checked),
  prefSetColumn: node => setColumn(node.dataset.role, parseInt(node.dataset.idx, 10), node.value),
  prefAddColumn: () => { W.mapping.prefs.push(-1); renderWizard(); },
  prefColumnsNext: () => columnsNext(),
  prefSetRosterMode: node => setRosterMode(node.value),
  prefSetConfigName: node => { W.newConfigName = node.value.trim(); },
  prefStudentsNext: () => studentsNext(),
  prefSetPlanMode: node => setPlanMode(node.dataset.value),
  prefSetPlanValue: node => setPlanValue(node.value),
  prefSetRemainder: node => { W.plan.remainder = node.dataset.value; renderWizard(); },
  prefToggleRanked: node => { W.ranked = node.checked; },
  prefToggleConstraints: node => { W.useConstraints = node.checked; renderWizard(); },
  prefGenerate: () => generateProposal(),
  prefGenerateAgain: () => generateProposal(),
  prefRestoreBest: () => restoreBest(),
  prefPick: node => pickMember(node.dataset.sid),
  prefDropOn: node => dropOnTeam(parseInt(node.dataset.team, 10)),
  prefApply: () => applyProposal()
});

Object.assign(A, {
  normalizeNameText, nameKey, buildNameIndex, resolveName,
  looksLikeHeader, autoMapping, columnLabels, emptyColumns, readEntries, matchRoster,
  buildRoster, buildPreferences, planPreferenceSizes, describeSizes,
  preferenceWeights, optimizePreferenceGroups, preferenceStats, matchTone,
  preferenceTeamView, renderPreferencePanel, restoreFormation, startPreferenceWizard: startWizard
});

})(window.AulaMap);
