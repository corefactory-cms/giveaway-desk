/* Personal prizes rendered from the local app state. */
(() => {
  'use strict';

  const views = new WeakMap();
  const number = new Intl.NumberFormat('ko-KR');
  const pageSize = 12;
  const kinds = {all:'전체', cash:'금화', voucher:'은화', item:'아이템'};
  const kindHints = {cash:'현금', voucher:'상품권', item:'실물 경품', pending:'경품 미입력'};

  // Each character is one pixel; identical colours share a single SVG path.
  const shapes = {
    coin: [
      '........................',
      '........................',
      '...........ooooooo......',
      '.........ooaaaaaaaoo....',
      '.......ooaahhhhhaaaao...',
      '.......oahhbbbbbhhaao...',
      '.......oahbbhbabhbaao...',
      '.....ooooahbhbabhbaao...',
      '...ooaaooaahbbbbhhaao...',
      '..oahhhaaooahhhhaaoo....',
      '..oahbaaaaooaaaaaao.....',
      '..oabbbbbaadoooooodo....',
      '..oaaabaaadoodddoddo....',
      '..ocooooooocdooooodo....',
      '.oddccdccdccooooooo.....',
      '.odddccdccdoooo.........',
      '..ooooooooooo...........',
      '........................'
    ],
    parcel: [
      '........................',
      '........ooooo...........',
      '.....ooohhhhhooo........',
      '...ooahhhbbhhhaaoo......',
      '.ooahhbbhhhbbhhaaaoo....',
      '.oahbbhhhbbhhbbhhaaao...',
      '.ooaaahbbhhbbhhbbhaao...',
      '.oaooaaahbbhhbbhaaaoo...',
      '.oabbooaahhbbaaaooddo...',
      '.oabbbbooaahaaooddddo...',
      '.oabbbbbaoooooddbbddo...',
      '.oabbbbbaoddddbbbdddo...',
      '.oohbbbbaoddddbbdddoo...',
      '...oohhbaodddddddoo.....',
      '.....oohhooddddoo.......',
      '.......ooooooodo........',
      '..........ooo...........',
      '........................'
    ],
    cup: [
      '........................',
      '........o....o..........',
      '.......oh...oh..........',
      '........o....o..........',
      '........................',
      '...ooooooooooooo........',
      '...ohhhhhhhhaaaooooo....',
      '...ohhhhhhhhaaaoohhdo...',
      '...ohhbbbbbhhaao..odo...',
      '...ohhbbbbbhhaao..odo...',
      '...ohhhhhhhhaaaoooddo...',
      '...oahhhhhhaaddooood....',
      '....oaaaaaaddoo.........',
      '.....oooooooo...........',
      '..ooooooooooooooo.......',
      '..ohhhhhhhhhhhado.......',
      '....ooooooooooo.........',
      '........................'
    ],
    unknown: [
      '........................',
      '......oooooooooo........',
      '.....ohhhhhhhhhdo.......',
      '.....ohhhaaahhhdo.......',
      '.....ohhhhaaahhdo.......',
      '.....ohhhhhhhhhdo.......',
      '.....ohhbbbbbhhdo.......',
      '.....ohhbbhhbhhdo.......',
      '.....ohhhhhhbhhdo.......',
      '.....ohhhhbbbhhdo.......',
      '.....ohhhhbhhhhdo.......',
      '.....ohhhhhhhhhdo.......',
      '.....ohhhhbhhhhdo.......',
      '.....ohhhhhhhhado.......',
      '.....oddddddddddo.......',
      '......oooooooooo........',
      '........................',
      '........................'
    ],
    chest: [
      '........................',
      '...........ooooooo......',
      '.......oooohhhhhhho.....',
      '.....oohhaaaabbbhhdo....',
      '....ohhaaabbbdddhhdo....',
      '....ohhabbbdddddhhdo....',
      '....ohhbbdddddddhhdo....',
      '....oddooooooooodddo....',
      '....ooooooooooooooooo...',
      '...ohhhhhhhhhhhhhhhho...',
      '...oaabbbaaaaaabbbaao...',
      '...oaabbbaaohhobbbaao...',
      '...oddbbbddohdobbbddo...',
      '...oddbbbddooodbbbddo...',
      '...oddbbbddddddbbbddo...',
      '...ohhbbbhhhhhhbbbhho...',
      '....oooooooooooooooo....',
      '........................'
    ]
  };
  const palettes = {
    gold: {o:'#624217',a:'#e6aa37',b:'#bd7b20',h:'#ffde77',c:'#d0932c',d:'#a7631b'},
    silver: {o:'#394956',a:'#b5c8d2',b:'#8197a6',h:'#ecf5f6',c:'#8aa1ae',d:'#687f90'},
    parcel: {o:'#584535',a:'#ca9b63',b:'#77958c',h:'#efd4a1',d:'#a47649'},
    cup: {o:'#434b50',a:'#90ada5',b:'#bd7e59',h:'#e8f1de',d:'#738c86'},
    unknown: {o:'#666f7f',a:'#c0c8d2',b:'#788798',h:'#e9edf0',d:'#a8b2bf'},
    chest: {o:'#4b3a31',a:'#b87349',b:'#d69a50',h:'#f6d38c',d:'#8e5840'}
  };
  const svgNS = 'http://www.w3.org/2000/svg';
  const spriteTemplates = new Map();

  function sprite(shape, colour) {
    const key = shape + '-' + colour;
    if (!spriteTemplates.has(key)) {
      const graphic = document.createElementNS(svgNS, 'svg');
      graphic.setAttribute('viewBox', '0 0 24 18');
      graphic.setAttribute('shape-rendering', 'crispEdges');
      graphic.setAttribute('aria-hidden', 'true');
      graphic.setAttribute('focusable', 'false');
      const paint = new Map();
      shapes[shape].forEach((row, y) => Array.from(row).forEach((code, x) => {
        if (code !== '.') paint.set(code, (paint.get(code) || '') + 'M' + x + ' ' + y + 'h1v1h-1z');
      }));
      for (const [code, d] of paint) {
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', palettes[colour][code]);
        graphic.append(path);
      }
      spriteTemplates.set(key, graphic);
    }
    return spriteTemplates.get(key).cloneNode(true);
  }

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function buildPrizes(items) {
    const winners = items.filter(item => item.status === '당첨');
    const totals = {cash:0, voucher:0, item:0};
    const slots = [];
    for (const event of winners) {
      const start = slots.length;
      for (const [type, field] of [['cash', 'award_cash'], ['voucher', 'award_voucher']]) {
        const amount = Number(event[field]);
        if (amount > 0) {
          totals[type] += amount;
          slots.push({id:event.id, eventName:event.name, type, title:number.format(amount) + '원'});
        }
      }
      for (const award of event.award_items || []) {
        if (!award.name || !Number.isInteger(award.quantity) || award.quantity < 1) continue;
        totals.item += award.quantity;
        slots.push({id:event.id, eventName:event.name, type:'item', title:award.name, quantity:award.quantity});
      }
      if (slots.length === start) slots.push({id:event.id, eventName:event.name, type:'pending', title:'경품 입력하기'});
    }
    return {wins:winners.length, totals, slots};
  }

  function summary(type, value) {
    const stat = element('div', 'inv-stat');
    const art = type === 'item' ? sprite('parcel', 'parcel') : sprite('coin', type === 'cash' ? 'gold' : 'silver');
    const label = element('span', 'inv-stat-label', kindHints[type]);
    const count = element('strong', 'inv-stat-total', number.format(value));
    count.append(element('span', 'inv-unit', type === 'item' ? '개' : '원'));
    const text = element('div');
    text.append(label, count);
    stat.append(art, text);
    return stat;
  }

  function prizeButton(slot, index, view) {
    const button = element('button', 'inv-slot');
    button.type = 'button';
    button.dataset.slot = JSON.stringify([slot.id, slot.type, slot.title, index]);
    const picture = element('span', 'inv-slot-picture');
    let art;
    if (slot.type === 'cash' || slot.type === 'voucher') art = sprite('coin', slot.type === 'cash' ? 'gold' : 'silver');
    else if (slot.type === 'pending') art = sprite('unknown', 'unknown');
    else if (/커피|라[떼테]|아메리카노|머그|찻잔/.test(slot.title)) art = sprite('cup', 'cup');
    else art = sprite('parcel', 'parcel');
    picture.append(art);
    if (slot.type === 'item') picture.append(element('span', 'inv-qty', '×' + number.format(slot.quantity)));
    button.append(picture, element('span', 'inv-slot-type', kindHints[slot.type]),
      element('strong', 'inv-slot-title', slot.title), element('span', 'inv-source', slot.eventName));
    button.addEventListener('click', () => view.actions.openDetail(view.byId.get(slot.id)));
    return button;
  }

  function drawSlots(view) {
    const {slots} = view.prizes;
    const filtered = view.filter === 'all' ? slots : slots.filter(slot => slot.type === view.filter);
    for (const tab of view.tabs.children) tab.setAttribute('aria-pressed', String(tab.dataset.kind === view.filter));
    const cutoff = Math.min(filtered.length, view.limit);
    const grid = view.grid;
    const focusKey = grid.contains(document.activeElement) ? document.activeElement.closest('button')?.dataset.slot : null;
    grid.replaceChildren();
    for (let i = 0; i < cutoff; i++) grid.append(prizeButton(filtered[i], i, view));
    if (focusKey) Array.from(grid.children).find(button => button.dataset.slot === focusKey)?.focus({preventScroll:true});
    const moreHadFocus = view.more === document.activeElement;
    view.more.hidden = cutoff >= filtered.length;
    view.more.textContent = '경품 더 보기 (' + cutoff + '/' + filtered.length + ')';
    if (moreHadFocus && view.more.hidden && grid.children.length) grid.lastElementChild.focus({preventScroll:true});
    view.empty.hidden = filtered.length > 0;
    view.result.textContent = '표시된 경품 칸 ' + number.format(cutoff) + '개, 전체 ' + number.format(filtered.length) + '개';
    if (filtered.length) return;
    const isAll = view.filter === 'all';
    const emptyTitle = isAll ? '당첨 보관함이 비어 있어요' : kindHints[view.filter] + ' 경품이 없어요';
    view.empty.querySelector('strong').textContent = emptyTitle;
    view.empty.querySelector('p').textContent = isAll ? '첫 당첨 결과를 올리면 받은 경품이 여기에 모여요.' : '다른 종류의 경품은 전체에서 확인하세요.';
  }

  function createView(container) {
    const view = {filter:'all', limit:pageSize};
    container.classList.add('prize-inventory');
    const header = element('div', 'inv-head');
    const titleBlock = element('div', 'inv-heading');
    const title = element('h2', '', '당첨 보관함');
    view.count = element('span', 'inv-win-count');
    titleBlock.append(title, view.count);
    const action = element('button', 'inv-record', '당첨 결과 올리기');
    action.type = 'button';
    action.addEventListener('click', () => view.actions.openResults());
    header.append(titleBlock, action);
    view.stats = element('div', 'inv-wallet');
    view.tabs = element('div', 'inv-tabs');
    view.tabs.setAttribute('role', 'group');
    view.tabs.setAttribute('aria-label', '경품 종류');
    for (const [kind,label] of Object.entries(kinds)) {
      const tab = element('button', 'inv-tab', label);
      tab.type = 'button';
      tab.dataset.kind = kind;
      tab.addEventListener('click', () => {
        view.filter = kind;
        view.limit = pageSize;
        drawSlots(view);
      });
      view.tabs.append(tab);
    }
    view.grid = element('div', 'inv-grid');
    view.empty = element('div', 'inv-empty');
    const emptyCopy = element('div');
    emptyCopy.append(element('strong'), element('p'));
    view.empty.append(sprite('chest', 'chest'), emptyCopy);
    view.more = element('button', 'inv-more');
    view.more.type = 'button';
    view.more.addEventListener('click', () => {
      view.limit += pageSize;
      drawSlots(view);
    });
    view.result = element('span', 'sr-only');
    view.result.setAttribute('role', 'status');
    container.replaceChildren(header, view.stats, view.tabs, view.grid, view.empty, view.more, view.result);
    views.set(container, view);
    return view;
  }

  function render(container, items, actions) {
    const view = views.get(container) || createView(container);
    view.actions = actions;
    view.byId = new Map(items.map(item => [item.id, item]));
    const prizes = buildPrizes(items);
    const signature = JSON.stringify(prizes);
    if (signature === view.signature) return;
    view.signature = signature;
    view.prizes = prizes;
    view.count.textContent = '당첨 ' + number.format(prizes.wins) + '건';
    view.stats.replaceChildren(...Object.entries(prizes.totals).map(([type, value]) => summary(type, value)));
    drawSlots(view);
  }

  window.GiveawayInventory = {render};
})();
