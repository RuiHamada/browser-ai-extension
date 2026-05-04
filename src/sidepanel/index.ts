// サイドパネルのエントリポイント（F-009, F-010, F-201, F-401）
// Sprint 7: タブ UI を撤廃し、単一 Chat 画面として初期化する

import { hasApiKey, validateOutputLanguage } from '../lib/storage.js';
import type { BroadcastMessage, OutputLanguage } from '../types/messages.js';
import { initChat, resetChat, triggerQuickActionById } from './chat.js';

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

// 設定ページを開く
$e('btnSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

$e('linkToOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// バックグラウンドからのブロードキャストメッセージを受信（F-008: ページ変更検知 / F-503: クイックアクション自動実行）
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
// background は pending な FLOATING_EXPLAIN_REQUEST があれば返し、
// Side Panel はそれを受けてクイックアクションを自動実行する。
chrome.runtime.sendMessage({ type: 'SIDE_PANEL_READY' })
  .then((resp: unknown) => {
    const response = resp as { pending?: { actionId: string; selectionText: string } | null } | null;
    if (response?.pending) {
      void triggerQuickActionById(response.pending.actionId, response.pending.selectionText);
    }
  })
  .catch(() => {
    // 起動タイミングによっては background が未起動の場合があるため無視
  });
