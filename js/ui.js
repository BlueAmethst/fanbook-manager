// ====== UI helpers: modal, toast, confirm, prompt ======
const UI = (() => {
  const modalRoot = () => document.getElementById('modal-root');
  const toastRoot = () => document.getElementById('toast-root');

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function openModal({ title, body, footer, className = '' }) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal ' + className;
    modal.innerHTML = `
      <div class="modal-head">
        <h2>${esc(title || '')}</h2>
        <button class="icon-btn" data-close aria-label="閉じる">✕</button>
      </div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>
    `;
    const bodyEl = modal.querySelector('.modal-body');
    const footEl = modal.querySelector('.modal-foot');
    if (body instanceof Node) bodyEl.appendChild(body); else bodyEl.innerHTML = body || '';
    if (footer instanceof Node) footEl.appendChild(footer); else footEl.innerHTML = footer || '';
    backdrop.appendChild(modal);
    modalRoot().appendChild(backdrop);

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    modal.querySelector('[data-close]').addEventListener('click', closeModal);
    return { backdrop, modal, bodyEl, footEl, close: closeModal };
  }

  function closeModal() { modalRoot().innerHTML = ''; }

  function toast(msg, ms = 2200) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    toastRoot().appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function confirm(msg) {
    return new Promise((resolve) => {
      const body = document.createElement('div');
      body.innerHTML = `<p style="margin:0;font-size:15px;line-height:1.6">${esc(msg)}</p>`;
      const foot = document.createElement('div');
      foot.style.cssText = 'display:flex;gap:10px;flex:1;justify-content:flex-end';
      foot.innerHTML = `
        <button class="btn btn-ghost" data-cancel>キャンセル</button>
        <button class="btn btn-danger" data-ok>OK</button>
      `;
      const m = openModal({ title: '確認', body, footer: foot });
      m.modal.querySelector('[data-cancel]').onclick = () => { closeModal(); resolve(false); };
      m.modal.querySelector('[data-ok]').onclick   = () => { closeModal(); resolve(true); };
    });
  }

  // 1行テキスト入力ダイアログ
  function prompt(msg, defaultValue = '') {
    return new Promise((resolve) => {
      const body = document.createElement('div');
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = defaultValue;
      inp.style.cssText = 'width:100%;padding:10px 13px;border:1.5px solid var(--border);border-radius:10px;font-size:16px;outline:none;background:var(--bg-elev)';
      body.appendChild(inp);

      const foot = document.createElement('div');
      foot.style.cssText = 'display:flex;gap:10px;flex:1;justify-content:flex-end';
      foot.innerHTML = `
        <button class="btn btn-ghost" data-cancel>キャンセル</button>
        <button class="btn btn-primary" data-ok>OK</button>
      `;
      const m = openModal({ title: msg, body, footer: foot });
      setTimeout(() => { inp.focus(); inp.select(); }, 50);

      const submit = () => { closeModal(); resolve(inp.value.trim() || null); };
      const cancel = () => { closeModal(); resolve(null); };
      m.modal.querySelector('[data-cancel]').onclick = cancel;
      m.modal.querySelector('[data-ok]').onclick = submit;
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') cancel();
      });
    });
  }

  // 購入確定ダイアログ
  function confirmPurchase({ title, circleName, authorName, spaceLabel }) {
    return new Promise((resolve) => {
      const body = document.createElement('div');
      body.innerHTML = `
        <div style="line-height:1.8;font-size:15px">
          ${spaceLabel  ? `<div><span class="muted">スペース：</span><b>${esc(spaceLabel)}</b></div>` : ''}
          ${circleName  ? `<div><span class="muted">サークル：</span>${esc(circleName)}</div>`       : ''}
          ${authorName  ? `<div><span class="muted">作家：</span>${esc(authorName)}</div>`           : ''}
          ${title       ? `<div><span class="muted">書名：</span>${esc(title)}</div>`                : ''}
        </div>
        <p style="margin-top:14px;font-size:15px">購入済みにしてよろしいですか？</p>
      `;
      const foot = document.createElement('div');
      foot.style.cssText = 'display:flex;gap:10px;flex:1';
      foot.innerHTML = `
        <button class="btn btn-cancel btn-ghost" data-cancel>キャンセル</button>
        <button class="btn btn-yes" data-ok>はい</button>
      `;
      const m = openModal({ title: '購入確定', body, footer: foot, className: 'confirm-purchase' });
      m.modal.querySelector('[data-cancel]').onclick = () => { closeModal(); resolve(false); };
      m.modal.querySelector('[data-ok]').onclick   = () => { closeModal(); resolve(true); };
    });
  }

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) e.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  return { openModal, closeModal, toast, confirm, prompt, confirmPurchase, esc, el };
})();
