// 選択時の自動解説（ページ上のポップアップ）を Side Panel の Chat にも投稿する機能のテスト
// content → background → sidepanel の各層と、Explain ボタンの経路切り替えを検証する

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

/** Promise キューを複数回フラッシュするヘルパー */
async function flush(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/** chrome.runtime.sendMessage に送られた指定タイプのメッセージ一覧 */
function callsOf(type: string): Array<Record<string, unknown>> {
  return mock.runtime.sendMessage.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((m) => m?.['type'] === type);
}

// ----------------------------------------------------------------
// content script
// ----------------------------------------------------------------
describe('content: ポップアップ解説の Chat 投稿と Explain ボタンの経路', () => {
  /** window.getSelection() をモックして指定テキストが選択された状態を再現する */
  function mockSelection(text: string): void {
    const range = {
      getBoundingClientRect: () => ({
        left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20, x: 100, y: 100, toJSON: () => ({}),
      }),
    };
    const sel = {
      toString: () => text,
      isCollapsed: text.length === 0,
      anchorNode: document.body,
      focusNode: document.body,
      rangeCount: 0,
      getRangeAt: () => range,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue(sel as unknown as Selection);
  }

  function getExplainBtn(): HTMLButtonElement {
    const btn = document.getElementById('browser-ai-floating-host')?.shadowRoot?.querySelector('#explainBtn');
    if (!btn) throw new Error('Explain ボタンが見つからない');
    return btn as HTMLButtonElement;
  }

  /** 選択してデバウンスを経過させ、自動解説の送信とその後処理を流す */
  async function selectAndSettle(text: string): Promise<void> {
    mockSelection(text);
    document.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(100);
    await flush();
  }

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

  it('自動解説が成功したら FLOATING_EXPLAIN_RESULT で選択テキスト（trim 済み）と解説を送る', async () => {
    mock.runtime.sendMessage.mockResolvedValue({ text: 'An explanation.' });
    await selectAndSettle('  selected phrase  ');

    expect(callsOf('FLOATING_EXPLAIN_RESULT')).toEqual([
      { type: 'FLOATING_EXPLAIN_RESULT', selectionText: 'selected phrase', explanation: 'An explanation.' },
    ]);
  });

  it('自動解説の開始時に、結果を待たず Explain ボタンと同じく Side Panel を開く（OPEN_SIDE_PANEL）', async () => {
    // CHAT の回答を返さないままにする: 回答前に OPEN_SIDE_PANEL が送られていること（ユーザー操作の有効期間内に開く）
    mock.runtime.sendMessage.mockImplementation((msg: unknown) => {
      if ((msg as { type: string }).type === 'CHAT') return new Promise(() => {});
      return Promise.resolve({ ok: true });
    });
    await selectAndSettle('opening text');

    const types = mock.runtime.sendMessage.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toEqual(['OPEN_SIDE_PANEL', 'CHAT']);
  });

  it('自動解説が失敗したら FLOATING_EXPLAIN_RESULT は送らない', async () => {
    mock.runtime.sendMessage.mockResolvedValue({ error: 'API error' });
    await selectAndSettle('some text');

    expect(callsOf('FLOATING_EXPLAIN_RESULT')).toHaveLength(0);
  });

  it('回答が返る前に別の選択が始まった場合、古い回答は Chat に投稿しない', async () => {
    let resolveFirst!: (v: unknown) => void;
    let chatCalls = 0;
    mock.runtime.sendMessage.mockImplementation((msg: unknown) => {
      if ((msg as { type: string }).type !== 'CHAT') return Promise.resolve({ ok: true });
      // 最初の CHAT だけ回答を保留する
      if (++chatCalls === 1) return new Promise((r) => { resolveFirst = r; });
      return Promise.resolve({ text: 'Second.' });
    });
    await selectAndSettle('first selection');
    await selectAndSettle('second selection');

    resolveFirst({ text: 'First (late).' });
    await flush();

    expect(callsOf('FLOATING_EXPLAIN_RESULT').map((m) => m['explanation'])).toEqual(['Second.']);
  });

  it('解説済みの選択で Explain を押すと、解説本文つきの FLOATING_EXPLAIN_REQUEST を送る', async () => {
    mock.runtime.sendMessage.mockResolvedValue({ text: 'Done explanation.' });
    await selectAndSettle('explained text');

    getExplainBtn().click();
    await flush();

    expect(callsOf('FLOATING_EXPLAIN_REQUEST')).toEqual([
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'explained text', explanation: 'Done explanation.' },
    ]);
    // OPEN_SIDE_PANEL は自動解説の開始時の 1 回だけ（Explain 押下では解説つきリクエストが Side Panel を開く）
    expect(callsOf('OPEN_SIDE_PANEL')).toHaveLength(1);
  });

  it('生成中に Explain を押すと Side Panel を開くだけにし、完了後は FLOATING_EXPLAIN_RESULT で届ける', async () => {
    let resolveChat!: (v: unknown) => void;
    mock.runtime.sendMessage.mockImplementation((msg: unknown) => {
      if ((msg as { type: string }).type === 'CHAT') return new Promise((r) => { resolveChat = r; });
      return Promise.resolve({ ok: true });
    });
    await selectAndSettle('pending text');

    expect(callsOf('OPEN_SIDE_PANEL')).toHaveLength(1); // 自動解説の開始時
    getExplainBtn().click();
    await flush();
    expect(callsOf('OPEN_SIDE_PANEL')).toHaveLength(2); // Explain 押下で改めて開く
    expect(callsOf('FLOATING_EXPLAIN_REQUEST')).toHaveLength(0);

    resolveChat({ text: 'Late explanation.' });
    await flush();
    expect(callsOf('FLOATING_EXPLAIN_RESULT')).toEqual([
      { type: 'FLOATING_EXPLAIN_RESULT', selectionText: 'pending text', explanation: 'Late explanation.' },
    ]);
    // Side Panel 側で解説をやり直さない（二重 API 呼び出しなし）
    expect(callsOf('FLOATING_EXPLAIN_REQUEST')).toHaveLength(0);
  });

  it('生成中に Explain を押して解説が失敗したら、Side Panel 側で解説をやり直す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectChat!: (e: unknown) => void;
    mock.runtime.sendMessage.mockImplementation((msg: unknown) => {
      if ((msg as { type: string }).type === 'CHAT') return new Promise((_, rej) => { rejectChat = rej; });
      return Promise.resolve({ ok: true });
    });
    await selectAndSettle('failing text');

    getExplainBtn().click();
    await flush();
    expect(callsOf('OPEN_SIDE_PANEL')).toHaveLength(2); // 自動解説の開始時 + Explain 押下

    rejectChat(new Error('network down'));
    await flush();
    expect(callsOf('FLOATING_EXPLAIN_REQUEST')).toEqual([
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'failing text' },
    ]);
    expect(callsOf('FLOATING_EXPLAIN_RESULT')).toHaveLength(0);
  });

  it('自動解説が失敗した選択で Explain を押すと、従来どおり解説なしの FLOATING_EXPLAIN_REQUEST を送る', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mock.runtime.sendMessage.mockResolvedValue({ error: 'API key missing' });
    await selectAndSettle('errored text');

    getExplainBtn().click();
    await flush();

    expect(callsOf('FLOATING_EXPLAIN_REQUEST')).toEqual([
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'errored text' },
    ]);
  });
});

