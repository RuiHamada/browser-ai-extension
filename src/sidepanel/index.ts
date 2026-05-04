// サイドパネルのエントリポイント（F-009, F-010, F-005, F-007）

import { hasApiKey } from '../lib/storage.js';
import type { BroadcastMessage } from '../types/messages.js';
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

// 初期化
void displayCurrentUrl();
void checkAndShowApiKeyWarning();
initTabs();
initExplain();
initChat();
