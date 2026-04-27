// ====== Gmail API integration ======
// Google Identity Services トークンフロー（ブラウザ、シークレット不要）
// Scope: gmail.readonly のみ（読み取り専用）
const Gmail = (() => {
  const { el, esc } = UI;
  const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  let gisLoading = null;
  let tokenClient = null;
  let tokenClientId = null;
  let cachedClientId = null;  // メモリキャッシュ（クリック時にDBアクセス不要にする）

  // ── GIS スクリプトを事前ロード（アプリ起動直後に呼ばれる） ──
  function loadGIS() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      return Promise.resolve();
    }
    if (gisLoading) return gisLoading;
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { gisLoading = null; reject(new Error('Google Identity Services 読み込み失敗（ネット接続を確認）')); };
      document.head.appendChild(s);
    });
    return gisLoading;
  }

  // ── tokenClient を事前作成 ──
  function prepareClient(clientId) {
    if (!clientId) return Promise.resolve();
    cachedClientId = clientId;
    return loadGIS().then(() => {
      if (tokenClient && tokenClientId === clientId) return tokenClient;
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: () => {} // 後で上書き
      });
      tokenClientId = clientId;
      return tokenClient;
    });
  }

  // 起動時にClient IDが既に登録されていれば事前準備
  async function autoInit() {
    try {
      const cid = await DB.settings.get('gmailClientId');
      if (cid) {
        cachedClientId = cid;
        await prepareClient(cid);
      }
    } catch (_) {}
  }
  // DOMロード後に自動準備
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  // ── サインイン：クリックハンドラから「同期的に」呼ぶこと（async関数にしない） ──
  // iOSのSafari/Chromeではawaitを挟むとポップアップがブロックされる
  function signInDirect() {
    if (!cachedClientId) {
      // Client ID未登録 → 設定画面へ誘導（裏でDBから読み直しを試みる）
      DB.settings.get('gmailClientId').then((cid) => {
        if (cid) { cachedClientId = cid; prepareClient(cid); }
      });
      UI.toast('先にClient IDを登録してください');
      App.go('settings');
      return;
    }
    if (!tokenClient || tokenClientId !== cachedClientId) {
      // tokenClient未準備 → 裏で準備しつつユーザに再タップを促す
      prepareClient(cachedClientId).then(() => {
        UI.toast('準備完了。もう一度「Googleでログイン」を押してください');
      }).catch((e) => {
        UI.toast('準備失敗：' + (e.message || '不明'));
      });
      UI.toast('ログイン準備中…数秒後に再度押してください');
      return;
    }
    // ★ ここが肝：awaitなしで requestAccessToken を即時呼び出す
    tokenClient.callback = (resp) => {
      if (resp.error) {
        UI.toast('ログイン失敗：' + resp.error);
        return;
      }
      const token = resp.access_token;
      const expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      // 保存はpopup後でOK
      DB.settings.set('gmailToken', { token, expiresAt }).then(() => {
        UI.toast('ログインしました');
        App.route();
      });
    };
    try {
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (e) {
      UI.toast('ログイン起動失敗：' + (e.message || '不明'));
    }
  }

  // 旧API互換（既存呼び出しがあれば動くように）
  function signIn() { signInDirect(); }

  // ── 既存トークンを使うか、対話なしで再取得（バックグラウンド更新は不可な場合あり） ──
  async function ensureToken() {
    const cid = await DB.settings.get('gmailClientId');
    if (!cid) throw new Error('Gmail Client IDが未設定です（設定画面で登録してください）');
    const saved = await DB.settings.get('gmailToken');
    if (saved && saved.token && saved.expiresAt && saved.expiresAt > Date.now() + 60000) {
      return saved.token;
    }
    throw new Error('再ログインが必要です（設定画面の「Googleでログイン」を押してください）');
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

  const SHOP_RULES = [
    {
      key: 'BOOTH',
      senderQuery: 'from:(@booth.pm)',
      displayName: 'BOOTH',
      parse: parseBooth
    },
    {
      key: 'とらのあな',
      senderQuery: 'from:(@toranoana.shop OR @toranoana.jp OR @ec.toranoana.jp)',
      displayName: 'とらのあな',
      parse: parseToranoana
    },
    {
      key: 'メロンブックス',
      senderQuery: 'from:(@melonbooks.co.jp)',
      displayName: 'メロンブックス',
      parse: parseMelonbooks
    }
  ];

  // タイトル正規化（重複判定用）
  function normalizeTitle(s) {
    return String(s || '').trim().toLowerCase()
      .replace(/[\s　]+/g, '')
      .replace(/[「」『』【】（）()〈〉《》・]/g, '');
  }

  async function openImport() {
    let token;
    try {
      token = await ensureToken();
    } catch (e) {
      UI.toast(e.message);
      App.go('settings');
      return;
    }

    const body = el('div');
    body.appendChild(el('p', { class: 'muted', style: 'margin-top:0' },
      '購入確認メールを検索して、候補を表示します。取り込むものにチェックを入れて登録してください。'));

    // 日付範囲（デフォルト：6ヶ月前〜今日）
    const today = new Date().toISOString().slice(0, 10);
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
    const rangeRow = el('div', { class: 'row' });
    rangeRow.appendChild(el('div', { class: 'field' }, [
      el('label', {}, '開始日'),
      el('input', { type: 'date', name: 'fromDate', value: sixMonthsAgo })
    ]));
    rangeRow.appendChild(el('div', { class: 'field' }, [
      el('label', {}, '終了日'),
      el('input', { type: 'date', name: 'toDate', value: today })
    ]));
    body.appendChild(rangeRow);

    // 重複除外オプション
    const dedupRow = el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:10px' });
    const dedupCb = el('input', { type: 'checkbox', id: 'gmail-dedup' });
    dedupCb.checked = true;
    dedupRow.appendChild(dedupCb);
    dedupRow.appendChild(el('label', { for: 'gmail-dedup', style: 'cursor:pointer' },
      '既存の蔵書と同じタイトルを除外する'));
    body.appendChild(dedupRow);

    const runBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block' }, '検索');
    body.appendChild(runBtn);
    const resultBox = el('div', { style: 'margin-top:12px;max-height:50vh;overflow:auto' });
    body.appendChild(resultBox);

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', onclick: UI.closeModal }, '閉じる'));
    const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => saveChecked(resultBox) }, '選択したものを登録');
    saveBtn.style.display = 'none';
    foot.appendChild(saveBtn);

    runBtn.onclick = async () => {
      resultBox.innerHTML = '<div class="muted text-center" style="padding:20px">検索中...</div>';
      saveBtn.style.display = 'none';
      try {
        const fromDate = body.querySelector('[name=fromDate]').value;
        const toDate   = body.querySelector('[name=toDate]').value;
        const dedup    = dedupCb.checked;

        let candidates = await searchAll({ fromDate, toDate });

        if (dedup && candidates.length) {
          const books = await DB.books.all();
          const existing = new Set(books.map((b) => normalizeTitle(b.title)));
          const before = candidates.length;
          candidates = candidates.filter((c) => !existing.has(normalizeTitle(c.title)));
          const skipped = before - candidates.length;
          if (skipped > 0) UI.toast(`重複 ${skipped}件を除外しました`);
        }

        renderCandidates(resultBox, candidates);
        if (candidates.length) saveBtn.style.display = '';
      } catch (e) {
        resultBox.innerHTML = `<div class="empty"><h2>エラー</h2><p class="muted">${esc(e.message)}</p></div>`;
      }
    };

    UI.openModal({ title: 'Gmailから取り込み', body, footer: foot });
  }

  async function searchAll({ fromDate, toDate }) {
    const token = await ensureToken();

    // Gmail クエリ用日付（YYYY/MM/DD 形式）
    const afterStr  = fromDate ? `after:${fromDate.replace(/-/g, '/')}` : '';
    let beforeStr = '';
    if (toDate) {
      // before: は非包括なので翌日を指定して終了日を含める
      const d = new Date(toDate);
      d.setDate(d.getDate() + 1);
      beforeStr = `before:${d.toISOString().slice(0, 10).replace(/-/g, '/')}`;
    }

    const all = [];
    for (const rule of SHOP_RULES) {
      const dateQ = [afterStr, beforeStr].filter(Boolean).join(' ');
      const q = encodeURIComponent(`${rule.senderQuery} ${dateQ}`);
      const list = await apiGet(`/messages?q=${q}&maxResults=50`, token);
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
        twitter: '',
        couplingLeft: '', couplingRight: '',
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

  // 件名にこれらが含まれるメールは除外（仕入・発注・定期便・連絡系）
  const EXCLUDE_SUBJECT = /発注|入荷|仕入|請求書|キャンセル|返品|中止|変更|問い合わせ|お問合せ|定期便|出荷予定|おまとめ内容|出荷予定目安|レビュー|アンケート|メールマガジン/;

  // ── BOOTH パーサー ──
  // 件名：「ご注文の確認 [BOOTH]」
  // 商品行：「<タイトル>: \ <単価> x <数量>点 = \ <小計>」
  // 合計：「合計：\ <総額>」← これを price に使う（送料込み）
  function parseBooth(msg) {
    const h = getHeaders(msg);
    const subject = h.subject || '';
    if (!/ご注文の確認|ご注文ありがとう/i.test(subject)) return null;
    if (EXCLUDE_SUBJECT.test(subject)) return null;
    const body = extractBody(msg.payload).replace(/\r/g, '');

    // 合計（送料込み）を抽出
    let total = null;
    const totalMatch = body.match(/合計[：:]\s*[\\￥¥]?\s*([0-9,]+)/);
    if (totalMatch) total = Number(totalMatch[1].replace(/,/g, ''));

    // 商品タイトルを抽出（[注文内容] セクション以降）
    const titles = [];
    const itemSection = body.split(/\[注文内容\]/)[1] || body;
    const cutEnd = itemSection.split(/\[(?:お支払金額|配送先|お届け先)\]/)[0] || itemSection;
    const itemLines = cutEnd.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of itemLines) {
      // 「<タイトル>: \ 700 x 1点 = \ 700」のパターン
      const m = line.match(/^(.+?):\s*[\\￥¥]\s*[\d,]+\s*[x×]\s*\d+/);
      if (m) titles.push(m[1].trim());
      if (titles.length >= 10) break;
    }

    const title = titles.length
      ? (titles.length === 1 ? titles[0] : `${titles[0]} 他${titles.length - 1}点`)
      : subject.replace(/^.*?[:：】]\s*/, '');

    return {
      subject, date: headerDate(h),
      items: [{ title, price: total }]
    };
  }

  // ── とらのあな パーサー ──
  // 件名：「【株式会社　虎の穴】ご注文受付完了のお知らせ」
  // 商品名：「商品名　　　　：<タイトル>」
  // 商品金額：「商品金額　　　：<金額>円」
  function parseToranoana(msg) {
    const h = getHeaders(msg);
    const subject = h.subject || '';
    if (!/ご注文受付|ご注文完了|発送|お届け|出荷/i.test(subject)) return null;
    if (EXCLUDE_SUBJECT.test(subject)) return null;
    const body = extractBody(msg.payload).replace(/\r/g, '');

    // 「商品名」と「商品金額」のペアを順に拾う（複数商品対応）
    const items = [];
    // 全角スペース・半角スペース両対応
    const titleRegex = /商品名[\s　]*[：:]\s*(.+)/g;
    const priceRegex = /商品金額[\s　]*[：:]\s*([0-9,]+)\s*円/g;
    const titles = [];
    const prices = [];
    let m;
    while ((m = titleRegex.exec(body)) !== null) titles.push(m[1].trim());
    while ((m = priceRegex.exec(body)) !== null) prices.push(Number(m[1].replace(/,/g, '')));

    const len = Math.max(titles.length, prices.length);
    for (let i = 0; i < len; i++) {
      items.push({ title: titles[i] || subject, price: prices[i] != null ? prices[i] : null });
    }
    if (!items.length) items.push({ title: subject.replace(/^.*?】\s*/, ''), price: null });

    return { subject, date: headerDate(h), items };
  }

  // ── メロンブックス パーサー ──
  // 件名：「ご注文の確認(メロンブックス/フロマージュブックス)」
  // 商品名：「商品名: <タイトル>」
  // 合計額（送料込み）：「合計額:1,100円(税込)」← これを price に使う
  function parseMelonbooks(msg) {
    const h = getHeaders(msg);
    const subject = h.subject || '';
    if (!/ご注文の確認|ご注文ありがとう|発送|出荷/i.test(subject)) return null;
    if (EXCLUDE_SUBJECT.test(subject)) return null;
    const body = extractBody(msg.payload).replace(/\r/g, '');

    // 合計額（送料込み）
    let total = null;
    const totalMatch = body.match(/合計額\s*[：:]\s*([0-9,]+)\s*円/);
    if (totalMatch) total = Number(totalMatch[1].replace(/,/g, ''));

    // 商品名を抽出
    const titles = [];
    const titleRegex = /商品名\s*[：:]\s*(.+)/g;
    let m;
    while ((m = titleRegex.exec(body)) !== null) {
      const t = m[1].trim();
      if (t) titles.push(t);
      if (titles.length >= 10) break;
    }

    const title = titles.length
      ? (titles.length === 1 ? titles[0] : `${titles[0]} 他${titles.length - 1}点`)
      : subject.replace(/^.*?[:：】]\s*/, '');

    return {
      subject, date: headerDate(h),
      items: [{ title, price: total }]
    };
  }

  return { openImport, signIn, signInDirect, prepareClient };
})();