// ----------------------------------------------------------------
// background
// ----------------------------------------------------------------
describe('background: FLOATING_EXPLAIN_RESULT と解説つき FLOATING_EXPLAIN_REQUEST', () => {
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
        (m: unknown, s: unknown, sr: (r: unknown) => void) => boolean | void;
      listener(message, sender, (response: unknown) => resolve(response));
    });
  }

  const result = { type: 'FLOATING_EXPLAIN_RESULT', selectionText: 'word', explanation: 'Means X.' };
  const expectedBroadcast = { type: 'EXPLAIN_RESULT', selectionText: 'word', explanation: 'Means X.' };
  const expectedPending = { kind: 'exchange', selectionText: 'word', explanation: 'Means X.' };

  it('Side Panel が開いていれば EXPLAIN_RESULT を broadcast し、Side Panel は開かず pending も立てない', async () => {
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve(undefined));

    const res = (await callListener(result, { tab: { id: 1 } })) as { delivered: boolean };

    expect(res.delivered).toBe(true);
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith(expectedBroadcast);
    expect(mock.sidePanel.open).not.toHaveBeenCalled();
    const ready = (await callListener({ type: 'SIDE_PANEL_READY' }, {})) as { pending: unknown };
    expect(ready.pending).toBeNull();
  });

  it('Side Panel が閉じていれば pending(exchange) として保持し、SIDE_PANEL_READY で 1 回だけ返す', async () => {
    mock.runtime.sendMessage = vi.fn(() => Promise.reject(new Error('Could not establish connection')));

    const res = (await callListener(result, { tab: { id: 1 } })) as { delivered: boolean };
    expect(res.delivered).toBe(false);

    const first = (await callListener({ type: 'SIDE_PANEL_READY' }, {})) as { pending: unknown };
    expect(first.pending).toEqual(expectedPending);
    const second = (await callListener({ type: 'SIDE_PANEL_READY' }, {})) as { pending: unknown };
    expect(second.pending).toBeNull();
  });

  it('pending は直近 1 件だけ保持する（後から来た解説で上書き）', async () => {
    mock.runtime.sendMessage = vi.fn(() => Promise.reject(new Error('no connection')));

    await callListener(result, { tab: { id: 1 } });
    await callListener(
      { type: 'FLOATING_EXPLAIN_RESULT', selectionText: 'newer', explanation: 'Newer.' },
      { tab: { id: 1 } },
    );

    const ready = (await callListener({ type: 'SIDE_PANEL_READY' }, {})) as { pending: unknown };
    expect(ready.pending).toEqual({ kind: 'exchange', selectionText: 'newer', explanation: 'Newer.' });
  });

  it('解説つき FLOATING_EXPLAIN_REQUEST は Side Panel を開いて EXPLAIN_RESULT を送り、クイックアクションは自動実行しない', async () => {
    mock.runtime.sendMessage = vi.fn(() => Promise.resolve(undefined));

    const res = await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'word', explanation: 'Means X.' },
      { tab: { id: 7 } },
    );

    expect(res).toEqual({ ok: true });
    expect(mock.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith(expectedBroadcast);
    expect(mock.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'QUICK_ACTION_AUTORUN' }));
  });

  it('解説つき FLOATING_EXPLAIN_REQUEST で Side Panel が未起動なら pending(exchange) になる', async () => {
    mock.runtime.sendMessage = vi.fn(() => Promise.reject(new Error('no connection')));

    await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'word', explanation: 'Means X.' },
      { tab: { id: 1 } },
    );

    const ready = (await callListener({ type: 'SIDE_PANEL_READY' }, {})) as { pending: unknown };
    expect(ready.pending).toEqual(expectedPending);
  });

  it('解説なしの FLOATING_EXPLAIN_REQUEST は従来どおり pending(autorun) になる', async () => {
    mock.runtime.sendMessage = vi.fn(() => Promise.reject(new Error('no connection')));

    await callListener({ type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'word' }, { tab: { id: 1 } });

    const ready = (await callListener({ type: 'SIDE_PANEL_READY' }, {})) as { pending: unknown };
    expect(ready.pending).toEqual({ kind: 'autorun', actionId: 'qaExplainSelection', selectionText: 'word' });
  });
});

