// コンテンツスクリプト: DOM抽出と選択テキスト取得（F-003, F-004）
// F-501 / F-502 / F-503: フローティング Explain ボタンの統合

import type { ContentMessage } from '../types/messages.js';
import { extractPageContent } from './extract.js';
import { initFloatingButton } from './floating.js';

// F-502 / F-503: フローティングボタンを初期化する。
// ボタンクリック時は background に FLOATING_EXPLAIN_REQUEST を送信し、
// background が Side Panel を開いて Explain を自動実行する。
initFloatingButton(() => {
  const selectedText = window.getSelection()?.toString() ?? '';
  if (!selectedText.trim()) return;

  chrome.runtime.sendMessage({
    type: 'FLOATING_EXPLAIN_REQUEST',
    selectionText: selectedText,
  }).catch((e: unknown) => {
    console.error('[content] FLOATING_EXPLAIN_REQUEST 送信エラー:', e);
  });
});

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_PAGE_CONTENT': {
      // ページ本文を抽出して返す（F-003, F-012）
      const result = extractPageContent(document);
      sendResponse({
        url: window.location.href,
        content: result.content,
        truncated: result.truncated,
        originalLength: result.originalLength,
      });
      return true;
    }

    case 'GET_SELECTED_TEXT': {
      // ユーザーが選択したテキストを返す（F-004）
      const selected = window.getSelection()?.toString() ?? '';
      sendResponse({ selectedText: selected });
      return true;
    }

    default: {
      // 網羅性チェック: 未知のメッセージ型は型エラーになる
      const _exhaustive: never = message;
      console.error('[content] 未知のメッセージタイプ:', (_exhaustive as ContentMessage).type);
      return false;
    }
  }
});
