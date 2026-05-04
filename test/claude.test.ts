// lib/claude.ts: Claude API クライアントのテスト（F-005, F-011）
// fetch はモック。APIキー漏洩がないことも検証する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

// fetch のモック
const fetchMock = vi.fn();

beforeEach(() => {
  mock = installChromeMock();
  vi.resetModules();
  fetchMock.mockReset();
  // globalThis.fetch をモック
  (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

afterEach(() => {
  uninstallChromeMock();
  vi.restoreAllMocks();
});

/** 成功レスポンスを返す fetch モックを設定 */
function setupSuccessFetch(responseText: string): void {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      content: [{ type: 'text', text: responseText }],
    }),
  });
}

/** HTTPエラーを返す fetch モックを設定 */
function setupErrorFetch(status: number, bodyJson?: object): void {
  fetchMock.mockResolvedValue({
    ok: false,
    status,
    statusText: `HTTP ${status}`,
    text: () => Promise.resolve(bodyJson ? JSON.stringify(bodyJson) : ''),
  });
}

/** ネットワークエラーを返す fetch モックを設定 */
function setupNetworkError(): void {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
}

describe('callClaudeAPI', () => {
  it('APIキー未設定時は設定誘導のエラーを投げる（F-010）', async () => {
    const { callClaudeAPI } = await import('../src/lib/claude.js');
    await expect(callClaudeAPI({ prompt: 'test' })).rejects.toThrow(/API key is not configured/);
  });

  it('成功時は text を返す（F-005）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-test-key';
    mock.storage.local._data['aiModel'] = 'claude-haiku-4-5';
    setupSuccessFetch('This is an explanation.');
    const { callClaudeAPI } = await import('../src/lib/claude.js');
    const result = await callClaudeAPI({ prompt: 'Explain this.' });
    expect(result.text).toBe('This is an explanation.');
  });

  it('APIキーが fetch ヘッダのみで使われ、戻り値に含まれない（セキュリティ）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-secret-99999';
    setupSuccessFetch('Explanation here.');
    const { callClaudeAPI } = await import('../src/lib/claude.js');
    const result = await callClaudeAPI({ prompt: 'test' });
    // 戻り値にAPIキーが含まれないこと
    expect(result.text).not.toContain('sk-ant-secret-99999');
    // fetch には x-api-key ヘッダとして渡されていること
    const callArgs = fetchMock.mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-secret-99999');
  });

  it('HTTP 401 エラー: 認証エラーメッセージを投げる（F-011）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-invalid-key';
    setupErrorFetch(401);
    const { callClaudeAPI } = await import('../src/lib/claude.js');
    await expect(callClaudeAPI({ prompt: 'test' })).rejects.toThrow(/401/);
    await expect(callClaudeAPI({ prompt: 'test' })).rejects.toThrow(/Authentication error/);
  });

  it('HTTP 401 エラーメッセージにAPIキーが含まれない（F-011）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-leaktest-key';
    setupErrorFetch(401);
    const { callClaudeAPI } = await import('../src/lib/claude.js');
    try {
      await callClaudeAPI({ prompt: 'test' });
      expect.fail('Should have thrown');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain('sk-ant-leaktest-key');
    }
  });

  it('HTTP 429 エラー: レート制限メッセージを投げる（F-011）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-test-key';
    setupErrorFetch(429);
    const { callClaudeAPI } = await import('../src/lib/claude.js');
    await expect(callClaudeAPI({ prompt: 'test' })).rejects.toThrow(/429/);
    await expect(callClaudeAPI({ prompt: 'test' })).rejects.toThrow(/Rate limit/);
  });

  it('HTTP 4xx エラー: クライアントエラーメッセージを投げる（F-011）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-test-key';
    setupErrorFetch(400, { error: { message: 'Bad request format' } });
    const { callClaudeAPI } = await import('../src/lib/claude.js');
    await expect(callClaudeAPI({ prompt: 'test' })).rejects.toThrow(/400/);
  });

  it('HTTP 500 エラー: サーバーエラーメッセージを投げる（F-011）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-test-key';
    setupErrorFetch(500);
    const { callClaudeAPI } = await import('../src/lib/claude.js');
    await expect(callClaudeAPI({ prompt: 'test' })).rejects.toThrow(/500/);
    await expect(callClaudeAPI({ prompt: 'test' })).rejects.toThrow(/Server error/);
  });

  it('ネットワーク失敗: ネットワークエラーメッセージを投げる（F-011）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-test-key';
    setupNetworkError();
    const { callClaudeAPI } = await import('../src/lib/claude.js');
    await expect(callClaudeAPI({ prompt: 'test' })).rejects.toThrow(/Network error/);
  });

  it('ネットワークエラーメッセージにAPIキーが含まれない（F-011）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-network-key';
    setupNetworkError();
    const { callClaudeAPI } = await import('../src/lib/claude.js');
    try {
      await callClaudeAPI({ prompt: 'test' });
      expect.fail('Should have thrown');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain('sk-ant-network-key');
    }
  });

  it('システムプロンプトが英語固定で渡される（F-013）', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-test-key';
    setupSuccessFetch('English explanation.');
    const { callClaudeAPI, EXPLAIN_SYSTEM_PROMPT } = await import('../src/lib/claude.js');
    await callClaudeAPI({ prompt: 'test', system: EXPLAIN_SYSTEM_PROMPT });
    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(callArgs[1]?.body as string) as { system: string };
    expect(body.system).toContain('English');
  });

  it('会話履歴が正しい順序でリクエストに含まれる', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-test-key';
    setupSuccessFetch('Reply.');
    const { callClaudeAPI } = await import('../src/lib/claude.js');
    await callClaudeAPI({
      prompt: 'follow-up',
      history: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
    });
    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(callArgs[1]?.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hello' });
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'hi' });
    expect(body.messages[2]).toEqual({ role: 'user', content: 'follow-up' });
  });
});
