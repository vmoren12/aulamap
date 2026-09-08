/**
 * AulaMap — Perfils (grups) i configuracions
 * Cada perfil pot tenir diverses configuracions d'aula independents.
 */
'use strict';

function currentDocentName() { return state.docents[state.currentDocent]; }
function currentDocentEntry() { return state.configs[currentDocentName()]; }
function currentConfigName() {
  const entry = currentDocentEntry();
  return entry.configurations[entry.currentConfig].name;
}

function renderDocentSelect() {
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
  state.currentDocent = +el('docentSelect').value;
  saveState();
  renderAll();
}

function switchConfig() {
  currentDocentEntry().currentConfig = +el('configSelect').value;
  saveState();
  renderAll();
}

function showAddDocent() {
  openModal(`<h3><span class="mi">group_add</span> Nou grup</h3>
    <div class="field"><label>Nom</label><input type="text" id="newDocentName"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Cancel·lar</button>
      <button class="btn btn-primary" onclick="addDocent()">Afegir</button>
    </div>`);
  focusModalField('newDocentName');
}

function addDocent() {
  const name = el('newDocentName')?.value.trim();
  if (!name) return;
  if (state.docents.includes(name)) { toast('Aquest grup ja existeix', 'error'); return; }
  pushUndo();
  state.docents.push(name);
  state.configs[name] = { configurations: [{ name: 'Configuració 1', data: defaultConfigData() }], currentConfig: 0 };
  state.currentDocent = state.docents.length - 1;
  saveState();
  closeModal();
  renderAll();
  toast(`"${name}" afegit`, 'success');
}

function removeDocent() {
  if (state.docents.length <= 1) { toast('Cal com a mínim un grup', 'error'); return; }
  const name = currentDocentName();
  appConfirm(`Eliminar "${name}"?`, 'Es perdran totes les configuracions d\'aquest grup.', () => {
    pushUndo();
    state.docents.splice(state.currentDocent, 1);
    delete state.configs[name];
    state.currentDocent = 0;
    saveState();
    renderAll();
  });
}

function showEditDocent() {
  openModal(`<h3><span class="mi">edit</span> Editar grup</h3>
    <div class="field"><label>Nom</label><input type="text" id="editDocentName" value="${esc(currentDocentName())}"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Cancel·lar</button>
      <button class="btn btn-primary" onclick="saveEditDocent()">Desar</button>
    </div>`);
  focusModalField('editDocentName');
}

function saveEditDocent() {
  const name = el('editDocentName')?.value.trim();
  const previous = currentDocentName();
  if (!name) return;
  if (name === previous) { closeModal(); return; }
  if (state.docents.includes(name)) { toast('Ja hi ha un grup amb aquest nom', 'error'); return; }
  pushUndo();
  state.docents[state.currentDocent] = name;
  state.configs[name] = state.configs[previous];
  delete state.configs[previous];
  saveState();
  closeModal();
  renderDocentSelect();
  toast('Nom actualitzat', 'success');
}

function showAddConfig() {
  openModal(`<h3><span class="mi">note_add</span> Nova configuració</h3>
    <div class="field"><label>Nom</label><input type="text" id="newConfigName"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Cancel·lar</button>
      <button class="btn btn-primary" onclick="addConfig()">Crear</button>
    </div>`);
  focusModalField('newConfigName');
}

function addConfig() {
  const name = el('newConfigName')?.value.trim();
  if (!name) return;
  pushUndo();
  const entry = currentDocentEntry();
  entry.configurations.push({ name, data: defaultConfigData() });
  entry.currentConfig = entry.configurations.length - 1;
  saveState();
  closeModal();
  renderAll();
  toast(`"${name}" creada`, 'success');
}

function removeConfig() {
  const entry = currentDocentEntry();
  if (entry.configurations.length <= 1) { toast('Cal com a mínim una configuració', 'error'); return; }
  const name = currentConfigName();
  appConfirm(`Eliminar "${name}"?`, 'Es perdrà aquesta configuració.', () => {
    pushUndo();
    entry.configurations.splice(entry.currentConfig, 1);
    entry.currentConfig = 0;
    saveState();
    renderAll();
  });
}

function showEditConfig() {
  openModal(`<h3><span class="mi">edit</span> Editar configuració</h3>
    <div class="field"><label>Nom</label><input type="text" id="editConfigName" value="${esc(currentConfigName())}"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Cancel·lar</button>
      <button class="btn btn-primary" onclick="saveEditConfig()">Desar</button>
    </div>`);
  focusModalField('editConfigName');
}

function saveEditConfig() {
  const name = el('editConfigName')?.value.trim();
  if (!name) return;
  pushUndo();
  const entry = currentDocentEntry();
  entry.configurations[entry.currentConfig].name = name;
  saveState();
  closeModal();
  renderConfigSelect();
  toast('Nom actualitzat', 'success');
}
