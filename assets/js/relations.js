/**
 * AulaMap — Relacions entre alumnes (ajuntar / separar)
 *
 * Un conjunt "ajuntar" vol dir que els seus membres han de seure junts (formant
 * un bloc connectat de pupitres veïns). Un conjunt "separar" vol dir que cap
 * parella dels seus membres pot seure en pupitres veïns.
 *
 * Aquí hi ha: el càlcul de veïnatge entre pupitres, l'avaluació de les relacions
 * respecte de la distribució actual i la interfície del panell.
 */
'use strict';

/** Marge màxim (respecte del veí més pròxim) per considerar dos pupitres veïns. */
const NEIGHBOR_SLACK = 1.8;

/* ── Graf de veïnatge ────────────────────────────────── */

let _graphCache = { key: '', graph: null };

/**
 * Graf de veïnatge entre pupitres.
 *
 * S'utilitza el graf de veïns relatius (RNG): dos pupitres són veïns si no n'hi
 * ha cap altre "entremig" (més a prop de tots dos que ells entre si) i si la
 * distància no supera NEIGHBOR_SLACK vegades la del veí més pròxim. Això dona
 * veïnatges intuïtius —esquerra/dreta i davant/darrere, però no en diagonal— i
 * funciona igual amb files, illes, forma d'U, cercle o distribució lliure.
 *
 * @param {Array<{id:string,x:number,y:number}>} desks
 * @returns {Map<string, Set<string>>}
 */
function buildNeighborGraph(desks) {
  const key = desks.map(d => `${d.id}:${d.x},${d.y}`).join('|');
  if (_graphCache.key === key) return _graphCache.graph;

  const n = desks.length;
  const adj = new Map(desks.map(d => [d.id, new Set()]));
  if (n >= 2) {
    const cx = desks.map(d => d.x + DESK_W / 2);
    const cy = desks.map(d => d.y + DESK_H / 2);
    const dist = Array.from({ length: n }, () => new Float64Array(n));
    const nearest = new Float64Array(n).fill(Infinity);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(cx[i] - cx[j], cy[i] - cy[j]);
        dist[i][j] = d; dist[j][i] = d;
        if (d < nearest[i]) nearest[i] = d;
        if (d < nearest[j]) nearest[j] = d;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = dist[i][j];
        if (d > NEIGHBOR_SLACK * Math.min(nearest[i], nearest[j])) continue;
        let blocked = false;
        for (let k = 0; k < n && !blocked; k++) {
          if (k === i || k === j) continue;
          if (dist[i][k] < d && dist[j][k] < d) blocked = true;
        }
        if (!blocked) { adj.get(desks[i].id).add(desks[j].id); adj.get(desks[j].id).add(desks[i].id); }
      }
    }
  }
  _graphCache = { key, graph: adj };
  return adj;
}

function areNeighbors(deskA, deskB, graph) {
  return !!graph.get(deskA)?.has(deskB);
}

/** Mapa alumne → pupitre a partir de les assignacions. */
function buildStudentDeskMap(data) {
  const map = {};
  Object.entries(data.assignments).forEach(([deskId, studentId]) => { map[studentId] = deskId; });
  return map;
}

/* ── Avaluació ───────────────────────────────────────── */

/**
 * Estat de cada relació respecte de la distribució actual.
 * @returns {{results:Array, satisfied:number, violated:number, pending:number, pct:number|null}}
 */
function evaluateRelations(data) {
  const graph = buildNeighborGraph(data.desks);
  const deskOf = buildStudentDeskMap(data);
  const nameOf = id => data.students.find(s => s.id === id)?.name || '?';

  let satisfied = 0, violated = 0, pending = 0;
  const results = data.relations.map(rel => {
    const seated = rel.students.filter(id => deskOf[id]);
    const result = { id: rel.id, type: rel.type, status: 'pend', message: '' };

    if (rel.students.length < 2) {
      result.message = 'Cal un mínim de dos alumnes';
    } else if (rel.type === REL_SEPARATE) {
      if (seated.length < 2) {
        result.message = 'Pendent: alumnes sense lloc';
      } else {
        const conflicts = [];
        for (let i = 0; i < seated.length; i++) {
          for (let j = i + 1; j < seated.length; j++) {
            if (areNeighbors(deskOf[seated[i]], deskOf[seated[j]], graph)) {
              conflicts.push([seated[i], seated[j]]);
            }
          }
        }
        result.status = conflicts.length ? 'viol' : 'sat';
        result.conflicts = conflicts;
        result.message = conflicts.length
          ? 'Seuen a prop: ' + conflicts.map(p => `${nameOf(p[0])} i ${nameOf(p[1])}`).join('; ')
          : 'Cap parella a prop';
      }
    } else { // ajuntar
      if (seated.length < rel.students.length) {
        result.message = 'Pendent: alumnes sense lloc';
      } else {
        const components = connectedComponents(seated, deskOf, graph);
        result.status = components.length === 1 ? 'sat' : 'viol';
        result.components = components;
        result.message = components.length === 1
          ? 'Seuen junts'
          : 'Separats en ' + pluralize(components.length, 'bloc', 'blocs');
      }
    }

    if (result.status === 'sat') satisfied++;
    else if (result.status === 'viol') violated++;
    else pending++;
    return result;
  });

  const total = satisfied + violated;
  return { results, satisfied, violated, pending, pct: total ? Math.round(satisfied / total * 100) : null };
}

