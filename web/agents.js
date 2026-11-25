'use strict';

window.GiveawayAgentPicker = function (host, makePrompt, feedback) {
  const names = ['피클', '클로드', '지피티', '제미나이'];
  const group = document.createElement('div');
  group.className = 'agent-options';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'AI 선택 및 요청문 복사');
  const fallback = document.createElement('textarea');
  fallback.className = 'prompt agent-fallback';
  fallback.readOnly = true;
  fallback.hidden = true;
  fallback.setAttribute('aria-label', '직접 복사할 요청문');

  for (const name of names) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'agent-option';
    button.textContent = name;
    button.title = name + '용 요청문 복사';
    const copyIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    copyIcon.setAttribute('viewBox', '0 0 24 24');
    copyIcon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(copyIcon.namespaceURI, 'path');
    path.setAttribute('d', 'M8 8h12v13H8z M4 16H3V3h12v1');
    copyIcon.append(path);
    button.append(copyIcon);
    button.addEventListener('click', async () => {
      const prompt = makePrompt(name);
      if (!prompt) return;
      let copied = false;
      try {
        await navigator.clipboard.writeText(prompt);
        copied = true;
      } catch {
        fallback.value = prompt;
        fallback.hidden = false;
        fallback.focus();
        fallback.select();
        try { copied = document.execCommand('copy'); } catch { /* The selected text can be copied manually. */ }
      }
      fallback.hidden = copied;
      if (copied) button.focus();
      group.querySelectorAll('button').forEach(item => item.classList.toggle('copied', copied && item === button));
      feedback(copied ? name + '용 요청문을 복사했어요. 채팅에 붙여넣으세요.' : '아래에 선택된 요청문을 직접 복사해 주세요.');
    });
    group.append(button);
  }
  host.replaceChildren(group, fallback);
};
