// Sprint 7 更新版: F-301 / F-302 / F-303 の検証
// Sprint 7 で EXPLAIN ハンドラを廃止し、クイックアクション「Explain selection」経由で Chat 履歴に統合。
// - selection クイックアクションでページ本文も搬送されること（F-301）
// - API リクエストの user content に「Page context」と「Explain the following selection」が含まれること（F-302）
// - ページ本文取得失敗時は選択テキストのみで実行されること（F-301 フォールバック）
// - selection クイックアクションでは F-203 警告 UI が表示されないこと（F-303）
// - 選択テキストが短い（< 40 文字）場合に F-204 短文プロンプトが使われること（F-303 / F-204）
// - 出力言語切替（en/ja）が selection クイックアクションでも反映されること（F-201）

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

/**
 * selection クイックアクション用: tabs.sendMessage を 2 回呼び出しに対応したモック
 * 1回目: GET_SELECTED_TEXT → selectedText
 * 2回目: GET_PAGE_CONTENT → page content
 */
function setupSelectionTabsMock(
  selectedText: string,
  pageContent: string,
  pageContentTruncated = false,
  pageContentOriginalLength = pageContent.length,
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
      truncated: pageContentTruncated,
      originalLength: pageContentOriginalLength,
    });
  });
  (globalThis as unknown as { chrome: typeof mock }).chrome = mock;
}

// ----------------------------------------------------------------
// F-301: selection クイックアクションでページ本文も搬送される
// ----------------------------------------------------------------
describe('F-301: "Explain selection" クイックアクションでのページ本文同時取得', () => {
  it('CHAT メッセージの userMessage に Page context と選択テキストが含まれる', async () => {
    const selectedText = 'notable achievement';
    const pageContent = 'This article discusses the notable achievement of the team in 2024.';
    setupSelectionTabsMock(selectedText, pageContent);
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Explanation result.' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const chatCall = mock.runtime.sendMessage.mock.calls[0];
    const msg = chatCall[0] as { type: string; userMessage: string };
    expect(msg.type).toBe('CHAT');
    // F-302: Page context + Explain the following selection の構造
    expect(msg.userMessage).toContain('Page context');
    expect(msg.userMessage).toContain('Explain the following selection');
    expect(msg.userMessage).toContain(selectedText);
    expect(msg.userMessage).toContain(pageContent);
  });

  it('選択が空のときはエラーメッセージが chatMessages に表示され API は呼ばれない', async () => {
    setupSelectionTabsMock('', 'Some page content here.');
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).toMatch(/no text is selected/i);
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('ページ本文取得失敗時は選択テキストのみで実行される（フォールバック）', async () => {
    const selectedText = 'notable achievement';
    // GET_SELECTED_TEXT は成功するが GET_PAGE_CONTENT は失敗する
    let callCount = 0;
    (mock as unknown as {
      tabs: { sendMessage: ReturnType<typeof vi.fn> };
    }).tabs.sendMessage = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ selectedText });
      }
      return Promise.reject(new Error('Content script not available'));
    });
    (globalThis as unknown as { chrome: typeof mock }).chrome = mock;
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Fallback result.' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(30);

    // API は呼ばれる（エラーにならない）
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
    const msg = mock.runtime.sendMessage.mock.calls[0][0] as { type: string; userMessage: string };
    expect(msg.type).toBe('CHAT');
    expect(msg.userMessage).toContain(selectedText);
    // pageContent がないのでフォールバックプロンプト（Page context なし）
    expect(msg.userMessage).not.toContain('Page context');
  });
});

