// ====== 統計ページ（金額の総計・月別など） ======
const Stats = (() => {
  const { el, esc } = UI;

  async function render() {
    const container = el('div');
    const books = await DB.books.all();

    if (!books.length) {
      container.appendChild(el('div', { class: 'empty' }, [
        el('h2', {}, 'まだ登録がありません'),
        el('p', { class: 'muted' }, '同人誌を登録すると統計が表示されます')
      ]));
      return container;
    }

    // ── 集計 ──
    const totalsByMonth = {}; // {'2026-04': {amount, count}}
    const totalsByLocation = {};
    let grandAmount = 0;
    let grandCount = 0;

    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = `${thisYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let yearAmount = 0, yearCount = 0;
    let monthAmount = 0, monthCount = 0;

    for (const b of books) {
      const price = Number(b.price) || 0;
      const qty   = Number(b.quantity) || 1;
      const amt = price * qty;
      grandAmount += amt; grandCount += qty;

      const ym = (b.purchaseDate || '').slice(0, 7); // 'YYYY-MM'
      const y  = (b.purchaseDate || '').slice(0, 4);
      if (!totalsByMonth[ym]) totalsByMonth[ym] = { amount: 0, count: 0 };
      totalsByMonth[ym].amount += amt;
      totalsByMonth[ym].count  += qty;

      const loc = b.purchaseLocation || '(未指定)';
      if (!totalsByLocation[loc]) totalsByLocation[loc] = { amount: 0, count: 0 };
      totalsByLocation[loc].amount += amt;
      totalsByLocation[loc].count  += qty;

      if (y === String(thisYear)) { yearAmount += amt; yearCount += qty; }
      if (ym === thisMonth)        { monthAmount += amt; monthCount += qty; }
    }

    // ── サマリーカード ──
    const summary = el('div', { class: 'stats-summary' });
    summary.appendChild(summaryCard('総合計', grandAmount, grandCount));
    summary.appendChild(summaryCard(`${thisYear}年`, yearAmount, yearCount));
    summary.appendChild(summaryCard(`${thisYear}年${now.getMonth() + 1}月`, monthAmount, monthCount));
    container.appendChild(summary);

    // ── 月別 ──
    container.appendChild(el('h2', { style: 'margin-top:20px' }, '月別の合計'));
    const months = Object.keys(totalsByMonth).sort().reverse();
    const maxAmt = Math.max(...months.map((m) => totalsByMonth[m].amount), 1);
    const monthList = el('div', { class: 'stats-bars' });
    for (const m of months) {
      const row = totalsByMonth[m];
      const bar = el('div', { class: 'stats-bar-row' });
      const ratio = Math.max(2, Math.round((row.amount / maxAmt) * 100));
      bar.innerHTML = `
        <div class="stats-bar-label">${esc(m)}</div>
        <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${ratio}%"></div></div>
        <div class="stats-bar-value">¥${row.amount.toLocaleString()} <span class="muted">(${row.count}冊)</span></div>
      `;
      monthList.appendChild(bar);
    }
    container.appendChild(monthList);

    // ── 購入場所別 ──
    container.appendChild(el('h2', { style: 'margin-top:20px' }, '購入場所別'));
    const locs = Object.keys(totalsByLocation).sort((a, b) =>
      totalsByLocation[b].amount - totalsByLocation[a].amount
    );
    const maxLocAmt = Math.max(...locs.map((l) => totalsByLocation[l].amount), 1);
    const locList = el('div', { class: 'stats-bars' });
    for (const l of locs) {
      const row = totalsByLocation[l];
      const ratio = Math.max(2, Math.round((row.amount / maxLocAmt) * 100));
      const bar = el('div', { class: 'stats-bar-row' });
      bar.innerHTML = `
        <div class="stats-bar-label">${esc(l)}</div>
        <div class="stats-bar-track"><div class="stats-bar-fill stats-bar-fill-accent" style="width:${ratio}%"></div></div>
        <div class="stats-bar-value">¥${row.amount.toLocaleString()} <span class="muted">(${row.count}冊)</span></div>
      `;
      locList.appendChild(bar);
    }
    container.appendChild(locList);

    container.appendChild(el('p', { class: 'muted', style: 'font-size:11px;margin-top:14px' },
      '※ 金額が未入力の同人誌は集計に含まれません。'));

    return container;
  }

  function summaryCard(label, amount, count) {
    const c = el('div', { class: 'stats-card' });
    c.innerHTML = `
      <div class="stats-card-label">${esc(label)}</div>
      <div class="stats-card-amount">¥${amount.toLocaleString()}</div>
      <div class="stats-card-count">${count} 冊</div>
    `;
    return c;
  }

  return { render };
})();
