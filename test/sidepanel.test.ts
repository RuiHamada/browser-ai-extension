// sidepanel/index.ts: F-009 (URL表示) / F-010 (APIキー警告)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

function setupDom(): void {
  document.body.innerHTML = `
    <span id="currentUrl">Loading...</span>
    <button id="btnSettings"></button>
    <div id="apiKeyWarning" class="hidden">
      <button id="linkToOptions"></button>
    </div>
    <div id="mainContent" class="hidden"></div>
  `;
}

beforeEach(() => {
  mock = installChromeMock();
  setupDom();
  vi.resetModules();
});

afterEach(() => {
  uninstallChromeMock();
  document.body.innerHTML = '';
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('sidepanel', () => {
  it('初期化時に現在タブのURLが表示される（F-009）', async () => {
    await import('../src/sidepanel/index.js');
    await flush();
    const el = document.getElementById('currentUrl')!;
    expect(el.textContent).toBe('https://example.com');
  });

  it('APIキー未設定時に警告を表示し、メインコンテンツを隠す（F-010）', async () => {
    await import('../src/sidepanel/index.js');
    await flush();
    expect(document.getElementById('apiKeyWarning')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('mainContent')!.classList.contains('hidden')).toBe(true);
  });

  it('APIキー設定済みなら警告は非表示でメインコンテンツを表示（F-010）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-realkey';
    await import('../src/sidepanel/index.js');
    await flush();
    expect(document.getElementById('apiKeyWarning')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('mainContent')!.classList.contains('hidden')).toBe(false);
  });

  it('TAB_CHANGED ブロードキャストで URL 表示が更新される', async () => {
    await import('../src/sidepanel/index.js');
    await flush();
    const listener = mock.runtime.onMessage._listeners[0] as (m: unknown) => void;
    listener({ type: 'TAB_CHANGED', url: 'https://changed.example.com', tabId: 7 });
    await flush();
    expect(document.getElementById('currentUrl')!.textContent).toBe('https://changed.example.com');
  });

  it('設定ボタンで openOptionsPage が呼ばれる', async () => {
    await import('../src/sidepanel/index.js');
    (document.getElementById('btnSettings') as HTMLButtonElement).click();
    expect(mock.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it('警告内の Open Settings リンクで openOptionsPage が呼ばれる（F-010 誘導）', async () => {
    await import('../src/sidepanel/index.js');
    (document.getElementById('linkToOptions') as HTMLButtonElement).click();
    expect(mock.runtime.openOptionsPage).toHaveBeenCalled();
  });
});
