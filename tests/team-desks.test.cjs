const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(sizes, deskCount, mobile = false) {
  let next = 0;
  const students = Array.from({ length: sizes.reduce((a, b) => a + b, 0) }, (_, i) => ({ id: `s${i}` }));
  let offset = 0;
  const groups = sizes.map(size => { const group = students.slice(offset, offset + size).map(s => s.id); offset += size; return group; });
  const data = { students, desks: Array.from({ length: deskCount }, (_, i) => ({ id: `d${i}`, x: i * 120, y: 0 })),
    assignments: {}, lockedDesks: {}, layoutType: 'rows', teams: { groups, teamNames: {}, lockedTeams: {}, lockedStudents: {} } };
  students.slice(0, deskCount).forEach((student, i) => { data.assignments[`d${i}`] = student.id; });
  const context = vm.createContext({ getData: () => data, getTeams: () => data.teams,
    uid: () => `new${next++}`, DESK_W: 100, DESK_H: 64, isMobile: () => mobile, centerDesks() {},
    saveWithUndo() {}, saveState() {}, renderLayoutOptions() {}, renderStudentList() {}, updateCounts() {},
    toast() {}, studentName: id => id });
  for (const name of ['teams', 'teamscanvas']) vm.runInContext(readFileSync(path.join(__dirname, `../assets/js/${name}.js`), 'utf8'), context);
  vm.runInContext('renderTeamsSidebar = () => {}; renderTeamsCanvas = () => {};', context);
  return { data, context };
}

function assertNoOverlaps(desks) {
  for (let i = 0; i < desks.length; i++) for (let j = i + 1; j < desks.length; j++) {
    const a = desks[i], b = desks[j];
    assert.ok(a.x + 100 <= b.x || b.x + 100 <= a.x || a.y + 64 <= b.y || b.y + 64 <= a.y, `${a.id} overlaps ${b.id}`);
  }
}

for (const mobile of [false, true]) test(`uneven teams reuse desks and add only missing seats (${mobile ? 'mobile' : 'desktop'})`, () => {
  const { context, data } = setup([3, 7, 2, 5], 12, mobile);
  const existing = data.desks.slice();
  const assigned = { ...data.assignments };
  data.lockedDesks.d0 = true;
  context.arrangeTeamDesks();
  assert.equal(data.desks.length, 17);
  existing.forEach((desk, i) => assert.equal(data.desks[i], desk));
  Object.entries(assigned).forEach(([id, student]) => assert.equal(data.assignments[id], student));
  assert.equal(data.lockedDesks.d0, true);
  assert.equal(new Set(Object.values(data.assignments)).size, 17);
  assertNoOverlaps(data.desks);
  const arranged = JSON.stringify(data.desks);
  context.arrangeTeamDesks();
  assert.equal(JSON.stringify(data.desks), arranged);
});

test('surplus desks remain available, and empty teams do not break arrangement', () => {
  const { context, data } = setup([2, 0, 3], 10);
  context.arrangeTeamDesks();
  assert.equal(data.desks.length, 10);
  assert.equal(Object.keys(data.assignments).length, 5);
  assertNoOverlaps(data.desks);
});

test('manual team change moves only that student desk and preserves assignments', () => {
  const { context, data } = setup([3, 3], 8);
  context.arrangeTeamDesks();
  const before = JSON.parse(JSON.stringify(data.desks));
  const assignments = JSON.stringify(data.assignments);
  assert.equal(context.moveStudentToTeam('s0', 0, 1), true);
  assert.equal(data.teams.groups[0].includes('s0'), false);
  assert.equal(data.teams.groups[1].includes('s0'), true);
  data.desks.slice(1).forEach((desk, i) => assert.deepEqual(desk, before[i + 1]));
  assert.notDeepEqual(data.desks[0], before[0]);
  assert.equal(JSON.stringify(data.assignments), assignments);
  assertNoOverlaps(data.desks);
});

test('locked students, locked destination teams and stale moves do not mutate desks or groups', () => {
  const { context, data } = setup([2, 2], 4);
  data.teams.lockedStudents.s0 = 0;
  data.teams.lockedTeams[1] = true;
  const before = JSON.stringify(data);
  context.moveStudentToTeam('s0', 0, 1);
  context.moveStudentToTeam('s1', 0, 1);
  context.moveStudentToTeam('s3', 0, 1);
  assert.equal(JSON.stringify(data), before);
});
