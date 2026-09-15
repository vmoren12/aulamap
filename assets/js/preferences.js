/**
 * AulaMap — Equips per preferències de l'alumnat (sociograma)
 *
 * El docent passa un formulari on cada alumne escriu el seu nom i les persones
 * amb qui voldria treballar i, si el formulari ho demana, amb qui preferiria no
 * coincidir. Aquest mòdul llegeix el full de respostes (CSV, TSV o Excel), el
 * concilia amb la llista d'alumnes de la configuració activa i proposa un
 * repartiment que maximitza les preferències acomplertes i, alhora, respecta
 * tantes peticions de separació com pot.
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
const MAX_AVOID_COLUMNS = 6;     // columnes de separació que es poden mapar
const RANK_WEIGHTS = [3, 2, 1];  // pes de la 1a, 2a i 3a tria
const TAIL_WEIGHT = 1;           // pes de la 4a tria en endavant
const MUTUAL_BONUS = 2;          // premi quan la tria és recíproca
// Una petició de separació ha de poder amb qualsevol pila de preferències, però
// no amb els conjunts que el docent hagi escrit a mà al panell de relacions.
const AVOID_WEIGHT = 60;
const PROPOSAL_CLASH_COST = 5;   // punts que resta cada separació trencada
const CONSTRAINT_WEIGHT = 500;   // ajuntar/separar pesen més que cap preferència
// Equilibri de la composició: cada parella d'un mateix grup d'origen, sexe o
// necessitat educativa dins d'un equip resta punts, de manera que el
// repartiment tendeix a escampar-los. Pesa una mica més que una tria de primera
// opció i menys que una parella recíproca: els equips queden repartits sense
// haver de renunciar a les preferències més fortes.
const BALANCE_WEIGHT = 4;
const BALANCE_QUALITY = 0.25;    // pes de l'equilibri en comparar dues formacions
// Nivell mitjà: cada punt que un equip s'allunya de la mitjana de la classe
// resta prou com per pesar més que una tria de tercera opció.
const LEVEL_WEIGHT = 3;
// Criteri "una tria per alumne": la primera preferència acomplerta suma, la
// segona en descompta una part i la tercera ja fa nosa. Quedar-se sense cap
// tria, en canvi, no és una alternativa acceptable: costa més que qualsevol
// desequilibri i només una petició de separació hi pesa més.
const SPREAD_FIRST = 12;
const SPREAD_EXTRA = 8;
const SPREAD_TOP = 2;            // premi si la tria acomplerta és la primera de la llista
const SPREAD_NONE = 40;          // penalització de l'alumne que es queda sense cap tria
const PROPOSAL_NONE_COST = 4;    // punts que resta cada alumne sense cap tria acomplerta
// Amb aquest criteri, una separació ha de continuar pesant més que els dos
// zeros com a màxim que ajuntar la parella podria estalviar: si no, la manera
// més barata de donar-los una tria seria posar-los junts, que és justament el
// que havien demanat d'evitar.
const AVOID_SPREAD_WEIGHT = 2 * (SPREAD_NONE + SPREAD_FIRST + SPREAD_TOP) + 12;
const SHEETJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

/** Capçaleres que solen identificar cada mena de columna. */
const NAME_HINT = /(nom|alumn|estudiant|name|cognom)/i;
const PREF_HINT = /(prefer|opci|tria|elecc|company|amic|amiga|choice|escull|treballar)/i;
// "Separar 2", "Amb qui NO vols treballar?", "Millor evitar-ho"... Es comprova
// abans que PREF_HINT, perquè aquestes capçaleres també en duen les paraules.
const AVOID_HINT = /(separa|evitar|allunya|apartar|incompatib|conflict|avoid|\bno\b)/i;
const SKIP_HINT = /(marca.*temps|timestamp|correu|e-?mail|adre|hora|data|^id$|curs|grup|classe|nivell|puntuaci)/i;

/**
 * Dades de l'alumnat que no són noms i que, si el full les porta, es reparteixen
 * de manera equilibrada entre els equips: el grup d'origen (sovint lletres o
 * paraules d'un conjunt curt: "aire", "terra", "aigua"...), el sexe i les
 * necessitats educatives.
 *
 * `flag` marca els atributs on només compta qui hi té alguna cosa escrita: a la
 * columna de necessitats educatives s'escampen els alumnes marcats amb una "S",
 * i les caselles buides no formen cap grup.
 */
const ATTRIBUTES = [
  { key: 'group', label: "Grup d'origen", short: 'Grup', flag: false,
    hint: /(grup|group|equip|casa|colla|origen|proced|tribu|element|color)/i },
  { key: 'sex', label: 'Sexe', short: 'Sexe', flag: false,
    hint: /(sexe|sex|g[eè]nere|gender|noi|noia|nen|nena)/i },
  { key: 'nee', label: 'Necessitats educatives', short: 'NEE', flag: true,
    hint: /(\bnee\b|\bnese\b|necessit|educativ|aprenentatg|suport|\bdua\b|diversitat|adaptaci)/i }
];

const ATTRIBUTE_KEYS = ATTRIBUTES.map(attribute => attribute.key);

/**
 * Columna de competència: un valor numèric per alumne (una nota, un nivell
 * d'assoliment...). No s'escampa com els altres, sinó que serveix per igualar
 * el nivell mitjà dels equips, que és el que fa els grups heterogenis.
 */
const LEVEL = {
  key: 'level', label: 'Competència', short: 'Nivell',
  hint: /(compet|nivell|nota|qualific|puntuaci|rendiment|assoliment|grau)/i
};

/** Escala del panell d'equips: els valors del full s'hi converteixen. */
const LEVEL_SCALE = 10;

/** Definició d'un atribut a partir de la seva clau. */
function attributeByKey(key) { return ATTRIBUTES.find(attribute => attribute.key === key) || null; }

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

/* ── Altres dades de l'alumnat ───────────────────────── */

/** Valor comparable: "Aire", "aire " i "AIRE" són el mateix grup. */
function attributeKey(value) { return normalizeNameText(value); }

/** Caselles que volen dir "no": una columna de NEE sol venir mig buida. */
const NEGATIVE_MARK = /^(no|n|0|cap|fals|false)$/;

/** La casella marca l'alumne? ("S", "sí", "x"... sí; buida o "no", no). */
function isMarked(value) {
  const key = attributeKey(value);
  return !!key && !NEGATIVE_MARK.test(key);
}

/**
 * Els valors d'una columna semblen una dada d'aquestes: textos curts que es
 * repeteixen. Una columna de noms mai no ho compleix.
 */
function looksLikeAttribute(values) {
  const filled = values.filter(Boolean);
  if (!filled.length) return false;
  if (filled.some(value => value.length > 24)) return false;
  // Els noms de persona porten gairebé sempre cognom; "Aire" o "S", no.
  if (filled.every(value => nameTokens(value).length > 1)) return false;
  const distinct = new Set(filled.map(attributeKey)).size;
  if (distinct > 12) return false;
  // En un full sencer els valors s'han de repetir; amb poques files no hi ha
  // prou mostra i mana la capçalera.
  return filled.length < 8 || distinct <= Math.ceil(filled.length / 2);
}

/**
 * Valors de cada atribut per alumne, a partir de les respostes ja conciliades
 * amb la classe. Els atributs que no aporten res (columna buida, un sol valor
 * en un atribut de marca) no es desen.
 * @returns {Object<string,Object<string,string>>} { group:{ studentId:'Aire' }, ... }
 */
function buildAttributes(entries, roster) {
  const ids = new Set(roster.map(student => student.id));
  const attributes = {};
  entries.forEach(entry => {
    if (!entry.studentId || !ids.has(entry.studentId)) return;
    ATTRIBUTES.forEach(attribute => {
      const raw = String(entry.attrs?.[attribute.key] || '').trim();
      if (!raw || (attribute.flag && !isMarked(raw))) return;
      if (!attributes[attribute.key]) attributes[attribute.key] = {};
      attributes[attribute.key][entry.studentId] = raw;
    });
  });
  return attributes;
}

/**
 * Recompte dels valors d'un atribut: quants alumnes en té cadascun.
 * @returns {Array<{key:string, label:string, total:number}>}
 */
