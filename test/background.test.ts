// background/index.ts のメッセージルータの単体テスト
// F-001 (APIキー保存→マスク表示), F-009 (サイドパネル起動), 非機能（APIキーをUIに平文露出しない）

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

beforeEach(async () => {
  mock = installChromeMock();
  // モジュールキャッシュをリセットして毎回新規にロードする（top-level の副作用を再実行させる）
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

/** background が登録した onUpdated リスナーを呼び出すヘルパー */
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

describe('background メッセージルータ', () => {
  it('起動時に sidePanel.setPanelBehavior を呼ぶ（F-009: アイコンクリックでパネルを開く）', () => {
    expect(mock.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('起動時に onMessage.addListener を呼ぶ', () => {
    expect(mock.runtime.onMessage.addListener).toHaveBeenCalled();
  });

  it('OPEN_SIDE_PANEL: 送信タブIDがあれば sidePanel.open を呼ぶ', async () => {
    const result = await callListener({ type: 'OPEN_SIDE_PANEL' }, { tab: { id: 42 } });
    expect(mock.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 });
    expect(result).toEqual({ ok: true });
  });

  it('OPEN_SIDE_PANEL: タブIDなしでもエラーにならない', async () => {
    const result = await callListener({ type: 'OPEN_SIDE_PANEL' }, {});
    expect(mock.sidePanel.open).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('SAVE_SETTINGS: chrome.storage.local に保存される', async () => {
    await callListener({ type: 'SAVE_SETTINGS', settings: { apiKey: 'sk-ant-secret-xxxxx', aiModel: 'claude-sonnet-5-5' } });
    expect(mock.storage.local._data['apiKey']).toBe('sk-ant-secret-xxxxx');
    expect(mock.storage.local._data['aiModel']).toBe('claude-sonnet-5-5');
    expect(mock.storage.sync.set).not.toHaveBeenCalled();
  });

  it('GET_SETTINGS: APIキーが伏字で返される（平文露出しない）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-api03-1234567890ABCDEF';
    mock.storage.local._data['aiModel'] = 'claude-haiku-4-5';
    const result = (await callListener({ type: 'GET_SETTINGS' })) as { apiKey: string; aiModel: string };
    expect(result.apiKey).not.toBe('sk-ant-api03-1234567890ABCDEF');
    expect(result.apiKey).toContain('****');
    // モデルはそのまま返す
    expect(result.aiModel).toBe('claude-haiku-4-5');
  });

  it('GET_SETTINGS: APIキー未設定時は空文字を返す（誘導用）', async () => {
    const result = (await callListener({ type: 'GET_SETTINGS' })) as { apiKey: string };
    expect(result.apiKey).toBe('');
  });

  it('console.error にAPIキーが出力されない（F-011: ログ経路での漏洩防止）', async () => {
    // fetch が sk-ant- を含む JSON 解析エラーを投げるケース
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new Error('Parse failed: sk-ant-api03-LOGKEY leaked')),
      } as Response)
    ) as typeof fetch;

    mock.storage.local._data['apiKey'] = 'sk-ant-api03-LOGKEY';
    mock.storage.local._data['aiModel'] = 'claude-haiku-4-5';

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await callListener({ type: 'EXPLAIN', content: 'test' });
      // console.error の第2引数以降に sk-ant- が含まれないことを確認
      for (const call of errorSpy.mock.calls) {
        const args = call.slice(1); // 第1引数（ラベル文字列）は除く
        for (const arg of args) {
          expect(String(arg)).not.toContain('sk-ant-api03-LOGKEY');
        }
      }
    } finally {
      errorSpy.mockRestore();
      globalThis.fetch = origFetch;
    }
  });

  // ----------------------------------------------------------------
  // TAB_CHANGED broadcast（F-008: SPA URL 変化対応）
  // ----------------------------------------------------------------
  it('onUpdated: changeInfo.url のみ（status なし）でも TAB_CHANGED が broadcast される（SPA 対応）', async () => {
    const sendMessageSpy = vi.spyOn(mock.runtime, 'sendMessage').mockResolvedValue({ ok: true });

    // URL 変化のみ（SPA pushState 相当）
    callOnUpdated(1, { url: 'https://example.com/new-path' }, { id: 1, active: true, url: 'https://example.com/new-path' });

    // sendMessage が TAB_CHANGED で呼ばれること
    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TAB_CHANGED', url: 'https://example.com/new-path' }),
    );

    sendMessageSpy.mockRestore();
  });

  it('onUpdated: status === "complete" でも TAB_CHANGED が broadcast される（通常遷移）', async () => {
    const sendMessageSpy = vi.spyOn(mock.runtime, 'sendMessage').mockResolvedValue({ ok: true });

    callOnUpdated(1, { status: 'complete' }, { id: 1, active: true, url: 'https://example.com/page' });

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TAB_CHANGED', url: 'https://example.com/page' }),
    );

    sendMessageSpy.mockRestore();
  });

  it('onUpdated: 同一 URL を連続して受け取った場合は 2 回目以降は broadcast されない（重複ガード）', async () => {
    const sendMessageSpy = vi.spyOn(mock.runtime, 'sendMessage').mockResolvedValue({ ok: true });

    // 1 回目: broadcast される
    callOnUpdated(1, { url: 'https://example.com/same' }, { id: 1, active: true, url: 'https://example.com/same' });
    // 2 回目: 同一 URL なので無視される
    callOnUpdated(1, { url: 'https://example.com/same' }, { id: 1, active: true, url: 'https://example.com/same' });

    // sendMessage は 1 回だけ呼ばれる
    const tabChangedCalls = sendMessageSpy.mock.calls.filter(
      (c) => (c[0] as { type?: string }).type === 'TAB_CHANGED',
    );
    expect(tabChangedCalls).toHaveLength(1);

    sendMessageSpy.mockRestore();
  });

  it('onUpdated: URL が変わったら重複ガードがリセットされ再度 broadcast される', async () => {
    const sendMessageSpy = vi.spyOn(mock.runtime, 'sendMessage').mockResolvedValue({ ok: true });

    callOnUpdated(1, { url: 'https://example.com/a' }, { id: 1, active: true, url: 'https://example.com/a' });
    callOnUpdated(1, { url: 'https://example.com/a' }, { id: 1, active: true, url: 'https://example.com/a' });
    callOnUpdated(1, { url: 'https://example.com/b' }, { id: 1, active: true, url: 'https://example.com/b' });

    const tabChangedCalls = sendMessageSpy.mock.calls.filter(
      (c) => (c[0] as { type?: string }).type === 'TAB_CHANGED',
    );
    // /a への 1 回 + /b への 1 回 = 計 2 回
    expect(tabChangedCalls).toHaveLength(2);
    expect((tabChangedCalls[0][0] as { url: string }).url).toBe('https://example.com/a');
    expect((tabChangedCalls[1][0] as { url: string }).url).toBe('https://example.com/b');

    sendMessageSpy.mockRestore();
  });

  it('onUpdated: active でないタブの変化は broadcast されない', async () => {
    const sendMessageSpy = vi.spyOn(mock.runtime, 'sendMessage').mockResolvedValue({ ok: true });

    callOnUpdated(1, { url: 'https://background-tab.com/' }, { id: 1, active: false, url: 'https://background-tab.com/' });

    const tabChangedCalls = sendMessageSpy.mock.calls.filter(
      (c) => (c[0] as { type?: string }).type === 'TAB_CHANGED',
    );
    expect(tabChangedCalls).toHaveLength(0);

    sendMessageSpy.mockRestore();
  });

  it('EXPLAINハンドラがAPIキー混入エラーを sanitize して返す（F-011 深層防御）', async () => {
    // background の catch 経路で sanitize が走ることを確認する。
    // callClaudeAPI の外側（handleMessage 内）で直接エラーを投げるパターンをシミュレートするため、
    // fetch ではなく handleMessage が呼ぶ callClaudeAPI そのものをモックするのではなく、
    // バックグラウンドの catch に到達するよう、callClaudeAPI 内部の fetch が
    // sk-ant- を含むエラーメッセージをそのまま伝搬させるケースを再現する。
    // claude.ts はネットワークエラーを wrap するため、
    // ここでは wrap されずに sk-ant- が含まれる Error を直接投げる形にする。
    const origFetch = globalThis.fetch;
    // fetch を "sk-ant-" を含む文字列のエラーで拒否する Promise を返す関数にする
    // ただし claude.ts のネットワークエラー catch を bypass するため、
    // 代わりにメッセージハンドラが直接 throw するパスを使う:
    // EXPLAIN ハンドラの callClaudeAPI は fetch を使うので、
    // fetch が成功したように見えて JSON.parse が失敗し、
    // それが sk-ant- を含むエラーを投げるケース を模倣する
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new Error('Malformed JSON: sk-ant-api03-SECRETKEY exposed')),
      } as Response)
    ) as typeof fetch;

    mock.storage.local._data['apiKey'] = 'sk-ant-api03-SECRETKEY';
    mock.storage.local._data['aiModel'] = 'claude-haiku-4-5';

    const result = (await callListener({ type: 'EXPLAIN', content: 'test' })) as { error?: string };

    // background の catch が sanitize した結果を返すこと
    expect(result.error).toBeDefined();
    expect(result.error).not.toContain('sk-ant-api03-SECRETKEY');

    globalThis.fetch = origFetch;
  });
});
