// F-203 短文警告 UI / F-204 短文プロンプトの統合テスト
// - 抽出結果 40 文字未満で警告 UI が表示される
// - Run anyway で API 呼び出しに進む（送信されること）
// - Cancel で API 呼び出しが発生しない
// - background EXPLAIN ハンドラが入力長で system prompt を切り替える

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

/** Explain タブに必要なDOM要素をセットアップ（短文警告要素を含む） */
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

// ----------------------------------------------------------------
// F-203: 短文警告 UI
// ----------------------------------------------------------------
describe('F-203: 短文警告 UI（ページ全体 Explain）', () => {
  it('抽出結果が 40 文字未満のとき shortContentWarning が表示される', async () => {
    // 39文字のコンテンツ（< 40 閾値）
    const shortContent = 'A'.repeat(39);
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: 39,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
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

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('Run anyway を押すと API 呼び出しが行われ結果が表示される', async () => {
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

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
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
    // 結果が表示された
    const result = document.getElementById('explainResult')!;
    expect(result.classList.contains('hidden')).toBe(false);
    expect(result.textContent).toContain('Explanation of the word notable.');
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

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
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
    // 結果も表示されない
    const result = document.getElementById('explainResult')!;
    expect(result.classList.contains('hidden')).toBe(true);
  });

  it('警告ブロックに role="alert" 相当の通知構造がある（アクセシビリティ）', () => {
    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.getAttribute('role')).toBe('alert');
  });
});

// F-303: 選択モードでは F-203 の短文警告を抑止する
// 選択テキストとページ本文の両方をモックするヘルパー
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

describe('F-303: 選択モードでは短文警告 UI を抑止する（上書き仕様）', () => {
  it('選択テキストが 40 文字未満でも shortContentWarning が表示されない（F-303）', async () => {
    const shortSelected = 'short text';
    setupTabsSendMessageForSelection(shortSelected, 'Page body context here.');
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
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

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });

  it('選択テキストが 40 文字以上のときも警告が表示されない（変化なし）', async () => {
    const longSelected = 'This selection is long enough to avoid the short content warning threshold.';
    setupTabsSendMessageForSelection(longSelected, 'Page body content.');
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    (document.getElementById('btnExplainSelection') as HTMLButtonElement).click();
    await flush(20);

    const warning = document.getElementById('shortContentWarning')!;
    expect(warning.classList.contains('hidden')).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------
// F-204: 短文プロンプト（background EXPLAIN ハンドラ）
// ----------------------------------------------------------------
describe('F-204: background EXPLAIN ハンドラ: 短文 vs 通常プロンプト切り替え', () => {
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

  it('入力が 40 文字未満のとき短文用プロンプト文言が system に含まれる', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    // "notable" = 7文字 < 40
    await callListener({ type: 'EXPLAIN', content: 'notable' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    // 短文プロンプトには "short word" や "usage" の文言が含まれる
    expect(body.system).toContain('short word');
  });

  it('入力が 40 文字以上のとき通常プロンプトが使われ短文用文言は含まれない', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    const longContent = 'A'.repeat(40);
    await callListener({ type: 'EXPLAIN', content: longContent });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    // 通常プロンプトには "web page content" の文言が含まれる
    expect(body.system).toContain('web page content');
    // 短文プロンプト固有の文言は含まれない
    expect(body.system).not.toContain('short word');
  });

  it('短文入力 + outputLanguage="ja" のとき短文用プロンプトが日本語対応になる', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await callListener({ type: 'EXPLAIN', content: 'notable' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    expect(body.system).toContain('Japanese');
    expect(body.system).toContain('short word');
  });

  it('通常長入力 + outputLanguage="ja" のとき通常プロンプトが日本語対応になる', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    const longContent = 'B'.repeat(40);
    await callListener({ type: 'EXPLAIN', content: longContent });
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
// [HIGH] Codex 指摘修正: TAB_CHANGED リセット後に古い短文警告ボタンが発火しない
// AbortController によるリスナークリーンアップの検証
// ----------------------------------------------------------------
describe('[HIGH] AbortController: resetExplain 後に古いリスナーが発火しない（F-203）', () => {
  it('resetExplain 後に btnRunAnyway を click しても API 呼び出しが起きない', async () => {
    const shortContent = 'notable';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initExplain, resetExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    // 短文警告を表示させる
    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);

    // 警告が出ていることを確認
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();

    // TAB_CHANGED 相当: resetExplain を呼ぶ
    resetExplain();

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

    const { initExplain, resetExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    // 1回目: 短文警告を表示
    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);

    // Cancel（または reset）で1回目の警告を解消せず、2回目の Explain を起動
    resetExplain();
    await flush(5);

    // DOM を再設定してから2回目の Explain を起動
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);

    // 2回目の Run anyway を押す
    (document.getElementById('btnRunAnyway') as HTMLButtonElement).click();
    await flush(20);

    // API は1回だけ呼ばれる（古いリスナーが発火しない）
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });
});

// ----------------------------------------------------------------
// [HIGH] Codex 再レビュー指摘修正: Run anyway / Cancel 解決パスでのリスナークリーンアップ
// 通常の Run/Cancel 解決後に古いハンドラが DOM に残らないことを検証する
// ----------------------------------------------------------------
describe('[HIGH] Codex 再レビュー: Run anyway / Cancel 解決パスのリスナークリーンアップ', () => {
  it('短文警告→Run anyway→再度短文警告→Run anyway で API が各回 1 回だけ呼ばれる', async () => {
    const shortContent = 'notable';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    // 1回目: 短文警告 → Run anyway
    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
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
    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);

    (document.getElementById('btnRunAnyway') as HTMLButtonElement).click();
    await flush(20);

    // 2回目の API 呼び出しが追加で 1 回（合計 2 回）
    // 古いハンドラが残っていた場合は 3 回以上になる
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

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();

    // 1回目: 短文警告 → Cancel
    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
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
    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);
    expect(document.getElementById('shortContentWarning')!.classList.contains('hidden')).toBe(false);

    (document.getElementById('btnRunAnyway') as HTMLButtonElement).click();
    await flush(20);

    // API は 1 回だけ呼ばれる（ステイルハンドラが発火しない）
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('連続した短文警告で btnRunAnyway への addEventListener 呼び出し数が増えない', async () => {
    const shortContent = 'notable';
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ text: 'result' }));

    // addEventListener をスパイして呼び出し回数を記録する
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    const addEventListenerSpy = vi.spyOn(EventTarget.prototype, 'addEventListener');

    const { initExplain } = await import('../src/sidepanel/explain.js');
    initExplain();
    // initExplain 自体の addEventListener 呼び出しをリセット
    addEventListenerSpy.mockClear();

    // 1回目: 短文警告表示（btnRunAnyway に click リスナーが 1 回登録される）
    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);
    const callsAfterFirst = addEventListenerSpy.mock.calls.filter(
      ([type]) => type === 'click'
    ).length;

    // Run anyway で解決
    (document.getElementById('btnRunAnyway') as HTMLButtonElement).click();
    await flush(20);
    addEventListenerSpy.mockClear();

    // 2回目: 再度短文警告（btnRunAnyway への click リスナーは再び 1 回だけ登録される）
    setupTabsSendMessage({
      url: 'https://example.com',
      content: shortContent,
      truncated: false,
      originalLength: shortContent.length,
    });
    (document.getElementById('btnExplainWhole') as HTMLButtonElement).click();
    await flush(20);
    const callsAfterSecond = addEventListenerSpy.mock.calls.filter(
      ([type]) => type === 'click'
    ).length;

    // 2回目の短文警告で登録される click リスナー数が 1回目と同じ（増えていない）
    expect(callsAfterSecond).toBe(callsAfterFirst);

    // スパイを元に戻す
    addEventListenerSpy.mockRestore();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void originalAddEventListener;
  });
});
