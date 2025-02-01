// background.js

// 分析対象のキーワードリスト
let keywordQueue = [];
let currentIndex = 0;

// キーワードを順番に処理するフロー
async function processKeywords(keywords) {
  // 分析開始時にフラグをセット
  await chrome.storage.local.set({ isAnalyzing: true });

  // 保存された結果を取得して、処理済みのキーワードを特定
  const stored = await chrome.storage.local.get("analysisResults");
  const processedKeywords = new Set(
    (stored.analysisResults || []).map((result) => result.Keyword)
  );

  // 未処理のキーワードのみをフィルタリング
  const remainingKeywords = keywords.filter(
    (keyword) => !processedKeywords.has(keyword)
  );

  // バッチサイズを1に変更
  const chunks = [];
  for (let i = 0; i < remainingKeywords.length; i += 1) {
    chunks.push(remainingKeywords.slice(i, i + 1));
  }

  const totalKeywords = keywords.length;
  let processedCount = processedKeywords.size;

  try {
    for (let i = 0; i < chunks.length; i++) {
      // 分析状態を保存
      await chrome.storage.local.set({
        analysisState: {
          currentIndex: i,
          processedCount,
          totalKeywords,
          remainingKeywords: chunks.slice(i),
        },
      });

      if (i > 0) {
        // バッチ間の待機時間を30-40秒に短縮
        const waitTime = Math.floor(Math.random() * 10) + 30;
        for (let remaining = waitTime; remaining > 0; remaining--) {
          // 進捗状況を保存
          await chrome.storage.local.set({
            progressStatus: {
              currentKeyword: "インターバル待機中",
              progressText: `次のバッチまで残り${remaining}秒 (${processedCount}/${totalKeywords}キーワード完了)`,
            },
          });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      try {
        processedCount = await searchKeywords(
          chunks[i],
          processedCount,
          totalKeywords
        );
      } catch (error) {
        console.error("検索処理エラー:", error);
        await chrome.storage.local.set({
          isAnalyzing: false,
          analysisError: {
            message: error.message,
            lastKeyword: chunks[i][0],
            currentCount: processedCount,
            totalCount: totalKeywords,
          },
        });

        // エラー通知を送信（ブロードキャスト）
        chrome.runtime.sendMessage({
          type: "ANALYSIS_ERROR",
          payload: {
            error: error.message,
            lastKeyword: chunks[i][0],
            currentCount: processedCount,
            totalCount: totalKeywords,
          },
        });

        // Slack通知
        await notifySlack(
          `処理中にエラーが発生しました: ${error.message}`,
          chunks[i][0],
          processedCount,
          totalKeywords,
          error.url ||
            `https://www.google.com/search?q=${encodeURIComponent(
              chunks[i][0]
            )}`
        );

        return;
      }
    }

    // 全ての処理が完了
    await chrome.storage.local.set({
      isAnalyzing: false,
      analysisState: null,
      progressStatus: null,
    });

    // 完了通知をブロードキャスト
    chrome.runtime.sendMessage({
      type: "ANALYSIS_FINISHED",
    });

    // Slack通知
    await notifySlack(
      "全てのキーワード分析が完了しました",
      "",
      totalKeywords,
      totalKeywords,
      ""
    );

    await cleanupAnalysisWindow();
  } catch (error) {
    console.error("処理エラー:", error);
    await chrome.storage.local.set({
      isAnalyzing: false,
      analysisError: {
        message: error.message,
        currentCount: processedCount,
        totalCount: totalKeywords,
      },
    });
  }
}

// 検索結果を解析する関数を削除（contentScript.jsに移動）
// searchKeywords関数を修正
async function searchKeywords(keywordChunk, processedCount, totalKeywords) {
  console.log("検索開始:", keywordChunk);
  let localProcessedCount = processedCount;
  let retryCount = 0;
  const MAX_RETRIES = 3;

  for (const keyword of keywordChunk) {
    try {
      // キーワード処理前の待機時間を20-30秒に短縮
      const preSearchDelay = Math.floor(Math.random() * 10000) + 20000;
      await new Promise((resolve) => setTimeout(resolve, preSearchDelay));

      console.log("現在の検索キーワード:", keyword);

      // searchSingleKeywordの結果を待つ
      const result = await searchSingleKeyword(
        keyword,
        localProcessedCount,
        totalKeywords
      );

      // 結果を保存
      const stored = await chrome.storage.local.get("analysisResults");
      const results = stored.analysisResults || [];
      results.push(result);
      await chrome.storage.local.set({ analysisResults: results });

      // 結果をpopupに通知
      chrome.runtime.sendMessage({
        type: "ANALYSIS_RESULT",
        payload: {
          keywordResult: result,
          progressInfo: {
            current: localProcessedCount + 1,
            total: totalKeywords,
            processingTime: result.処理時間,
          },
        },
      });

      // キーワードが処理されたことを通知
      chrome.runtime.sendMessage({
        type: "KEYWORD_REMOVED",
        payload: {
          processedKeyword: keyword,
        },
      });

      // カウンターをインクリメント
      localProcessedCount++;

      // 検索成功後の待機時間を15-20秒に短縮
      const postSearchDelay = Math.floor(Math.random() * 5000) + 15000;
      await new Promise((resolve) => setTimeout(resolve, postSearchDelay));
    } catch (error) {
      console.error("検索エラー:", error);

      if (error.message === "RECAPTCHA_DETECTED") {
        retryCount++;

        if (retryCount <= MAX_RETRIES) {
          // リキャプチャ検出時の待機時間を2-3分に短縮
          const backoffDelay = Math.floor(Math.random() * 60000) + 120000;
          console.log(
            `リキャプチャ検出 - ${
              backoffDelay / 1000
            }秒待機後にリトライ (${retryCount}/${MAX_RETRIES})`
          );

          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
          // 同じキーワードを再試行するためにインデックスを戻す
          i--;
          continue;
        }
      }
      throw error;
    }
  }
  return localProcessedCount;
}

// searchSingleKeyword関数を修正
async function searchSingleKeyword(keyword, processedCount, totalKeywords) {
  try {
    const startTime = Date.now();

    // 検索URLを構築
    const normalUrl = `https://www.google.com/search?q=${encodeURIComponent(
      keyword
    )}`;
    const intitleUrl = `https://www.google.com/search?q=intitle:${encodeURIComponent(
      keyword
    )}`;
    const allintitleUrl = `https://www.google.com/search?q=allintitle:${encodeURIComponent(
      keyword
    )}`;

    // 専用の分析ウィンドウを作成（存在しない場合）
    let analysisWindow = await getOrCreateAnalysisWindow();

    // --- 1. 通常の検索 ---
    let tab = await createOrUpdateTab(analysisWindow.id, normalUrl);
    let normalResults = await waitForSearchResults(tab.id);

    // 各検索の間に十分な待機時間を設定
    await new Promise((resolve) => setTimeout(resolve, 50));

    // --- 2. intitle検索 ---
    await chrome.tabs.update(tab.id, { url: intitleUrl });
    let intitleResults = await waitForSearchResults(tab.id);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // --- 3. allintitle検索 ---
    await chrome.tabs.update(tab.id, { url: allintitleUrl });
    let allintitleResults = await waitForSearchResults(tab.id);

    const endTime = Date.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(1);

    return {
      Keyword: keyword || "",
      allintitle件数: allintitleResults?.totalHitCount || 0,
      intitle件数: intitleResults?.totalHitCount || 0,
      "Q&A件数": normalResults?.QA_count || 0,
      "Q&A最高順位": normalResults?.QA_highestRank || null,
      無料ブログ件数: normalResults?.Blog_count || 0,
      ブログ最高順位: normalResults?.Blog_highestRank || null,
      SNS件数: normalResults?.SNS_count || 0,
      SNS最高順位: normalResults?.SNS_highestRank || null,
      sns_details: normalResults?.sns_details || {},
      処理時間: `${processingTime}秒`,
    };
  } catch (error) {
    console.error("検索エラー:", error);
    throw error;
  }
}

// 検索結果を待機する関数
function waitForSearchResults(tabId) {
  return new Promise((resolve, reject) => {
    const onMessageListener = (message, sender) => {
      if (sender.tab.id === tabId) {
        if (message.type === "DOM_PARSED") {
          chrome.runtime.onMessage.removeListener(onMessageListener);
          resolve(message.payload);
        } else if (message.type === "RECAPTCHA_DETECTED") {
          chrome.runtime.onMessage.removeListener(onMessageListener);
          reject(new Error("RECAPTCHA_DETECTED"));
        }
      }
    };

    chrome.runtime.onMessage.addListener(onMessageListener);

    // タイムアウト設定
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessageListener);
      reject(new Error("TIMEOUT"));
    }, 30000);
  });
}

