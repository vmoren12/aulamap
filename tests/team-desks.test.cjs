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
    saveWithUndo() { undoCount++; }, saveState() {}, renderLayoutOptions() {}, renderStudentList() {}, updateCounts() {},
    toast() {}, studentName: id => id });
  let undoCount = 0;
  for (const name of ['teams', 'teamscanvas']) vm.runInContext(readFileSync(path.join(__dirname, `../assets/js/${name}.js`), 'utf8'), context);
  vm.runInContext('renderTeamsSidebar = () => {}; renderTeamsCanvas = () => {};', context);
  return { data, context, undoCount: () => undoCount };
}

function assertNoOverlaps(desks) {
  for (let i = 0; i < desks.length; i++) for (let j = i + 1; j < desks.length; j++) {
    const a = desks[i], b = desks[j];
    assert.ok(a.x + 100 <= b.x || b.x + 100 <= a.x || a.y + 64 <= b.y || b.y + 64 <= a.y, `${a.id} overlaps ${b.id}`);
  }
}

for (const mobile of [false, true]) test(`team diagrams stay independent of classroom seats (${mobile ? 'mobile' : 'desktop'})`, () => {
  const { context, data } = setup([3, 7, 2, 5], 12, mobile);
  data.lockedDesks.d0 = true;
  const classroom = JSON.stringify({ desks: data.desks, assignments: data.assignments, lockedDesks: data.lockedDesks, layoutType: data.layoutType });
  context.arrangeTeamDesks();
  const layout = data.teams.layout;
  assert.equal(layout.desks.length, 17);
  assert.equal(new Set(Object.values(layout.assignments)).size, 17);
  assertNoOverlaps(layout.desks);
  const arranged = JSON.stringify(layout.desks);
  context.arrangeTeamDesks();
  assert.equal(JSON.stringify(layout.desks), arranged);
  assert.equal(JSON.stringify({ desks: data.desks, assignments: data.assignments, lockedDesks: data.lockedDesks, layoutType: data.layoutType }), classroom);
});

test('surplus desks remain available, and empty teams do not break arrangement', () => {
  const { context, data } = setup([2, 0, 3], 10);
  context.arrangeTeamDesks();
  assert.equal(data.desks.length, 10);
  assert.equal(Object.keys(data.assignments).length, 5);
  assert.equal(data.teams.layout.desks.length, 5);
  assert.equal(context.desksForTeam(1).length, 0);
  assertNoOverlaps(data.desks);
});

test('manual team change moves only that student desk and preserves assignments', () => {
  const { context, data } = setup([3, 3], 8);
  context.arrangeTeamDesks();
  const layout = data.teams.layout;
  const before = JSON.parse(JSON.stringify(layout.desks));
  const assignments = JSON.stringify(layout.assignments);
  assert.equal(context.moveStudentToTeam('s0', 0, 1), true);
  assert.equal(data.teams.groups[0].includes('s0'), false);
  assert.equal(data.teams.groups[1].includes('s0'), true);
  assert.equal(JSON.stringify(layout.desks.slice(1)), JSON.stringify(before.slice(1)));
  assert.notDeepEqual(layout.desks[0], before[0]);
  assert.equal(JSON.stringify(layout.assignments), assignments);
  assertNoOverlaps(layout.desks);
});

test('moving students from multiple teams to an empty team is one atomic undo', () => {
  const h = setup([3, 3, 0], 6);
  h.context.arrangeTeamDesks();
  const classroom = JSON.stringify(h.data.desks);
  assert.equal(h.context.moveStudentsToTeam(['s0', 's3', 's0'], 2), true);
  assert.equal(JSON.stringify(h.data.teams.groups), JSON.stringify([['s1', 's2'], ['s4', 's5'], ['s0', 's3']]));
  assert.equal(h.undoCount(), 1);
  assertNoOverlaps(h.data.teams.layout.desks);
  assert.equal(JSON.stringify(h.data.desks), classroom);
});

test('a locked member prevents partial transfer of a multiple selection', () => {
  const h = setup([3, 3], 6);
  h.context.arrangeTeamDesks();
  h.data.teams.lockedStudents.s1 = 0;
  const before = JSON.stringify(h.data);
  assert.equal(h.context.moveStudentsToTeam(['s0', 's1'], 1), false);
  assert.equal(JSON.stringify(h.data), before);
  assert.equal(h.undoCount(), 0);
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
