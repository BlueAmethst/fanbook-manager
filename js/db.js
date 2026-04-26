// ====== IndexedDB wrapper ======
const DB_NAME = 'DoujinManagerDB';
const DB_VERSION = 2;  // 2: wishlist ストア追加

const STORES = {
  books: 'books',         // 同人誌
  events: 'events',       // イベント
  spaces: 'spaces',       // スペース（イベント内の buy list 項目）
  customFields: 'customFields',
  settings: 'settings',   // key-value
  wishlist: 'wishlist'    // 未購入リスト（内部名はwishlistのまま）
};

const DB = (() => {
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORES.books)) {
          const s = db.createObjectStore(STORES.books, { keyPath: 'id' });
          s.createIndex('purchaseDate', 'purchaseDate');
          s.createIndex('purchaseLocation', 'purchaseLocation');
        }
        if (!db.objectStoreNames.contains(STORES.events)) {
          db.createObjectStore(STORES.events, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.spaces)) {
          const s = db.createObjectStore(STORES.spaces, { keyPath: 'id' });
          s.createIndex('eventId', 'eventId');
        }
        if (!db.objectStoreNames.contains(STORES.customFields)) {
          db.createObjectStore(STORES.customFields, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.settings)) {
          db.createObjectStore(STORES.settings, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORES.wishlist)) {
          const s = db.createObjectStore(STORES.wishlist, { keyPath: 'id' });
          s.createIndex('spaceCode', 'spaceCode');
          s.createIndex('eventId', 'eventId');
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode = 'readonly') {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }

  function getAll(store) {
    return tx(store).then((s) => new Promise((res, rej) => {
      const r = s.getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    }));
  }
  function get(store, key) {
    return tx(store).then((s) => new Promise((res, rej) => {
      const r = s.get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  }
  function put(store, value) {
    return tx(store, 'readwrite').then((s) => new Promise((res, rej) => {
      const r = s.put(value);
      r.onsuccess = () => res(value);
      r.onerror = () => rej(r.error);
    }));
  }
  function del(store, key) {
    return tx(store, 'readwrite').then((s) => new Promise((res, rej) => {
      const r = s.delete(key);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    }));
  }
  function getByIndex(store, indexName, value) {
    return tx(store).then((s) => new Promise((res, rej) => {
      const idx = s.index(indexName);
      const r = idx.getAll(value);
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    }));
  }

  return {
    open, STORES,
    getAll, get, put, del, getByIndex,
    // Convenience
    books: {
      all: () => getAll(STORES.books),
      get: (id) => get(STORES.books, id),
      save: (b) => put(STORES.books, b),
      remove: (id) => del(STORES.books, id)
    },
    events: {
      all: () => getAll(STORES.events),
      get: (id) => get(STORES.events, id),
      save: (e) => put(STORES.events, e),
      remove: (id) => del(STORES.events, id)
    },
    spaces: {
      all: () => getAll(STORES.spaces),
      get: (id) => get(STORES.spaces, id),
      byEvent: (eid) => getByIndex(STORES.spaces, 'eventId', eid),
      save: (sp) => put(STORES.spaces, sp),
      remove: (id) => del(STORES.spaces, id)
    },
    customFields: {
      all: () => getAll(STORES.customFields),
      save: (cf) => put(STORES.customFields, cf),
      remove: (id) => del(STORES.customFields, id)
    },
    wishlist: {
      all: () => getAll(STORES.wishlist),
      get: (id) => get(STORES.wishlist, id),
      save: (w) => put(STORES.wishlist, w),
      remove: (id) => del(STORES.wishlist, id),
      bySpaceCode: (code) => getByIndex(STORES.wishlist, 'spaceCode', code),
      byEvent: (eid) => getByIndex(STORES.wishlist, 'eventId', eid)
    },
    settings: {
      get: (k) => get(STORES.settings, k).then((v) => v ? v.value : undefined),
      set: (k, v) => put(STORES.settings, { key: k, value: v })
    },
    characters: {
      all: async () => (await get(STORES.settings, 'characters'))?.value || [],
      save: async (list) => put(STORES.settings, { key: 'characters', value: list })
    },
    appLists: {
      // page-level lists used as select options across the app
      // (event names / book sizes / ratings, etc.)
      get: async (key, fallback = []) =>
        (await get(STORES.settings, 'appList_' + key))?.value || fallback,
      set: async (key, list) =>
        put(STORES.settings, { key: 'appList_' + key, value: list })
    },
    characters1: {
      all: async () => (await get(STORES.settings, 'characters1'))?.value || [],
      save: async (list) => put(STORES.settings, { key: 'characters1', value: list })
    },
    characters2: {
      all: async () => (await get(STORES.settings, 'characters2'))?.value || [],
      save: async (list) => put(STORES.settings, { key: 'characters2', value: list })
    },
    defaultFieldConfig: {
      get: async (key) => (await get(STORES.settings, 'dfc_' + key))?.value || null,
      set: async (key, cfg) => put(STORES.settings, { key: 'dfc_' + key, value: cfg }),
      getMultiple: async (keys) => {
        const result = {};
        await Promise.all(keys.map(async (k) => {
          const v = await get(STORES.settings, 'dfc_' + k);
          result[k] = v?.value || null;
        }));
        return result;
      }
    }
  };
})();

// ===== ID utility =====
function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ===== カスタムフィールド スコープフィルタ =====
// page: 'books' | 'wishlist' を渡すと、そのページに表示すべきフィールドだけ返す
function filterFieldsByScope(fields, page) {
  return (fields || []).filter((f) => {
    const scope = f.scope || 'both';
    if (scope === 'both') return true;
    return scope === page;
  });
}

// ===== Constants shared across app =====
const PURCHASE_LOCATIONS = [
  'BOOTH',
  'とらのあな',
  'メロンブックス',
  '委託通販（他）',
  'イベント当日',
  'その他'
];

// アプリ設定リストのデフォルト値
const DEFAULT_BOOK_SIZES = ['A5', 'B5', 'A4', '文庫', 'その他'];
const DEFAULT_RATINGS = ['全年齢', 'R-18', 'R-18Nあり', 'R-18Nなし', 'R-15'];
const DEFAULT_EVENT_NAMES = [];

// デフォルト項目の入力形式設定対象フィールド
const CONFIGURABLE_DEFAULT_FIELDS = [
  { key: 'title',      label: '書名',                  page: 'both',     defaultType: 'text' },
  { key: 'circleName', label: 'サークル名',             page: 'both',     defaultType: 'text' },
  { key: 'authorName', label: '作家名',                 page: 'both',     defaultType: 'text' },
  { key: 'twitter',    label: 'Twitter (X)',           page: 'both',     defaultType: 'text' },
  { key: 'spaceCode',  label: 'スペース番号',           page: 'wishlist', defaultType: 'text' },
  { key: 'eventNotes', label: 'ノベルティ・限定情報',   page: 'wishlist', defaultType: 'textarea' },
  { key: 'notes',      label: '備考',                  page: 'both',     defaultType: 'textarea' }
];

const DEFAULT_FIELD_TYPES = [
  { value: 'text',     label: '短文テキスト' },
  { value: 'select',   label: '選択肢' },
  { value: 'textarea', label: '長文・備考' }
];

const SPACE_STATUSES = [
  { key: 'none',      label: '未設定',    color: 'transparent' },
  { key: 'priority',  label: '最優先',    color: '#D06868' },
  { key: 'want',      label: '欲しい',    color: '#C8A440' },
  { key: 'special',   label: '特別',      color: '#6898B8' },
  { key: 'purchased', label: '購入済',    color: '#68A878' },
  { key: 'skip',      label: '購入しない', color: '#BEB8B0' }
];
