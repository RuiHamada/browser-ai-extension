// Codex 最終レビュー指摘（Sprint 7）の修正検証テスト
// - HIGH-1: doSendMessage 中に resetChat() → stale 応答が chatHistory に積まれない
// - HIGH-2: Explain selection 後の follow-up で selection コンテキストを引き継ぐ
//   - Explain selection → 自由入力: userMessage に Page context + selection が含まれる
//   - Explain selection → Explain page: 自由入力で selection が含まれない（モード切替）
// - MEDIUM-1: Summary/Detailed/Beginner-friendly/Expert-level は短文警告を出さない
//   - Explain page は従来通り短文警告を出す
// - MEDIUM-2: Run anyway で useShortPrompt: true が送信される

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

/** Chat 単一画面に必要な DOM 要素をセットアップ */
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
async function flush(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/** chrome.tabs.sendMessage に GET_PAGE_CONTENT のレスポンスを設定するヘルパー */
function setupTabsSendMessage(response: unknown): void {
  (mock as unknown as { tabs: { sendMessage: ReturnType<typeof vi.fn> } })
    .tabs.sendMessage = vi.fn(() => Promise.resolve(response));
  (globalThis as unknown as { chrome: typeof mock }).chrome = mock;
}

/**
 * selection クイックアクション用: tabs.sendMessage を 2 回呼び出しに対応したモック
 * 1回目: GET_SELECTED_TEXT → selectedText
 * 2回目以降: GET_PAGE_CONTENT → page content
 */
function setupSelectionTabsMock(
  selectedText: string,
  pageContent: string,
): void {
  let callCount = 0;
  (mock as unknown as {
    tabs: { sendMessage: ReturnType<typeof vi.fn> };
  }).tabs.sendMessage = vi.fn(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve({ selectedText });
    }
    return Promise.resolve({
      url: 'https://example.com',
      content: pageContent,
      truncated: false,
      originalLength: pageContent.length,
    });
  });
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
// HIGH-1: 世代ガード: doSendMessage 中に resetChat() → stale 応答を破棄
// ----------------------------------------------------------------
describe('[HIGH-1] resetChat() 後の stale 応答を chatHistory に積まない', () => {
  it('doSendMessage 中に resetChat() が呼ばれた場合、応答が resolve しても chatHistory に追加されない', async () => {
    setupTabsSendMessage({ content: 'Page content here.', truncated: false, originalLength: 18 });

    // sendMessage を制御可能な Promise にする
    let resolveChat!: (v: unknown) => void;
    mock.runtime.sendMessage = vi.fn(() =>
      new Promise((resolve) => { resolveChat = resolve; })
    );

    const { initChat, resetChat, getChatHistory } = await import('../src/sidepanel/chat.js');
    initChat();

    // 送信開始
    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    input.value = 'In-flight question';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(10); // sendMessage が発行されるまで待つ

    // in-flight 中に resetChat() を呼ぶ
    resetChat();
    await flush(5);

    // この後 in-flight な sendMessage を resolve する
    resolveChat({ text: 'Stale AI response' });
    await flush(20);

    // stale 応答は chatHistory に追加されない（HIGH-1）
    expect(getChatHistory().length).toBe(0);
  });

  it('resetChat() 後に stale バブルが chatMessages に追記されない', async () => {
    setupTabsSendMessage({ content: 'Page content here.', truncated: false, originalLength: 18 });

    let resolveChat!: (v: unknown) => void;
    mock.runtime.sendMessage = vi.fn(() =>
      new Promise((resolve) => { resolveChat = resolve; })
    );

    const { initChat, resetChat } = await import('../src/sidepanel/chat.js');
    initChat();

    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    input.value = 'In-flight question';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(10);

    // resetChat() でキャンセル
    resetChat();
    await flush(5);

    // stale 応答を resolve
    resolveChat({ text: 'Stale AI response - should not appear' });
    await flush(20);

    // chatMessages に stale バブルが出ない
    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).not.toContain('Stale AI response - should not appear');
    // Welcome メッセージが再表示されている
    expect(messages.textContent).toContain('Welcome');
  });
});

