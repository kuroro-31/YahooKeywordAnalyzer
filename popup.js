// popup.js
// グローバル変数として定義
let collectedResults = [];

document.addEventListener("DOMContentLoaded", async () => {
  const keywordInput = document.getElementById("keywordInput");
  const startBtn = document.getElementById("startBtn");
  const clearKeywordsBtn = document.getElementById("clearKeywordsBtn");
  const statusEl = document.getElementById("status");
  const resultsContainer = document.getElementById("results-container");
  const csvPreview = document.getElementById("csv-preview");
  const copyCsvBtn = document.getElementById("copy-csv-btn");
  const clearResultsBtn = document.getElementById("clear-results-btn");
  const analysisStatus = document.getElementById("analysis-status");

  // 初期状態で非表示にする
  csvPreview.style.display = "none";
  copyCsvBtn.style.display = "none";
  clearResultsBtn.style.display = "none";

  // 保存された結果とキーワードを復元
  const stored = await chrome.storage.local.get([
    "analysisResults",
    "savedKeywords",
  ]);
  if (stored.analysisResults && stored.analysisResults.length > 0) {
    // 結果がある場合は表示する
    resultsContainer.style.display = "block";
    csvPreview.style.display = "block";
    copyCsvBtn.style.display = "block";
    clearResultsBtn.style.display = "block";

    collectedResults = stored.analysisResults;
    updateCsvPreview(collectedResults);
  }
  if (stored.savedKeywords) {
    keywordInput.value = stored.savedKeywords;
  }

  // キーワード入力の変更を監視して保存
  keywordInput.addEventListener("input", () => {
    chrome.storage.local.set({ savedKeywords: keywordInput.value });
  });

  // キーワードクリアボタンの処理
  clearKeywordsBtn.addEventListener("click", () => {
    if (confirm("入力されたキーワードをクリアしますか？")) {
      keywordInput.value = "";
      chrome.storage.local.remove("savedKeywords");
    }
  });

  // background.js からのメッセージを受け取って結果表示を更新
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "ANALYSIS_UPDATE") {
      const { currentKeyword, progressText } = message.payload;
      statusEl.textContent = `${currentKeyword}\n${progressText}`;
    } else if (message.type === "ANALYSIS_RESULT") {
      // 結果表示要素を表示
      csvPreview.style.display = "block";
      copyCsvBtn.style.display = "block";
      clearResultsBtn.style.display = "block";

      const { keywordResult, progressInfo } = message.payload;
      collectedResults.push(keywordResult);

      // 結果とキーワードの状態を保存
      chrome.storage.local.set({
        analysisResults: collectedResults,
        savedKeywords: keywordInput.value, // キーワードはそのまま保持
      });

      // CSV形式で結果を表示
      updateCsvPreview(collectedResults);

      // 進捗状況を更新
      statusEl.textContent = `処理完了: ${progressInfo.current}/${progressInfo.total}キーワード\n処理時間: ${progressInfo.processingTime}秒`;
    } else if (message.type === "ANALYSIS_FINISHED") {
      statusEl.textContent = "全キーワードの分析が完了しました。";
    } else if (message.type === "RECAPTCHA_INTERRUPT") {
      const { lastKeyword, currentCount, totalCount } = message.payload;
      statusEl.textContent = `⚠️ リキャプチャにより中断されました。\n処理済み: ${currentCount}/${totalCount}キーワード\n最後のキーワード: ${lastKeyword}`;
    } else if (message.type === "ANALYSIS_ERROR") {
      const { error, lastKeyword, currentCount, totalCount } = message.payload;
      statusEl.textContent = `⚠️ エラーが発生しました。\n${error}\n処理済み: ${currentCount}/${totalCount}キーワード\n最後のキーワード: ${lastKeyword}`;
    } else if (message.type === "RECAPTCHA_DETECTED") {
      showError(message.message);
    }
  });

  // 分析状態を復元
  const { isAnalyzing, analysisState, progressStatus, analysisError } =
    await chrome.storage.local.get([
      "isAnalyzing",
      "analysisState",
      "progressStatus",
      "analysisError",
    ]);

  // 分析中の場合、状態を表示
  if (isAnalyzing && analysisStatus) {
    analysisStatus.classList.add("active");
    if (progressStatus) {
      statusEl.textContent = `${progressStatus.currentKeyword}\n${progressStatus.progressText}`;
    }
  } else if (analysisStatus) {
    analysisStatus.classList.remove("active");
    if (analysisError) {
      statusEl.textContent = `⚠️ エラーが発生しました。\n${analysisError.message}\n処理済み: ${analysisError.currentCount}/${analysisError.totalCount}キーワード\n最後のキーワード: ${analysisError.lastKeyword}`;
    }
  }

  // 「分析開始」ボタンの処理を修正
  startBtn.addEventListener("click", async () => {
    const rawText = keywordInput.value.trim();
    if (!rawText) {
      statusEl.textContent = "キーワードが入力されていません。";
      return;
    }

    // 入力されたキーワードを配列に変換
    let keywords = rawText
      .split("\n")
      .map((k) => k.trim())
      .filter((k) => k.length > 1);

    // 保存された分析結果を取得
    const stored = await chrome.storage.local.get("analysisResults");
    const processedKeywords = new Set(
      (stored.analysisResults || []).map((result) => result.Keyword)
    );

    // すでに分析済みのキーワードを除外
    const newKeywords = keywords.filter(
      (keyword) => !processedKeywords.has(keyword)
    );

    // 除外されたキーワードがある場合は入力欄を更新
    if (newKeywords.length !== keywords.length) {
      keywordInput.value = newKeywords.join("\n");
      // 更新されたキーワードを保存
      chrome.storage.local.set({ savedKeywords: keywordInput.value });
    }

    // 分析対象のキーワードがない場合
    if (newKeywords.length === 0) {
      statusEl.textContent = "すべてのキーワードはすでに分析済みです。";
      return;
    }

    // 分析開始時にステータス表示
    if (analysisStatus) {
      analysisStatus.classList.add("active");
    }

    // 分析開始メッセージ送信
    chrome.runtime.sendMessage({
      type: "START_ANALYSIS",
      payload: { keywords: newKeywords },
    });
  });

  // Slack Webhook URL設定の処理を追加
  const slackSettingsSection = document.querySelector(".settings-section");
  const slackUrlInput = document.getElementById("slackWebhookUrl");
  const saveSlackUrlBtn = document.getElementById("saveSlackUrl");

  // 保存されているWebhook URLを読み込む
  chrome.storage.local.get("slackWebhookUrl", (result) => {
    if (result.slackWebhookUrl) {
      slackUrlInput.value = result.slackWebhookUrl;
      // Webhook URLが存在する場合は設定セクションを非表示
      slackSettingsSection.style.display = "none";
    }
  });

  // 設定を表示するためのリンクを追加
  const toggleSettingsLink = document.getElementById("toggleSettings");

  toggleSettingsLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (slackSettingsSection.style.display === "none") {
      slackSettingsSection.style.display = "block";
      toggleSettingsLink.textContent = "Slack設定を隠す";
    } else {
      slackSettingsSection.style.display = "none";
      toggleSettingsLink.textContent = "Slack設定を表示";
    }
  });

  // Webhook URLを保存
  saveSlackUrlBtn.addEventListener("click", () => {
    const webhookUrl = slackUrlInput.value.trim();
    if (webhookUrl) {
      chrome.storage.local.set({ slackWebhookUrl: webhookUrl }, () => {
        saveSlackUrlBtn.textContent = "保存しました！";
        setTimeout(() => {
          saveSlackUrlBtn.textContent = "保存";
          // 保存成功後に設定セクションを非表示
          slackSettingsSection.style.display = "none";
          toggleSettingsLink.textContent = "Slack設定を表示";
        }, 2000);
      });
    }
  });

  // 結果をクリアするボタンの処理を修正
  document
    .getElementById("clear-results-btn")
    .addEventListener("click", async () => {
      if (confirm("保存された結果をすべてクリアしますか？")) {
        // 結果配列をクリア
        collectedResults = [];

        // ストレージから結果を削除
        await chrome.storage.local.remove("analysisResults");

        // 表示要素をクリア
        document.getElementById("csv-preview").textContent = "";
        document.getElementById("results-container").textContent = "";

        // 表示要素を非表示
        document.getElementById("csv-preview").style.display = "none";
        document.getElementById("copy-csv-btn").style.display = "none";
        document.getElementById("clear-results-btn").style.display = "none";

        // ステータス表示をクリア
        document.getElementById("status").textContent = "";
      }
    });

  // メッセージリスナーを追加
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "searchKeyword") {
      // 検索フォームの要素を取得
      const searchInput = document.querySelector('textarea[name="q"]');
      const searchForm = document.querySelector('form[role="search"]');

      if (searchInput && searchForm) {
        // 検索フォームに値を設定
        searchInput.value = request.keyword;
        // フォームをサブミット
        searchForm.submit();
      }
    }
  });

  // Command+Enterのショートカットキーを追加
  document.addEventListener("keydown", (e) => {
    // MacではCommand、WindowsではCtrlキーを使用
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault(); // デフォルトの動作を防止
      startBtn.click(); // 分析開始ボタンのクリックをシミュレート
    }
  });

  // メッセージリスナーで分析完了時に非表示
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!analysisStatus) return;

    if (message.type === "ANALYSIS_FINISHED") {
      analysisStatus.classList.remove("active");
    } else if (message.type === "ANALYSIS_ERROR") {
      analysisStatus.classList.remove("active");
    } else if (message.type === "RECAPTCHA_INTERRUPT") {
      analysisStatus.classList.remove("active");
    }
  });
});

