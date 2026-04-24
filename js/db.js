// ====== IndexedDB wrapper ======
const DB_NAME = 'DoujinManagerDB';
const DB_VERSION = 1;

const STORES = {
  books: 'books',         // 同人誌
  events: 'events',       // イベント
  spaces: 'spaces',       // スペース（イベント内の buy list 項目）
  customFields: 'customFields',
  settings: 'settings'    // key-value
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
    settings: {
      get: (k) => get(STORES.settings, k).then((v) => v ? v.value : undefined),
      set: (k, v) => put(STORES.settings, { key: k, value: v })
    }
  };
})();

// ===== ID utility =====
function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

const SPACE_STATUSES = [
  { key: 'none',      label: '未設定',    color: 'transparent' },
  { key: 'priority',  label: '最優先',    color: '#D06868' },
  { key: 'want',      label: '欲しい',    color: '#C8A440' },
  { key: 'special',   label: '特別',      color: '#6898B8' },
  { key: 'purchased', label: '購入済',    color: '#68A878' },
  { key: 'skip',      label: '購入しない', color: '#BEB8B0' }
];