// ----------------------------------------------------------------
// HIGH-1 拡張: pre-fetch 中に resetChat() → user バブルも assistant バブルも描画されない
// ----------------------------------------------------------------
describe('[HIGH-1 拡張] pre-fetch 中に resetChat() → stale な描画を防ぐ', () => {
  it('runQuickAction(qaExplainPage) の fetchPageContent pending 中に resetChat() を呼ぶと user/assistant バブルが描画されない', async () => {
    // fetchPageContent（tabs.sendMessage）を制御可能な Promise にする
    let resolveTabsMsg!: (v: unknown) => void;
    (mock as unknown as { tabs: { sendMessage: ReturnType<typeof vi.fn> } })
      .tabs.sendMessage = vi.fn(() =>
        new Promise((resolve) => { resolveTabsMsg = resolve; })
      );
    (globalThis as unknown as { chrome: typeof mock }).chrome = mock;

    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ text: 'Should not appear' })
    );

    const { initChat, resetChat } = await import('../src/sidepanel/chat.js');
    initChat();

    // クイックアクション実行（fetchPageContent が pending 状態になる）
    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(5); // tabs.sendMessage が呼ばれるまで待つ

    // pre-fetch が pending 中に resetChat() を呼ぶ（世代が進む）
    resetChat();
    await flush(5);

    // tabs.sendMessage を resolve する（世代がすでに stale）
    resolveTabsMsg({ content: 'Fetched content', truncated: false, originalLength: 14 });
    await flush(20);

    // stale になったため API（runtime.sendMessage）は呼ばれない
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();

    // user バブルも assistant バブルも描画されない（Welcome のみ残る）
    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).not.toContain('Explain this page');
    expect(messages.textContent).not.toContain('Should not appear');
    expect(messages.textContent).toContain('Welcome');
  });

  it('sendFreeInput の fetchPageContent pending 中に resetChat() を呼ぶと user/assistant バブルが描画されない', async () => {
    let resolveTabsMsg!: (v: unknown) => void;
    (mock as unknown as { tabs: { sendMessage: ReturnType<typeof vi.fn> } })
      .tabs.sendMessage = vi.fn(() =>
        new Promise((resolve) => { resolveTabsMsg = resolve; })
      );
    (globalThis as unknown as { chrome: typeof mock }).chrome = mock;

    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ text: 'Should not appear from free input' })
    );

    const { initChat, resetChat } = await import('../src/sidepanel/chat.js');
    initChat();

    // 自由入力送信（fetchPageContent が pending 状態になる）
    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    input.value = 'My question';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(5); // tabs.sendMessage が呼ばれるまで待つ

    // pre-fetch が pending 中に resetChat() を呼ぶ
    resetChat();
    await flush(5);

    // tabs.sendMessage を resolve する（stale）
    resolveTabsMsg({ content: 'Fetched content', truncated: false, originalLength: 14 });
    await flush(20);

    // stale になったため API は呼ばれない
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();

    // user バブルも assistant バブルも描画されない
    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).not.toContain('My question');
    expect(messages.textContent).not.toContain('Should not appear from free input');
    expect(messages.textContent).toContain('Welcome');
  });

  it('selection クイックアクションの prepareSelectionMessage pending 中に resetChat() を呼ぶと描画されない', async () => {
    // GET_SELECTED_TEXT を制御可能な Promise にする
    let resolveSelectedText!: (v: unknown) => void;
    (mock as unknown as { tabs: { sendMessage: ReturnType<typeof vi.fn> } })
      .tabs.sendMessage = vi.fn(() =>
        new Promise((resolve) => { resolveSelectedText = resolve; })
      );
    (globalThis as unknown as { chrome: typeof mock }).chrome = mock;

    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ text: 'Should not appear from selection' })
    );

    const { initChat, resetChat } = await import('../src/sidepanel/chat.js');
    initChat();

    // Explain selection クイックアクション実行（fetchSelectedText が pending 状態になる）
    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(5); // tabs.sendMessage が呼ばれるまで待つ

    // pre-fetch が pending 中に resetChat() を呼ぶ
    resetChat();
    await flush(5);

    // GET_SELECTED_TEXT を resolve する（stale）
    resolveSelectedText({ selectedText: 'some selected text' });
    await flush(20);

    // stale になったため API は呼ばれない
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();

    // バブルが描画されない
    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).not.toContain('Explain the selected text');
    expect(messages.textContent).not.toContain('Should not appear from selection');
    expect(messages.textContent).toContain('Welcome');
  });

  it('以前の「API 応答だけ stale ガード」は引き続き動作する（リグレッションなし）', async () => {
    setupTabsSendMessage({ content: 'Page content here.', truncated: false, originalLength: 18 });

    let resolveChat!: (v: unknown) => void;
    mock.runtime.sendMessage = vi.fn(() =>
      new Promise((resolve) => { resolveChat = resolve; })
    );

    const { initChat, resetChat, getChatHistory } = await import('../src/sidepanel/chat.js');
    initChat();

    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    input.value = 'In-flight question';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(15); // API 呼び出しが発行されるまで待つ

    // API 呼び出し中（pre-fetch は完了済み）に resetChat()
    resetChat();
    await flush(5);

    resolveChat({ text: 'Stale AI response after reset' });
    await flush(20);

    // stale 応答は chatHistory に追加されない
    expect(getChatHistory().length).toBe(0);
    // chatMessages に stale バブルが出ない
    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).not.toContain('Stale AI response after reset');
    expect(messages.textContent).toContain('Welcome');
  });
});

