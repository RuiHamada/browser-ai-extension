// popup.ts: F-009 / F-010 のテスト
// - サイドパネルを開くボタンが chrome.sidePanel.open を呼ぶ
// - APIキー未設定時に警告が表示され、設定画面誘導リンクが機能する

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

function setupDom(): void {
  document.body.innerHTML = `
    <button id="openPanel"></button>
    <button id="openOptions"></button>
    <div id="apiKeyWarning" class="warning hidden">
      <a id="linkToOptions"></a>
    </div>
    <div id="status">Checking...</div>
  `;
}

beforeEach(() => {
  mock = installChromeMock();
  // window.close を no-op に上書き（jsdom が警告を出すため）
  Object.defineProperty(window, 'close', { value: vi.fn(), writable: true, configurable: true });
  setupDom();
  vi.resetModules();
});

afterEach(() => {
  uninstallChromeMock();
  document.body.innerHTML = '';
});

describe('popup', () => {
  it('APIキー未設定時に警告バナーが表示される（F-010）', async () => {
    await import('../src/popup/popup.js');
    // checkApiKey は async。マイクロタスクを 1 回流す
    await Promise.resolve();
    await Promise.resolve();
    const warning = document.getElementById('apiKeyWarning')!;
    expect(warning.classList.contains('hidden')).toBe(false);
    const status = document.getElementById('status')!;
    expect(status.textContent).toBe('API key not set');
  });

  it('APIキー設定済みなら警告は非表示（F-010）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-real';
    await import('../src/popup/popup.js');
    await Promise.resolve();
    await Promise.resolve();
    const warning = document.getElementById('apiKeyWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    const status = document.getElementById('status')!;
    expect(status.textContent).toBe('Ready to use');
  });

  it('Open Side Panel ボタンで chrome.sidePanel.open が呼ばれる（F-009）', async () => {
    await import('../src/popup/popup.js');
    (document.getElementById('openPanel') as HTMLButtonElement).click();
    // chrome.tabs.query は Promise を返すモック。マイクロタスクを流す
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(mock.sidePanel.open).toHaveBeenCalled();
    const arg = mock.sidePanel.open.mock.calls[0]?.[0] as { windowId: number };
    expect(arg.windowId).toBe(10);
  });

  it('Settings ボタンで openOptionsPage が呼ばれる', async () => {
    await import('../src/popup/popup.js');
    (document.getElementById('openOptions') as HTMLButtonElement).click();
    expect(mock.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it('警告内のリンクで openOptionsPage が呼ばれる（F-010 誘導）', async () => {
    await import('../src/popup/popup.js');
    (document.getElementById('linkToOptions') as HTMLAnchorElement).click();
    expect(mock.runtime.openOptionsPage).toHaveBeenCalled();
  });
});
