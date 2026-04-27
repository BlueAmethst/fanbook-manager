// ====== Exporter（CSV/エクセル出力） ======
const Exporter = (() => {
  // 優先度順序：priority(最優先) > want(欲しい) > special(注目) > none > purchased > skip
  const PRIORITY_ORDER = {
    priority: 0, want: 1, special: 2, none: 3, purchased: 4, skip: 5
  };
  // status → (優先度, ステータス) の2列
  const STATUS_TO_PRIORITY = {
    priority: '最優先', want: '欲しい', special: '注目',
    purchased: '', skip: '', none: ''
  };
  const STATUS_TO_STATE = {
    priority: '未購入', want: '未購入', special: '未購入',
    purchased: '購入済', skip: 'スキップ', none: '未設定'
  };

  // CSVセル用エスケープ：ダブルクォートで囲み、内部の " は "" に
  function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function rowsToCsv(rows) {
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // 同フロア内で位置順（上→下、左→右）
  function spaceCompare(a, b) {
    const pa = PRIORITY_ORDER[a.status || 'none'] ?? 99;
    const pb = PRIORITY_ORDER[b.status || 'none'] ?? 99;
    if (pa !== pb) return pa - pb;
    // 同優先度：フロア名順 → yPct → xPct → label
    const fa = a._floorName || ''; const fb = b._floorName || '';
    if (fa !== fb) return fa.localeCompare(fb);
    const ya = a.yPct == null ? (a.row ?? 0) * 1000 : a.yPct;
    const yb = b.yPct == null ? (b.row ?? 0) * 1000 : b.yPct;
    if (Math.abs(ya - yb) > 1) return ya - yb;
    const xa = a.xPct == null ? (a.col ?? 0) * 1000 : a.xPct;
    const xb = b.xPct == null ? (b.col ?? 0) * 1000 : b.xPct;
    if (Math.abs(xa - xb) > 1) return xa - xb;
    return (a.label || '').localeCompare(b.label || '');
  }

  async function downloadEventCsv(event) {
    const spaces = await DB.spaces.byEvent(event.id);
    const fields = await DB.customFields.all();
    const floorById = {};
    for (const f of (event.floors || [])) floorById[f.id] = f;

    // フロア名を付与
    for (const sp of spaces) {
      sp._floorName = (floorById[sp.floorId] && floorById[sp.floorId].name) || '';
    }

    // 並べ替え
    spaces.sort(spaceCompare);

    // ヘッダ
    const header = [
      'No', 'フロア', 'スペース', 'a/b',
      '作家名', 'サークル名', '頒布物', '価格',
      '優先度', 'ステータス', '備考'
    ];
    for (const f of fields) header.push(f.name);

    const rows = [header];
    spaces.forEach((sp, i) => {
      const row = [
        i + 1,
        sp._floorName,
        sp.label || '',
        sp.subLabel || '',
        sp.authorName || '',
        sp.circleName || '',
        (sp.items || []).join(' / '),
        sp.price == null || sp.price === '' ? '' : sp.price,
        STATUS_TO_PRIORITY[sp.status || 'none'],
        STATUS_TO_STATE[sp.status || 'none'],
        sp.notes || ''
      ];
      for (const f of fields) {
        row.push((sp.customFields && sp.customFields[f.id]) || '');
      }
      rows.push(row);
    });

    const csv = rowsToCsv(rows);
    // UTF-8 BOM 付き（Excelで文字化けしないように）
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
    const safeName = (event.name || 'event').replace(/[\\/:*?"<>|]/g, '_');
    const dateStr = (event.date || new Date().toISOString().slice(0, 10)).replace(/[^\d]/g, '');
    downloadBlob(blob, `${safeName}_${dateStr}_リスト.csv`);
    UI.toast(`${spaces.length}件のリストを出力しました`);
  }

  return { downloadEventCsv };
})();
