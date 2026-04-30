// ====== Events（イベント管理） ======
const Events = (() => {
  const { el, esc } = UI;

  async function renderList() {
    const events = await DB.events.all();
    const container = el('div');

    container.appendChild(el('div', { class: 'section-head' }, [
      el('h2', {}, `イベント：${events.length}件`),
      el('button', { class: 'btn btn-sm btn-primary', onclick: () => openEventForm() }, '＋イベント追加')
    ]));

    if (!events.length) {
      container.appendChild(el('div', { class: 'empty' }, [
        el('h2', {}, 'イベントがありません'),
        el('p', { class: 'muted' }, 'コミケ・同人誌即売会などを追加できます')
      ]));
      return container;
    }

    events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    for (const ev of events) {
      const spaces = await DB.spaces.byEvent(ev.id);
      const counts = countByStatus(spaces);
      const c = el('div', { class: 'card', onclick: () => App.go(`event/${ev.id}`) });
      c.appendChild(el('div', { class: 'card-title' }, ev.name || '(無題)'));
      const sub = [ev.date, ev.venue].filter(Boolean).join(' / ');
      c.appendChild(el('div', { class: 'card-sub' }, sub));
      const chips = el('div', { class: 'chips' });
      chips.appendChild(el('span', { class: 'chip' }, `合計 ${spaces.length}`));
      if (counts.priority)  chips.appendChild(el('span', { class: 'chip' }, `🔴最優先 ${counts.priority}`));
      if (counts.want)      chips.appendChild(el('span', { class: 'chip' }, `🟡欲しい ${counts.want}`));
      if (counts.special)   chips.appendChild(el('span', { class: 'chip' }, `🔵特別 ${counts.special}`));
      if (counts.purchased) chips.appendChild(el('span', { class: 'chip' }, `🟢購入済 ${counts.purchased}`));
      c.appendChild(chips);
      container.appendChild(c);
    }
    return container;
  }

  function countByStatus(spaces) {
    const r = { priority: 0, want: 0, special: 0, purchased: 0, skip: 0, none: 0 };
    for (const s of spaces) r[s.status || 'none']++;
    return r;
  }

  async function renderDetail([eventId]) {
    if (!eventId) return el('div', { class: 'empty' }, 'イベントが指定されていません');
    const ev = await DB.events.get(eventId);
    if (!ev) return el('div', { class: 'empty' }, 'イベントが見つかりません');

    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-head' }, [
      el('h2', {}, ev.name),
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
        el('button', { class: 'btn btn-sm', onclick: () => Exporter.downloadEventCsv(ev) }, '📤 リスト出力'),
        el('button', { class: 'btn btn-sm', onclick: () => openEventForm(ev) }, '編集'),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: () => App.go('events') }, '一覧')
      ])
    ]));
    const sub = [ev.date, ev.venue].filter(Boolean).join(' / ');
    if (sub) wrap.appendChild(el('div', { class: 'card-sub', style: 'margin-bottom:12px' }, sub));

    // 未購入リストとの紐付けボタン
    const wishItems = (await DB.wishlist.all()).filter((w) =>
      w.spaceCode && (
        (ev.name && (w.eventName || '').includes(ev.name.slice(0, 4))) ||
        (ev.date && w.eventDate === ev.date) ||
        true  // フィルタなしで全件対象（後でユーザがマッチングを確認）
      )
    );
    const wishCount = wishItems.length;
    if (wishCount > 0) {
      const wishBar = el('div', { class: 'wishlist-link-bar' });
      wishBar.appendChild(el('span', {}, `🎯 未購入リストに ${wishCount} 件の候補があります`));
      wishBar.appendChild(el('button', {
        class: 'btn btn-sm btn-primary',
        onclick: async () => { await linkWishlistToEvent(ev); App.route(); }
      }, 'スペース番号で紐付け'));
      wrap.appendChild(wishBar);
    }

    // このイベントに既に紐付け済みの未購入本一覧
    const linkedWishes = (await DB.wishlist.byEvent(ev.id));
    if (linkedWishes.length) {
      const linkedBox = el('details', { class: 'wishlist-linked' });
      linkedBox.innerHTML = `<summary>📌 このイベントの未購入本（${linkedWishes.length}件）</summary>`;
      const lwBody = el('div', { style: 'margin-top:8px' });
      linkedWishes.forEach((w) => {
        const c = el('div', { class: 'card', style: 'padding:10px;margin-bottom:6px' });
        c.appendChild(el('div', { class: 'card-title', style: 'font-size:14px' }, w.title || '(タイトル未定)'));
        const meta = [];
        if (w.spaceCode) meta.push(`📍${w.spaceCode}`);
        if (w.couplingLeft && w.couplingRight) meta.push(`♡${w.couplingLeft}×${w.couplingRight}`);
        if (typeof w.price === 'number') meta.push(`¥${w.price.toLocaleString()}`);
        c.appendChild(el('div', { class: 'card-sub' }, meta.join(' / ')));
        lwBody.appendChild(c);
      });
      linkedBox.appendChild(lwBody);
      wrap.appendChild(linkedBox);
    }

    await FloorMap.mount(wrap, ev);
    return wrap;
  }

  // 未購入リストの spaceCode と、このイベントの spaces の label をマッチングして紐付け
  async function linkWishlistToEvent(ev) {
    const [wishes, spaces] = await Promise.all([
      DB.wishlist.all(),
      DB.spaces.byEvent(ev.id)
    ]);

    const normalize = (s) => (s || '').replace(/[\s\-－]+/g, '').toLowerCase()
      .replace(/[ａＡ]/g, 'a').replace(/[ｂＢ]/g, 'b');

    let linked = 0;
    let alreadyLinked = 0;
    for (const w of wishes) {
      if (!w.spaceCode) continue;
      const wCode = normalize(w.spaceCode);
      // スペースの label+subLabel と比較（ハイフン除去・a/b区別あり）
      const matched = spaces.find((s) => {
        const sl = normalize((s.label || '') + (s.subLabel || ''));
        return sl && (sl === wCode || wCode.includes(sl) || sl.includes(wCode));
      });
      if (matched) {
        if (w.eventId === ev.id && w.linkedSpaceId === matched.id) {
          alreadyLinked++;
          continue;
        }
        w.eventId = ev.id;
        w.linkedSpaceId = matched.id;
        w.updatedAt = new Date().toISOString();
        await DB.wishlist.save(w);
        linked++;
      } else {
        // スペースが未配置でも、イベント名/日が合えば eventId だけ設定
        const evMatch = (ev.name && (w.eventName || '').includes(ev.name.slice(0, 4))) ||
                        (ev.date && w.eventDate === ev.date);
        if (evMatch && w.eventId !== ev.id) {
          w.eventId = ev.id;
          w.updatedAt = new Date().toISOString();
          await DB.wishlist.save(w);
          linked++;
        }
      }
    }
    UI.toast(`${linked}件を紐付けしました${alreadyLinked ? `（${alreadyLinked}件は既存）` : ''}`);
  }

  function openEventForm(existing) {
    const ev = existing ? { ...existing } : {
      id: uid('event_'), name: '', date: '', venue: '',
      floors: [], createdAt: new Date().toISOString()
    };
    const body = el('div');
    body.appendChild(fld('イベント名', 'name', ev.name));
    body.appendChild(fld('開催日', 'date', ev.date, 'date'));
    body.appendChild(fld('会場', 'venue', ev.venue));
    body.appendChild(el('p', { class: 'muted', style: 'font-size:13px;margin-top:4px' },
      '※ フロアマップの追加・変更はイベント詳細画面から行えます'));

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1' });
    if (existing) {
      foot.appendChild(el('button', { class: 'btn btn-danger btn-sm', onclick: async () => {
        if (await UI.confirm('イベントとスペース情報をすべて削除します。よろしいですか？')) {
          const spaces = await DB.spaces.byEvent(ev.id);
          for (const s of spaces) await DB.spaces.remove(s.id);
          await DB.events.remove(ev.id);
          UI.closeModal(); UI.toast('削除しました'); App.go('events');
        }
      } }, '削除'));
    }
    foot.appendChild(el('div', { style: 'flex:1' }));
    foot.appendChild(el('button', { class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
      ev.name  = body.querySelector('[name=name]').value.trim();
      ev.date  = body.querySelector('[name=date]').value;
      ev.venue = body.querySelector('[name=venue]').value.trim();
      if (!ev.name) { UI.toast('イベント名を入力してください'); return; }
      await DB.events.save(ev);
      UI.closeModal(); UI.toast('保存しました');
      if (existing) App.route();
      else App.go(`event/${ev.id}`);
    } }, '保存'));

    UI.openModal({ title: existing ? 'イベントを編集' : 'イベントを追加', body, footer: foot });
  }

  function fld(label, name, value, type = 'text') {
    return el('div', { class: 'field' }, [
      el('label', {}, label),
      el('input', { type, name, value: value || '' })
    ]);
  }

  return { renderList, renderDetail, openEventForm };
})();
