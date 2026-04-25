// ====== 奥付テキスト解析モジュール ======
// iOS 16以降のLive Textで読み取ったテキスト、または手動コピペされた
// テキストから書名・サークル名・作家名・Twitter等を抽出する。
// ※ 自動カメラOCR（Tesseract）は精度が低かったため廃止しました。
const OCR = (() => {

  function parseColophon(rawText) {
    const result = {};
    if (!rawText) return result;
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      let m;

      // 書名・タイトル
      m = line.match(/^(?:書名|タイトル|作品名|本のタイトル)\s*[：:]\s*(.+)/);
      if (m && !result.title) { result.title = m[1].trim(); continue; }

      // サークル名
      m = line.match(/^(?:サークル名?|circle|サクル名)\s*[：:]\s*(.+)/i);
      if (m && !result.circleName) { result.circleName = m[1].trim(); continue; }

      // 作家名（複数パターン）
      m = line.match(/^(?:著者|作者|作家|執筆|発行人?|著|作)\s*[：:]\s*(.+)/);
      if (!m) m = line.match(/^(?:作：|著：|著者：|作者：)(.+)/);
      if (m && !result.authorName) { result.authorName = m[m.length - 1].trim(); continue; }

      // Twitter / X
      m = line.match(/^(?:Twitter|twitter|X|x|ツイッター|エックス)\s*[：:]\s*(.+)/);
      if (!m) m = line.match(/(@[A-Za-z0-9_]{1,15})/);
      if (m && !result.twitter) { result.twitter = m[1].trim(); continue; }

      // 発行日
      m = line.match(/^(?:発行(?:日)?|発売日|印刷日)\s*[：:]\s*(.+)/);
      if (m && !result.publishedDate) { result.publishedDate = m[1].trim(); continue; }

      // 価格
      m = line.match(/^(?:価格|定価|頒布価格|本体価格)\s*[：:]\s*[¥￥]?\s*([0-9,]+)/);
      if (m && !result.price) { result.price = m[1].replace(/,/g, ''); continue; }
    }

    // 書名が見つからない場合のフォールバック（先頭の日本語っぽい行）
    if (!result.title) {
      const skipPattern = /\d{4}年|\d+円|発行|印刷|頒布|isbn|http|@|サークル|作者|著者|作家|twitter/i;
      const candidate = lines.find(
        (l) => l.length >= 2 && !skipPattern.test(l) && /[ぁ-鿿]/.test(l)
      );
      if (candidate) result.title = candidate;
    }

    return result;
  }

  return { parseColophon };
})();