// ----------------------------------------------------------------
// F-302: 文脈付き Explain プロンプト（background CHAT ハンドラ）
// selection クイックアクション経由で CHAT に送られるメッセージを直接テスト
// ----------------------------------------------------------------
describe('F-302: 文脈付き Explain プロンプト（background CHAT ハンドラ経由）', () => {
  const fetchMock = vi.fn();

  beforeEach(async () => {
    fetchMock.mockReset();
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] }),
    });
    mock.storage.local._data['apiKey'] = 'sk-ant-test';
    mock.storage.local._data['aiModel'] = 'claude-haiku-4-5';
    vi.resetModules();
    await import('../src/background/index.js');
  });

  function callListener(message: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      const listener = mock.runtime.onMessage._listeners[0] as
        | ((m: unknown, s: unknown, sr: (r: unknown) => void) => boolean | void)
        | undefined;
      if (!listener) { resolve(undefined); return; }
      listener(message, {}, (r: unknown) => resolve(r));
    });
  }

  it('selection クイックアクションが送る userMessage に "Page context" と "Explain the following selection" が含まれる', async () => {
    // chat.ts の prepareSelectionMessage と同等の内容を直接 CHAT で送信
    mock.storage.local._data['outputLanguage'] = 'en';
    const pageContent = 'The team reached a notable achievement in 2024.';
    const selectionText = 'notable achievement';
    const userMessage =
      `Page context (for reference, do not summarize this):\n<page>\n${pageContent}\n</page>\n\n` +
      `Explain the following selection within that context:\n<selection>\n${selectionText}\n</selection>`;

    await callListener({
      type: 'CHAT',
      userMessage,
      history: [],
      pageContent: '',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = body.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('Page context');
    expect(userContent).toContain('Explain the following selection');
    expect(userContent).toContain(selectionText);
    expect(userContent).toContain(pageContent);
  });

  it('pageContent が空のときフォールバック: "Page context" セクションを省略して選択テキストのみで送る', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    // chat.ts の prepareSelectionMessage（pageContent 空）と同等
    const userMessage = 'Please explain the following text:\n\nnotable achievement';

    await callListener({
      type: 'CHAT',
      userMessage,
      history: [],
      pageContent: '',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = body.messages.find((m) => m.role === 'user')?.content ?? '';
    // フォールバックでは "Page context" セクションは含まれない
    expect(userContent).not.toContain('Page context');
    // 選択テキストが含まれる
    expect(userContent).toContain('notable achievement');
  });

  it('outputLanguage="ja" のとき CHAT システムプロンプトに "Japanese" が含まれる（F-201）', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await callListener({
      type: 'CHAT',
      userMessage: 'Page context:\nsome page\n\nExplain the following selection:\nnotable',
      history: [],
      pageContent: '',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    expect(body.system).toContain('Japanese');
  });

  it('outputLanguage="en" のとき CHAT システムプロンプトに "English" が含まれる（F-201）', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await callListener({
      type: 'CHAT',
      userMessage: 'Page context:\nsome page\n\nExplain the following selection:\nnotable',
      history: [],
      pageContent: '',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    expect(body.system).toContain('English');
  });

  it('useShortPrompt=true のとき短文プロンプトが使われる（F-303 / F-204）', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await callListener({
      type: 'CHAT',
      userMessage: 'notable',
      history: [],
      pageContent: '',
      useShortPrompt: true,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    // 短文プロンプトには "short word" の文言が含まれる（F-204）
    expect(body.system).toContain('short word');
  });

  it('useShortPrompt=false のとき通常プロンプトが使われる（F-204）', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    const longSelection = 'This is a long enough selection text that exceeds forty characters.';
    await callListener({
      type: 'CHAT',
      userMessage: longSelection,
      history: [],
      pageContent: '',
      useShortPrompt: false,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    // 通常プロンプトには "web page content" の文言が含まれる
    expect(body.system).toContain('web page content');
    expect(body.system).not.toContain('short word');
  });
});

// ----------------------------------------------------------------
// F-303: selection クイックアクションでは短文警告 UI を表示しない（UI 層）
// ----------------------------------------------------------------
describe('F-303: "Explain selection" クイックアクションでは短文警告 UI を抑止する（UI 層）', () => {
  it('選択テキストが 7 文字でも shortContentWarning が表示されない', async () => {
    setupSelectionTabsMock('notable', 'Page context with enough content to provide context.');
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    // API は即座に呼ばれる
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('選択テキストが 39 文字でも shortContentWarning が表示されない（F-303）', async () => {
    const selected = 'A'.repeat(39);
    setupSelectionTabsMock(selected, 'Page body content for context.');
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('"Explain page" クイックアクションでは抽出本文 40 文字未満で引き続き警告 UI が表示される（リグレッションなし）', async () => {
    // whole-page クイックアクションでは短文警告が従来どおり動作する
    const shortContent = 'A'.repeat(39);
    (mock as unknown as {
      tabs: { sendMessage: ReturnType<typeof vi.fn> };
    }).tabs.sendMessage = vi.fn(() =>
      Promise.resolve({
        url: 'https://example.com',
        content: shortContent,
        truncated: false,
        originalLength: 39,
      })
    );
    (globalThis as unknown as { chrome: typeof mock }).chrome = mock;
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(false);
    // API はまだ呼ばれない（警告ブロック中）
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------
// F-302: selection クイックアクションでの選択テキスト切り詰め UI 通知
// ----------------------------------------------------------------
describe('F-302: selection クイックアクションでの選択テキスト切り詰め通知', () => {
  it('SELECTION_MAX_CHARS (5000) 超の選択テキストが切り詰められてリクエストに含まれる（F-302）', async () => {
    const { SELECTION_MAX_CHARS } = await import('../src/content/extract.js');
    const longSelection = 'A'.repeat(5001);
    const pageContent = 'Page context for a very long selection.';
    setupSelectionTabsMock(longSelection, pageContent);
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    // API は呼ばれた
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
    const msg = mock.runtime.sendMessage.mock.calls[0][0] as { type: string; userMessage: string };
    expect(msg.type).toBe('CHAT');
    // 切り詰め後の '…' が含まれる
    expect(msg.userMessage).toContain('…');
    // 元の 5001 文字の 'A' は切り詰められている
    expect(msg.userMessage).not.toContain('A'.repeat(5001));
    // <selection> 部分の文字数が SELECTION_MAX_CHARS 以内
    const selectionMatch = msg.userMessage.match(/<selection>\n([\s\S]*?)\n<\/selection>/);
    const selectionContent = selectionMatch ? selectionMatch[1] : '';
    expect(selectionContent.length).toBeLessThanOrEqual(SELECTION_MAX_CHARS);
  });

  it('切り詰め通知が chatMessages の meta バブルとして表示される', async () => {
    const longSelection = 'B'.repeat(5001);
    const pageContent = 'Page content for context.';
    setupSelectionTabsMock(longSelection, pageContent);
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    // 切り詰め通知が chatMessages に含まれる（F-012 / F-401 統合）
    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).toContain('truncated');
    expect(messages.textContent).toContain('5,001');
  });
});

// ----------------------------------------------------------------
// リグレッション: whole-page クイックアクションの既存挙動（F-402）
// ----------------------------------------------------------------
describe('whole-page クイックアクションのリグレッション（Sprint 1〜6 既存挙動）', () => {
  it('"Explain page" クイックアクションで background CHAT ハンドラが正常に動作する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: [{ type: 'text', text: 'explained' }] }),
    });
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
    mock.storage.local._data['apiKey'] = 'sk-ant-test';
    mock.storage.local._data['aiModel'] = 'claude-haiku-4-5';
    mock.storage.local._data['outputLanguage'] = 'en';
    vi.resetModules();
    await import('../src/background/index.js');

    const result = await new Promise((resolve) => {
      const listener = mock.runtime.onMessage._listeners[0] as
        | ((m: unknown, s: unknown, sr: (r: unknown) => void) => boolean | void)
        | undefined;
      if (!listener) { resolve(undefined); return; }
      listener({
        type: 'CHAT',
        userMessage: 'Explain this page in clear English.\n\nPage content:\nSome page content.',
        history: [],
        pageContent: '',
      }, {}, resolve);
    });

    expect((result as { text: string }).text).toBe('explained');
  });
});
