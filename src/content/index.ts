// コンテンツスクリプト: DOM抽出と選択テキスト取得（F-003, F-004）
// F-501 / F-502 / F-503: フローティング Explain ボタンの統合
// 選択時の自動解説（ポップアップ）を Side Panel の Chat にも投稿する

import type { BackgroundMessage, ContentMessage } from '../types/messages.js';
import { extractPageContent } from './extract.js';
import { initFloatingButton } from './floating.js';
import type { SelectionContext } from './selection-context.js';

/** 自動解説に渡す選択テキストの上限文字数 */
const AUTO_EXPLAIN_MAX_CHARS = 5000;

/**
 * 直近の自動解説の進行状況。
 * Explain ボタンが押されたとき、Side Panel に何を頼むか（投稿済み本文を渡す / 開くだけ / 解説をやり直す）を決めるのに使う。
 */
interface AutoExplainState {
  /** floating.ts から渡された選択テキスト（trim 前。Explain ボタン側の window.getSelection() と同じ値） */
  text: string;
  status: 'pending' | 'done' | 'error';
  /** status === 'done' のときの解説本文 */
  explanation?: string;
  /** 生成中に Explain ボタンが押された（Side Panel は開いてあるので、失敗時はそちらで解説をやり直す） */
  panelRequested?: boolean;
}

let autoExplainState: AutoExplainState | null = null;

/** 応答を待たない background への送信（失敗はログのみ） */
function notifyBackground(message: BackgroundMessage): void {
  chrome.runtime.sendMessage(message).catch((e: unknown) => {
    console.error(`[content] ${message.type} 送信エラー:`, e);
  });
}

/**
 * ポップアップ用の CHAT メッセージを組み立てる。
 * 指示文と構成は Side Panel の Explain selection（sidepanel/chat.ts）と同じにする。
 * 指示を足すと応答が長くなり、その分だけ表示が遅れるため。前後の文章だけ追加で渡す。
 */
function buildExplainMessage(text: string, context: SelectionContext): BackgroundMessage {
  const pageContent = extractPageContent(document).content;
  const userMessage = [
    `Page context (for reference, do not summarize this):\n<page>\n${pageContent}\n</page>`,
    `Text before selection (context only):\n<before>\n${context.before}\n</before>`,
    `Explain the following selection within that context:\n<selection>\n${text}\n</selection>`,
    `Text after selection (context only):\n<after>\n${context.after}\n</after>`,
  ].join('\n\n');
  return {
    type: 'CHAT',
    userMessage,
    history: [],
    pageContent: '',
    useShortPrompt: text.length < 40,
  };
}

// 選択が確定したらその場のポップアップで自動解説し、結果は Side Panel の Chat にも投稿する。
// Explain ボタンは Side Panel を開く。解説済みなら Side Panel で解説をやり直さない（二重投稿・二重 API 呼び出しの防止）。
initFloatingButton(() => {
  const selectedText = window.getSelection()?.toString() ?? '';
  if (!selectedText.trim()) return;
  const state = autoExplainState?.text === selectedText ? autoExplainState : null;

  if (state?.status === 'done' && state.explanation) {
    // 解説済み: 本文を持たせて Side Panel を開く（Side Panel が閉じていて未投稿でもここで届く。既に投稿済みなら Side Panel 側で重複排除）
    notifyBackground({ type: 'FLOATING_EXPLAIN_REQUEST', selectionText: selectedText, explanation: state.explanation });
    return;
  }
  if (state?.status === 'pending') {
    // 生成中: Side Panel を開くだけにして、完了時の投稿に任せる
    state.panelRequested = true;
    notifyBackground({ type: 'OPEN_SIDE_PANEL' });
    return;
  }
  // 自動解説が失敗した / 走っていない: 従来どおり Side Panel 側で解説を実行する
  notifyBackground({ type: 'FLOATING_EXPLAIN_REQUEST', selectionText: selectedText });
}, async (selectedText, context) => {
  const state: AutoExplainState = { text: selectedText, status: 'pending' };
  autoExplainState = state;
  const text = selectedText.trim().slice(0, AUTO_EXPLAIN_MAX_CHARS);
  try {
    const response = await chrome.runtime.sendMessage(buildExplainMessage(text, context)) as
      | { text?: string; error?: string }
      | undefined;
    if (response?.error) throw new Error(response.error);
    if (!response?.text) throw new Error('解説を取得できませんでした。');
    state.status = 'done';
    state.explanation = response.text;
    // 次の選択が始まっていたら（ポップアップでも破棄される）Chat にも投稿しない
    if (autoExplainState === state) {
      notifyBackground({ type: 'FLOATING_EXPLAIN_RESULT', selectionText: text, explanation: response.text });
    }
    return response.text;
  } catch (e) {
    state.status = 'error';
    if (autoExplainState === state && state.panelRequested) {
      // 生成中に Explain が押されて Side Panel は開いているので、そちらで解説をやり直す
      notifyBackground({ type: 'FLOATING_EXPLAIN_REQUEST', selectionText: selectedText });
    }
    throw e;
  }
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
