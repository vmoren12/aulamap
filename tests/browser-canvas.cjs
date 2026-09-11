// Run with Puppeteer available in NODE_PATH. Uses an isolated browser profile.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)];
    res.setHeader('Content-Type', type || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 15000,
      ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith('http://127.0.0.1:') ? request.continue() : request.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.desk').length > 0);
    await page.evaluate(() => {
      const data = AulaMap.getData();
      data.students = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `Alumne ${i + 1}`, color: '#6488c0' }));
      data.teams.studentsPerGroup = 4;
      data.students.forEach((s, i) => { data.assignments[data.desks[i].id] = s.id; });
      AulaMap.renderAll();
      AulaMap.zoomReset();
    });
    await page.click('.zoom-controls button');
    const zoom = await page.evaluate(() => AulaMap.view.zoom);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => AulaMap.view.zoom), zoom);
    const background = await page.$eval('#canvasArea', area => { const r = area.getBoundingClientRect(); return { x: r.right - 100, y: r.top + 20 }; });
    await page.mouse.click(background.x, background.y);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'canvasArea');
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => AulaMap.view.zoom), zoom);
    await page.keyboard.down('Space');
    const oldPan = await page.evaluate(() => AulaMap.view.panX);
    await page.mouse.move(background.x, background.y);
    await page.mouse.down();
    await page.mouse.move(background.x - 60, background.y + 20, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    assert.equal(await page.evaluate(() => AulaMap.view.panX), oldPan - 60);
    const beforeDelete = await page.evaluate(() => JSON.stringify(AulaMap.getData()));
    await page.evaluate(() => {
      AulaMap.getData().desks.slice(0, 2).forEach(desk => AulaMap.tableSelection.add(desk.id));
      AulaMap.refreshTableSelection();
    });
    await page.click('#deleteSelectedBtn');
    await page.waitForSelector('[data-action="confirmYes"]');
    await page.click('[data-action="confirmYes"]');
    assert.equal(await page.evaluate(() => AulaMap.getData().desks.length), 18);
    assert.equal(await page.evaluate(() => AulaMap.getData().students.length), 12);
    await page.evaluate(() => AulaMap.undo());
    assert.equal(await page.evaluate(() => JSON.stringify(AulaMap.getData())), beforeDelete);
    await page.evaluate(() => {
      AulaMap.getData().desks.forEach(desk => AulaMap.tableSelection.add(desk.id));
      AulaMap.refreshTableSelection();
      AulaMap.el('canvasArea').focus();
    });
    await page.keyboard.press('Delete');
    await page.click('[data-action="confirmYes"]');
    assert.equal(await page.$$eval('.desk', nodes => nodes.length), 0);
    await page.evaluate(() => AulaMap.undo());
    const beforeMode = await page.evaluate(() => ({ desks: AulaMap.getData().desks, assignments: AulaMap.getData().assignments, panX: AulaMap.view.panX, panY: AulaMap.view.panY, zoom: AulaMap.view.zoom }));
    await page.click('#viewToggleEquips');
    assert.deepEqual(await page.evaluate(() => ({ desks: AulaMap.getData().desks, assignments: AulaMap.getData().assignments, panX: AulaMap.view.panX, panY: AulaMap.view.panY, zoom: AulaMap.view.zoom })), beforeMode);
    assert.equal(await page.$('#teamsCanvas'), null);
    assert.equal(await page.$eval('#classroom', node => node.classList.contains('teams-mode')), true);
    await page.click('#teamCreateBtn');
    await page.waitForFunction(() => document.querySelectorAll('.team-zone').length === 3);
    await page.evaluate(() => AulaMap.zoomReset());
    const formed = await page.evaluate(() => ({ desks: AulaMap.getTeamLayout().desks, groups: AulaMap.getTeams().groups, assignments: AulaMap.getTeamLayout().assignments }));
    assert.equal(formed.desks.length, 12);
    assert.deepEqual(await page.evaluate(() => AulaMap.getData().assignments), beforeMode.assignments);
    assert.deepEqual(await page.evaluate(() => AulaMap.getData().desks), beforeMode.desks);
    await page.evaluate(() => AulaMap.undo());
    assert.deepEqual(await page.evaluate(() => AulaMap.getData().desks), beforeMode.desks);
    assert.equal(await page.evaluate(() => AulaMap.getTeams().groups), null);
    await page.evaluate(() => AulaMap.redo());
    assert.deepEqual(await page.evaluate(() => AulaMap.getTeams().groups), formed.groups);
    const groupBefore = await page.evaluate(() => AulaMap.desksForTeam(0).map(d => ({ ...d })));
    const handle = await page.$('.team-zone[data-team-idx="0"] .team-mv');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 25, { steps: 5 });
    await page.mouse.up();
    const groupAfter = await page.evaluate(() => AulaMap.desksForTeam(0).map(d => ({ ...d })));
    const dx = groupAfter[0].x - groupBefore[0].x, dy = groupAfter[0].y - groupBefore[0].y;
    assert.ok(dx > 0 && dy > 0);
    groupAfter.forEach((desk, i) => { assert.equal(desk.x - groupBefore[i].x, dx); assert.equal(desk.y - groupBefore[i].y, dy); });
    await page.evaluate(() => {
      AulaMap.clearTableSelection();
      AulaMap.getTeamLayout().desks.slice(0, 2).forEach(desk => AulaMap.tableSelection.add(desk.id));
      AulaMap.refreshTableSelection();
    });
    await page.click('#deleteSelectedBtn');
    await page.click('[data-action="confirmYes"]');
    assert.equal(await page.evaluate(() => AulaMap.getTeamLayout().desks.length), 10);
    assert.deepEqual(await page.evaluate(() => AulaMap.getTeams().groups), formed.groups);
    assert.deepEqual(await page.evaluate(() => AulaMap.getData().desks), beforeMode.desks);
    await page.evaluate(() => AulaMap.undo());
    await page.evaluate(() => AulaMap.clearTableSelection());
    const studentToMove = await page.evaluate(() => AulaMap.getTeamLayout().assignments[AulaMap.desksForTeam(0)[0].id]);
    const member = await page.$('.desk[data-team-idx="0"] .desk-student');
    const destination = await page.$('.desk[data-team-idx="1"]');
    const memberBox = await member.boundingBox(), destinationBox = await destination.boundingBox();
    await page.mouse.move(memberBox.x + memberBox.width / 2, memberBox.y + memberBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(destinationBox.x + destinationBox.width / 2, destinationBox.y + destinationBox.height / 2, { steps: 20 });
    await page.mouse.up();
    assert.equal(await page.evaluate(id => AulaMap.getTeams().groups[1].includes(id), studentToMove), true);
    await page.evaluate(() => AulaMap.undo());
    await page.keyboard.down('Control');
    const members = await page.$$('.desk[data-team-idx="0"] .desk-student');
    await members[0].click();
    await members[1].click();
    await page.keyboard.up('Control');
    const selected = await page.evaluate(() => AulaMap.selectedTeamStudents());
    assert.equal(selected.length, 2);
    const undoCount = await page.evaluate(() => AulaMap.undoDepth());
    const sourceBox = await members[0].boundingBox();
    const targetBox = await (await page.$('.team-zone[data-team-idx="1"]')).boundingBox();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 20 });
    await page.mouse.up();
    assert.equal(await page.evaluate(ids => ids.every(id => AulaMap.getTeams().groups[1].includes(id)), selected), true);
    assert.equal(await page.evaluate(() => AulaMap.undoDepth()), undoCount + 1);
    assert.deepEqual(await page.evaluate(() => AulaMap.getData().desks), beforeMode.desks);
    await page.evaluate(() => AulaMap.undo());
    assert.deepEqual(await page.evaluate(() => AulaMap.getTeams().groups), formed.groups);
    await page.evaluate(() => {
      AulaMap.desksForTeam(0).slice(0, 2).forEach(desk => AulaMap.tableSelection.add(desk.id));
      AulaMap.refreshTableSelection();
    });
    await page.focus('#moveSelectedTeam');
    await page.keyboard.press('Delete');
    assert.equal(await page.evaluate(() => AulaMap.getTeamLayout().desks.length), 12);
    await page.select('#moveSelectedTeam', '2');
    assert.equal(await page.evaluate(() => AulaMap.getTeams().groups[2].length), 6);
    await page.evaluate(() => AulaMap.undo());
    // Chrome headless no genera dblclick a partir dels clics simulats: s'envia l'esdeveniment.
    await page.$eval('.team-zone[data-team-idx="0"] .team-title',
      node => node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await page.waitForSelector('.team-zone input');
    await page.keyboard.type('Equip Blau');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => AulaMap.teamName(0)), 'Equip Blau');
    await page.evaluate(() => {
      AulaMap.clearTableSelection();
      AulaMap.getTeams().useCompetency = true;
      AulaMap.renderTeamsPanel();
      AulaMap.renderTeamsCanvas();
      AulaMap.appendSavedTeam('Prova');
      const student = AulaMap.getTeams().groups[0][0];
      AulaMap.moveStudentToTeam(student, 0, 1);
      AulaMap.undo();
    });
    assert.deepEqual(await page.evaluate(() => AulaMap.getTeams().groups), formed.groups);
    const firstLayout = await page.evaluate(() => AulaMap.getTeamLayout());
    await page.evaluate(() => {
      AulaMap.getTeamLayout().desks[0].x += 70;
      AulaMap.appendSavedTeam('Segona materia');
    });
    const secondLayout = await page.evaluate(() => AulaMap.getTeamLayout());
    await page.evaluate(() => AulaMap.loadSavedTeam(0));
    assert.deepEqual(await page.evaluate(() => AulaMap.getTeamLayout()), firstLayout);
    await page.evaluate(() => {
      const teams = AulaMap.getTeams();
      teams.saved.push({ name: 'Legacy', groups: teams.groups.map(group => [...group]), teamNames: {} });
      AulaMap.loadSavedTeam(teams.saved.length - 1);
    });
    assert.equal(await page.evaluate(() => AulaMap.teamsHaveUnsavedChanges()), false);
    await page.evaluate(() => { AulaMap.getTeamLayout().desks[0].x += 10; });
    assert.equal(await page.evaluate(() => AulaMap.teamsHaveUnsavedChanges()), true);
    await page.evaluate(() => { AulaMap.getTeamLayout().desks[0].x -= 10; AulaMap.loadSavedTeam(0); });
    await page.evaluate(() => AulaMap.loadSavedTeam(1));
    assert.deepEqual(await page.evaluate(() => AulaMap.getTeamLayout()), secondLayout);
    await page.evaluate(() => AulaMap.loadSavedTeam(0));
    await page.evaluate(() => {
      AulaMap.getTeams().activeSaved = null;
      AulaMap.loadSavedTeam(0);
    });
    assert.deepEqual(await page.evaluate(() => AulaMap.getTeams().groups), formed.groups);
    // Carregar una formació reenquadra el llenç amb una espera: es deixa acabar.
    await new Promise(resolve => setTimeout(resolve, 200));
    const shared = await page.evaluate(() => ({ desks: AulaMap.getData().desks, panX: AulaMap.view.panX, panY: AulaMap.view.panY, zoom: AulaMap.view.zoom }));
    await page.click('#viewToggleAula');
    assert.deepEqual(await page.evaluate(() => ({ desks: AulaMap.getData().desks, panX: AulaMap.view.panX, panY: AulaMap.view.panY, zoom: AulaMap.view.zoom })), shared);
    await page.click('#viewToggleEquips');
    await page.evaluate(() => AulaMap.zoomReset());
    if (process.env.TEST_SCREENSHOT) await page.screenshot({ path: process.env.TEST_SCREENSHOT });
    await page.reload({ waitUntil: 'load' });
    assert.deepEqual(await page.evaluate(() => AulaMap.getTeams().groups), formed.groups);
    assert.deepEqual(await page.evaluate(() => AulaMap.getData().assignments), beforeMode.assignments);
    assert.deepEqual(await page.evaluate(() => AulaMap.getData().desks), beforeMode.desks);
    assert.deepEqual(await page.evaluate(() => AulaMap.getTeamLayout()), firstLayout);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: bulk deletion, independent layouts, single and multi-student drag, group movement, undo/redo, saved formations, focus and reload.');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