// ----------------------------------------------------------------
// sidepanel/chat.ts
// ----------------------------------------------------------------
describe('chat: appendSelectionExchange', () => {
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

  function userBubbles(): string[] {
    return Array.from(document.querySelectorAll('.chat-bubble--user .chat-bubble__body')).map((el) => el.textContent ?? '');
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

  it('user バブルに選択テキスト、assistant バブルに解説（Markdown）を表示し、履歴に 2 件積む', async () => {
    const { initChat, appendSelectionExchange, getChatHistory, getContextMode, getSelectionText } =
      await import('../src/sidepanel/chat.js');
    initChat();

    appendSelectionExchange('ubiquitous', '**Ubiquitous** means present everywhere.');

    expect(getChatHistory()).toEqual([
      { role: 'user', content: 'Explain: "ubiquitous"' },
      { role: 'assistant', content: '**Ubiquitous** means present everywhere.' },
    ]);
    expect(userBubbles()).toEqual(['Explain: "ubiquitous"']);
    const assistantBodies = document.querySelectorAll('.chat-bubble--assistant .chat-bubble__body');
    const last = assistantBodies[assistantBodies.length - 1];
    expect(last.querySelector('strong')?.textContent).toBe('Ubiquitous');
    // 以降の自由入力はこの選択を文脈にした follow-up になる
    expect(getContextMode()).toBe('selection');
    expect(getSelectionText()).toBe('ubiquitous');
  });

  it('同じ往復が直前にあれば二重に追加しない（broadcast と Explain ボタンの両方から届いた場合）', async () => {
    const { initChat, appendSelectionExchange, getChatHistory } = await import('../src/sidepanel/chat.js');
    initChat();

    appendSelectionExchange('word', 'Means X.');
    appendSelectionExchange('word', 'Means X.');

    expect(getChatHistory()).toHaveLength(2);
    expect(userBubbles()).toEqual(['Explain: "word"']);
  });

  it('同じ選択でも解説が違えば追加する', async () => {
    const { initChat, appendSelectionExchange, getChatHistory } = await import('../src/sidepanel/chat.js');
    initChat();

    appendSelectionExchange('word', 'Means X.');
    appendSelectionExchange('word', 'Means Y.');

    expect(getChatHistory()).toHaveLength(4);
  });

  it('長い選択テキストは user バブルでは切り詰め、follow-up 用の選択テキストは全文を保持する', async () => {
    const { initChat, appendSelectionExchange, getChatHistory, getSelectionText } = await import('../src/sidepanel/chat.js');
    initChat();
    const long = 'a'.repeat(400);

    appendSelectionExchange(long, 'Long explanation.');

    const shown = getChatHistory()[0].content;
    expect(shown.startsWith('Explain: "')).toBe(true);
    expect(shown.endsWith('…"')).toBe(true);
    expect(shown.length).toBe('Explain: ""'.length + 300);
    expect(getSelectionText()).toBe(long);
  });

  it('空の選択や解説は無視する', async () => {
    const { initChat, appendSelectionExchange, getChatHistory } = await import('../src/sidepanel/chat.js');
    initChat();

    appendSelectionExchange('   ', 'Explanation.');
    appendSelectionExchange('word', '   ');

    expect(getChatHistory()).toHaveLength(0);
    expect(userBubbles()).toEqual([]);
  });

  it('投稿後の自由入力は、その選択を文脈にした follow-up として履歴つきで送られる', async () => {
    mock.tabs.sendMessage = vi.fn(() => Promise.resolve({ content: 'page content', truncated: false, originalLength: 12 }));
    const chatMessages: unknown[] = [];
    mock.runtime.sendMessage = vi.fn((msg: unknown) => {
      if ((msg as { type: string }).type === 'CHAT') {
        chatMessages.push(msg);
        return Promise.resolve({ text: 'Follow-up answer.' });
      }
      return Promise.resolve({ ok: true });
    });
    const { initChat, appendSelectionExchange } = await import('../src/sidepanel/chat.js');
    initChat();
    appendSelectionExchange('ubiquitous', 'Means everywhere.');

    (document.getElementById('chatInput') as HTMLTextAreaElement).value = 'Give me an example.';
    document.getElementById('btnChatSend')!.click();
    await flush(20);

    expect(chatMessages).toHaveLength(1);
    const sent = chatMessages[0] as { userMessage: string; history: unknown[] };
    expect(sent.userMessage).toContain(
      'User question about the selection "<selection>ubiquitous</selection>": Give me an example.',
    );
    expect(sent.history).toEqual([
      { role: 'user', content: 'Explain: "ubiquitous"' },
      { role: 'assistant', content: 'Means everywhere.' },
    ]);
  });

  it('resetChat で投稿した往復も消える', async () => {
    const { initChat, appendSelectionExchange, resetChat, getChatHistory, getContextMode } =
      await import('../src/sidepanel/chat.js');
    initChat();
    appendSelectionExchange('word', 'Means X.');

    resetChat();

    expect(getChatHistory()).toHaveLength(0);
    expect(getContextMode()).toBeNull();
    expect(userBubbles()).toEqual([]);
  });
});

// ----------------------------------------------------------------
// sidepanel/index.ts
// ----------------------------------------------------------------
describe('sidepanel: EXPLAIN_RESULT の受信と pending(exchange) の flush', () => {
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
      <button id="qaExplainSelection">Explain selection</button>
    `;
  }

  function bubbleTexts(selector: string): string[] {
    return Array.from(document.querySelectorAll(`${selector} .chat-bubble__body`)).map((el) => el.textContent ?? '');
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

  it('EXPLAIN_RESULT を受け取ると API を呼ばずに Chat へ往復を追加する', async () => {
    const chatCalls: unknown[] = [];
    mock.runtime.sendMessage = vi.fn((msg: unknown) => {
      const m = msg as { type: string };
      if (m.type === 'SIDE_PANEL_READY') return Promise.resolve({ pending: null });
      if (m.type === 'CHAT') chatCalls.push(msg);
      return Promise.resolve({ ok: true });
    });
    await import('../src/sidepanel/index.js');
    await flush();

    const listener = mock.runtime.onMessage._listeners[0] as (m: unknown) => void;
    listener({ type: 'EXPLAIN_RESULT', selectionText: 'word', explanation: 'Means X.' });
    await flush();

    expect(chatCalls).toHaveLength(0);
    expect(bubbleTexts('.chat-bubble--user')).toEqual(['Explain: "word"']);
    expect(bubbleTexts('.chat-bubble--assistant')).toContain('Means X.');
  });

  it('SIDE_PANEL_READY の pending が exchange なら API を呼ばずに Chat へ追加する', async () => {
    const chatCalls: unknown[] = [];
    mock.runtime.sendMessage = vi.fn((msg: unknown) => {
      const m = msg as { type: string };
      if (m.type === 'SIDE_PANEL_READY') {
        return Promise.resolve({ pending: { kind: 'exchange', selectionText: 'word', explanation: 'Means X.' } });
      }
      if (m.type === 'CHAT') chatCalls.push(msg);
      return Promise.resolve({ ok: true });
    });
    await import('../src/sidepanel/index.js');
    await flush(20);

    expect(chatCalls).toHaveLength(0);
    expect(bubbleTexts('.chat-bubble--user')).toEqual(['Explain: "word"']);
    expect(bubbleTexts('.chat-bubble--assistant')).toContain('Means X.');
  });
});
