// コンテンツスクリプト: DOM抽出と選択テキスト取得（F-003, F-004）

import type { ContentMessage } from '../types/messages.js';
import { extractPageContent } from './extract.js';

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
