// Sprint 7: sidepanel/chat.ts のクイックアクション UI 動作テスト（F-402 / F-403 / F-405）
// Sprint 7 で Explain タブを廃止し、クイックアクション経由で Chat 履歴に統合。
// 旧 explain.ts のテストをクイックアクション（whole-page 種別）のテストに置き換える。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

/** Chat 単一画面に必要な DOM 要素をセットアップ（F-401） */
function setupDom(): void {
  document.body.innerHTML = `
    <div id="chatMessages"></div>
    <div id="shortContentWarning" class="hidden" role="alert">
      <p id="shortContentWarningText"></p>
      <div>
        <button id="btnRunAnyway">Run anyway</button>
        <button id="btnCancelShort">Cancel</button>
      </div>
    </div>
    <button id="qaExplainPage">Explain page</button>
    <button id="qaExplainSelection">Explain selection</button>
    <button id="qaSummary">Summary</button>
    <button id="qaDetailed">Detailed</button>
    <button id="qaBeginner">Beginner-friendly</button>
    <button id="qaExpert">Expert-level</button>
    <textarea id="chatInput"></textarea>
    <button id="btnChatSend">Send</button>
    <button id="btnChatClear">Clear</button>
  `;
}

/** Promise を複数回フラッシュするヘルパー */
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

/** chrome.tabs.sendMessage のモックを設定する（ページ本文レスポンス） */
function setupTabsSendMessage(response: unknown): void {
  (mock as unknown as {
    tabs: { sendMessage: ReturnType<typeof vi.fn> };
  }).tabs.sendMessage = vi.fn(() => Promise.resolve(response));
  (globalThis as unknown as { chrome: typeof mock }).chrome = mock;
}

// ----------------------------------------------------------------
// initChat の初期化（F-401）
// ----------------------------------------------------------------
describe('initChat 初期化（F-401）', () => {
  it('initChat を呼んでもエラーにならない', async () => {
    const { initChat } = await import('../src/sidepanel/chat.js');
    expect(() => initChat()).not.toThrow();
  });

  it('initChat 後に Welcome メッセージが chatMessages に表示される（F-401）', async () => {
    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).toContain('Welcome');
  });
});

// ----------------------------------------------------------------
// F-402: クイックアクション 6 個の描画・発火
// ----------------------------------------------------------------
describe('F-402: クイックアクション 6 個が描画されている', () => {
  it('Explain page ボタンが存在する', () => {
    expect(document.getElementById('qaExplainPage')).not.toBeNull();
  });
  it('Explain selection ボタンが存在する', () => {
    expect(document.getElementById('qaExplainSelection')).not.toBeNull();
  });
  it('Summary ボタンが存在する', () => {
    expect(document.getElementById('qaSummary')).not.toBeNull();
  });
  it('Detailed ボタンが存在する', () => {
    expect(document.getElementById('qaDetailed')).not.toBeNull();
  });
  it('Beginner-friendly ボタンが存在する', () => {
    expect(document.getElementById('qaBeginner')).not.toBeNull();
  });
  it('Expert-level ボタンが存在する', () => {
    expect(document.getElementById('qaExpert')).not.toBeNull();
  });
});

