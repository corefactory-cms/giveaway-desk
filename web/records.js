'use strict';

window.GiveawayRecords = (() => {
  const maxBytes = 5 * 1024 * 1024;
  const modes = {
    applications: {
      title: '신청 결과 올리기',
      help: '응모를 마친 행사와 접수 화면을 AI에 보내 내 응모 목록을 갱신하세요.',
      evidence: '내가 제공한 접수 완료 화면·확인 메시지 또는 내가 직접 응모했다고 명시한 내용에서 실제로 신청을 마친 행사만 찾아 줘. 공고를 열거나 참여 방법을 안내한 것만으로는 응모로 기록하지 말아 줘.',
      sample: {kind: 'applications', records: [{id: '목록에 있는 행사 ID', status: '응모'}]}
    },
    results: {
      title: '응모 결과 올리기',
      help: '당첨 안내를 AI에 보내 현금, 지역상품권, 쿠폰, 기타 경품을 구분해 기록하세요.',
      evidence: '내가 제공한 결과 통지나 공식 발표에서 내 당첨·미당첨이 확실한 건만 정리해 줘. 이름 일부가 같거나 명단에 보이지 않는 경우에는 보류해 줘. 실제 당첨 현금만 award_cash에 원 단위 정수로 써 줘. 지역상품권, 쿠폰(기프티콘·교환권 포함), 그 밖의 상품권은 award_vouchers에 각각 kind(지역상품권, 쿠폰, 기타), name(경품 이름), quantity(확인된 수량)를 적어 줘. 장당 액면가를 확인했을 때만 face_value(원)를 넣어 줘. 쿠폰에 적힌 상품의 시중 가격을 추정하거나 상품권을 현금에 합산하지 말아 줘. 그 밖의 실물 경품은 award_items에 이름과 수량을 적어 줘. 상품권과 쿠폰을 award_items에 중복 입력하지 말아 줘. 미당첨은 경품 필드를 생략해 줘.',
      sample: {kind: 'results', records: [{id: '목록에 있는 행사 ID', status: '당첨', award_vouchers:[{kind:'지역상품권',name:'지역사랑상품권',quantity:1,face_value:10000},{kind:'쿠폰',name:'아메리카노 교환권',quantity:2}], award_items:[{name:'머그컵',quantity:1}]}]}
    }
  };
  const dialog = document.createElement('dialog');
  dialog.className = 'record-import';
  dialog.id = 'record-import';
  dialog.setAttribute('aria-labelledby', 'ri-title');
  dialog.setAttribute('aria-describedby', 'ri-help');
  dialog.innerHTML = `
    <div class="dialog-content">
      <header class="dialog-head">
        <h2 id="ri-title"></h2>
        <button type="button" class="close" id="ri-close" aria-label="닫기">×</button>
      </header>
      <p class="dialog-lead" id="ri-help"></p>
      <section class="ri-ask" aria-labelledby="ri-ask-title">
        <h3 id="ri-ask-title">AI에 정리 요청</h3>
        <p class="ri-guide">AI를 선택하면 행사 목록과 요청문이 복사됩니다. 채팅에 붙여넣고 확인 자료를 함께 보내세요.</p>
        <div id="ri-picker"></div>
        <label class="ri-all" id="ri-all-row" hidden><input type="checkbox" id="ri-all"> 응모 기록이 없는 행사도 포함</label>
        <details id="ri-prompt-details"><summary>복사할 요청문 보기</summary>
          <textarea class="prompt" id="ri-prompt" readonly rows="5" aria-label="AI에 보낼 요청문"></textarea>
        </details>
      </section>
      <section class="ri-upload" aria-labelledby="ri-upload-title">
        <div class="ri-line">
          <h3 id="ri-upload-title">AI 답변 가져오기</h3>
          <button class="button" id="ri-file-button" type="button">JSON 파일 선택</button>
        </div>
        <input type="file" accept=".json,application/json" id="ri-file" hidden>
        <label for="ri-data" class="field-label">또는 JSON 붙여넣기</label>
        <textarea id="ri-data" rows="3" spellcheck="false" placeholder="AI가 돌려준 JSON을 여기에 붙여넣으세요."></textarea>
      </section>
      <p id="ri-feedback" role="status" aria-live="polite" aria-atomic="true"></p>
      <section id="ri-review" class="ri-review" hidden aria-labelledby="ri-review-title">
        <h3 id="ri-review-title">변경 미리보기</h3>
        <ul id="ri-preview-list"></ul>
      </section>
      <div class="dialog-footer">
        <button class="button" id="ri-preview" type="button" disabled>변경 미리보기</button>
        <button class="button primary" id="ri-apply" type="button" disabled>내 기록에 반영</button>
      </div>
    </div>`;
  document.body.append(dialog);

  const field = name => dialog.querySelector('#ri-' + name);
  let kind = 'applications';
  let revision = 0;
  let ready = null;
  let applying = false;

  function feedback(message, error = false) {
    const target = field('feedback');
    target.textContent = message;
    target.classList.toggle('ri-error', error);
  }
  function buildPrompt(agentName) {
    const resultStatuses = ['응모', '당첨', '미당첨'];
    const items = state.items.filter(item => {
      if (item.id === exampleId) return false;
      if (kind === 'results') return field('all').checked || resultStatuses.includes(statusOf(item));
      return !['당첨', '미당첨'].includes(statusOf(item));
    }).map(({id, name}) => ({id, name}));
    const selectedMode = modes[kind];
    const intro = agentName ? agentName + '에게 부탁합니다.' : '';
    return [
      [intro, '응모수첩에 가져올 개인 기록 JSON을 만들어 줘.'].filter(Boolean).join(' '),
      selectedMode.evidence,
      '아래 행사 이름과 증빙을 대조해서 일치하는 ID를 써 줘. 목록에 없거나 비슷한 행사가 여러 개면 그 이름을 따로 알려 주고 확인할 때까지 보류해 줘. 내가 알려준 정보 외에 개인 연락처·당첨 코드·쿠폰번호·메모는 JSON에 넣지 말아 줘.',
      '확인한 건이 있으면 UTF-8 JSON 파일 한 개 또는 복사할 수 있는 JSON을 줘. 없으면 확인된 기록이 없다고 알려 줘. 형식 예시에 들어 있는 값은 실제 기록으로 사용하지 말아 줘.',
      JSON.stringify(selectedMode.sample, null, 2),
      '대조할 행사 ' + items.length + '건\n' + JSON.stringify(items)
    ].join('\n\n');
  }
  function setBusy(busy) {
    applying = busy;
    for (const id of ['data', 'file-button', 'close']) field(id).disabled = busy;
    field('preview').disabled = busy || !field('data').value.trim();
    field('apply').disabled = busy || !ready;
  }
  function invalidate() {
    revision += 1;
    ready = null;
    field('review').hidden = true;
    field('preview-list').replaceChildren();
    field('apply').disabled = true;
    field('preview').disabled = !field('data').value.trim();
    feedback('');
  }
  function showRows(rows) {
    const list = document.createDocumentFragment();
    for (const row of rows) {
      const li = node('li');
      const heading = node('div', null, 'ri-line');
      heading.append(node('strong', row.name), node('span', row.changed ? '변경' : '유지', 'ri-change'));
      li.append(heading, node('p', row.previous_status === row.status ? row.status : row.previous_status + ' → ' + row.status));
      if (row.status === '당첨') {
        const rewards = [];
        if (row.award_cash) rewards.push('현금 ' + formatMoney.format(row.award_cash) + '원');
        const vouchers = row.award_vouchers || [];
        for (const voucher of vouchers) {
          const value = voucher.face_value ? ' (장당 ' + formatMoney.format(voucher.face_value) + '원)' : '';
          rewards.push(voucher.kind + ' · ' + voucher.name + ' ' + formatMoney.format(voucher.quantity) + '장' + value);
        }
        if (!vouchers.length && row.award_voucher) rewards.push('기타 · 상품권 (종류 미확인) ' + formatMoney.format(row.award_voucher) + '원');
        for (const item of row.award_items || []) rewards.push('기타 · ' + item.name + ' × ' + formatMoney.format(item.quantity));
        if (rewards.length) li.append(node('p', rewards.join(' · '), 'ri-rewards'));
      }
      list.append(li);
    }
    field('preview-list').replaceChildren(list);
    field('review').hidden = false;
  }
  function parseText(raw) {
    const body = raw.trim();
    const fenced = body.match(/^\x60{3}(?:json)?\s*\n([\s\S]*?)\n?\x60{3}$/i);
    return JSON.parse(fenced ? fenced[1] : body);
  }
  async function preview() {
    if (applying) return;
    invalidate();
    const request = revision;
    const raw = field('data').value;
    field('preview').disabled = true;
    try {
      if (new Blob([raw]).size > maxBytes) throw new Error('5 MiB 이하의 JSON을 선택하세요.');
      const payload = parseText(raw);
      if (payload?.kind !== kind) throw new Error('이 화면에 맞는 ' + kind + ' 형식의 JSON을 선택하세요.');
      const data = await apiRequest('/api/records/preview', payload);
      if (request !== revision || !dialog.open) return;
      showRows(data.records);
      feedback('변경 ' + data.changed + '건 · 유지 ' + data.unchanged + '건');
      ready = data.changed ? payload : null;
      field('apply').disabled = !ready;
    } catch (error) {
      if (request === revision) feedback(error instanceof SyntaxError ? 'JSON 형식을 확인하세요. AI의 설명은 빼고 JSON만 붙여넣으면 됩니다.' : error.message, true);
    } finally {
      if (request === revision) field('preview').disabled = !raw.trim();
    }
  }
  async function readFile() {
    const file = field('file').files[0];
    field('file').value = '';
    if (!file || applying) return;
    field('data').value = '';
    invalidate();
    const request = revision;
    try {
      if (file.size > maxBytes) throw new Error('5 MiB 이하의 JSON 파일을 선택하세요.');
      const contents = await file.text();
      if (request !== revision || !dialog.open) return;
      field('data').value = contents;
      await preview();
    } catch (error) {
      if (request === revision) feedback(error.message, true);
    }
  }
  async function applyRecords() {
    if (!ready || applying) return;
    setBusy(true);
    try {
      const summary = await apiRequest('/api/records/apply', ready);
      ready = null;
      dialog.close();
      try {
        await loadState();
        notify('내 기록에 ' + summary.changed + '건 반영했습니다.');
      } catch {
        notify('내 기록에 ' + summary.changed + '건 반영했습니다. 새로고침하면 최신 목록을 볼 수 있습니다.', true);
      }
    } catch (error) {
      invalidate();
      feedback(error.message, true);
    } finally { setBusy(false); }
  }
  function updatePrompt() {
    field('prompt').value = buildPrompt();
  }
  function open(nextKind) {
    if (!Object.hasOwn(modes, nextKind) || applying) return;
    kind = nextKind;
    field('title').textContent = modes[kind].title;
    field('help').textContent = modes[kind].help;
    field('data').value = '';
    field('file').value = '';
    field('all-row').hidden = kind !== 'results';
    field('all').checked = false;
    field('prompt-details').open = false;
    invalidate();
    updatePrompt();
    window.GiveawayAgentPicker(field('picker'), buildPrompt, message => feedback(message));
    if (!dialog.open) dialog.showModal();
  }
  field('close').addEventListener('click', () => dialog.close());
  field('all').addEventListener('change', updatePrompt);
  field('data').addEventListener('input', invalidate);
  field('file-button').addEventListener('click', () => field('file').click());
  field('file').addEventListener('change', readFile);
  field('preview').addEventListener('click', preview);
  field('apply').addEventListener('click', applyRecords);
  dialog.addEventListener('cancel', event => { if (applying) event.preventDefault(); });
  dialog.addEventListener('close', () => { revision++; ready = null; });
  return {open};
})();
