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

  // ====== X（旧Twitter）投稿テキスト解析 ======
  // 同人誌の頒布告知ポストから書名・スペース・価格などを抽出
  function parseXPost(rawText, options = {}) {
    const result = {};
    if (!rawText) return result;
    const characters1 = options.characters1 || [];
    const characters2 = options.characters2 || [];

    const text = rawText.replace(/\r/g, '');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    // ── スペース番号 ──
    // 例：西2ヤ18b、西2モ63b、東6ホ12a、南3シ45A
    // パターン：[棟][1-9][カナ1〜2文字][数字][a/b]
    const spaceRegex = /([東西南北][1-9][ァ-ヴー][0-9]{1,3}[abABａｂＡＢ]?)/;
    for (const line of lines) {
      const m = line.match(spaceRegex);
      if (m) { result.spaceCode = m[1].replace(/[ａＡ]/g, 'a').replace(/[ｂＢ]/g, 'b'); break; }
    }

    // ── タイトル：『』または「」内のテキスト ──
    {
      const m = text.match(/[『「]([^』」]+)[』」]/);
      if (m) result.title = m[1].trim();
    }

    // ── 価格 ──
    // 「イベント頒布価格500円」「会場価格 500円」「/ 500円」「価格：500円」
    {
      let m = text.match(/(?:頒布価格|会場価格|頒布|定価|価格)\s*[:：]?\s*([0-9,]+)\s*円/);
      if (!m) m = text.match(/[\/／]\s*([0-9]{2,5})\s*円/);
      if (!m) {
        // 単独の「N円」（ただしページ数pや日付と紛れないよう100円以上）
        m = text.match(/(?<!\d)([1-9][0-9]{2,4})\s*円/);
      }
      if (m) result.price = m[1].replace(/,/g, '');
    }

    // ── イベント名 ──
    // 優先：ユーザー登録のイベント名リストから探す
    {
      const userEventNames = options.eventNames || [];
      for (const ename of userEventNames) {
        if (!ename) continue;
        if (text.includes(ename)) { result.eventName = ename; break; }
      }
      // フォールバック：定番イベントのパターン
      if (!result.eventName) {
        const eventPatterns = [
          /(SUPER COMIC CITY[^\s\n]*)/i,
          /(スパコミ[^\s\n]*)/,
          /(コミックマーケット\s*\d+)/, /(コミケ\s*\d+)/, /(C\d{2,3})/,
          /(コミティア\s*\d+)/, /(COMITIA\s*\d+)/i,
          /(エアコミケ[^\s\n]*)/, /(コミックライブ[^\s\n]*)/,
          /(関西コミティア[^\s\n]*)/, /(コミックシティ[^\s\n]*)/
        ];
        for (const re of eventPatterns) {
          const m = text.match(re);
          if (m) { result.eventName = m[1].trim(); break; }
        }
      }
    }

    // ── カップリング：登録された人名リストから「左+右」のペアを検索 ──
    if (characters1.length && characters2.length) {
      // パターン1：「人名×人名」「人名/人名」など明示的
      const pairRegex = /([^\s／/×x×]{1,8})\s*[×x×]\s*([^\s／/×x×]{1,8})/;
      const pm = text.match(pairRegex);
      if (pm) {
        const left = pm[1].trim(); const right = pm[2].trim();
        const c1 = characters1.find((c) => c.name === left || left.includes(c.name));
        const c2 = characters2.find((c) => c.name === right || right.includes(c.name));
        if (c1) result.couplingLeft = c1.name;
        if (c2) result.couplingRight = c2.name;
      }

      // パターン2：略称（「キョカラ」=「キョウスケ＋カラス」のような頭文字結合）
      // 各キャラ名の先頭1〜3文字の組み合わせを検査
      if (!result.couplingLeft && !result.couplingRight) {
        for (const c1 of characters1) {
          for (const c2 of characters2) {
            const prefixes1 = [c1.name.slice(0, 2), c1.name.slice(0, 3)];
            const prefixes2 = [c2.name.slice(0, 2), c2.name.slice(0, 3)];
            for (const p1 of prefixes1) {
              for (const p2 of prefixes2) {
                if (!p1 || !p2) continue;
                if (text.includes(p1 + p2)) {
                  result.couplingLeft = c1.name;
                  result.couplingRight = c2.name;
                  break;
                }
              }
              if (result.couplingLeft) break;
            }
            if (result.couplingLeft) break;
          }
          if (result.couplingLeft) break;
        }
      }
    }

    // ── レーティング ──
    // ユーザー登録のレーティング選択肢から探す → なければ汎用パターン → 元の値を維持
    {
      const userRatings = options.ratings || [];
      // 文字列が長い順に検査（'R-18Nあり' を 'R-18' より先に）
      const sortedRatings = [...userRatings].sort((a, b) => b.length - a.length);
      for (const rname of sortedRatings) {
        if (!rname) continue;
        if (text.includes(rname)) { result.rating = rname; break; }
      }
      // フォールバック（成人向け→R-18 などに正規化）
      if (!result.rating) {
        if (/成人向け|成年向け/.test(text)) {
          result.rating = sortedRatings.find((r) => /R-?18/i.test(r)) || 'R-18';
        } else if (/全年齢|一般向け/.test(text)) {
          result.rating = sortedRatings.find((r) => r === '全年齢') || '全年齢';
        }
      }
    }

    // ── サイズ（ページ数は除外） ──
    {
      const userSizes = options.bookSizes || [];
      // 例：「A5」「B5」など。ページ数は無視
      let m = text.match(/([AaBb][3-6])(?!\d)/);
      if (m) {
        const sz = m[1].toUpperCase();
        // ユーザー登録リストに同じサイズがあればそれを使う、無くても抽出値を返す
        const matched = userSizes.find((s) => s.toUpperCase() === sz);
        result.size = matched || sz;
      } else {
        // 「文庫」など全角サイズ
        for (const s of userSizes) {
          if (s && /[ぁ-龥]/.test(s) && text.includes(s)) {
            result.size = s; break;
          }
        }
      }
    }

    // ── ノベルティ／特典情報 → eventNotes ──
    {
      const noveltyLines = lines.filter((l) =>
        /ノベルティ|特典|おまけ|無配|頒布物|新刊|既刊|サンプル/.test(l)
      );
      if (noveltyLines.length) result.eventNotes = noveltyLines.join('\n');
    }

    return result;
  }

  return { parseColophon, parseXPost };
})();
