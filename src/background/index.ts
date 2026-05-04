// バックグラウンドサービスワーカー: メッセージルータ
// MV3制約: service worker は永続しないため、モジュールスコープに状態を置かない

import type { BackgroundMessage } from '../types/messages.js';
import { saveSettings, loadSettings } from '../lib/storage.js';
import { callClaudeAPI, getExplainSystemPrompt, getShortExplainSystemPrompt, getChatSystemPromptBase } from '../lib/claude.js';
import { sanitizeErrorMessage, sanitizeErrorForLog } from '../lib/sanitize.js';
import { SHORT_CONTENT_THRESHOLD, SELECTION_MAX_CHARS } from '../content/extract.js';

// アイコンクリックでサイドパネルを開く設定
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// 直前に broadcast した URL（同一 URL の重複通知を防ぐ）
// MV3 service worker は永続しないが、同一起動セッション内での重複防止には有効
let lastBroadcastUrl = '';

/** TAB_CHANGED を broadcast する。同一 URL の連続通知はスキップする */
function broadcastTabChanged(url: string, tabId: number): void {
  if (url === lastBroadcastUrl) return;
  lastBroadcastUrl = url;
  chrome.runtime.sendMessage({
    type: 'TAB_CHANGED',
    url,
    tabId,
  }).catch(() => {
    // サイドパネルが開いていない場合は無視
  });
}

// タブ変更時にサイドパネルへ通知（F-008: ページ変更検知）
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      broadcastTabChanged(tab.url, activeInfo.tabId);
    }
  } catch (e) {
    console.error('[background] タブ情報取得エラー:', e);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // status === 'complete': 通常のページ遷移
  // changeInfo.url: SPA の History API (pushState/replaceState) やハッシュ変更で発火
  const shouldNotify =
    (changeInfo.status === 'complete' || changeInfo.url != null) &&
    tab.active &&
    tab.url;
  if (shouldNotify) {
    broadcastTabChanged(tab.url!, tab.id ?? tabId);
  }
});

// メッセージハンドラ（discriminated union の exhaustive switch）
chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((e: unknown) => {
      // エラーメッセージを sanitize してから返す（APIキー漏洩防止）
      const rawMsg = e instanceof Error ? e.message : String(e);
      const sanitizedMsg = sanitizeErrorMessage(rawMsg);
      // ログにはサニタイズ済みオブジェクトを出す（message・stack 両方を sanitize）
      const safeLog = sanitizeErrorForLog(e);
      console.error('[background] メッセージ処理エラー:', safeLog.message, safeLog.stack ?? '');
      sendResponse({ error: sanitizedMsg });
    });
  return true; // 非同期レスポンスのために true を返す
});

/**
 * メッセージをタイプ別にディスパッチする。
 * switch の exhaustive check により、新メッセージ型を追加した際に
 * ここを更新しないと型エラーになる。
 */
async function handleMessage(
  message: BackgroundMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'OPEN_SIDE_PANEL': {
      // サイドパネルを開く（ポップアップからの呼び出し）
      const tabId = sender.tab?.id;
      if (tabId) {
        await chrome.sidePanel.open({ tabId });
      }
      return { ok: true };
    }

    case 'GET_SETTINGS': {
      // 設定を取得する（APIキーは伏字にして返す）
      const settings = await loadSettings();
      return {
        ...settings,
        apiKey: settings.apiKey ? maskApiKey(settings.apiKey) : '',
      };
    }

    case 'SAVE_SETTINGS': {
      // 設定を保存する
      await saveSettings(message.settings);
      return { ok: true };
    }

    case 'EXPLAIN': {
      // Explain: ページ本文または選択テキストを Claude API に送り解説を返す（F-005, F-201, F-204, F-301, F-302）
      // outputLanguage に応じてシステムプロンプトの言語指示を切り替える
      const explainSettings = await loadSettings();
      const explainLang = explainSettings.outputLanguage;
      const explainPromptLang = explainLang === 'ja' ? 'Japanese' : 'English';

      if (message.mode === 'selection') {
        // 選択モード（F-301, F-302, F-303）:
        // 選択テキスト長で短文判定（F-303: pageContent ではなく selectionText で判定）
        const isShortSelection = message.selectionText.length < SHORT_CONTENT_THRESHOLD;
        const selectionSystemPrompt = isShortSelection
          ? getShortExplainSystemPrompt(explainLang)
          : getExplainSystemPrompt(explainLang);

        // 選択テキストを SELECTION_MAX_CHARS で切り詰め（F-302）
        // '…' を含めた全体が SELECTION_MAX_CHARS 以内に収まるよう slice は -1 する
        const truncatedSelection = message.selectionText.length > SELECTION_MAX_CHARS
          ? message.selectionText.slice(0, SELECTION_MAX_CHARS - 1) + '…'
          : message.selectionText;

        let selectionPrompt: string;
        if (message.pageContent.trim()) {
          // ページ本文がある場合は文脈付きプロンプト（F-302）
          selectionPrompt =
            `Page context (for reference, do not summarize this):\n<page>\n${message.pageContent}\n</page>\n\n` +
            `Explain the following selection within that context:\n<selection>\n${truncatedSelection}\n</selection>`;
        } else {
          // ページ本文が空の場合はフォールバック: 選択テキストのみで Explain（F-301）
          selectionPrompt = `Please explain the following text in ${explainPromptLang}:\n\n${truncatedSelection}`;
        }

        const selectionResult = await callClaudeAPI({
          prompt: selectionPrompt,
          system: selectionSystemPrompt,
        });
        return { text: selectionResult.text };
      }

      // ページ全体モード（従来の挙動を維持、F-005, F-204）:
      // 入力が短い場合は短文用プロンプトを使用する
      const isShortContent = message.content.length < SHORT_CONTENT_THRESHOLD;
      const systemPrompt = isShortContent
        ? getShortExplainSystemPrompt(explainLang)
        : getExplainSystemPrompt(explainLang);
      const result = await callClaudeAPI({
        prompt: `Please explain the following web page content in ${explainPromptLang}:\n\n${message.content}`,
        system: systemPrompt,
      });
      return { text: result.text };
    }

    case 'CHAT': {
      // Chat: ページ本文をコンテキストに含めた会話（F-006, F-201）
      // outputLanguage に応じてシステムプロンプトの言語指示を切り替える
      const chatSettings = await loadSettings();
      const chatLang = chatSettings.outputLanguage;
      const chatBase = getChatSystemPromptBase(chatLang);
      // ページ本文をシステムプロンプトに埋め込む
      const systemWithContext = message.pageContent.trim()
        ? `${chatBase}\n\nThe user is reading the following web page content:\n\n${message.pageContent}`
        : chatBase;

      const chatResult = await callClaudeAPI({
        prompt: message.userMessage,
        system: systemWithContext,
        history: message.history,
      });
      return { text: chatResult.text };
    }

    default: {
      // 網羅性チェック: 未知のメッセージ型は型エラーになる
      const _exhaustive: never = message;
      console.error('[background] 未知のメッセージタイプ:', (_exhaustive as BackgroundMessage).type);
      return { error: 'Unknown message type' };
    }
  }
}

/** APIキーを伏字にする（例: sk-ant-api03-****...****-XXXX） */
function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  const prefix = key.substring(0, 10);
  const suffix = key.substring(key.length - 4);
  return `${prefix}****...****-${suffix}`;
}