function attributeValues(attribute, map) {
  const counts = new Map();
  Object.values(map || {}).forEach(raw => {
    const key = attribute.flag ? 'marcat' : attributeKey(raw);
    if (!key) return;
    const found = counts.get(key);
    if (found) found.total++;
    else counts.set(key, { key, label: attribute.flag ? attribute.short : String(raw).trim(), total: 1 });
  });
  return [...counts.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/* ── Competència ─────────────────────────────────────── */

/** Número d'una cel·la, admetent la coma decimal. `null` si no n'hi ha cap. */
function numberOf(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!text || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  const number = parseFloat(text);
  return Number.isFinite(number) ? number : null;
}

/**
 * Valors de competència llegits del full i el seu interval. L'interval és el
 * que es proposa al docent, que el pot canviar si el full no arriba als
 * extrems de l'escala amb què s'ha avaluat.
 * @returns {{values:Object<string,number>, min:number|null, max:number|null}}
 */
function buildLevels(entries, roster) {
  const ids = new Set(roster.map(student => student.id));
  const values = {};
  let min = null;
  let max = null;
  entries.forEach(entry => {
    if (!entry.studentId || !ids.has(entry.studentId)) return;
    const number = numberOf(entry.level);
    if (number === null) return;
    values[entry.studentId] = number;
    min = min === null ? number : Math.min(min, number);
    max = max === null ? number : Math.max(max, number);
  });
  return { values, min, max };
}

/**
 * Competències convertides a l'escala 0–10 del panell d'equips, amb els
 * extrems que hagi triat el docent. Si tots els valors són iguals, tothom es
 * queda al mig de l'escala.
 * @returns {Object<string,number>}
 */
function scaleLevels(values, range) {
  const min = Number.isFinite(range?.min) ? range.min : null;
  const max = Number.isFinite(range?.max) ? range.max : null;
  const span = min === null || max === null ? 0 : max - min;
  const scaled = {};
  Object.entries(values || {}).forEach(([studentId, value]) => {
    const level = span > 0
      ? ((Math.max(min, Math.min(max, value)) - min) / span) * LEVEL_SCALE
      : LEVEL_SCALE / 2;
    // El panell edita els nivells de mig en mig punt: s'hi arrodoneix.
    scaled[studentId] = Math.round(level * 2) / 2;
  });
  return scaled;
}

/** Atributs carregats que tenen alguna cosa a dir, en l'ordre de sempre. */
function activeAttributes(attributes) {
  return ATTRIBUTES
    .map(attribute => ({ attribute, values: attributeValues(attribute, attributes?.[attribute.key]) }))
    .filter(item => item.values.length && (item.attribute.flag || item.values.length > 1));
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

/** Els valors d'una columna són números? (la competència ho ha de ser) */
function looksLikeNumbers(values) {
  const filled = values.filter(Boolean);
  if (!filled.length) return false;
  return filled.every(value => numberOf(value) !== null);
}

/** La primera fila és una capçalera? */
function looksLikeHeader(rows) {
  if (rows.length < 2) return false;
  return (rows[0] || []).some(cell => {
    const text = String(cell || '');
    return NAME_HINT.test(text) || PREF_HINT.test(text) || AVOID_HINT.test(text) || SKIP_HINT.test(text);
  });
}

/**
 * Proposta de correspondència entre columnes i camps.
 *
 * Les columnes de separació només es poden endevinar per la capçalera: sense
 * capçalera no hi ha manera de distingir-les de les de preferència, i el docent
 * les assigna a mà al pas de les columnes.
 */
function autoMapping(rows, hasHeader) {
  const labels = columnLabels(rows, hasHeader);
  const empty = emptyColumns(rows, hasHeader);
  const usable = labels.map((_, index) => index).filter(index => !empty.has(index));
  const isSkipped = index => hasHeader && SKIP_HINT.test(labels[index]);
  const isAvoid = index => hasHeader && AVOID_HINT.test(labels[index]);

  let name = -1;
  if (hasHeader) {
    name = usable.find(index => NAME_HINT.test(labels[index]) && !PREF_HINT.test(labels[index]) &&
      !isAvoid(index) && !isSkipped(index)) ?? -1;
  }
  if (name === -1) {
    name = usable.find(index => !isSkipped(index) && !isAvoid(index) &&
      looksLikeNames(columnValues(rows, hasHeader, index))) ?? -1;
  }
  if (name === -1) name = usable[0] ?? -1;

  // El grup d'origen, el sexe i les necessitats educatives només es poden
  // endevinar per la capçalera, i encara cal que els valors siguin curts i
  // repetits: així una columna de noms no es pren mai per una d'aquestes.
  const attrs = {};
  const taken = new Set();
  ATTRIBUTES.forEach(attribute => { attrs[attribute.key] = -1; });
  let level = -1;
  if (hasHeader) {
    ATTRIBUTES.forEach(attribute => {
      const found = usable.find(index => index !== name && !taken.has(index) &&
        attribute.hint.test(labels[index]) && !PREF_HINT.test(labels[index]) &&
        !AVOID_HINT.test(labels[index]) &&
        looksLikeAttribute(columnValues(rows, hasHeader, index)));
      if (found === undefined) return;
      attrs[attribute.key] = found;
      taken.add(found);
    });
    // La competència, a diferència de les altres, ha de ser numèrica.
    level = usable.find(index => index !== name && !taken.has(index) &&
      LEVEL.hint.test(labels[index]) && !PREF_HINT.test(labels[index]) &&
      !AVOID_HINT.test(labels[index]) &&
      looksLikeNumbers(columnValues(rows, hasHeader, index))) ?? -1;
    if (level >= 0) taken.add(level);
  }

  const avoid = usable
    .filter(index => index !== name && !taken.has(index) && isAvoid(index) && !isSkipped(index))
    .slice(0, MAX_AVOID_COLUMNS);
  const free = index => index !== name && !taken.has(index) && !avoid.includes(index);

  let prefs = hasHeader
    ? usable.filter(index => free(index) && PREF_HINT.test(labels[index]))
    : [];
  if (!prefs.length) {
    prefs = usable.filter(index => free(index) && !isSkipped(index) &&
      looksLikeNames(columnValues(rows, hasHeader, index)));
  }
  prefs = prefs.slice(0, MAX_PREF_COLUMNS);
  while (prefs.length < 3) prefs.push(-1);
  return { name, prefs, avoid, attrs, level };
}

/**
 * Files del full convertides a respostes.
 * Si algú respon dues vegades, es queda la resposta més nova.
 * @returns {{entries:Array<{name:string,choices:string[],avoid:string[],attrs:Object}>,
 *            duplicates:number, nameless:number}}
 */
function readEntries(rows, hasHeader, mapping) {
  const seen = new Map();
  const entries = [];
  let duplicates = 0;
  let nameless = 0;
  // Les columnes de separació es llegeixen igual que les de preferència: un nom
  // per cel·la. `mapping.avoid` pot no existir en fulls sense separacions.
  const cells = (row, columns) => (columns || []).filter(index => index >= 0)
    .map(index => String(row[index] || '').trim())
    .filter(Boolean);
  // Grup d'origen, sexe i necessitats educatives: una sola cel·la per columna.
  const attrsOf = row => {
    const values = {};
    ATTRIBUTES.forEach(attribute => {
      const index = mapping.attrs?.[attribute.key];
      if (index === undefined || index < 0) return;
      const value = String(row[index] || '').trim();
      if (value) values[attribute.key] = value;
    });
    return values;
  };
  dataRowsOf(rows, hasHeader).forEach(row => {
    const name = String(row[mapping.name] || '').trim();
    const choices = cells(row, mapping.prefs);
    const avoid = cells(row, mapping.avoid);
    const attrs = attrsOf(row);
    const level = mapping.level >= 0 ? String(row[mapping.level] || '').trim() : '';
    if (!name) {
      if (choices.length || avoid.length) nameless++;
      return;
    }
    const key = nameKey(name);
    const previous = seen.get(key);
    if (previous) {
      duplicates++;
      previous.name = name;
      if (choices.length) previous.choices = choices;
      if (avoid.length) previous.avoid = avoid;
      if (Object.keys(attrs).length) previous.attrs = { ...previous.attrs, ...attrs };
      if (level) previous.level = level;
      return;
    }
    const entry = { name, choices, avoid, attrs, level, studentId: null };
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
 * Tries i peticions de separació convertides a identificadors d'alumne.
 *
 * Si algú surt a les dues llistes (passa quan el formulari té una pregunta mal
 * entesa), mana la separació: val més deixar de complir un desig que ajuntar
 * dues persones que han demanat de no estar juntes.
 *
 * @returns {{prefs:Object<string,string[]>, avoid:Object<string,string[]>,
 *            unresolved:Array<{name:string,count:number,ambiguous:boolean}>}}
 */
function buildPreferences(entries, roster) {
  const index = buildNameIndex(roster);
  const ids = new Set(roster.map(student => student.id));
  const prefs = {};
  const avoid = {};
  const unresolved = new Map();

  const resolveList = (names, selfId) => {
    const list = [];
    (names || []).forEach(name => {
      const { student, ambiguous } = resolveName(name, index);
      if (student && ids.has(student.id)) {
        if (student.id !== selfId && !list.includes(student.id)) list.push(student.id);
        return;
      }
      const key = nameKey(name);
      const found = unresolved.get(key);
      if (found) found.count++;
      else unresolved.set(key, { name, count: 1, ambiguous });
    });
    return list;
  };

  entries.forEach(entry => {
    if (!entry.studentId || !ids.has(entry.studentId)) return;
    const wanted = resolveList(entry.choices, entry.studentId);
    const rejected = resolveList(entry.avoid, entry.studentId);
    const list = rejected.length ? wanted.filter(id => !rejected.includes(id)) : wanted;
    if (list.length) prefs[entry.studentId] = list;
    if (rejected.length) avoid[entry.studentId] = rejected;
  });
  return { prefs, avoid, unresolved: [...unresolved.values()].sort((a, b) => b.count - a.count) };
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
  const avoid = options.avoid || {};
  const index = new Map(ids.map((id, position) => [id, position]));
  const weights = ids.map(() => new Array(ids.length).fill(0));

  const add = (a, b, value) => {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined || i === j) return;
    weights[i][j] += value;
    weights[j][i] += value;
  };

  // Amb el criteri "una tria per alumne" les tries no poden pesar per parelles:
  // el que val no és quantes n'hi ha juntes, sinó que n'hi hagi just una. En
  // aquest cas les tries les compta `spreadScore` i aquí només queden les
  // separacions i els conjunts del docent.
  if (options.includePrefs !== false) {
    Object.entries(prefs || {}).forEach(([studentId, list]) => {
      (list || []).forEach((targetId, rank) => {
        add(studentId, targetId, ranked ? (RANK_WEIGHTS[rank] ?? TAIL_WEIGHT) : 1);
        if ((prefs[targetId] || []).includes(studentId)) add(studentId, targetId, MUTUAL_BONUS / 2);
      });
    });
  }

  // Totes les separacions pesen igual: qui és el primer de la llista i qui el
  // segon no fa cap diferència quan es demana no coincidir.
  const avoidWeight = options.avoidWeight || AVOID_WEIGHT;
  Object.entries(avoid).forEach(([studentId, list]) => {
    (list || []).forEach(targetId => add(studentId, targetId, -avoidWeight));
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

/* ── Model de puntuació ──────────────────────────────── */

/**
 * Valors d'un atribut convertits a codis numèrics, en el mateix ordre que
 * `ids`. Els alumnes sense valor reben -1 i no compten per a l'equilibri.
 * @returns {Array<{key:string, codes:number[]}>}
 */
function balanceCodes(ids, attributes, enabled) {
  if (!attributes) return [];
  return ATTRIBUTES
    .filter(attribute => attributes[attribute.key] && (!enabled || enabled[attribute.key] !== false))
    .map(attribute => {
      const map = attributes[attribute.key];
      const seen = new Map();
      const codes = ids.map(id => {
        const raw = map[id];
        if (!raw || (attribute.flag && !isMarked(raw))) return -1;
        const value = attribute.flag ? 'marcat' : attributeKey(raw);
        if (!value) return -1;
        if (!seen.has(value)) seen.set(value, seen.size);
        return seen.get(value);
      });
      return { key: attribute.key, codes, values: seen.size };
    })
    // Un sol valor per a tothom no equilibra res; una marca sí que s'escampa.
    .filter(item => item.values > 1 || (attributeByKey(item.key)?.flag && item.codes.some(code => code >= 0)));
}

/**
 * Tot el que necessita el repartidor per puntuar un equip: la matriu de
 * parelles, els codis d'equilibri i el criteri d'èxit triat.
 */
function preferenceModel(ids, options = {}) {
  const criterion = options.criterion === 'spread' ? 'spread' : 'max';
  const ranked = options.ranked !== false;
  const model = preferenceWeights(ids, options.prefs || {}, {
    ranked,
    avoid: options.avoid,
    avoidWeight: criterion === 'spread' ? AVOID_SPREAD_WEIGHT : AVOID_WEIGHT,
    constraints: options.constraints,
    includePrefs: criterion !== 'spread'
  });
  model.criterion = criterion;
  model.ranked = ranked;
  model.prefs = options.prefs || {};
  model.balance = balanceCodes(ids, options.attributes, options.balance);
  model.levels = levelModel(ids, options.levels);
  return model;
}

/**
 * Nivells de competència dels alumnes que es reparteixen i la mitjana de tots
 * plegats. Sense valors, o amb tots iguals, no hi ha res a igualar.
 * @returns {{value:number[], mean:number}|null}
 */
function levelModel(ids, levels) {
  if (!levels) return null;
  const value = ids.map(id => (Number.isFinite(levels[id]) ? levels[id] : null));
  const known = value.filter(level => level !== null);
  if (known.length < 2) return null;
  const mean = known.reduce((sum, level) => sum + level, 0) / known.length;
  if (known.every(level => level === known[0])) return null;
  // Qui no té nivell compta com la mitjana: no desequilibra cap equip.
  return { value: value.map(level => (level === null ? mean : level)), mean };
}

/**
 * Parelles que comparteixen grup d'origen, sexe o marca de necessitats dins
 * d'un mateix equip. Minimitzar-les és exactament repartir cada valor entre
 * tots els equips tan igualadament com les mides permetin.
 */
function balancePenalty(group, model) {
  if (!model.balance.length) return 0;
  let penalty = 0;
  for (const attribute of model.balance) {
    const seen = new Map();
    for (const studentId of group) {
      const code = attribute.codes[model.index.get(studentId)];
      if (code < 0) continue;
      const count = seen.get(code) || 0;
      penalty += count * BALANCE_WEIGHT;
      seen.set(code, count + 1);
    }
  }
  return penalty;
}

/**
 * Criteri "una tria per alumne": la primera preferència acomplerta suma, la
 * segona en descompta bona part i la tercera ja resta. Així el repartiment
 * escampa les tries en comptes de deixar que uns quants se les quedin totes.
 *
 * Qui ha respost i es queda sense ningú de la seva llista és el pitjor cas de
 * tots: costa més que coincidir amb totes les tries alhora i més que qualsevol
 * desequilibri de composició, de manera que el repartiment només hi arriba quan
 * no hi ha cap altra sortida.
 */
function spreadScore(group, model) {
  const inside = new Set(group);
  let score = 0;
  for (const studentId of group) {
    const list = model.prefs[studentId];
    if (!list || !list.length) continue;
    let met = 0;
    let top = false;
    for (let rank = 0; rank < list.length; rank++) {
      if (!inside.has(list[rank])) continue;
      met++;
      if (rank === 0) top = true;
    }
    if (!met) { score -= SPREAD_NONE; continue; }
    const extra = SPREAD_FIRST - (met - 1) * SPREAD_EXTRA + (model.ranked && top ? SPREAD_TOP : 0);
    // Coincidir amb massa tries és un mal menor: mai no pot sortir més car que
    // deixar l'alumne sense cap.
    score += Math.max(extra, -SPREAD_NONE + 1);
  }
  return score;
}

/**
 * Distància del nivell mitjà de l'equip al de la classe. Igualar les mitjanes
 * és el que fa que dins de cada equip hi hagi de tot: grups heterogenis.
 */
function levelPenalty(group, model) {
  if (!model.levels || !group.length) return 0;
  let sum = 0;
  for (const studentId of group) sum += model.levels.value[model.index.get(studentId)];
  return Math.abs(sum - model.levels.mean * group.length) * LEVEL_WEIGHT;
}

/** Qualitat d'un equip sencer: afinitats, equilibri i criteri d'èxit. */
function groupScore(group, model) {
  let score = 0;
  for (let i = 0; i < group.length; i++) {
    const row = model.weights[model.index.get(group[i])];
    for (let j = i + 1; j < group.length; j++) score += row[model.index.get(group[j])];
  }
  score -= balancePenalty(group, model);
  score -= levelPenalty(group, model);
  if (model.criterion === 'spread') score += spreadScore(group, model);
  return score;
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

/** Suma de la qualitat de tots els equips (el darrer calaix no compta). */
function totalScore(groups, model, realGroups) {
  let total = 0;
  for (let g = 0; g < realGroups; g++) total += groupScore(groups[g], model);
  return total;
}

/**
 * Alumnes que han respost i no tenen ningú de la seva llista a l'equip. Amb el
 * criteri d'una tria per alumne, cap formació que en deixi més que una altra no
 * pot guanyar, per bé que quedi de la resta: el zero sempre és el pitjor cas.
 */
function strandedCount(groups, model, realGroups) {
  let count = 0;
  for (let g = 0; g < realGroups; g++) {
    const inside = new Set(groups[g]);
    for (const studentId of groups[g]) {
      const list = model.prefs[studentId];
      if (list && list.length && !list.some(other => inside.has(other))) count++;
    }
  }
  return count;
}

/**
 * Construcció voraç: a cada pas, la parella alumne–equip que més suma.
 * Els alumnes fixats (`fixed`) ja entren col·locats i no es mouen mai.
 */
function greedyAssign(ids, model, buckets, realGroups, random, fixed) {
  const groups = buckets.map(() => []);
  const scores = buckets.map(() => 0);
  const pending = new Set(shuffled(ids, random));
  Object.entries(fixed || {}).forEach(([studentId, index]) => {
    if (!pending.has(studentId) || !groups[index]) return;
    groups[index].push(studentId);
    pending.delete(studentId);
  });
  groups.forEach((group, g) => { if (g < realGroups && group.length) scores[g] = groupScore(group, model); });
  while (pending.size) {
    let bestStudent = null;
    let bestGroup = -1;
    let bestScore = -Infinity;
    for (const studentId of pending) {
      for (let g = 0; g < groups.length; g++) {
        if (groups[g].length >= buckets[g]) continue;
        let gain = 0;
        if (g < realGroups) {
          groups[g].push(studentId);
          gain = groupScore(groups[g], model) - scores[g];
          groups[g].pop();
        }
        // Es completen els equips començats abans d'obrir-ne un altre.
        const score = gain - (groups[g].length ? 0 : 0.001) + random() * 0.0005;
        if (score > bestScore) { bestScore = score; bestStudent = studentId; bestGroup = g; }
      }
    }
    if (bestStudent === null) break;
    groups[bestGroup].push(bestStudent);
    if (bestGroup < realGroups) scores[bestGroup] = groupScore(groups[bestGroup], model);
    pending.delete(bestStudent);
  }
  return groups;
}

/**
 * Refinament: intercanvis entre equips mentre el resultat millori.
 *
 * Es puntuen els dos equips sencers, no la parella que es mou: l'equilibri de
 * la composició i el criteri d'"una tria per alumne" depenen de qui més hi ha
 * a l'equip, i no es poden repartir entre parelles.
 */
function improveAssignment(groups, model, realGroups, rounds, fixed) {
  const locked = new Set(Object.keys(fixed || {}));
  const scoreOf = g => (g < realGroups ? groupScore(groups[g], model) : 0);
  const scores = groups.map((_, g) => scoreOf(g));
  for (let round = 0; round < rounds; round++) {
    let bestDelta = 1e-9;
    let move = null;
    for (let gi = 0; gi < groups.length; gi++) {
      for (let gj = gi + 1; gj < groups.length; gj++) {
        for (let ai = 0; ai < groups[gi].length; ai++) {
          if (locked.has(groups[gi][ai])) continue;
          for (let bj = 0; bj < groups[gj].length; bj++) {
            const a = groups[gi][ai];
            const b = groups[gj][bj];
            if (locked.has(b)) continue;
            groups[gi][ai] = b;
            groups[gj][bj] = a;
            const delta = scoreOf(gi) + scoreOf(gj) - scores[gi] - scores[gj];
            groups[gi][ai] = a;
            groups[gj][bj] = b;
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
    scores[gi] = scoreOf(gi);
    scores[gj] = scoreOf(gj);
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
 * @param {{ids:string[], prefs:Object, avoid?:Object, sizes:number[], leftover?:number,
 *          ranked?:boolean, constraints?:Object, attributes?:Object, balance?:Object,
 *          levels?:Object, fixed?:Object<string,number>,
 *          criterion?:'max'|'spread', seed?:number, restarts?:number}} options
 * @returns {{groups:string[][], leftover:string[], score:number}}
 */
function optimizePreferenceGroups(options) {
  const ids = (options.ids || []).slice();
  const sizes = (options.sizes || []).slice();
  const leftoverSize = Math.max(0, options.leftover || 0);
  const model = preferenceModel(ids, {
    prefs: options.prefs,
    ranked: options.ranked !== false,
    avoid: options.avoid,
    constraints: options.constraints,
    attributes: options.attributes,
    balance: options.balance,
    levels: options.levels,
    criterion: options.criterion
  });
  if (!ids.length || !sizes.length) return { groups: sizes.map(() => []), leftover: ids, score: 0 };

  // Els alumnes fixats ocupen lloc al seu equip encara que en sobrepassin la mida.
  const known = new Set(ids);
  const fixed = {};
  Object.entries(options.fixed || {}).forEach(([studentId, index]) => {
    if (known.has(studentId) && index >= 0 && index < sizes.length) fixed[studentId] = index;
  });
  const counts = sizes.map(() => 0);
  Object.values(fixed).forEach(index => { counts[index]++; });
  const buckets = sizes.map((size, index) => Math.max(size, counts[index]));
  if (leftoverSize > 0) buckets.push(leftoverSize);
  const realGroups = sizes.length;
  const random = seededRandom(options.seed || 1);
  const restarts = options.restarts || (ids.length > 90 ? 4 : 8);
  const rounds = options.rounds || (ids.length > 90 ? 25 : 60);

  let best = null;
  let bestScore = -Infinity;
  let bestStranded = Infinity;
  // Mentre quedi algú sense cap de les seves tries, val la pena tornar-ho a
  // provar: amb una altra sortida el repartiment sol trobar-li lloc.
  const maxAttempts = model.criterion === 'spread' ? restarts * 3 : restarts;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt >= restarts && bestStranded === 0) break;
    const candidate = greedyAssign(ids, model, buckets, realGroups, random, fixed);
    improveAssignment(candidate, model, realGroups, rounds, fixed);
    const score = totalScore(candidate, model, realGroups);
    const stranded = model.criterion === 'spread' ? strandedCount(candidate, model, realGroups) : 0;
    if (stranded < bestStranded || (stranded === bestStranded && score > bestScore)) {
      bestScore = score;
      bestStranded = stranded;
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
 * Preferències acomplertes i separacions respectades, per alumne, per equip i
 * en conjunt. Només es compten les tries d'alumnes que participen en el
 * repartiment. Qui es queda sense equip no comparteix taula amb ningú: cap
 * preferència seva es dóna per acomplerta, ni cap separació per trencada.
 *
 * També diu quants alumnes en tenen exactament una (el criteri d'"una tria per
 * alumne") i com de repartits queden el grup d'origen, el sexe i les
 * necessitats educatives.
 *
 * @returns {{met:number, total:number, pct:number|null, perStudent:Object,
 *            perGroup:Array, answered:number, unhappy:number, mutual:number,
 *            alone:number, crowded:number, alonePct:number|null,
 *            avoidKept:number, avoidTotal:number, avoidBroken:number,
 *            avoidPct:number|null, clashes:Array<[string,string]>,
 *            balance:Array, criterion:string, mainPct:number|null}}
 */
function preferenceStats(groups, prefs, options = {}) {
  const avoid = options.avoid || {};
  const teamOf = new Map();
  groups.forEach((group, index) => group.forEach(id => teamOf.set(id, index)));
  (options.leftover || []).forEach(id => { if (!teamOf.has(id)) teamOf.set(id, -1); });

  const placed = new Set(teamOf.keys());
  const perStudent = {};
  const perGroup = groups.map(() => ({ met: 0, total: 0, pct: null, mutual: 0, avoidBroken: 0,
                                       answered: 0, alone: 0, crowded: 0, alonePct: null }));
  let met = 0;
  let total = 0;
  let answered = 0;
  let unhappy = 0;
  let mutual = 0;
  let alone = 0;
  let crowded = 0;
  let avoidTotal = 0;
  let avoidBroken = 0;
  const clashes = [];
  const unhappyIds = [];

  placed.forEach(id => {
    const index = teamOf.get(id);
    const list = (prefs[id] || []).filter(other => placed.has(other) && other !== id);
    const metIds = index >= 0 ? list.filter(other => teamOf.get(other) === index) : [];
    const missIds = list.filter(other => !metIds.includes(other));
    const away = (avoid[id] || []).filter(other => placed.has(other) && other !== id);
    const clashIds = index >= 0 ? away.filter(other => teamOf.get(other) === index) : [];
    perStudent[id] = {
      met: metIds.length,
      total: list.length,
      metIds,
      missIds,
      first: list.length ? metIds.includes(list[0]) : false,
      avoidTotal: away.length,
      avoidBroken: clashIds.length,
      avoidIds: clashIds
    };
    met += metIds.length;
    total += list.length;
    avoidTotal += away.length;
    avoidBroken += clashIds.length;
    if (list.length) {
      answered++;
      if (!metIds.length) { unhappy++; unhappyIds.push(id); }
      else if (metIds.length === 1) alone++;
      else crowded++;
    }
    if (index >= 0) {
      perGroup[index].met += metIds.length;
      perGroup[index].total += list.length;
      perGroup[index].avoidBroken += clashIds.length;
      if (list.length) {
        perGroup[index].answered++;
        if (metIds.length === 1) perGroup[index].alone++;
        else if (metIds.length > 1) perGroup[index].crowded++;
      }
      metIds.forEach(other => {
        if ((prefs[other] || []).includes(id) && id < other) { mutual++; perGroup[index].mutual++; }
      });
      // Una parella junta surt una sola vegada a la llista, tant si la separació
      // l'ha demanada una de les dues persones com totes dues.
      clashIds.forEach(other => {
        if (id < other || !(avoid[other] || []).includes(id)) clashes.push([id, other]);
      });
    }
  });

  perGroup.forEach(entry => {
    entry.pct = entry.total ? Math.round(entry.met * 100 / entry.total) : null;
    entry.alonePct = entry.answered ? Math.round(entry.alone * 100 / entry.answered) : null;
  });
  const avoidKept = avoidTotal - avoidBroken;
  const pct = total ? Math.round(met * 100 / total) : null;
  const avoidPct = avoidTotal ? Math.round(avoidKept * 100 / avoidTotal) : null;
  const alonePct = answered ? Math.round(alone * 100 / answered) : null;
  const balance = balanceStats(groups, options.attributes);
  const levels = levelStats(groups, options.levels, perGroup);
  const criterion = options.criterion === 'spread' ? 'spread' : 'max';
  balance.forEach((entry, index) => {
    // Cada equip porta la seva composició a mà per al panell i el llenç.
    perGroup.forEach((group, position) => {
      if (!group.composition) group.composition = [];
      group.composition[index] = { key: entry.key, short: entry.short, flag: entry.flag,
                                   values: entry.values.map(value => ({ label: value.label, count: value.perGroup[position] }))
                                     .filter(value => value.count > 0) };
    });
  });
  return {
    met, total, answered, unhappy, mutual, perStudent, perGroup,
    alone, crowded, alonePct, unhappyIds, balance, levels, criterion,
    avoidKept, avoidTotal, avoidBroken, clashes, avoidPct, pct,
    // Xifra que encapçala els indicadors, segons el criteri d'èxit triat.
    mainPct: criterion === 'spread' ? (alonePct === null ? avoidPct : alonePct)
                                    : (pct === null ? avoidPct : pct)
  };
}

/**
 * Parelles mínimes possibles d'un valor repartit entre els equips: la fita amb
 * què es mesura com de bo és l'equilibri assolit.
 */
function minimumPairs(total, teams) {
  if (teams < 1) return total * (total - 1) / 2;
  const base = Math.floor(total / teams);
  const extra = total % teams;
  return teams * base * (base - 1) / 2 + extra * base;
}

/**
 * Com de repartits queden el grup d'origen, el sexe i les necessitats
 * educatives. El 100% és el millor repartiment possible amb aquestes mides
 * d'equip; el 0%, tots els que comparteixen valor al mateix equip.
 *
 * @returns {Array<{key:string, label:string, short:string, flag:boolean,
 *                  pct:number|null, values:Array}>}
 */
function balanceStats(groups, attributes) {
  if (!attributes) return [];
  const teams = Math.max(1, groups.length);
  return ATTRIBUTES.map(attribute => {
    const map = attributes[attribute.key];
    if (!map || !Object.keys(map).length) return null;
    const counts = new Map();
    groups.forEach((group, index) => group.forEach(id => {
      const raw = map[id];
      if (!raw || (attribute.flag && !isMarked(raw))) return;
      const key = attribute.flag ? 'marcat' : attributeKey(raw);
      if (!key) return;
      let entry = counts.get(key);
      if (!entry) {
        entry = { key, label: attribute.flag ? attribute.short : String(raw).trim(),
                  total: 0, perGroup: groups.map(() => 0) };
        counts.set(key, entry);
      }
      entry.total++;
      entry.perGroup[index]++;
    }));
    const values = [...counts.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    if (!values.length) return null;
    let pairs = 0;
    let best = 0;
    let worst = 0;
    values.forEach(entry => {
      entry.perGroup.forEach(count => { pairs += count * (count - 1) / 2; });
      best += minimumPairs(entry.total, teams);
      worst += entry.total * (entry.total - 1) / 2;
    });
    return {
      key: attribute.key, label: attribute.label, short: attribute.short, flag: attribute.flag,
      values, pairs,
      pct: worst > best ? Math.round((worst - pairs) * 100 / (worst - best)) : 100
    };
  }).filter(Boolean);
}

/**
 * Com d'igualats queden els nivells mitjans dels equips. El 100% és que tots
 * tinguin la mateixa mitjana; el 0%, que la diferència entre el millor i el
 * pitjor sigui tan gran com la que hi ha entre dos alumnes qualssevol.
 *
 * @returns {{pct:number|null, mean:number, perGroup:number[], spread:number}|null}
 */
function levelStats(groups, levels, perGroup) {
  if (!levels || !groups.length) return null;
  const known = [];
  const means = groups.map((group, index) => {
    const values = group.map(id => levels[id]).filter(Number.isFinite);
    values.forEach(value => known.push(value));
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    if (perGroup[index]) perGroup[index].levelMean = mean;
    return mean;
  });
  const filled = means.filter(mean => mean !== null);
  if (known.length < 2 || !filled.length) return null;
  const range = Math.max(...known) - Math.min(...known);
  const spread = Math.max(...filled) - Math.min(...filled);
  return {
    mean: known.reduce((sum, value) => sum + value, 0) / known.length,
    perGroup: means,
    spread,
    pct: range > 0 ? Math.max(0, Math.round((1 - spread / range) * 100)) : 100
  };
}

/** Mitjana dels indicadors d'equilibri, o `null` si no n'hi ha cap. */
function balanceAverage(balance) {
  const list = (balance || []).filter(entry => entry.pct !== null);
  if (!list.length) return null;
  return Math.round(list.reduce((sum, entry) => sum + entry.pct, 0) / list.length);
}

/**
 * Qualitat comparable de dues formacions: el percentatge del criteri triat,
 * descomptant cada separació trencada i sumant-hi una part de l'equilibri de la
 * composició. Una separació sense respectar es paga cara, però no tant com per
 * acceptar qualsevol repartiment.
 */
function qualityScore(pct, broken, balance, none) {
  return (pct || 0) - (broken || 0) * PROPOSAL_CLASH_COST - (none || 0) * PROPOSAL_NONE_COST +
    (balance === null || balance === undefined ? 0 : balance * BALANCE_QUALITY);
}

/**
 * Amb el criteri d'una tria per alumne, el percentatge no distingeix entre qui
 * n'ha acomplert massa i qui s'ha quedat sense cap: els que no en tenen cap
 * compten a part perquè cap formació que en deixi de banda no guanyi.
 */
function proposalQuality(stats) {
  return qualityScore(stats.mainPct, stats.avoidBroken, balanceAverage(stats.balance),
                      stats.criterion === 'spread' ? stats.unhappy : 0);
}

/** El mateix, per a la millor formació desada, que només en guarda el recompte. */
function storedQuality(best) {
  return qualityScore(best.pct, best.broken, best.balance === undefined ? null : best.balance,
                      best.none);
}

/** "3 separacions" / "1 separació". */
function separationLabel(count) {
  return `${count} ${count === 1 ? 'separació' : 'separacions'}`;
}

/** "2 de 3 separacions respectades" amb la concordança correcta. */
function separationsKept(kept, total) {
  return `${kept} de ${separationLabel(total)} respectad${total === 1 ? 'a' : 'es'}`;
}

/** "3 parelles recíproques" amb la concordança correcta. */
function mutualLabel(count) {
  return `${pluralize(count, 'parella', 'parelles')} recípro${count === 1 ? 'ca' : 'ques'}`;
}

/**
 * Classe de color segons les preferències acomplertes. Amb el criteri d'una
 * tria per alumne, coincidir amb més d'una no és millor: només n'hi ha prou
 * amb una.
 */
function matchTone(met, total, criterion) {
  if (!total) return 'none';
  if (criterion === 'spread') return met === 1 ? 'good' : met > 1 ? 'medium' : 'bad';
  if (met >= total) return 'good';
  return met > 0 ? 'medium' : 'bad';
}

function matchChip(entry, name, criterion) {
  if (!entry) return '';
  const tone = matchTone(entry.met, entry.total, criterion);
  const label = entry.total ? `${entry.met}/${entry.total}` : '—';
  const title = !entry.total
    ? `${name}: no va indicar cap preferència`
    : [`${name}: ${entry.met} de ${entry.total} preferències acomplertes`,
       entry.metIds.length ? `Amb: ${entry.metIds.map(A.studentName).join(', ')}` : '',
       entry.missIds.length ? `Sense: ${entry.missIds.map(A.studentName).join(', ')}` : '']
      .filter(Boolean).join(' · ');
  return `<span class="pref-chip pref-${tone}" title="${esc(title)}">${esc(label)}</span>`;
}

/** Avís de l'alumne que ha acabat amb algú de qui demanava separar-se. */
function avoidChip(entry, name, nameFor) {
  if (!entry || !entry.avoidBroken) return '';
  const names = entry.avoidIds.map(nameFor).join(', ');
  const title = `${name}: comparteix equip amb ${names}, que havia demanat de separar`;
  return `<span class="pref-chip pref-avoid" title="${esc(title)}"><span class="mi mi-xs">person_off</span>${entry.avoidBroken}</span>`;
}

function matchBar(pct) {
  const value = pct === null ? 0 : pct;
  const tone = pctTone(pct);
  return `<div class="pref-bar"><span class="pref-${tone}" style="width:${value}%"></span></div>`;
}

function pctTone(pct) {
  if (pct === null || pct === undefined) return 'none';
  return pct >= 75 ? 'good' : pct >= 40 ? 'medium' : 'bad';
}

/**
 * Grau d'assoliment de cada criteri: les tries acomplertes, el repartiment
 * d'una tria per alumne, les separacions respectades i l'equilibri de la
 * composició dels equips. El docent el veu igual a l'assistent i al panell
 * lateral, i es refà a cada canvi.
 *
 * @returns {Array<{label:string, pct:number|null, meta:string, main:boolean}>}
 */
function criteriaList(stats) {
  const spread = stats.criterion === 'spread';
  const rows = [];
  // Amb el criteri d'una tria per alumne, el percentatge de tries acomplertes
  // no vol dir res: acomplir-ne més seria pitjor, no millor.
  if (stats.total && !spread) {
    rows.push({
      key: 'prefs',
      label: 'Preferències acomplertes',
      pct: stats.pct,
      meta: `${stats.met} de ${stats.total} tries · ${mutualLabel(stats.mutual)}`,
      main: true
    });
  }
  if (stats.answered && spread) {
    rows.push({
      key: 'alone',
      label: 'Amb una sola tria acomplerta',
      pct: stats.alonePct,
      meta: [`${stats.alone} amb una`, `${stats.crowded} amb més d'una`,
             `${stats.unhappy} sense cap`].join(' · '),
      main: true
    });
  }
  if (stats.avoidTotal) {
    rows.push({
      key: 'avoid',
      label: 'Separacions respectades',
      pct: stats.avoidPct,
      meta: separationsKept(stats.avoidKept, stats.avoidTotal),
      main: false
    });
  }
  (stats.balance || []).forEach(entry => {
    rows.push({
      key: `balance:${entry.key}`,
      label: `Equilibri · ${entry.label}`,
      pct: entry.pct,
      meta: entry.values.map(value => `${value.label} ${value.total}`).join(' · '),
      main: false
    });
  });
  if (stats.levels) {
    rows.push({
      key: 'balance:level',
      label: `Equilibri · ${LEVEL.label}`,
      pct: stats.levels.pct,
      meta: `nivell mitjà ${stats.levels.mean.toFixed(1)} · ${stats.levels.spread.toFixed(1)} punts entre el més alt i el més baix`,
      main: false
    });
  }
  return rows;
}

/** Els indicadors de criteris, en files amb barra i detall. */
function criteriaHtml(stats) {
  const rows = criteriaList(stats);
  if (!rows.length) return '';
  return `<div class="pref-criteria">${rows.map(row => `
    <div class="pref-criterion${row.main ? ' pref-criterion-main' : ''}">
      <div class="pref-criterion-head">
        <span>${esc(row.label)}</span>
        <b class="pref-${pctTone(row.pct)}">${row.pct === null ? '—' : row.pct + '%'}</b>
      </div>
      ${matchBar(row.pct)}
      <div class="pref-criterion-meta">${esc(row.meta)}</div>
    </div>`).join('')}</div>`;
}

/**
 * Avís dels alumnes que han respost i no tenen ningú de la seva llista. Amb el
 * criteri d'una tria per alumne no hauria de passar mai: si surt, és que amb
 * aquestes mides i aquestes restriccions no hi havia manera.
 */
function noneNoteHtml(stats, nameFor) {
  if (stats.criterion !== 'spread' || !stats.unhappy) return '';
  const names = stats.unhappyIds.slice(0, 8).map(nameFor).join(' · ');
  return `<div class="pref-note pref-note-warn"><span class="mi mi-xs">sentiment_dissatisfied</span>
      <div><b>${pluralize(stats.unhappy, 'alumne')} sense cap tria acomplerta</b>
      <div class="pref-note-meta">${esc(names)}${stats.unhappyIds.length > 8 ? ' · …' : ''}.
      Amb aquestes mides d'equip i aquestes restriccions no s'ha pogut donar-los ningú
      de la seva llista: prova una altra proposta, canvia la mida dels equips o
      allibera alguna restricció.</div></div></div>`;
}

/** "Grup: aire 2 · terra 2 · Sexe: H 2 · D 2": com ha quedat compost un equip. */
function compositionHtml(entry) {
  const parts = (entry?.composition || []).filter(item => item && item.values.length).map(item =>
    `<span><b>${esc(item.short)}</b> ${esc(item.values.map(value =>
      item.flag ? String(value.count) : `${value.label} ${value.count}`).join(' · '))}</span>`);
  return parts.length ? `<div class="pref-compo">${parts.join('')}</div>` : '';
}

function storedPreferences() { return A.getTeams().preferences || null; }

/** El detall dels criteris queda obert o tancat entre repintades del panell. */
let criteriaOpen = false;

/**
 * Opcions amb què s'han de comptar els indicadors d'unes preferències desades.
 * El nivell de competència el mana el panell d'equips, que és on el docent el
 * pot retocar després d'importar el full.
 */
function statsOptions(stored, extra = {}) {
  const teams = A.getTeams();
  return {
    avoid: stored.avoid,
    attributes: stored.attributes,
    criterion: stored.criterion,
    levels: teams.useCompetency ? teams.competencies : null,
    ...extra
  };
}

/**
 * Indicadors per al panell lateral d'equips. Retorna `null` quan la
 * configuració activa no té preferències carregades.
 */
function preferenceTeamView(groups) {
  const stored = storedPreferences();
  if (!stored || !groups || !groups.length) return null;
  const stats = preferenceStats(groups, stored.prefs, statsOptions(stored));
  if (!stats.total && !stats.avoidTotal && !stats.balance.length) return null;
  const rows = criteriaList(stats);
  const headline = rows.find(row => row.main) || rows[0];
  return {
    stats,
    summary: `<div class="pref-summary">
        <div class="pref-summary-head">
          <span><span class="mi mi-xs">diversity_3</span> ${esc(headline.label)}</span>
          <b class="pref-${pctTone(headline.pct)}">${headline.pct === null ? '—' : headline.pct + '%'}</b>
        </div>
        ${matchBar(headline.pct)}
        <div class="pref-summary-meta">${esc(headline.meta)}</div>
      </div>
      ${noneNoteHtml(stats, A.studentName)}
      ${rows.length > 1 ? `<details class="pref-criteria-box"${criteriaOpen ? ' open' : ''}>
        <summary data-action="prefToggleCriteria"><span class="mi mi-xs">expand_more</span> Grau d'assoliment de cada criteri</summary>
        ${criteriaHtml(stats)}
      </details>` : ''}`,
    composition: index => compositionHtml(stats.perGroup[index]),
    group: index => groupChip(stats, index) + brokenChip(stats.perGroup[index]),
    member: id => matchChip(stats.perStudent[id], A.studentName(id), stats.criterion) +
      avoidChip(stats.perStudent[id], A.studentName(id), A.studentName)
  };
}

/** Avís de les separacions trencades d'un equip. */
function brokenChip(entry) {
  if (!entry?.avoidBroken) return '';
  return `<span class="pref-chip pref-avoid" title="${esc(`${separationLabel(entry.avoidBroken)} sense respectar en aquest equip`)}"><span class="mi mi-xs">person_off</span>${entry.avoidBroken}</span>`;
}

/**
 * Xifra que encapçala cada equip: el percentatge de tries acomplertes o, amb el
 * criteri d'una tria per alumne, quants membres en tenen exactament una.
 */
function groupChip(stats, index) {
  const entry = stats.perGroup[index];
  if (!entry) return '';
  if (stats.criterion === 'spread') {
    if (!entry.answered) return '';
    const title = `${entry.alone} de ${entry.answered} membres amb una sola tria acomplerta` +
      (entry.crowded ? ` · ${entry.crowded} amb més d'una` : '');
    return `<span class="pref-chip pref-${pctTone(entry.alonePct)}" title="${esc(title)}">${entry.alone}/${entry.answered}</span>`;
  }
  if (entry.pct === null) return '';
  return `<span class="pref-chip pref-${pctTone(entry.pct)}"
    title="${esc(`${entry.met} de ${entry.total} preferències de l'equip`)}">${entry.pct}%</span>`;
}

/* ── Secció del panell d'equips ──────────────────────── */

/**
 * Memòria de la millor formació carregada. Mentre el docent fa proves
 * (repartiments nous, canvis a mà), la versió amb més preferències
 * acomplertes es guarda per poder-hi tornar.
 */
function rememberFormation(teams, stats) {
  if (!stats || (!stats.total && !stats.avoidTotal && !stats.balance.length) || !teams.groups?.length) return;
  const best = teams.preferences.best;
  if (best && proposalQuality(stats) <= storedQuality(best)) return;
  teams.preferences.best = {
    groups: teams.groups.map(group => group.slice()),
    pct: stats.mainPct === null ? 0 : stats.mainPct,
    broken: stats.avoidBroken,
    balance: balanceAverage(stats.balance),
    none: stats.criterion === 'spread' ? stats.unhappy : 0,
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
    box.innerHTML = `<p class="panel-hint" style="margin-bottom:6px">Carrega el full de respostes del formulari (nom, companys amb qui voldria
      treballar i, si n'hi ha, columnes de separació, grup d'origen, sexe o necessitats educatives)
      i l'aplicació proposarà els equips que acompleixin més preferències sense ajuntar qui ha
      demanat de no coincidir i repartint la composició del grup.</p>`;
    return;
  }
  const teams = A.getTeams();
  const answered = new Set([...Object.keys(stored.prefs), ...Object.keys(stored.avoid || {})]).size;
  const stats = teams.groups?.length ? preferenceStats(teams.groups, stored.prefs, statsOptions(stored)) : null;
  const current = stats ? stats.mainPct : null;
  rememberFormation(teams, stats);

  const best = stored.best;
  const canRestore = !!best && (!stats || storedQuality(best) > proposalQuality(stats));
  const loadedAttributes = activeAttributes(stored.attributes)
    .map(item => `${item.attribute.label.toLowerCase()} (${item.attribute.flag
      ? `${pluralize(item.values[0].total, 'alumne')} ${item.values[0].total === 1 ? 'marcat' : 'marcats'}`
      : pluralize(item.values.length, 'valor')})`)
    .join(' · ');
  box.innerHTML = `<div class="pref-status">
      <div class="pref-status-head">
        <span><span class="mi mi-xs">check_circle</span> ${pluralize(answered, 'resposta', 'respostes')} carregades</span>
        ${current === null ? '' : `<b class="pref-${pctTone(current)}">${current}%</b>`}
      </div>
      <div class="pref-status-meta">${esc(stored.source || 'Full de preferències')}${stored.updated ? ` · ${esc(stored.updated)}` : ''}${stored.unresolved?.length ? ` · ${pluralize(stored.unresolved.length, 'nom')} sense identificar` : ''}</div>
      ${stats && stats.avoidTotal ? `<div class="pref-status-meta pref-${stats.avoidBroken ? 'bad' : 'good'}">${separationsKept(stats.avoidKept, stats.avoidTotal)}</div>` : ''}
      ${loadedAttributes ? `<div class="pref-status-meta">S'equilibra per ${esc(loadedAttributes)}</div>` : ''}
      <div class="pref-status-actions">
        <button class="btn btn-sm" data-action="prefRegenerate"><span class="mi mi-xs">auto_awesome</span> Tornar a proposar</button>
        <button class="btn btn-sm btn-danger" data-action="prefForget" title="Esborrar les preferències carregades"><span class="mi mi-xs">delete</span></button>
      </div>
      ${canRestore ? `<button class="btn btn-sm pref-restore" data-action="prefRestoreFormation"
        title="${esc(`Equips del ${best.updated} amb el ${best.pct}% de preferències acomplertes${best.broken ? ` i ${separationLabel(best.broken)} sense respectar` : ''}`)}">
        <span class="mi mi-xs">history</span> Recuperar la millor versió (${best.pct}%)</button>` : ''}
    </div>`;
}

function forgetPreferences() {
  appConfirm('Esborrar les preferències?', 'Els equips ja formats es mantindran, però es perdran els indicadors de preferències i de separacions.', () => {
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
  const balance = {};
  ATTRIBUTE_KEYS.forEach(key => { balance[key] = true; });
  const attrs = {};
  ATTRIBUTE_KEYS.forEach(key => { attrs[key] = -1; });
  balance.level = true;
  return {
    step: 1, text: '', source: '', rows: [], hasHeader: true,
    mapping: { name: -1, prefs: [-1, -1, -1], avoid: [], attrs, level: -1 },
    entries: [], duplicates: 0, nameless: 0, match: null,
    rosterMode: 'merge', newConfigName: '', roster: [], prefs: {}, avoid: {}, unresolved: [],
    attributes: {}, levels: {}, levelRange: { min: null, max: null }, balance, criterion: 'max',
    plan: { mode: 'count', count: 4, size: 4, remainder: 'balanced' },
    ranked: true, useConstraints: true, useAvoid: true,
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
    W.avoid = stored.avoid || {};
    W.attributes = stored.attributes || {};
    W.levels = stored.levels || {};
    W.levelRange = { ...(stored.levelRange || { min: null, max: null }) };
    W.balance = { ...W.balance, ...(stored.balance || {}) };
    W.criterion = stored.criterion === 'spread' ? 'spread' : 'max';
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
      respostes incompletes no són cap problema. Si el full té columnes de separació
      («Separar 1», «Amb qui no vols treballar?»...), també es tindran en compte.</p>
    <div class="field"><label>Fitxer</label>
      <input type="file" id="prefFile" accept=".csv,.tsv,.txt,.xlsx,.xls" data-change="prefFileChosen"></div>
    <div class="field"><label>O enganxa-hi les dades</label>
      <textarea id="prefText" rows="7" style="resize:vertical" placeholder="Nom;Preferència 1;Preferència 2;Preferència 3;Separar 1&#10;Anna Puig;Pau Serra;Nil Roca;Jana Ferrer;Teo Mas">${esc(W.text)}</textarea></div>
    ${W.rows.length ? `<div class="pref-note"><span class="mi mi-xs">description</span>
      <div>Ja hi ha un full llegit: <b>${esc(W.source || 'dades enganxades')}</b>, ${pluralize(W.rows.length, 'fila', 'files')}.
      Continua per tornar a les columnes, o carrega'n un altre.</div></div>` : ''}`,
    `<button class="btn" data-action="closeModal">Cancel·lar</button>
     <button class="btn" data-action="prefTemplate" title="Descarregar un full d'exemple"><span class="mi mi-xs">download</span> Plantilla</button>
     <button class="btn btn-primary" data-action="prefReadSource">Continuar <span class="mi mi-xs">arrow_forward</span></button>`);
}

function downloadTemplate() {
  const rows = [
    ['Nom i cognoms', 'Preferència 1', 'Preferència 2', 'Preferència 3', 'Separar 1'],
    ['Anna Puig Solà', 'Pau Serra', 'Nil Roca', 'Jana Ferrer', ''],
    ['Pau Serra Vidal', 'Anna Puig Solà', 'Nil Roca', '', 'Jana Ferrer'],
    ['Nil Roca Camps', 'Pau Serra Vidal', '', '', '']
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

  const attrColumns = ATTRIBUTE_KEYS.map(key => W.mapping.attrs[key]).filter(index => index >= 0);
  const roleClass = index => index === W.mapping.name ? ' class="pref-col-name"'
    : W.mapping.avoid.includes(index) ? ' class="pref-col-avoid"'
    : attrColumns.includes(index) ? ' class="pref-col-attr"'
    : W.mapping.prefs.includes(index) ? ' class="pref-col-pref"' : '';

  const preview = rows.slice(0, 5).map(row => `<tr>${labels.map((_, index) =>
    `<td${roleClass(index)}>${esc(row[index] || '')}</td>`).join('')}</tr>`).join('');

  const prefRows = W.mapping.prefs.map((selected, position) => `
    <div class="field"><label>Preferència ${position + 1}</label>${columnSelect('pref', selected, position, true)}</div>`).join('');

  const avoidRows = W.mapping.avoid.map((selected, position) => `
    <div class="field"><label>Separar ${position + 1}</label>${columnSelect('avoid', selected, position, true)}</div>`).join('');

  // Cada columna que no és de noms es diu què conté: així un full amb l'ordre
  // canviat o amb capçaleres inesperades es pot assignar igualment a mà.
  const attrRows = ATTRIBUTES.map(attribute => {
    const selected = W.mapping.attrs[attribute.key];
    const values = selected >= 0
      ? [...new Set(columnValues(W.rows, W.hasHeader, selected).filter(Boolean))]
      : [];
    const sample = values.slice(0, 6).join(', ') + (values.length > 6 ? '…' : '');
    return `<div class="field"><label>${esc(attribute.label)}</label>
      <select data-change="prefSetColumn" data-role="attr" data-key="${attribute.key}">
        <option value="-1"${selected < 0 ? ' selected' : ''}>— cap —</option>
        ${labels.map((_, index) => option(index, selected)).join('')}
      </select>
      ${values.length ? `<span class="pref-field-note">${pluralize(values.length, 'valor')}: ${esc(sample)}</span>` : ''}</div>`;
  }).join('') + (() => {
    const selected = W.mapping.level;
    const numbers = selected >= 0
      ? columnValues(W.rows, W.hasHeader, selected).map(numberOf).filter(value => value !== null)
      : [];
    return `<div class="field"><label>${esc(LEVEL.label)} (valor numèric)</label>
      <select data-change="prefSetColumn" data-role="level">
        <option value="-1"${selected < 0 ? ' selected' : ''}>— cap —</option>
        ${labels.map((_, index) => option(index, selected)).join('')}
      </select>
      ${numbers.length
        ? `<span class="pref-field-note">${pluralize(numbers.length, 'valor')} de ${Math.min(...numbers)} a ${Math.max(...numbers)}</span>`
        : selected >= 0 ? '<span class="pref-field-note pref-bad">cap número en aquesta columna</span>' : ''}</div>`;
  })();

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
    <p class="modal-note" style="margin-top:12px">Si el full pregunta també amb qui <b>no</b> vol coincidir
      (columnes de tipus «Separar 1», «Separar 2»...), assigna-les aquí: la proposta mirarà de no
      posar aquestes persones al mateix equip.</p>
    ${avoidRows ? `<div class="pref-grid">${avoidRows}</div>` : ''}
    ${W.mapping.avoid.length < MAX_AVOID_COLUMNS
      ? `<button class="btn btn-sm" data-action="prefAddAvoidColumn"><span class="mi mi-xs">person_off</span> ${W.mapping.avoid.length ? 'Una separació més' : 'Afegir una columna de separació'}</button>`
      : ''}
    <p class="modal-note" style="margin-top:12px">Si el full porta altres dades de l'alumnat, digues quina columna
      conté cadascuna: el <b>grup d'origen</b> (lletres o paraules com ara «aire», «terra», «aigua»...),
      el <b>sexe</b>, les <b>necessitats educatives</b> (normalment una «S») i la <b>competència</b>
      (un número). Les tres primeres es reparteixen entre els equips; amb la competència s'igualen
      els nivells mitjans, que és el que fa els grups heterogenis. Les que no hi siguin,
      deixa-les en «cap».</p>
    <div class="pref-grid">${attrRows}</div>
    <div class="pref-preview"><table>
      <thead><tr>${labels.map((label, index) =>
        `<th${roleClass(index)}>${esc(label)}</th>`).join('')}</tr></thead>
      <tbody>${preview}</tbody>
    </table></div>`,
    `<button class="btn" data-action="prefBack" data-step="1"><span class="mi mi-xs">arrow_back</span> Enrere</button>
     <button class="btn btn-primary" data-action="prefColumnsNext">Continuar <span class="mi mi-xs">arrow_forward</span></button>`);
}

function setColumn(role, position, value, key) {
  const index = parseInt(value, 10);
  if (role === 'name') W.mapping.name = index;
  else if (role === 'avoid') W.mapping.avoid[position] = index;
  else if (role === 'attr') W.mapping.attrs[key] = index;
  else if (role === 'level') W.mapping.level = index;
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
  // Una columna no pot fer dos papers alhora: la separació mana sobre la
  // preferència, les dades de l'alumnat manen sobre totes dues, i cap d'elles
  // pot ser la columna del nom.
  const taken = new Set();
  ATTRIBUTE_KEYS.forEach(key => {
    const index = W.mapping.attrs[key];
    if (index === W.mapping.name || taken.has(index)) W.mapping.attrs[key] = -1;
    else if (index >= 0) taken.add(index);
  });
  if (W.mapping.level === W.mapping.name || taken.has(W.mapping.level)) W.mapping.level = -1;
  else if (W.mapping.level >= 0) taken.add(W.mapping.level);
  W.mapping.avoid = W.mapping.avoid.map(index =>
    (index === W.mapping.name || taken.has(index) ? -1 : index));
  W.mapping.avoid.filter(index => index >= 0).forEach(index => taken.add(index));
  W.mapping.prefs = W.mapping.prefs.map(index =>
    (index === W.mapping.name || taken.has(index) ? -1 : index));

  const columns = W.mapping.prefs.filter(index => index >= 0).length + taken.size;
  if (!columns) { toast('Indica com a mínim una columna de preferència o de separació', 'error'); return; }

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

/** Recalcula la llista de treball, les preferències, les separacions i la composició. */
function refreshRoster() {
  const built = buildRoster(W.rosterMode, W.match, A.getData().students, W.entries);
  W.roster = built.students;
  const result = buildPreferences(W.entries, W.roster);
  W.prefs = result.prefs;
  W.avoid = result.avoid;
  W.attributes = buildAttributes(W.entries, W.roster);
  const levels = buildLevels(W.entries, W.roster);
  W.levels = levels.values;
  // L'interval que es proposa és el del full; el docent el pot ajustar si
  // l'escala amb què ha avaluat arriba més amunt o més avall.
  W.levelRange = { min: levels.min, max: levels.max };
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

  const separations = avoidLinks(W.avoid);
  const cards = `<div class="pref-cards">
    <div class="pref-card"><b>${matched.length}</b><span>coincideixen amb la classe</span></div>
    <div class="pref-card${fresh.length ? ' pref-medium' : ''}"><b>${fresh.length}</b><span>noms nous al full</span></div>
    <div class="pref-card${missing.length ? ' pref-medium' : ''}"><b>${missing.length}</b><span>alumnes sense resposta</span></div>
    ${separations ? `<div class="pref-card"><b>${separations}</b><span>peticions de separació</span></div>` : ''}
  </div>`;

  // Què s'ha llegit de les columnes de grup d'origen, sexe, necessitats i competència.
  const loaded = activeAttributes(W.attributes);
  const levelCount = Object.keys(W.levels).length;
  const details = loaded.map(item =>
    `${esc(item.attribute.label)}: ${esc(item.values.map(value => `${value.label} (${value.total})`).join(', '))}`);
  if (levelCount) {
    details.push(`${esc(LEVEL.label)}: ${pluralize(levelCount, 'valor')} de ${W.levelRange.min} a ${W.levelRange.max}`);
  }
  const attributesBox = details.length
    ? `<div class="pref-note"><span class="mi mi-xs">tune</span>
        <div><b>Dades per equilibrar els equips</b>
        <div class="pref-note-meta">${details.join(' · ')}</div></div></div>`
    : '';

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
    ${attributesBox}
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

/** Nombre de peticions de separació llegides del full. */
function avoidLinks(avoid) {
  return Object.values(avoid || {}).reduce((sum, list) => sum + (list || []).length, 0);
}

/** Separacions que s'apliquen al repartiment: cap si el docent les desactiva. */
function currentAvoid() {
  return W.useAvoid === false ? {} : W.avoid;
}

/** Competències del full a l'escala del panell, o `null` si no n'hi ha. */
function currentLevels() {
  return Object.keys(W.levels || {}).length ? scaleLevels(W.levels, W.levelRange) : null;
}

function stepPlan() {
  const total = W.roster.length;
  const plan = planPreferenceSizes(total, W.plan);
  const withoutPrefs = W.roster.filter(student => !(W.prefs[student.id] || []).length).length;
  const separations = avoidLinks(W.avoid);
  const teams = A.getTeams();
  const hasConstraints = (teams.constraints[REL_TOGETHER].length + teams.constraints[REL_SEPARATE].length) > 0;

  // Un interruptor per a cada dada llegida del full: el docent decideix si vol
  // repartir-la entre els equips o si aquest cop no li interessa.
  const balanceToggles = activeAttributes(W.attributes).map(item => {
    const detail = item.attribute.flag
      ? `${pluralize(item.values[0].total, 'alumne')} ${item.values[0].total === 1 ? 'marcat' : 'marcats'}`
      : item.values.map(value => `${value.label} ${value.total}`).join(' · ');
    return `<label class="equips-toggle">
      <input type="checkbox" ${W.balance[item.attribute.key] !== false ? 'checked' : ''}
             data-change="prefToggleBalance" data-key="${item.attribute.key}">
      <span>Equilibrar ${esc(item.attribute.label.toLowerCase())} entre els equips
        <span class="pref-toggle-meta">${esc(detail)}</span></span>
    </label>`;
  }).join('');

  // Competència: l'interval del full es pot ajustar, perquè és el que decideix
  // com es converteixen els valors a l'escala 0–10 del panell d'equips.
  const levelCount = Object.keys(W.levels).length;
  const levelBox = levelCount ? `
    <label class="equips-toggle">
      <input type="checkbox" ${W.balance.level !== false ? 'checked' : ''} data-change="prefToggleBalance" data-key="level">
      <span>Igualar el nivell mitjà dels equips (grups heterogenis)
        <span class="pref-toggle-meta">${pluralize(levelCount, 'valor')} llegits</span></span>
    </label>
    <div class="pref-grid">
      <div class="field"><label>Mínim de l'escala</label>
        <input type="number" step="any" value="${esc(W.levelRange.min ?? '')}" data-change="prefSetLevelRange" data-key="min"></div>
      <div class="field"><label>Màxim de l'escala</label>
        <input type="number" step="any" value="${esc(W.levelRange.max ?? '')}" data-change="prefSetLevelRange" data-key="max"></div>
    </div>
    <p class="modal-note">Aquests dos valors es converteixen en el <b>0</b> i el <b>10</b> del
      nivell de competència del panell d'equips, que s'omplirà en carregar la proposta.</p>` : '';

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
    <div class="field" style="margin-top:12px"><label>Criteri d'èxit</label></div>
    <div class="pref-options">
      ${[['max', 'Acomplir el màxim de preferències',
          'Cada alumne coincideix amb tantes persones de la seva llista com sigui possible.'],
         ['spread', 'Una preferència per alumne',
          "Reparteix les tries: es busca que tothom en tingui una d'acomplerta i s'evita que uns quants se les enduguin totes i altres es quedin sense ningú."]]
        .map(([mode, title, detail]) => `<label class="pref-option${W.criterion === mode ? ' selected' : ''}">
          <input type="radio" name="prefCriterion" value="${mode}" ${W.criterion === mode ? 'checked' : ''} data-change="prefSetCriterion">
          <div><b>${esc(title)}</b><span>${esc(detail)}</span></div>
        </label>`).join('')}
    </div>
    <label class="equips-toggle">
      <input type="checkbox" ${W.ranked ? 'checked' : ''} data-change="prefToggleRanked">
      <span>Prioritzar les primeres preferències</span>
    </label>
    ${separations ? `<label class="equips-toggle">
      <input type="checkbox" ${W.useAvoid ? 'checked' : ''} data-change="prefToggleAvoid">
      <span>Respectar les ${separationLabel(separations)} demanades al full</span>
    </label>` : ''}
    ${balanceToggles}
    ${levelBox}
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

/** Extrems de l'escala de competència, sense deixar que es creuin. */
function setLevelRange(key, value) {
  const number = numberOf(value);
  W.levelRange[key] = number;
  const { min, max } = W.levelRange;
  if (min !== null && max !== null && min > max) W.levelRange[key === 'min' ? 'max' : 'min'] = number;
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
    avoid: currentAvoid(),
    sizes: plan.sizes,
    leftover: plan.leftover,
    ranked: W.ranked,
    constraints: currentConstraints(),
    attributes: W.attributes,
    balance: W.balance,
    levels: W.balance.level === false ? null : currentLevels(),
    criterion: W.criterion,
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
  // Els indicadors sempre mostren totes les separacions llegides, encara que el
  // docent hagi decidit no aplicar-les: així es veu què s'està deixant passar.
  proposal.stats = preferenceStats(proposal.groups, W.prefs, {
    leftover: proposal.leftover,
    avoid: W.avoid,
    attributes: W.attributes,
    levels: currentLevels(),
    criterion: W.criterion
  });
  return proposal;
}

function keepIfBest() {
  if (!W.best || proposalQuality(W.proposal.stats) > proposalQuality(W.best.stats)) {
    W.best = cloneProposal(W.proposal);
  }
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
  const tone = matchTone(entry.met, entry.total, stats.criterion);
  const detail = [
    entry.metIds.length ? `Amb: ${entry.metIds.map(nameOf).join(', ')}` : '',
    entry.missIds.length ? `Sense: ${entry.missIds.map(nameOf).join(', ')}` : '',
    entry.avoidIds.length ? `Havia demanat separar-se de: ${entry.avoidIds.map(nameOf).join(', ')}` : ''
  ].filter(Boolean).join(' · ') || 'Sense preferències indicades';
  // Amb el criteri d'una tria per alumne, qui es queda sense cap es marca.
  const stranded = stats.criterion === 'spread' && entry.total && !entry.met;
  return `<div class="pref-member${W.picked === id ? ' pref-picked' : ''}${entry.avoidBroken ? ' pref-member-clash' : ''}${stranded ? ' pref-member-none' : ''}" draggable="true"
      data-action="prefPick" data-sid="${esc(id)}" title="${esc(detail)}">
      <span class="pref-member-name">${esc(nameOf(id))}</span>
      <span class="pref-chip pref-${tone}">${entry.total ? `${entry.met}/${entry.total}` : '—'}</span>
      ${avoidChip(entry, nameOf(id), nameOf)}
    </div>`;
}

/** Avís de les parelles que han acabat juntes tot i haver demanat separar-se. */
function clashNoteHtml(stats) {
  if (!stats.avoidBroken) {
    return stats.avoidTotal
      ? `<div class="pref-note"><span class="mi mi-xs">check_circle</span>
          <div>Es respecten ${W.useAvoid === false ? 'igualment ' : ''}totes les ${separationLabel(stats.avoidTotal)} demanades al full.</div></div>`
      : '';
  }
  const pairs = stats.clashes.slice(0, 6)
    .map(([a, b]) => `${esc(nameOf(a))} i ${esc(nameOf(b))}`).join(' · ');
  return `<div class="pref-note pref-note-warn"><span class="mi mi-xs">person_off</span>
      <div><b>${separationLabel(stats.clashes.length)} sense respectar</b>
      <div class="pref-note-meta">${pairs}${stats.clashes.length > 6 ? ' · …' : ''}.
      ${W.useAvoid === false
        ? 'Les separacions estan desactivades: torna a la configuració per aplicar-les.'
        : 'Amb aquestes mides no hi ha manera de separar-los tots; prova una altra proposta o canvia la mida dels equips.'}</div></div></div>`;
}

/** Com es ven la millor proposta desada quan la d'ara no hi arriba. */
function betterProposalHtml(stats) {
  const best = W.best.stats;
  const fewer = best.avoidBroken < stats.avoidBroken
    ? (best.avoidBroken
        ? ` i només ${separationLabel(best.avoidBroken)} sense respectar`
        : ' i totes les separacions respectades')
    : '';
  return `<div class="pref-note pref-note-warn"><span class="mi mi-xs">history</span>
      <div>La millor proposta arriba al <b>${best.pct === null ? 0 : best.pct}%</b>${fewer}.
      <button class="btn btn-sm" data-action="prefRestoreBest" style="margin-left:6px">Recuperar-la</button></div></div>`;
}

function resultSummaryHtml() {
  const { stats, attempt, edited } = W.proposal;
  const rows = criteriaList(stats);
  // El criteri triat encapçala el resum; la resta queden a sota, amb la seva
  // barra, perquè es vegi què s'hi guanya i què s'hi perd a cada canvi.
  const headline = rows.find(row => row.main) || rows[0] ||
    { label: 'Preferències acomplertes', pct: null, meta: '' };
  const attemptMeta = `proposta ${attempt}${W.attempts > 1 ? ` de ${W.attempts}` : ''}${edited ? ', retocada a mà' : ''}`;
  return `<div class="pref-summary pref-summary-big">
      <div class="pref-summary-head">
        <span>${esc(headline.label)}</span>
        <b class="pref-${pctTone(headline.pct)}">${headline.pct === null ? '—' : headline.pct + '%'}</b>
      </div>
      ${matchBar(headline.pct)}
      <div class="pref-summary-meta">${esc(headline.meta)}${headline.meta ? ' · ' : ''}${esc(attemptMeta)}</div>
    </div>
    ${rows.length > 1 ? criteriaHtml(stats) : ''}
    ${noneNoteHtml(stats, nameOf)}
    ${clashNoteHtml(stats)}
    ${W.best && proposalQuality(stats) < proposalQuality(W.best.stats) ? betterProposalHtml(stats) : ''}`;
}

function resultGroupsHtml() {
  const { groups, leftover, stats } = W.proposal;
  const cards = groups.map((group, index) => {
    const entry = stats.perGroup[index];
    const level = Number.isFinite(entry.levelMean) ? ` · nivell ${entry.levelMean.toFixed(1)}` : '';
    return `<div class="pref-group" data-team="${index}" data-action="prefDropOn">
      <div class="pref-group-head">
        <b>Equip ${index + 1}</b>
        ${groupChip(stats, index)}
      </div>
      <div class="pref-group-meta">${pluralize(group.length, 'alumne')}${entry.mutual && stats.criterion !== 'spread' ? ` · ${mutualLabel(entry.mutual)}` : ''}${level}${entry.avoidBroken ? ` · <b class="pref-bad">${separationLabel(entry.avoidBroken)} sense respectar</b>` : ''}</div>
      ${compositionHtml(entry)}
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
    criterion: W.criterion === 'spread' ? 'spread' : 'max',
    prefs: JSON.parse(JSON.stringify(W.prefs)),
    avoid: JSON.parse(JSON.stringify(W.avoid || {})),
    attributes: JSON.parse(JSON.stringify(W.attributes || {})),
    levels: JSON.parse(JSON.stringify(W.levels || {})),
    levelRange: { ...W.levelRange },
    balance: { ...W.balance },
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

  // La competència del full omple el panell de nivells, on el docent la pot
  // retocar, i deixa marcats els equips heterogenis si s'ha demanat igualar-la.
  const scaled = currentLevels();
  if (scaled) {
    Object.entries(scaled).forEach(([studentId, level]) => {
      if (valid.has(studentId)) teams.competencies[studentId] = level;
    });
    teams.useCompetency = true;
    teams.heterogeneous = W.balance.level !== false;
  }

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

  const pct = proposal.stats.mainPct === null ? ''
    : ` · ${proposal.stats.mainPct}% ${proposal.stats.criterion === 'spread' ? "amb una tria acomplerta" : 'de preferències'}`;
  const clashes = proposal.stats.avoidBroken ? ` · ${separationLabel(proposal.stats.avoidBroken)} sense respectar` : '';
  toast(`${pluralize(groups.length, 'equip')} ${groups.length === 1 ? 'format' : 'formats'}${pct}${clashes}`, 'success');
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
  prefSetColumn: node => setColumn(node.dataset.role, parseInt(node.dataset.idx, 10), node.value, node.dataset.key),
  prefAddColumn: () => { W.mapping.prefs.push(-1); renderWizard(); },
  prefAddAvoidColumn: () => { W.mapping.avoid.push(-1); renderWizard(); },
  prefColumnsNext: () => columnsNext(),
  prefSetRosterMode: node => setRosterMode(node.value),
  prefSetConfigName: node => { W.newConfigName = node.value.trim(); },
  prefStudentsNext: () => studentsNext(),
  prefSetPlanMode: node => setPlanMode(node.dataset.value),
  prefSetPlanValue: node => setPlanValue(node.value),
  prefSetRemainder: node => { W.plan.remainder = node.dataset.value; renderWizard(); },
  prefToggleRanked: node => { W.ranked = node.checked; },
  prefToggleAvoid: node => { W.useAvoid = node.checked; renderWizard(); },
  prefToggleConstraints: node => { W.useConstraints = node.checked; renderWizard(); },
  prefSetCriterion: node => { W.criterion = node.value === 'spread' ? 'spread' : 'max'; renderWizard(); },
  prefToggleBalance: node => { W.balance[node.dataset.key] = node.checked; renderWizard(); },
  prefSetLevelRange: node => setLevelRange(node.dataset.key, node.value),
  prefToggleCriteria: node => { criteriaOpen = !node.closest('details')?.open; },
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
  buildRoster, buildPreferences, buildAttributes, attributeValues, activeAttributes,
  buildLevels, scaleLevels, numberOf,
  planPreferenceSizes, describeSizes, avoidLinks,
  preferenceWeights, preferenceModel, groupScore, optimizePreferenceGroups,
  preferenceStats, preferenceStatsOptions: statsOptions,
  balanceStats, levelStats, balanceAverage, matchTone, criteriaList,
  ATTRIBUTES, ATTRIBUTE_KEYS, attributeByKey, LEVEL,
  preferenceTeamView, renderPreferencePanel, restoreFormation, startPreferenceWizard: startWizard
});

})(window.AulaMap);
