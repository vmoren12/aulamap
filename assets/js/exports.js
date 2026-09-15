/**
 * AulaMap — Desar, carregar i exportar
 * Fitxers .json amb la configuració completa, importació i exportació en CSV
 * i exportació de l'aula a PDF.
 */
(function (A) {
'use strict';

const { el, esc, uid, toast, pluralize, openModal, closeModal, focusModalField,
        DESK_W, DESK_H, REL_TOGETHER, REL_SEPARATE } = A;

/** Descàrrega d'un blob amb neteja de l'URL temporal. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileStamp() { return new Date().toISOString().slice(0, 10); }

function saveToFile() {
  const data = A.getData();
  const payload = {
    app: 'AulaMap',
    version: 5,
    exported: new Date().toISOString(),
    docent: A.currentDocentName(),
    config: A.currentConfigName(),
    data
  };
  const name = (data.nivell || data.aula || 'configuracio').replace(/\s+/g, '_');
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
               `aulamap_${name}_${fileStamp()}.json`);
  toast('Fitxer desat', 'success');
}

function loadFromFile() { el('fileInput').click(); }

function handleFileLoad(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const payload = JSON.parse(e.target.result);
      if (!payload?.data?.students) { toast('Format no reconegut', 'error'); return; }
      A.pushUndo();
      const entry = A.currentDocentEntry();
      entry.configurations[entry.currentConfig].data = adoptImportedData(payload);
      A.saveState();
      A.renderAll();
      setTimeout(() => A.zoomReset(), 60);
      toast('Configuració carregada', 'success');
    } catch (error) {
      toast('Error en llegir el fitxer: ' + error.message, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

/** Normalitza les dades importades i converteix el format d'equips antic (per nom). */
function adoptImportedData(payload) {
  const data = A.normalizeConfigData(payload.data);
  const legacy = payload.equips;
  if (legacy) {
    const byName = new Map(data.students.map(s => [s.name.toLowerCase(), s.id]));
    const toId = name => byName.get(String(name).toLowerCase());
    const mapList = list => (list || []).map(toId).filter(Boolean);
    const teams = data.teams;
    Object.entries(legacy.competencies || {}).forEach(([name, value]) => {
      const id = toId(name);
      if (id) teams.competencies[id] = value;
    });
    [REL_TOGETHER, REL_SEPARATE].forEach(type => {
      (legacy.constraints?.[type] || []).forEach(set => {
        const students = mapList(set.students);
        if (students.length) teams.constraints[type].push({ id: uid(type), students });
      });
    });
    teams.saved = (legacy.savedTeams || []).map(t => ({
      id: t.id || uid('team'), name: t.name, date: t.date,
      groups: (t.groups || []).map(mapList), teamNames: t.teamNames || {}, competencies: null
    })).filter(t => t.groups.length);
    if (legacy.studentsPerGroup) teams.studentsPerGroup = legacy.studentsPerGroup;
    teams.useCompetency = !!legacy.enableCompetency;
    teams.heterogeneous = !!legacy.heterogeneous;
    teams.remainderMode = legacy.selectedOption || null;
  }
  return data;
}

/* ── CSV (millora 1.7) ───────────────────────────────── */

const CSV_SEP = ';';

/** Escapa un valor per a CSV (cometes dobles si cal). */
function csvCell(value) {
  const text = String(value ?? '');
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvFrom(rows) {
  return rows.map(row => row.map(csvCell).join(CSV_SEP)).join('\r\n');
}

/** Descarrega un CSV amb marca d'ordre de bytes perquè Excel el llegeixi bé. */
function downloadCsv(rows, filename) {
  downloadBlob(new Blob(['﻿' + csvFrom(rows)], { type: 'text/csv;charset=utf-8' }), filename);
  toast('CSV exportat', 'success');
}

/** Parteix una línia de CSV admetent `;`, `,` o tabulador i cometes dobles. */
function parseCsvLine(line) {
  const separator = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Separador d'un full delimitat: el més freqüent a la primera línia, sense
 * comptar el que hi hagi dins de cometes.
 */
function detectCsvSeparator(text) {
  const counts = { ';': 0, '\t': 0, ',': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === '\n') break;
    if (counts[char] !== undefined) counts[char]++;
  }
  return Object.keys(counts).reduce((best, key) => (counts[key] > counts[best] ? key : best), ';');
}

/**
 * Llegeix un full sencer de text delimitat (CSV, TSV o el que exporta un full
 * de càlcul): detecta el separador, admet cometes dobles amb salts de línia a
 * dins i descarta les files completament buides.
 * @returns {string[][]}
 */
function parseCsvTable(text) {
  const clean = String(text || '').replace(/^﻿/, '');
  if (!clean.trim()) return [];
  const separator = detectCsvSeparator(clean);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === separator) { row.push(cell.trim()); cell = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; continue; }
    cell += char;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter(cells => cells.some(value => value !== ''));
}

function showImportCsv() {
  openModal(`<h3><span class="mi">upload_file</span> Importar alumnat en CSV</h3>
    <p class="modal-note">Una línia per alumne, amb el format <code>nom;nivell</code>. El nivell (0–10) és opcional
      i s'utilitza per als equips heterogenis. També s'accepten fitxers separats per comes o tabuladors.</p>
    <div class="field">
      <label>Fitxer</label>
      <input type="file" id="csvInput" accept=".csv,.txt" data-change="csvFileChosen">
    </div>
    <div class="field"><label>O enganxa-hi les dades</label>
      <textarea id="csvText" rows="8" style="resize:vertical" placeholder="Anna Puig;7&#10;Pau Serra;5"></textarea></div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn btn-primary" data-action="importCsv"><span class="mi mi-xs">check</span> Importar</button>
    </div>`);
  focusModalField('csvText');
}

function csvFileChosen(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { const area = el('csvText'); if (area) area.value = e.target.result; };
  reader.readAsText(file);
}

/** Afegeix els alumnes d'un text CSV; retorna quants se n'han afegit. */
function importCsvText(text) {
  const data = A.getData();
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) { toast('No hi ha dades per importar', 'error'); return; }

  const rows = lines.map(parseCsvLine);
  // Capçalera opcional: es descarta si la primera cel·la no sembla un nom real.
  if (/^(nom|name|alumne|alumnes|estudiant)$/i.test(rows[0][0] || '')) rows.shift();

  A.saveWithUndo();
  let added = 0, skipped = 0, levels = 0;
  rows.forEach(cells => {
    const name = cells[0];
    if (!name) return;
    if (data.students.some(s => s.name.toLowerCase() === name.toLowerCase())) { skipped++; return; }
    const student = A.makeStudent(name, data.students.length);
    data.students.push(student);
    added++;
    const level = parseFloat(String(cells[1] || '').replace(',', '.'));
    if (!isNaN(level)) {
      data.teams.competencies[student.id] = Math.max(0, Math.min(10, level));
      levels++;
    }
  });
  if (levels) data.teams.useCompetency = true;
  A.saveState();
  closeModal();
  A.renderAll();
  toast(`${pluralize(added, 'alumne')} ${added === 1 ? 'importat' : 'importats'}${levels ? ` (${levels} amb nivell)` : ''}${skipped ? ` — ${skipped} ja hi eren` : ''}`,
        added ? 'success' : 'info');
}

function showExportCsv() {
  openModal(`<h3><span class="mi">table_view</span> Exportar en CSV</h3>
    <p class="modal-note">Tria què vols exportar. Els fitxers s'obren directament amb qualsevol full de càlcul.</p>
    <div class="modal-footer" style="flex-wrap:wrap">
      <button class="btn" data-action="closeModal">Cancel·lar</button>
      <button class="btn" data-action="exportStudentsCsv"><span class="mi mi-xs">people</span> Alumnat</button>
      <button class="btn" data-action="exportSeatingCsv"><span class="mi mi-xs">grid_view</span> Distribució</button>
      <button class="btn" data-action="exportTeamsCsv"><span class="mi mi-xs">groups</span> Equips</button>
    </div>`);
}

function exportStudentsCsv() {
  const data = A.getData();
  if (!data.students.length) { toast('No hi ha alumnes', 'error'); return; }
  const rows = [['nom', 'nivell']];
  data.students.forEach(s => rows.push([s.name, A.competencyOf(s.id)]));
  closeModal();
  downloadCsv(rows, `aulamap_alumnat_${fileStamp()}.csv`);
}

function exportSeatingCsv() {
  const data = A.getData();
  if (!data.desks.length) { toast('No hi ha pupitres', 'error'); return; }
  const rows = [['pupitre', 'alumne', 'fixat', 'x', 'y']];
  data.desks.forEach((desk, index) => {
    const studentId = data.assignments[desk.id];
    rows.push([index + 1, studentId ? A.studentName(studentId) : '', data.lockedDesks[desk.id] ? 'sí' : '', desk.x, desk.y]);
  });
  const unseated = data.students.filter(s => !Object.values(data.assignments).includes(s.id));
  unseated.forEach(s => rows.push(['', s.name, '', '', '']));
  closeModal();
  downloadCsv(rows, `aulamap_distribucio_${fileStamp()}.csv`);
}

/**
 * Una fila per alumne amb el seu equip. Si el grup ve d'un full de
 * preferències, cada fila porta també el recompte de tries i separacions i les
 * dades de composició que s'hagin carregat (grup d'origen, sexe, necessitats).
 * @param {{competency?:boolean}} options
 */
function exportTeamsCsv(options = {}) {
  const teams = A.getTeams();
  if (!teams.groups?.length) { toast('No hi ha equips formats', 'error'); return; }
  const preferences = teams.preferences;
  const stats = preferences
    ? A.preferenceStats(teams.groups, preferences.prefs, {
        avoid: preferences.avoid, attributes: preferences.attributes, criterion: preferences.criterion
      })
    : null;
  const withCompetency = options.competency !== false;
  const attributes = (A.ATTRIBUTES || [])
    .filter(attribute => preferences?.attributes?.[attribute.key])
    .map(attribute => ({ key: attribute.key, label: attribute.short.toLowerCase(),
                         values: preferences.attributes[attribute.key] }));

  const header = ['equip', 'alumne'];
  if (withCompetency) header.push('nivell');
  attributes.forEach(attribute => header.push(attribute.label));
  if (stats) {
    header.push('preferencies acomplertes', 'preferencies indicades',
                'separacions demanades', 'separacions sense respectar');
  }

  const rows = [header];
  teams.groups.forEach((group, index) => {
    group.forEach(id => {
      const row = [A.teamName(index), A.studentName(id)];
      if (withCompetency) row.push(A.competencyOf(id));
      attributes.forEach(attribute => row.push(attribute.values[id] || ''));
      const entry = stats && stats.perStudent[id];
      if (stats) {
        row.push(entry?.met ?? 0, entry?.total ?? 0, entry?.avoidTotal ?? 0, entry?.avoidBroken ?? 0);
      }
      rows.push(row);
    });
  });
  closeModal();
  downloadCsv(rows, `aulamap_equips_${fileStamp()}.csv`);
}

/* ── Exportació a PDF ────────────────────────────────── */

async function exportPDF() {
  const data = A.getData();
  if (!data.desks.length) { toast('No hi ha pupitres', 'error'); return; }
  if (typeof html2canvas === 'undefined' || !window.jspdf) {
    toast('Cal connexió per generar el PDF', 'error');
    return;
  }
  toast('Generant PDF...', 'info');

  const minX = Math.min(...data.desks.map(d => d.x));
  const minY = Math.min(...data.desks.map(d => d.y));
  const maxX = Math.max(...data.desks.map(d => d.x + DESK_W));
  const maxY = Math.max(...data.desks.map(d => d.y + DESK_H));
  const originX = minX - 10, originY = minY - 10;
  const width = maxX - minX + 20, height = maxY - minY + 20;

  const area = el('pdfArea');
  area.style.width = (width + 72) + 'px';
  const teacherDesk = '<div style="width:180px;height:36px;border:2px solid #999;border-radius:8px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:10px;font-weight:600;color:#666;background:#eee">Taula del professor/a</div>';
  const desksHtml = data.desks.map((desk, index) => {
    const student = data.assignments[desk.id] ? A.findStudent(data.assignments[desk.id]) : null;
    const locked = !!data.lockedDesks[desk.id] && student;
    const border = student ? (locked ? '#FBBF24' : '#6C8EEF') : '#ccc';
    return `<div style="position:absolute;left:${desk.x - originX}px;top:${desk.y - originY}px;width:100px;height:58px;
        border:2px solid ${border};border-radius:7px;display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-size:10px;background:${student ? '#EEF2FF' : '#f9f9f9'}">
      <div style="font-size:8px;color:#aaa;position:absolute;top:1px;left:4px">${index + 1}</div>
      ${locked ? '<div style="font-size:7px;position:absolute;bottom:1px;left:4px;color:#b8860b">&#128274;</div>' : ''}
      <div style="font-weight:600;text-align:center;max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#333">${esc(student ? student.name : '—')}</div>
    </div>`;
  }).join('');

  const subtitle = [data.curs, data.nivell, data.aula, 'Grup: ' + A.currentDocentName(), A.currentConfigName()]
    .filter(Boolean).map(esc).join(' · ');
  area.innerHTML = `
    <div style="font-size:20px;font-weight:700;margin-bottom:3px;text-align:center">${esc(data.centreName || 'AulaMap')}</div>
    <div style="font-size:12px;color:#666;margin-bottom:16px;text-align:center">${subtitle}</div>
    ${data.teacherAtBottom ? '' : teacherDesk}
    <div style="position:relative;width:${width}px;height:${height}px;margin:0 auto">${desksHtml}</div>
    ${data.teacherAtBottom ? '<div style="margin-top:20px">' + teacherDesk + '</div>' : ''}
    <div style="margin-top:16px;font-size:9px;color:#aaa;border-top:1px solid #ddd;padding-top:8px;text-align:center">
      AulaMap · ${new Date().toLocaleDateString('ca-ES')} · ${pluralize(data.students.length, 'alumne')} · ${Object.keys(data.assignments).length} amb lloc assignat
    </div>`;

  try {
    const canvas = await html2canvas(area, { scale: 2, backgroundColor: '#fff' });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: canvas.width / canvas.height > 1.2 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    const margin = 12;
    const pageW = pdf.internal.pageSize.getWidth() - 2 * margin;
    const pageH = pdf.internal.pageSize.getHeight() - 2 * margin;
    let imgW, imgH;
    if (canvas.width / canvas.height > pageW / pageH) { imgW = pageW; imgH = imgW * canvas.height / canvas.width; }
    else { imgH = pageH; imgW = imgH * canvas.width / canvas.height; }
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin + (pageW - imgW) / 2, margin + (pageH - imgH) / 2, imgW, imgH);
    pdf.save(`aulamap_${(data.nivell || 'aula').replace(/\s+/g, '_')}_${fileStamp()}.pdf`);
    toast('PDF exportat', 'success');
  } catch (error) {
    console.error(error);
    toast('Error en generar el PDF: ' + error.message, 'error');
  } finally {
    area.innerHTML = '';
  }
}

A.registerActions({
  saveToFile: () => saveToFile(),
  loadFromFile: () => loadFromFile(),
  handleFileLoad: (node, event) => handleFileLoad(event),
  exportPDF: () => exportPDF(),
  showImportCsv: () => showImportCsv(),
  csvFileChosen: node => csvFileChosen(node),
  importCsv: () => importCsvText(el('csvText')?.value || ''),
  showExportCsv: () => showExportCsv(),
  exportStudentsCsv: () => exportStudentsCsv(),
  exportSeatingCsv: () => exportSeatingCsv(),
  exportTeamsCsv: () => exportTeamsCsv()
});

Object.assign(A, {
  downloadBlob, fileStamp, saveToFile, loadFromFile, adoptImportedData,
  csvFrom, parseCsvLine, parseCsvTable, detectCsvSeparator, importCsvText,
  exportStudentsCsv, exportSeatingCsv, exportTeamsCsv, exportPDF
});

})(window.AulaMap);
