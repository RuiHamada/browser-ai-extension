// サイドパネルのエントリポイント（F-009, F-010, F-005, F-007, F-201）

import { hasApiKey, validateOutputLanguage } from '../lib/storage.js';
import type { BroadcastMessage, OutputLanguage } from '../types/messages.js';
import { DEFAULT_SETTINGS } from '../types/messages.js';
import { initExplain, resetExplain } from './explain.js';
import { initChat, resetChat } from './chat.js';

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

// タブ切り替えロジック（F-007）
function initTabs(): void {
  const btnExplain = document.getElementById('tabBtnExplain') as HTMLButtonElement | null;
  const btnChat = document.getElementById('tabBtnChat') as HTMLButtonElement | null;
  const panelExplain = document.getElementById('tabExplain');
  const panelChat = document.getElementById('tabChat');

  // タブ要素が存在しない場合（テスト環境など）はスキップ
  if (!btnExplain || !btnChat || !panelExplain || !panelChat) return;

  // null チェック後の非 null 参照をクロージャに渡す
  const btnExplainNN = btnExplain;
  const btnChatNN = btnChat;
  const panelExplainNN = panelExplain;
  const panelChatNN = panelChat;

  function switchTab(active: 'explain' | 'chat'): void {
    const isExplain = active === 'explain';
    btnExplainNN.classList.toggle('active', isExplain);
    btnExplainNN.setAttribute('aria-selected', String(isExplain));
    btnChatNN.classList.toggle('active', !isExplain);
    btnChatNN.setAttribute('aria-selected', String(!isExplain));
    panelExplainNN.classList.toggle('hidden', !isExplain);
    panelChatNN.classList.toggle('hidden', isExplain);
  }

  btnExplainNN.addEventListener('click', () => switchTab('explain'));
  btnChatNN.addEventListener('click', () => switchTab('chat'));

  // キーボード操作対応（Tab/矢印キーで切り替え可能）
  [btnExplainNN, btnChatNN].forEach((btn, idx, arr) => {
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = arr[(idx + (e.key === 'ArrowRight' ? 1 : -1) + arr.length) % arr.length];
        next.focus();
        next.click();
      }
    });
  });
}

// 設定ページを開く
$e('btnSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

$e('linkToOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// バックグラウンドからのブロードキャストメッセージを受信（F-008: ページ変更検知）
chrome.runtime.onMessage.addListener((message: BroadcastMessage, _sender, _sendResponse) => {
  if (message.type === 'TAB_CHANGED') {
    updateUrlDisplay(message.url);
    // タブが変わったら設定状態を再チェック
    void checkAndShowApiKeyWarning();
    // URL 変化時に Explain・Chat の状態をリセット（F-008）
    resetExplain();
    resetChat();
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
initTabs();
initExplain();
initChat();