// リキャプチャ検出時のSlack通知関数
async function notifySlack(
  message,
  keyword = "",
  processedCount = 0,
  totalKeywords = 0,
  errorUrl = ""
) {
  console.log("Slack通知開始:", {
    message,
    keyword,
    processedCount,
    totalKeywords,
    errorUrl,
  });

  try {
    const result = await chrome.storage.local.get("slackWebhookUrl");
    const SLACK_WEBHOOK_URL = result.slackWebhookUrl;

    if (!SLACK_WEBHOOK_URL) {
      console.error("Slack Webhook URLが設定されていません");
      return;
    }

    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "🚨 キーワード分析アラート",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${message}*`,
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*キーワード:*\n${keyword || "不明"}`,
              },
              {
                type: "mrkdwn",
                text: `*進捗状況:*\n${processedCount}/${totalKeywords} キーワード完了`,
              },
              {
                type: "mrkdwn",
                text: `*発生時刻:*\n${new Date().toLocaleString("ja-JP")}`,
              },
              {
                type: "mrkdwn",
                text: `*URL:*\n${errorUrl || "不明"}`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Slack通知エラー: ${response.status}`);
    }

    console.log("Slack通知成功:", await response.text());
  } catch (error) {
    console.error("Slack通知エラー:", error);
  }
}

// Google検索URLを開き、contentScriptからDOM解析結果を受け取る
function getSearchResults(searchUrl, keyword, processedCount, totalKeywords) {
  return new Promise((resolve, reject) => {
    let isResolved = false;

    chrome.tabs.create({ url: searchUrl, active: false }, (tab) => {
      const onMessageListener = (message, sender, sendResponse) => {
        if (isResolved) return;
        if (message.type === "DOM_PARSED" && sender.tab.id === tab.id) {
          isResolved = true;
          let data = message.payload;
          chrome.tabs.remove(tab.id);
          chrome.runtime.onMessage.removeListener(onMessageListener);
          resolve(data);
        } else if (
          message.type === "RECAPTCHA_DETECTED" &&
          sender.tab.id === tab.id
        ) {
          isResolved = true;
          chrome.tabs.remove(tab.id);
          chrome.runtime.onMessage.removeListener(onMessageListener);
          reject(new Error("RECAPTCHA_DETECTED"));
        }
      };

      // タブの読み込み完了を監視
      chrome.tabs.onUpdated.addListener(function onUpdated(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(onUpdated);

          // DOM解析のための待機時間
          setTimeout(() => {
            if (!isResolved) {
              // タイムアウト処理
              setTimeout(() => {
                if (!isResolved) {
                  isResolved = true;
                  chrome.tabs.remove(tab.id);
                  chrome.runtime.onMessage.removeListener(onMessageListener);
                  reject(new Error("TIMEOUT"));
                }
              }, 30000); // 30秒のタイムアウト
            }
          }, 3000); // 3秒の初期待機
        }
      });

      chrome.runtime.onMessage.addListener(onMessageListener);
    });
  });
}

// reCAPTCHAページを検出する関数を修正
function isRecaptchaPage(url, html) {
  return (
    url.includes("google.com/sorry/") || // Google sorry ページの検出を追加
    html.includes("g-recaptcha") ||
    html.includes("recaptcha") ||
    (html.includes("このページについて") &&
      html.includes("通常と異なるトラフィックが検出されました"))
  );
}

// manifest.json で webRequest 権限が必要
chrome.webRequest?.onCompleted?.addListener(
  function (details) {
    if (details.type === "main_frame") {
      chrome.tabs.get(details.tabId, function (tab) {
        if (
          tab &&
          (tab.url.includes("google.com/sorry/") ||
            tab.url.includes("/recaptcha/") ||
            (tab.url.includes("google.com/search") &&
              details.statusCode === 429))
        ) {
          chrome.notifications.create({
            type: "basic",
            iconUrl: "icon48.png",
            title: "reCAPTCHA検出",
            message:
              "Googleの検索でreCAPTCHAが表示されています。手動での対応が必要です。",
          });

          try {
            chrome.tabs.sendMessage(details.tabId, {
              type: "RECAPTCHA_DETECTED",
              message: "リキャプチャが検出されました",
            });
          } catch (error) {
            console.error("タブへのメッセージ送信エラー:", error);
          }

          chrome.runtime.sendMessage({
            type: "RECAPTCHA_INTERRUPT",
          });

          // Slackに通知（URLを追加）
          notifySlack(
            "Googleの検索でreCAPTCHAが表示されています。手動での対応が必要です。",
            keywordQueue[currentIndex],
            currentIndex,
            keywordQueue.length,
            tab.url // URLを追加
          );
        }
      });
    }
  },
  { urls: ["*://*.google.com/*"] }
);

// popup.js からの分析開始指示を受け取る
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_ANALYSIS") {
    keywordQueue = msg.payload.keywords;
    currentIndex = 0;
    processKeywords(keywordQueue);
  }
});

// リキャプチャ検出時のメッセージ処理を修正
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RECAPTCHA_DETECTED") {
    // Slackに通知
    notifySlack(
      "リキャプチャが検出されました。手動での対応が必要です。",
      message.keyword || "不明",
      message.currentCount || 0,
      message.totalCount || 0,
      message.errorUrl || ""
    );

    // ポップアップに通知
    chrome.runtime.sendMessage({
      type: "RECAPTCHA_INTERRUPT",
      payload: {
        lastKeyword: message.keyword,
        currentCount: message.currentCount,
        totalCount: message.totalCount,
        errorUrl: message.errorUrl,
      },
    });
  }
  // 他のメッセージ処理...
});

// handleRecaptchaError関数を改善
async function handleRecaptchaError(
  keyword,
  processedCount,
  totalKeywords,
  url
) {
  try {
    // Slack通知
    await notifySlack(
      "検索が一時停止されました。reCAPTCHAによる確認が必要です。",
      keyword,
      processedCount,
      totalKeywords,
      url
    );

    // 通知を表示
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon48.png",
      title: "検索が一時停止されました",
      message: "reCAPTCHAによる確認が必要です。手動で対応してください。",
      priority: 2,
      requireInteraction: true,
    });

    // ポップアップに通知
    chrome.runtime.sendMessage({
      type: "RECAPTCHA_INTERRUPT",
      payload: {
        lastKeyword: keyword,
        currentCount: processedCount,
        totalCount: totalKeywords,
        url: url,
        timestamp: new Date().toISOString(),
      },
    });

    // 一時停止状態を保存
    await chrome.storage.local.set({
      pausedState: {
        lastKeyword: keyword,
        processedCount: processedCount,
        totalKeywords: totalKeywords,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("reCAPTCHAエラーハンドリング中のエラー:", error);
  }
}

// キーワード検索を実行する関数を修正
function searchKeyword(keyword) {
  // 現在のタブを取得
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const currentTab = tabs[0];

    // スクリプトを実行
    chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: (keyword) => {
        // Google検索フォームの要素を取得
        const searchInput = document.querySelector('input[name="q"]');
        const searchForm = document.querySelector('form[role="search"]');

        if (searchInput && searchForm) {
          // 検索フォームに値を設定
          searchInput.value = keyword;
          // フォームをサブミット
          searchForm.submit();
        }
      },
      args: [keyword],
    });
  });
}

// メッセージリスナーでsearchKeyword関数を呼び出す
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "searchKeyword") {
    searchKeyword(request.keyword);
  }
  // ... 他のメッセージハンドリング ...
});

// 分析用ウィンドウを取得または作成する関数
async function getOrCreateAnalysisWindow() {
  // 既存の分析ウィンドウを探す
  const windows = await chrome.windows.getAll();
  const existingWindow = windows.find(
    (w) => w.type === "popup" && w.id === analysisWindowId
  );

  if (existingWindow) {
    return existingWindow;
  }

  // 新しいウィンドウを作成
  const window = await chrome.windows.create({
    url: "about:blank",
    type: "popup",
    width: 800,
    height: 600,
    left: 100,
    top: 100,
    focused: false, // メインウィンドウのフォーカスを維持
  });

  // ウィンドウIDを保存
  analysisWindowId = window.id;
  return window;
}

// タブを作成または更新する関数
async function createOrUpdateTab(windowId, url) {
  // ウィンドウ内のタブを取得
  const tabs = await chrome.tabs.query({ windowId });

  if (tabs.length > 0) {
    // 既存のタブを更新
    return await chrome.tabs.update(tabs[0].id, { url });
  } else {
    // 新しいタブを作成
    return await chrome.tabs.create({ windowId, url });
  }
}

// グローバル変数として分析ウィンドウのIDを保持
let analysisWindowId = null;

// 分析終了時にウィンドウを閉じる処理を追加
async function cleanupAnalysisWindow() {
  if (analysisWindowId) {
    try {
      await chrome.windows.remove(analysisWindowId);
    } catch (error) {
      console.error("ウィンドウ終了エラー:", error);
    }
    analysisWindowId = null;
  }
}
