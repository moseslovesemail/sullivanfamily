'use strict';
const HELPERS = ['Helper A', 'Helper B', 'Helper C', 'Helper D'];
const CATEGORIES = ['Adult', 'Child A', 'Child B', 'School', 'Meals', 'Household'];
const STORAGE_KEY = 'family-support-fictional-demo-v2';
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const nzToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const offsetDate = (date, days) => { const result = new Date(`${date}T12:00:00Z`); result.setUTCDate(result.getUTCDate() + days); return result.toISOString().slice(0, 10); };
const weekStart = date => offsetDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
const displayDate = date => new Intl.DateTimeFormat('en-NZ', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`));
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

function seed() {
  const today = nzToday();
  const start = weekStart(today);
  const tasks = [];
  let count = 0;
  const add = (date, time, title, owner, category, done = false) => tasks.push({ id: `seed-${count++}`, date, time, title, owner, category, done });
  // All examples are fictional. They are not a school calendar or confirmed care plan.
  for (let day = 0; day < 14; day++) {
    const date = offsetDate(start, day);
    if (day % 7 < 5) {
      add(date, '07:00', 'Prepare lunchboxes', 'Helper A', 'School', date === today);
      add(date, '08:15', 'Child A school drop-off', 'Helper B', 'Child A');
      add(date, '08:30', 'Child B school drop-off', 'Helper C', 'Child B');
      add(date, '15:00', 'Child A school pickup', 'Helper A', 'Child A');
      add(date, '15:15', 'Child B school pickup', day % 7 === 2 ? '' : 'Helper D', 'Child B');
    }
    add(date, '17:30', 'Family dinner', day % 7 === 4 ? '' : 'Helper B', 'Meals');
  }
  add(today, '10:30', 'Adult appointment transport', 'Helper D', 'Adult');
  add(today, '12:30', 'Lunch and practical check-in', 'Helper B', 'Adult');
  add(today, '16:30', 'Collect household supplies', '', 'Household');
  return { version: 2, helper: HELPERS[0], tasks };
}
function validState(value) {
  const ids = new Set();
  return value && value.version === 2 && HELPERS.includes(value.helper) && Array.isArray(value.tasks) && value.tasks.length <= 1000 && value.tasks.every(task => {
    if (!task || typeof task.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(task.id) || ids.has(task.id)) return false;
    ids.add(task.id);
    return validDate(task.date) && typeof task.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(task.time) && typeof task.title === 'string' && task.title.trim().length > 0 && task.title.length <= 100 && (task.owner === '' || HELPERS.includes(task.owner)) && CATEGORIES.includes(task.category) && typeof task.done === 'boolean';
  });
}
function notice(message) { $('#storageNotice').textContent = message; $('#storageNotice').classList.remove('hidden'); }
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw);
    if (validState(parsed)) return parsed;
    notice('The saved demo was invalid. Fictional examples have been restored.');
  } catch { notice('Browser storage is unavailable or unreadable. Changes may not survive a reload.'); }
  return seed();
}
let state = load();
let currentView = 'today';
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { notice('This browser could not save the demo. Changes currently exist in this tab only.'); }
}
function announce(message) { $('#announcement').textContent = message; }
const sorted = tasks => [...tasks].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
const forDate = date => sorted(state.tasks.filter(task => task.date === date));
const isGap = task => !task.owner && !task.done;
function row(task, dateVisible = false) {
  const id = escapeHtml(task.id);
  const actions = task.owner
    ? `<span class="owner ${task.done ? 'done' : ''}">${escapeHtml(task.owner)}${task.done ? ' · Done' : ''}</span><button class="btn light" data-complete="${id}" aria-label="${task.done ? 'Reopen' : 'Mark complete'}: ${escapeHtml(task.title)}">${task.done ? 'Undo' : 'Done'}</button>${task.done ? '' : `<button class="btn light" data-release="${id}" aria-label="Release: ${escapeHtml(task.title)}">Release</button>`}`
    : `<button class="claim" data-claim="${id}" aria-label="Claim: ${escapeHtml(task.title)}">I'll take this</button>`;
  return `<div class="task"><div class="time">${escapeHtml(task.time)}</div><div><div class="title">${escapeHtml(task.title)}</div><div class="meta">${escapeHtml(task.category)}</div>${dateVisible ? `<span class="date-tag">${escapeHtml(displayDate(task.date))}</span>` : ''}</div><div class="actions">${actions}</div></div>`;
}
const taskList = (tasks, dates = false) => tasks.length ? sorted(tasks).map(task => row(task, dates)).join('') : '<p class="empty">No demo tasks in this view.</p>';
function render() {
  const today = nzToday();
  const todays = forDate(today);
  const gaps = todays.filter(isGap);
  $('#dateLabel').textContent = `${displayDate(today)} · Pacific/Auckland`;
  $('#gapCount').textContent = String(gaps.length);
  $('#gapText').textContent = gaps.length ? `${gaps.length} demo task${gaps.length === 1 ? '' : 's'} still need an owner.` : 'All listed demo tasks have an owner. This is not confirmation of real arrangements.';
  $('#alert').classList.toggle('hidden', !gaps.length);
  $('#alert').textContent = gaps.map(task => `${task.title} · ${task.time}`).join(' / ');
  const adult = todays.filter(task => task.category === 'Adult');
  const childA = todays.filter(task => ['Child A', 'School'].includes(task.category));
  const childB = todays.filter(task => ['Child B', 'School'].includes(task.category));
  for (const [selector, tasks] of [['#adultTasks', adult], ['#careTasks', adult], ['#childATasks', childA], ['#kidsA', childA], ['#childBTasks', childB], ['#kidsB', childB], ['#allTasks', todays]]) $(selector).innerHTML = taskList(tasks);
  const tomorrow = forDate(offsetDate(today, 1));
  const tomorrowGaps = tomorrow.filter(isGap).length;
  $('#tomorrowSummary').textContent = `${tomorrow.length} tasks · ${tomorrowGaps} need an owner`;
  $('#tomorrowTasks').innerHTML = taskList(tomorrow);
  const start = weekStart(today);
  const days = Array.from({ length: 7 }, (_, index) => offsetDate(start, index));
  const thisWeek = sorted(state.tasks.filter(task => days.includes(task.date)));
  const weekGaps = thisWeek.filter(isGap);
  $('#weekRange').textContent = `${displayDate(days[0])} – ${displayDate(days[6])}`;
  $('#weekGaps').textContent = `${weekGaps.length} unassigned`;
  $('#weekGrid').innerHTML = days.map(date => `<div class="day"><div class="dayName">${escapeHtml(displayDate(date))}</div>${forDate(date).map(task => `<div class="wi ${isGap(task) ? 'gap' : ''}"><b>${escapeHtml(task.time)}</b><br>${escapeHtml(task.title)}<br><span class="muted">${escapeHtml(task.owner || 'Needs someone')}${task.done ? ' · Done' : ''}</span></div>`).join('') || '<p class="empty">No tasks</p>'}</div>`).join('');
  $('#workload').innerHTML = HELPERS.map(helper => `<span class="pill">${escapeHtml(helper)} · ${thisWeek.filter(task => task.owner === helper).length}</span>`).join('');
  $('#weekUnassigned').innerHTML = taskList(weekGaps, true);
  $('#taskList').innerHTML = taskList(state.tasks.filter(task => !$('#onlyGaps').checked || isGap(task)), true);
  $('#currentPerson').value = state.helper;
}
function show(view) {
  const titles = { today: 'Today', week: 'This week', care: 'Care', kids: 'School & routines', tasks: 'All tasks', more: 'Support tools' };
  if (!titles[view]) return;
  currentView = view;
  document.querySelectorAll('[data-view]').forEach(section => section.classList.toggle('hidden', section.dataset.view !== view));
  document.querySelectorAll('[data-go]').forEach(button => {
    button.classList.toggle('active', button.dataset.go === view);
    if (button.dataset.go === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  $('#viewTitle').textContent = titles[view];
  window.scrollTo({ top: 0, behavior: 'instant' });
}
$('#currentPerson').innerHTML = HELPERS.map(helper => `<option>${helper}</option>`).join('');
$('#taskOwner').innerHTML = '<option value="">Unassigned</option>' + HELPERS.map(helper => `<option>${helper}</option>`).join('');
$('#currentPerson').addEventListener('change', event => { state.helper = event.target.value; save(); announce(`Trying as ${state.helper}. This is not sign-in.`); });
$('#onlyGaps').addEventListener('change', render);
document.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.go) return show(target.dataset.go);
  const id = target.dataset.claim || target.dataset.complete || target.dataset.release;
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  if (target.dataset.claim) { task.owner = state.helper; task.done = false; }
  if (target.dataset.complete) task.done = !task.done;
  if (target.dataset.release) { task.owner = ''; task.done = false; }
  save(); render(); announce(`Updated demo task: ${task.title}. Saved on this browser only.`);
});
$('#reset').addEventListener('click', () => {
  if (!window.confirm('Replace your local demo changes with the original fictional examples?')) return;
  state = seed(); save(); render(); announce('Fictional demo reset.');
});
$('#openTask').addEventListener('click', () => {
  const form = $('#taskForm');
  form.reset(); form.elements.date.value = nzToday(); $('#taskDialog').showModal(); form.elements.title.focus();
});
$('#closeTask').addEventListener('click', () => $('#taskDialog').close());
$('#taskForm').addEventListener('submit', event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  const task = { ...values, title: values.title.trim(), id: `local-${crypto.randomUUID()}`, done: false };
  const next = { ...state, tasks: [...state.tasks, task] };
  if (!validState(next)) { announce('Check the task details, or reset the demo if the 1,000-task limit is reached.'); return; }
  state = next; save(); $('#taskDialog').close(); render(); announce('Demo task added to this browser.');
});
// Same-browser tabs can refresh their local demo; this is not cross-device sync.
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { state = load(); render(); } });
window.addEventListener('focus', render);
render(); show(currentView);
