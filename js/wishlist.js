// ====== 未購入リスト（ウィッシュリスト：内部名はwishlistのまま） ======
const Wishlist = (() => {
  const { el, esc } = UI;

  // ── 一覧画面 ──
  async function render() {
    const container = el('div');
    const [items, allFields, chars1, chars2, events, eventNames, bookSizes, ratings] = await Promise.all([
      DB.wishlist.all(), DB.customFields.all(),
      DB.characters1.all(), DB.characters2.all(), DB.events.all(),
      DB.appLists.get('eventNames', DEFAULT_EVENT_NAMES),
      DB.appLists.get('bookSizes',  DEFAULT_BOOK_SIZES),
      DB.appLists.get('ratings',    DEFAULT_RATINGS)
    ]);
    const fields = filterFieldsByScope(allFields, 'wishlist');
    const appLists = { eventNames, bookSizes, ratings };

    const head = el('div', { class: 'section-head' }, [
      el('h2', {}, `未購入：${items.length}冊`),
      el('div', { class: 'row', style: 'flex:0 0 auto;gap:6px' }, [
        el('button', { type: 'button', class: 'btn btn-sm btn-primary',
          onclick: () => openForm(null, fields, chars1, chars2, events, appLists) }, '＋追加'),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost',
          onclick: () => openImportPanel(fields, chars1, chars2, events, appLists) }, '📋 X取込')
      ])
    ]);
    container.appendChild(head);

    const searchWrap = el('div', { class: 'searchbar' });
    const input = el('input', { type: 'search', placeholder: '書名・サークル・スペース・カップリング・備考' });
    searchWrap.appendChild(input);
    container.appendChild(searchWrap);

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
        targets, fields, chars1, chars2, mode: 'wishlist',
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
      const filtered = items.filter((b) => {
        if (!q) return true;
        const cp = couplingDisplay(b);
        const haystack = [b.title, b.circleName, b.authorName, b.twitter,
          cp, b.notes, b.eventNotes, b.spaceCode, b.eventName].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
      filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      if (!filtered.length) {
        list.appendChild(el('div', { class: 'empty' }, [
          el('h2', {}, items.length ? '該当なし' : 'まだ登録されていません'),
          el('p', { class: 'muted' }, '右上の「＋追加」または「📋 X取込」から追加できます')
        ]));
        return;
      }
      list.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, `${filtered.length}件`));
      filtered.forEach((b) => list.appendChild(card(b, fields, chars1, chars2, events, appLists, selectMode, updateBulkUI)));
    }

    input.addEventListener('input', renderList);
    renderList();
    return container;
  }

  function couplingDisplay(b) {
    if (b.couplingLeft && b.couplingRight) return `${b.couplingLeft}×${b.couplingRight}`;
    return '';
  }

  function card(b, fields, chars1, chars2, events, appLists, selectMode, updateBulkUI) {
    const c = el('div', { class: 'card wish-card' + (selectMode.on ? ' card-selectable' : '') });

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
      // カード全体タップでも選択切替
      c.addEventListener('click', () => {
        const cur = !selectMode.selected.has(b.id);
        if (cur) selectMode.selected.add(b.id);
        else selectMode.selected.delete(b.id);
        cb.checked = cur;
        c.classList.toggle('card-selected', cur);
        updateBulkUI();
      });
    }

    const main = el('div', { style: 'flex:1' });
    main.appendChild(el('div', { class: 'card-title' }, b.title || '(タイトル未定)'));

    const sub = [];
    if (b.circleName) sub.push(b.circleName);
    if (b.authorName) sub.push(b.authorName);
    main.appendChild(el('div', { class: 'card-sub' }, sub.join(' / ') || ''));

    const meta = el('div', { class: 'chips' });
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

    // 購入済み・購入不可・編集ボタン
    if (!selectMode.on) {
      const btnRow = el('div', { class: 'wish-btn-row' });
      btnRow.appendChild(el('button', { type: 'button', class: 'btn btn-sm', style: 'background:var(--success);color:#fff;border-color:var(--success)',
        onclick: async (e) => { e.stopPropagation(); await markPurchased(b); App.route(); } }, '✅ 購入済み'));
      btnRow.appendChild(el('button', { type: 'button', class: 'btn btn-sm btn-danger',
        onclick: async (e) => {
          e.stopPropagation();
          if (await UI.confirm('この本を未購入リストから削除しますか？\n（購入不可だった本など）')) {
            await DB.wishlist.remove(b.id);
            UI.toast('削除しました'); App.route();
          }
        } }, '✕ 購入不可'));
      btnRow.appendChild(el('button', { type: 'button', class: 'btn btn-sm btn-ghost',
        onclick: (e) => { e.stopPropagation(); openForm(b, fields, chars1, chars2, events, appLists); } }, '✎ 編集'));
      main.appendChild(btnRow);
    }

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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fromWishlistId: item.id
    };
    await DB.books.save(book);
    await DB.wishlist.remove(item.id);
    if (!opts.silent) UI.toast('同人誌管理に移動しました');
  }

  // ── 編集／追加フォーム ──
  function openForm(existing, fields, chars1, chars2, events, appLists) {
    appLists = appLists || { eventNames: [], bookSizes: DEFAULT_BOOK_SIZES, ratings: DEFAULT_RATINGS };
    const b = existing ? { ...existing } : {
      id: uid('wish_'),
      title: '', circleName: '', authorName: '',
      twitter: '', couplingLeft: '', couplingRight: '',
      price: '', spaceCode: '', eventName: '',
      rating: '', size: '',
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

    xPasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text || !text.trim()) {
          UI.toast('クリップボードが空です。先に写真アプリで「テキストをコピー」してください');
          return;
        }
        xTextarea.value = text;
        runParse(text);
      } catch (err) {
        UI.toast('クリップボードを読み取れませんでした。textarea に手動で貼り付けてください');
      }
    });

    body.appendChild(formField('書名', 'title', b.title));
    body.appendChild(formField('サークル名', 'circleName', b.circleName));
    body.appendChild(formField('作家名', 'authorName', b.authorName));
    body.appendChild(formField('Twitter (X)', 'twitter', b.twitter, 'text', '@username または URL'));

    body.appendChild(couplingField(b, chars1, chars2));

    body.appendChild(formField('スペース番号', 'spaceCode', b.spaceCode, 'text', '例：西2ヤ18b'));

    body.appendChild(selectField('イベント名', 'eventName', b.eventName, appLists.eventNames,
      '※ 選択肢は「設定」→「アプリ設定」で追加できます'));

    const detailRow = el('div', { class: 'row' });
    detailRow.appendChild(formField('価格', 'price', b.price, 'number'));
    detailRow.appendChild(selectField('レーティング', 'rating', b.rating, appLists.ratings));
    detailRow.appendChild(selectField('サイズ', 'size', b.size, appLists.bookSizes));
    body.appendChild(detailRow);

    body.appendChild(el('div', { class: 'field' }, [
      el('label', {}, 'イベント限定情報・ノベルティ'),
      el('textarea', { name: 'eventNotes', style: 'min-height:60px' }, b.eventNotes || '')
    ]));

    // カスタムフィールド（同人管理と共通）
    for (const f of fields || []) {
      body.appendChild(renderCustomField(f, b.customFields ? b.customFields[f.id] : ''));
    }

    body.appendChild(el('div', { class: 'field' }, [
      el('label', {}, '備考'),
      el('textarea', { name: 'notes' }, b.notes || '')
    ]));

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1' });
    if (existing) {
      foot.appendChild(el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: async () => {
        if (await UI.confirm('この本を未購入リストから削除しますか？')) {
          await DB.wishlist.remove(b.id);
          UI.closeModal(); UI.toast('削除しました'); App.route();
        }
      } }, '削除'));
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
      data.updatedAt = new Date().toISOString();
      data.createdAt = existing ? (b.createdAt || data.updatedAt) : data.updatedAt;
      await DB.wishlist.save(data);
      UI.closeModal(); UI.toast('保存しました'); App.route();
    } }, '保存'));

    UI.openModal({ title: existing ? '未購入本を編集' : '未購入本を追加', body, footer: foot });
  }

  // ── X取込パネル（複数まとめて投入） ──
  function openImportPanel(fields, chars1, chars2, events, appLists) {
    appLists = appLists || { eventNames: [], bookSizes: DEFAULT_BOOK_SIZES, ratings: DEFAULT_RATINGS };
    const body = el('div');
    body.appendChild(el('div', { class: 'ocr-help' },
      '複数のXポストを「---」（ハイフン3つ）で区切って貼り付けてください。それぞれ自動解析→候補リストとして表示します。'));
    const ta = el('textarea', { class: 'ocr-paste-textarea', rows: '12',
      placeholder: '投稿1\n\n---\n\n投稿2\n\n---\n\n投稿3' });
    body.appendChild(ta);

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

    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text || !text.trim()) {
          UI.toast('クリップボードが空です');
          return;
        }
        ta.value = text;
        UI.toast('貼り付け完了。「解析」を押してください');
      } catch (err) {
        UI.toast('クリップボードを読み取れませんでした');
      }
    });

    parseBtn.addEventListener('click', () => {
      result.innerHTML = '';
      const blocks = ta.value.split(/\n\s*---+\s*\n/).map((b) => b.trim()).filter(Boolean);
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        n++;
      }
      UI.closeModal();
      UI.toast(`${n}件を未購入リストに登録しました`);
      App.route();
    });

    UI.openModal({ title: 'X投稿から一括取込', body, footer: foot });
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
