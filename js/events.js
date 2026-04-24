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
      el('div', { style: 'display:flex;gap:6px' }, [
        el('button', { class: 'btn btn-sm', onclick: () => openEventForm(ev) }, '編集'),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: () => App.go('events') }, '一覧')
      ])
    ]));
    const sub = [ev.date, ev.venue].filter(Boolean).join(' / ');
    if (sub) wrap.appendChild(el('div', { class: 'card-sub', style: 'margin-bottom:12px' }, sub));

    await FloorMap.mount(wrap, ev);
    return wrap;
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