function convertToCSV(results) {
  // ヘッダー行を作成
  const headers = [
    "キーワード",
    "allintitle件数",
    "intitle件数",
    "Q&A件数",
    "Q&A最高順位",
    "無料ブログ件数",
    "ブログ最高順位",
    "SNS件数",
    "SNS最高順位",
  ];

  // データ行を作成
  const rows = results.map((result) => [
    result.Keyword,
    result.allintitle件数,
    result.intitle件数,
    result["Q&A件数"],
    result["Q&A最高順位"],
    result.無料ブログ件数,
    result.ブログ最高順位,
    result.SNS件数,
    result.SNS最高順位,
  ]);

  // ヘッダーとデータを結合してTSV形式に変換
  return [headers, ...rows]
    .map((row) => row.map((cell) => String(cell || "")).join("\t"))
    .join("\n");
}

// 分析結果を表示する関数を更新
function displayResults(results) {
  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "";

  results.forEach((result) => {
    const resultItem = document.createElement("div");
    resultItem.textContent = `${result.url}: ${result.result}`;
    resultsDiv.appendChild(resultItem);
  });
}

// CSV形式のプレビューを更新する関数を修正
function updateCsvPreview(results) {
  const csvPreview = document.getElementById("csv-preview");
  const headers = [
    "キーワード",
    "allintitle件数",
    "intitle件数",
    "Q&A件数",
    "Q&A最高順位",
    "無料ブログ件数",
    "ブログ最高順位",
    "SNS件数",
    "SNS最高順位",
  ];

  // 全ての結果を表示するように変更
  let csvContent = headers.join("\t") + "\n";

  // 全ての結果をループで処理
  results.forEach((result) => {
    const row = [
      result.Keyword,
      result.allintitle件数,
      result.intitle件数,
      result["Q&A件数"],
      result["Q&A最高順位"],
      result.無料ブログ件数,
      result.ブログ最高順位,
      result.SNS件数,
      result.SNS最高順位,
    ]
      .map((cell) => String(cell || "")) // nullやundefinedを空文字に変換
      .join("\t");

    csvContent += row + "\n";
  });

  csvPreview.textContent = csvContent;
  csvPreview.scrollTop = csvPreview.scrollHeight; // 自動スクロール
}

