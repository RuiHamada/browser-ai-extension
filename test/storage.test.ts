// storage.ts の単体テスト
// F-001 / F-002 の受け入れ条件のうち、ストレージ層の振る舞いを検証する

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

afterEach(() => {
  uninstallChromeMock();
});

describe('lib/storage', () => {
  it('loadSettings: 未設定時はデフォルト値を返す', async () => {
    const { loadSettings } = await import('../src/lib/storage.js');
    const settings = await loadSettings();
    expect(settings.apiKey).toBe('');
    expect(settings.aiModel).toBe('claude-haiku-4-5');
  });

  it('loadSettings: 保存済みの値が読み出される', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-xyz';
    mock.storage.local._data['aiModel'] = 'claude-sonnet-4-6';
    const { loadSettings } = await import('../src/lib/storage.js');
    const settings = await loadSettings();
    expect(settings.apiKey).toBe('sk-ant-xyz');
    expect(settings.aiModel).toBe('claude-sonnet-4-6');
  });

  it('saveSettings: chrome.storage.local にのみ保存し sync は呼ばない', async () => {
    const { saveSettings } = await import('../src/lib/storage.js');
    await saveSettings({ apiKey: 'sk-ant-abc', aiModel: 'claude-opus-4-7' });
    expect(mock.storage.local.set).toHaveBeenCalledTimes(1);
    expect(mock.storage.local._data['apiKey']).toBe('sk-ant-abc');
    expect(mock.storage.local._data['aiModel']).toBe('claude-opus-4-7');
    // sync には書き込まれていないこと（F-001 / 非機能 セキュリティ要件）
    expect(mock.storage.sync.set).not.toHaveBeenCalled();
    expect(mock.storage.sync._data).toEqual({});
  });

  it('hasApiKey: 未設定なら false', async () => {
    const { hasApiKey } = await import('../src/lib/storage.js');
    expect(await hasApiKey()).toBe(false);
  });

  it('hasApiKey: 空白のみの場合は false（trim 判定）', async () => {
    mock.storage.local._data['apiKey'] = '   ';
    const { hasApiKey } = await import('../src/lib/storage.js');
    expect(await hasApiKey()).toBe(false);
  });

  it('hasApiKey: 設定済みなら true', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-xxx';
    const { hasApiKey } = await import('../src/lib/storage.js');
    expect(await hasApiKey()).toBe(true);
  });

  it('loadSettings: 不正な型の値はデフォルトにフォールバック', async () => {
    mock.storage.local._data['apiKey'] = 12345; // 数値が混入したケース
    mock.storage.local._data['aiModel'] = null;
    const { loadSettings } = await import('../src/lib/storage.js');
    const s = await loadSettings();
    expect(s.apiKey).toBe('');
    expect(s.aiModel).toBe('claude-haiku-4-5');
  });

  it('loadSettings: aiModel が許可リスト外の文字列の場合はデフォルトにフォールバック', async () => {
    mock.storage.local._data['aiModel'] = 'claude-unknown-model-99';
    const { loadSettings } = await import('../src/lib/storage.js');
    const s = await loadSettings();
    expect(s.aiModel).toBe('claude-haiku-4-5');
  });

  it('loadSettings: aiModel が有効な許可リスト内の値の場合はそのまま返す', async () => {
    mock.storage.local._data['aiModel'] = 'claude-sonnet-4-6';
    const { loadSettings } = await import('../src/lib/storage.js');
    const s = await loadSettings();
    expect(s.aiModel).toBe('claude-sonnet-4-6');
  });
});
