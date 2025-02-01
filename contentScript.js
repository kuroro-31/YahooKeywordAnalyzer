// contentScript.js
(() => {
  // リキャプチャページの検出
  function detectRecaptcha() {
    // 通常のリキャプチャフレーム
    const recaptchaFrame = document.querySelector('iframe[src*="recaptcha"]');

    // Googleのsorryページの検出
    const isSorryPage =
      window.location.href.includes("/sorry/index") ||
      document.title.includes("Sorry") ||
      document.querySelector("form#captcha-form");

    if (recaptchaFrame || isSorryPage) {
      // より詳細な情報を含めてメッセージを送信
      chrome.runtime.sendMessage({
        type: "RECAPTCHA_DETECTED",
        payload: {
          url: window.location.href,
          timestamp: new Date().toISOString(),
          // URLからキーワードを抽出する試み
          keyword:
            new URLSearchParams(window.location.search).get("q") || undefined,
        },
      });
      return true;
    }
    return false;
  }

  // 検索結果を解析する関数を修正
  function analyzeSearchResults() {
    try {
      // 検索結果の総ヒット数を取得
      let totalHitCount = 0;
      const resultStats = document.getElementById("result-stats");
      if (resultStats) {
        const match = resultStats.textContent
          .replace(/\s/g, "")
          .match(/約?([\d,]+)/);
        if (match && match[1]) {
          totalHitCount = parseInt(match[1].replace(/,/g, ""), 10);
        }
      }

      // 各種カウンターの初期化
      let QA_count = 0;
      let QA_highestRank = null;
      let Blog_count = 0;
      let Blog_highestRank = null;
      let SNS_count = 0;
      let SNS_highestRank = null;
      let sns_details = {
        Tiktok: 0,
        Instagram: 0,
        X: 0,
        Facebook: 0,
        Youtube: 0,
        Twitch: 0,
      };

      // 検索結果の各アイテムを解析
      const searchItems = document.querySelectorAll("div.g");
      let rank = 1;

      searchItems.forEach((item) => {
        const link = item.querySelector("a");
        if (!link || !link.href) return;

        try {
          // URLの妥当性をチェック
          const url = new URL(link.href);
          const domain = url.hostname.toLowerCase();

          // Q&Aサイトのチェック
          if (QA_SITES.some((site) => domain.includes(site))) {
            QA_count++;
            if (!QA_highestRank || rank < QA_highestRank) {
              QA_highestRank = rank;
            }
          }

          // ブログサイトのチェック
          if (BLOG_SITES.some((site) => domain.includes(site))) {
            Blog_count++;
            if (!Blog_highestRank || rank < Blog_highestRank) {
              Blog_highestRank = rank;
            }
          }

          // SNSサイトのチェック
          Object.entries(SNS_SITES).forEach(([platform, domains]) => {
            if (domains.some((site) => domain.includes(site))) {
              SNS_count++;
              sns_details[platform]++;
              if (!SNS_highestRank || rank < SNS_highestRank) {
                SNS_highestRank = rank;
              }
            }
          });

          rank++;
        } catch (urlError) {
          console.warn("無効なURL:", link.href, urlError);
          // 無効なURLの場合はスキップして次の結果へ
          return;
        }
      });

      return {
        totalHitCount,
        QA_count,
        QA_highestRank,
        Blog_count,
        Blog_highestRank,
        SNS_count,
        SNS_highestRank,
        sns_details,
      };
    } catch (error) {
      console.error("解析エラー:", error);
      // エラー情報を詳細化
      const enhancedError = new Error(`解析エラー: ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.url = window.location.href;
      enhancedError.timestamp = new Date().toISOString();
      throw enhancedError;
    }
  }

  // メイン処理
  function main() {
    try {
      // リキャプチャチェック
      if (detectRecaptcha()) {
        chrome.runtime.sendMessage({
          type: "RECAPTCHA_DETECTED",
          message: "リキャプチャが検出されました",
          url: window.location.href,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // 検索結果を解析
      const results = analyzeSearchResults();
      console.log("解析結果:", results);

      // 結果をbackground.jsに送信
      chrome.runtime.sendMessage({
        type: "DOM_PARSED",
        payload: results,
      });
    } catch (error) {
      console.error("メイン処理エラー:", error);
      chrome.runtime.sendMessage({
        type: "ANALYSIS_ERROR",
        payload: {
          error: error.message,
        },
      });
    }
  }

  // ページ読み込み完了時に実行
  if (document.readyState === "complete") {
    main();
  } else {
    window.addEventListener("load", main);
  }

  chrome.runtime.onMessage.addListener(function (
    request,
    sender,
    sendResponse
  ) {
    if (request.action === "startSolving") {
      startSolving();
    }
  });

  function startSolving() {
    solve();
  }

  // 検索キーワードを入力して検索を実行する関数を追加
  function executeSearch(keyword) {
    // 検索フォームを取得
    const searchInput = document.querySelector('textarea[name="q"]');
    const searchForm = document.querySelector("form");

    if (searchInput && searchForm) {
      // 検索キーワードを設定
      searchInput.value = keyword;

      // フォームをサブミット
      searchForm.submit();
    }
  }

  // メッセージリスナーを追加
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "searchKeyword") {
      executeSearch(message.keyword);
    }
  });
})();