// コピーボタンの処理を追加
document.getElementById("copy-csv-btn").addEventListener("click", () => {
  const csvPreview = document.getElementById("csv-preview");
  navigator.clipboard.writeText(csvPreview.textContent).then(() => {
    // コピー成功時の視覚的フィードバック
    const originalText = csvPreview.style.backgroundColor;
    csvPreview.style.backgroundColor = "#e6ffe6";
    setTimeout(() => {
      csvPreview.style.backgroundColor = originalText;
    }, 200);
  });
});

function showError(message) {
  const errorDiv = document.getElementById("error-message");
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
  }
}

// キーワードをクリックした時の処理
function handleKeywordClick(keyword) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const currentTab = tabs[0];

    // Google検索ページでない場合は、Googleに移動してから検索
    if (!currentTab.url?.includes("google.com/search")) {
      chrome.tabs.update(
        currentTab.id,
        {
          url: "https://www.google.com",
        },
        function (tab) {
          // ページ読み込み完了後に検索を実行
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              chrome.tabs.sendMessage(tab.id, {
                action: "searchKeyword",
                keyword: keyword,
              });
            }
          });
        }
      );
    } else {
      // すでにGoogle検索ページにいる場合は直接検索
      chrome.tabs.sendMessage(currentTab.id, {
        action: "searchKeyword",
        keyword: keyword,
      });
    }
  });
}

// キーワードリストの表示処理でクリックイベントを設定
function displayKeywords(keywords) {
  const keywordList = document.getElementById("keywordList");
  keywordList.innerHTML = "";

  keywords.forEach((keyword) => {
    const li = document.createElement("li");
    li.textContent = keyword;
    li.addEventListener("click", () => handleKeywordClick(keyword));
    keywordList.appendChild(li);
  });
}

// キーワード分析が完了した後の処理
function handleAnalysisComplete() {
  // 全てのキーワードの分析が完了したら入力欄をクリア
  if (remainingKeywords.length === 0) {
    document.getElementById("keywords").value = "";
  }
}