// ----------------------------------------------------------------
// F-402 / F-403: whole-page クイックアクションの発火（Explain page）
// ----------------------------------------------------------------
describe('F-402/F-403: "Explain page" クイックアクション（whole-page）', () => {
  it('ページ全体を説明するプリセットプロンプトが user バブルに表示される', async () => {
    const longContent = 'Article text here. This is a long enough content for normal flow.';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: longContent,
      truncated: false,
      originalLength: longContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ text: 'This is an English explanation.' })
    );

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    const messages = document.getElementById('chatMessages')!;
    // user バブルに F-402 のプリセット本文が含まれる
    expect(messages.textContent).toContain('Explain this page in clear English');
    // assistant バブルに応答が含まれる
    expect(messages.textContent).toContain('This is an English explanation.');
  });

  it('CHAT メッセージの userMessage に pageContent が同梱される（F-403）', async () => {
    const longContent = 'This is the full article content for testing purposes.';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: longContent,
      truncated: false,
      originalLength: longContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ text: 'Explanation.' })
    );

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    // API に送信した CHAT メッセージを検証
    const chatCall = mock.runtime.sendMessage.mock.calls[0];
    const chatMsg = chatCall[0] as { type: string; userMessage: string };
    expect(chatMsg.type).toBe('CHAT');
    // userMessage にページ本文が含まれる（F-403: 最新メッセージにのみコンテキスト付与）
    expect(chatMsg.userMessage).toContain(longContent);
    expect(chatMsg.userMessage).toContain('Explain this page in clear English');
  });

  it('ページコンテンツが空の場合は API が呼ばれてもエラーにならない（フォールバック）', async () => {
    setupTabsSendMessage({ url: 'https://example.com', content: '', truncated: false, originalLength: 0 });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'explanation' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    // API は呼ばれる（エラーにならない）
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('APIエラー時にエラーバブルが chatMessages に表示される（F-011）', async () => {
    const longContent = 'Some content that is long enough to bypass the short content warning.';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: longContent,
      truncated: false,
      originalLength: longContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ error: 'Authentication error (401): Your API key is invalid.' })
    );

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).toContain('Authentication error');
  });

  it('エラーメッセージにAPIキーが含まれない（F-011）', async () => {
    const longContent = 'Some content that is long enough to bypass the short content warning threshold.';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: longContent,
      truncated: false,
      originalLength: longContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.reject(new Error('Error: sk-ant-secret-key123 is invalid'))
    );

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).not.toContain('sk-ant-secret-key123');
  });

  it('応答中はクイックアクションボタンが disabled になる（F-402）', async () => {
    let resolveExplain!: (v: unknown) => void;
    const longContent = 'Content that is long enough to bypass the short content warning threshold.';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: longContent,
      truncated: false,
      originalLength: longContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() =>
      new Promise((resolve) => { resolveExplain = resolve; })
    );

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    const btnExplainPage = document.getElementById('qaExplainPage') as HTMLButtonElement;
    const btnSend = document.getElementById('btnChatSend') as HTMLButtonElement;
    btnExplainPage.click();
    await flush(5);

    expect(btnExplainPage.disabled).toBe(true);
    expect(btnSend.disabled).toBe(true);

    // 完了させる
    resolveExplain({ text: 'done' });
    await flush(10);
    expect(btnExplainPage.disabled).toBe(false);
  });
});

// ----------------------------------------------------------------
// F-402 / F-403: whole-page クイックアクション（Summary / Detailed / Beginner / Expert）
// ----------------------------------------------------------------
describe('F-402: whole-page クイックアクション（Summary / Detailed / Beginner / Expert）', () => {
  const testCases = [
    { id: 'qaSummary', label: 'Summary', prompt: 'Summarize this page in 5 concise bullet points.' },
    { id: 'qaDetailed', label: 'Detailed', prompt: 'Provide a detailed explanation of this page' },
    { id: 'qaBeginner', label: 'Beginner-friendly', prompt: 'Explain this page as if to a beginner' },
    { id: 'qaExpert', label: 'Expert-level', prompt: 'Explain this page at an expert level' },
  ];

  for (const tc of testCases) {
    it(`${tc.label}: プリセットプロンプトが user バブルに表示され API にページ本文が同梱される`, async () => {
      // 40 文字以上で短文警告を回避する
      const pageContent = 'Page content for ' + tc.label + ' test - long enough to skip short content warning.';
      setupTabsSendMessage({
        url: 'https://example.com',
        content: pageContent,
        truncated: false,
        originalLength: pageContent.length,
      });
      mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'AI response.' }));

      const { initChat } = await import('../src/sidepanel/chat.js');
      initChat();

      (document.getElementById(tc.id) as HTMLButtonElement).click();
      await flush(20);

      const messages = document.getElementById('chatMessages')!;
      expect(messages.textContent).toContain(tc.prompt.slice(0, 30));

      const chatCall = mock.runtime.sendMessage.mock.calls[0];
      const chatMsg = chatCall[0] as { type: string; userMessage: string };
      expect(chatMsg.type).toBe('CHAT');
      expect(chatMsg.userMessage).toContain(pageContent);
    });
  }
});

// ----------------------------------------------------------------
// F-405: タブ UI が存在しない
// ----------------------------------------------------------------
describe('F-405: タブ UI が存在しない', () => {
  it('tabBtnExplain 要素が DOM に存在しない', () => {
    expect(document.getElementById('tabBtnExplain')).toBeNull();
  });

  it('tabBtnChat 要素が DOM に存在しない', () => {
    expect(document.getElementById('tabBtnChat')).toBeNull();
  });
});

// ----------------------------------------------------------------
// F-401: resetChat でWelcome メッセージが再表示される
// ----------------------------------------------------------------
describe('F-401: resetChat 後に Welcome メッセージが再表示される', () => {
  it('Clear ボタン押下後に Welcome メッセージが表示される', async () => {
    setupTabsSendMessage({ content: 'Page content.', truncated: false, originalLength: 13 });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'AI answer.' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    // 会話をしてから Clear
    (document.getElementById('chatInput') as HTMLTextAreaElement).value = 'Hello';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(20);

    (document.getElementById('btnChatClear') as HTMLButtonElement).click();

    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).toContain('Welcome');
    // user/assistant のバブルは残らない
    expect(messages.textContent).not.toContain('Hello');
    expect(messages.textContent).not.toContain('AI answer.');
  });
});
