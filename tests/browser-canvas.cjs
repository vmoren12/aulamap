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
      const data = getData();
      data.students = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `Alumne ${i + 1}`, color: '#6488c0' }));
      data.teams.studentsPerGroup = 4;
      data.students.forEach((s, i) => { data.assignments[data.desks[i].id] = s.id; });
      renderAll();
      zoomReset();
    });
    await page.click('.zoom-controls button');
    const zoom = await page.evaluate(() => zoomLevel);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => zoomLevel), zoom);
    const background = await page.$eval('#canvasArea', area => { const r = area.getBoundingClientRect(); return { x: r.right - 100, y: r.top + 20 }; });
    await page.mouse.click(background.x, background.y);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'canvasArea');
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => zoomLevel), zoom);
    await page.keyboard.down('Space');
    const oldPan = await page.evaluate(() => panX);
    await page.mouse.move(background.x, background.y);
    await page.mouse.down();
    await page.mouse.move(background.x - 60, background.y + 20, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    assert.equal(await page.evaluate(() => panX), oldPan - 60);
    const beforeMode = await page.evaluate(() => ({ desks: getData().desks, assignments: getData().assignments, panX, panY, zoomLevel }));
    await page.click('#viewToggleEquips');
    assert.deepEqual(await page.evaluate(() => ({ desks: getData().desks, assignments: getData().assignments, panX, panY, zoomLevel })), beforeMode);
    assert.equal(await page.$('#teamsCanvas'), null);
    assert.equal(await page.$eval('#classroom', node => node.classList.contains('teams-mode')), true);
    await page.click('#teamCreateBtn');
    await page.waitForFunction(() => document.querySelectorAll('.team-zone').length === 3);
    await page.evaluate(() => zoomReset());
    const formed = await page.evaluate(() => ({ desks: getData().desks, groups: getTeams().groups, assignments: getData().assignments }));
    assert.equal(formed.desks.length, beforeMode.desks.length);
    assert.deepEqual(formed.assignments, beforeMode.assignments);
    await page.evaluate(() => undo());
    assert.deepEqual(await page.evaluate(() => getData().desks), beforeMode.desks);
    assert.equal(await page.evaluate(() => getTeams().groups), null);
    await page.evaluate(() => redo());
    assert.deepEqual(await page.evaluate(() => getTeams().groups), formed.groups);
    const groupBefore = await page.evaluate(() => desksForTeam(0).map(d => ({ ...d })));
    const handle = await page.$('.team-zone[data-team-idx="0"] .team-mv');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 25, { steps: 5 });
    await page.mouse.up();
    const groupAfter = await page.evaluate(() => desksForTeam(0).map(d => ({ ...d })));
    const dx = groupAfter[0].x - groupBefore[0].x, dy = groupAfter[0].y - groupBefore[0].y;
    assert.ok(dx > 0 && dy > 0);
    groupAfter.forEach((desk, i) => { assert.equal(desk.x - groupBefore[i].x, dx); assert.equal(desk.y - groupBefore[i].y, dy); });
    await page.evaluate(() => clearTableSelection());
    const studentToMove = await page.evaluate(() => getData().assignments[desksForTeam(0)[0].id]);
    const member = await page.$('.desk[data-team-idx="0"] .desk-student');
    const destination = await page.$('.desk[data-team-idx="1"]');
    const memberBox = await member.boundingBox(), destinationBox = await destination.boundingBox();
    await page.mouse.move(memberBox.x + memberBox.width / 2, memberBox.y + memberBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(destinationBox.x + destinationBox.width / 2, destinationBox.y + destinationBox.height / 2, { steps: 20 });
    await page.mouse.up();
    assert.equal(await page.evaluate(id => getTeams().groups[1].includes(id), studentToMove), true);
    await page.evaluate(() => undo());
    await page.click('.team-zone[data-team-idx="0"] .team-title', { clickCount: 2 });
    await page.waitForSelector('.team-zone input');
    await page.keyboard.type('Equip Blau');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => teamName(0)), 'Equip Blau');
    await page.evaluate(() => {
      clearTableSelection();
      getTeams().useCompetency = true;
      renderTeamsPanel();
      renderTeamsCanvas();
      appendSavedTeam('Prova');
      const student = getTeams().groups[0][0];
      moveStudentToTeam(student, 0, 1);
      undo();
    });
    assert.deepEqual(await page.evaluate(() => getTeams().groups), formed.groups);
    await page.evaluate(() => {
      getTeams().activeSaved = null;
      loadSavedTeam(0);
    });
    assert.deepEqual(await page.evaluate(() => getTeams().groups), formed.groups);
    const shared = await page.evaluate(() => ({ desks: getData().desks, panX, panY, zoomLevel }));
    await page.click('#viewToggleAula');
    assert.deepEqual(await page.evaluate(() => ({ desks: getData().desks, panX, panY, zoomLevel })), shared);
    await page.click('#viewToggleEquips');
    await page.evaluate(() => zoomReset());
    if (process.env.TEST_SCREENSHOT) await page.screenshot({ path: process.env.TEST_SCREENSHOT });
    await page.reload({ waitUntil: 'load' });
    assert.deepEqual(await page.evaluate(() => getTeams().groups), formed.groups);
    assert.deepEqual(await page.evaluate(() => getData().assignments), formed.assignments);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: focus, space-pan, shared canvas, formation, group movement, undo/redo, saved teams and reload.');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
