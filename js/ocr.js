// ====== OCR Module (Tesseract.js wrapper) ======
// 初回使用時にインターネット接続が必要です（日本語モデル約35MB）
// 2回目以降はブラウザキャッシュから読み込まれます
const OCR = (() => {
  const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  let _loaded = false;

  async function loadTesseract() {
    if (_loaded || typeof Tesseract !== 'undefined') { _loaded = true; return; }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_CDN;
      s.onload = () => { _loaded = true; resolve(); };
      s.onerror = () => reject(new Error('Tesseractの読み込みに失敗しました。\nインターネット接続を確認してください。'));
      document.head.appendChild(s);
    });
  }

  async function recognize(imageSource, onProgress) {
    await loadTesseract();
    const { data: { text } } = await Tesseract.recognize(imageSource, 'jpn', {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(Math.floor(m.progress * 100));
        }
      }
    });
    return text;
  }

  // 奥付テキストから書名・サークル名・作家名を抽出
  function parseColophon(rawText) {
    const result = {};
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      let m;

      // 書名
      m = line.match(/^(?:書名|タイトル|作品名)\s*[：:]\s*(.+)/);
      if (m && !result.title) { result.title = m[1].trim(); continue; }

      // サークル名
      m = line.match(/^(?:サークル名?|circle)\s*[：:]\s*(.+)/i);
      if (m && !result.circleName) { result.circleName = m[1].trim(); continue; }

      // 作家名（複数パターン）
      m = line.match(/^(?:著者|作者|作家|著|作)\s*[：:]\s*(.+)/);
      if (!m) m = line.match(/^(?:作：|著：|著者：|作者：)(.+)/);
      if (m && !result.authorName) { result.authorName = m[m.length - 1].trim(); continue; }
    }

    // 書名が見つからない場合、最初の日本語らしい行をフォールバックに使う
    if (!result.title) {
      const skipPattern = /\d{4}年|\d+円|発行|印刷|頒布|isbn|http|@|サークル|作者|著者|作家/i;
      const candidate = lines.find(
        (l) => l.length >= 2 && !skipPattern.test(l) && /[ぁ-鿿]/.test(l)
      );
      if (candidate) result.title = candidate;
    }

    return result;
  }

  return { recognize, parseColophon };
})();
