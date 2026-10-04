// コンテンツスクリプト: DOM抽出と選択テキスト取得（F-003, F-004）
// F-501 / F-502 / F-503: フローティング Explain ボタンの統合

import type { ContentMessage } from '../types/messages.js';
import { extractPageContent } from './extract.js';
import { initFloatingButton } from './floating.js';

// 選択が確定したらその場のポップアップで自動解説する。
// Explain ボタンを押した場合は従来どおり Side Panel も開ける。
initFloatingButton(() => {
  const selectedText = window.getSelection()?.toString() ?? '';
  if (!selectedText.trim()) return;

  chrome.runtime.sendMessage({
    type: 'FLOATING_EXPLAIN_REQUEST',
    selectionText: selectedText,
  }).catch((e: unknown) => {
    console.error('[content] FLOATING_EXPLAIN_REQUEST 送信エラー:', e);
  });
}, async (selectedText, context) => {
  const text = selectedText.trim().slice(0, 5000);
  const pageContent = extractPageContent(document).content;
  // 指示文と構成は Side Panel の Explain selection（sidepanel/chat.ts）と同じにする。
  // 指示を足すと応答が長くなり、その分だけ表示が遅れるため。前後の文章だけ追加で渡す。
  const userMessage = [
    `Page context (for reference, do not summarize this):\n<page>\n${pageContent}\n</page>`,
    `Text before selection (context only):\n<before>\n${context.before}\n</before>`,
    `Explain the following selection within that context:\n<selection>\n${text}\n</selection>`,
    `Text after selection (context only):\n<after>\n${context.after}\n</after>`,
  ].join('\n\n');
  const response = await chrome.runtime.sendMessage({
    type: 'CHAT',
    userMessage,
    history: [],
    pageContent: '',
    useShortPrompt: text.length < 40,
  }) as { text?: string; error?: string } | undefined;
  if (response?.error) throw new Error(response.error);
  if (!response?.text) throw new Error('解説を取得できませんでした。');
  return response.text;
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
