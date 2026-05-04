// Sprint 6 テスト: F-301 / F-302 / F-303 の検証
// - 選択モードでページ本文も搬送されること（F-301）
// - API リクエストの user content に「Page context」と「Explain the following selection」が含まれること（F-302）
// - ページ本文取得失敗時は選択テキストのみで実行されること（F-301 フォールバック）
// - 選択モードでは F-203 警告 UI が表示されないこと（F-303）
// - 選択テキストが短い（< 40 文字）場合に F-204 短文プロンプトが使われること（F-303 / F-204）
// - 出力言語切替（en/ja）が選択モードでも反映されること（F-201）
// - ページ全体モードのリグレッション（既存挙動が壊れていないこと）
// - ページ本文 / 選択テキストそれぞれの truncate（F-302）

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

/** Explain タブに必要なDOM要素をセットアップ */
function setupDom(): void {
  document.body.innerHTML = `
    <button id="btnExplainWhole">Explain whole page</button>
    <button id="btnExplainSelection">Selection only</button>
    <div id="explainLoading" class="hidden"></div>
    <div id="shortContentWarning" class="hidden" role="alert">
      <p id="shortContentWarningText"></p>
      <div>
        <button id="btnRunAnyway">Run anyway</button>
        <button id="btnCancelShort">Cancel</button>
      </div>
    </div>
    <div id="truncatedNotice" class="hidden"></div>
    <div id="explainError" class="hidden"></div>
    <div id="explainResult" class="hidden"></div>
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
 * 選択モードのために tabs.sendMessage を 2 回呼び出しに対応したモックを設定する
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

/** ページ全体モードのための tabs.sendMessage モックを設定する */
function setupWholePageTabsMock(
  content: string,
  truncated = false,
  originalLength = content.length,
): void {
  (mock as unknown as {
    tabs: { sendMessage: ReturnType<typeof vi.fn> };
  }).tabs.sendMessage = vi.fn(() =>
    Promise.resolve({
      url: 'https://example.com',
      content,
      truncated,
      originalLength,
    })
  );
  (globalThis as unknown as { chrome: typeof mock }).chrome = mock;
}

// ----------------------------------------------------------------
// F-301: 選択モードでページ本文も搬送される
// ----------------------------------------------------------------
describe('F-301: 選択モードでのページ本文同時取得', () => {
  it('EXPLAIN メッセージに selectionText と pageContent が含まれる', async () => {
    const selectedText = 'notable achievement';
    const pageContent = 'This article discusses the notable achievement of the team in 2024.';
    setupSelectionTabsMock(selectedText, pageContent);
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Explanation result.' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const explainCall = mock.runtime.sendMessage.mock.calls[0];
    const msg = explainCall[0] as {
      type: string;
      mode: string;
      selectionText: string;
      pageContent: string;
    };
    expect(msg.type).toBe('EXPLAIN');
    expect(msg.mode).toBe('selection');
    expect(msg.selectionText).toBe(selectedText);
    expect(msg.pageContent).toBe(pageContent);
  });

  it('選択が空のときはエラーメッセージが表示され API は呼ばれない', async () => {
    setupSelectionTabsMock('', 'Some page content here.');
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const error = document.getElementById('explainError')!;
    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toMatch(/no text is selected/i);
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
      // GET_PAGE_CONTENT が失敗
      return Promise.reject(new Error('Content script not available'));
    });
    (globalThis as unknown as { chrome: typeof mock }).chrome = mock;
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Fallback result.' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(30);

    // API は呼ばれる（エラーにはならない）
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
    const msg = mock.runtime.sendMessage.mock.calls[0][0] as {
      type: string;
      mode: string;
      selectionText: string;
      pageContent: string;
    };
    expect(msg.type).toBe('EXPLAIN');
    expect(msg.mode).toBe('selection');
    expect(msg.selectionText).toBe(selectedText);
    // pageContent は空文字（フォールバック）
    expect(msg.pageContent).toBe('');

    // 結果が表示される
    const result = document.getElementById('explainResult')!;
    expect(result.classList.contains('hidden')).toBe(false);
  });
});

// ----------------------------------------------------------------
// F-302: 文脈付き Explain プロンプト（background 側）
// ----------------------------------------------------------------
describe('F-302: 文脈付き Explain プロンプト（background EXPLAIN ハンドラ）', () => {
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

  it('選択モードで user content に "Page context" と "Explain the following selection" が含まれる', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await callListener({
      type: 'EXPLAIN',
      mode: 'selection',
      selectionText: 'notable achievement',
      pageContent: 'The team reached a notable achievement in 2024.',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = body.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('Page context');
    expect(userContent).toContain('Explain the following selection');
    expect(userContent).toContain('notable achievement');
    expect(userContent).toContain('The team reached a notable achievement in 2024.');
  });

  it('pageContent が空のとき "Page context" セクションを省略して選択テキストのみで送る（F-302 フォールバック）', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await callListener({
      type: 'EXPLAIN',
      mode: 'selection',
      selectionText: 'notable achievement',
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

  it('pageContent が空白のみのとき "Page context" セクションを省略する', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await callListener({
      type: 'EXPLAIN',
      mode: 'selection',
      selectionText: 'notable',
      pageContent: '   ',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = body.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).not.toContain('Page context');
  });

  it('ページ全体モードでは "Page context" / "Explain the following selection" が含まれない（リグレッション）', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await callListener({
      type: 'EXPLAIN',
      mode: 'whole',
      content: 'This is the full page content to explain.',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = body.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).not.toContain('Page context');
    expect(userContent).not.toContain('Explain the following selection');
    // 従来どおり content が含まれる
    expect(userContent).toContain('This is the full page content to explain.');
  });

  it('outputLanguage="ja" のとき選択モードのシステムプロンプトに "Japanese" が含まれる（F-201）', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await callListener({
      type: 'EXPLAIN',
      mode: 'selection',
      selectionText: 'notable',
      pageContent: 'Some page context here about a notable event.',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    expect(body.system).toContain('Japanese');
  });

  it('outputLanguage="en" のとき選択モードのシステムプロンプトに "English" が含まれる（F-201）', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await callListener({
      type: 'EXPLAIN',
      mode: 'selection',
      selectionText: 'notable',
      pageContent: 'Some page context here about a notable event.',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    expect(body.system).toContain('English');
  });

  it('選択モードで selectionText.length < 40 のとき短文プロンプトが使われる（F-303/F-204）', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    // "notable" = 7文字 < 40
    await callListener({
      type: 'EXPLAIN',
      mode: 'selection',
      selectionText: 'notable',
      pageContent: 'This article discusses the notable event of the year 2024.',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    // 短文プロンプトには "short word" の文言が含まれる（F-204）
    expect(body.system).toContain('short word');
  });

  it('選択モードで selectionText.length >= 40 のとき通常プロンプトが使われる（F-204）', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    const longSelection = 'This is a long enough selection text that exceeds forty characters.';
    await callListener({
      type: 'EXPLAIN',
      mode: 'selection',
      selectionText: longSelection,
      pageContent: 'Page body context for this article.',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    // 通常プロンプトには "web page content" の文言が含まれる
    expect(body.system).toContain('web page content');
    expect(body.system).not.toContain('short word');
  });

  it('SELECTION_MAX_CHARS (5000) 超の選択テキストが切り詰められてリクエストに含まれる（F-302）', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    // 5001文字の選択テキスト
    const longSelection = 'A'.repeat(5001);
    await callListener({
      type: 'EXPLAIN',
      mode: 'selection',
      selectionText: longSelection,
      pageContent: 'Page context for a very long selection.',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = body.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('Page context');
    // 切り詰め後の文字 '…' が含まれる
    expect(userContent).toContain('…');
    // 元の 5001 文字の 'A' は切り詰められている
    expect(userContent).not.toContain('A'.repeat(5001));
  });

  it('SELECTION_MAX_CHARS (5000) を1文字超えた入力で <selection> 部分の文字数が 5000 以内に収まる（上限厳守）', async () => {
    // { IMPORT_SELECTION_MAX_CHARS } を直接使う
    const { SELECTION_MAX_CHARS } = await import('../src/content/extract.js');
    mock.storage.local._data['outputLanguage'] = 'en';
    // SELECTION_MAX_CHARS + 1 文字の入力
    const longSelection = 'B'.repeat(SELECTION_MAX_CHARS + 1);
    await callListener({
      type: 'EXPLAIN',
      mode: 'selection',
      selectionText: longSelection,
      pageContent: 'Page context for a very long selection.',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = body.messages.find((m) => m.role === 'user')?.content ?? '';
    // <selection>...</selection> タグで挟まれた部分を抽出
    const selectionMatch = userContent.match(/<selection>\n([\s\S]*?)\n<\/selection>/);
    const selectionContent = selectionMatch ? selectionMatch[1] : '';
    // 上限を厳守: SELECTION_MAX_CHARS 以内
    expect(selectionContent.length).toBeLessThanOrEqual(SELECTION_MAX_CHARS);
  });
});

// ----------------------------------------------------------------
// F-303: 選択モードでは短文警告 UI を表示しない（UI 層）
// ----------------------------------------------------------------
describe('F-303: 選択モードでは短文警告 UI を抑止する（UI 層）', () => {
  it('選択テキストが 7 文字でも shortContentWarning が表示されない', async () => {
    setupSelectionTabsMock('notable', 'Page context with enough content to provide context.');
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
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

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('ページ全体モードでは抽出本文が 40 文字未満で引き続き警告 UI が表示される（リグレッションなし）', async () => {
    // ページ全体モードでは短文警告が従来どおり動作する
    const shortContent = 'A'.repeat(39);
    setupWholePageTabsMock(shortContent, false, 39);
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(false);
    // API はまだ呼ばれない（警告ブロック中）
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------
// F-302: 切り詰め通知の UI 表示
// ----------------------------------------------------------------
describe('F-302: 切り詰め通知 UI', () => {
  it('ページ本文が切り詰められた場合に truncatedNotice が表示される', async () => {
    const pageContent = 'A'.repeat(20000); // CONTENT_MAX_CHARS に達した（切り詰め済み）
    setupSelectionTabsMock('notable', pageContent, true, 25000);
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const notice = document.getElementById('truncatedNotice')!;
    expect(notice.classList.contains('hidden')).toBe(false);
    expect(notice.textContent).toContain('truncated');
    expect(notice.textContent).toContain('25,000');
  });

  it('選択テキストが切り詰められた場合に truncatedNotice が表示される（F-302）', async () => {
    // UI 層で EXPLAIN メッセージを送信する前に切り詰め通知を表示する
    // 実際の切り詰め通知は doSelectionExplainRequest 内で処理される
    // selection テキストが SELECTION_MAX_CHARS (5000) 超の場合
    const longSelection = 'B'.repeat(5001);
    const pageContent = 'Page content for context.';
    setupSelectionTabsMock(longSelection, pageContent);
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const notice = document.getElementById('truncatedNotice')!;
    expect(notice.classList.contains('hidden')).toBe(false);
    expect(notice.textContent).toContain('5,001');
  });

  it('連続実行（ページ本文truncate → 選択のみ）で truncatedNotice が前回のテキストを持ち越さない', async () => {
    // 1回目: ページ本文が切り詰められた選択 Explain（truncatedNotice にページ truncate メッセージが入る）
    setupSelectionTabsMock('notable', 'A'.repeat(20000), true, 25000);
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result 1' }));

    const { initExplain, resetExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const notice = document.getElementById('truncatedNotice')!;
    // 1回目: ページ truncate メッセージが表示されていること
    expect(notice.classList.contains('hidden')).toBe(false);
    expect(notice.textContent).toContain('25,000');

    // タブ変更相当のリセット
    resetExplain();

    // 2回目: 選択テキストのみ、切り詰めなし・ページ本文も切り詰めなし
    setupSelectionTabsMock('short text', 'Normal page content that is not truncated.');
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result 2' }));

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    // 2回目: truncatedNotice は hidden であり、前回の「25,000」テキストが残っていない
    expect(notice.classList.contains('hidden')).toBe(true);
    expect(notice.textContent).toBe('');
  });
});

// ----------------------------------------------------------------
// リグレッション: ページ全体モードの既存挙動（F-005）
// ----------------------------------------------------------------
describe('ページ全体モードのリグレッション（Sprint 1〜5 既存挙動）', () => {
  it('ページ全体 Explain でリクエストに mode="whole" が含まれる', async () => {
    const longContent = 'Full page article content that is long enough for normal processing.';
    setupWholePageTabsMock(longContent);
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'Explanation.' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);

    const msg = mock.runtime.sendMessage.mock.calls[0][0] as {
      type: string;
      mode: string;
      content: string;
    };
    expect(msg.type).toBe('EXPLAIN');
    expect(msg.mode).toBe('whole');
    expect(msg.content).toBe(longContent);
  });

  it('ページ全体モードの background EXPLAIN ハンドラが正常に動作する（リグレッション）', async () => {
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
      listener({ type: 'EXPLAIN', mode: 'whole', content: 'Some page content.' }, {}, resolve);
    });

    expect((result as { text: string }).text).toBe('explained');
  });
});