// ----------------------------------------------------------------
// HIGH-2: selection コンテキストの follow-up 引き継ぎ
// ----------------------------------------------------------------
describe('[HIGH-2] selection コンテキストの follow-up 引き継ぎ（F-403）', () => {
  it('Explain selection → 自由入力: userMessage に Page context と selection 文字列が含まれる', async () => {
    const selectedText = 'notable achievement';
    const pageContent = 'This article discusses the notable achievement of the team.';
    setupSelectionTabsMock(selectedText, pageContent);
    mock.runtime.sendMessage = vi.fn()
      .mockResolvedValueOnce({ text: 'Selection explained.' })
      .mockResolvedValueOnce({ text: 'Follow-up answer.' });

    const { initChat, resetChat } = await import('../src/sidepanel/chat.js');
    resetChat();
    initChat();

    // 1. Explain selection クイックアクションを実行
    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(30);

    // selection クイックアクションが API を呼んだことを確認
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);

    // 2. 自由入力で follow-up を送信
    // GET_PAGE_CONTENT はキャッシュ済みなので tabs.sendMessage は再呼び出しされない
    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    input.value = 'Can you elaborate more?';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(30);

    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(2);
    const followUpCall = mock.runtime.sendMessage.mock.calls[1];
    const followUpMsg = followUpCall[0] as { type: string; userMessage: string };

    expect(followUpMsg.type).toBe('CHAT');
    // selection テキストが follow-up の userMessage に含まれる（HIGH-2: F-403）
    expect(followUpMsg.userMessage).toContain(selectedText);
    // Page context も含まれる
    expect(followUpMsg.userMessage).toContain(pageContent);
    // ユーザーの質問テキストも含まれる
    expect(followUpMsg.userMessage).toContain('Can you elaborate more?');
  });

  it('Explain selection → Explain page (whole に切替) → 自由入力: selection が含まれない', async () => {
    const selectedText = 'UNIQUE_SELECTION_MARKER_XYZ';
    const pageContent = 'This article discusses general topics without the marker.';

    // まず selection 用モック（Explain selection 用）
    let callCount = 0;
    (mock as unknown as {
      tabs: { sendMessage: ReturnType<typeof vi.fn> };
    }).tabs.sendMessage = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        // GET_SELECTED_TEXT
        return Promise.resolve({ selectedText });
      }
      // GET_PAGE_CONTENT
      return Promise.resolve({
        url: 'https://example.com',
        content: pageContent,
        truncated: false,
        originalLength: pageContent.length,
      });
    });
    (globalThis as unknown as { chrome: typeof mock }).chrome = mock;

    mock.runtime.sendMessage = vi.fn()
      .mockResolvedValueOnce({ text: 'Selection explained.' })     // Explain selection
      .mockResolvedValueOnce({ text: 'Page explained.' })           // Explain page
      .mockResolvedValueOnce({ text: 'Free input answer.' });       // 自由入力

    const { initChat, resetChat } = await import('../src/sidepanel/chat.js');
    resetChat();
    initChat();

    // 1. Explain selection
    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(30);
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);

    // 2. Explain page (whole-page 系) → selection モードが解除される
    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(30);
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(2);

    // 3. 自由入力
    const input = document.getElementById('chatInput') as HTMLTextAreaElement;
    input.value = 'What is the main topic?';
    (document.getElementById('btnChatSend') as HTMLButtonElement).click();
    await flush(30);

    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(3);
    const freeInputCall = mock.runtime.sendMessage.mock.calls[2];
    const freeInputMsg = freeInputCall[0] as { type: string; userMessage: string };

    // whole-page モードなので selection テキストは含まれない（HIGH-2: モード切替）
    expect(freeInputMsg.userMessage).not.toContain(selectedText);
    // ページ本文は含まれる（通常の whole-page 自由入力）
    expect(freeInputMsg.userMessage).toContain(pageContent);
    expect(freeInputMsg.userMessage).toContain('What is the main topic?');
  });

  it('resetChat() 後は selection コンテキストがクリアされ自由入力に引き継がれない', async () => {
    const selectedText = 'notable';
    const pageContent = 'Some page content.';
    setupSelectionTabsMock(selectedText, pageContent);

    mock.runtime.sendMessage = vi.fn()
      .mockResolvedValueOnce({ text: 'Selection explained.' })
      .mockResolvedValueOnce({ text: 'Free input answer after reset.' });

    const { initChat, resetChat, getContextMode, getSelectionText } = await import('../src/sidepanel/chat.js');
    resetChat();
    initChat();

    // Explain selection
    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(30);

    // selection モードになっていることを確認
    expect(getContextMode()).toBe('selection');
    expect(getSelectionText()).toBe(selectedText);

    // resetChat() でクリア
    resetChat();
    expect(getContextMode()).toBe(null);
    expect(getSelectionText()).toBe(null);
  });
});

