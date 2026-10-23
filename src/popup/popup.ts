// ポップアップのスクリプト
// サイドパネルを開くトリガと、APIキー未設定時の誘導を担当する

import { loadSettings, saveSettings } from '../lib/storage.js';

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

  const settings = await loadSettings();
  const hasKey = settings.apiKey.trim().length > 0;
  const toggle = document.getElementById('enabled') as HTMLInputElement | null;
  if (toggle) { toggle.checked = settings.enabled; toggle.disabled = false; }
  const label = document.getElementById('enabledLabel');
  if (label) label.textContent = settings.enabled ? 'On' : 'Off';
  (document.getElementById('openPanel') as HTMLButtonElement).disabled = !settings.enabled;
  if (!settings.enabled) {
    statusEl.textContent = 'Browser AI is Off';
    statusEl.style.color = '#9ca3af';
    warningEl.classList.add('hidden');
    return;
  }
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

// 全タブで共有する有効状態を保存する。
document.getElementById('enabled')?.addEventListener('change', async (event) => {
  const toggle = event.target as HTMLInputElement;
  toggle.disabled = true;
  await saveSettings({ enabled: toggle.checked });
  await checkApiKey();
});
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') void checkApiKey();
});
