// F-203 短文警告 UI / F-204 短文プロンプトのテスト（Sprint 7 更新版）
// - "Explain page" クイックアクションで 40 文字未満の場合に警告 UI が表示される
// - Run anyway で API 呼び出しに進む（送信されること）
// - Cancel で API 呼び出しが発生しない
// - background CHAT ハンドラが useShortPrompt フラグで system prompt を切り替える（F-204）
// - selection クイックアクション（Explain selection）では F-303 通り警告抑止

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

/** chrome.tabs.sendMessage のモックを設定する */
function setupTabsSendMessage(response: unknown): void {
  (mock as unknown as {
    tabs: { sendMessage: ReturnType<typeof vi.fn> };
  }).tabs.sendMessage = vi.fn(() => Promise.resolve(response));
  (globalThis as unknown as { chrome: typeof mock }).chrome = mock;
}

// ----------------------------------------------------------------
// F-203: 短文警告 UI（"Explain page" クイックアクション時のみ）
// ----------------------------------------------------------------
describe('F-203: 短文警告 UI（"Explain page" クイックアクション）', () => {
  it('抽出結果が 40 文字未満のとき shortContentWarning が表示される', async () => {
    const shortContent = 'A'.repeat(39);
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: 39,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(false);

    // 警告テキストに文字数が含まれる
    const warningText = document.getElementById('shortContentWarningText')!;
    expect(warningText.textContent).toContain('39');

    // API はまだ呼ばれていない
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('抽出結果が 40 文字のときは警告が表示されず即 API 呼び出しが行われる', async () => {
    const exactContent = 'A'.repeat(40);
    setupTabsSendMessage({
      url: 'https://example.com',
      content: exactContent,
      truncated: false,
      originalLength: 40,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('Run anyway を押すと API 呼び出しが行われ応答が chatMessages に表示される', async () => {
    const shortContent = 'notable';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ text: 'Explanation of the word notable.' })
    );

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

    // 警告が非表示になる
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(true);
    // API が呼ばれた
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
    // 応答が chatMessages に表示された
    const messages = document.getElementById('chatMessages')!;
    expect(messages.textContent).toContain('Explanation of the word notable.');
  });

  it('Cancel を押すと API 呼び出しは行われない', async () => {
    const shortContent = 'notable';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    // 警告が表示されている
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);

    // Cancel を押す
    (document.getElementById('btnCancelShort') as HTMLButtonElement).click();
    await flush(20);

    // 警告が非表示になる
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(true);
    // API は呼ばれない
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('警告ブロックに role="alert" 相当の通知構造がある（アクセシビリティ）', () => {
    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.getAttribute('role')).toBe('alert');
  });
});

// ----------------------------------------------------------------
// F-303: "Explain selection" クイックアクションでは短文警告を抑止する
// ----------------------------------------------------------------
function setupTabsSendMessageForSelection(
  selectedText: string,
  pageContent: string = '',
): void {
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
}

describe('F-303: "Explain selection" クイックアクションでは短文警告 UI を抑止する', () => {
  it('選択テキストが 40 文字未満でも shortContentWarning が表示されない（F-303）', async () => {
    const shortSelected = 'short text';
    setupTabsSendMessageForSelection(shortSelected, 'Page body context here.');
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    // 警告 UI は表示されない（F-303）
    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);

    // API はすぐに呼ばれる
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('選択テキストが 1 文字でも警告なしで即 API 呼び出しが行われる（F-303）', async () => {
    setupTabsSendMessageForSelection('A', 'Page body content for context.');
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    (document.getElementById('qaExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------
// F-204: background CHAT ハンドラ: useShortPrompt フラグで system prompt を切り替える
// ----------------------------------------------------------------
describe('F-204: background CHAT ハンドラ: useShortPrompt による短文 vs 通常プロンプト切り替え', () => {
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

  it('useShortPrompt=true のとき短文用プロンプト文言が system に含まれる', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await callListener({
      type: 'CHAT',
      userMessage: 'notable',
      history: [],
      pageContent: '',
      useShortPrompt: true,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    // 短文プロンプトには "short word" や "usage" の文言が含まれる
    expect(body.system).toContain('short word');
  });

  it('useShortPrompt=false のとき通常プロンプトが使われ短文用文言は含まれない', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await callListener({
      type: 'CHAT',
      userMessage: 'A'.repeat(40),
      history: [],
      pageContent: '',
      useShortPrompt: false,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    // 通常プロンプトには "web page content" の文言が含まれる
    expect(body.system).toContain('web page content');
    // 短文プロンプト固有の文言は含まれない
    expect(body.system).not.toContain('short word');
  });

  it('useShortPrompt=true + outputLanguage="ja" のとき短文用プロンプトが日本語対応になる', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await callListener({
      type: 'CHAT',
      userMessage: 'notable',
      history: [],
      pageContent: '',
      useShortPrompt: true,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    expect(body.system).toContain('Japanese');
    expect(body.system).toContain('short word');
  });

  it('useShortPrompt=false + outputLanguage="ja" のとき通常プロンプトが日本語対応になる', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await callListener({
      type: 'CHAT',
      userMessage: 'B'.repeat(40),
      history: [],
      pageContent: '',
      useShortPrompt: false,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    expect(body.system).toContain('Japanese');
    expect(body.system).not.toContain('short word');
  });
});

// ----------------------------------------------------------------
// F-204: getShortExplainSystemPrompt のユニットテスト
// ----------------------------------------------------------------
describe('getShortExplainSystemPrompt（F-204）', () => {
  it('lang="en" のとき "English" と "short word" を含む', async () => {
    const { getShortExplainSystemPrompt } = await import('../src/lib/claude.js');
    const prompt = getShortExplainSystemPrompt('en');
    expect(prompt).toContain('English');
    expect(prompt).toContain('short word');
    expect(prompt).not.toContain('Japanese');
  });

  it('lang="ja" のとき "Japanese" と "short word" を含む', async () => {
    const { getShortExplainSystemPrompt } = await import('../src/lib/claude.js');
    const prompt = getShortExplainSystemPrompt('ja');
    expect(prompt).toContain('Japanese');
    expect(prompt).toContain('short word');
    expect(prompt).not.toContain('English');
  });

  it('デフォルト引数なしのとき "English" を含む', async () => {
    const { getShortExplainSystemPrompt } = await import('../src/lib/claude.js');
    expect(getShortExplainSystemPrompt()).toContain('English');
  });
});

// ----------------------------------------------------------------
// [HIGH] AbortController: resetChat 後に古いリスナーが発火しない（F-203）
// ----------------------------------------------------------------
describe('[HIGH] AbortController: resetChat 後に古いリスナーが発火しない（F-203）', () => {
  it('resetChat 後に btnRunAnyway を click しても API 呼び出しが起きない', async () => {
    const shortContent = 'notable';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat, resetChat } = await import('../src/sidepanel/chat.js');
    initChat();

    // 短文警告を表示させる
    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    // 警告が出ていることを確認
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();

    // TAB_CHANGED 相当: resetChat を呼ぶ
    resetChat();

    // リセット後に古い btnRunAnyway を click
    (document.getElementById('btnRunAnyway') as HTMLButtonElement).click();
    await flush(20);

    // 古いリスナーが AbortController で剥がされているため API は呼ばれない
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('連続して短文警告を出した場合、最新の Run anyway のみが API を叩く（古いハンドラ発火なし）', async () => {
    const shortContent = 'notable';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat, resetChat } = await import('../src/sidepanel/chat.js');
    initChat();

    // 1回目: 短文警告を表示
    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);

    // reset して2回目の Explain を起動
    resetChat();
    await flush(5);

    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);

    // 2回目の Run anyway を押す
    (document.getElementById('btnRunAnyway') as HTMLButtonElement).click();
    await flush(20);

    // API は1回だけ呼ばれる（古いリスナーが発火しない）
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });
});

// ----------------------------------------------------------------
// [HIGH] Run anyway / Cancel 解決パスでのリスナークリーンアップ
// ----------------------------------------------------------------
describe('[HIGH] Run anyway / Cancel 解決パスのリスナークリーンアップ', () => {
  it('短文警告→Run anyway→再度短文警告→Run anyway で API が各回 1 回だけ呼ばれる', async () => {
    const shortContent = 'notable';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    // 1回目: 短文警告 → Run anyway
    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();

    (document.getElementById('btnRunAnyway') as HTMLButtonElement).click();
    await flush(20);

    // 1回目の API 呼び出しが 1 回だけ行われる
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);

    // 2回目: 短文警告 → Run anyway
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);

    (document.getElementById('btnRunAnyway') as HTMLButtonElement).click();
    await flush(20);

    // 2回目の API 呼び出しが追加で 1 回（合計 2 回）
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('短文警告→Cancel→再度短文警告→Run anyway でステイルハンドラが発火しない', async () => {
    const shortContent = 'notable';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initChat } = await import('../src/sidepanel/chat.js');
    initChat();

    // 1回目: 短文警告 → Cancel
    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);

    (document.getElementById('btnCancelShort') as HTMLButtonElement).click();
    await flush(20);

    // Cancel で API は呼ばれない
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();

    // 2回目: 短文警告 → Run anyway
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    (document.getElementById('qaExplainPage') as HTMLButtonElement).click();
    await flush(20);
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);

    (document.getElementById('btnRunAnyway') as HTMLButtonElement).click();
    await flush(20);

    // API は 1 回だけ呼ばれる（ステイルハンドラが発火しない）
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });
});
