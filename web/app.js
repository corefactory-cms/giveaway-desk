'use strict';
const el = id => document.getElementById(id);
const exampleId = 'example-reading-quiz';
const statuses = ['미응모', '응모', '당첨', '미당첨', '관심 없음'];
const formatMoney = new Intl.NumberFormat('ko-KR');
let state = {items: [], today: '', token: ''};
let tab = '전체';
let scheduleKind = 'deadline';
let selectedId = '';
let noticeTimer;
let loadingSequence = 0;
let hasLoaded = false;

function node(tag, label, className) {
  const element = document.createElement(tag);
  if (label !== undefined && label !== null) element.textContent = label;
  if (className) element.className = className;
  return element;
}
function link(url, title, className) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const anchor = node('a', title, className);
    anchor.href = parsed.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    return anchor;
  } catch {
    return null;
  }
}
function displayDate(value) {
  return value ? value.replace(/-/g, '.') : '미확인';
}
function statusOf(item) { return statuses.includes(item.status) ? item.status : '미응모'; }
function notify(message, error = false) {
  const toast = el('notice');
  const active = document.querySelector('dialog[open]');
  (active || document.body).append(toast);
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { toast.hidden = true; }, error ? 10000 : 4300);
}
function setOptions(select, values, defaultText) {
  const selected = select.value;
  select.replaceChildren();
  if (defaultText) select.add(new Option(defaultText, ''));
  for (const value of values) select.add(new Option(value, value));
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}
function addTableCell(row, content) {
  const cell = node('td');
  if (typeof content === 'string') cell.textContent = content;
  else if (content) cell.append(content);
  row.append(cell);
  return cell;
}
function toggleSchedule(kind) {
  scheduleKind = kind;
  document.querySelectorAll('[data-schedule]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.schedule === kind));
  });
  renderSchedule();
}
function renderSchedule() {
  const target = el('schedule');
  target.replaceChildren();
  const key = scheduleKind;
  const active = key === 'deadline' ? '미응모' : '응모';
  const upcoming = state.items.filter(item => statusOf(item) === active && item[key] && item[key] >= state.today)
    .sort((a, b) => a[key].localeCompare(b[key]) || a.name.localeCompare(b.name, 'ko')).slice(0, 3);
  for (const item of upcoming) {
    const button = node('button', null, 'schedule-row');
    button.type = 'button';
    const days = Math.round((Date.parse(item[key] + 'T00:00:00Z') - Date.parse(state.today + 'T00:00:00Z')) / 86400000);
    button.append(node('span', displayDate(item[key]).slice(5), 'schedule-date'), node('span', item.name, 'schedule-name'),
      node('span', days === 0 ? '오늘' : 'D-' + days, 'schedule-delta'));
    button.addEventListener('click', () => openDetail(item));
    target.append(button);
  }
  if (!upcoming.length) target.append(node('p', key === 'deadline' ? '예정된 응모 마감이 없습니다.' : '응모한 이벤트 중 발표 예정일이 확인된 건이 없습니다.', 'schedule-empty'));
}
function renderSummary() {
  const won = state.items.filter(item => statusOf(item) === '당첨');
  const cash = won.reduce((sum, entry) => sum + Number(entry.award_cash || 0), 0);
  const voucher = won.reduce((sum, entry) => sum + Number(entry.award_voucher || 0), 0);
  el('total').textContent = formatMoney.format(cash + voucher);
  el('cash').textContent = formatMoney.format(cash) + '원';
  el('voucher').textContent = formatMoney.format(voucher) + '원';
  if (state.today) {
    el('today').dateTime = state.today;
    el('today').textContent = new Intl.DateTimeFormat('ko-KR', {year:'numeric', month:'long', day:'numeric', weekday:'long', timeZone:'Asia/Seoul'}).format(new Date(state.today + 'T00:00:00+09:00'));
  }
  renderSchedule();
}
function renderRows() {
  const search = el('search').value.trim().toLowerCase();
  const category = el('category').value;
  const key = el('sort').value;
  const filtered = state.items.filter(item => {
    const current = statusOf(item);
    if (tab === '전체' ? current === '관심 없음' : current !== tab) return false;
    if (category && item.category !== category) return false;
    return !search || [item.name, item.organizer, item.prize, item.description].some(value => String(value || '').toLowerCase().includes(search));
  }).sort((a,b) => {
    if (key === 'deadline') {
      const rank = item => !item.deadline ? 2 : item.deadline < state.today ? 1 : 0;
      const group = rank(a) - rank(b);
      if (group) return group;
      if (rank(a) === 1) return b.deadline.localeCompare(a.deadline) || a.name.localeCompare(b.name, 'ko');
    }
    if (!a[key] && b[key]) return 1;
    if (a[key] && !b[key]) return -1;
    const order = (a[key] || '').localeCompare(b[key] || '', 'ko');
    return (key === 'checked_on' ? -order : order) || a.name.localeCompare(b.name, 'ko');
  });
  el('item-count').textContent = filtered.length + '건';
  const fragment = document.createDocumentFragment();
  for (const item of filtered) {
    const row = node('tr');
    const name = node('button', item.name, 'name-button');
    name.type = 'button';
    name.addEventListener('click', () => openDetail(item));
    const event = addTableCell(row, name);
    event.append(node('span', [item.organizer, item.category].filter(Boolean).join(' · '), 'meta'));
    addTableCell(row, item.prize || '경품 미확인');
    const when = addTableCell(row, '마감 ' + displayDate(item.deadline));
    when.append(node('span', '발표 ' + (item.announcement ? displayDate(item.announcement) : item.announcement_note || '미확인'), 'date-secondary'));
    const current = statusOf(item);
    const status = node('button', current, 'status');
    status.type = 'button';
    status.setAttribute('aria-label', item.name + ' 상태 변경, 현재 ' + current);
    if (current === '당첨') status.classList.add('won');
    else if (current === '응모') status.classList.add('entered');
    else if (current !== '미응모') status.classList.add('quiet');
    status.addEventListener('click', () => { openDetail(item); el('record-status').focus(); });
    addTableCell(row, status);
    const source = item.id === exampleId ? '예시' : link(item.url, '공고 ↗', 'source');
    addTableCell(row, source || '미확인');
    fragment.append(row);
  }
  el('rows').replaceChildren(fragment);
  el('empty').hidden = !!filtered.length;
  if (filtered.length) return;
  const narrowed = !!search || !!category || tab !== '전체';
  el('empty-title').textContent = narrowed ? '조건에 맞는 이벤트가 없습니다' : '아직 등록된 이벤트가 없습니다';
  el('empty-message').textContent = narrowed ? '상태 탭이나 검색 조건을 바꿔 보세요.' : 'AI가 조사한 이벤트를 JSON 파일로 가져올 수 있습니다.';
  el('empty-action').textContent = narrowed ? '전체 목록 보기' : '리서치 요청 보기';
  el('empty-action').onclick = () => {
    if (narrowed) {
      el('search').value = '';
      el('category').value = '';
      selectTab('전체');
    } else openResearch();
  };
}
function selectTab(value) {
  tab = value;
  document.querySelectorAll('#status-tabs button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === tab)));
  renderRows();
}
function addFact(key, value) {
  if (!value) return;
  el('facts').append(node('dt', key), node('dd', value));
}
function showPrizeFields() {
  el('prize-fields').hidden = el('record-status').value !== '당첨';
}
function openDetail(item) {
  selectedId = item.id;
  el('detail-title').textContent = item.name;
  el('detail-org').textContent = [item.organizer, item.category].filter(Boolean).join(' · ');
  el('detail-description').textContent = item.description || '';
  el('detail-description').hidden = !item.description;
  el('facts').replaceChildren();
  addFact('경품', item.prize || '미확인');
  addFact('응모 마감', displayDate(item.deadline));
  addFact('당첨 발표', [item.announcement && displayDate(item.announcement), item.announcement_note].filter(Boolean).join(' · ') || '미확인');
  addFact('참여 대상', item.eligibility);
  addFact('응모 방법', item.how_to);
  const links = el('detail-links');
  links.replaceChildren();
  if (item.id === exampleId) {
    addFact('공고', '예시');
  } else {
    addFact('자료 확인일', displayDate(item.checked_on));
    const official = link(item.url, '공식 공고 ↗');
    const result = link(item.result_url, '당첨 발표 확인 ↗');
    if (official) links.append(official);
    if (result) links.append(result);
  }
  el('record-status').value = statusOf(item);
  el('record-cash').value = item.award_cash || '';
  el('record-voucher').value = item.award_voucher || '';
  el('record-memo').value = item.memo || '';
  showPrizeFields();
  el('detail').showModal();
}
async function apiRequest(path, body) {
  const options = body ? {method:'POST', headers:{'Content-Type':'application/json','X-Local-Token':state.token}, body:JSON.stringify(body)} : {};
  const response = await fetch(path, {...options, cache:'no-store'});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || '작업을 완료하지 못했습니다.');
  return data;
}
async function loadState() {
  const request = ++loadingSequence;
  const next = await apiRequest('/api/state');
  if (request !== loadingSequence) return;
  if (!Array.isArray(next.items) || !next.today || !next.token) throw new Error('목록 응답을 읽을 수 없습니다.');
  state = next;
  hasLoaded = true;
  setOptions(el('category'), [...new Set(state.items.map(item => item.category).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ko')), '모든 종류');
  renderSummary();
  renderRows();
}
async function refresh() {
  try { await loadState(); }
  catch (error) {
    if (!hasLoaded) {
      el('empty').hidden = false;
      el('empty-title').textContent = '응모 목록을 불러오지 못했습니다';
      el('empty-message').textContent = '로컬 응모수첩을 실행한 뒤 다시 시도하세요.';
      el('empty-action').textContent = '다시 불러오기';
      el('empty-action').onclick = refresh;
    }
    notify(error.message, true);
  }
}
async function saveRecord(event) {
  event.preventDefault();
  const status = el('record-status').value;
  const body = {id:selectedId, status, memo:el('record-memo').value};
  if (status === '당첨') {
    body.award_cash = Number(el('record-cash').value || 0);
    body.award_voucher = Number(el('record-voucher').value || 0);
  }
  el('save').disabled = true;
  try {
    await apiRequest('/api/record', body);
    el('detail').close();
    await loadState();
    notify('응모 기록을 저장했습니다.');
  } catch (error) { notify(error.message, true); }
  finally { el('save').disabled = false; }
}
const researchPrompt = [
  '응모수첩의 이벤트 목록을 오늘 한국 날짜 기준으로 업데이트해 주세요.',
  '저장소 https://github.com/corefactory-cms/giveaway-desk 의 README.md와 AGENTS.md를 먼저 읽고, research.schema.json의 형식을 따르세요. 각 항목의 entry_type은 giveaway입니다. 사용자의 PC에 설치되어 있다면 해당 폴더를 기준으로 작업하세요.',
  '현재 개인이 참여할 수 있는 무료 추첨, 퀴즈, 설문, 댓글 이벤트를 조사하고 주최 측 원문을 직접 확인하세요. 작품을 제출하는 공모전은 제외하세요.',
  '행사마다 이름, 주최, 종류, 행사 설명(description), 경품, 응모 마감, 당첨 발표일이나 공지 방법, 공식 공고 및 결과 링크, 참가 자격, 응모 방법, 자료 확인일을 적으세요. 확인할 수 없는 날짜는 비워 두고, 기존 항목을 갱신할 때는 같은 id를 사용하세요.',
  '로컬 파일 접근이 가능하면 agent.py의 paths로 저장 위치를 확인하고, catalog로 기존 자료를 읽은 뒤 validate와 import를 순서대로 실행하세요. 로컬 파일에 접근할 수 없으면 앱에서 가져올 수 있는 { "items": [...] } JSON 파일을 제공하세요. 개인의 응모 상태, 당첨 금액, 메모는 연구 자료에 포함하지 마세요.'
].join('\n\n');
function openResearch() {
  el('prompt').value = researchPrompt;
  el('research').showModal();
}
async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(researchPrompt);
    notify('리서치 요청문을 복사했습니다.');
  } catch {
    el('prompt').focus();
    el('prompt').select();
    if (document.execCommand('copy')) notify('리서치 요청문을 복사했습니다.');
    else notify('선택한 요청문을 복사해 주세요.');
  }
}
async function importFile(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('5 MiB 이하의 JSON 파일을 선택하세요.');
    const data = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
    if (!data || !Array.isArray(data.items)) throw new Error('items 배열이 들어 있는 리서치 JSON 파일을 선택하세요.');
    const summary = await apiRequest('/api/import', data);
    if (el('research').open) el('research').close();
    await loadState();
    notify('리서치 반영 · 추가 ' + summary.added + '건 · 변경 ' + summary.updated + '건 · 유지 ' + summary.unchanged + '건');
  } catch (error) { notify(error instanceof SyntaxError ? 'JSON 파일 형식을 확인해 주세요.' : error.message, true); }
  finally { input.value = ''; }
}
for (const value of ['전체', ...statuses]) {
  const button = node('button', value);
  button.type = 'button';
  button.dataset.tab = value;
  button.setAttribute('aria-pressed', String(value === tab));
  button.addEventListener('click', () => selectTab(value));
  el('status-tabs').append(button);
}
setOptions(el('record-status'), statuses);
el('record-form').addEventListener('submit', saveRecord);
el('record-status').addEventListener('change', showPrizeFields);
el('search').addEventListener('input', renderRows);
for (const id of ['category','sort']) el(id).addEventListener('change', renderRows);
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const button of document.querySelectorAll('[data-schedule]')) button.addEventListener('click', () => toggleSchedule(button.dataset.schedule));
for (const button of document.querySelectorAll('[data-research]')) button.addEventListener('click', openResearch);
for (const button of document.querySelectorAll('[data-import]')) button.addEventListener('click', () => el('import-file').click());
el('import-file').addEventListener('change', importFile);
el('copy').addEventListener('click', copyPrompt);
document.querySelectorAll('.side-nav a').forEach(anchor => anchor.addEventListener('click', () => {
  document.querySelectorAll('.side-nav a').forEach(other => other.classList.toggle('current', other === anchor));
}));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !document.querySelector('dialog[open]')) refresh();
});
setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) refresh(); }, 30000);
refresh();
