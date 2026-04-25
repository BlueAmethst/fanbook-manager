// ====== Library（同人誌管理） ======
const Library = (() => {
  const { el, esc } = UI;

  async function render() {
    const container = el('div');
    const [books, fields, characters] = await Promise.all([
      DB.books.all(), DB.customFields.all(), DB.characters.all()
    ]);

    const head = el('div', { class: 'section-head' }, [
      el('h2', {}, `蔵書：${books.length}冊`),
      el('div', { class: 'row', style: 'flex:0 0 auto; gap:6px' }, [
        el('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => openForm(null, fields, characters) }, '＋追加'),
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

    const list = el('div');
    container.appendChild(list);

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

      if (!filtered.length) {
        list.appendChild(el('div', { class: 'empty' }, [
          el('h2', {}, books.length ? '該当なし' : 'まだ登録されていません'),
          el('p', { class: 'muted' }, '右上の「＋追加」から登録できます')
        ]));
        return;
      }
      list.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, `${filtered.length}件`));
      filtered.forEach((b) => list.appendChild(card(b, fields)));
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

  function card(b, fields) {
    const c = el('div', { class: 'card', onclick: () => openFormById(b.id) });
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
    const [book, fields, characters] = await Promise.all([
      DB.books.get(id), DB.customFields.all(), DB.characters.all()
    ]);
    openForm(book, fields, characters);
  }

  function openForm(existing, fields, characters) {
    const b = existing ? { ...existing } : {
      id: uid('book_'),
      title: '', circleName: '', authorName: '',
      twitter: '', couplingLeft: '', couplingRight: '',
      price: '', quantity: 1,
      purchaseDate: new Date().toISOString().slice(0, 10),
      purchaseLocation: '', notes: '', customFields: {}
    };

    const body = el('div');

    // ── カメラ：画像＋OCR結果（案B：コピペ補助） ──
    const cameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
    const scanBtn = el('button', { type: 'button', class: 'btn btn-scan btn-block', style: 'margin-bottom:12px' },
      '📷 奥付を撮影（コピペ補助）');
    const ocrPanel = el('div', { class: 'ocr-panel', style: 'display:none' });
    body.appendChild(cameraInput);
    body.appendChild(scanBtn);
    body.appendChild(ocrPanel);

    scanBtn.addEventListener('click', () => cameraInput.click());
    cameraInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await showOcrPanel(ocrPanel, file);
    });

    // ── 基本フィールド ──
    body.appendChild(formField('書名', 'title', b.title));
    body.appendChild(formField('サークル名', 'circleName', b.circleName));
    body.appendChild(formField('作家名', 'authorName', b.authorName));
    body.appendChild(formField('Twitter (X)', 'twitter', b.twitter, 'text', '@username または URL'));

    // ── カップリング（人名×人名） ──
    body.appendChild(couplingField(b, characters));

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

  // ── OCRパネル：画像＋認識結果からのコピペ ──
  async function showOcrPanel(panel, file) {
    panel.innerHTML = '';
    panel.style.display = '';

    // 画像プレビュー
    const imgUrl = URL.createObjectURL(file);
    const img = el('img', { src: imgUrl, class: 'ocr-image', alt: '撮影した画像' });
    panel.appendChild(img);

    // OCR実行中表示
    const status = el('div', { class: 'ocr-loading' }, [
      el('div', { class: 'ocr-spinner' }), '文字認識中… 初回は少し時間がかかります'
    ]);
    panel.appendChild(status);

    let text = '';
    try {
      text = await OCR.recognize(file);
    } catch (err) {
      status.replaceWith(el('div', { class: 'muted', style: 'padding:10px' }, '読み取り失敗：' + (err.message || '不明')));
      return;
    }
    status.remove();

    panel.appendChild(el('div', { class: 'ocr-help' },
      '↓ 認識結果。各行の📋をタップでコピーできます。下の入力欄に貼り付けてください。'));

    // 行ごとに表示・コピー可能
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) {
      panel.appendChild(el('div', { class: 'muted', style: 'padding:8px' }, '文字を認識できませんでした'));
    } else {
      const linesBox = el('div', { class: 'ocr-lines' });
      for (const line of lines) {
        const row = el('div', { class: 'ocr-line' });
        const txt = el('span', { class: 'ocr-line-text' }, line);
        const btn = el('button', { type: 'button', class: 'ocr-copy-btn', title: 'コピー' }, '📋');
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await copyToClipboard(line);
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = '📋'; }, 1200);
        });
        row.appendChild(txt);
        row.appendChild(btn);
        // 行全体タップでもコピー
        row.addEventListener('click', async () => {
          await copyToClipboard(line);
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = '📋'; }, 1200);
        });
        linesBox.appendChild(row);
      }
      panel.appendChild(linesBox);
    }

    // 編集可能な全文textarea
    panel.appendChild(el('div', { class: 'muted', style: 'font-size:11px;margin-top:8px' }, '全文（編集可・選択コピー可）'));
    panel.appendChild(el('textarea', { class: 'ocr-fulltext', rows: '4' }, text));

    // 閉じるボタン
    const closeBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', style: 'margin-top:6px' }, '撮影パネルを閉じる');
    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
      panel.innerHTML = '';
      URL.revokeObjectURL(imgUrl);
    });
    panel.appendChild(closeBtn);
  }

  async function copyToClipboard(s) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(s);
      } else {
        const ta = document.createElement('textarea');
        ta.value = s;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      UI.toast('コピーしました');
    } catch (_) {
      UI.toast('コピーに失敗しました（手動で選択してください）');
    }
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

  function couplingField(b, characters) {
    const wrap = el('div', { class: 'field' });
    wrap.appendChild(el('label', {}, 'カップリング'));

    const row = el('div', { class: 'coupling-row' });

    const left  = makeCharSelect('couplingLeft',  b.couplingLeft,  characters);
    const cross = el('span', { class: 'coupling-cross' }, '×');
    const right = makeCharSelect('couplingRight', b.couplingRight, characters);

    row.appendChild(left);
    row.appendChild(cross);
    row.appendChild(right);
    wrap.appendChild(row);

    const hint = el('div', { class: 'muted', style: 'font-size:11px;margin-top:4px' },
      '※ 人名は「設定」→「人名（キャラ）リスト」で追加できます');
    wrap.appendChild(hint);
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
