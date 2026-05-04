// sidepanel/explain.ts: Explain タブのUI動作テスト（F-004, F-005, F-011, F-012）
// chrome.tabs.sendMessage と chrome.runtime.sendMessage はモック

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

/** chrome.tabs.sendMessage のモックを設定する */
function setupTabsSendMessage(response: unknown): void {
  (mock as unknown as {
    tabs: { sendMessage: ReturnType<typeof vi.fn> };
  }).tabs.sendMessage = vi.fn(() => Promise.resolve(response));
  (globalThis as unknown as { chrome: typeof mock }).chrome = mock;
}

describe('explain タブ初期化', () => {
  it('initExplain を呼んでもエラーにならない', async () => {
    const { initExplain } = await import('../src/sidepanel/explain.js');
    expect(() => initExplain()).not.toThrow();
  });
});

describe('Explain whole page（F-005）', () => {
  it('ページ全体Explainでresultが表示される', async () => {
    // chrome.tabs.sendMessage (GET_PAGE_CONTENT) のモック（40文字以上: 短文警告なし）
    const longContent = 'Article text here. This is a long enough content for normal flow.';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: longContent,
      truncated: false,
      originalLength: longContent.length,
    });
    // chrome.runtime.sendMessage (EXPLAIN) のモック
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ text: 'This is an English explanation.' })
    );

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);

    const result = document.getElementById('explainResult')!;
    expect(result.classList.contains('hidden')).toBe(false);
    expect(result.textContent).toContain('This is an English explanation.');
  });

  it('ページコンテンツが空の場合はエラーメッセージが表示される', async () => {
    setupTabsSendMessage({ url: 'https://example.com', content: '', truncated: false, originalLength: 0 });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'explanation' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);

    const error = document.getElementById('explainError')!;
    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.textContent?.length).toBeGreaterThan(0);
  });

  it('切り詰めが発生した場合にtruncatedNoticeが表示される（F-012）', async () => {
    setupTabsSendMessage({
      url: 'https://example.com',
      content: 'A'.repeat(20000),
      truncated: true,
      originalLength: 25000,
    });
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ text: 'Explanation of truncated content.' })
    );

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);

    const notice = document.getElementById('truncatedNotice')!;
    expect(notice.classList.contains('hidden')).toBe(false);
    expect(notice.textContent).toContain('truncated');
  });

  it('APIエラー時にエラーメッセージが表示される（F-011）', async () => {
    // 40文字以上: 短文警告なし
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

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);

    const error = document.getElementById('explainError')!;
    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toContain('Authentication error');
  });

  it('エラーメッセージにAPIキーが含まれない（F-011）', async () => {
    const longContent = 'Some content that is long enough to bypass the short content warning threshold.';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: longContent,
      truncated: false,
      originalLength: longContent.length,
    });
    // エラーにAPIキーが混入した場合でも sanitize される
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.reject(new Error('Error: sk-ant-secret-key123 is invalid'))
    );

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);

    const error = document.getElementById('explainError')!;
    expect(error.textContent).not.toContain('sk-ant-secret-key123');
  });

  it('console.error にAPIキーが出力されない（F-011: ログ経路での漏洩防止）', async () => {
    const longContent = 'Some content that is long enough to bypass the short content warning threshold.';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: longContent,
      truncated: false,
      originalLength: longContent.length,
    });
    // APIキーを含む Error を runtime.sendMessage が投げる
    mock.runtime.sendMessage = vi.fn(() =>
      Promise.reject(new Error('Fatal: sk-ant-api03-EXPLAINLOGKEY exposed in stack'))
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { initExplain } = await import('../src/sidepanel/explain.js');
      initExplain();

      (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
      await flush(20);

      // console.error の全引数に sk-ant- が含まれないことを確認
      for (const call of errorSpy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain('sk-ant-api03-EXPLAINLOGKEY');
        }
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('実行中はボタンが disabled になる（ローディング状態）', async () => {
    let resolveExplain!: (v: unknown) => void;
    // 40文字以上: 短文警告なしで即ローディング状態になる
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

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    const btnWhole = document.getElementById('btnExplainWhole') as HTMLButtonElement;
    const btnSel = document.getElementById('btnExplainSelection') as HTMLButtonElement;
    btnWhole.click();
    await flush(5);

    expect(btnWhole.disabled).toBe(true);
    expect(btnSel.disabled).toBe(true);

    // 完了させる
    resolveExplain({ text: 'done' });
    await flush(10);
    expect(btnWhole.disabled).toBe(false);
  });
});

describe('Explain selection only（F-004）', () => {
  it('選択テキストがある場合はそのテキストでExplainが実行される', async () => {
    // GET_SELECTED_TEXT の後、GET_PAGE_CONTENT も取得する（F-301）
    // tabs.sendMessage を順次呼び出すためにモックを順番に返す
    const longSelected = 'Selected paragraph text that is long enough to bypass the warning.';
    const pageContent = 'Page body context for the selection.';
    let sendMessageCallCount = 0;
    (mock as unknown as {
      tabs: { sendMessage: ReturnType<typeof vi.fn> };
    }).tabs.sendMessage = vi.fn(() => {
      sendMessageCallCount++;
      if (sendMessageCallCount === 1) {
        // 1回目: GET_SELECTED_TEXT
        return Promise.resolve({ selectedText: longSelected });
      }
      // 2回目: GET_PAGE_CONTENT
      return Promise.resolve({
        url: 'https://example.com',
        content: pageContent,
        truncated: false,
        originalLength: pageContent.length,
      });
    });
    (globalThis as unknown as { chrome: typeof mock }).chrome = mock;

    mock.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ text: 'Explanation of selected text.' })
    );

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const result = document.getElementById('explainResult')!;
    expect(result.classList.contains('hidden')).toBe(false);
    expect(result.textContent).toContain('Explanation of selected text.');

    // EXPLAIN メッセージが選択モードで selectionText を含むことを確認（F-301）
    const explainCall = mock.runtime.sendMessage.mock.calls[0];
    const explainMsg = explainCall[0] as { type: string; mode: string; selectionText: string };
    expect(explainMsg.type).toBe('EXPLAIN');
    expect(explainMsg.mode).toBe('selection');
    expect(explainMsg.selectionText).toContain(longSelected);
  });

  it('選択が空の場合はエラーメッセージが表示される（F-004）', async () => {
    setupTabsSendMessage({ selectedText: '' });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'explanation' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const error = document.getElementById('explainError')!;
    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toMatch(/no text is selected/i);
  });
});

describe('resetExplain', () => {
  it('resetExplain で結果・エラー・通知がクリアされる', async () => {
    // 結果を表示した後にリセット
    document.getElementById('explainResult')!.textContent = 'Some result';
    document.getElementById('explainResult')!.classList.remove('hidden');
    document.getElementById('explainError')!.textContent = 'Error msg';
    document.getElementById('explainError')!.classList.remove('hidden');
    document.getElementById('truncatedNotice')!.classList.remove('hidden');

    const { resetExplain } = await import('../src/sidepanel/explain.js');
    resetExplain();

    expect(document.getElementById('explainResult')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('explainError')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('truncatedNotice')!.classList.contains('hidden')).toBe(true);
  });
});
