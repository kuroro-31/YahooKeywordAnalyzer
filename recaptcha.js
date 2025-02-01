// リキャプチャ検出のための主要な関数
const RecaptchaDetector = {
  RECAPTCHA_INDICATORS: {
    ELEMENTS: [
      ".g-recaptcha",
      "#recaptcha",
      "#captcha-form",
      'iframe[src*="recaptcha"]',
      'script[src*="recaptcha"]',
    ],
    TEXT_CONTENT: [
      "通常と異なるトラフィックが検出されました",
      "このページについて",
      "セキュリティ チェック",
      "reCAPTCHA による確認",
    ],
    URLS: ["google.com/sorry/", "/recaptcha/", "sorry/index"],
  },

  detect() {
    if (this.checkElements() || this.checkTextContent() || this.checkURL()) {
      this.notifyRecaptchaDetected();
      return true;
    }
    return false;
  },

  checkElements() {
    return this.RECAPTCHA_INDICATORS.ELEMENTS.some((selector) => {
      return document.querySelector(selector) !== null;
    });
  },

  checkTextContent() {
    const bodyText = document.body?.textContent?.toLowerCase() || "";
    return this.RECAPTCHA_INDICATORS.TEXT_CONTENT.some((text) => {
      return bodyText.includes(text);
    });
  },

  checkURL() {
    const currentURL = window.location.href.toLowerCase();
    return this.RECAPTCHA_INDICATORS.URLS.some((urlPart) => {
      return currentURL.includes(urlPart);
    });
  },

  notifyRecaptchaDetected() {
    try {
      chrome.runtime.sendMessage({
        type: "RECAPTCHA_DETECTED",
        message: "リキャプチャが検出されました",
        url: window.location.href,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("メッセージ送信エラー:", error);
    }
    return true;
  },
};

// グローバルスコープで関数を定義
function checkForRecaptcha() {
  return RecaptchaDetector.detect();
}

// DOMの読み込み完了時に自動チェック
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", checkForRecaptcha);
} else {
  checkForRecaptcha();
}

// DOMの変更を監視
const observer = new MutationObserver(() => {
  checkForRecaptcha();
});

// body要素が存在する場合のみ監視を開始
if (document.body) {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
