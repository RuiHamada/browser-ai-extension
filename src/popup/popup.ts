// ポップアップのスクリプト
// サイドパネルを開くトリガと、APIキー未設定時の誘導を担当する

import { hasApiKey } from '../lib/storage.js';

// サイドパネルを開く（F-009）
document.getElementById('openPanel')!.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
  window.close();
});

// 設定ページを開く
document.getElementById('openOptions')!.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// 設定ページへのリンク（警告内のリンク）
document.getElementById('linkToOptions')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// APIキー未設定チェック（F-010）
async function checkApiKey(): Promise<void> {
  const statusEl = document.getElementById('status')!;
  const warningEl = document.getElementById('apiKeyWarning')!;

  const hasKey = await hasApiKey();
  if (!hasKey) {
    statusEl.textContent = 'API key not set';
    statusEl.style.color = '#ef4444';
    warningEl.classList.remove('hidden');
  } else {
    statusEl.textContent = 'Ready to use';
    statusEl.style.color = '#22c55e';
    warningEl.classList.add('hidden');
  }
}

checkApiKey();
