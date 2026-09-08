/**
 * AulaMap — Desar, carregar i exportar
 * Fitxers .json amb la configuració completa i exportació de l'aula a PDF.
 */
'use strict';

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
  const data = getData();
  const payload = {
    app: 'AulaMap',
    version: 5,
    exported: new Date().toISOString(),
    docent: currentDocentName(),
    config: currentConfigName(),
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
      pushUndo();
      const entry = currentDocentEntry();
      entry.configurations[entry.currentConfig].data = adoptImportedData(payload);
      saveState();
      renderAll();
      setTimeout(() => zoomReset(), 60);
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
  const data = normalizeConfigData(payload.data);
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

/* ── Exportació a PDF ────────────────────────────────── */

async function exportPDF() {
  const data = getData();
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
    const student = data.assignments[desk.id] ? findStudent(data.assignments[desk.id]) : null;
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

  const subtitle = [data.curs, data.nivell, data.aula, 'Grup: ' + currentDocentName(), currentConfigName()]
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
