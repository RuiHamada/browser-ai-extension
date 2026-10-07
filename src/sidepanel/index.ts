// サイドパネルのエントリポイント（F-009, F-010, F-201, F-401）
// Sprint 7: タブ UI を撤廃し、単一 Chat 画面として初期化する

import { hasApiKey, validateOutputLanguage } from '../lib/storage.js';
import type {
  BroadcastMessage,
  OutputLanguage,
  PendingSidePanelAction,
  SidePanelReadyResponse,
} from '../types/messages.js';
import { appendSelectionExchange, initChat, resetChat, triggerQuickActionById } from './chat.js';

const $e = (id: string): HTMLElement => document.getElementById(id)!;

// 現在のタブURLを取得して表示する（F-009）
async function displayCurrentUrl(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    updateUrlDisplay(tab?.url ?? '');
  } catch (e) {
    console.error('[sidepanel] タブURL取得エラー:', e);
  }
}

function updateUrlDisplay(url: string): void {
  const el = $e('currentUrl');
  if (url) {
    el.textContent = url;
    el.title = url;
  } else {
    el.textContent = 'No page loaded';
  }
}

// APIキー未設定時の誘導バナーを表示/非表示（F-010）
async function checkAndShowApiKeyWarning(): Promise<void> {
  const hasKey = await hasApiKey();
  const warning = $e('apiKeyWarning');
  const mainContent = $e('mainContent');

  if (!hasKey) {
    warning.classList.remove('hidden');
    mainContent.classList.add('hidden');
  } else {
    warning.classList.add('hidden');
    mainContent.classList.remove('hidden');
  }
}

/**
 * background が保持していた pending（Side Panel が開く前に届いた処理）を実行する。
 * - exchange: ポップアップで解説済みの往復を Chat に追加する（API 呼び出しなし）
 * - autorun: クイックアクションを自動実行する（F-503）
 */
function runPendingAction(pending: PendingSidePanelAction): void {
  if (pending.kind === 'exchange') {
    appendSelectionExchange(pending.selectionText, pending.explanation);
  } else {
    void triggerQuickActionById(pending.actionId, pending.selectionText);
  }
}

// 設定ページを開く
$e('btnSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

$e('linkToOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// バックグラウンドからのブロードキャストメッセージを受信
// （F-008: ページ変更検知 / F-503: クイックアクション自動実行 / ポップアップ解説の Chat 投稿）
chrome.runtime.onMessage.addListener((message: BroadcastMessage, _sender, _sendResponse) => {
  if (message.type === 'TAB_CHANGED') {
    updateUrlDisplay(message.url);
    // タブが変わったら設定状態を再チェック
    void checkAndShowApiKeyWarning();
    // URL 変化時に Chat 履歴をリセット（F-008 / F-404）
    resetChat();
  } else if (message.type === 'QUICK_ACTION_AUTORUN') {
    // F-503: フローティングボタンから起動されたクイックアクションを自動実行
    void triggerQuickActionById(message.actionId, message.selectionText);
  } else if (message.type === 'EXPLAIN_RESULT') {
    // ページ上のポップアップで解説済みの往復を Chat に追加する
    appendSelectionExchange(message.selectionText, message.explanation);
  }
  return undefined;
});

// ----------------------------------------------------------------
// 出力言語クイック切替（F-201）
// ----------------------------------------------------------------

/** セレクト要素に現在の言語値を反映する */
function applyOutputLanguageToSelect(lang: OutputLanguage): void {
  const sel = document.getElementById('outputLanguageSelect') as HTMLSelectElement | null;
  if (sel) sel.value = lang;
}

/** ストレージから outputLanguage を読んでセレクトに反映する */
function syncOutputLanguageFromStorage(): void {
  chrome.storage.local.get(['outputLanguage'], (data) => {
    applyOutputLanguageToSelect(validateOutputLanguage(data['outputLanguage']));
  });
}

// セレクト変更時にストレージへ保存（即時反映）
const outputLangSel = document.getElementById('outputLanguageSelect') as HTMLSelectElement | null;
if (outputLangSel) {
  outputLangSel.addEventListener('change', () => {
    const lang = validateOutputLanguage(outputLangSel.value);
    chrome.storage.local.set({ outputLanguage: lang });
  });
}

// Options ページでの変更を Side Panel に同期する（chrome.storage.onChanged）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('outputLanguage' in changes) {
    const newVal = changes['outputLanguage']?.newValue;
    applyOutputLanguageToSelect(validateOutputLanguage(newVal));
  }
});

// 初期化
void displayCurrentUrl();
void checkAndShowApiKeyWarning();
syncOutputLanguageFromStorage();
initChat();

// F-503: Side Panel 初期化完了を background に通知する。
// background は Side Panel が開く前に届いた処理（FLOATING_EXPLAIN_REQUEST / FLOATING_EXPLAIN_RESULT）を
// pending として返し、Side Panel はそれを受けて実行する。
chrome.runtime.sendMessage({ type: 'SIDE_PANEL_READY' })
  .then((resp: unknown) => {
    const response = resp as SidePanelReadyResponse | null;
    if (response?.pending) {
      runPendingAction(response.pending);
    }
  })
  .catch(() => {
    // 起動タイミングによっては background が未起動の場合があるため無視
  });
