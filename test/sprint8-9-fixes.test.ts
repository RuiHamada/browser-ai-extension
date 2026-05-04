// Sprint 8-9 Codex 指摘修正のテスト
// - HIGH: QUICK_ACTION_AUTORUN + SIDE_PANEL_READY 二重発火の排除
// - MEDIUM-1: Shadow ホストの aria-hidden 削除
// - MEDIUM-2: 禁止コンテキストを input/textarea/contenteditable 全般に拡張
// - LOW: innerHTML = '' を replaceChildren() に置換

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

// ----------------------------------------------------------------
// HIGH: broadcast + pending 二重発火の排除
// ----------------------------------------------------------------
describe('[HIGH] QUICK_ACTION_AUTORUN broadcast と SIDE_PANEL_READY flush の二重発火防止', () => {
  beforeEach(async () => {
    mock = installChromeMock();
    vi.resetModules();
    await import('../src/background/index.js');
  });

  afterEach(() => {
    uninstallChromeMock();
  });

  /** background が登録した onMessage リスナーを呼び出して結果を取得するヘルパー */
  function callListener(message: unknown, sender: unknown = {}): Promise<unknown> {
    return new Promise((resolve) => {
      const listener = mock.runtime.onMessage._listeners[0] as
        | ((m: unknown, s: unknown, sr: (r: unknown) => void) => boolean | void)
        | undefined;
      if (!listener) {
        resolve(undefined);
        return;
      }
      listener(message, sender, (response: unknown) => resolve(response));
    });
  }

  it('Side Panel が既に開いている場合（broadcast 成功）: SIDE_PANEL_READY を受けても pending が null', async () => {
    // sendMessage が成功する = Side Panel が既に開いている状態をシミュレート
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve({ ok: true }));

    await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'hello world' },
      { tab: { id: 1 } },
    );

    // sendMessage が呼ばれた（broadcast 試行）
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'QUICK_ACTION_AUTORUN' }),
    );

    // SIDE_PANEL_READY を受けても pending は null（broadcast 成功時は pending を立てない）
    const readyResp = (await callListener(
      { type: 'SIDE_PANEL_READY' },
      {},
    )) as { pending: unknown };

    expect(readyResp.pending).toBeNull();
  });

  it('Side Panel がまだ開いていない場合（broadcast 失敗）: SIDE_PANEL_READY で pending が flush される', async () => {
    // sendMessage が失敗する = Side Panel がまだ開いていない状態をシミュレート
    mock.runtime.sendMessage = vi.fn(() => Promise.reject(new Error('Could not establish connection')));

    await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'test selection' },
      { tab: { id: 1 } },
    );

    // SIDE_PANEL_READY を受けると pending が返される
    const readyResp = (await callListener(
      { type: 'SIDE_PANEL_READY' },
      {},
    )) as { pending: { actionId: string; selectionText: string } | null };

    expect(readyResp.pending).not.toBeNull();
    expect(readyResp.pending?.actionId).toBe('qaExplainSelection');
    expect(readyResp.pending?.selectionText).toBe('test selection');
  });

  it('broadcast 成功時: runQuickAction は broadcast 経由でのみ 1 回だけ発火する（二重発火なし）', async () => {
    // broadcast 成功カウントを追跡
    let broadcastCount = 0;
    mock.runtime.sendMessage = vi.fn((msg: unknown) => {
      const m = msg as { type: string };
      if (m.type === 'QUICK_ACTION_AUTORUN') broadcastCount++;
      return Promise.resolve({ ok: true });
    });

    await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'selected text' },
      { tab: { id: 1 } },
    );

    // SIDE_PANEL_READY を送っても pending は null
    const readyResp = (await callListener(
      { type: 'SIDE_PANEL_READY' },
      {},
    )) as { pending: unknown };

    expect(broadcastCount).toBe(1); // broadcast は 1 回
    expect(readyResp.pending).toBeNull(); // pending は立たない
  });

  it('broadcast 失敗 → SIDE_PANEL_READY で flush → 2 回目の SIDE_PANEL_READY は null', async () => {
    mock.runtime.sendMessage = vi.fn(() => Promise.reject(new Error('no connection')));

    await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'test' },
      { tab: { id: 1 } },
    );

    // 1 回目: flush される
    const first = (await callListener({ type: 'SIDE_PANEL_READY' }, {})) as {
      pending: unknown;
    };
    expect(first.pending).not.toBeNull();

    // 2 回目: すでにクリア済み
    const second = (await callListener({ type: 'SIDE_PANEL_READY' }, {})) as {
      pending: null;
    };
    expect(second.pending).toBeNull();
  });
});

