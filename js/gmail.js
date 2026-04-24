// ====== Gmail API integration ======
// Uses Google Identity Services token flow (browser, no client secret).
// Scope: gmail.readonly — read only.
const Gmail = (() => {
  const { el, esc } = UI;
  const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  let gisLoaded = false;
  let tokenClient = null;

  function loadGIS() {
    if (gisLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) { gisLoaded = true; return resolve(); }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => { gisLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('Google Identity Services読み込み失敗'));
      document.head.appendChild(s);
    });
  }

  async function ensureToken() {
    const cid = await DB.settings.get('gmailClientId');
    if (!cid) throw new Error('Gmail Client IDが未設定です（設定画面で登録してください）');
    const saved = await DB.settings.get('gmailToken');
    if (saved && saved.expiresAt && saved.expiresAt > Date.now() + 60000) return saved.token;
    return await signInInternal(cid);
  }

  async function signIn() {
    try {
      const cid = await DB.settings.get('gmailClientId');
      if (!cid) { UI.toast('先にClient IDを登録してください'); return; }
      await signInInternal(cid);
      UI.toast('ログインしました');
      App.route();
    } catch (err) {
      UI.toast('ログイン失敗：' + err.message);
    }
  }

  function signInInternal(clientId) {
    return loadGIS().then(() => new Promise((resolve, reject) => {
      try {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: async (resp) => {
            if (resp.error) return reject(new Error(resp.error));
            const token = resp.access_token;
            const expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
            await DB.settings.set('gmailToken', { token, expiresAt });
            resolve(token);
          }
        });
        tokenClient.requestAccessToken({ prompt: '' });
      } catch (e) { reject(e); }
    }));
  }

  async function apiGet(path, token) {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me' + path, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Gmail API error ${r.status}: ${text.slice(0, 200)}`);
    }
    return r.json();
  }

  // Known shop email senders & patterns
  const SHOP_RULES = [
    {
      key: 'BOOTH',
      senderQuery: 'from:(booth.pm OR noreply@booth.pm)',
      displayName: 'BOOTH',
      parse: parseBooth
    },
    {
      key: 'とらのあな',
      senderQuery: 'from:(toranoana.jp OR ec.toranoana.jp)',
      displayName: 'とらのあな',
      parse: parseGeneric
    },
    {
      key: 'メロンブックス',
      senderQuery: 'from:(melonbooks.co.jp)',
      displayName: 'メロンブックス',
      parse: parseGeneric
    }
  ];

  async function openImport() {
    try {
      await ensureToken();
    } catch (e) {
      UI.toast(e.message);
      App.go('settings');
      return;
    }

    const body = el('div');
    body.appendChild(el('p', { class: 'muted', style: 'margin-top:0' },
      '購入確認メールを検索して、候補を表示します。取り込むものにチェックを入れて登録してください。'));
    const rangeField = el('div', { class: 'row' });
    rangeField.appendChild(el('div', { class: 'field' }, [
      el('label', {}, '検索範囲（過去◯日）'),
      el('input', { type: 'number', name: 'days', value: '180', min: '1' })
    ]));
    body.appendChild(rangeField);
    const runBtn = el('button', { class: 'btn btn-primary btn-block' }, '検索');
    body.appendChild(runBtn);
    const resultBox = el('div', { style: 'margin-top:12px;max-height:50vh;overflow:auto' });
    body.appendChild(resultBox);

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, '閉じる'));
    const saveBtn = el('button', { class: 'btn btn-primary', onclick: () => saveChecked(resultBox) }, '選択したものを登録');
    saveBtn.style.display = 'none';
    foot.appendChild(saveBtn);

    runBtn.onclick = async () => {
      resultBox.innerHTML = '<div class="muted text-center" style="padding:20px">検索中...</div>';
      saveBtn.style.display = 'none';
      try {
        const days = Number(body.querySelector('[name=days]').value) || 180;
        const candidates = await searchAll(days);
        renderCandidates(resultBox, candidates);
        if (candidates.length) saveBtn.style.display = '';
      } catch (e) {
        resultBox.innerHTML = `<div class="empty"><h2>エラー</h2><p class="muted">${esc(e.message)}</p></div>`;
      }
    };

    UI.openModal({ title: 'Gmailから取り込み', body, footer: foot });
  }

  async function searchAll(days) {
    const token = await ensureToken();
    const after = Math.floor((Date.now() - days * 86400000) / 1000);
    const all = [];
    for (const rule of SHOP_RULES) {
      const q = encodeURIComponent(`${rule.senderQuery} after:${after}`);
      const list = await apiGet(`/messages?q=${q}&maxResults=30`, token);
      for (const m of list.messages || []) {
        try {
          const msg = await apiGet(`/messages/${m.id}?format=full`, token);
          const parsed = rule.parse(msg);
          if (parsed) {
            for (const item of parsed.items) {
              all.push({
                messageId: m.id,
                shop: rule.displayName,
                date: parsed.date,
                title: item.title,
                circleName: item.circleName || parsed.circleName || '',
                authorName: item.authorName || '',
                price: item.price,
                raw: parsed.subject
              });
            }
          }
        } catch (_) {}
      }
    }
    return all;
  }

  function renderCandidates(box, items) {
    box.innerHTML = '';
    if (!items.length) {
      box.appendChild(el('div', { class: 'empty' }, '購入確認メールが見つかりませんでした'));
      return;
    }
    const existingBooks = []; // TODO: dedupe by title+date
    items.forEach((it, idx) => {
      const row = el('div', { class: 'card', style: 'padding:10px' });
      const cb = el('input', { type: 'checkbox', 'data-idx': idx, checked: 'checked' });
      row.appendChild(el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, [
        cb,
        el('div', { style: 'flex:1' }, [
          el('div', { class: 'card-title' }, it.title || '(タイトル不明)'),
          el('div', { class: 'card-sub' }, [it.shop, it.date, it.price != null ? `¥${Number(it.price).toLocaleString()}` : ''].filter(Boolean).join(' / ')),
          it.circleName ? el('div', { class: 'card-sub muted' }, it.circleName) : null
        ])
      ]));
      row.__data = it;
      box.appendChild(row);
    });
  }

  async function saveChecked(box) {
    const cards = [...box.querySelectorAll('.card')];
    let count = 0;
    for (const c of cards) {
      const cb = c.querySelector('input[type=checkbox]');
      if (!cb || !cb.checked) continue;
      const it = c.__data;
      await DB.books.save({
        id: uid('book_'),
        title: it.title || '',
        circleName: it.circleName || '',
        authorName: it.authorName || '',
        price: it.price != null ? Number(it.price) : null,
        purchaseDate: it.date || new Date().toISOString().slice(0, 10),
        purchaseLocation: it.shop || '',
        notes: `Gmail取込: ${it.raw || ''}`.slice(0, 500),
        customFields: {},
        sourceMessageId: it.messageId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      count++;
    }
    UI.closeModal();
    UI.toast(`${count}件を登録しました`);
    App.route();
  }

  // ===== Parsers =====
  function decodeBase64Url(s) {
    if (!s) return '';
    try {
      const b = s.replace(/-/g, '+').replace(/_/g, '/');
      const pad = b.length % 4 ? '='.repeat(4 - (b.length % 4)) : '';
      const bin = atob(b + pad);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch (_) { return ''; }
  }
  function getHeaders(msg) {
    const h = {};
    for (const x of (msg.payload && msg.payload.headers) || []) h[x.name.toLowerCase()] = x.value;
    return h;
  }
  function extractBody(payload) {
    if (!payload) return '';
    if (payload.body && payload.body.data) return decodeBase64Url(payload.body.data);
    if (payload.parts) {
      // prefer text/plain
      for (const p of payload.parts) if (p.mimeType === 'text/plain') {
        const b = extractBody(p);
        if (b) return b;
      }
      for (const p of payload.parts) {
        const b = extractBody(p);
        if (b) return b;
      }
    }
    return '';
  }
  function headerDate(h) {
    const d = h.date;
    if (!d) return '';
    const t = new Date(d);
    if (isNaN(t.getTime())) return '';
    const y = t.getFullYear();
    const mo = String(t.getMonth() + 1).padStart(2, '0');
    const da = String(t.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }

  // BOOTH: 商品名と価格を抽出
  function parseBooth(msg) {
    const h = getHeaders(msg);
    const subject = h.subject || '';
    if (!/注文|購入|BOOTH|ご注文|発送/i.test(subject)) return null;
    const body = extractBody(msg.payload).replace(/\r/g, '');
    const items = [];
    // Try to match lines like "商品名 x1 ¥1,000" or similar
    const lineRegex = /^(.{2,100}?)\s*(?:[x×]\s*\d+)?\s*[¥￥]\s*([0-9,]+)/gm;
    let m;
    while ((m = lineRegex.exec(body)) !== null) {
      const title = m[1].replace(/[|・:]/g, '').trim();
      if (!title || /送料|合計|小計|税|ポイント|支払|配送|割引/.test(title)) continue;
      items.push({ title, price: Number(m[2].replace(/,/g, '')) });
      if (items.length > 30) break;
    }
    if (!items.length) items.push({ title: subject.replace(/^.*?[:：】]\s*/, ''), price: null });
    return { subject, date: headerDate(h), items };
  }

  // Generic shop parser — just use subject as title, no price
  function parseGeneric(msg) {
    const h = getHeaders(msg);
    const subject = h.subject || '';
    if (!/注文|購入|発送|お買い上げ|ご購入/i.test(subject)) return null;
    return { subject, date: headerDate(h), items: [{ title: subject, price: null }] };
  }

  return { openImport, signIn };
})();
