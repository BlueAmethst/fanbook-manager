// ====== 未購入リスト（ウィッシュリスト：内部名はwishlistのまま） ======
const Wishlist = (() => {
  const { el, esc } = UI;

  // ── CSV インポート／エクスポート 共通定数 ──
  const CSV_HEADERS = ['書名','サークル名','作家名','カップリング左','カップリング右','価格','スペースコード','イベント名','成人向け区分','サイズ','優先度','X（Twitter）','イベントメモ','メモ'];
  const CSV_FIELD_MAP = {
    '書名':'title','サークル名':'circleName','作家名':'authorName',
    'カップリング左':'couplingLeft','カップリング右':'couplingRight',
    '価格':'price','スペースコード':'spaceCode','イベント名':'eventName',
    '成人向け区分':'rating','サイズ':'size','優先度':'priority',
    'X（Twitter）':'twitter','イベントメモ':'eventNotes','メモ':'notes'
  };

  function parseCsvRow(line) {
    const result = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQuote = false;
        } else { cur += ch; }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ',') { result.push(cur); cur = ''; }
        else { cur += ch; }
      }
    }
    result.push(cur);
    return result;
  }

  function parseCsv(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (!lines.length) return { headers: [], rows: [] };
    const headers = parseCsvRow(lines[0]).map((h) => h.trim());
    const rows = lines.slice(1).filter((l) => l.trim()).map((l) => {
      const vals = parseCsvRow(l);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
      return obj;
    });
    return { headers, rows };
  }

  function readCsvFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const bytes = e.target.result;
        let text = new TextDecoder('utf-8').decode(bytes);
        if (text.includes('�')) {
          try { text = new TextDecoder('shift_jis').decode(bytes); } catch (_) {}
        }
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        resolve(text);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function escapeCsvField(val) {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCsvTemplate() {
    const sample = ['例：タイトル','例：サークルABC','例：山田花子','キャラA','キャラB','1000','ナ-37b','コミケ103','全年齢','A5','1','@example','新刊あり',''];
    const csv = '﻿' + CSV_HEADERS.join(',') + '\n' + sample.join(',') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'wishlist_template.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function downloadWishlistCsv(items) {
    const lines = ['﻿' + CSV_HEADERS.join(',')];
    for (const b of items) {
      const row = [
        b.title, b.circleName, b.authorName,
        b.couplingLeft, b.couplingRight,
        b.price != null ? String(b.price) : '',
        b.spaceCode, b.eventName, b.rating,
        b.size || b.format || '',
        b.priority != null ? String(b.priority) : '',
        b.twitter, b.eventNotes, b.notes
      ].map(escapeCsvField);
      lines.push(row.join(','));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8;' }));
    a.download = `wishlist_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  // ── 一覧画面 ──
  async function render() {
    const container = el('div');
    const [items, allFields, chars1, chars2, events, eventNames, bookSizes, ratings, folders] = await Promise.all([
      DB.wishlist.all(), DB.customFields.all(),
      DB.characters1.all(), DB.characters2.all(), DB.events.all(),
      DB.appLists.get('eventNames', DEFAULT_EVENT_NAMES),
      DB.appLists.get('bookSizes',  DEFAULT_BOOK_SIZES),
      DB.appLists.get('ratings',    DEFAULT_RATINGS),
      DB.folders.all()
    ]);
    const fields = filterFieldsByScope(allFields, 'wishlist');
    const appLists = { eventNames, bookSizes, ratings };
    const folderMap = Object.fromEntries(folders.map((f) => [f.id, f]));

    const head = el('div', { class: 'section-head' }, [
      el('h2', {}, `未購入：${items.length}冊`),
      el('div', { class: 'row', style: 'flex:0 0 auto;gap:6px' }, [
        el('button', { type: 'button', class: 'btn btn-sm btn-primary',
          onclick: () => openForm(null, fields, chars1, chars2, events, appLists, folders) }, '＋追加'),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost',
          onclick: () => openImportPanel(fields, chars1, chars2, events, appLists, folders) }, '🖼️ 画像取込')
      ])
    ]);
    container.appendChild(head);

    // CSVボタンバー（スマホで折り返し対応）
    const csvBar = el('div', { style: 'display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap' });
    csvBar.appendChild(el('button', { type: 'button', class: 'btn btn-sm btn-ghost',
      onclick: () => openCsvImportPanel(folders) }, '📋 CSV取込'));
    csvBar.appendChild(el('button', { type: 'button', class: 'btn btn-sm btn-ghost',
      onclick: () => downloadWishlistCsv(currentFilteredItems) }, '📤 CSVダウンロード'));
    container.appendChild(csvBar);

    const searchWrap = el('div', { class: 'searchbar' });
    const input = el('input', { type: 'search', placeholder: '書名・サークル・スペース・カップリング・備考' });
    searchWrap.appendChild(input);
    container.appendChild(searchWrap);

    // ── フィルタ・ソート ──
    const filterRow = el('div', { class: 'filter-row' });
    const folderSel = el('select', { 'aria-label': 'フォルダで絞り込み' });
    folderSel.appendChild(el('option', { value: '' }, 'フォルダ：すべて'));
    folderSel.appendChild(el('option', { value: '__none__' }, 'フォルダなし'));
    for (const f of folders) folderSel.appendChild(el('option', { value: f.id }, f.name));
    const sortSel = el('select', { 'aria-label': '並び替え' });
    [
      ['priority', '優先度順'],
      ['date_desc', '登録が新しい順'],
      ['date_asc',  '登録が古い順']
    ].forEach(([v, l]) => sortSel.appendChild(el('option', { value: v }, l)));
    filterRow.appendChild(folderSel);
    filterRow.appendChild(sortSel);
    container.appendChild(filterRow);

    // ── 一括選択モード ──
    const bulkBar = el('div', { class: 'bulk-bar' });
    const selectMode = { on: false, selected: new Set() };
    const toggleBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, '☑ 選択モード');
    const bulkEditBtn = el('button', { type: 'button', class: 'btn btn-sm btn-primary', style: 'display:none' }, '一括設定');
    const bulkBuyBtn  = el('button', { type: 'button', class: 'btn btn-sm', style: 'display:none;background:var(--success);color:#fff;border-color:var(--success)' }, '購入済みに移動');
    const bulkDelBtn  = el('button', { type: 'button', class: 'btn btn-sm btn-danger', style: 'display:none' }, '削除');
    const selectedLabel = el('span', { class: 'muted', style: 'font-size:12px' }, '');
    bulkBar.appendChild(toggleBtn);
    bulkBar.appendChild(selectedLabel);
    bulkBar.appendChild(bulkEditBtn);
    bulkBar.appendChild(bulkBuyBtn);
    bulkBar.appendChild(bulkDelBtn);
    container.appendChild(bulkBar);

    const list = el('div');
    container.appendChild(list);

    let currentFilteredItems = items.slice();

    function updateBulkUI() {
      const n = selectMode.selected.size;
      selectedLabel.textContent = selectMode.on ? `${n}件選択中` : '';
      bulkEditBtn.style.display = (selectMode.on && n > 0) ? '' : 'none';
      bulkBuyBtn.style.display  = (selectMode.on && n > 0) ? '' : 'none';
      bulkDelBtn.style.display  = (selectMode.on && n > 0) ? '' : 'none';
      toggleBtn.textContent = selectMode.on ? '✕ 選択解除' : '☑ 選択モード';
    }

    toggleBtn.addEventListener('click', () => {
      selectMode.on = !selectMode.on;
      selectMode.selected.clear();
      renderList();
      updateBulkUI();
    });

    bulkEditBtn.addEventListener('click', async () => {
      const ids = [...selectMode.selected];
      const targets = items.filter((it) => ids.includes(it.id));
      await Bulk.openBulkEditModal({
        targets, fields, chars1, chars2, mode: 'wishlist', folders,
        onSave: async (patch) => {
          for (const t of targets) Bulk.applyPatch(t, patch);
          for (const t of targets) await DB.wishlist.save(t);
          UI.toast(`${targets.length}件を一括更新しました`);
          App.route();
        }
      });
    });

    bulkBuyBtn.addEventListener('click', async () => {
      const ids = [...selectMode.selected];
      if (!ids.length) return;
      if (!(await UI.confirm(`${ids.length}件を「購入済み（同人誌管理）」に移動しますか？`))) return;
      let n = 0;
      for (const id of ids) {
        const item = items.find((x) => x.id === id);
        if (!item) continue;
        await markPurchased(item, { silent: true });
        n++;
      }
      UI.toast(`${n}件を同人誌管理へ移動`);
      App.route();
    });

    bulkDelBtn.addEventListener('click', async () => {
      const ids = [...selectMode.selected];
      if (!ids.length) return;
      if (!(await UI.confirm(`${ids.length}件を削除しますか？`))) return;
      for (const id of ids) await DB.wishlist.remove(id);
      UI.toast(`${ids.length}件を削除しました`);
      App.route();
    });

    function renderList() {
      list.innerHTML = '';
      const q = input.value.trim().toLowerCase();
      const fld = folderSel.value;
      const filtered = items.filter((b) => {
        if (fld === '__none__' && b.folderId) return false;
        if (fld && fld !== '__none__' && b.folderId !== fld) return false;
        if (!q) return true;
        const cp = couplingDisplay(b);
        const haystack = [b.title, b.circleName, b.authorName, b.twitter,
          cp, b.notes, b.eventNotes, b.spaceCode, b.eventName].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
      const sort = sortSel.value;
      filtered.sort((a, b) => {
        if (sort === 'priority') {
          const pa = a.priority ? Number(a.priority) : 99;
          const pb = b.priority ? Number(b.priority) : 99;
          if (pa !== pb) return pa - pb;
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        }
        if (sort === 'date_asc') return (a.createdAt || '').localeCompare(b.createdAt || '');
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
      currentFilteredItems = filtered;

      if (!filtered.length) {
        list.appendChild(el('div', { class: 'empty' }, [
          el('h2', {}, items.length ? '該当なし' : 'まだ登録されていません'),
          el('p', { class: 'muted' }, '右上の「＋追加」または「🖼️ 画像取込」から追加できます')
        ]));
        return;
      }
      list.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, `${filtered.length}件`));
      filtered.forEach((b) => list.appendChild(card(b, fields, chars1, chars2, events, appLists, selectMode, updateBulkUI, folders, folderMap)));
    }

    input.addEventListener('input', renderList);
    folderSel.addEventListener('change', renderList);
    sortSel.addEventListener('change', renderList);
    renderList();
    return container;
  }

  function couplingDisplay(b) {
    if (b.couplingLeft && b.couplingRight) return `${b.couplingLeft}×${b.couplingRight}`;
    return '';
  }

  // 優先度ドット
  const PRIORITY_COLORS = { '1': '#B85555', '2': '#C07830', '3': '#A89020', '4': '#4B9B4B', '5': '#888888' };
  const PRIORITY_TO_STATUS = { 1: 'priority', 2: 'want', 3: 'special', 4: 'purchased', 5: 'skip' };

  // 優先度変更をフロアマップスペースに同期
  async function syncPriorityToSpace(item) {
    if (!item.linkedSpaceId || item.priority == null) return;
    const newStatus = PRIORITY_TO_STATUS[Number(item.priority)];
    if (!newStatus) return;
    try {
      const sp = await DB.spaces.get(item.linkedSpaceId);
      if (sp) { sp.status = newStatus; await DB.spaces.save(sp); }
    } catch (_) {}
  }
  function priorityDot(priority) {
    const color = PRIORITY_COLORS[String(priority || '')];
    if (!color) return null;
    return el('span', {
      class: 'priority-dot',
      title: priority === 1 || priority === '1' ? '最優先' : priority === 2 || priority === '2' ? '欲しい' : 'できたら欲しい',
      style: `width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;margin-right:6px;vertical-align:middle`
    });
  }

  function card(b, fields, chars1, chars2, events, appLists, selectMode, updateBulkUI, folders, folderMap) {
    const c = el('div', {
      class: 'card wish-card' + (selectMode.on ? ' card-selectable' : ''),
      style: selectMode.on ? '' : 'cursor:pointer'
    });

    // 選択モード時はチェックボックス
    if (selectMode.on) {
      const cb = el('input', { type: 'checkbox', class: 'bulk-checkbox' });
      cb.checked = selectMode.selected.has(b.id);
      if (cb.checked) c.classList.add('card-selected');
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        if (cb.checked) selectMode.selected.add(b.id);
        else selectMode.selected.delete(b.id);
        c.classList.toggle('card-selected', cb.checked);
        updateBulkUI();
      });
      c.appendChild(cb);
      c.addEventListener('click', () => {
        const cur = !selectMode.selected.has(b.id);
        if (cur) selectMode.selected.add(b.id);
        else selectMode.selected.delete(b.id);
        cb.checked = cur;
        c.classList.toggle('card-selected', cur);
        updateBulkUI();
      });
    } else {
      // 通常モード：タップで編集フォームを開く
      c.addEventListener('click', () => openForm(b, fields, chars1, chars2, events, appLists, folders));
    }

    const main = el('div', { style: 'flex:1' });

    // タイトル行（優先度ドット付き）
    const titleRow = el('div', { style: 'display:flex;align-items:center' });
    const dot = priorityDot(b.priority);
    if (dot) titleRow.appendChild(dot);
    titleRow.appendChild(el('span', { class: 'card-title', style: 'margin:0' }, b.title || '(タイトル未定)'));
    main.appendChild(titleRow);

    const sub = [];
    if (b.circleName) sub.push(b.circleName);
    if (b.authorName) sub.push(b.authorName);
    main.appendChild(el('div', { class: 'card-sub' }, sub.join(' / ') || ''));

    const meta = el('div', { class: 'chips' });
    const folder = folderMap && b.folderId ? folderMap[b.folderId] : null;
    if (folder) {
      meta.appendChild(el('span', {
        class: 'chip chip-folder',
        style: `background:${folder.color || '#888888'};color:#fff;border-color:${folder.color || '#888888'}`
      }, `📁 ${folder.name}`));
    }
    if (b.spaceCode)   meta.appendChild(el('span', { class: 'chip chip-space' }, `📍 ${b.spaceCode}`));
    const cp = couplingDisplay(b);
    if (cp)            meta.appendChild(el('span', { class: 'chip chip-coupling' }, `♡ ${cp}`));
    if (b.eventName)   meta.appendChild(el('span', { class: 'chip' }, b.eventName));
    if (typeof b.price === 'number' && !isNaN(b.price))
      meta.appendChild(el('span', { class: 'chip' }, `¥${b.price.toLocaleString()}`));
    if (b.rating)      meta.appendChild(el('span', { class: 'chip' }, b.rating));
    if (b.size || b.format) meta.appendChild(el('span', { class: 'chip' }, b.size || b.format));
    if (b.twitter)     meta.appendChild(el('span', { class: 'chip' }, `𝕏 ${b.twitter}`));
    main.appendChild(meta);

    if (b.eventNotes) main.appendChild(el('div', { class: 'card-body muted' }, b.eventNotes));

    c.appendChild(main);
    return c;
  }

  // ── 購入済み → 同人誌管理に移動 ──
  async function markPurchased(item, opts = {}) {
    const book = {
      id: uid('book_'),
      title: item.title || '',
      circleName: item.circleName || '',
      authorName: item.authorName || '',
      twitter: item.twitter || '',
      couplingLeft: item.couplingLeft || '',
      couplingRight: item.couplingRight || '',
      price: item.price != null ? Number(item.price) : null,
      quantity: 1,
      purchaseDate: new Date().toISOString().slice(0, 10),
      purchaseLocation: 'イベント当日',
      notes: [
        item.eventName ? `@${item.eventName} ${item.spaceCode || ''}`.trim() : '',
        item.rating ? `[${item.rating}]` : '',
        item.size ? `(${item.size})` : '',
        item.eventNotes,
        item.notes
      ].filter(Boolean).join('\n'),
      customFields: item.customFields ? { ...item.customFields } : {},
      folderId: item.folderId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fromWishlistId: item.id
    };
    await DB.books.save(book);
    await DB.wishlist.remove(item.id);
    // 紐付きスペースのステータスを購入済（緑）に更新
    if (item.linkedSpaceId) {
      try {
        const sp = await DB.spaces.get(item.linkedSpaceId);
        if (sp) { sp.status = 'purchased'; await DB.spaces.save(sp); }
      } catch (_) {}
    }
    if (!opts.silent) UI.toast('同人誌管理に移動しました');
  }

  // ── 編集／追加フォーム ──
  async function openForm(existing, fields, chars1, chars2, events, appLists, folders) {
    appLists = appLists || { eventNames: [], bookSizes: DEFAULT_BOOK_SIZES, ratings: DEFAULT_RATINGS };
    folders = folders || (await DB.folders.all());
    const fcs = await DB.defaultFieldConfig.getMultiple(
      CONFIGURABLE_DEFAULT_FIELDS.filter((d) => d.page === 'both' || d.page === 'wishlist').map((d) => d.key)
    );
    const b = existing ? { ...existing } : {
      id: uid('wish_'),
      title: '', circleName: '', authorName: '',
      twitter: '', couplingLeft: '', couplingRight: '',
      price: '', spaceCode: '', eventName: '',
      rating: '', size: '', priority: null,
      eventNotes: '', notes: '',
      customFields: {}
    };
    // 互換：旧 format → size 抽出
    if (!b.size && b.format) {
      b.size = String(b.format).split('/')[0].trim();
    }

    const body = el('div');

    // X投稿テキスト貼り付けパネル
    const xPanel = el('details', { class: 'ocr-paste-panel', open: existing ? null : '' });
    xPanel.innerHTML = `<summary>📋 X(旧Twitter)投稿テキストから自動入力</summary>`;
    const xInner = el('div', { class: 'ocr-paste-inner' });
    xInner.appendChild(el('div', { class: 'ocr-help' },
      '【楽な手順】iPhoneの写真アプリで画像を開く → 共有ボタン → 「テキストをコピー」→ 下の「📋 クリップボードから貼り付けて解析」を1タップ！'));
    const xTextarea = el('textarea', { class: 'ocr-paste-textarea',
      placeholder: 'Xの投稿テキストを貼り付けまたはクリップボードから自動取込', rows: '5' });
    xInner.appendChild(xTextarea);

    const btnRow = el('div', { class: 'row', style: 'margin-top:6px' });
    const xPasteBtn = el('button', { type: 'button', class: 'btn btn-accent btn-block' }, '📋 クリップボードから貼り付けて解析');
    const xParseBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block' }, '解析');
    btnRow.appendChild(xPasteBtn);
    btnRow.appendChild(xParseBtn);
    xInner.appendChild(btnRow);

    const xStatus = el('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' });
    xInner.appendChild(xStatus);
    xPanel.appendChild(xInner);
    body.appendChild(xPanel);

    function runParse(text) {
      if (!text || !text.trim()) { UI.toast('テキストを入力してください'); return; }
      const parsed = OCR.parseXPost(text, {
        characters1: chars1, characters2: chars2,
        eventNames: appLists.eventNames, bookSizes: appLists.bookSizes, ratings: appLists.ratings
      });
      const filled = [];
      const setIfEmpty = (name, val) => {
        if (!val) return;
        const n = body.querySelector(`[name=${name}]`);
        if (n && !n.value) { n.value = val; filled.push(name); }
      };
      setIfEmpty('title', parsed.title);
      setIfEmpty('spaceCode', parsed.spaceCode);
      setIfEmpty('price', parsed.price);
      setIfEmpty('eventName', parsed.eventName);
      setIfEmpty('rating', parsed.rating);
      setIfEmpty('size', parsed.size);
      setIfEmpty('couplingLeft', parsed.couplingLeft);
      setIfEmpty('couplingRight', parsed.couplingRight);
      if (parsed.eventNotes) {
        const en = body.querySelector('[name=eventNotes]');
        if (en && !en.value) { en.value = parsed.eventNotes; filled.push('eventNotes'); }
      }
      xStatus.textContent = filled.length ? `✅ ${filled.length}項目を自動入力しました（残りは手入力してください）` : '⚠️ 自動入力できる項目が見つかりませんでした';
    }

    xParseBtn.addEventListener('click', () => runParse(xTextarea.value));

    async function tryClipboardPaste(showEmptyToast = true) {
      try {
        const text = await navigator.clipboard.readText();
        if (!text || !text.trim()) {
          if (showEmptyToast) UI.toast('クリップボードが空です。先に写真アプリで「テキストをコピー」してください');
          return false;
        }
        xTextarea.value = text;
        runParse(text);
        return true;
      } catch (err) {
        if (showEmptyToast) UI.toast('クリップボードを読み取れませんでした。textarea に手動で貼り付けてください');
        return false;
      }
    }
    xPasteBtn.addEventListener('click', () => tryClipboardPaste(true));

    body.appendChild(renderDefaultField('title',      '書名',         'title',       b.title,       fcs));
    body.appendChild(renderDefaultField('circleName', 'サークル名',   'circleName',  b.circleName,  fcs));
    body.appendChild(renderDefaultField('authorName', '作家名',       'authorName',  b.authorName,  fcs));
    body.appendChild(renderDefaultField('twitter',    'Twitter (X)', 'twitter',     b.twitter,     fcs,
      { placeholder: '@username または URL' }));

    body.appendChild(couplingField(b, chars1, chars2));

    body.appendChild(renderDefaultField('spaceCode', 'スペース番号', 'spaceCode', b.spaceCode, fcs,
      { placeholder: '例：西2ヤ18b' }));

    body.appendChild(selectField('イベント名', 'eventName', b.eventName, appLists.eventNames,
      '※ 選択肢は「設定」→「アプリ設定」で追加できます'));

    const detailRow = el('div', { class: 'row' });
    detailRow.appendChild(formField('価格', 'price', b.price, 'number'));
    detailRow.appendChild(selectField('レーティング', 'rating', b.rating, appLists.ratings));
    detailRow.appendChild(selectField('サイズ', 'size', b.size, appLists.bookSizes));
    body.appendChild(detailRow);

    body.appendChild(renderDefaultField('eventNotes', 'イベント限定情報・ノベルティ', 'eventNotes',
      b.eventNotes, fcs));

    // ── 優先度 ──
    const pSel = el('select', { name: 'priority' });
    [
      { value: '',  label: '（未設定）' },
      { value: '1', label: '● 最優先', color: '#B85555' },
      { value: '2', label: '● 欲しい', color: '#C07830' },
      { value: '3', label: '● できたら欲しい', color: '#A89020' },
      { value: '4', label: '● 購入済', color: '#4B9B4B' },
      { value: '5', label: '● 購入しない', color: '#888888' }
    ].forEach(({ value, label, color }) => {
      const opt = el('option', { value }, label);
      if (color) opt.style.color = color;
      if (String(b.priority || '') === value) opt.selected = true;
      pSel.appendChild(opt);
    });
    body.appendChild(el('div', { class: 'field' }, [el('label', {}, '優先度'), pSel]));

    // ── フォルダ ──
    const folderSel = el('select', { name: 'folderId' });
    folderSel.appendChild(el('option', { value: '' }, '（なし）'));
    for (const f of folders || []) {
      const opt = el('option', { value: f.id }, f.name);
      if (b.folderId === f.id) opt.selected = true;
      folderSel.appendChild(opt);
    }
    const folderWrap = el('div', { class: 'field' }, [el('label', {}, 'フォルダ'), folderSel]);
    if (!folders || !folders.length) {
      folderWrap.appendChild(el('div', { class: 'muted', style: 'font-size:11px;margin-top:4px' },
        '※ フォルダは「設定」→「フォルダ管理」から追加できます'));
    }
    body.appendChild(folderWrap);

    // カスタムフィールド（同人管理と共通）
    for (const f of fields || []) {
      body.appendChild(renderCustomField(f, b.customFields ? b.customFields[f.id] : ''));
    }

    body.appendChild(renderDefaultField('notes', '備考', 'notes', b.notes, fcs));

    const foot = el('div', { style: 'display:flex;gap:6px;flex:1;flex-wrap:wrap' });
    if (existing) {
      foot.appendChild(el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: async () => {
        if (await UI.confirm('この本を未購入リストから削除しますか？')) {
          await DB.wishlist.remove(b.id);
          UI.closeModal(); UI.toast('削除しました'); App.route();
        }
      } }, '削除'));
      foot.appendChild(el('button', {
        type: 'button', class: 'btn btn-sm',
        style: 'background:var(--success);color:#fff;border-color:var(--success)',
        onclick: async () => {
          await markPurchased(b);
          UI.closeModal(); App.route();
        }
      }, '✅ 購入済み'));
      foot.appendChild(el('button', {
        type: 'button', class: 'btn btn-sm btn-danger',
        onclick: async () => {
          if (await UI.confirm('この本を未購入リストから削除しますか？\n（購入不可だった本など）')) {
            // 紐付きスペースのステータスをスキップ（グレー）に更新
            if (b.linkedSpaceId) {
              try {
                const sp = await DB.spaces.get(b.linkedSpaceId);
                if (sp) { sp.status = 'skip'; await DB.spaces.save(sp); }
              } catch (_) {}
            }
            await DB.wishlist.remove(b.id);
            UI.closeModal(); UI.toast('削除しました'); App.route();
          }
        }
      }, '✕ 購入不可'));
    }
    foot.appendChild(el('div', { style: 'flex:1' }));
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
      const data = collectForm(body);
      data.id = b.id;
      data.couplingLeft = body.querySelector('[name=couplingLeft]').value || '';
      data.couplingRight = body.querySelector('[name=couplingRight]').value || '';
      // 既存のイベント紐付けを維持
      if (b.eventId) data.eventId = b.eventId;
      if (b.linkedSpaceId) data.linkedSpaceId = b.linkedSpaceId;
      // 互換：既存の customFields や旧 format も全カスタムフィールド分マージ
      data.customFields = b.customFields ? { ...b.customFields } : {};
      for (const f of fields || []) {
        const node = body.querySelector(`[data-cf="${f.id}"]`);
        if (node) data.customFields[f.id] = node.value || '';
      }
      if (data.price === '' || data.price === null) data.price = null;
      else data.price = Number(data.price);
      data.priority = data.priority ? Number(data.priority) : null;
      data.folderId = data.folderId || null;
      data.updatedAt = new Date().toISOString();
      data.createdAt = existing ? (b.createdAt || data.updatedAt) : data.updatedAt;
      await DB.wishlist.save(data);
      await syncPriorityToSpace(data);
      UI.closeModal(); UI.toast('保存しました'); App.route();
    } }, '保存'));

    UI.openModal({ title: existing ? '未購入本を編集' : '未購入本を追加', body, footer: foot });

    // 新規追加時のみ、モーダル表示直後にクリップボード自動取込を試行
    if (!existing) {
      setTimeout(() => { tryClipboardPaste(false); }, 100);
    }
  }

  // ── X取込パネル（複数まとめて投入） ──
  function openImportPanel(fields, chars1, chars2, events, appLists, folders) {
    appLists = appLists || { eventNames: [], bookSizes: DEFAULT_BOOK_SIZES, ratings: DEFAULT_RATINGS };
    folders = folders || [];
    const body = el('div');
    body.appendChild(el('div', { class: 'ocr-help' },
      '複数のXポストを「---」「...」「…」のいずれかで区切って貼り付けてください。それぞれ自動解析→候補リストとして表示します。'));
    const ta = el('textarea', { class: 'ocr-paste-textarea', rows: '12',
      placeholder: '投稿1\n\n...\n\n投稿2\n\n...\n\n投稿3' });
    body.appendChild(ta);

    // 一括登録時にデフォルトで割り当てるフォルダ
    const importFolderSel = el('select', { name: 'importFolderId' });
    importFolderSel.appendChild(el('option', { value: '' }, '（フォルダなし）'));
    for (const f of folders || []) {
      importFolderSel.appendChild(el('option', { value: f.id }, f.name));
    }
    body.appendChild(el('div', { class: 'field', style: 'margin-top:6px' },
      [el('label', {}, '登録先フォルダ（取込時に一括適用）'), importFolderSel]));

    const btnRow = el('div', { class: 'row', style: 'margin-top:6px' });
    const pasteBtn = el('button', { type: 'button', class: 'btn btn-accent btn-block' }, '📋 クリップボードから貼り付け');
    const parseBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block' }, '解析');
    btnRow.appendChild(pasteBtn);
    btnRow.appendChild(parseBtn);
    body.appendChild(btnRow);

    const result = el('div', { style: 'margin-top:10px;max-height:50vh;overflow:auto' });
    body.appendChild(result);

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', onclick: UI.closeModal }, '閉じる'));
    const saveBtn = el('button', { type: 'button', class: 'btn btn-primary' }, '選択した候補を一括登録');
    saveBtn.style.display = 'none';
    foot.appendChild(saveBtn);

    function runImportParse() {
      result.innerHTML = '';
      const blocks = ta.value.split(/\n[ \t]*(?:---+|\.{3,}|…+)[ \t]*(?:\n|$)/)
        .map((b) => b.trim()).filter(Boolean);
      return blocks;
    }

    async function tryImportPaste(showEmptyToast = true) {
      try {
        const text = await navigator.clipboard.readText();
        if (!text || !text.trim()) {
          if (showEmptyToast) UI.toast('クリップボードが空です');
          return false;
        }
        ta.value = text;
        // 自動解析もする
        parseBtn.click();
        return true;
      } catch (err) {
        if (showEmptyToast) UI.toast('クリップボードを読み取れませんでした');
        return false;
      }
    }
    pasteBtn.addEventListener('click', () => tryImportPaste(true));

    parseBtn.addEventListener('click', () => {
      const blocks = runImportParse();
      if (!blocks.length) { UI.toast('テキストを入力してください'); return; }
      const candidates = blocks.map((blk) => OCR.parseXPost(blk, {
        characters1: chars1, characters2: chars2,
        eventNames: appLists.eventNames, bookSizes: appLists.bookSizes, ratings: appLists.ratings
      }));
      candidates.forEach((c, i) => {
        const card = el('div', { class: 'card', style: 'padding:10px' });
        const cb = el('input', { type: 'checkbox', checked: 'checked' });
        cb.dataset.idx = i;
        card.appendChild(el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, [
          cb,
          el('div', { style: 'flex:1' }, [
            el('div', { class: 'card-title' }, c.title || '(タイトル未抽出)'),
            el('div', { class: 'card-sub' }, [
              c.spaceCode ? `📍${c.spaceCode}` : '',
              c.couplingLeft && c.couplingRight ? `♡${c.couplingLeft}×${c.couplingRight}` : '',
              c.price ? `¥${Number(c.price).toLocaleString()}` : '',
              c.eventName, c.size, c.rating
            ].filter(Boolean).join(' / '))
          ])
        ]));
        card.__data = c;
        card.__rawText = blocks[i];
        result.appendChild(card);
      });
      if (candidates.length) saveBtn.style.display = '';
    });

    saveBtn.addEventListener('click', async () => {
      const cards = [...result.querySelectorAll('.card')];
      let n = 0;
      for (const c of cards) {
        const cb = c.querySelector('input[type=checkbox]');
        if (!cb || !cb.checked) continue;
        const d = c.__data;
        await DB.wishlist.save({
          id: uid('wish_'),
          title: d.title || '',
          circleName: '',
          authorName: '',
          twitter: '',
          couplingLeft: d.couplingLeft || '',
          couplingRight: d.couplingRight || '',
          price: d.price ? Number(d.price) : null,
          spaceCode: d.spaceCode || '',
          eventName: d.eventName || '',
          rating: d.rating || '',
          size: d.size || '',
          eventNotes: d.eventNotes || '',
          notes: c.__rawText || '',
          customFields: {},
          folderId: importFolderSel.value || null,
          priority: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        n++;
      }
      UI.closeModal();
      UI.toast(`${n}件を未購入リストに登録しました`);
      App.route();
    });

    UI.openModal({ title: '画像テキストから一括取込', body, footer: foot });

    // モーダル開いた直後にクリップボード自動取込を試行
    setTimeout(() => { tryImportPaste(false); }, 100);
  }

  // ── CSVから一括取込 ──
  async function openCsvImportPanel(folders) {
    folders = folders || [];
    const body = el('div');

    // テンプレートDL案内
    const tplRow = el('div', { style: 'margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap' });
    const tplBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, '📥 テンプレートをダウンロード');
    tplBtn.addEventListener('click', downloadCsvTemplate);
    tplRow.appendChild(tplBtn);
    tplRow.appendChild(el('span', { class: 'muted', style: 'font-size:11px' },
      'Excelで記入→「名前をつけて保存」→ファイルの種類「CSV（カンマ区切り）」'));
    body.appendChild(tplRow);

    // ファイル選択
    const fileInput = el('input', { type: 'file', accept: '.csv', style: 'width:100%;margin-bottom:8px' });
    body.appendChild(fileInput);

    // フォルダ選択
    const importFolderSel = el('select', { name: 'importFolderId' });
    importFolderSel.appendChild(el('option', { value: '' }, '（フォルダなし）'));
    for (const f of folders) importFolderSel.appendChild(el('option', { value: f.id }, f.name));
    body.appendChild(el('div', { class: 'field', style: 'margin-bottom:10px' },
      [el('label', {}, '登録先フォルダ（取込時に一括適用）'), importFolderSel]));

    const preview = el('div', { style: 'margin-top:10px;max-height:50vh;overflow:auto' });
    body.appendChild(preview);

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', onclick: UI.closeModal }, '閉じる'));
    const saveBtn = el('button', { type: 'button', class: 'btn btn-primary' }, '選択した行を取込');
    saveBtn.style.display = 'none';
    foot.appendChild(saveBtn);

    let previewTbody = null;

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      preview.innerHTML = '';
      previewTbody = null;
      saveBtn.style.display = 'none';

      let rows;
      try {
        const text = await readCsvFile(file);
        rows = parseCsv(text).rows;
      } catch (err) {
        preview.appendChild(el('div', { style: 'color:var(--danger,#c44);padding:8px' }, `読み込みエラー：${err.message}`));
        return;
      }

      if (!rows.length) {
        preview.appendChild(el('div', { class: 'muted', style: 'padding:8px' }, 'CSVにデータ行がありません'));
        return;
      }

      // 重複チェック用に既存ウィッシュリストを取得
      const existingWishes = await DB.wishlist.all();
      const existingByTitle = new Map(existingWishes.filter((w) => w.title).map((w) => [w.title, w]));

      // 全選択／全解除ボタン行
      const ctrlRow = el('div', { style: 'margin-bottom:6px;display:flex;gap:8px;align-items:center' });
      const selAllBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, '全選択');
      const selNoneBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, '全解除');
      const countInfo = el('span', { class: 'muted', style: 'font-size:11px' }, `${rows.length}行`);
      ctrlRow.appendChild(selAllBtn);
      ctrlRow.appendChild(selNoneBtn);
      ctrlRow.appendChild(countInfo);
      preview.appendChild(ctrlRow);

      // プレビューテーブル
      const table = document.createElement('table');
      table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';

      const thead = table.createTHead();
      const htr = thead.insertRow();
      ['', '状態', '書名', 'サークル', 'スペース', '優先度'].forEach((label) => {
        const th = document.createElement('th');
        th.textContent = label;
        th.style.cssText = 'padding:4px 6px;border-bottom:1px solid var(--border,#ddd);text-align:left;white-space:nowrap';
        htr.appendChild(th);
      });

      const tbody = table.createTBody();
      rows.forEach((row, i) => {
        const title = row['書名'] || '';
        const existing = existingByTitle.get(title);
        const isOverwrite = !!(title && existing);

        const tr = tbody.insertRow();
        tr.style.background = i % 2 === 0 ? '' : 'var(--bg-alt,#f8f8f8)';
        tr.__rowData = row;
        tr.__isOverwrite = isOverwrite;
        tr.__existingItem = existing || null;

        // チェックボックス
        const cbTd = tr.insertCell();
        cbTd.style.cssText = 'padding:4px;text-align:center';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = true;
        cbTd.appendChild(cb);

        // 状態バッジ
        const statusTd = tr.insertCell();
        statusTd.style.padding = '4px';
        const badge = document.createElement('span');
        badge.textContent = isOverwrite ? '上書き' : '新規';
        badge.style.cssText = `display:inline-block;font-size:10px;padding:1px 6px;border-radius:8px;color:#fff;background:${isOverwrite ? '#e8a020' : 'var(--accent,#6BA8A8)'}`;
        statusTd.appendChild(badge);

        // 書名・サークル・スペース・優先度
        [
          title || '（書名なし）',
          row['サークル名'] || '',
          row['スペースコード'] || '',
          row['優先度'] === '1' ? '最優先' : row['優先度'] === '2' ? '欲しい' : row['優先度'] === '3' ? 'できたら' : ''
        ].forEach((text) => {
          const td = tr.insertCell();
          td.textContent = text;
          td.style.cssText = 'padding:4px 6px;color:var(--text,#333);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        });
      });

      preview.appendChild(table);
      previewTbody = tbody;
      saveBtn.style.display = '';

      selAllBtn.addEventListener('click', () => {
        tbody.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = true; });
      });
      selNoneBtn.addEventListener('click', () => {
        tbody.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; });
      });
    });

    saveBtn.addEventListener('click', async () => {
      if (!previewTbody) return;
      const folderId = importFolderSel.value || null;
      let newCount = 0, overwriteCount = 0;

      for (const tr of [...previewTbody.rows]) {
        const cb = tr.querySelector('input[type=checkbox]');
        if (!cb || !cb.checked) continue;
        const row = tr.__rowData;
        const now = new Date().toISOString();
        const price = row['価格'] !== '' ? Number(row['価格']) : null;
        const priority = row['優先度'] !== '' ? Number(row['優先度']) : null;

        if (tr.__isOverwrite && tr.__existingItem) {
          const updated = { ...tr.__existingItem };
          Object.entries(CSV_FIELD_MAP).forEach(([csvKey, field]) => {
            if (field !== 'price' && field !== 'priority' && row[csvKey] !== undefined) {
              updated[field] = row[csvKey] || '';
            }
          });
          updated.price = isNaN(price) ? null : price;
          updated.priority = isNaN(priority) ? null : priority;
          if (folderId !== null) updated.folderId = folderId;
          updated.updatedAt = now;
          await DB.wishlist.save(updated);
          overwriteCount++;
        } else {
          await DB.wishlist.save({
            id: uid('wish_'),
            title: row['書名'] || '',
            circleName: row['サークル名'] || '',
            authorName: row['作家名'] || '',
            twitter: row['X（Twitter）'] || '',
            couplingLeft: row['カップリング左'] || '',
            couplingRight: row['カップリング右'] || '',
            price: isNaN(price) ? null : price,
            spaceCode: row['スペースコード'] || '',
            eventName: row['イベント名'] || '',
            rating: row['成人向け区分'] || '',
            size: row['サイズ'] || '',
            priority: isNaN(priority) ? null : priority,
            eventNotes: row['イベントメモ'] || '',
            notes: row['メモ'] || '',
            customFields: {},
            folderId,
            createdAt: now,
            updatedAt: now
          });
          newCount++;
        }
      }

      UI.closeModal();
      const parts = [];
      if (newCount) parts.push(`新規${newCount}件`);
      if (overwriteCount) parts.push(`上書き${overwriteCount}件`);
      UI.toast(`${parts.join('・')}を登録しました`);
      App.route();
    });

    UI.openModal({ title: 'CSVから一括取込', body, footer: foot });
  }

  // デフォルト項目の入力形式に応じたフィールドレンダリング
  function renderDefaultField(key, label, name, value, fcs, opts = {}) {
    const cfg = fcs[key] || null;
    const def = CONFIGURABLE_DEFAULT_FIELDS.find((d) => d.key === key);
    const type = cfg ? cfg.type : (def ? def.defaultType : 'text');

    if (type === 'select' && cfg && cfg.options && cfg.options.length) {
      const sel = el('select', { name });
      sel.appendChild(el('option', { value: '' }, '（未選択）'));
      let matched = false;
      for (const o of cfg.options) {
        const opt = el('option', { value: o }, o);
        if (value === o) { opt.selected = true; matched = true; }
        sel.appendChild(opt);
      }
      if (value && !matched) {
        const opt = el('option', { value }, value + '（リスト外）');
        opt.selected = true;
        sel.appendChild(opt);
      }
      return el('div', { class: 'field' }, [el('label', {}, label), sel]);
    }
    if (type === 'textarea') {
      return el('div', { class: 'field' }, [
        el('label', {}, label),
        el('textarea', { name, placeholder: opts.placeholder || '' }, value == null ? '' : String(value))
      ]);
    }
    return el('div', { class: 'field' }, [
      el('label', {}, label),
      el('input', { type: 'text', name, value: value == null ? '' : String(value), placeholder: opts.placeholder || '' })
    ]);
  }

  // ── ヘルパー ──
  function formField(label, name, value, type = 'text', placeholder = '') {
    return el('div', { class: 'field' }, [
      el('label', {}, label),
      el('input', { type, name, value: value == null ? '' : String(value), placeholder })
    ]);
  }

  function selectField(label, name, value, options, hint) {
    const sel = el('select', { name });
    sel.appendChild(el('option', { value: '' }, '（未選択）'));
    let matched = false;
    for (const o of options || []) {
      const opt = el('option', { value: o }, o);
      if (value === o) { opt.selected = true; matched = true; }
      sel.appendChild(opt);
    }
    if (value && !matched) {
      const opt = el('option', { value }, value + '（リスト外）');
      opt.selected = true;
      sel.appendChild(opt);
    }
    const wrap = el('div', { class: 'field' }, [el('label', {}, label), sel]);
    if (hint) wrap.appendChild(el('div', { class: 'muted', style: 'font-size:11px;margin-top:4px' }, hint));
    return wrap;
  }

  function couplingField(b, chars1, chars2) {
    const wrap = el('div', { class: 'field' });
    wrap.appendChild(el('label', {}, 'カップリング'));
    const row = el('div', { class: 'coupling-row' });
    row.appendChild(makeCharSelect('couplingLeft', b.couplingLeft, chars1));
    row.appendChild(el('span', { class: 'coupling-cross' }, '×'));
    row.appendChild(makeCharSelect('couplingRight', b.couplingRight, chars2));
    wrap.appendChild(row);
    return wrap;
  }

  function makeCharSelect(name, value, characters) {
    const sel = el('select', { name, class: 'coupling-select' });
    sel.appendChild(el('option', { value: '' }, '（未選択）'));
    let matched = false;
    for (const c of characters || []) {
      const opt = el('option', { value: c.name }, c.name);
      if (value === c.name) { opt.selected = true; matched = true; }
      sel.appendChild(opt);
    }
    if (value && !matched) {
      const opt = el('option', { value }, value + '（リスト外）');
      opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }

  function renderCustomField(f, value) {
    const type = f.type || 'select';
    if (type === 'number') {
      return el('div', { class: 'field' }, [
        el('label', {}, f.name),
        el('input', { type: 'number', 'data-cf': f.id, value: value || '' })
      ]);
    }
    if (type === 'text') {
      return el('div', { class: 'field' }, [
        el('label', {}, f.name),
        el('input', { type: 'text', 'data-cf': f.id, value: value || '', placeholder: f.placeholder || '' })
      ]);
    }
    if (type === 'textarea') {
      return el('div', { class: 'field' }, [
        el('label', {}, f.name),
        el('textarea', { 'data-cf': f.id, style: 'min-height:70px' }, value || '')
      ]);
    }
    const sel = el('select', { 'data-cf': f.id });
    sel.appendChild(el('option', { value: '' }, '（未選択）'));
    for (const o of f.options || []) {
      const opt = el('option', { value: o }, o);
      if (value === o) opt.selected = true;
      sel.appendChild(opt);
    }
    return el('div', { class: 'field' }, [el('label', {}, f.name), sel]);
  }

  function collectForm(root) {
    const data = {};
    root.querySelectorAll('input[name], select[name], textarea[name]').forEach((n) => {
      data[n.name] = n.value;
    });
    return data;
  }

  return { render, openForm, markPurchased };
})();
