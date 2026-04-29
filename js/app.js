// ====== アプリバージョン ======
const APP_VERSION = '2026-04-28 rev.14';

// ====== Router + App bootstrap ======
const App = (() => {
  const routes = {
    'library':  { title: '同人誌管理', render: () => Library.render() },
    'wishlist': { title: '未購入リスト', render: () => Wishlist.render() },
    'events':   { title: 'イベント管理', render: () => Events.renderList() },
    'event':    { title: 'イベント詳細', render: (p) => Events.renderDetail(p) },
    'stats':    { title: '統計（金額）', render: () => Stats.render() },
    'settings': { title: '設定', render: () => Settings.render() }
  };

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '') || 'library';
    const [name, ...rest] = h.split('/');
    return { name: name || 'library', params: rest };
  }

  async function route() {
    const { name, params } = parseHash();
    const def = routes[name] || routes['library'];
    document.getElementById('page-title').textContent = def.title;
    const main = document.getElementById('main');
    main.innerHTML = '<div class="muted text-center" style="padding:30px">読み込み中...</div>';
    try {
      const content = await def.render(params);
      main.innerHTML = '';
      if (content instanceof Node) main.appendChild(content);
      else if (typeof content === 'string') main.innerHTML = content;
    } catch (err) {
      console.error(err);
      main.innerHTML = `<div class="empty"><h2>エラー</h2><p class="muted">${UI.esc(err.message)}</p></div>`;
    }
    // highlight nav
    document.querySelectorAll('.nav-list a').forEach((a) => {
      a.classList.toggle('active', a.dataset.route === name || (name === 'event' && a.dataset.route === 'events'));
    });
    closeDrawer();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function openDrawer() {
    document.getElementById('drawer').classList.add('open');
    document.getElementById('drawer-backdrop').classList.add('show');
  }
  function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('drawer-backdrop').classList.remove('show');
  }

  function init() {
    document.getElementById('menu-btn').addEventListener('click', openDrawer);
    document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);
    window.addEventListener('hashchange', route);

    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js?v=17').catch(() => {});
    }

    route();
  }

  // navigation helper used by features
  function go(path) { location.hash = '#/' + path; }

  return { init, go, route };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
