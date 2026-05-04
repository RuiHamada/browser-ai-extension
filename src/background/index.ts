// バックグラウンドサービスワーカー: メッセージルータ
// MV3制約: service worker は永続しないため、モジュールスコープに状態を置かない

import type { BackgroundMessage } from '../types/messages.js';
import { saveSettings, loadSettings } from '../lib/storage.js';
import { callClaudeAPI, getShortExplainSystemPrompt, getChatSystemPromptBase } from '../lib/claude.js';
import { sanitizeErrorMessage, sanitizeErrorForLog } from '../lib/sanitize.js';

// アイコンクリックでサイドパネルを開く設定
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// 直前に broadcast した URL（同一 URL の重複通知を防ぐ）
// MV3 service worker は永続しないが、同一起動セッション内での重複防止には有効
let lastBroadcastUrl = '';

/**
 * F-503: タブ ID ごとに「Side Panel が開いたら即座に実行すべきクイックアクション」を保持する。
 * Side Panel の初期化が終わる前にメッセージが来た場合の取りこぼし防止用バッファ。
 * TAB_CHANGED 発火時にそのタブの pending を破棄する。
 */
const pendingQuickAction: Map<number, { actionId: string; selectionText: string }> = new Map();

/** TAB_CHANGED を broadcast する。同一 URL の連続通知はスキップする */
function broadcastTabChanged(url: string, tabId: number): void {
  if (url === lastBroadcastUrl) return;
  lastBroadcastUrl = url;
  // F-503: タブが変わったら pending なクイックアクションを破棄する（URL 変化でのリセット）
  pendingQuickAction.delete(tabId);
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

    case 'CHAT': {
      // Chat: ページ本文をコンテキストに含めた会話（F-006, F-201, F-402, F-403）
      // outputLanguage に応じてシステムプロンプトの言語指示を切り替える
      const chatSettings = await loadSettings();
      const chatLang = chatSettings.outputLanguage;

      // F-204: useShortPrompt フラグが立っている場合は短文 system プロンプトを使う
      const systemPrompt = message.useShortPrompt
        ? getShortExplainSystemPrompt(chatLang)
        : getChatSystemPromptBase(chatLang);

      // pageContent は後方互換用。Sprint 7 以降は userMessage にコンテキストが埋め込まれるため
      // pageContent が空でないときのみシステムプロンプトに追加する（既存テストとの互換性維持）
      const systemWithContext = message.pageContent.trim()
        ? `${systemPrompt}\n\nThe user is reading the following web page content:\n\n${message.pageContent}`
        : systemPrompt;

      const chatResult = await callClaudeAPI({
        prompt: message.userMessage,
        system: systemWithContext,
        history: message.history,
      });
      return { text: chatResult.text };
    }

    case 'FLOATING_EXPLAIN_REQUEST': {
      // F-503: フローティングボタン → Side Panel の Explain 自動起動
      const tabId = sender.tab?.id;
      if (!tabId) return { error: 'No tab ID in sender' };

      // Side Panel を開く（既に開いていても再オープンは sidePanel API が適切に処理する）
      await chrome.sidePanel.open({ tabId });

      // 戦略 A: broadcast が成功した（Side Panel が既に開いていた）場合は pending を立てない。
      // broadcast が失敗した場合のみ pending に保存して SIDE_PANEL_READY 時に flush する。
      // これにより「broadcast + pending flush の二重発火」を構造的に排除する。
      let broadcastSucceeded = false;
      try {
        await chrome.runtime.sendMessage({
          type: 'QUICK_ACTION_AUTORUN',
          actionId: 'qaExplainSelection',
          selectionText: message.selectionText,
        });
        broadcastSucceeded = true;
      } catch {
        // Side Panel がまだ開いていない場合は無視（pending で対応する）
      }

      if (!broadcastSucceeded) {
        // Side Panel がまだ開いていない → SIDE_PANEL_READY 受信時に flush する
        pendingQuickAction.set(tabId, {
          actionId: 'qaExplainSelection',
          selectionText: message.selectionText,
        });
      }

      return { ok: true };
    }

    case 'SIDE_PANEL_READY': {
      // F-503: Side Panel 初期化完了通知 → pending state があれば flush する
      const senderTabId = sender.tab?.id;
      // Side Panel は chrome.tabs.query で自分のタブを特定するため sender.tab は undefined になりうる。
      // その場合は現在アクティブなタブを取得して pending を探す。
      let resolvedTabId: number | undefined = senderTabId;
      if (!resolvedTabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        resolvedTabId = activeTab?.id;
      }

      if (resolvedTabId !== undefined) {
        const pending = pendingQuickAction.get(resolvedTabId);
        if (pending) {
          pendingQuickAction.delete(resolvedTabId);
          return { pending };
        }
      }
      return { pending: null };
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