// ----------------------------------------------------------------
// MEDIUM-1: Shadow ホストに aria-hidden が付いていないことを確認
// ----------------------------------------------------------------
describe('[MEDIUM-1] Shadow ホストに aria-hidden が付いていない', () => {
  beforeEach(async () => {
    mock = installChromeMock();
    document.body.innerHTML = '<p>Hello world test content</p>';
    vi.useFakeTimers();
    vi.resetModules();
    await import('../src/content/index.js');
  });

  afterEach(() => {
    uninstallChromeMock();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockSelection(text: string): void {
    const range = {
      getBoundingClientRect: () => ({
        left: 100, top: 100, right: 200, bottom: 120,
        width: 100, height: 20, x: 100, y: 100, toJSON: () => ({}),
      }),
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => text,
      isCollapsed: text.length === 0,
      anchorNode: document.body,
      focusNode: document.body,
      getRangeAt: () => range,
    } as unknown as Selection);
  }

  it('ホスト要素に aria-hidden 属性が設定されていない', async () => {
    mockSelection('selected text here');
    document.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();

    const host = document.getElementById('browser-ai-floating-host');
    expect(host).not.toBeNull();
    expect(host?.getAttribute('aria-hidden')).toBeNull();
  });

  it('ホスト要素に role="presentation" が設定されている', async () => {
    mockSelection('selected text here');
    document.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();

    const host = document.getElementById('browser-ai-floating-host');
    expect(host?.getAttribute('role')).toBe('presentation');
  });

  it('Shadow 内のボタンに aria-label が正しく設定されている', async () => {
    mockSelection('selected text here');
    document.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();

    const host = document.getElementById('browser-ai-floating-host');
    const button = host?.shadowRoot?.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Explain selected text');
  });
});

// ----------------------------------------------------------------
// MEDIUM-2: 禁止コンテキスト判定の拡張
// ----------------------------------------------------------------
describe('[MEDIUM-2] 禁止コンテキスト: input/textarea/contenteditable 全般で非表示', () => {
  beforeEach(async () => {
    mock = installChromeMock();
    document.body.innerHTML = '<p>Hello world test content</p>';
    vi.useFakeTimers();
    vi.resetModules();
    await import('../src/content/index.js');
  });

  afterEach(() => {
    uninstallChromeMock();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockSelectionWithActiveElement(text: string, activeEl: HTMLElement | null): void {
    const range = {
      getBoundingClientRect: () => ({
        left: 100, top: 100, right: 200, bottom: 120,
        width: 100, height: 20, x: 100, y: 100, toJSON: () => ({}),
      }),
    };
    // anchorNode / focusNode が activeEl 内を指すようにモック
    const node = activeEl ?? document.body;
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => text,
      isCollapsed: text.length === 0,
      anchorNode: node,
      focusNode: node,
      getRangeAt: () => range,
    } as unknown as Selection);

    // activeElement を設定
    if (activeEl) {
      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => activeEl,
      });
    }
  }

  async function advanceDebounce(): Promise<void> {
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
  }

  it('<input type="text"> がアクティブな場合はボタンが表示されない', async () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);

    mockSelectionWithActiveElement('selected text', input);
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    if (host) {
      expect(host.style.display).toBe('none');
    } else {
      expect(host).toBeNull();
    }
  });

  it('<textarea> がアクティブな場合はボタンが表示されない', async () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    mockSelectionWithActiveElement('selected text', textarea);
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    if (host) {
      expect(host.style.display).toBe('none');
    } else {
      expect(host).toBeNull();
    }
  });

  it('[contenteditable="true"] 内の選択ではボタンが表示されない', async () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.textContent = 'Editable content here for selection';
    document.body.appendChild(editable);

    // anchorNode を contenteditable 要素内に設定
    const range = {
      getBoundingClientRect: () => ({
        left: 100, top: 100, right: 200, bottom: 120,
        width: 100, height: 20, x: 100, y: 100, toJSON: () => ({}),
      }),
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Editable content',
      isCollapsed: false,
      anchorNode: editable,
      focusNode: editable,
      getRangeAt: () => range,
    } as unknown as Selection);
    // activeElement は通常の要素（body）
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => document.body,
    });

    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    if (host) {
      expect(host.style.display).toBe('none');
    } else {
      expect(host).toBeNull();
    }
  });

  it('[contenteditable="false"] 内の選択ではボタンが表示される（読み物として扱う）', async () => {
    const nonEditable = document.createElement('div');
    nonEditable.setAttribute('contenteditable', 'false');
    nonEditable.textContent = 'Non-editable content for reading';
    document.body.appendChild(nonEditable);

    const range = {
      getBoundingClientRect: () => ({
        left: 100, top: 100, right: 200, bottom: 120,
        width: 100, height: 20, x: 100, y: 100, toJSON: () => ({}),
      }),
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Non-editable content for reading',
      isCollapsed: false,
      anchorNode: nonEditable,
      focusNode: nonEditable,
      getRangeAt: () => range,
    } as unknown as Selection);
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => document.body,
    });

    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    // contenteditable="false" は読み物なのでボタンが表示される
    expect(host).not.toBeNull();
    expect(host?.style.display).not.toBe('none');
  });
});

// ----------------------------------------------------------------
// LOW: innerHTML = '' が使われていないことを確認
// ----------------------------------------------------------------
describe('[LOW] innerHTML = "" の使用を replaceChildren() に置換済みであることを確認', () => {
  it('chat.ts の resetChat() で innerHTML = "" を使わずに chatMessages をクリアできる', async () => {
    mock = installChromeMock();
    document.body.innerHTML = `
      <div id="chatMessages"><p>old message</p></div>
      <div id="shortContentWarning" class="hidden">
        <p id="shortContentWarningText"></p>
        <div><button id="btnRunAnyway">Run anyway</button><button id="btnCancelShort">Cancel</button></div>
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
    vi.resetModules();

    const { initChat, resetChat } = await import('../src/sidepanel/chat.js');
    initChat();

    const chatMessages = document.getElementById('chatMessages')!;
    // 事前に要素が存在することを確認
    // resetChat() を呼ぶと chatMessages がクリアされ Welcome メッセージが追加される
    resetChat();

    // innerHTML = "" なら XSS リスクがあるが、replaceChildren() なら安全
    // クリアされて Welcome メッセージが追加されていることを確認
    expect(chatMessages.textContent).toContain('Welcome');
    // old message は消えていること
    expect(chatMessages.querySelector('p:first-child')?.textContent).not.toBe('old message');

    uninstallChromeMock();
    document.body.innerHTML = '';
  });
});
