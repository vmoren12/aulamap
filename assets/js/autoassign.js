/**
 * AulaMap — Assignació automàtica de llocs
 *
 * Cerca una distribució que compleixi el màxim de relacions "ajuntar" i
 * "separar" amb recuita simulada (simulated annealing) i un refinament final
 * per intercanvis. Els pupitres fixats amb cadenat no es toquen mai.
 */
(function (A) {
'use strict';

const { el, toast, pluralize, openModal, closeModal, REL_SEPARATE } = A;

/** Pesos de la funció objectiu (com més alt, més prioritari). */
const SCORE = {
  togetherEdge: 6,      // cada parella del conjunt que seu a tocar
  togetherConnected: 12, // bonificació si tot el conjunt forma un bloc
  togetherIsolated: -8,  // membre del conjunt sense cap company al costat
  togetherUnseated: -4,  // membre del conjunt sense lloc
  separateAdjacent: -25, // parella que hauria d'estar separada i seu a tocar
  separateApart: 4       // parella correctament separada
};

const ANNEAL_PASSES = 6;

function showAutoAssign() {
  const data = A.getData();
  if (!data.students.length) { toast('Afegeix alumnes', 'error'); return; }
  if (!data.desks.length) { toast('Configura la distribució', 'error'); return; }

  const lockedCount = Object.keys(data.lockedDesks).filter(k => data.assignments[k]).length;
  const lockInfo = lockedCount ? `<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--orange-bg);border:1px solid var(--orange);border-radius:var(--radius-sm);margin-bottom:12px;font-size:12px;color:var(--orange)">
      <span class="mi mi-sm">lock</span> ${pluralize(lockedCount, 'alumne')} ${lockedCount === 1 ? 'fixat' : 'fixats'}: no es ${lockedCount === 1 ? 'mourà' : 'mouran'}.</div>` : '';
  const relInfo = data.relations.length
    ? `<p class="modal-note">S'optimitzaran ${pluralize(data.relations.length, 'conjunt', 'conjunts')} de relacions (ajuntar/separar).</p>`
    : `<p class="modal-note">No hi ha relacions definides: els alumnes es repartiran a l'atzar.</p>`;

  openModal(`<h3><span class="mi">auto_awesome</span> Assignació automàtica</h3>
    ${relInfo}${lockInfo}
    <div class="field"><label>Intensitat</label>
      <select id="autoIterations">
        <option value="1000">Ràpid</option>
        <option value="5000" selected>Normal</option>
        <option value="20000">Intensiu</option>
        <option value="50000">Màxim</option>
      </select></div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn btn-primary" data-action="runAutoAssign"><span class="mi mi-xs">rocket_launch</span> Executar</button>
    </div>`);
}

function runAutoAssign() {
  const iterations = +(el('autoIterations')?.value || 5000);
  closeModal();

  const data = A.getData();
  const desks = data.desks;
  if (!data.students.length || !desks.length) return;

  /* Índexs de treball */
  const deskIndex = new Map(desks.map((d, i) => [d.id, i]));
  const studentIndex = new Map(data.students.map((s, i) => [s.id, i]));
  const deskCount = desks.length;

  /* Matriu de veïnatge */
  const graph = A.buildNeighborGraph(desks);
  const adjacent = new Uint8Array(deskCount * deskCount);
  desks.forEach((desk, i) => {
    graph.get(desk.id).forEach(otherId => {
      const j = deskIndex.get(otherId);
      if (j !== undefined) { adjacent[i * deskCount + j] = 1; adjacent[j * deskCount + i] = 1; }
    });
  });

  /* Relacions en format d'índexs + índex invers per alumne */
  const relations = data.relations
    .map(rel => ({ type: rel.type, members: rel.students.map(id => studentIndex.get(id)).filter(i => i !== undefined) }))
    .filter(rel => rel.members.length >= 2);
  const relationsOf = data.students.map(() => []);
  relations.forEach((rel, ri) => rel.members.forEach(m => { if (!relationsOf[m].includes(ri)) relationsOf[m].push(ri); }));

  /* Situació de partida: alumnes i pupitres fixats */
  const studentDesk = new Int32Array(data.students.length).fill(-1);
  const lockedAssignments = {};
  const lockedStudents = new Set();
  Object.keys(data.lockedDesks).forEach(deskId => {
    const studentId = data.assignments[deskId];
    if (!studentId || !deskIndex.has(deskId) || !studentIndex.has(studentId)) return;
    lockedAssignments[deskId] = studentId;
    lockedStudents.add(studentId);
    studentDesk[studentIndex.get(studentId)] = deskIndex.get(deskId);
  });

  const freeDeskIdx = desks.map((d, i) => i).filter(i => !lockedAssignments[desks[i].id]);
  const freeStudentIdx = data.students.map((s, i) => i).filter(i => !lockedStudents.has(data.students[i].id));
  if (!freeDeskIdx.length || !freeStudentIdx.length) { toast('No hi ha res per assignar', 'info'); return; }

  /* Cada "casella" és un pupitre lliure; si hi ha més alumnes que pupitres,
     s'afegeixen caselles virtuals (alumnes que es queden sense lloc). */
  const slotCount = Math.max(freeDeskIdx.length, freeStudentIdx.length);
  const slotDesk = new Int32Array(slotCount).fill(-1);
  freeDeskIdx.forEach((deskIdx, i) => { slotDesk[i] = deskIdx; });

  const scorePartial = (relIdxs, sd) => {
    let total = 0;
    for (const ri of relIdxs) total += scoreRelation(relations[ri], sd, adjacent, deskCount);
    return total;
  };
  const scoreAll = sd => {
    let total = 0;
    for (const rel of relations) total += scoreRelation(rel, sd, adjacent, deskCount);
    return total;
  };

  /** Aplica una assignació de caselles a l'índex alumne→pupitre. */
  const applySlots = (slotStudent, sd) => {
    freeStudentIdx.forEach(i => { sd[i] = -1; });
    for (let slot = 0; slot < slotCount; slot++) {
      const student = slotStudent[slot];
      if (student >= 0) sd[student] = slotDesk[slot];
    }
  };

  let bestSlots = null;
  let bestScore = -Infinity;
  const iterationsPerPass = Math.max(200, Math.ceil(iterations / ANNEAL_PASSES));

  for (let pass = 0; pass < ANNEAL_PASSES; pass++) {
    const slotStudent = new Int32Array(slotCount).fill(-1);
    shuffleArray(freeStudentIdx.slice()).forEach((student, i) => { slotStudent[i] = student; });
    applySlots(slotStudent, studentDesk);

    let current = scoreAll(studentDesk);
    let passBest = Int32Array.from(slotStudent);
    let passBestScore = current;

    for (let it = 0; it < iterationsPerPass; it++) {
      const a = (Math.random() * slotCount) | 0;
      let b = (Math.random() * slotCount) | 0;
      if (a === b) continue;
      const studentA = slotStudent[a];
      const studentB = slotStudent[b];
      if (studentA < 0 && studentB < 0) continue;

      const affected = new Set();
      if (studentA >= 0) relationsOf[studentA].forEach(ri => affected.add(ri));
      if (studentB >= 0) relationsOf[studentB].forEach(ri => affected.add(ri));
      if (!affected.size) continue; // l'intercanvi no afecta cap relació

      const before = scorePartial(affected, studentDesk);
      if (studentA >= 0) studentDesk[studentA] = slotDesk[b];
      if (studentB >= 0) studentDesk[studentB] = slotDesk[a];
      const delta = scorePartial(affected, studentDesk) - before;

      const temperature = 8 * (1 - it / iterationsPerPass) + 0.05;
      if (delta > 0 || Math.random() < Math.exp(delta / temperature)) {
        slotStudent[a] = studentB;
        slotStudent[b] = studentA;
        current += delta;
        if (current > passBestScore) { passBestScore = current; passBest = Int32Array.from(slotStudent); }
      } else {
        if (studentA >= 0) studentDesk[studentA] = slotDesk[a];
        if (studentB >= 0) studentDesk[studentB] = slotDesk[b];
      }
    }

    if (passBestScore > bestScore) { bestScore = passBestScore; bestSlots = passBest; }
  }

  /* Refinament final: intercanvis exhaustius mentre millorin */
  applySlots(bestSlots, studentDesk);
  let improved = true;
  let sweeps = 0;
  while (improved && sweeps < 12) {
    improved = false;
    sweeps++;
    for (let a = 0; a < slotCount; a++) {
      for (let b = a + 1; b < slotCount; b++) {
        const studentA = bestSlots[a], studentB = bestSlots[b];
        if (studentA < 0 && studentB < 0) continue;
        const affected = new Set();
        if (studentA >= 0) relationsOf[studentA].forEach(ri => affected.add(ri));
        if (studentB >= 0) relationsOf[studentB].forEach(ri => affected.add(ri));
        if (!affected.size) continue;
        const before = scorePartial(affected, studentDesk);
        if (studentA >= 0) studentDesk[studentA] = slotDesk[b];
        if (studentB >= 0) studentDesk[studentB] = slotDesk[a];
        const delta = scorePartial(affected, studentDesk) - before;
        if (delta > 0) {
          bestSlots[a] = studentB; bestSlots[b] = studentA;
          bestScore += delta;
          improved = true;
        } else {
          if (studentA >= 0) studentDesk[studentA] = slotDesk[a];
          if (studentB >= 0) studentDesk[studentB] = slotDesk[b];
        }
      }
    }
  }

  /* Escriptura del resultat */
  A.saveWithUndo();
  data.assignments = { ...lockedAssignments };
  for (let slot = 0; slot < slotCount; slot++) {
    const student = bestSlots[slot];
    const deskIdx = slotDesk[slot];
    if (student >= 0 && deskIdx >= 0) data.assignments[desks[deskIdx].id] = data.students[student].id;
  }
  Object.keys(data.lockedDesks).forEach(deskId => { if (!data.assignments[deskId]) delete data.lockedDesks[deskId]; });
  A.saveState();

  A.renderDesks();
  A.renderStudentList();
  A.renderRelationsPanel();
  A.updateCounts();

  const evaluation = A.evaluateRelations(data);
  const lockedCount = Object.keys(lockedAssignments).length;
  const unseated = data.students.length - Object.keys(data.assignments).length;
  const parts = [];
  if (evaluation.pct !== null) parts.push(`relacions: ${evaluation.pct}%`);
  if (lockedCount) parts.push(`${lockedCount} ${lockedCount === 1 ? 'fixat' : 'fixats'}`);
  if (unseated > 0) parts.push(`${unseated} sense lloc`);
  toast(`Assignació completada${parts.length ? ' — ' + parts.join(', ') : ''}`,
        evaluation.violated ? 'info' : 'success');
}

/** Puntuació d'una relació segons la distribució actual. */
function scoreRelation(rel, studentDesk, adjacent, deskCount) {
  const seated = [];
  let unseated = 0;
  for (const member of rel.members) {
    const desk = studentDesk[member];
    if (desk >= 0) seated.push(desk); else unseated++;
  }

  if (rel.type === REL_SEPARATE) {
    let score = 0;
    for (let i = 0; i < seated.length; i++) {
      for (let j = i + 1; j < seated.length; j++) {
        score += adjacent[seated[i] * deskCount + seated[j]] ? SCORE.separateAdjacent : SCORE.separateApart;
      }
    }
    return score;
  }

  let score = unseated * SCORE.togetherUnseated;
  const n = seated.length;
  if (n < 2) return score;

  const degree = new Array(n).fill(0);
  const neighbors = Array.from({ length: n }, () => []);
  let edges = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (adjacent[seated[i] * deskCount + seated[j]]) {
        edges++; degree[i]++; degree[j]++;
        neighbors[i].push(j); neighbors[j].push(i);
      }
    }
  }
  score += edges * SCORE.togetherEdge;
  for (let i = 0; i < n; i++) if (degree[i] === 0) score += SCORE.togetherIsolated;
  if (unseated === 0 && isConnectedGraph(neighbors)) score += SCORE.togetherConnected;
  return score;
}

/** Comprova si una llista d'adjacències forma un únic bloc. */
function isConnectedGraph(neighbors) {
  const n = neighbors.length;
  if (n <= 1) return true;
  const seen = new Uint8Array(n);
  const stack = [0];
  seen[0] = 1;
  let visited = 1;
  while (stack.length) {
    const current = stack.pop();
    for (const next of neighbors[current]) {
      if (!seen[next]) { seen[next] = 1; visited++; stack.push(next); }
    }
  }
  return visited === n;
}

/** Barreja de Fisher-Yates (retorna el mateix array). */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

A.registerActions({
  showAutoAssign: () => showAutoAssign(),
  runAutoAssign: () => runAutoAssign()
});

Object.assign(A, { showAutoAssign, runAutoAssign, scoreRelation, isConnectedGraph, shuffleArray });

})(window.AulaMap);
