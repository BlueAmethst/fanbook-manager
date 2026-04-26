// ====== Library（同人誌管理） ======
const Library = (() => {
  const { el, esc } = UI;

  async function render() {
    const container = el('div');
    const [books, allFields, chars1, chars2] = await Promise.all([
      DB.books.all(), DB.customFields.all(), DB.characters1.all(), DB.characters2.all()
    ]);
    const fields = filterFieldsByScope(allFields, 'books');

    const head = el('div', { class: 'section-head' }, [
      el('h2', {}, `蔵書：${books.length}冊`),
      el('div', { class: 'row', style: 'flex:0 0 auto; gap:6px' }, [
        el('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => openForm(null, fields, chars1, chars2) }, '＋追加'),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => Gmail.openImport() }, 'Gmail取込')
      ])
    ]);
    container.appendChild(head);

    // ── 検索バー ──
    const searchWrap = el('div', { class: 'searchbar' });
    const input = el('input', { type: 'search', placeholder: '書名・サークル・作家・Twitter・カップリング・備考' });
    searchWrap.appendChild(input);
    container.appendChild(searchWrap);

    // ── フィルタ・ソート ──
    const filterRow = el('div', { class: 'filter-row' });
    const locSel = el('select', { 'aria-label': '購入場所で絞り込み' });
    locSel.appendChild(el('option', { value: '' }, '購入場所：すべて'));
    for (const loc of PURCHASE_LOCATIONS) locSel.appendChild(el('option', { value: loc }, loc));
    const sortSel = el('select', { 'aria-label': '並び替え' });
    [
      ['date_desc', '新しい順'],
      ['date_asc',  '古い順'],
      ['price_desc','金額が高い順'],
      ['price_asc', '金額が安い順'],
      ['title_asc', '書名順']
    ].forEach(([v, l]) => sortSel.appendChild(el('option', { value: v }, l)));
    filterRow.appendChild(locSel);
    filterRow.appendChild(sortSel);
    container.appendChild(filterRow);

    // ── 一括選択モード ──
    const bulkBar = el('div', { class: 'bulk-bar' });
    const selectMode = { on: false, selected: new Set() };
    const toggleBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, '☑ 選択モード');
    const bulkEditBtn = el('button', { type: 'button', class: 'btn btn-sm btn-primary', style: 'display:none' }, '一括設定');
    const bulkDelBtn  = el('button', { type: 'button', class: 'btn btn-sm btn-danger', style: 'display:none' }, '削除');
    const selAllBtn   = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', style: 'display:none' }, '表示中すべて選択');
    const selectedLabel = el('span', { class: 'muted', style: 'font-size:12px' }, '');
    bulkBar.appendChild(toggleBtn);
    bulkBar.appendChild(selAllBtn);
    bulkBar.appendChild(selectedLabel);
    bulkBar.appendChild(bulkEditBtn);
    bulkBar.appendChild(bulkDelBtn);
    container.appendChild(bulkBar);

    const list = el('div');
    container.appendChild(list);

    let lastFiltered = [];

    function updateBulkUI() {
      const n = selectMode.selected.size;
      selectedLabel.textContent = selectMode.on ? `${n}件選択中` : '';
      bulkEditBtn.style.display = (selectMode.on && n > 0) ? '' : 'none';
      bulkDelBtn.style.display  = (selectMode.on && n > 0) ? '' : 'none';
      selAllBtn.style.display   = selectMode.on ? '' : 'none';
      toggleBtn.textContent = selectMode.on ? '✕ 選択解除' : '☑ 選択モード';
    }

    toggleBtn.addEventListener('click', () => {
      selectMode.on = !selectMode.on;
      selectMode.selected.clear();
      renderList();
      updateBulkUI();
    });

    selAllBtn.addEventListener('click', () => {
      const allIds = lastFiltered.map((b) => b.id);
      const allSelected = allIds.every((id) => selectMode.selected.has(id));
      if (allSelected) selectMode.selected.clear();
      else allIds.forEach((id) => selectMode.selected.add(id));
      renderList();
      updateBulkUI();
    });

    bulkEditBtn.addEventListener('click', async () => {
      const ids = [...selectMode.selected];
      const targets = books.filter((b) => ids.includes(b.id));
      Bulk.openBulkEditModal({
        targets, fields, chars1, chars2, mode: 'books',
        onSave: async (patch) => {
          for (const t of targets) Bulk.applyPatch(t, patch);
          for (const t of targets) await DB.books.save(t);
          UI.toast(`${targets.length}件を一括更新しました`);
          App.route();
        }
      });
    });

    bulkDelBtn.addEventListener('click', async () => {
      const ids = [...selectMode.selected];
      if (!ids.length) return;
      if (!(await UI.confirm(`${ids.length}件を削除しますか？`))) return;
      for (const id of ids) await DB.books.remove(id);
      UI.toast(`${ids.length}件を削除しました`);
      App.route();
    });

    function renderList() {
      list.innerHTML = '';
      const q = input.value.trim().toLowerCase();
      const loc = locSel.value;
      const sort = sortSel.value;

      let filtered = books.filter((b) => {
        if (loc && b.purchaseLocation !== loc) return false;
        if (!q) return true;
        const coupling = couplingDisplay(b);
        const haystack = [
          b.title, b.circleName, b.authorName, b.twitter,
          coupling, b.notes, b.purchaseLocation
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });

      filtered.sort((a, b) => {
        switch (sort) {
          case 'date_asc':  return (a.purchaseDate || '').localeCompare(b.purchaseDate || '');
          case 'price_desc':return (Number(b.price) || 0) - (Number(a.price) || 0);
          case 'price_asc': return (Number(a.price) || 0) - (Number(b.price) || 0);
          case 'title_asc': return (a.title || '').localeCompare(b.title || '', 'ja');
          default:          return (b.purchaseDate || '').localeCompare(a.purchaseDate || '');
        }
      });

      lastFiltered = filtered;

      if (!filtered.length) {
        list.appendChild(el('div', { class: 'empty' }, [
          el('h2', {}, books.length ? '該当なし' : 'まだ登録されていません'),
          el('p', { class: 'muted' }, '右上の「＋追加」から登録できます')
        ]));
        return;
      }
      list.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, `${filtered.length}件`));
      filtered.forEach((b) => list.appendChild(card(b, fields, chars1, chars2, selectMode, updateBulkUI)));
    }

    input.addEventListener('input', renderList);
    locSel.addEventListener('change', renderList);
    sortSel.addEventListener('change', renderList);
    renderList();
    return container;
  }

  function couplingDisplay(b) {
    if (b.couplingLeft && b.couplingRight) return `${b.couplingLeft}×${b.couplingRight}`;
    return b.coupling || '';
  }

  function card(b, fields, chars1, chars2, selectMode, updateBulkUI) {
    const c = el('div', {
      class: 'card' + (selectMode && selectMode.on ? ' card-selectable' : ''),
      onclick: () => {
        if (selectMode && selectMode.on) {
          if (selectMode.selected.has(b.id)) selectMode.selected.delete(b.id);
          else selectMode.selected.add(b.id);
          c.classList.toggle('card-selected', selectMode.selected.has(b.id));
          const cb = c.querySelector('.bulk-checkbox');
          if (cb) cb.checked = selectMode.selected.has(b.id);
          updateBulkUI && updateBulkUI();
        } else {
          openFormById(b.id);
        }
      }
    });
    if (selectMode && selectMode.on) {
      const cb = el('input', { type: 'checkbox', class: 'bulk-checkbox' });
      cb.checked = selectMode.selected.has(b.id);
      if (cb.checked) c.classList.add('card-selected');
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        if (cb.checked) selectMode.selected.add(b.id);
        else selectMode.selected.delete(b.id);
        c.classList.toggle('card-selected', cb.checked);
        updateBulkUI && updateBulkUI();
      });
      c.appendChild(cb);
    }
    c.appendChild(el('div', { class: 'card-title' }, b.title || '(無題)'));
    const sub = [];
    if (b.circleName) sub.push(b.circleName);
    if (b.authorName) sub.push(b.authorName);
    c.appendChild(el('div', { class: 'card-sub' }, sub.join(' / ') || ''));

    const meta = el('div', { class: 'chips' });
    const cp = couplingDisplay(b);
    if (cp) meta.appendChild(el('span', { class: 'chip chip-coupling' }, `♡ ${cp}`));
    if (b.twitter) meta.appendChild(el('span', { class: 'chip' }, `𝕏 ${b.twitter}`));
    if (b.purchaseDate)     meta.appendChild(el('span', { class: 'chip' }, b.purchaseDate));
    if (b.purchaseLocation) meta.appendChild(el('span', { class: 'chip' }, b.purchaseLocation));
    if (typeof b.price === 'number' && !isNaN(b.price))
      meta.appendChild(el('span', { class: 'chip' }, `¥${b.price.toLocaleString()}`));
    if ((b.quantity || 1) !== 1)
      meta.appendChild(el('span', { class: 'chip' }, `×${b.quantity}`));
    for (const f of fields || []) {
      const v = b.customFields && b.customFields[f.id];
      if (v) meta.appendChild(el('span', { class: 'chip' }, `${f.name}: ${v}`));
    }
    c.appendChild(meta);
    if (b.notes) c.appendChild(el('div', { class: 'card-body muted' }, b.notes));
    return c;
  }

  async function openFormById(id) {
    const [book, allFields, chars1, chars2] = await Promise.all([
      DB.books.get(id), DB.customFields.all(), DB.characters1.all(), DB.characters2.all()
    ]);
    const fields = filterFieldsByScope(allFields, 'books');
    openForm(book, fields, chars1, chars2);
  }

  function openForm(existing, fields, chars1, chars2) {
    const b = existing ? { ...existing } : {
      id: uid('book_'),
      title: '', circleName: '', authorName: '',
      twitter: '', couplingLeft: '', couplingRight: '',
      price: '', quantity: 1,
      purchaseDate: new Date().toISOString().slice(0, 10),
      purchaseLocation: '', notes: '', customFields: {}
    };

    const body = el('div');

    // ── 奥付テキスト貼り付け（iOS Live Text対応） ──
    const ocrPanel = el('details', { class: 'ocr-paste-panel' });
    ocrPanel.innerHTML = `
      <summary>📋 奥付テキストから自動入力（タップで開く）</summary>
    `;
    const inner = el('div', { class: 'ocr-paste-inner' });
    inner.appendChild(el('div', { class: 'ocr-help' },
      '【楽な手順】iPhoneの写真アプリで画像を開く → 共有ボタン（□に↑） → 「テキストをコピー」→ 下の「📋 クリップボードから貼り付けて解析」を1タップ！'));
    const ocrTextarea = el('textarea', {
      class: 'ocr-paste-textarea',
      placeholder: '奥付の文字を貼り付けまたはクリップボードから自動取込',
      rows: '5'
    });
    inner.appendChild(ocrTextarea);

    const ocrBtnRow = el('div', { class: 'row', style: 'margin-top:6px' });
    const pasteBtn = el('button', { type: 'button', class: 'btn btn-accent btn-block' }, '📋 クリップボードから貼り付けて解析');
    const parseBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block' }, '解析');
    ocrBtnRow.appendChild(pasteBtn);
    ocrBtnRow.appendChild(parseBtn);
    inner.appendChild(ocrBtnRow);

    const parseStatus = el('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' });
    inner.appendChild(parseStatus);
    ocrPanel.appendChild(inner);
    body.appendChild(ocrPanel);

    function runParseColophon(text) {
      if (!text || !text.trim()) { UI.toast('テキストを入力してください'); return; }
      const parsed = OCR.parseColophon(text);
      const targets = ['title', 'circleName', 'authorName', 'twitter'];
      const filled = [];
      for (const k of targets) {
        const inp = body.querySelector(`[name=${k}]`);
        if (inp && parsed[k] && !inp.value) { inp.value = parsed[k]; filled.push(k); }
      }
      if (parsed.price && !body.querySelector('[name=price]').value) {
        body.querySelector('[name=price]').value = parsed.price;
        filled.push('price');
      }
      if (filled.length) {
        parseStatus.textContent = `✅ ${filled.length}項目を自動入力しました`;
        UI.toast(`${filled.length}項目を自動入力`);
      } else {
        parseStatus.textContent = '⚠️ 「タイトル：」「サークル：」「作家：」のような形式が見つかりませんでした。手入力してください。';
      }
    }

    parseBtn.addEventListener('click', () => runParseColophon(ocrTextarea.value || ''));

    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text || !text.trim()) {
          UI.toast('クリップボードが空です。先に写真アプリで「テキストをコピー」してください');
          return;
        }
        ocrTextarea.value = text;
        runParseColophon(text);
      } catch (err) {
        UI.toast('クリップボードを読み取れませんでした。textarea に手動で貼り付けてください');
      }
    });

    // ── 基本フィールド ──
    body.appendChild(formField('書名', 'title', b.title));
    body.appendChild(formField('サークル名', 'circleName', b.circleName));
    body.appendChild(formField('作家名', 'authorName', b.authorName));
    body.appendChild(formField('Twitter (X)', 'twitter', b.twitter, 'text', '@username または URL'));

    // ── カップリング（1枠×2枠） ──
    body.appendChild(couplingField(b, chars1, chars2));

    const priceQtyRow = el('div', { class: 'row' });
    priceQtyRow.appendChild(formField('金額', 'price', b.price, 'number'));
    priceQtyRow.appendChild(quantityField(b.quantity));
    body.appendChild(priceQtyRow);

    body.appendChild(formField('購入日付', 'purchaseDate', b.purchaseDate, 'date'));
    body.appendChild(selectField('購入場所', 'purchaseLocation', b.purchaseLocation, PURCHASE_LOCATIONS));

    // ── カスタムフィールド ──
    for (const f of fields || []) {
      body.appendChild(renderCustomField(f, b.customFields ? b.customFields[f.id] : ''));
    }

    body.appendChild(el('div', { class: 'field' }, [
      el('label', {}, '備考'),
      el('textarea', { name: 'notes' }, b.notes || '')
    ]));

    // ── フッター ──
    const foot = el('div', { style: 'display:flex;gap:10px;flex:1' });
    if (existing) {
      foot.appendChild(el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: async () => {
        if (await UI.confirm('削除してよろしいですか？')) {
          await DB.books.remove(b.id);
          UI.closeModal(); UI.toast('削除しました'); App.route();
        }
      } }, '削除'));
    }
    foot.appendChild(el('div', { style: 'flex:1' }));
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
      const data = collectForm(body);
      data.id = b.id;
      data.couplingLeft  = body.querySelector('[name=couplingLeft]').value || '';
      data.couplingRight = body.querySelector('[name=couplingRight]').value || '';
      data.customFields = {};
      for (const f of fields || []) {
        const node = body.querySelector(`[data-cf="${f.id}"]`);
        if (node) data.customFields[f.id] = node.value || '';
      }
      if (data.price === '' || data.price === null) data.price = null;
      else data.price = Number(data.price);
      data.quantity = Math.max(1, Number(data.quantity) || 1);
      data.updatedAt = new Date().toISOString();
      data.createdAt = existing ? (b.createdAt || data.updatedAt) : data.updatedAt;
      await DB.books.save(data);
      UI.closeModal(); UI.toast('保存しました'); App.route();
    } }, '保存'));

    UI.openModal({ title: existing ? '同人誌を編集' : '同人誌を追加', body, footer: foot });
  }

  // ── カップリングフィールド ──
  function couplingField(b, chars1, chars2) {
    const wrap = el('div', { class: 'field' });
    wrap.appendChild(el('label', {}, 'カップリング'));

    const row = el('div', { class: 'coupling-row' });
    const left  = makeCharSelect('couplingLeft',  b.couplingLeft,  chars1);
    const cross = el('span', { class: 'coupling-cross' }, '×');
    const right = makeCharSelect('couplingRight', b.couplingRight, chars2);

    row.appendChild(left);
    row.appendChild(cross);
    row.appendChild(right);
    wrap.appendChild(row);

    wrap.appendChild(el('div', { class: 'muted', style: 'font-size:11px;margin-top:4px' },
      '1枠（左）・2枠（右）の人名は「設定」→「人名リスト」で登録できます'));
    return wrap;
  }

  // ── ヘルパー ──
  function formField(label, name, value, type = 'text', placeholder = '') {
    return el('div', { class: 'field' }, [
      el('label', {}, label),
      el('input', { type, name, value: value == null ? '' : String(value), placeholder })
    ]);
  }

  function selectField(label, name, value, options) {
    const sel = el('select', { name });
    sel.appendChild(el('option', { value: '' }, '選択してください'));
    for (const o of options) {
      const opt = el('option', { value: o }, o);
      if (value === o) opt.selected = true;
      sel.appendChild(opt);
    }
    return el('div', { class: 'field' }, [el('label', {}, label), sel]);
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
    // 既存値が選択肢に無い場合も保持
    if (value && !matched) {
      const opt = el('option', { value }, value + '（リスト外）');
      opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }

  function quantityField(value = 1) {
    const inp = el('input', { type: 'number', name: 'quantity', value: String(value || 1), min: '1' });
    const dec = el('button', { type: 'button', class: 'qty-btn' }, '−');
    const inc = el('button', { type: 'button', class: 'qty-btn' }, '＋');
    dec.onclick = () => { inp.value = Math.max(1, Number(inp.value) - 1); };
    inc.onclick = () => { inp.value = Number(inp.value) + 1; };
    return el('div', { class: 'field' }, [
      el('label', {}, '数量'),
      el('div', { class: 'quantity-wrap' }, [
        el('span', { style: 'flex:1;font-size:13px;color:var(--text-dim)' }, '冊数'),
        dec, inp, inc
      ])
    ]);
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

  async function createFromSpace(space, event) {
    const item = (space.items && space.items[0]) || space.title || space.circleName || '';
    const book = {
      id: uid('book_'),
      title: item,
      circleName: space.circleName || '',
      authorName: space.authorName || '',
      twitter: space.twitter || '',
      couplingLeft: space.couplingLeft || '',
      couplingRight: space.couplingRight || '',
      price: space.price != null ? Number(space.price) : null,
      quantity: 1,
      purchaseDate: (event && event.date) || new Date().toISOString().slice(0, 10),
      purchaseLocation: 'イベント当日',
      notes: [space.notes, event ? `@${event.name} ${space.label || ''}` : ''].filter(Boolean).join('\n'),
      customFields: space.customFields ? { ...space.customFields } : {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fromSpaceId: space.id
    };
    await DB.books.save(book);
    return book;
  }

  return { render, openForm, openFormById, createFromSpace };
})();
