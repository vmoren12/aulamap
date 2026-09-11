/**
 * AulaMap — Nucli
 *
 * Constants, utilitats de DOM, escapament d'HTML, modals, notificacions i el
 * registre d'accions que fa possible la delegació d'esdeveniments.
 *
 * Tot el codi de l'aplicació viu dins de l'espai de noms `window.AulaMap`: cada
 * fitxer és una funció anònima que hi registra el que ha de ser visible des de
 * fora. Aquest fitxer no depèn de cap altre i s'ha de carregar el primer.
 */
window.AulaMap = window.AulaMap || {};
(function (A) {
'use strict';

/* ── Constants ───────────────────────────────────────── */

const APP_VERSION = '5.1.0';

/** Clau d'emmagatzematge actual i claus heretades (migració automàtica). */
const STORAGE_KEY = 'aulamap_v5';
const THEME_KEY = 'aulamap_theme';
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

/** Colors de les illes d'equip al llenç. */
const TEAM_COLORS = ['#6C8EEF','#A78BFA','#4ADE80','#FB923C','#F472B6','#38BDF8','#FBBF24','#2DD4BF','#E879F9','#F87171'];

/** Tipus de relació entre alumnes. */
const REL_TOGETHER = 'together';
const REL_SEPARATE = 'separate';

const REL_LABEL = {
  [REL_TOGETHER]: 'Ajuntar',
  [REL_SEPARATE]: 'Separar'
};

/** Estat compartit de les interaccions del llenç (espai premut, clic suprimit). */
const flags = { spaceHeld: false, suppressClick: false };

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

/* ── Accions i delegació d'esdeveniments ─────────────── */

/**
 * Registre d'accions. L'HTML no crida funcions globals: marca els elements amb
 * `data-action` (clic), `data-change`, `data-input`, `data-dblclick`,
 * `data-keydown` o `data-press` (pointerdown) i aquí es resol el gestor.
 * Els paràmetres viatgen en altres atributs `data-*` (did, sid, idx, type...).
 */
const actionRegistry = Object.create(null);

/** Atribut `data-*` que escolta cada tipus d'esdeveniment. */
const ACTION_EVENTS = {
  click: 'action',
  change: 'change',
  input: 'input',
  dblclick: 'dblclick',
  keydown: 'keydown',
  pointerdown: 'press'
};

/** @param {Object<string,(node:HTMLElement,event:Event)=>void>} map */
function registerActions(map) { Object.assign(actionRegistry, map); }

/** Noms d'acció registrats (útil per a les proves i la depuració). */
function actionNames() { return Object.keys(actionRegistry); }

function runAction(name, node, event) {
  const handler = actionRegistry[name];
  if (!handler) { console.warn('AulaMap: acció no registrada', name); return; }
  handler(node, event);
}

function dispatchAction(attribute, event) {
  const node = event.target?.closest?.(`[data-${attribute}]`);
  if (!node) return;
  runAction(node.dataset[attribute], node, event);
}

/** Connecta un únic gestor per tipus d'esdeveniment a tot el document. */
function initActionDelegation() {
  Object.entries(ACTION_EVENTS).forEach(([type, attribute]) => {
    document.addEventListener(type, event => dispatchAction(attribute, event));
  });
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
let _pendingConfirm = null;

function appConfirm(title, message, onConfirm, confirmLabel = 'Confirmar') {
  _pendingConfirm = onConfirm;
  openModal(`<h3><span class="mi" style="color:var(--orange)">warning</span> ${esc(title)}</h3>
    <p class="modal-note">${esc(message)}</p>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn btn-danger" data-action="confirmYes"><span class="mi mi-xs">check</span> ${esc(confirmLabel)}</button>
    </div>`);
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
    <div class="field picker-search"><input type="text" id="pickerSearch" placeholder="Cerca..." data-input="pickerFilter"></div>
    <div class="picker-bar">
      <button class="btn btn-sm" data-action="pickerSelectAll" data-value="1">Seleccionar tots</button>
      <button class="btn btn-sm" data-action="pickerSelectAll" data-value="">Cap</button>
      <span id="pickerCount" style="margin-left:auto"></span>
    </div>
    <div class="picker-list" id="pickerList"></div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn btn-primary" data-action="pickerConfirm"><span class="mi mi-xs">check</span> ${esc(confirmLabel)}</button>
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
        <input type="checkbox" ${selected.has(s.id) ? 'checked' : ''} data-change="pickerToggle" data-sid="${esc(s.id)}">
        <span class="av" style="background:${esc(s.color)}">${esc(initialOf(s.name))}</span>
        <span>${esc(s.name)}</span></label>`).join('')
    : '<div class="cset-empty">Cap coincidència</div>';
  el('pickerCount').textContent = `${selected.size} seleccionats`;
}

registerActions({
  closeModal: () => closeModal(),
  confirmYes: () => {
    const callback = _pendingConfirm;
    _pendingConfirm = null;
    closeModal();
    if (callback) callback();
  },
  pickerFilter: node => {
    if (!_pickerState) return;
    _pickerState.query = node.value.toLowerCase();
    pickerRender();
  },
  pickerToggle: node => {
    if (!_pickerState) return;
    if (node.checked) _pickerState.selected.add(node.dataset.sid);
    else _pickerState.selected.delete(node.dataset.sid);
    el('pickerCount').textContent = `${_pickerState.selected.size} seleccionats`;
  },
  pickerSelectAll: node => {
    if (!_pickerState) return;
    const all = !!node.dataset.value;
    const { students, selected, query } = _pickerState;
    students.filter(s => s.name.toLowerCase().includes(query))
            .forEach(s => all ? selected.add(s.id) : selected.delete(s.id));
    pickerRender();
  },
  pickerConfirm: () => {
    if (!_pickerState) return;
    const { selected, onConfirm } = _pickerState;
    closeModal();
    const ids = [...selected];
    _pickerState = null;
    onConfirm(ids);
  }
});

Object.assign(A, {
  APP_VERSION, STORAGE_KEY, THEME_KEY, LEGACY_KEYS, DESK_W, DESK_H, COLORS, TEAM_COLORS,
  REL_TOGETHER, REL_SEPARATE, REL_LABEL, flags,
  el, esc, uid, isMobile, initialOf, pluralize,
  registerActions, runAction, actionNames, initActionDelegation,
  openModal, closeModal, isModalOpen, focusModalField, toast, appConfirm, openStudentPicker
});

})(window.AulaMap);
