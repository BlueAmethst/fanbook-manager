// ====== 一括編集共通モジュール ======
// 同人誌管理・未購入リストの両方で使う共通ロジック
const Bulk = (() => {
  const { el, esc } = UI;

  // 一括編集モーダルを開く
  // options: { targets, fields, chars1, chars2, mode, purchaseLocs, folders, onSave }
  // mode: 'books' | 'wishlist'  （'books' のみ購入場所を表示）
  function openBulkEditModal({ targets, fields, chars1, chars2, mode, purchaseLocs, folders, onSave }) {
    const body = el('div');
    body.appendChild(el('div', { class: 'ocr-help' },
      `📝 ${targets.length}件の項目を一括設定します。チェックを入れた項目だけが上書きされます。空欄のまま「適用」を押すとその項目はクリアされます。`));

    // ── カップリング ──
    const cpEnable = el('input', { type: 'checkbox', id: 'bulk-cp-enable' });
    const cpSection = el('div', { class: 'bulk-section' });
    cpSection.appendChild(el('label', { class: 'bulk-section-head' }, [
      cpEnable, el('span', { style: 'margin-left:6px;font-weight:600' }, 'カップリングを一括設定')
    ]));
    const cpRow = el('div', { class: 'coupling-row', style: 'margin-top:8px' });
    const cpLeft = makeCharSelect('bulkCouplingLeft', '', chars1);
    const cpRight = makeCharSelect('bulkCouplingRight', '', chars2);
    cpRow.appendChild(cpLeft);
    cpRow.appendChild(el('span', { class: 'coupling-cross' }, '×'));
    cpRow.appendChild(cpRight);
    cpSection.appendChild(cpRow);
    body.appendChild(cpSection);

    // ── フォルダ一括設定 ──
    let folderEnable, folderSel;
    if (folders && folders.length) {
      folderEnable = el('input', { type: 'checkbox', id: 'bulk-folder-enable' });
      const folderSection = el('div', { class: 'bulk-section' });
      folderSection.appendChild(el('label', { class: 'bulk-section-head' }, [
        folderEnable, el('span', { style: 'margin-left:6px;font-weight:600' }, 'フォルダを一括設定')
      ]));
      folderSel = el('select', { name: 'bulkFolder', style: 'margin-top:8px' });
      folderSel.appendChild(el('option', { value: '' }, '（フォルダなし）'));
      for (const f of folders) folderSel.appendChild(el('option', { value: f.id }, f.name));
      folderSection.appendChild(folderSel);
      body.appendChild(folderSection);
    }

    // ── 購入場所（同人誌管理のみ） ──
    let locEnable, locSel;
    if (mode === 'books') {
      locEnable = el('input', { type: 'checkbox', id: 'bulk-loc-enable' });
      const locSection = el('div', { class: 'bulk-section' });
      locSection.appendChild(el('label', { class: 'bulk-section-head' }, [
        locEnable, el('span', { style: 'margin-left:6px;font-weight:600' }, '購入場所を一括設定')
      ]));
      locSel = el('select', { name: 'bulkLocation', style: 'margin-top:8px' });
      locSel.appendChild(el('option', { value: '' }, '（クリア）'));
      const locList = (purchaseLocs && purchaseLocs.length) ? purchaseLocs
        : (typeof PURCHASE_LOCATIONS !== 'undefined' ? PURCHASE_LOCATIONS : []);
      for (const o of locList) {
        locSel.appendChild(el('option', { value: o }, o));
      }
      locSection.appendChild(locSel);
      body.appendChild(locSection);
    }

    // ── カスタムフィールド ──
    const cfBoxes = [];
    if (fields && fields.length) {
      const cfSection = el('div', { class: 'bulk-section' });
      cfSection.appendChild(el('div', { class: 'bulk-section-head' },
        el('span', { style: 'font-weight:600' }, 'カスタムフィールドを一括設定')));
      for (const f of fields) {
        const enable = el('input', { type: 'checkbox' });
        const wrap = el('div', { class: 'field', style: 'margin-top:8px' });
        wrap.appendChild(el('label', { style: 'display:flex;align-items:center;gap:6px' }, [
          enable, el('span', {}, f.name)
        ]));
        let input;
        const type = f.type || 'select';
        if (type === 'select') {
          input = el('select', {});
          input.appendChild(el('option', { value: '' }, '（クリア）'));
          for (const o of f.options || []) input.appendChild(el('option', { value: o }, o));
        } else if (type === 'number') {
          input = el('input', { type: 'number' });
        } else if (type === 'textarea') {
          input = el('textarea', { style: 'min-height:60px' });
        } else {
          input = el('input', { type: 'text' });
        }
        wrap.appendChild(input);
        cfSection.appendChild(wrap);
        cfBoxes.push({ field: f, enable, input });
      }
      body.appendChild(cfSection);
    }

    const foot = el('div', { style: 'display:flex;gap:10px;flex:1;justify-content:flex-end' });
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', onclick: UI.closeModal }, 'キャンセル'));
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
      const patch = {};
      if (cpEnable.checked) {
        patch.couplingLeft = cpLeft.value || '';
        patch.couplingRight = cpRight.value || '';
      }
      if (locEnable && locEnable.checked) {
        patch.purchaseLocation = locSel.value || '';
      }
      if (folderEnable && folderEnable.checked) {
        patch.folderId = folderSel.value || null;
      }
      const cfPatch = {};
      for (const { field, enable, input } of cfBoxes) {
        if (enable.checked) cfPatch[field.id] = input.value || '';
      }
      if (Object.keys(cfPatch).length) patch.__customFields = cfPatch;

      if (!Object.keys(patch).length) {
        UI.toast('項目のチェックを1つ以上入れてください');
        return;
      }
      UI.closeModal();
      if (onSave) await onSave(patch);
    } }, '適用'));

    UI.openModal({ title: `一括設定（${targets.length}件）`, body, footer: foot });
  }

  // patch を1件のレコードに適用する
  function applyPatch(record, patch) {
    for (const k of Object.keys(patch)) {
      if (k === '__customFields') {
        record.customFields = record.customFields || {};
        for (const cfId of Object.keys(patch.__customFields)) {
          record.customFields[cfId] = patch.__customFields[cfId];
        }
      } else {
        record[k] = patch[k];
      }
    }
    record.updatedAt = new Date().toISOString();
  }

  function makeCharSelect(name, value, characters) {
    const sel = el('select', { name, class: 'coupling-select' });
    sel.appendChild(el('option', { value: '' }, '（変更なし）'));
    sel.appendChild(el('option', { value: '' }, '（クリア）'));
    for (const c of characters || []) {
      const opt = el('option', { value: c.name }, c.name);
      if (value === c.name) opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }

  return { openBulkEditModal, applyPatch };
})();
