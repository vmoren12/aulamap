/**
 * AulaMap — Alumnes
 * Alta, edició, eliminació, altes massives i importació des d'un altre perfil.
 */
(function (A) {
'use strict';

const { el, esc, uid, toast, openModal, closeModal, focusModalField, pluralize, initialOf, COLORS } = A;

/** Crea un alumne nou (sense afegir-lo encara a l'estat). */
function makeStudent(name, existingCount, color) {
  return { id: uid('s'), name, color: color || COLORS[existingCount % COLORS.length] };
}

function findStudent(id) { return A.getData().students.find(s => s.id === id) || null; }

function studentName(id) { return findStudent(id)?.name || '?'; }

function studentExists(name) {
  const needle = name.trim().toLowerCase();
  return A.getData().students.some(s => s.name.toLowerCase() === needle);
}

function addStudent() {
  const input = el('newStudentName');
  const name = input.value.trim();
  if (!name) return;
  if (studentExists(name)) { toast('Aquest alumne ja existeix', 'error'); return; }
  const data = A.getData();
  A.saveWithUndo();
  data.students.push(makeStudent(name, data.students.length));
  input.value = '';
  A.saveState();
  renderStudentList();
  A.renderRelationsPanel();
  A.renderTeamsPanel();
  updateCounts();
}

function removeStudent(id) {
  const data = A.getData();
  A.saveWithUndo();
  data.students = data.students.filter(s => s.id !== id);
  A.removeStudentFromRelations(data, id);
  Object.keys(data.assignments).forEach(deskId => {
    if (data.assignments[deskId] === id) { delete data.assignments[deskId]; delete data.lockedDesks[deskId]; }
  });
  A.removeStudentFromTeams(data.teams, id);
  A.saveState();
  A.renderAll();
}

function editStudent(id) {
  const student = findStudent(id);
  if (!student) return;
  openModal(`<h3><span class="mi">edit</span> Editar alumne</h3>
    <div class="field"><label>Nom</label><input type="text" id="editStudentName" value="${esc(student.name)}"></div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn btn-primary" data-action="saveStudent" data-sid="${esc(id)}">Desar</button>
    </div>`);
  focusModalField('editStudentName');
}

function saveStudent(id) {
  const name = el('editStudentName')?.value.trim();
  if (!name) return;
  const student = findStudent(id);
  if (!student) return;
  if (name.toLowerCase() !== student.name.toLowerCase() && studentExists(name)) {
    toast('Ja hi ha un alumne amb aquest nom', 'error');
    return;
  }
  A.saveWithUndo();
  student.name = name;
  A.saveState();
  closeModal();
  A.renderAll();
}

function showBulkAdd() {
  openModal(`<h3><span class="mi">group_add</span> Afegir múltiples</h3>
    <div class="field"><label>Un nom per línia</label><textarea id="bulkNames" rows="10" style="resize:vertical"></textarea></div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn btn-primary" data-action="bulkAdd">Afegir</button>
    </div>`);
  focusModalField('bulkNames');
}

function bulkAdd() {
  const names = (el('bulkNames')?.value || '').split('\n').map(n => n.trim()).filter(Boolean);
  const data = A.getData();
  A.saveWithUndo();
  let added = 0, skipped = 0;
  names.forEach(name => {
    if (data.students.some(s => s.name.toLowerCase() === name.toLowerCase())) { skipped++; return; }
    data.students.push(makeStudent(name, data.students.length));
    added++;
  });
  A.saveState();
  closeModal();
  renderStudentList();
  A.renderRelationsPanel();
  A.renderTeamsPanel();
  updateCounts();
  toast(`${pluralize(added, 'alumne')} ${added === 1 ? 'afegit' : 'afegits'}${skipped ? ` (${skipped} ja hi eren)` : ''}`, added ? 'success' : 'info');
}

function renderStudentList() {
  const data = A.getData();
  const query = (el('studentSearch')?.value || '').toLowerCase();
  const seated = new Set(Object.values(data.assignments));
  const visible = data.students.filter(s => s.name.toLowerCase().includes(query));

  el('studentList').innerHTML = visible.map(s => `
    <div class="student-item ${seated.has(s.id) ? 'student-seated' : ''}" draggable="true" data-sid="${esc(s.id)}">
      <div class="av" style="background:${esc(s.color)}">${esc(initialOf(s.name))}</div>
      <span class="nm">${esc(s.name)}</span>
      <div class="acts">
        <button title="Editar" data-action="editStudent" data-sid="${esc(s.id)}"><span class="mi mi-xs">edit</span></button>
        <button title="Eliminar" data-action="removeStudent" data-sid="${esc(s.id)}"><span class="mi mi-xs">delete</span></button>
      </div>
    </div>`).join('');

  const counter = el('studentCount');
  if (counter) {
    counter.textContent = data.students.length
      ? (visible.length === data.students.length
          ? pluralize(data.students.length, 'alumne')
          : `${visible.length} de ${pluralize(data.students.length, 'alumne')}`)
      : '';
  }
}

function updateCounts() {
  const data = A.getData();
  el('numAlumnes').value = data.students.length;
  el('numSeated').value = Object.keys(data.assignments).length;
}

/* ── Importació des d'un altre perfil ────────────────── */

function showImportFromProfile() {
  const state = A.getState();
  const others = state.docents.map((name, index) => ({ name, index })).filter(o => o.index !== state.currentDocent);
  if (!others.length) { toast('No hi ha altres perfils', 'error'); return; }
  const rows = others.map(o => {
    const entry = state.configs[o.name];
    const count = entry.configurations[entry.currentConfig].data.students.length;
    return `<div class="student-item" style="cursor:pointer;justify-content:space-between" data-action="importFromProfile" data-idx="${o.index}">
      <div style="display:flex;align-items:center;gap:7px">
        <span class="mi mi-xs" style="color:var(--accent)">account_circle</span><span class="nm">${esc(o.name)}</span>
      </div>
      <span style="font-size:10px;color:var(--text3)">${pluralize(count, 'alumne')}</span>
    </div>`;
  }).join('');
  openModal(`<h3><span class="mi">people</span> Importar alumnes d'un perfil</h3>
    <p class="modal-note">Els noms repetits s'ometran.</p>
    <div class="modal-list">${rows}</div>
    <div class="modal-footer"><button class="btn" data-action="closeModal">Cancel·lar</button></div>`);
}

function importFromProfile(profileIndex) {
  const state = A.getState();
  const sourceName = state.docents[profileIndex];
  const entry = state.configs[sourceName];
  const source = entry.configurations[entry.currentConfig].data;
  if (!source.students.length) { toast('Aquest perfil no té alumnes', 'error'); return; }

  const data = A.getData();
  A.saveWithUndo();
  let added = 0, skipped = 0;
  source.students.forEach(s => {
    if (data.students.some(x => x.name.toLowerCase() === s.name.toLowerCase())) { skipped++; return; }
    data.students.push(makeStudent(s.name, data.students.length, s.color));
    added++;
  });
  A.saveState();
  closeModal();
  renderStudentList();
  A.renderRelationsPanel();
  A.renderTeamsPanel();
  updateCounts();
  toast(`${pluralize(added, 'alumne')} de "${sourceName}"${skipped ? ` (${skipped} ja hi eren)` : ''}`, added ? 'success' : 'info');
}

A.registerActions({
  addStudent: () => addStudent(),
  addStudentOnEnter: (node, event) => { if (event.key === 'Enter') addStudent(); },
  editStudent: node => editStudent(node.dataset.sid),
  saveStudent: node => saveStudent(node.dataset.sid),
  removeStudent: node => removeStudent(node.dataset.sid),
  showBulkAdd: () => showBulkAdd(),
  bulkAdd: () => bulkAdd(),
  renderStudentList: () => renderStudentList(),
  showImportFromProfile: () => showImportFromProfile(),
  importFromProfile: node => importFromProfile(+node.dataset.idx)
});

Object.assign(A, {
  makeStudent, findStudent, studentName, studentExists,
  addStudent, removeStudent, renderStudentList, updateCounts
});

})(window.AulaMap);
