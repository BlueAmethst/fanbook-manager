// ====== Settings ======
const Settings = (() => {
  const { el, esc } = UI;

  const FIELD_TYPES = [
    { value: 'select',   label: '選択肢' },
    { value: 'text',     label: '短文テキスト' },
    { value: 'number',   label: '数字入力' },
    { value: 'textarea', label: '長文・備考' }
  ];

  const SCOPE_OPTIONS = [
    { value: 'both',     label: '🌐 共通',          shortLabel: '共通' },
    { value: 'books',    label: '📚 同人管理のみ',  shortLabel: '同人管理' },
    { value: 'wishlist', label: '🎯 未購入のみ',    shortLabel: '未購入' }
  ];

  async function render() {
    const container = el('div');

    // ──── 人名（キャラ）リスト ────
    container.appendChild(el('h2', {}, '人名（キャラ）リスト'));
    container.appendChild(el('p', { class: 'muted' },
      'カップリング欄で選べる人名を登録します。1行に1人ずつ書いてください。'));
    container.appendChild(el('p', { class: 'muted' },
      '「1枠」に登録した人名は左側（攻め/主）にのみ表示、「2枠」に登録した人名は右側（受け/相手）にのみ表示されます。'));

    const [chars1, chars2] = await Promise.all([DB.characters1.all(), DB.characters2.all()]);

    const chars1Textarea = el('textarea', { style: 'min-height:100px' },
      chars1.map((c) => c.name).join('\n'));
    const chars2Textarea = el('textarea', { style: 'min-height:100px' },
      chars2.map((c) => c.name).join('\n'));

    function makeCharSaveBtn(label, textarea, dbStore) {
      return el('button', {
        type: 'button',
        class: 'btn btn-primary btn-block',
        style: 'margin-top:6px',
        onclick: async () => {
          const lines = textarea.value.split('\n').map((s) => s.trim()).filter(Boolean);
          const seen = new Set();
          const list = [];
          for (const name of lines) {
            if (seen.has(name)) continue;
            seen.add(name);
            list.push({ id: uid('char_'), name });
          }
          await dbStore.save(list);
          UI.toast(`${label} ${list.length}件を保存しました`);
        }
      }, `${label}を保存`);
    }

    const charsRow = el('div', { class: 'coupling-chars-row' });

    const box1 = el('div', { class: 'coupling-chars-box' });
    box1.appendChild(el('div', { class: 'coupling-chars-label' }, '1枠（左側・攻め）'));
    box1.appendChild(el('div', { class: 'field' }, [chars1Textarea]));
    box1.appendChild(makeCharSaveBtn('1枠', chars1Textarea, DB.characters1));

    const box2 = el('div', { class: 'coupling-chars-box' });
    box2.appendChild(el('div', { class: 'coupling-chars-label' }, '2枠（右側・受け）'));
    box2.appendChild(el('div', { class: 'field' }, [chars2Textarea]));
    box2.appendChild(makeCharSaveBtn('2枠', chars2Textarea, DB.characters2));

    charsRow.appendChild(box1);
    charsRow.appendChild(box2);
    container.appendChild(charsRow);

    container.appendChild(el('div', { class: 'hr' }));

    // ──── アプリ設定（リストのカスタマイズ） ────
    container.appendChild(el('h2', {}, 'アプリ設定（選択肢のカスタマイズ）'));
    container.appendChild(el('p', { class: 'muted' },
      '同人管理・未購入リストの「イベント名」「サイズ」「レーティング」の選択肢を自由に変更できます。1行に1つずつ書いてください。'));

    const [eventNames, bookSizes, ratings] = await Promise.all([
      DB.appLists.get('eventNames', DEFAULT_EVENT_NAMES),
      DB.appLists.get('bookSizes',  DEFAULT_BOOK_SIZES),
      DB.appLists.get('ratings',    DEFAULT_RATINGS)
    ]);

    function appListBox(label, list, key, defaultValue, hint) {
      const box = el('div', { class: 'applist-box' });
      box.appendChild(el('div', { class: 'applist-label' }, label));
      if (hint) box.appendChild(el('div', { class: 'muted', style: 'font-size:11px;margin-bottom:4px' }, hint));
      const ta = el('textarea', { style: 'min-height:90px' }, (list || []).join('\n'));
      box.appendChild(el('div', { class: 'field' }, [ta]));
      const btnRow = el('div', { style: 'display:flex;gap:6px' });
      btnRow.appendChild(el('button', {
        type: 'button', class: 'btn btn-primary btn-sm', style: 'flex:1',
        onclick: async () => {
          const lines = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
          const seen = new Set();
          const unique = [];
          for (const v of lines) { if (!seen.has(v)) { seen.add(v); unique.push(v); } }
          await DB.appLists.set(key, unique);
          UI.toast(`${label}を保存しました（${unique.length}件）`);
        }
      }, '保存'));
      btnRow.appendChild(el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm',
        onclick: () => { ta.value = (defaultValue || []).join('\n'); }
      }, '初期値'));
      box.appendChild(btnRow);
      return box;
    }

    const appRow = el('div', { class: 'applist-row' });
    appRow.appendChild(appListBox('イベント名', eventNames, 'eventNames', DEFAULT_EVENT_NAMES,
      '例：スパコミ／コミケ／コミティアなど'));
    appRow.appendChild(appListBox('書籍サイズ', bookSizes, 'bookSizes', DEFAULT_BOOK_SIZES));
    appRow.appendChild(appListBox('レーティング', ratings, 'ratings', DEFAULT_RATINGS));
    container.appendChild(appRow);

    container.appendChild(el('div', { class: 'hr' }));

    // ──── カスタムフィールド ────
    container.appendChild(el('h2', {}, 'カスタムフィールド'));
    container.appendChild(el('p', { class: 'muted' },
      '同人管理／未購入リストで使えるフィールドです。形式と適用範囲を選んで追加できます。'));

    const fields = await DB.customFields.all();
    const fieldList = el('div');
    container.appendChild(fieldList);

    function renderFields() {
      fieldList.innerHTML = '';
      if (!fields.length) {
        fieldList.appendChild(el('div', { class: 'muted', style: 'padding:10px 0' }, 'まだフィールドがありません'));
        return;
      }
      for (const f of fields) {
        const typeDef = FIELD_TYPES.find((t) => t.value === (f.type || 'select')) || FIELD_TYPES[0];
        const scopeDef = SCOPE_OPTIONS.find((s) => s.value === (f.scope || 'both')) || SCOPE_OPTIONS[0];
        const c = el('div', { class: 'card' });
        const titleRow = el('div', { style: 'display:flex;align-items:center;gap:4px;flex-wrap:wrap' });
        titleRow.appendChild(el('span', { class: 'card-title', style: 'margin:0' }, f.name));
        titleRow.appendChild(el('span', { class: 'field-type-badge' }, typeDef.label));
        titleRow.appendChild(el('span', { class: 'field-scope-badge scope-' + (f.scope || 'both') }, scopeDef.label));
        c.appendChild(titleRow);

        if (f.type === 'select' || !f.type) {
          const opts = el('div', { class: 'chips', style: 'margin-top:6px' });
          for (const o of f.options || []) opts.appendChild(el('span', { class: 'chip' }, o));
          c.appendChild(opts);
        }
        const row = el('div', { style: 'display:flex;gap:8px;margin-top:10px' }, [
          el('button', { type: 'button', class: 'btn btn-sm', onclick: () => editField(f, refresh) }, '編集'),
          el('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: async () => {
            if (await UI.confirm(`「${f.name}」を削除しますか？`)) {
              await DB.customFields.remove(f.id);
              fields.splice(fields.findIndex((x) => x.id === f.id), 1);
              renderFields();
            }
          } }, '削除')
        ]);
        c.appendChild(row);
        fieldList.appendChild(c);
      }
    }

    async function refresh() {
      const fresh = await DB.customFields.all();
      fields.length = 0; fields.push(...fresh);
      renderFields();
    }
    renderFields();

    container.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-primary btn-block',
      style: 'margin-top:10px',
      onclick: () => editField(null, refresh)
    }, '＋フィールドを追加'));

    container.appendChild(el('div', { class: 'hr' }));

    // ──── Gmail連携 ────
    container.appendChild(el('h2', {}, 'Gmail連携'));
    const clientId = (await DB.settings.get('gmailClientId')) || '';
    const tokenObj = await DB.settings.get('gmailToken');
    const connected = !!(tokenObj && tokenObj.token);

    container.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-title' }, connected ? '✅ 連携済み' : '未連携'),
      el('div', { class: 'card-sub' }, clientId ? 'クライアントIDは登録済みです' : 'クライアントIDが未設定です')
    ]));

    const cidInput = el('input', {
      type: 'text', id: 'gmail-client-id', value: clientId,
      placeholder: 'xxxxx.apps.googleusercontent.com',
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false'
    });
    container.appendChild(el('div', { class: 'field' }, [
      el('label', {}, 'Google OAuth Client ID'),
      cidInput
    ]));
    container.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-block',
      onclick: async () => {
        const v = cidInput.value.trim();
        if (!v) { UI.toast('Client IDを入力してください'); return; }
        try {
          await DB.settings.set('gmailClientId', v);
          UI.toast('Client IDを保存しました');
          // GISがあれば事前にtokenClientを準備
          if (window.Gmail && Gmail.prepareClient) Gmail.prepareClient(v);
        } catch (err) {
          UI.toast('保存エラー：' + err.message);
        }
      }
    }, 'Client IDを保存'));

    const btnRow = el('div', { class: 'row', style: 'margin-top:10px' });
    btnRow.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-primary btn-block',
      onclick: () => {
        // ★ async/awaitを使わない：iOSのポップアップブロック対策
        Gmail.signInDirect();
      }
    }, connected ? '再ログイン' : 'Googleでログイン'));
    if (connected) {
      btnRow.appendChild(el('button', { type: 'button', class: 'btn btn-danger btn-block', onclick: async () => {
        await DB.settings.set('gmailToken', null);
        UI.toast('ログアウトしました'); App.route();
      } }, 'ログアウト'));
    }
    container.appendChild(btnRow);

    // ──── Gmail 初回設定の手順（最新化） ────
    const guide = el('details', { class: 'grid-config', style: 'margin-top:10px' });
    const origin = location.origin;
    guide.innerHTML = `
      <summary>🔐 Gmail API 初回設定の手順</summary>
      <div style="margin-top:10px;font-size:14px;line-height:1.7">
        <p style="margin:0 0 10px"><b>このアプリのオリジン：</b><code style="background:var(--bg-elev2);padding:2px 6px;border-radius:4px">${esc(origin)}</code></p>
        <ol style="padding-left:20px;margin:0">
          <li><a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> にアクセスしGoogleアカウントでログイン</li>
          <li>上部の「プロジェクトの選択」→「新しいプロジェクト」（例：doujin-manager）</li>
          <li>左メニュー「APIとサービス」→「ライブラリ」で「<b>Gmail API</b>」を検索→有効化</li>
          <li>左メニュー「APIとサービス」→「<b>OAuth同意画面</b>」<br>
            ・User Type：「外部」<br>
            ・アプリ名・サポートメール（自分のGmail）・デベロッパー連絡先（自分のGmail）を入力<br>
            ・「対象」タブで「テストユーザー」に自分のGmailアドレスを追加
          </li>
          <li>左メニュー「APIとサービス」→「<b>認証情報</b>」→「＋認証情報を作成」→「<b>OAuthクライアントID</b>」<br>
            ・アプリケーションの種類：「<b>ウェブアプリケーション</b>」<br>
            ・名前：任意<br>
            ・<b>承認済みのJavaScript生成元</b>に上記オリジン <code>${esc(origin)}</code> を追加<br>
            ・「リダイレクトURI」は不要（このアプリはトークンフロー）
          </li>
          <li>表示された<b>クライアントID</b>を上のフォームに貼り付け→「Client IDを保存」</li>
          <li>「Googleでログイン」を押下</li>
        </ol>
        <p class="muted" style="margin-top:10px">※ クライアントシークレットはブラウザアプリでは使いません。トークンはこの端末内（IndexedDB）にのみ保存されます。</p>
        <p class="muted">※ ポップアップブロックされる場合、ブラウザの設定で <code>${esc(origin)}</code> のポップアップを許可してください。</p>
      </div>
    `;
    container.appendChild(guide);

    container.appendChild(el('div', { class: 'hr' }));

    // ──── データのバックアップ ────
    container.appendChild(el('h2', {}, 'データのバックアップ・書き出し'));
    container.appendChild(el('p', { class: 'muted' }, 'JSONでバックアップ／インポートできます。CSVはExcelで開けます。'));

    const dataRow = el('div', { class: 'row' });
    dataRow.appendChild(el('button', { type: 'button', class: 'btn', onclick: exportAll }, '📦 JSONエクスポート'));
    dataRow.appendChild(el('button', { type: 'button', class: 'btn btn-accent', onclick: exportCSV }, '📊 CSVエクスポート（Excel用）'));

    const importBtn = el('button', { type: 'button', class: 'btn' }, '📥 JSONインポート');
    const importInput = el('input', { type: 'file', accept: '.json', style: 'display:none' });
    importBtn.onclick = () => importInput.click();
    importInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!(await UI.confirm('既存データに上書きしますか？'))) return;
      try {
        const txt = await file.text();
        await importAll(JSON.parse(txt));
        UI.toast('インポート完了'); App.route();
      } catch (err) {
        UI.toast('読み込みエラー：' + err.message);
      }
    };
    dataRow.appendChild(importBtn);
    dataRow.appendChild(importInput);
    container.appendChild(dataRow);

    // ──── バージョン表示 ────
    container.appendChild(el('div', { class: 'hr' }));
    container.appendChild(el('div', { class: 'version-info' },
      `アプリバージョン：${typeof APP_VERSION !== 'undefined' ? APP_VERSION : '不明'}`));

    return container;
  }

  // フィールド追加・編集モーダル
  function editField(existing, refresh) {
    const f = existing ? { ...existing } : { id: uid('cf_'), name: '', type: 'select', scope: 'both', options: [] };
    const body = el('div');

    body.appendChild(el('div', { class: 'field' }, [
      el('label', {}, 'フィールド名'),
      el('input', { type: 'text', name: 'name', value: f.name, placeholder: '例：お気に入り度' })
    ]));

    const typeField = el('div', { class: 'field' }, [el('label', {}, '入力形式')]);
    const typeSel = el('select', { name: 'type' });
    for (const t of FIELD_TYPES) {
      const opt = el('option', { value: t.value }, t.label);
      if ((f.type || 'select') === t.value) opt.selected = true;
      typeSel.appendChild(opt);
    }
    typeField.appendChild(typeSel);
    body.appendChild(typeField);

    // 適用範囲（スコープ）
    const scopeField = el('div', { class: 'field' }, [el('label', {}, '適用範囲')]);
    const scopeSel = el('select', { name: 'scope' });
    for (const s of SCOPE_OPTIONS) {
      const opt = el('option', { value: s.value }, s.label);
      if ((f.scope || 'both') === s.value) opt.selected = true;
      scopeSel.appendChild(opt);
    }
    scopeField.appendChild(scopeSel);
    scopeField.appendChild(el('div', { class: 'muted', style: 'font-size:11px;margin-top:4px' },
      '「共通」は両方に表示されます。同人管理に登録された値は、未購入から購入済みに移動した際そのまま引き継がれます。'));
    body.appendChild(scopeField);

    const optionsWrap = el('div', { id: 'options-wrap' });
    optionsWrap.appendChild(el('div', { class: 'field' }, [
      el('label', {}, '選択肢（1行につき1つ）'),
      el('textarea', { name: 'options', style: 'min-height:100px' }, (f.options || []).join('\n'))
    ]));
    body.appendChild(optionsWrap);

    function toggleOptions() {
      optionsWrap.style.display = typeSel.value === 'select' ? '' : 'none';
    }
    typeSel.addEventListener('change', toggleOptions);
    toggleOptions();

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
      const name = body.querySelector('[name=name]').value.trim();
      if (!name) { UI.toast('フィールド名を入力してください'); return; }
      f.name = name;
      f.type = body.querySelector('[name=type]').value;
      f.scope = body.querySelector('[name=scope]').value || 'both';
      if (f.type === 'select') {
        f.options = body.querySelector('[name=options]').value
          .split('\n').map((x) => x.trim()).filter(Boolean);
      } else {
        f.options = [];
      }
      await DB.customFields.save(f);
      UI.closeModal(); UI.toast('保存しました');
      refresh && refresh();
    } }, '保存'));

    UI.openModal({ title: existing ? 'フィールド編集' : 'フィールド追加', body, footer: foot });
  }

  // ──── エクスポート ────
  async function exportAll() {
    const data = {
      version: 3,
      exportedAt: new Date().toISOString(),
      books: await DB.books.all(),
      events: await DB.events.all(),
      spaces: await DB.getAll(DB.STORES.spaces),
      customFields: await DB.customFields.all(),
      characters: await DB.characters.all(),
      characters1: await DB.characters1.all(),
      characters2: await DB.characters2.all(),
      wishlist: await DB.wishlist.all()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `doujin-manager-${today()}.json`);
  }

  async function exportCSV() {
    const [books, fields] = await Promise.all([DB.books.all(), DB.customFields.all()]);
    const headers = ['書名', 'サークル名', '作家名', 'Twitter', 'カップリング', '金額', '数量', '購入日付', '購入場所', '備考'];
    for (const f of fields) headers.push(f.name);

    const rows = books.map((b) => {
      const cp = (b.couplingLeft && b.couplingRight) ? `${b.couplingLeft}×${b.couplingRight}` : (b.coupling || '');
      const row = [
        b.title || '',
        b.circleName || '',
        b.authorName || '',
        b.twitter || '',
        cp,
        b.price != null ? b.price : '',
        b.quantity || 1,
        b.purchaseDate || '',
        b.purchaseLocation || '',
        b.notes || ''
      ];
      for (const f of fields) row.push((b.customFields && b.customFields[f.id]) || '');
      return row;
    });

    const csvBody = [headers, ...rows].map((row) =>
      row.map((cell) => {
        const s = String(cell).replace(/"/g, '""');
        return /[,"\n]/.test(s) ? `"${s}"` : s;
      }).join(',')
    ).join('\r\n');

    const blob = new Blob(['﻿', csvBody], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `doujin-books-${today()}.csv`);
    UI.toast('CSVを書き出しました');
  }

  async function importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('形式が正しくありません');
    const wipe = async (store) => {
      const all = await DB.getAll(store);
      for (const r of all) await DB.del(store, r.id || r.key);
    };
    await wipe(DB.STORES.books);
    await wipe(DB.STORES.events);
    await wipe(DB.STORES.spaces);
    await wipe(DB.STORES.customFields);
    await wipe(DB.STORES.wishlist);
    for (const b of data.books        || []) await DB.books.save(b);
    for (const e of data.events       || []) await DB.events.save(e);
    for (const s of data.spaces       || []) await DB.spaces.save(s);
    for (const c of data.customFields || []) await DB.customFields.save(c);
    for (const w of data.wishlist     || []) await DB.wishlist.save(w);
    if (Array.isArray(data.characters))  await DB.characters.save(data.characters);
    if (Array.isArray(data.characters1)) await DB.characters1.save(data.characters1);
    if (Array.isArray(data.characters2)) await DB.characters2.save(data.characters2);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  return { render };
})();
