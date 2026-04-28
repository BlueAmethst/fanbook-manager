// ====== Floor Map（複数フロア対応） ======
const FloorMap = (() => {
  const { el, esc } = UI;

  const defaultGrid = {
    rows: 6, cols: 10,
    offsetX: 20, offsetY: 20,
    cellWidth: 50, cellHeight: 40,
    gapX: 6, gapY: 6,
    labelPrefix: 'A-', labelStart: 1, labelPad: 2,
    labelMode: 'sequential'
  };

  let currentMode = 'check';

  const defaultSpaceSize = { w: 64, h: 34 };
  let _freeformInner = null; // 位置変更用 参照

  // ── フロア配列の取得（古いデータを自動移行） ──
  async function getOrMigrateFloors(event) {
    if (event.floors && event.floors.length > 0) {
      // 既存フロアに mode が無ければ grid を補完
      let changed = false;
      for (const fl of event.floors) {
        if (!fl.mode) { fl.mode = 'grid'; changed = true; }
      }
      if (changed) await DB.events.save(event);
      return event.floors;
    }
    const floor = {
      id: uid('floor_'),
      name: 'メインフロア',
      mode: 'grid',
      image: event.floorMapImage || null,
      gridConfig: event.gridConfig || null
    };
    event.floors = [floor];
    await DB.events.save(event);
    return event.floors;
  }

  // ── そのフロアのスペースだけ返す（旧データは最初のフロアに属す） ──
  async function getFloorSpaces(eventId, floorId, floors) {
    const all = await DB.spaces.byEvent(eventId);
    const isFirst = floors && floors[0] && floors[0].id === floorId;
    return all.filter((sp) => {
      if (sp.floorId) return sp.floorId === floorId;
      return isFirst;
    });
  }

  // ── メインマウント ──
  async function mount(parent, event) {
    const fields = await DB.customFields.all();
    const floors = await getOrMigrateFloors(event);
    let activeFloor = floors[0];

    const tabRow = el('div', { class: 'floor-tabs' });
    parent.appendChild(tabRow);

    const controls = el('div', { class: 'floormap-controls' });
    parent.appendChild(controls);

    const legendEl = el('div', { class: 'legend' });
    parent.appendChild(legendEl);
    renderLegend(legendEl);

    const mapArea = el('div');
    parent.appendChild(mapArea);

    // ── タブ描画 ──
    function renderTabs() {
      tabRow.innerHTML = '';
      for (const fl of floors) {
        const tab = el('button', {
          class: 'floor-tab' + (fl.id === activeFloor.id ? ' active' : ''),
          onclick: () => switchFloor(fl)
        }, fl.name);
        tabRow.appendChild(tab);
      }
      // ギア（フロア設定）
      tabRow.appendChild(el('button', {
        class: 'btn btn-sm btn-ghost',
        style: 'padding:4px 8px;font-size:15px;min-height:auto;box-shadow:none',
        onclick: () => openFloorSettings(activeFloor, floors, event, async (action) => {
          if (action === 'deleted') {
            activeFloor = floors[0];
          }
          renderTabs();
          await loadFloor(activeFloor);
        })
      }, '⚙'));
      // ＋フロア追加
      tabRow.appendChild(el('button', {
        class: 'floor-tab-add',
        onclick: () => addFloor(floors, event, async (newFloor) => {
          activeFloor = newFloor;
          renderTabs();
          await loadFloor(newFloor);
        })
      }, '＋ 追加'));
    }

    async function switchFloor(floor) {
      activeFloor = floor;
      renderTabs();
      await loadFloor(floor);
    }

    async function loadFloor(floor) {
      controls.innerHTML = '';
      mapArea.innerHTML = '';

      // モード切替
      const modeSwitch = el('div', { class: 'mode-switch' });
      for (const [key, label] of [['check','チェック'], ['info','情報'], ['edit','編集']]) {
        modeSwitch.appendChild(el('button', {
          class: currentMode === key ? 'active' : '',
          onclick: () => { currentMode = key; refreshMode(); }
        }, label));
      }
      controls.appendChild(modeSwitch);

      // 地図アップロード
      const uploadInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
      uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        floor.image = await fileToDataUrl(file);
        await DB.events.save(event);
        renderMap();
        UI.toast('地図を更新しました');
      });
      controls.appendChild(el('button', {
        class: 'btn btn-sm',
        onclick: () => uploadInput.click()
      }, '🗺 地図を変更'));
      controls.appendChild(uploadInput);
      if (floor.image) {
        controls.appendChild(el('button', {
          class: 'btn btn-sm btn-ghost',
          style: 'color:var(--status-priority)',
          onclick: async () => {
            if (!(await UI.confirm('地図画像を削除しますか？\nスペースの位置情報は残ります。'))) return;
            floor.image = null;
            const idx = event.floors.findIndex((f) => f.id === floor.id);
            if (idx !== -1) event.floors[idx] = floor;
            await DB.events.save(event);
            renderMap();
            UI.toast('地図を削除しました');
          }
        }, '🗑 地図を削除'));
      }
      if (floor.mode === 'freeform') {
        controls.appendChild(el('button', {
          class: 'btn btn-sm',
          onclick: () => openSpaceSizeConfig(floor, event, renderMap)
        }, 'スペースサイズ'));

        // JSONインポート
        const jsonInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
        jsonInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            const text = await file.text();
            const data = JSON.parse(text);
            const n = await importJsonSpaces(event, floor, data);
            UI.toast(`${n} 件のスペースを取り込みました`);
            await reload();
          } catch (err) {
            UI.toast('JSON読込エラー：' + (err.message || err));
          } finally {
            jsonInput.value = '';
          }
        });
        controls.appendChild(el('button', {
          class: 'btn btn-sm',
          onclick: () => jsonInput.click()
        }, '📥 JSON取込'));
        controls.appendChild(jsonInput);

        controls.appendChild(el('button', {
          class: 'btn btn-sm',
          onclick: () => showJsonFormatHelp()
        }, '❓ JSON形式'));

        // スクショ
        controls.appendChild(el('button', {
          class: 'btn btn-sm',
          onclick: () => exportFloorScreenshot(floor, spaces, event.name || 'event')
        }, '📷 スクショ保存'));
      } else {
        controls.appendChild(el('button', {
          class: 'btn btn-sm',
          onclick: () => openGridConfig(floor, event, renderMap)
        }, 'グリッド設定'));
      }

      // マップ
      const mapWrap = el('div', { class: 'floormap-wrap' });
      mapArea.appendChild(mapWrap);

      const spaces = await getFloorSpaces(event.id, floor.id, floors);
      const spaceMap = buildSpaceMap(spaces);

      async function reload() {
        const fresh = await getFloorSpaces(event.id, floor.id, floors);
        spaces.length = 0; spaces.push(...fresh);
        const m = buildSpaceMap(fresh);
        for (const k of Object.keys(spaceMap)) delete spaceMap[k];
        Object.assign(spaceMap, m);
        renderMap();
      }

      function refreshMode() {
        [...modeSwitch.children].forEach((btn, i) => {
          const keys = ['check','info','edit'];
          btn.classList.toggle('active', keys[i] === currentMode);
        });
        renderMap();
      }

      function renderMap() {
        mapWrap.innerHTML = '';
        const inner = el('div', { class: 'floormap' });
        mapWrap.appendChild(inner);

        if (floor.mode === 'freeform') {
          if (!floor.image) {
            inner.appendChild(el('div', {
              style: 'padding:24px;color:var(--text-dim);font-size:14px'
            }, '先に「🗺 地図を変更」から地図画像をアップロードしてください。'));
            return;
          }
          const img = el('img', { src: floor.image, alt: '' });
          inner.appendChild(img);
          const place = () => placeFreeformButtons(inner, floor, event, spaces, fields, reload, img.naturalWidth, img.naturalHeight);
          img.onload = place;
          if (img.complete && img.naturalWidth) place();
          return;
        }

        // ── grid モード ──
        if (floor.image) {
          const img = el('img', { src: floor.image, alt: '' });
          inner.appendChild(img);
          const place = () => placeButtons(inner, floor, event, spaceMap, fields, reload, img.naturalWidth, img.naturalHeight);
          img.onload = place;
          if (img.complete) place();
        } else {
          const gcfg = floor.gridConfig || defaultGrid;
          const w = gcfg.offsetX * 2 + gcfg.cols * (gcfg.cellWidth + gcfg.gapX);
          const h = gcfg.offsetY * 2 + gcfg.rows * (gcfg.cellHeight + gcfg.gapY);
          inner.style.width = w + 'px';
          inner.style.height = h + 'px';
          inner.style.background = 'var(--bg-elev2)';
          placeButtons(inner, floor, event, spaceMap, fields, reload, w, h);
        }
      }

      renderMap();
    }

    renderTabs();
    await loadFloor(activeFloor);
  }

  // ── フロア追加 ──
  async function addFloor(floors, event, onAdded) {
    const body = el('div');
    body.appendChild(el('div', { class: 'field' }, [
      el('label', {}, 'フロア名（例：西棟・モ列・3F など）'),
      el('input', { type: 'text', name: 'floorName', value: '' })
    ]));
    const modeFld = el('div', { class: 'field' }, [el('label', {}, '配置モード')]);
    const modeSel = el('select', { name: 'floorMode' });
    for (const [v, l] of [
      ['grid', '均等グリッド（行×列の規則的な配置）'],
      ['freeform', 'フリーフォーム（地図画像の上に任意配置）']
    ]) {
      const opt = el('option', { value: v }, l);
      modeSel.appendChild(opt);
    }
    modeFld.appendChild(modeSel);
    body.appendChild(modeFld);
    body.appendChild(el('p', { class: 'muted', style: 'font-size:12px;margin-top:0' },
      'フリーフォームは地図画像必須。スパコミなど複雑なレイアウト向け。'));

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
      const name = body.querySelector('[name=floorName]').value.trim();
      if (!name) { UI.toast('フロア名を入力してください'); return; }
      const mode = body.querySelector('[name=floorMode]').value;
      const newFloor = { id: uid('floor_'), name, mode, image: null, gridConfig: null };
      floors.push(newFloor);
      event.floors = floors;
      await DB.events.save(event);
      UI.closeModal();
      UI.toast(`「${name}」を追加しました`);
      onAdded && onAdded(newFloor);
    } }, '追加'));

    UI.openModal({ title: 'フロアを追加', body, footer: foot });
  }

  // ── フロア設定（名前変更・削除） ──
  function openFloorSettings(floor, floors, event, onAction) {
    const body = el('div');
    body.appendChild(el('div', { class: 'field' }, [
      el('label', {}, 'フロア名'),
      el('input', { type: 'text', name: 'floorName', value: floor.name })
    ]));

    // 配置モード
    const modeFld = el('div', { class: 'field' }, [el('label', {}, '配置モード')]);
    const modeSel = el('select', { name: 'floorMode' });
    for (const [v, l] of [
      ['grid', '均等グリッド'],
      ['freeform', 'フリーフォーム（地図上に任意配置）']
    ]) {
      const opt = el('option', { value: v }, l);
      if ((floor.mode || 'grid') === v) opt.selected = true;
      modeSel.appendChild(opt);
    }
    modeFld.appendChild(modeSel);
    body.appendChild(modeFld);
    body.appendChild(el('p', { class: 'muted', style: 'font-size:12px;margin-top:0' },
      'モードを切替えても既存スペース情報は残ります（位置情報の互換性に注意）。'));

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1' });
    if (floors.length > 1) {
      foot.appendChild(el('button', { class: 'btn btn-danger btn-sm', onclick: async () => {
        if (!(await UI.confirm(`「${floor.name}」とそのスペース情報を削除しますか？`))) return;
        // このフロアのスペースを削除
        const all = await DB.spaces.byEvent(event.id);
        const isFirst = floors[0].id === floor.id;
        for (const sp of all) {
          if (sp.floorId === floor.id || (!sp.floorId && isFirst)) {
            await DB.spaces.remove(sp.id);
          }
        }
        const idx = floors.findIndex((f) => f.id === floor.id);
        if (idx !== -1) floors.splice(idx, 1);
        event.floors = floors;
        await DB.events.save(event);
        UI.closeModal();
        UI.toast('削除しました');
        onAction && onAction('deleted');
      } }, '削除'));
    }
    foot.appendChild(el('div', { style: 'flex:1' }));
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
      const newName = body.querySelector('[name=floorName]').value.trim();
      if (!newName) { UI.toast('フロア名を入力してください'); return; }
      floor.name = newName;
      floor.mode = body.querySelector('[name=floorMode]').value || 'grid';
      event.floors = floors;
      await DB.events.save(event);
      UI.closeModal();
      UI.toast('更新しました');
      onAction && onAction('renamed');
    } }, '保存'));

    UI.openModal({ title: 'フロアの設定', body, footer: foot });
  }

  // ラベルから列プレフィックスを除去（例：「モ-31」→「31」）
  function stripLabelPrefix(label) {
    return (label || '').replace(/^[^-]+-/, '');
  }

  // ── ボタン配置（フリーフォーム） ──
  function placeFreeformButtons(inner, floor, event, spaces, fields, reload, imgW, imgH) {
    _freeformInner = inner;
    [...inner.querySelectorAll('.space-btn, .grid-layer')].forEach((n) => n.remove());
    const layer = el('div', {
      class: 'grid-layer' + (currentMode === 'edit' ? ' freeform-edit' : '')
    });
    layer.style.width = imgW + 'px';
    layer.style.height = imgH + 'px';
    inner.appendChild(layer);

    const size = floor.spaceSize || defaultSpaceSize;
    const groups = groupSpacesByLabel(spaces);

    for (const key of Object.keys(groups)) {
      const group = groups[key];
      const anchor = group[0];
      if (anchor.xPct == null || anchor.yPct == null) continue;
      const cx = (anchor.xPct / 100) * imgW;
      const cy = (anchor.yPct / 100) * imgH;

      // a/b ペアか単独かで分割
      const sorted = group.slice().sort((p, q) => (p.subLabel || '').localeCompare(q.subLabel || ''));
      const count = Math.min(sorted.length, 2);
      for (let i = 0; i < count; i++) {
        const sp = sorted[i];
        const w = count === 2 ? Math.floor(size.w / 2) : size.w;
        const h = size.h;
        const x = cx - size.w / 2 + (count === 2 ? i * w : 0);
        const y = cy - h / 2;
        const status = sp.status || 'none';
        const numPart = stripLabelPrefix(sp.label) + (sp.subLabel || '');
        const display = (sp.authorName && sp.authorName.trim())
          ? sp.authorName : numPart;
        const titleText = (sp.label || '') + (sp.subLabel || '')
          + (sp.circleName ? `\n${sp.circleName}` : '')
          + (sp.authorName ? `\n${sp.authorName}` : '');
        const btn = el('button', {
          class: `space-btn status-${status}` + (count === 2 ? ' half' : ''),
          style: `left:${x}px;top:${y}px;width:${w}px;height:${h}px`,
          title: titleText
        }, display);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleFreeformClick(event, floor, sp, fields, reload);
        });
        layer.appendChild(btn);
      }
    }

    // 編集モード時のみ、画像クリックで新規追加
    if (currentMode === 'edit') {
      layer.style.pointerEvents = 'auto';
      layer.addEventListener('click', (e) => {
        if (e.target !== layer) return;
        const rect = layer.getBoundingClientRect();
        const xPct = ((e.clientX - rect.left) / rect.width) * 100;
        const yPct = ((e.clientY - rect.top) / rect.height) * 100;
        openFreeformSpaceForm(event, floor, null, { xPct, yPct }, fields, reload);
      });
    }
  }

  // ── フリーフォーム時のボタンタップ処理 ──
  async function handleFreeformClick(event, floor, sp, fields, reload) {
    if (currentMode === 'check') {
      if (['priority','want','special'].includes(sp.status)) {
        const ok = await UI.confirmPurchase({
          title: (sp.items && sp.items[0]) || sp.circleName || '',
          circleName: sp.circleName,
          authorName: sp.authorName,
          spaceLabel: sp.label || ''
        });
        if (!ok) return;
        sp.status = 'purchased';
        sp.purchasedAt = new Date().toISOString();
        await DB.spaces.save(sp);
        const book = await Library.createFromSpace(sp, event);
        sp.bookId = book.id;
        await DB.spaces.save(sp);
        UI.toast('購入済に変更・本棚に追加しました');
        reload();
      } else if (sp.status === 'purchased') {
        if (!(await UI.confirm('購入済を取り消しますか？（本棚の登録も削除されます）'))) return;
        if (sp.bookId) { try { await DB.books.remove(sp.bookId); } catch (_) {} }
        sp.status = 'want'; sp.bookId = null;
        await DB.spaces.save(sp);
        UI.toast('「欲しい」に戻しました');
        reload();
      } else {
        openFreeformSpaceForm(event, floor, sp, null, fields, reload);
      }
    } else if (currentMode === 'info') {
      showFreeformInfo(event, floor, sp, fields);
    } else {
      openFreeformSpaceForm(event, floor, sp, null, fields, reload);
    }
  }

  function showFreeformInfo(event, floor, sp, fields) {
    const label = sp.label || '（無題）';
    const body = el('div');
    body.innerHTML = `
      <div style="line-height:1.9;font-size:15px">
        <div><span class="muted">ステータス：</span>${esc(statusLabel(sp.status))}</div>
        ${sp.circleName ? `<div><span class="muted">サークル：</span>${esc(sp.circleName)}</div>` : ''}
        ${sp.authorName ? `<div><span class="muted">作家：</span>${esc(sp.authorName)}</div>`     : ''}
        ${sp.items && sp.items.length ? `<div><span class="muted">頒布物：</span>${esc(sp.items.join(', '))}</div>` : ''}
        ${sp.price != null ? `<div><span class="muted">価格：</span>¥${Number(sp.price).toLocaleString()}</div>` : ''}
        ${sp.notes ? `<div><span class="muted">備考：</span>${esc(sp.notes)}</div>`               : ''}
        ${fields.filter((f) => sp.customFields && sp.customFields[f.id])
            .map((f) => `<div><span class="muted">${esc(f.name)}：</span>${esc(sp.customFields[f.id])}</div>`).join('')}
      </div>
    `;
    const foot = el('div', { style: 'display:flex;gap:10px;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, '閉じる'));
    UI.openModal({ title: `スペース ${label}`, body, footer: foot });
  }

  // ── フリーフォーム用 編集フォーム ──
  function openFreeformSpaceForm(event, floor, existing, newPos, fields, reload) {
    const sp = existing ? { ...existing } : {
      id: uid('space_'), eventId: event.id, floorId: floor.id,
      xPct: newPos.xPct, yPct: newPos.yPct,
      label: '', subLabel: '',
      circleName: '', authorName: '', items: [],
      price: '', status: 'none', notes: '', customFields: {}
    };

    const body = el('div');
    const labelRow = el('div', { class: 'row' });
    labelRow.appendChild(fld('スペース番号（例：モ-33）', 'label', sp.label));
    labelRow.appendChild(fld('a/b（任意）', 'subLabel', sp.subLabel || ''));
    body.appendChild(labelRow);
    body.appendChild(fld('サークル名', 'circleName', sp.circleName));
    body.appendChild(fld('作家名', 'authorName', sp.authorName));
    body.appendChild(fld('頒布物（書名、カンマ区切り）', 'items', (sp.items || []).join(', ')));
    body.appendChild(fld('価格', 'price', sp.price == null ? '' : sp.price, 'number'));

    const statusField = el('div', { class: 'field' }, [el('label', {}, 'ステータス')]);
    const statusRow = el('div', { class: 'row' });
    for (const st of SPACE_STATUSES) {
      const textColor = (st.key === 'none' || st.key === 'skip') ? 'var(--text)' : '#fff';
      const btn = el('button', {
        type: 'button', class: 'btn btn-sm', 'data-status': st.key,
        style: st.color === 'transparent' ? ''
          : `background:${st.color};color:${textColor};border-color:${st.color}`,
        onclick: () => {
          statusField.querySelectorAll('[data-status]').forEach((b) => b.style.outline = '');
          btn.style.outline = '3px solid var(--primary)';
          sp._selectedStatus = st.key;
        }
      }, st.label);
      if (sp.status === st.key) { btn.style.outline = '3px solid var(--primary)'; sp._selectedStatus = st.key; }
      statusRow.appendChild(btn);
    }
    statusField.appendChild(statusRow);
    body.appendChild(statusField);

    for (const f of fields || []) {
      body.appendChild(customSelectField(f, sp.customFields ? sp.customFields[f.id] : ''));
    }
    body.appendChild(el('div', { class: 'field' }, [
      el('label', {}, '備考'),
      el('textarea', { name: 'notes' }, sp.notes || '')
    ]));

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1' });
    if (existing) {
      foot.appendChild(el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => {
        UI.closeModal();
        await waitForFreeformReposition(sp, reload);
      } }, '位置を変更'));
      foot.appendChild(el('button', { class: 'btn btn-danger btn-sm', onclick: async () => {
        if (await UI.confirm('このスペース情報を削除しますか？')) {
          await DB.spaces.remove(sp.id);
          UI.closeModal(); UI.toast('削除しました'); reload();
        }
      } }, '削除'));
    }
    foot.appendChild(el('div', { style: 'flex:1' }));
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
      sp.label      = body.querySelector('[name=label]').value.trim();
      sp.subLabel   = (body.querySelector('[name=subLabel]').value || '').trim().toLowerCase();
      sp.circleName = body.querySelector('[name=circleName]').value.trim();
      sp.authorName = body.querySelector('[name=authorName]').value.trim();
      const itemsRaw = body.querySelector('[name=items]').value.trim();
      sp.items = itemsRaw ? itemsRaw.split(/[,、]/).map((x) => x.trim()).filter(Boolean) : [];
      const p = body.querySelector('[name=price]').value;
      sp.price = p === '' ? null : Number(p);
      sp.notes = body.querySelector('[name=notes]').value;
      sp.status = sp._selectedStatus || sp.status || 'none';
      sp.floorId = floor.id;
      delete sp._selectedStatus;
      sp.customFields = {};
      for (const f of fields || []) {
        const n = body.querySelector(`[data-cf="${f.id}"]`);
        if (n) sp.customFields[f.id] = n.value;
      }
      await DB.spaces.save(sp);
      UI.closeModal(); UI.toast('保存しました'); reload();
    } }, '保存'));

    UI.openModal({ title: existing ? `スペース ${sp.label || ''}${sp.subLabel || ''}` : '新しいスペース', body, footer: foot });
  }

  // ── スペースを floorId+label でグループ化 ──
  function groupSpacesByLabel(spaces) {
    const groups = {};
    for (const sp of spaces) {
      const key = sp.label ? `lbl:${sp.label}` : `id:${sp.id}`;
      (groups[key] = groups[key] || []).push(sp);
    }
    return groups;
  }

  // ── JSONインポート ──
  // 想定フォーマット: [{ "label":"モ-1", "sub":"a"|"b"|"", "xPct":22.1, "yPct":22.5,
  //                     "circleName":"...", "authorName":"...", "items":["..."],
  //                     "price":1000, "status":"want"|"priority"|... }]
  async function importJsonSpaces(event, floor, data) {
    if (!Array.isArray(data)) throw new Error('JSONは配列である必要があります');
    const existing = (await DB.spaces.byEvent(event.id)).filter((s) => s.floorId === floor.id);
    const findExisting = (label, sub) =>
      existing.find((s) => (s.label || '') === (label || '') && (s.subLabel || '') === (sub || ''));

    let count = 0;
    for (const row of data) {
      if (!row || typeof row !== 'object') continue;
      const label = (row.label || '').toString().trim();
      const sub   = (row.sub || row.subLabel || '').toString().trim().toLowerCase();
      const xPct  = Number(row.xPct);
      const yPct  = Number(row.yPct);
      if (!label || !isFinite(xPct) || !isFinite(yPct)) continue;

      const found = findExisting(label, sub);
      const sp = found ? { ...found } : {
        id: uid('space_'), eventId: event.id, floorId: floor.id,
        status: 'none', items: [], customFields: {}
      };
      sp.label = label;
      sp.subLabel = sub;
      sp.xPct = xPct;
      sp.yPct = yPct;
      if (row.circleName != null) sp.circleName = String(row.circleName);
      if (row.authorName != null) sp.authorName = String(row.authorName);
      if (row.items != null) sp.items = Array.isArray(row.items) ? row.items.map(String) : String(row.items).split(/[,、]/).map((s) => s.trim()).filter(Boolean);
      if (row.price != null && row.price !== '') sp.price = Number(row.price);
      if (row.status) sp.status = row.status;
      if (row.notes != null) sp.notes = String(row.notes);
      await DB.spaces.save(sp);
      count++;
    }
    return count;
  }

  function showJsonFormatHelp() {
    const body = el('div');
    body.innerHTML = `
      <p style="margin:0 0 8px;font-size:14px">フリーフォームに取り込むJSONの形式：</p>
      <pre style="background:var(--bg-elev);padding:10px;border-radius:8px;font-size:12px;overflow:auto;line-height:1.5">[
  {
    "label": "モ-1",
    "sub": "a",
    "xPct": 22.1,
    "yPct": 18.5,
    "circleName": "サークル名",
    "authorName": "作家名",
    "items": ["新刊タイトル"],
    "price": 1000,
    "status": "want"
  }
]</pre>
      <ul style="font-size:13px;line-height:1.7;padding-left:18px">
        <li><b>label</b>：スペース番号（必須、例：モ-1）</li>
        <li><b>sub</b>：a/b（任意。同label・同位置のa/bは左右半分ずつ表示）</li>
        <li><b>xPct/yPct</b>：画像幅・高さに対する位置 0〜100（必須）</li>
        <li><b>status</b>：priority / want / special / purchased / skip / none</li>
        <li>同じ label+sub があれば<b>上書き</b>、なければ追加</li>
      </ul>
    `;
    const foot = el('div', { style: 'display:flex;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, '閉じる'));
    UI.openModal({ title: 'JSONインポート形式', body, footer: foot });
  }

  // ── 位置変更：次にタップした位置に動かす（オーバーレイ方式） ──
  function waitForFreeformReposition(sp, reload) {
    return new Promise((resolve) => {
      const inner = _freeformInner;
      if (!inner) { UI.toast('地図が見つかりません'); resolve(); return; }

      const imgEl = inner.querySelector('img');
      const imgW = imgEl ? imgEl.naturalWidth : inner.offsetWidth;
      const imgH = imgEl ? imgEl.naturalHeight : inner.offsetHeight;

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;z-index:500;cursor:crosshair;background:rgba(107,168,168,0.10);';
      inner.appendChild(overlay);

      const hint = document.createElement('div');
      hint.style.cssText = 'position:fixed;bottom:88px;left:50%;transform:translateX(-50%);'
        + 'background:rgba(0,0,0,0.72);color:#fff;padding:8px 18px;border-radius:20px;'
        + 'font-size:13px;z-index:600;pointer-events:none;white-space:nowrap;';
      hint.textContent = '新しい位置をタップしてください';
      document.body.appendChild(hint);

      const cleanup = () => { overlay.remove(); hint.remove(); };

      overlay.addEventListener('click', async (e) => {
        const rect = inner.getBoundingClientRect();
        sp.xPct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
        sp.yPct = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
        cleanup();
        await DB.spaces.save(sp);
        UI.toast('位置を更新しました');
        reload();
        resolve();
      }, { once: true });
    });
  }

  // ── スペースサイズ設定（フリーフォーム） ──
  function openSpaceSizeConfig(floor, event, onSaved) {
    const size = floor.spaceSize || { ...defaultSpaceSize };
    const body = el('div');
    body.innerHTML = `<p class="muted" style="margin-top:0;font-size:13px">スペースボタンの大きさ（px）を調整します。</p>`;
    const row = el('div', { class: 'row' });
    row.appendChild(numFld('幅(px)', 'w', size.w));
    row.appendChild(numFld('高さ(px)', 'h', size.h));
    body.appendChild(row);

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
      floor.spaceSize = {
        w: +body.querySelector('[name=w]').value || defaultSpaceSize.w,
        h: +body.querySelector('[name=h]').value || defaultSpaceSize.h
      };
      const idx = event.floors.findIndex((f) => f.id === floor.id);
      if (idx !== -1) event.floors[idx] = floor;
      await DB.events.save(event);
      UI.closeModal(); UI.toast('サイズを更新しました');
      onSaved && onSaved();
    } }, '保存'));

    UI.openModal({ title: 'スペースサイズ', body, footer: foot });
  }

  // ── ボタン配置 ──
  function placeButtons(inner, floor, event, spaceMap, fields, reload, imgW, imgH) {
    [...inner.querySelectorAll('.space-btn, .grid-layer')].forEach((n) => n.remove());
    const layer = el('div', { class: 'grid-layer' });
    layer.style.width = imgW + 'px';
    layer.style.height = imgH + 'px';
    inner.appendChild(layer);

    const cfg = floor.gridConfig || defaultGrid;
    for (let r = 0; r < cfg.rows; r++) {
      for (let c = 0; c < cfg.cols; c++) {
        const x = cfg.offsetX + c * (cfg.cellWidth + cfg.gapX);
        const y = cfg.offsetY + r * (cfg.cellHeight + cfg.gapY);
        const sp = spaceMap[`${r},${c}`];
        const status = sp ? (sp.status || 'none') : 'none';
        const label = (sp && sp.label) || genLabel(cfg, r, c);
        const btn = el('button', {
          class: `space-btn status-${status}`,
          style: `left:${x}px;top:${y}px;width:${cfg.cellWidth}px;height:${cfg.cellHeight}px`,
          title: label
        }, label);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleSpaceClick(event, floor, r, c, sp, fields, reload);
        });
        layer.appendChild(btn);
      }
    }
  }

  function buildSpaceMap(spaces) {
    const m = {};
    for (const s of spaces) m[`${s.row},${s.col}`] = s;
    return m;
  }

  // ── スペースタップ処理 ──
  async function handleSpaceClick(event, floor, row, col, existing, fields, reload) {
    if (currentMode === 'check') {
      if (!existing) return openSpaceForm(event, floor, row, col, null, fields, reload);
      if (['priority','want','special'].includes(existing.status)) {
        const ok = await UI.confirmPurchase({
          title: (existing.items && existing.items[0]) || existing.circleName || '',
          circleName: existing.circleName,
          authorName: existing.authorName,
          spaceLabel: existing.label || genLabel(floor.gridConfig || defaultGrid, row, col)
        });
        if (!ok) return;
        existing.status = 'purchased';
        existing.purchasedAt = new Date().toISOString();
        await DB.spaces.save(existing);
        const book = await Library.createFromSpace(existing, event);
        existing.bookId = book.id;
        await DB.spaces.save(existing);
        UI.toast('購入済に変更・本棚に追加しました');
        reload();
      } else if (existing.status === 'purchased') {
        if (!(await UI.confirm('購入済を取り消しますか？（本棚の登録も削除されます）'))) return;
        if (existing.bookId) { try { await DB.books.remove(existing.bookId); } catch (_) {} }
        existing.status = 'want'; existing.bookId = null;
        await DB.spaces.save(existing);
        UI.toast('「欲しい」に戻しました');
        reload();
      } else {
        openSpaceForm(event, floor, row, col, existing, fields, reload);
      }
    } else if (currentMode === 'info') {
      showSpaceInfo(event, floor, row, col, existing, fields);
    } else {
      openSpaceForm(event, floor, row, col, existing, fields, reload);
    }
  }

  // ── スペース情報表示 ──
  function showSpaceInfo(event, floor, row, col, sp, fields) {
    const label = (sp && sp.label) || genLabel(floor.gridConfig || defaultGrid, row, col);
    const body = el('div');
    if (!sp) {
      body.appendChild(el('p', { class: 'muted' }, 'このスペースにはまだ情報がありません。'));
    } else {
      body.innerHTML = `
        <div style="line-height:1.9;font-size:15px">
          <div><span class="muted">ステータス：</span>${esc(statusLabel(sp.status))}</div>
          ${sp.circleName ? `<div><span class="muted">サークル：</span>${esc(sp.circleName)}</div>` : ''}
          ${sp.authorName ? `<div><span class="muted">作家：</span>${esc(sp.authorName)}</div>`     : ''}
          ${sp.items && sp.items.length ? `<div><span class="muted">頒布物：</span>${esc(sp.items.join(', '))}</div>` : ''}
          ${sp.price != null ? `<div><span class="muted">価格：</span>¥${Number(sp.price).toLocaleString()}</div>` : ''}
          ${sp.notes ? `<div><span class="muted">備考：</span>${esc(sp.notes)}</div>`               : ''}
          ${fields.filter((f) => sp.customFields && sp.customFields[f.id])
              .map((f) => `<div><span class="muted">${esc(f.name)}：</span>${esc(sp.customFields[f.id])}</div>`).join('')}
        </div>
      `;
    }
    const foot = el('div', { style: 'display:flex;gap:10px;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, '閉じる'));
    UI.openModal({ title: `スペース ${label}`, body, footer: foot });
  }

  function statusLabel(key) {
    return (SPACE_STATUSES.find((s) => s.key === key) || SPACE_STATUSES[0]).label;
  }

  // ── スペース編集フォーム ──
  function openSpaceForm(event, floor, row, col, existing, fields, reload) {
    const cfg = floor.gridConfig || defaultGrid;
    const sp = existing ? { ...existing } : {
      id: uid('space_'), eventId: event.id, floorId: floor.id,
      row, col, label: genLabel(cfg, row, col),
      circleName: '', authorName: '', items: [],
      price: '', status: 'none', notes: '', customFields: {}
    };

    const body = el('div');
    body.appendChild(fld('スペース番号', 'label', sp.label));
    body.appendChild(fld('サークル名', 'circleName', sp.circleName));
    body.appendChild(fld('作家名', 'authorName', sp.authorName));
    body.appendChild(fld('頒布物（書名、カンマ区切り）', 'items', (sp.items || []).join(', ')));
    body.appendChild(fld('価格', 'price', sp.price == null ? '' : sp.price, 'number'));

    // ステータスボタン
    const statusField = el('div', { class: 'field' }, [el('label', {}, 'ステータス')]);
    const statusRow = el('div', { class: 'row' });
    for (const st of SPACE_STATUSES) {
      const textColor = (st.key === 'none' || st.key === 'skip') ? 'var(--text)' : '#fff';
      const btn = el('button', {
        type: 'button', class: 'btn btn-sm', 'data-status': st.key,
        style: st.color === 'transparent' ? ''
          : `background:${st.color};color:${textColor};border-color:${st.color}`,
        onclick: () => {
          statusField.querySelectorAll('[data-status]').forEach((b) => b.style.outline = '');
          btn.style.outline = '3px solid var(--primary)';
          sp._selectedStatus = st.key;
        }
      }, st.label);
      if (sp.status === st.key) { btn.style.outline = '3px solid var(--primary)'; sp._selectedStatus = st.key; }
      statusRow.appendChild(btn);
    }
    statusField.appendChild(statusRow);
    body.appendChild(statusField);

    for (const f of fields || []) {
      body.appendChild(customSelectField(f, sp.customFields ? sp.customFields[f.id] : ''));
    }
    body.appendChild(el('div', { class: 'field' }, [
      el('label', {}, '備考'),
      el('textarea', { name: 'notes' }, sp.notes || '')
    ]));

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1' });
    if (existing) {
      foot.appendChild(el('button', { class: 'btn btn-danger btn-sm', onclick: async () => {
        if (await UI.confirm('このスペース情報を削除しますか？')) {
          await DB.spaces.remove(sp.id);
          UI.closeModal(); UI.toast('削除しました'); reload();
        }
      } }, '削除'));
    }
    foot.appendChild(el('div', { style: 'flex:1' }));
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
      sp.label      = body.querySelector('[name=label]').value.trim() || genLabel(cfg, row, col);
      sp.circleName = body.querySelector('[name=circleName]').value.trim();
      sp.authorName = body.querySelector('[name=authorName]').value.trim();
      const itemsRaw = body.querySelector('[name=items]').value.trim();
      sp.items = itemsRaw ? itemsRaw.split(/[,、]/).map((x) => x.trim()).filter(Boolean) : [];
      const p = body.querySelector('[name=price]').value;
      sp.price = p === '' ? null : Number(p);
      sp.notes = body.querySelector('[name=notes]').value;
      sp.status = sp._selectedStatus || sp.status || 'none';
      sp.floorId = floor.id;
      delete sp._selectedStatus;
      sp.customFields = {};
      for (const f of fields || []) {
        const n = body.querySelector(`[data-cf="${f.id}"]`);
        if (n) sp.customFields[f.id] = n.value;
      }
      await DB.spaces.save(sp);
      UI.closeModal(); UI.toast('保存しました'); reload();
    } }, '保存'));

    UI.openModal({ title: `スペース ${sp.label}`, body, footer: foot });
  }

  function fld(label, name, value, type = 'text') {
    return el('div', { class: 'field' }, [
      el('label', {}, label),
      el('input', { type, name, value: value == null ? '' : String(value) })
    ]);
  }
  function customSelectField(f, value) {
    const sel = el('select', { 'data-cf': f.id });
    sel.appendChild(el('option', { value: '' }, '（未選択）'));
    for (const o of f.options || []) {
      const opt = el('option', { value: o }, o);
      if (value === o) opt.selected = true;
      sel.appendChild(opt);
    }
    return el('div', { class: 'field' }, [el('label', {}, f.name), sel]);
  }

  // ── グリッド設定 ──
  function openGridConfig(floor, event, onSaved) {
    floor.gridConfig = floor.gridConfig || { ...defaultGrid };
    const cfg = { ...floor.gridConfig };
    const body = el('div');
    body.innerHTML = `<p class="muted" style="margin-top:0;font-size:13px">地図に合わせてグリッドを調整してください。</p>`;

    const rows = [
      ['行数', 'rows', cfg.rows],           ['列数', 'cols', cfg.cols],
      ['X開始(px)', 'offsetX', cfg.offsetX], ['Y開始(px)', 'offsetY', cfg.offsetY],
      ['セル幅(px)', 'cellWidth', cfg.cellWidth], ['セル高(px)', 'cellHeight', cfg.cellHeight],
      ['横間隔(px)', 'gapX', cfg.gapX],     ['縦間隔(px)', 'gapY', cfg.gapY],
      ['番号開始', 'labelStart', cfg.labelStart], ['桁数', 'labelPad', cfg.labelPad]
    ];
    for (let i = 0; i < rows.length; i += 2) {
      const row = el('div', { class: 'row' });
      row.appendChild(numFld(rows[i][0], rows[i][1], rows[i][2]));
      if (rows[i+1]) row.appendChild(numFld(rows[i+1][0], rows[i+1][1], rows[i+1][2]));
      body.appendChild(row);
    }
    body.appendChild(txtFld('プレフィックス（例：A-）', 'labelPrefix', cfg.labelPrefix));

    const modeFld = el('div', { class: 'field' }, [el('label', {}, '番号モード')]);
    const modeSel = el('select', { name: 'labelMode' });
    for (const [v, l] of [['sequential','連番（A-01, A-02…）'],['rowColumn','行×列（A-01, B-01…）']]) {
      const opt = el('option', { value: v }, l);
      if (cfg.labelMode === v) opt.selected = true;
      modeSel.appendChild(opt);
    }
    modeFld.appendChild(modeSel);
    body.appendChild(modeFld);

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
      const g = (n) => body.querySelector(`[name=${n}]`).value;
      floor.gridConfig = {
        rows: +g('rows')||1, cols: +g('cols')||1,
        offsetX: +g('offsetX')||0, offsetY: +g('offsetY')||0,
        cellWidth: +g('cellWidth')||40, cellHeight: +g('cellHeight')||30,
        gapX: +g('gapX')||0, gapY: +g('gapY')||0,
        labelPrefix: g('labelPrefix')||'',
        labelStart: +g('labelStart')||1, labelPad: +g('labelPad')||2,
        labelMode: g('labelMode')
      };
      event.floors = event.floors || [];
      const idx = event.floors.findIndex((f) => f.id === floor.id);
      if (idx !== -1) event.floors[idx] = floor;
      await DB.events.save(event);
      UI.closeModal(); UI.toast('グリッドを更新しました');
      onSaved && onSaved();
    } }, '保存'));

    UI.openModal({ title: 'グリッド設定', body, footer: foot });
  }

  function numFld(label, name, value) {
    return el('div', { class: 'field' }, [
      el('label', {}, label),
      el('input', { type: 'number', name, value: value == null ? '' : String(value) })
    ]);
  }
  function txtFld(label, name, value) {
    return el('div', { class: 'field' }, [
      el('label', {}, label),
      el('input', { type: 'text', name, value: value == null ? '' : String(value) })
    ]);
  }

  // ── ラベル生成 ──
  function genLabel(cfg, row, col) {
    if (cfg.labelMode === 'rowColumn') {
      const rowChar = String.fromCharCode('A'.charCodeAt(0) + row);
      return `${cfg.labelPrefix || ''}${rowChar}-${String(col+1).padStart(cfg.labelPad||2,'0')}`;
    }
    const n = row * cfg.cols + col + (cfg.labelStart || 1);
    return `${cfg.labelPrefix || ''}${String(n).padStart(cfg.labelPad||2,'0')}`;
  }

  function renderLegend(container) {
    for (const st of SPACE_STATUSES) {
      if (st.key === 'none') continue;
      container.appendChild(el('span', { class: 'legend-item' }, [
        el('span', { class: 'legend-swatch', style: `background:${st.color}` }),
        document.createTextNode(st.label)
      ]));
    }
  }

  // ── フロアマップ スクショ保存（PNG） ──
  async function exportFloorScreenshot(floor, spaces, eventName) {
    if (!floor.image) { UI.toast('地図画像がありません'); return; }
    const img = new Image();
    img.src = floor.image;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const W = img.naturalWidth, H = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const size = floor.spaceSize || defaultSpaceSize;
    const groups = groupSpacesByLabel(spaces);
    const statusColors = {
      priority: '#E67E22', want: '#3498DB', purchased: '#7FB069',
      special: '#9B59B6', skip: '#BDC3C7', none: 'rgba(255,255,255,0.85)'
    };

    ctx.font = `bold ${Math.max(10, Math.floor(size.h * 0.5))}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    for (const key of Object.keys(groups)) {
      const group = groups[key].slice().sort((p, q) => (p.subLabel || '').localeCompare(q.subLabel || ''));
      const anchor = group[0];
      if (anchor.xPct == null || anchor.yPct == null) continue;
      const cx = (anchor.xPct / 100) * W;
      const cy = (anchor.yPct / 100) * H;
      const count = Math.min(group.length, 2);
      for (let i = 0; i < count; i++) {
        const sp = group[i];
        const w = count === 2 ? Math.floor(size.w / 2) : size.w;
        const h = size.h;
        const x = cx - size.w / 2 + (count === 2 ? i * w : 0);
        const y = cy - h / 2;
        const status = sp.status || 'none';
        const isLight = (status === 'none' || status === 'skip');
        ctx.fillStyle = statusColors[status] || statusColors.none;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1.5;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        const numPart2 = stripLabelPrefix(sp.label) + (sp.subLabel || '');
        const text = (sp.authorName && sp.authorName.trim())
          ? sp.authorName : numPart2;
        ctx.fillStyle = isLight ? '#333' : '#fff';
        // 長すぎたら切る
        const maxLen = count === 2 ? 4 : 6;
        const display = text.length > maxLen ? text.slice(0, maxLen) : text;
        ctx.fillText(display, x + w / 2, y + h / 2);
      }
    }

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (eventName + '_' + (floor.name || 'floor')).replace(/[\\/:*?"<>|]/g, '_');
      a.href = url; a.download = `${safeName}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      UI.toast('スクショを保存しました');
    }, 'image/png');
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  return { mount };
})();
