// ====== Library（同人誌管理） ======
const Library = (() => {
  const { el, esc } = UI;

  async function render() {
    const container = el('div');
    const [books, fields] = await Promise.all([DB.books.all(), DB.customFields.all()]);

    const head = el('div', { class: 'section-head' }, [
      el('h2', {}, `蔵書：${books.length}冊`),
      el('div', { class: 'row', style: 'flex:0 0 auto; gap:6px' }, [
        el('button', { class: 'btn btn-sm btn-primary', onclick: () => openForm(null, fields) }, '＋追加'),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: () => Gmail.openImport() }, 'Gmail取込')
      ])
    ]);
    container.appendChild(head);

    const searchWrap = el('div', { class: 'searchbar' });
    const input = el('input', { type: 'search', placeholder: '書名・サークル名・作家名で検索' });
    searchWrap.appendChild(input);
    container.appendChild(searchWrap);

    const list = el('div');
    container.appendChild(list);

    function renderList(filter = '') {
      list.innerHTML = '';
      const f = filter.trim().toLowerCase();
      const filtered = !f ? books : books.filter((b) =>
        (b.title || '').toLowerCase().includes(f) ||
        (b.circleName || '').toLowerCase().includes(f) ||
        (b.authorName || '').toLowerCase().includes(f)
      );
      if (!filtered.length) {
        list.appendChild(el('div', { class: 'empty' }, [
          el('h2', {}, books.length ? '該当なし' : 'まだ登録されていません'),
          el('p', { class: 'muted' }, '右上の「＋追加」から登録できます')
        ]));
        return;
      }
      filtered
        .sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''))
        .forEach((b) => list.appendChild(card(b, fields)));
    }

    input.addEventListener('input', () => renderList(input.value));
    renderList();
    return container;
  }

  function card(b, fields) {
    const c = el('div', { class: 'card', onclick: () => openForm(b, fields) });
    c.appendChild(el('div', { class: 'card-title' }, b.title || '(無題)'));
    const sub = [];
    if (b.circleName) sub.push(b.circleName);
    if (b.authorName) sub.push(b.authorName);
    c.appendChild(el('div', { class: 'card-sub' }, sub.join(' / ') || ''));

    const meta = el('div', { class: 'chips' });
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

  function openForm(existing, fields) {
    const b = existing ? { ...existing } : {
      id: uid('book_'),
      title: '', circleName: '', authorName: '',
      price: '', quantity: 1,
      purchaseDate: new Date().toISOString().slice(0, 10),
      purchaseLocation: '', notes: '', customFields: {}
    };

    const body = el('div');

    // ── カメラ OCR ──
    const cameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
    const scanBtn = el('button', { class: 'btn btn-scan btn-block', type: 'button', style: 'margin-bottom:16px' },
      '📷 奥付をカメラで読み取る（自動入力）');
    body.appendChild(cameraInput);
    body.appendChild(scanBtn);

    let ocrLoadingEl = null;
    scanBtn.addEventListener('click', () => cameraInput.click());
    cameraInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      ocrLoadingEl = el('div', { class: 'ocr-loading' }, [
        el('div', { class: 'ocr-spinner' }),
        '文字認識中… 初回は少し時間がかかります'
      ]);
      scanBtn.replaceWith(ocrLoadingEl);
      try {
        const text = await OCR.recognize(file);
        const parsed = OCR.parseColophon(text);
        let filled = 0;
        if (parsed.title) {
          const inp = body.querySelector('[name=title]');
          if (inp && !inp.value) { inp.value = parsed.title; filled++; }
        }
        if (parsed.circleName) {
          const inp = body.querySelector('[name=circleName]');
          if (inp && !inp.value) { inp.value = parsed.circleName; filled++; }
        }
        if (parsed.authorName) {
          const inp = body.querySelector('[name=authorName]');
          if (inp && !inp.value) { inp.value = parsed.authorName; filled++; }
        }
        UI.toast(filled ? `${filled}項目を自動入力しました` : '文字を認識できませんでした');
      } catch (err) {
        UI.toast('読み取りエラー：' + (err.message || '不明なエラー'));
      } finally {
        if (ocrLoadingEl && ocrLoadingEl.parentNode) ocrLoadingEl.replaceWith(scanBtn);
      }
    });

    // ── 基本フィールド ──
    body.appendChild(formField('書名', 'title', b.title));
    body.appendChild(formField('サークル名', 'circleName', b.circleName));
    body.appendChild(formField('作家名', 'authorName', b.authorName));

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
      foot.appendChild(el('button', { class: 'btn btn-danger btn-sm', onclick: async () => {
        if (await UI.confirm('削除してよろしいですか？')) {
          await DB.books.remove(b.id);
          UI.closeModal(); UI.toast('削除しました'); App.route();
        }
      } }, '削除'));
    }
    foot.appendChild(el('div', { style: 'flex:1' }));
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
      const data = collectForm(body);
      data.id = b.id;
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

  // ── ヘルパー ──
  function formField(label, name, value, type = 'text') {
    return el('div', { class: 'field' }, [
      el('label', {}, label),
      el('input', { type, name, value: value == null ? '' : String(value) })
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
    // default: 'select'
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

  return { render, openForm, createFromSpace };
})();
