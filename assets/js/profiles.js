/**
 * AulaMap — Perfils (grups) i configuracions
 * Cada perfil pot tenir diverses configuracions d'aula independents.
 */
(function (A) {
'use strict';

const { el, esc, toast, openModal, closeModal, focusModalField, appConfirm } = A;

function currentDocentName() { return A.getState().docents[A.getState().currentDocent]; }
function currentDocentEntry() { return A.getState().configs[currentDocentName()]; }
function currentConfigName() {
  const entry = currentDocentEntry();
  return entry.configurations[entry.currentConfig].name;
}

function renderDocentSelect() {
  const state = A.getState();
  el('docentSelect').innerHTML = state.docents
    .map((name, index) => `<option value="${index}"${index === state.currentDocent ? ' selected' : ''}>${esc(name)}</option>`)
    .join('');
}

function renderConfigSelect() {
  const entry = currentDocentEntry();
  el('configSelect').innerHTML = entry.configurations
    .map((cfg, index) => `<option value="${index}"${index === entry.currentConfig ? ' selected' : ''}>${esc(cfg.name)}</option>`)
    .join('');
}

function switchDocent() {
  A.getState().currentDocent = +el('docentSelect').value;
  A.saveState();
  A.renderAll();
}

function switchConfig() {
  currentDocentEntry().currentConfig = +el('configSelect').value;
  A.saveState();
  A.renderAll();
}

function showAddDocent() {
  openModal(`<h3><span class="mi">group_add</span> Nou grup</h3>
    <div class="field"><label>Nom</label><input type="text" id="newDocentName"></div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn btn-primary" data-action="addDocent">Afegir</button>
    </div>`);
  focusModalField('newDocentName');
}

function addDocent() {
  const state = A.getState();
  const name = el('newDocentName')?.value.trim();
  if (!name) return;
  if (state.docents.includes(name)) { toast('Aquest grup ja existeix', 'error'); return; }
  A.pushUndo();
  state.docents.push(name);
  state.configs[name] = { configurations: [{ name: 'Configuració 1', data: A.defaultConfigData() }], currentConfig: 0 };
  state.currentDocent = state.docents.length - 1;
  A.saveState();
  closeModal();
  A.renderAll();
  toast(`"${name}" afegit`, 'success');
}

function removeDocent() {
  const state = A.getState();
  if (state.docents.length <= 1) { toast('Cal com a mínim un grup', 'error'); return; }
  const name = currentDocentName();
  appConfirm(`Eliminar "${name}"?`, 'Es perdran totes les configuracions d\'aquest grup.', () => {
    A.pushUndo();
    state.docents.splice(state.currentDocent, 1);
    delete state.configs[name];
    state.currentDocent = 0;
    A.saveState();
    A.renderAll();
  });
}

function showEditDocent() {
  openModal(`<h3><span class="mi">edit</span> Editar grup</h3>
    <div class="field"><label>Nom</label><input type="text" id="editDocentName" value="${esc(currentDocentName())}"></div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn btn-primary" data-action="saveEditDocent">Desar</button>
    </div>`);
  focusModalField('editDocentName');
}

function saveEditDocent() {
  const state = A.getState();
  const name = el('editDocentName')?.value.trim();
  const previous = currentDocentName();
  if (!name) return;
  if (name === previous) { closeModal(); return; }
  if (state.docents.includes(name)) { toast('Ja hi ha un grup amb aquest nom', 'error'); return; }
  A.pushUndo();
  state.docents[state.currentDocent] = name;
  state.configs[name] = state.configs[previous];
  delete state.configs[previous];
  A.saveState();
  closeModal();
  renderDocentSelect();
  toast('Nom actualitzat', 'success');
}

/* ── Configuracions noves amb alumnat heretat ────────── */

/**
 * Totes les configuracions de tots els grups, per triar d'on surt l'alumnat.
 * El valor de cada opció és "índex de grup:índex de configuració".
 */
function studentSourceOptions() {
  const state = A.getState();
  return state.docents.map((docent, docentIndex) => {
    const entry = state.configs[docent];
    const options = entry.configurations.map((cfg, configIndex) => {
      const current = docentIndex === state.currentDocent && configIndex === entry.currentConfig;
      return {
        value: `${docentIndex}:${configIndex}`,
        label: `${cfg.name} — ${A.pluralize(cfg.data.students.length, 'alumne')}${current ? ' · actual' : ''}`,
        current,
        empty: !cfg.data.students.length
      };
    });
    return { docent, options };
  });
}

/** Alumnat, nivells i preferències d'una altra configuració. La resta no es copia. */
function copyStudentsInto(data, source) {
  if (!source) return 0;
  const [docentIndex, configIndex] = String(source).split(':').map(Number);
  const state = A.getState();
  const origin = state.configs[state.docents[docentIndex]]?.configurations[configIndex]?.data;
  if (!origin || !origin.students.length) return 0;

  const idMap = new Map();
  origin.students.forEach((student, index) => {
    const copy = A.makeStudent(student.name, index, student.color);
    idMap.set(student.id, copy.id);
    data.students.push(copy);
    const level = origin.teams.competencies[student.id];
    if (typeof level === 'number') data.teams.competencies[copy.id] = level;
  });
  data.teams.useCompetency = !!origin.teams.useCompetency && Object.keys(data.teams.competencies).length > 0;

  const preferences = origin.teams.preferences;
  if (preferences) {
    const prefs = {};
    Object.entries(preferences.prefs).forEach(([studentId, list]) => {
      const owner = idMap.get(studentId);
      const choices = list.map(id => idMap.get(id)).filter(Boolean);
      if (owner && choices.length) prefs[owner] = choices;
    });
    if (Object.keys(prefs).length) {
      data.teams.preferences = {
        updated: preferences.updated, source: preferences.source,
        ranked: preferences.ranked !== false, prefs, unresolved: [...preferences.unresolved], best: null
      };
    }
  }
  return data.students.length;
}

function showAddConfig() {
  const groups = studentSourceOptions();
  const optionsHtml = groups.map(group => `<optgroup label="${esc(group.docent)}">${
    group.options.map(option => `<option value="${esc(option.value)}"${option.current ? ' selected' : ''}${option.empty ? ' disabled' : ''}>${esc(option.label)}</option>`).join('')
  }</optgroup>`).join('');
  openModal(`<h3><span class="mi">note_add</span> Nova configuració</h3>
    <div class="field"><label>Nom</label><input type="text" id="newConfigName"></div>
    <div class="field"><label>Alumnat</label>
      <select id="newConfigStudents">
        <option value="">Començar sense alumnes</option>
        ${optionsHtml}
      </select></div>
    <p class="modal-note">Se'n copien els noms, els nivells de competència i les preferències.
      La distribució de l'aula, les relacions i els equips comencen de zero.</p>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn btn-primary" data-action="addConfig">Crear</button>
    </div>`);
  focusModalField('newConfigName');
}

function addConfig() {
  const name = el('newConfigName')?.value.trim();
  if (!name) return;
  const source = el('newConfigStudents')?.value || '';
  A.pushUndo();
  const entry = currentDocentEntry();
  const data = A.defaultConfigData();
  const copied = copyStudentsInto(data, source);
  entry.configurations.push({ name, data });
  entry.currentConfig = entry.configurations.length - 1;
  A.saveState();
  closeModal();
  A.renderAll();
  toast(`"${name}" creada${copied ? ` amb ${A.pluralize(copied, 'alumne')}` : ''}`, 'success');
}

function removeConfig() {
  const entry = currentDocentEntry();
  if (entry.configurations.length <= 1) { toast('Cal com a mínim una configuració', 'error'); return; }
  const name = currentConfigName();
  appConfirm(`Eliminar "${name}"?`, 'Es perdrà aquesta configuració.', () => {
    A.pushUndo();
    entry.configurations.splice(entry.currentConfig, 1);
    entry.currentConfig = 0;
    A.saveState();
    A.renderAll();
  });
}

function showEditConfig() {
  openModal(`<h3><span class="mi">edit</span> Editar configuració</h3>
    <div class="field"><label>Nom</label><input type="text" id="editConfigName" value="${esc(currentConfigName())}"></div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn btn-primary" data-action="saveEditConfig">Desar</button>
    </div>`);
  focusModalField('editConfigName');
}

function saveEditConfig() {
  const name = el('editConfigName')?.value.trim();
  if (!name) return;
  A.pushUndo();
  const entry = currentDocentEntry();
  entry.configurations[entry.currentConfig].name = name;
  A.saveState();
  closeModal();
  renderConfigSelect();
  toast('Nom actualitzat', 'success');
}

A.registerActions({
  switchDocent, switchConfig,
  showAddDocent, addDocent, removeDocent, showEditDocent, saveEditDocent,
  showAddConfig, addConfig, removeConfig, showEditConfig, saveEditConfig
});

Object.assign(A, {
  currentDocentName, currentDocentEntry, currentConfigName, renderDocentSelect, renderConfigSelect,
  studentSourceOptions, copyStudentsInto, addConfig
});

})(window.AulaMap);
