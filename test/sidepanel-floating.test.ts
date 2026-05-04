// F-503: Side Panel の初期化時 SIDE_PANEL_READY 送信と QUICK_ACTION_AUTORUN 自動実行のテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

/** chat.ts / sidepanel/index.ts が使う最小限の DOM を設定する */
function setupDom(): void {
  document.body.innerHTML = `
    <span id="currentUrl">Loading...</span>
    <button id="btnSettings"></button>
    <div id="apiKeyWarning" class="hidden">
      <button id="linkToOptions"></button>
    </div>
    <div id="mainContent" class="hidden"></div>
    <select id="outputLanguageSelect"><option value="en">EN</option><option value="ja">JA</option></select>
    <div id="chatMessages"></div>
    <textarea id="chatInput"></textarea>
    <button id="btnChatSend"></button>
    <button id="btnChatClear"></button>
    <div id="shortContentWarning" class="hidden">
      <span id="shortContentWarningText"></span>
      <button id="btnRunAnyway"></button>
      <button id="btnCancelShort"></button>
    </div>
    <button id="qaExplainPage">Explain page</button>
    <button id="qaExplainSelection">Explain selection</button>
    <button id="qaSummary">Summary</button>
    <button id="qaDetailed">Detailed</button>
    <button id="qaBeginner">Beginner-friendly</button>
    <button id="qaExpert">Expert-level</button>
  `;
}

/** Promise キューを複数回フラッシュするヘルパー */
async function flush(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
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

describe('sidepanel F-503: SIDE_PANEL_READY 送信', () => {
  it('初期化時に SIDE_PANEL_READY を background に送信する', async () => {
    // pending なし（通常起動）の応答
    mock.runtime.sendMessage = vi.fn((msg: unknown) => {
      const m = msg as { type: string };
      if (m.type === 'SIDE_PANEL_READY') {
        return Promise.resolve({ pending: null });
      }
      return Promise.resolve({ ok: true });
    });

    await import('../src/sidepanel/index.js');
    await flush();

    const sidePanelReadyCalls = (mock.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'SIDE_PANEL_READY',
    );
    expect(sidePanelReadyCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('pending あり時に triggerQuickActionById が呼ばれ sendMessage(CHAT) が発火する', async () => {
    // APIキーをセット（sendMessage CHAT が通るように）
    mock.storage.local._data['apiKey'] = 'sk-ant-test-key';

    // タブのページコンテンツを返すスタブ
    mock.tabs.sendMessage = vi.fn(() =>
      Promise.resolve({ content: 'page content for test', truncated: false, originalLength: 22 }),
    );

    const chatMessages: unknown[] = [];

    mock.runtime.sendMessage = vi.fn((msg: unknown) => {
      const m = msg as { type: string };
      if (m.type === 'SIDE_PANEL_READY') {
        return Promise.resolve({
          pending: {
            actionId: 'qaExplainSelection',
            selectionText: 'floating selected text',
          },
        });
      }
      if (m.type === 'CHAT') {
        chatMessages.push(msg);
        return Promise.resolve({ text: 'AI explanation here.' });
      }
      return Promise.resolve({ ok: true });
    });

    await import('../src/sidepanel/index.js');
    await flush(20);

    // CHAT メッセージが送られた（= triggerQuickActionById が呼ばれた）
    expect(chatMessages.length).toBeGreaterThan(0);
    const chatMsg = chatMessages[0] as { type: string; userMessage: string };
    expect(chatMsg.type).toBe('CHAT');
    // 選択テキストが userMessage に含まれる
    expect(chatMsg.userMessage).toContain('floating selected text');
  });
});

describe('sidepanel F-503: QUICK_ACTION_AUTORUN ブロードキャスト受信', () => {
  it('QUICK_ACTION_AUTORUN を受け取ると triggerQuickActionById が動作する', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-test-key';

    mock.tabs.sendMessage = vi.fn(() =>
      Promise.resolve({ content: 'page content', truncated: false, originalLength: 12 }),
    );

    const chatMessages: unknown[] = [];
    mock.runtime.sendMessage = vi.fn((msg: unknown) => {
      const m = msg as { type: string };
      if (m.type === 'SIDE_PANEL_READY') {
        return Promise.resolve({ pending: null });
      }
      if (m.type === 'CHAT') {
        chatMessages.push(msg);
        return Promise.resolve({ text: 'Explained!' });
      }
      return Promise.resolve({ ok: true });
    });

    await import('../src/sidepanel/index.js');
    await flush();

    // onMessage リスナーを取得して QUICK_ACTION_AUTORUN を発火
    const listener = mock.runtime.onMessage._listeners[0] as (m: unknown) => void;
    listener({
      type: 'QUICK_ACTION_AUTORUN',
      actionId: 'qaExplainSelection',
      selectionText: 'broadcast selection text',
    });

    await flush(20);

    expect(chatMessages.length).toBeGreaterThan(0);
    const chatMsg = chatMessages[0] as { userMessage: string };
    expect(chatMsg.userMessage).toContain('broadcast selection text');
  });

  it('TAB_CHANGED を受け取っても QUICK_ACTION_AUTORUN 経路は呼ばれない', async () => {
    mock.runtime.sendMessage = vi.fn((msg: unknown) => {
      const m = msg as { type: string };
      if (m.type === 'SIDE_PANEL_READY') {
        return Promise.resolve({ pending: null });
      }
      return Promise.resolve({ ok: true });
    });

    await import('../src/sidepanel/index.js');
    await flush();

    const chatMessages: unknown[] = [];
    // CHAT 発火を監視
    const origSendMessage = mock.runtime.sendMessage;
    mock.runtime.sendMessage = vi.fn((msg: unknown) => {
      if ((msg as { type?: string }).type === 'CHAT') chatMessages.push(msg);
      return Promise.resolve({ ok: true });
    });

    const listener = mock.runtime.onMessage._listeners[0] as (m: unknown) => void;
    listener({
      type: 'TAB_CHANGED',
      url: 'https://example.com/new',
      tabId: 1,
    });

    await flush(10);

    // TAB_CHANGED では CHAT は送信されない
    expect(chatMessages.length).toBe(0);

    // origSendMessage は使用済みなので参照のみ（未使用警告防止）
    void origSendMessage;
  });
});
