// F-503: background の FLOATING_EXPLAIN_REQUEST / SIDE_PANEL_READY / TAB_CHANGED pending クリアのテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

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

/** background が登録した tabs.onUpdated リスナーを呼び出すヘルパー */
function callOnUpdated(
  tabId: number,
  changeInfo: Record<string, unknown>,
  tab: Record<string, unknown>,
): void {
  const listener = mock.tabs.onUpdated._listeners[0] as
    | ((tabId: number, changeInfo: unknown, tab: unknown) => void)
    | undefined;
  if (listener) listener(tabId, changeInfo, tab);
}

describe('background F-503: FLOATING_EXPLAIN_REQUEST', () => {
  it('FLOATING_EXPLAIN_REQUEST で chrome.sidePanel.open が呼ばれる', async () => {
    const result = await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'hello world' },
      { tab: { id: 99 } },
    );

    expect(mock.sidePanel.open).toHaveBeenCalledWith({ tabId: 99 });
    expect(result).toEqual({ ok: true });
  });

  it('FLOATING_EXPLAIN_REQUEST 後に SIDE_PANEL_READY を受け取ると pending が返される（broadcast 失敗時）', async () => {
    // broadcast が失敗する = Side Panel がまだ開いていない状態をシミュレート
    // この場合のみ pending が立ち、SIDE_PANEL_READY で flush される
    mock.runtime.sendMessage = vi.fn(() => Promise.reject(new Error('Could not establish connection')));

    // pending をセット（chromeMock の tabs.query が返す id=1 に合わせる）
    await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'test selection' },
      { tab: { id: 1 } },
    );

    // Side Panel が準備完了を通知（sender.tab は undefined が通常だが、ここでは activeTab で解決される）
    const readyResp = (await callListener(
      { type: 'SIDE_PANEL_READY' },
      {}, // sender.tab なし（Side Panel から送るため）
    )) as { pending: { actionId: string; selectionText: string } | null };

    expect(readyResp.pending).not.toBeNull();
    expect(readyResp.pending?.actionId).toBe('qaExplainSelection');
    expect(readyResp.pending?.selectionText).toBe('test selection');
  });

  it('SIDE_PANEL_READY の 2 回目呼び出し時には pending が null になっている（クリア確認）', async () => {
    // broadcast が失敗する場合のみ pending が立つ
    mock.runtime.sendMessage = vi.fn(() => Promise.reject(new Error('Could not establish connection')));

    // pending をセット（chromeMock の tabs.query が返す id=1 に合わせる）
    await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'test selection' },
      { tab: { id: 1 } },
    );

    // 1 回目: pending を取得
    await callListener({ type: 'SIDE_PANEL_READY' }, {});

    // 2 回目: pending はクリア済みのはず
    const secondResp = (await callListener(
      { type: 'SIDE_PANEL_READY' },
      {},
    )) as { pending: null };

    expect(secondResp.pending).toBeNull();
  });

  it('FLOATING_EXPLAIN_REQUEST はタブ ID なし sender では error を返す', async () => {
    const result = (await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'text' },
      {}, // tab なし
    )) as { error: string };

    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });
});

describe('background F-503: TAB_CHANGED で pending クリア', () => {
  it('TAB_CHANGED（onUpdated）発火で該当タブの pending がクリアされる', async () => {
    // pending をセット（タブ ID 1）
    await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'tab1 selection' },
      { tab: { id: 1 } },
    );

    // タブ 1 で URL 変化が発生
    // sendMessage は内部で呼ばれるためスパイを設定
    vi.spyOn(mock.runtime, 'sendMessage').mockResolvedValue({ ok: true });
    callOnUpdated(1, { url: 'https://new-page.example.com' }, {
      id: 1,
      active: true,
      url: 'https://new-page.example.com',
    });

    // 少し待つ（broadcastTabChanged は同期処理で pendingQuickAction.delete を呼ぶ）
    await Promise.resolve();

    // SIDE_PANEL_READY を送っても pending が null であることを確認
    // ただし tabs.query が id=1 を返すようにセットする
    mock.tabs.query = vi.fn(() =>
      Promise.resolve([{ id: 1, url: 'https://new-page.example.com', windowId: 10, active: true }]),
    );

    const readyResp = (await callListener(
      { type: 'SIDE_PANEL_READY' },
      {},
    )) as { pending: null };

    expect(readyResp.pending).toBeNull();
  });
});

describe('background F-503: FLOATING_EXPLAIN_REQUEST の重複上書き', () => {
  it('2 回 FLOATING_EXPLAIN_REQUEST が来た場合は最新の selectionText で上書きされる（broadcast 失敗時）', async () => {
    // broadcast が失敗する = Side Panel がまだ開いていない状態
    mock.runtime.sendMessage = vi.fn(() => Promise.reject(new Error('no connection')));

    // chromeMock の tabs.query が返す id=1 を使う
    await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'first selection' },
      { tab: { id: 1 } },
    );
    await callListener(
      { type: 'FLOATING_EXPLAIN_REQUEST', selectionText: 'second selection' },
      { tab: { id: 1 } },
    );

    const readyResp = (await callListener(
      { type: 'SIDE_PANEL_READY' },
      {},
    )) as { pending: { selectionText: string } | null };

    expect(readyResp.pending?.selectionText).toBe('second selection');
  });
});
