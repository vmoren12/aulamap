/**
 * AulaMap — Nucli
 * Constants, utilitats de DOM, escapament d'HTML, modals i notificacions.
 * Aquest fitxer no depèn de cap altre i s'ha de carregar el primer.
 */
'use strict';

/* ── Constants ───────────────────────────────────────── */

const APP_VERSION = '5.0.0';

/** Clau d'emmagatzematge actual i claus heretades (migració automàtica). */
const STORAGE_KEY = 'aulamap_v5';
const LEGACY_KEYS = {
  state: 'aulamap_v4',
  teams: 'aulamap_equips_v1',
  positions: 'aulamap_team_positions'
};

/** Mides d'un pupitre, en píxels del llenç. */
const DESK_W = 100;
const DESK_H = 64;

/** Paleta d'avatars d'alumne. */
const COLORS = ['#6C8EEF','#A78BFA','#F472B6','#FB923C','#FBBF24','#4ADE80','#2DD4BF','#38BDF8',
                '#E879F9','#F87171','#818CF8','#34D399','#FB7185','#A3E635','#C084FC'];

/** Colors de les taules d'equip al llenç. */
const TEAM_COLORS = ['#6C8EEF','#A78BFA','#4ADE80','#FB923C','#F472B6','#38BDF8','#FBBF24','#2DD4BF','#E879F9','#F87171'];

/** Tipus de relació entre alumnes. */
const REL_TOGETHER = 'together';
const REL_SEPARATE = 'separate';

const REL_LABEL = {
  [REL_TOGETHER]: 'Ajuntar',
  [REL_SEPARATE]: 'Separar'
};

/* ── Utilitats de DOM ────────────────────────────────── */

/** @returns {HTMLElement|null} */
function el(id) { return document.getElementById(id); }

/** Escapa text per inserir-lo dins d'HTML o d'un atribut. */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Identificador únic i llegible. */
let _uidCounter = 0;
function uid(prefix) {
  _uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${_uidCounter.toString(36)}`;
}

function isMobile() { return window.innerWidth <= 768; }

/** Inicial en majúscula d'un nom (segura amb noms buits). */
function initialOf(name) {
  const n = String(name || '?').trim();
  return (n[0] || '?').toUpperCase();
}

/** Plural simple: pluralize(2,'alumne') → "2 alumnes". */
function pluralize(n, singular, plural) {
  return `${n} ${n === 1 ? singular : (plural || singular + 's')}`;
}

/* ── Modals i notificacions ──────────────────────────── */

function openModal(html) {
  el('modalContent').innerHTML = html;
  el('modalOverlay').classList.add('active');
}

function closeModal() {
  el('modalOverlay').classList.remove('active');
}

function isModalOpen() {
  return el('modalOverlay').classList.contains('active');
}

/** Enfoca el primer camp del modal un cop pintat. */
function focusModalField(id) {
  requestAnimationFrame(() => {
    const field = el(id);
    if (field) { field.focus(); if (field.select) field.select(); }
  });
}

/**
 * Missatge efímer.
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 */
function toast(message, type = 'info') {
  const icon = type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info';
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `<span class="mi mi-xs">${icon}</span> ${esc(message)}`;
  el('toastContainer').appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 300);
  }, 3000);
}

/** Confirmació modal amb títol, detall i acció. */
function appConfirm(title, message, onConfirm) {
  openModal(`<h3><span class="mi" style="color:var(--orange)">warning</span> ${esc(title)}</h3>
    <p style="font-size:12px;color:var(--text2);margin-bottom:4px;line-height:1.5">${esc(message)}</p>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Cancel·lar</button>
      <button class="btn btn-danger" id="confirmYesBtn"><span class="mi mi-xs">check</span> Confirmar</button>
    </div>`);
  requestAnimationFrame(() => {
    const btn = el('confirmYesBtn');
    if (btn) btn.onclick = () => { closeModal(); onConfirm(); };
  });
}

/* ── Selector múltiple d'alumnes ─────────────────────── */

let _pickerState = null;

/**
 * Obre un selector amb caselles per triar diversos alumnes de cop.
 * @param {{title:string, students:Array<{id:string,name:string,color:string}>,
 *          preselected?:string[], confirmLabel?:string, onConfirm:(ids:string[])=>void}} options
 */
function openStudentPicker({ title, students, preselected = [], confirmLabel = 'Afegir', onConfirm }) {
  if (!students.length) { toast('No hi ha alumnes disponibles', 'error'); return; }
  _pickerState = { students, selected: new Set(preselected), onConfirm, query: '' };
  openModal(`<h3><span class="mi">checklist</span> ${esc(title)}</h3>
    <div class="field picker-search"><input type="text" id="pickerSearch" placeholder="Cerca..." oninput="pickerFilter(this.value)"></div>
    <div class="picker-bar">
      <button class="btn btn-sm" onclick="pickerSelectAll(true)">Seleccionar tots</button>
      <button class="btn btn-sm" onclick="pickerSelectAll(false)">Cap</button>
      <span id="pickerCount" style="margin-left:auto"></span>
    </div>
    <div class="picker-list" id="pickerList"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Cancel·lar</button>
      <button class="btn btn-primary" onclick="pickerConfirm()"><span class="mi mi-xs">check</span> ${esc(confirmLabel)}</button>
    </div>`);
  pickerRender();
  focusModalField('pickerSearch');
}

function pickerRender() {
  if (!_pickerState) return;
  const { students, selected, query } = _pickerState;
  const visible = students.filter(s => s.name.toLowerCase().includes(query));
  el('pickerList').innerHTML = visible.length
    ? visible.map(s => `<label class="picker-item">
        <input type="checkbox" ${selected.has(s.id) ? 'checked' : ''} onchange="pickerToggle('${esc(s.id)}',this.checked)">
        <span class="av" style="background:${esc(s.color)}">${esc(initialOf(s.name))}</span>
        <span>${esc(s.name)}</span></label>`).join('')
    : '<div class="cset-empty">Cap coincidència</div>';
  el('pickerCount').textContent = `${selected.size} seleccionats`;
}

function pickerFilter(value) {
  if (!_pickerState) return;
  _pickerState.query = value.toLowerCase();
  pickerRender();
}

function pickerToggle(id, checked) {
  if (!_pickerState) return;
  if (checked) _pickerState.selected.add(id); else _pickerState.selected.delete(id);
  el('pickerCount').textContent = `${_pickerState.selected.size} seleccionats`;
}

function pickerSelectAll(all) {
  if (!_pickerState) return;
  const { students, selected, query } = _pickerState;
  students.filter(s => s.name.toLowerCase().includes(query))
          .forEach(s => all ? selected.add(s.id) : selected.delete(s.id));
  pickerRender();
}

function pickerConfirm() {
  if (!_pickerState) return;
  const { selected, onConfirm } = _pickerState;
  closeModal();
  const ids = [...selected];
  _pickerState = null;
  onConfirm(ids);
}
