// sidepanel/chat.ts: Chat タブの UI 動作テスト（F-006, F-007, F-008）
// chrome.tabs.sendMessage / chrome.runtime.sendMessage / fetch はすべてモック

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

/** Chat 画面に必要な DOM 要素をセットアップ（F-401: 単一 Chat 画面） */
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
    <textarea id="chatInput"></textarea>
    <button id="btnChatSend">Send</button>
    <button id="btnChatClear">Clear</button>
  `;
}

/** sidepanel/index.ts 経由のテスト用フル DOM（単一 Chat 画面, F-401） */
function setupFullDom(): void {
  document.body.innerHTML = `
    <span id="currentUrl">Loading...</span>
    <button id="btnSettings"></button>
    <div id="apiKeyWarning" class="hidden">
      <button id="linkToOptions"></button>
    </div>
    <select id="outputLanguageSelect">
      <option value="en">EN</option>
      <option value="ja">JA</option>
    </select>
    <div id="mainContent" class="hidden">
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
    </div>
  `;
}

/** Promise を複数回フラッシュするヘルパー */
async function flush(n = 15): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/** chrome.tabs.sendMessage に GET_PAGE_CONTENT のレスポンスを設定するヘルパー */
function setupTabsSendMessage(response: unknown): void {
  (mock as unknown as { tabs: { sendMessage: ReturnType<typeof vi.fn> } })
    .tabs.sendMessage = vi.fn(() => Promise.resolve(response));
  (globalThis as unknown as { chrome: typeof mock }).chrome = mock;
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

// ----------------------------------------------------------------
// initChat / 基本動作
// ----------------------------------------------------------------
describe('initChat 初期化', () => {
  it('initChat を呼んでもエラーにならない（F-006）', async () => {
    const { initChat } = await import('../src/sidepanel/chat.js');
    expect(() => initChat()).not.toThrow();
  });

  it('DOM 要素なしで initChat を呼んでもエラーにならない', async () => {
    document.body.innerHTML = '';
    const { initChat } = await import('../src/sidepanel/chat.js');
    expect(() => initChat()).not.toThrow();
  });
});

// ----------------------------------------------------------------
// 1 ターン目の送受信
// ----------------------------------------------------------------
describe('Chat 1 ターン目（F-006）', () => {
  it('ユーザーメッセージを送信すると AI の返答が表示される', async () => {
    setupTabsSendMessage({ content: 'Page text here.', truncated: false, originalLength: 15 });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ text: 'AI response to first message.' })
    );

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('chatInput') as HTMLTextAreaElement).value = 'What is this page about?';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(20);

    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).toContain('What is this page about?');
    expect(messages.textContent).toContain('AI response to first message.');
  });

  it('ページ本文が CHAT メッセージの userMessage に埋め込まれる（F-403: 最新メッセージにのみコンテキスト付与）', async () => {
    setupTabsSendMessage({ content: 'This is the article content.', truncated: false, originalLength: 28 });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ text: 'Answer.' })
    );

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('chatInput') as HTMLTextAreaElement).value = 'Summarize';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(20);

    // runtime.sendMessage に渡した CHAT メッセージを検証
    // Sprint 7 以降: pageContent は userMessage に埋め込まれる（F-403）
    const chatCall = mock.runtime.sendMessage.mock.calls[0];
    const chatMsg = chatCall[0] as { type: string; userMessage: string };
    expect(chatMsg.type).toBe('CHAT');
    expect(chatMsg.userMessage).toContain('Summarize');
    expect(chatMsg.userMessage).toContain('This is the article content.');
  });
});

// ----------------------------------------------------------------
// 2 ターン以上の対話（F-006: 合格基準）
// ----------------------------------------------------------------
describe('Chat 2 ターン以上の対話（F-006）', () => {
  it('2 ターン目の API リクエストに 1 ターン目の履歴が含まれる', async () => {
    setupTabsSendMessage({ content: 'Page content.', truncated: false, originalLength: 12 });
    mock.runtime.sendMessage = vi.fn()
      .mockResolvedValueOnce({ text: 'First AI answer.' })
      .mockResolvedValueOnce({ text: 'Second AI answer.' });

    const { initChat, resetChat } = await import('../src/sidepanel/chat.js');
    // モジュール状態を明示的にリセットして前テストの履歴が残らないようにする
    resetChat();
    initChat();

    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('btnChatSend') as HTMLButtonElement;

    // 1 ターン目
    input.value = 'Turn 1 question';
    sendBtn.click();
    await flush(20);

    // 2 ターン目
    input.value = 'Turn 2 question';
    sendBtn.click();
    await flush(20);

    // 2 回目の sendMessage 呼び出しを確認
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(2);
    const secondCallArgs = mock.runtime.sendMessage.mock.calls[1];
    const secondMsg = secondCallArgs[0] as {
      type: string;
      userMessage: string;
      history: Array<{ role: string; content: string }>;
    };

    expect(secondMsg.type).toBe('CHAT');
    // userMessage はページ本文が埋め込まれているため、先頭部分が元のテキストと一致する（F-403）
    expect(secondMsg.userMessage).toContain('Turn 2 question');
    // history に 1 ターン目の user/assistant が含まれる（履歴はプロンプト本文のみ）
    expect(secondMsg.history).toHaveLength(2);
    expect(secondMsg.history[0]).toEqual({ role: 'user', content: 'Turn 1 question' });
    expect(secondMsg.history[1]).toEqual({ role: 'assistant', content: 'First AI answer.' });
  });

  it('2 ターン分の発話が画面に残る（F-006: 過去発話が表示される）', async () => {
    setupTabsSendMessage({ content: 'Page content.', truncated: false, originalLength: 12 });
    mock.runtime.sendMessage = vi.fn()
      .mockResolvedValueOnce({ text: 'First AI answer.' })
      .mockResolvedValueOnce({ text: 'Second AI answer.' });

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('btnChatSend') as HTMLButtonElement;

    input.value = 'Turn 1';
    sendBtn.click();
    await flush(20);

    input.value = 'Turn 2';
    sendBtn.click();
    await flush(20);

    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).toContain('Turn 1');
    expect(messages.textContent).toContain('First AI answer.');
    expect(messages.textContent).toContain('Turn 2');
    expect(messages.textContent).toContain('Second AI answer.');
  });
});

// ----------------------------------------------------------------
// 明示クリアで履歴が破棄される（F-006）
// ----------------------------------------------------------------
describe('Chat 履歴クリア（F-006）', () => {
  it('Clear ボタンで会話履歴が破棄される', async () => {
    setupTabsSendMessage({ content: 'Page.', truncated: false, originalLength: 5 });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'AI answer.' }));

    const { initChat, getChatHistory } = await import('../src/sidepanel/chat.js');
    initChat();

    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    input.value = 'Hello';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(20);

    // 履歴が存在することを確認
    expect(getChatHistory().length).toBeGreaterThan(0);

    // クリアボタンを押す
    (document.getElementById('btnChatClear') as HTMLButtonElement).click();

    // 履歴がゼロになることを確認
    expect(getChatHistory().length).toBe(0);

    // 画面は Welcome メッセージのみが残る（F-401: リセット後に Welcome 再表示）
    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).toContain('Welcome');
  });

  it('resetChat() を直接呼ぶと履歴がクリアされる（F-006, F-008）', async () => {
    setupTabsSendMessage({ content: 'Page.', truncated: false, originalLength: 5 });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'AI answer.' }));

    const { initChat, resetChat, getChatHistory } = await import('../src/sidepanel/chat.js');
    initChat();

    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    input.value = 'Message';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(20);

    expect(getChatHistory().length).toBeGreaterThan(0);

    resetChat();

    expect(getChatHistory().length).toBe(0);
    // Welcome メッセージが再表示される（F-401）
    expect(document.getElementById('chatMessages')!.textContent).toContain('Welcome');
  });
});

// ----------------------------------------------------------------
// 二重送信防止（F-006）
// ----------------------------------------------------------------
describe('二重送信防止（F-006）', () => {
  it('送信中は送信ボタンが disabled になる', async () => {
    setupTabsSendMessage({ content: 'Page.', truncated: false, originalLength: 5 });

    let resolveChat!: (v: unknown) => void;
    mock.runtime.sendMessage = vi.fn(() =>
      new Promise((resolve) => { resolveChat = resolve; })
    );

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('btnChatSend') as HTMLButtonElement;

    input.value = 'Question';
    sendBtn.click();
    await flush(5);

    // 送信中は disabled
    expect(sendBtn.disabled).toBe(true);
    expect(input.disabled).toBe(true);

    // 完了させる
    resolveChat({ text: 'Done' });
    await flush(15);

    // 完了後は enabled に戻る
    expect(sendBtn.disabled).toBe(false);
    expect(input.disabled).toBe(false);
  });

  it('空文字のメッセージは送信されない', async () => {
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'answer' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('chatInput') as HTMLTextAreaElement).value = '   ';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(10);

    // sendMessage は呼ばれない
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------
// エラーハンドリング（F-011）
// ----------------------------------------------------------------
describe('Chat エラーハンドリング（F-011）', () => {
  it('API エラー時にエラーメッセージが chatMessages に表示される', async () => {
    setupTabsSendMessage({ content: 'Page.', truncated: false, originalLength: 5 });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ error: 'Authentication error (401): Invalid API key.' })
    );

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('chatInput') as HTMLTextAreaElement).value = 'Question';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(20);

    // エラーは chatMessages 内の error バブルとして表示される（F-401/F-011）
    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).toContain('Authentication error');
  });

  it('エラーメッセージに API キーが含まれない（F-011）', async () => {
    setupTabsSendMessage({ content: 'Page.', truncated: false, originalLength: 5 });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.reject(new Error('Error: sk-ant-leaktest-123 is invalid'))
    );

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('chatInput') as HTMLTextAreaElement).value = 'Question';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(20);

    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).not.toContain('sk-ant-leaktest-123');
  });

  it('console.error に API キーが出力されない（F-011: ログ経路での漏洩防止）', async () => {
    setupTabsSendMessage({ content: 'Page.', truncated: false, originalLength: 5 });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.reject(new Error('Fatal: sk-ant-api03-CHATLOGKEY exposed'))
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { initChat } = await import('../src/sidepanel/chat.js');
      initChat();

      (document.getElementById('chatInput') as HTMLTextAreaElement).value = 'Question';
      (document.getElementById('btnChatSend') as HTMLButtonElement).click();
      await flush(20);

      for (const call of errorSpy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain('sk-ant-api03-CHATLOGKEY');
        }
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('API エラー時に履歴に追加されない', async () => {
    setupTabsSendMessage({ content: 'Page.', truncated: false, originalLength: 5 });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ error: 'Server error (500)' })
    );

    const { initChat, getChatHistory } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('chatInput') as HTMLTextAreaElement).value = 'Question';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(20);

    // エラー時は履歴にメッセージが追加されない
    expect(getChatHistory().length).toBe(0);
  });
});

// ----------------------------------------------------------------
// URL 変化時の状態リセット（F-008）
// ----------------------------------------------------------------
describe('URL 変化時の状態リセット（F-008）', () => {
  it('resetChat() 後は getChatHistory() が空になる（タブ閉じ/URL変化相当）', async () => {
    setupTabsSendMessage({ content: 'Page.', truncated: false, originalLength: 5 });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Answer.' }));

    const { initChat, resetChat, getChatHistory } = await import('../src/sidepanel/chat.js');
    initChat();

    // 会話を行う
    (document.getElementById('chatInput') as HTMLTextAreaElement).value = 'Hello';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(20);

    expect(getChatHistory().length).toBe(2); // user + assistant

    // URL 変化 → resetChat
    resetChat();

    expect(getChatHistory().length).toBe(0);
  });

  it('TAB_CHANGED 時に sidepanel/index から resetChat が呼ばれ、画面がクリアされる（F-008）', async () => {
    setupFullDom();
    mock.storage.local._data['apiKey'] = 'sk-ant-realkey';

    setupTabsSendMessage({ content: 'Page.', truncated: false, originalLength: 5 });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Answer.' }));

    const { getChatHistory } = await import('../src/sidepanel/chat.js');
    await import('../src/sidepanel/index.js');
    await flush(10);

    // 会話をひとつ行う（直接 chat の initChat を使う）
    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('chatInput') as HTMLTextAreaElement).value = 'Hello TAB';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(20);

    expect(getChatHistory().length).toBe(2);

    // TAB_CHANGED を送信する
    const listener = mock.runtime.onMessage._listeners[0] as (m: unknown) => void;
    listener({ type: 'TAB_CHANGED', url: 'https://new-page.example.com', tabId: 99 });
    await flush(10);

    // URL 表示が更新される
    expect(document.getElementById('currentUrl')!.textContent).toBe('https://new-page.example.com');

    // Chat 履歴がリセットされる
    expect(getChatHistory().length).toBe(0);
  });
});

// ----------------------------------------------------------------
// Enter キー送信（F-006 Should 要件）
// ----------------------------------------------------------------
describe('Enter キー送信（F-006）', () => {
  it('Shift+Enter で送信される', async () => {
    setupTabsSendMessage({ content: 'Page.', truncated: false, originalLength: 5 });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Answer.' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    input.value = 'Shift+Enter test';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    await flush(20);

    expect(mock.runtime.sendMessage).toHaveBeenCalled();
    const callArgs = mock.runtime.sendMessage.mock.calls[0];
    const msg = callArgs[0] as { type: string; userMessage: string };
    expect(msg.type).toBe('CHAT');
    // userMessage にはページ本文が埋め込まれているため、元のテキストが含まれることを確認（F-403）
    expect(msg.userMessage).toContain('Shift+Enter test');
  });

  it('Enter 単独では送信されない（改行扱い）', async () => {
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Answer.' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    input.value = 'Line 1';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true }));
    await flush(10);

    // Enter 単独では sendMessage は呼ばれない
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------
// ページ本文のキャッシュ（同一セッション内でのキャッシュ再利用）
// ----------------------------------------------------------------
describe('ページ本文キャッシュ（F-006）', () => {
  it('2 ターン目は tabs.sendMessage を再度呼ばない（キャッシュ再利用）', async () => {
    const tabsSendMessageMock = vi.fn(() =>
      Promise.resolve({ content: 'Cached page content.', truncated: false, originalLength: 20 })
    );
    (mock as unknown as { tabs: { sendMessage: ReturnType<typeof vi.fn> } })
      .tabs.sendMessage = tabsSendMessageMock;
    (globalThis as unknown as { chrome: typeof mock }).chrome = mock;

    mock.runtime.sendMessage = vi.fn()
      .mockResolvedValueOnce({ text: 'First answer.' })
      .mockResolvedValueOnce({ text: 'Second answer.' });

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('btnChatSend') as HTMLButtonElement;

    input.value = 'First question';
    sendBtn.click();
    await flush(20);

    input.value = 'Second question';
    sendBtn.click();
    await flush(20);

    // tabs.sendMessage（GET_PAGE_CONTENT）は 1 回のみ呼ばれる
    expect(tabsSendMessageMock).toHaveBeenCalledTimes(1);
  });
});

// ----------------------------------------------------------------
// fetchPageContent エラーパス（深層防御: ログ非 sanitize 修正検証）
// ----------------------------------------------------------------
describe('fetchPageContent エラーパスのログ sanitize（F-011）', () => {
  it('ページ本文取得失敗時の console.error に API キーが含まれない', async () => {
    // tabs.sendMessage が API キーを含むエラーを投げるケースをシミュレート
    (mock as unknown as { tabs: { sendMessage: ReturnType<typeof vi.fn> } })
      .tabs.sendMessage = vi.fn(() =>
        Promise.reject(new Error('Content script error: sk-ant-api03-FETCHERRKEY leaked'))
      );
    (globalThis as unknown as { chrome: typeof mock }).chrome = mock;

    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Answer.' }));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { initChat } = await import('../src/sidepanel/chat.js');
      initChat();

      // メッセージを送信してページ本文取得を発火させる
      (document.getElementById('chatInput') as HTMLTextAreaElement).value = 'Question';
      (document.getElementById('btnChatSend') as HTMLButtonElement).click();
      await flush(20);

      // console.error の全引数に API キーが含まれないことを確認
      for (const call of errorSpy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain('sk-ant-api03-FETCHERRKEY');
        }
      }
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// ----------------------------------------------------------------
// background CHAT ハンドラの動作確認
// ----------------------------------------------------------------
describe('background CHAT ハンドラ（F-006）', () => {
  it('CHAT メッセージを受けると callClaudeAPI が呼ばれてテキストを返す', async () => {
    // background を再ロードしてリスナーを登録
    vi.resetModules();
    mock = installChromeMock();
    mock.storage.local._data['apiKey'] = 'sk-ant-test-key';
    mock.storage.local._data['aiModel'] = 'claude-haiku-4-5';

    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Chat response from AI.' }],
        }),
      })
    );
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

    await import('../src/background/index.js');

    const listener = mock.runtime.onMessage._listeners[0] as
      (m: unknown, s: unknown, sr: (r: unknown) => void) => boolean;

    const result = await new Promise<unknown>((resolve) => {
      listener(
        {
          type: 'CHAT',
          userMessage: 'What is this page about?',
          history: [],
          pageContent: 'This is a news article about technology.',
        },
        {},
        resolve,
      );
    });

    const resp = result as { text?: string; error?: string };
    expect(resp.text).toBe('Chat response from AI.');

    // fetch リクエストのボディを検証
    const fetchBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      messages: Array<{ role: string; content: string }>;
      system: string;
    };
    // ページ本文がシステムプロンプトに含まれる（F-006）
    expect(fetchBody.system).toContain('This is a news article about technology.');
    // ユーザーメッセージが含まれる
    expect(fetchBody.messages.at(-1)?.content).toBe('What is this page about?');
  });

  it('CHAT の history が API の messages 配列に蓄積される（F-006）', async () => {
    vi.resetModules();
    mock = installChromeMock();
    mock.storage.local._data['apiKey'] = 'sk-ant-test-key';
    mock.storage.local._data['aiModel'] = 'claude-haiku-4-5';

    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Follow-up answer.' }],
        }),
      })
    );
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

    await import('../src/background/index.js');

    const listener = mock.runtime.onMessage._listeners[0] as
      (m: unknown, s: unknown, sr: (r: unknown) => void) => boolean;

    await new Promise<unknown>((resolve) => {
      listener(
        {
          type: 'CHAT',
          userMessage: 'Follow-up question',
          history: [
            { role: 'user', content: 'First question' },
            { role: 'assistant', content: 'First answer' },
          ],
          pageContent: 'Article text.',
        },
        {},
        resolve,
      );
    });

    const fetchBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };

    // history 2 件 + 最新ユーザーメッセージ 1 件 = 計 3 件
    expect(fetchBody.messages).toHaveLength(3);
    expect(fetchBody.messages[0]).toEqual({ role: 'user', content: 'First question' });
    expect(fetchBody.messages[1]).toEqual({ role: 'assistant', content: 'First answer' });
    expect(fetchBody.messages[2]).toEqual({ role: 'user', content: 'Follow-up question' });
  });
});