/** Components connexos d'un conjunt d'alumnes segons el veïnatge dels seus pupitres. */
function connectedComponents(studentIds, deskOf, graph) {
  const pending = new Set(studentIds);
  const components = [];
  while (pending.size) {
    const start = pending.values().next().value;
    pending.delete(start);
    const component = [start];
    const queue = [start];
    while (queue.length) {
      const current = queue.pop();
      for (const other of [...pending]) {
        if (areNeighbors(deskOf[current], deskOf[other], graph)) {
          pending.delete(other); component.push(other); queue.push(other);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * Línies entre alumnes relacionats que seuen a tocar.
 * És l'única part que cal recalcular mentre s'arrossega un pupitre.
 */
function relationLines(data) {
  const graph = buildNeighborGraph(data.desks);
  const deskOf = buildStudentDeskMap(data);
  const lines = [];
  data.relations.forEach(rel => {
    const seated = rel.students.filter(id => deskOf[id]);
    for (let i = 0; i < seated.length; i++) {
      for (let j = i + 1; j < seated.length; j++) {
        const deskA = deskOf[seated[i]], deskB = deskOf[seated[j]];
        if (!areNeighbors(deskA, deskB, graph)) continue;
        lines.push({ deskA, deskB, kind: rel.type === REL_TOGETHER ? 'good' : 'bad' });
      }
    }
  });
  return lines;
}

/** Punts d'estat que es pinten sota cada pupitre. */
function relationDots(data, evaluation) {
  const deskOf = buildStudentDeskMap(data);
  const dots = {};
  (evaluation || evaluateRelations(data)).results.forEach(result => {
    const kind = result.status === 'sat' ? 'good' : result.status === 'viol' ? 'bad' : null;
    if (!kind) return;
    const rel = data.relations.find(r => r.id === result.id);
    if (!rel) return;
    rel.students.forEach(id => {
      const deskId = deskOf[id];
      if (deskId) (dots[deskId] = dots[deskId] || []).push(kind);
    });
  });
  return dots;
}

/* ── Panell de relacions ─────────────────────────────── */

function relationSets(type) {
  return getData().relations.filter(r => r.type === type);
}

function renderRelationsPanel() {
  const data = getData();
  const evaluation = evaluateRelations(data);
  const statusById = new Map(evaluation.results.map(r => [r.id, r]));
  const nameOf = id => data.students.find(s => s.id === id)?.name || '?';

  [REL_TOGETHER, REL_SEPARATE].forEach(type => {
    const container = el(type === REL_TOGETHER ? 'relTogetherSets' : 'relSeparateSets');
    const sets = relationSets(type);
    container.innerHTML = sets.length ? sets.map((rel, index) => {
      const result = statusById.get(rel.id) || { status: 'pend', message: '' };
      const icon = result.status === 'sat' ? 'check_circle' : result.status === 'viol' ? 'cancel' : 'pending';
      const options = data.students
        .filter(s => !rel.students.includes(s.id))
        .map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
      const tags = rel.students.length
        ? rel.students.map(id => `<span class="cset-tag">${esc(nameOf(id))}<button title="Treure" onclick="relRemoveStudent('${esc(rel.id)}','${esc(id)}')">&times;</button></span>`).join('')
        : '<span class="cset-empty">Encara sense alumnes</span>';
      return `<div class="cset ${result.status}">
        <div class="cset-header">
          <span class="cset-name">${REL_LABEL[type]} ${index + 1}</span>
          <span class="mi mi-sm cset-status ${result.status}" title="${esc(result.message)}">${icon}</span>
          <button class="btn btn-sm btn-danger" style="padding:2px 5px" title="Eliminar conjunt" onclick="relRemoveSet('${esc(rel.id)}')"><span class="mi mi-xs">close</span></button>
        </div>
        <select onchange="relAddStudent('${esc(rel.id)}',this.value);this.value=''">
          <option value="">Afegir alumne...</option>${options}
        </select>
        <div class="cset-actions">
          <button class="btn btn-sm" onclick="relAddMultiple('${esc(rel.id)}')"><span class="mi mi-xs">checklist</span> Diversos</button>
        </div>
        <div class="cset-tags">${tags}</div>
      </div>`;
    }).join('') : '<div class="cset-empty">Cap conjunt</div>';
  });

  renderRelationScore(evaluation);
}

/** Insígnia de la barra d'eines i barra de progrés del panell. */
function renderRelationScore(evaluation) {
  const data = getData();
  const summary = el('relScoreSummary');
  const toolbar = el('toolbarScore');
  if (!data.relations.length) { toolbar.innerHTML = ''; summary.innerHTML = ''; return; }

  const ev = evaluation || evaluateRelations(data);
  if (ev.pct === null) {
    toolbar.innerHTML = '<span class="score-badge medium">Sense avaluar</span>';
    summary.innerHTML = `<div class="compat-score-bar"><strong style="font-size:11px;color:var(--text2)">Assigna alumnes als pupitres per avaluar les relacions.</strong></div>`;
    return;
  }
  const level = ev.pct >= 90 ? 'good' : ev.pct >= 50 ? 'medium' : 'bad';
  const badge = `<span class="score-badge ${level}">${ev.pct}% (${ev.satisfied}/${ev.satisfied + ev.violated})</span>`;
  const color = level === 'good' ? 'var(--green)' : level === 'medium' ? 'var(--orange)' : 'var(--red)';
  toolbar.innerHTML = badge;
  summary.innerHTML = `<div class="compat-score-bar">
      <strong style="font-size:11px;color:var(--text2)">Relacions acomplides:</strong> ${badge}
      <div class="bar-track"><div class="bar-fill" style="width:${ev.pct}%;background:${color}"></div></div>
      ${ev.pending ? `<div style="font-size:10px;color:var(--text3);margin-top:6px">${pluralize(ev.pending, 'conjunt', 'conjunts')} pendents d'assignar</div>` : ''}
    </div>`;
}

function relAddSet(type) {
  const data = getData();
  saveWithUndo();
  data.relations.push({ id: uid('rel'), type, students: [] });
  saveState();
  renderRelationsPanel();
}

function relRemoveSet(id) {
  const data = getData();
  saveWithUndo();
  data.relations = data.relations.filter(r => r.id !== id);
  saveState();
  renderRelationsPanel();
  renderDesks();
}

function relAddStudent(setId, studentId) {
  if (!studentId) return;
  const rel = getData().relations.find(r => r.id === setId);
  if (!rel || rel.students.includes(studentId)) return;
  saveWithUndo();
  rel.students.push(studentId);
  saveState();
  renderRelationsPanel();
  renderDesks();
}

function relRemoveStudent(setId, studentId) {
  const rel = getData().relations.find(r => r.id === setId);
  if (!rel) return;
  saveWithUndo();
  rel.students = rel.students.filter(id => id !== studentId);
  saveState();
  renderRelationsPanel();
  renderDesks();
}

/** Afegeix diversos alumnes de cop a un conjunt. */
function relAddMultiple(setId) {
  const data = getData();
  const rel = data.relations.find(r => r.id === setId);
  if (!rel) return;
  if (!data.students.length) { toast('Afegeix alumnes primer', 'error'); return; }
  openStudentPicker({
    title: `${REL_LABEL[rel.type]} — triar alumnes`,
    students: data.students,
    preselected: rel.students,
    confirmLabel: 'Aplicar',
    onConfirm: ids => {
      saveWithUndo();
      rel.students = data.students.filter(s => ids.includes(s.id)).map(s => s.id);
      saveState();
      renderRelationsPanel();
      renderDesks();
      toast(`${REL_LABEL[rel.type]}: ${pluralize(rel.students.length, 'alumne')}`, 'success');
    }
  });
}

/** Crea un conjunt nou triant-hi diversos alumnes de cop. */
function relAddSetWithStudents(type) {
  const data = getData();
  if (!data.students.length) { toast('Afegeix alumnes primer', 'error'); return; }
  openStudentPicker({
    title: `Nou conjunt per ${type === REL_TOGETHER ? 'ajuntar' : 'separar'}`,
    students: data.students,
    confirmLabel: 'Crear conjunt',
    onConfirm: ids => {
      if (ids.length < 2) { toast('Tria com a mínim dos alumnes', 'error'); return; }
      saveWithUndo();
      data.relations.push({ id: uid('rel'), type, students: data.students.filter(s => ids.includes(s.id)).map(s => s.id) });
      saveState();
      renderRelationsPanel();
      renderDesks();
      toast(`Conjunt creat amb ${pluralize(ids.length, 'alumne')}`, 'success');
    }
  });
}

/** Treu un alumne de totes les relacions (en eliminar-lo del grup). */
function removeStudentFromRelations(data, studentId) {
  data.relations.forEach(rel => { rel.students = rel.students.filter(id => id !== studentId); });
  data.relations = data.relations.filter(rel => rel.students.length > 0);
}