// ----------------------------------------------------------------
// MEDIUM-1: Summary/Detailed/Beginner-friendly/Expert-level では短文警告を出さない
// ----------------------------------------------------------------
describe('[MEDIUM-1] whole-page 非 Explain-page クイックアクションでは短文警告を出さない', () => {
  const shortContent = 'A'.repeat(39); // SHORT_CONTENT_THRESHOLD 未満

  it('Summary クイックアクションで短文ページでも警告が表示されない', async () => {
    setupTabsSendMessage({
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Summary result.' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaSummary') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    // API はすぐに呼ばれる（警告なし）
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('Detailed クイックアクションで短文ページでも警告が表示されない', async () => {
    setupTabsSendMessage({
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Detailed result.' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaDetailed') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('Beginner-friendly クイックアクションで短文ページでも警告が表示されない', async () => {
    setupTabsSendMessage({
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Beginner result.' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaBeginner') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('Expert-level クイックアクションで短文ページでも警告が表示されない', async () => {
    setupTabsSendMessage({
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Expert result.' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExpert') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('Explain page クイックアクションでは短文ページで警告が表示される（リグレッションなし）', async () => {
    setupTabsSendMessage({
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    // Explain page だけ警告が出る
    expect(warning.classList.contains('hidden')).toBe(false);
    // API はまだ呼ばれない
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------
// MEDIUM-2: Run anyway で useShortPrompt: true が送信される
// ----------------------------------------------------------------
describe('[MEDIUM-2] Run anyway で useShortPrompt: true が background に渡される（F-204）', () => {
  it('Explain page 短文警告 → Run anyway → useShortPrompt: true で CHAT が呼ばれる', async () => {
    const shortContent = 'notable';
    setupTabsSendMessage({
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Short explain result.' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    // 警告が表示されている
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);
    // API はまだ呼ばれていない
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();

    // Run anyway を押す
    (document.getElementById('btnRunAnyway') as HTMLButtonElement).click();
    await flush(20);

    // API が呼ばれた
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);
    const callArgs = mock.runtime.sendMessage.mock.calls[0];
    const msg = callArgs[0] as { type: string; useShortPrompt: boolean };

    expect(msg.type).toBe('CHAT');
    // MEDIUM-2: useShortPrompt: true が送信される（F-204）
    expect(msg.useShortPrompt).toBe(true);
  });

  it('通常の Explain page（長文ページ）では useShortPrompt: false が送信される（リグレッションなし）', async () => {
    const longContent = 'A'.repeat(100); // SHORT_CONTENT_THRESHOLD 以上
    setupTabsSendMessage({
      content: longContent,
      truncated: false,
      originalLength: longContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Normal explain result.' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    // 警告なし・API すぐ呼ばれる
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);

    const callArgs = mock.runtime.sendMessage.mock.calls[0];
    const msg = callArgs[0] as { type: string; useShortPrompt: boolean };
    expect(msg.type).toBe('CHAT');
    // 通常フローでは false
    expect(msg.useShortPrompt).toBe(false);
  });
});
