// options.ts: 設定画面の保存・読込、伏字表示、削除動作の検証
// F-001 / F-002 受け入れ条件

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

function setupOptionsDom(): void {
  document.body.innerHTML = `
    <input type="password" id="apiKey" />
    <span id="apiKeyMask" class="api-key-mask"></span>
    <select id="aiModel"></select>
    <button id="btnSave"></button>
    <button id="btnClearApiKey"></button>
    <div id="saveStatus" class="status"></div>
  `;
}

beforeEach(async () => {
  mock = installChromeMock();
  setupOptionsDom();
  vi.resetModules();
});

afterEach(() => {
  uninstallChromeMock();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('options ページ', () => {
  it('モデル選択肢が動的に生成される（F-002）', async () => {
    await import('../src/options/options.js');
    const select = document.getElementById('aiModel') as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThanOrEqual(2);
  });

  it('APIキー入力欄は初期状態 type=password（マスク表示）', async () => {
    await import('../src/options/options.js');
    const inp = document.getElementById('apiKey') as HTMLInputElement;
    expect(inp.type).toBe('password');
  });

  it('保存済みAPIキーが input の value にロードされない（平文が DOM に現れない）', async () => {
    // セキュリティ要件: 保存済みキーを input value にセットしない
    mock.storage.local._data['apiKey'] = 'sk-ant-api03-secretvalue-AAAA';
    await import('../src/options/options.js');
    const inp = document.getElementById('apiKey') as HTMLInputElement;
    expect(inp.value).toBe('');
  });

  it('保存済みAPIキーがマスク表示 span に末尾4文字付きで表示される', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-api03-secretvalue-AAAA';
    await import('../src/options/options.js');
    const mask = document.getElementById('apiKeyMask') as HTMLSpanElement;
    // マスク文字列に末尾4文字（AAAA）が含まれる
    expect(mask.textContent).toContain('AAAA');
    // 平文のキー本体は含まれない
    expect(mask.textContent).not.toContain('secretvalue');
  });

  it('保存済みAPIキーがない場合はマスク span が非表示', async () => {
    await import('../src/options/options.js');
    const mask = document.getElementById('apiKeyMask') as HTMLSpanElement;
    expect(mask.style.display).toBe('none');
  });

  it('保存ボタンで chrome.storage.local に保存され、sync には書き込まれない', async () => {
    await import('../src/options/options.js');
    const inp = document.getElementById('apiKey') as HTMLInputElement;
    const select = document.getElementById('aiModel') as HTMLSelectElement;
    inp.value = 'sk-ant-newkey-123';
    select.value = 'claude-sonnet-4-6';

    (document.getElementById('btnSave') as HTMLButtonElement).click();

    expect(mock.storage.local.set).toHaveBeenCalled();
    expect(mock.storage.local._data['apiKey']).toBe('sk-ant-newkey-123');
    expect(mock.storage.local._data['aiModel']).toBe('claude-sonnet-4-6');
    expect(mock.storage.sync.set).not.toHaveBeenCalled();
  });

  it('保存後に入力欄がクリアされる（平文が input に残らない）', async () => {
    await import('../src/options/options.js');
    const inp = document.getElementById('apiKey') as HTMLInputElement;
    inp.value = 'sk-ant-newkey-999';

    (document.getElementById('btnSave') as HTMLButtonElement).click();

    // 保存後は input.value が空になる
    expect(inp.value).toBe('');
  });

  it('保存後にマスク span が更新される', async () => {
    await import('../src/options/options.js');
    const inp = document.getElementById('apiKey') as HTMLInputElement;
    inp.value = 'sk-ant-newkey-9999';

    (document.getElementById('btnSave') as HTMLButtonElement).click();

    const mask = document.getElementById('apiKeyMask') as HTMLSpanElement;
    // 末尾4文字が含まれる
    expect(mask.textContent).toContain('9999');
    // 入力された平文キー本体は含まれない
    expect(mask.textContent).not.toContain('newkey');
  });

  it('APIキー空のまま保存しても、既存キーは消されずモデルだけ更新される', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-existing';
    await import('../src/options/options.js');
    const inp = document.getElementById('apiKey') as HTMLInputElement;
    inp.value = '   '; // 空白のみ

    (document.getElementById('btnSave') as HTMLButtonElement).click();

    // apiKey は上書きされていない（既存値が残る）
    expect(mock.storage.local._data['apiKey']).toBe('sk-ant-existing');
  });

  it('Clear ボタンで apiKey が削除される', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-tobe-removed';
    await import('../src/options/options.js');

    (document.getElementById('btnClearApiKey') as HTMLButtonElement).click();

    expect(mock.storage.local.remove).toHaveBeenCalledWith('apiKey', expect.any(Function));
    expect('apiKey' in mock.storage.local._data).toBe(false);
  });

  it('Clear ボタンでマスク span が非表示になる', async () => {
    mock.storage.local._data['apiKey'] = 'sk-ant-tobe-removed';
    await import('../src/options/options.js');

    (document.getElementById('btnClearApiKey') as HTMLButtonElement).click();

    const mask = document.getElementById('apiKeyMask') as HTMLSpanElement;
    expect(mask.style.display).toBe('none');
    expect(mask.textContent).toBe('');
  });

  it('保存済みモデルが select に反映される', async () => {
    mock.storage.local._data['aiModel'] = 'claude-opus-4-7';
    await import('../src/options/options.js');
    // chrome.storage.local.get のコールバックが同期的に実行されるため即時反映
    const select = document.getElementById('aiModel') as HTMLSelectElement;
    expect(select.value).toBe('claude-opus-4-7');
  });
});

// ----------------------------------------------------------------
// Options ページ: chrome.storage.onChanged による双方向同期（F-201）
// Side Panel で言語変更 → Options の select が自動更新される
// ----------------------------------------------------------------
describe('options ページ: chrome.storage.onChanged 同期', () => {
  // このテスト群は outputLanguage select を含む完全な DOM を使う
  function setupDomWithLanguage(): void {
    document.body.innerHTML = `
      <input type="password" id="apiKey" />
      <span id="apiKeyMask" class="api-key-mask"></span>
      <select id="aiModel">
        <option value="claude-haiku-4-5">Haiku</option>
        <option value="claude-sonnet-4-6">Sonnet</option>
      </select>
      <select id="outputLanguage">
        <option value="en">English</option>
        <option value="ja">Japanese</option>
      </select>
      <button id="btnSave"></button>
      <button id="btnClearApiKey"></button>
      <div id="saveStatus" class="status"></div>
    `;
  }

  beforeEach(() => {
    // 標準 DOM をリセットして言語 select 付き DOM に差し替える
    document.body.innerHTML = '';
    setupDomWithLanguage();
    vi.resetModules();
  });

  it('storage.onChanged で outputLanguage="ja" が来ると select が "ja" に更新される', async () => {
    await import('../src/options/options.js');
    const sel = document.getElementById('outputLanguage') as HTMLSelectElement;
    expect(sel.value).toBe('en'); // 初期値

    // Side Panel が ja に変更したことをシミュレート
    mock.storage.onChanged._trigger(
      { outputLanguage: { newValue: 'ja', oldValue: 'en' } },
      'local',
    );
    expect(sel.value).toBe('ja');
  });

  it('storage.onChanged で area="sync" の場合は select が更新されない', async () => {
    await import('../src/options/options.js');
    const sel = document.getElementById('outputLanguage') as HTMLSelectElement;
    expect(sel.value).toBe('en');

    // sync 領域の変更は無視される
    mock.storage.onChanged._trigger(
      { outputLanguage: { newValue: 'ja', oldValue: 'en' } },
      'sync',
    );
    expect(sel.value).toBe('en');
  });

  it('storage.onChanged で不正値 "fr" が来た場合はデフォルト "en" にフォールバックして反映される', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await import('../src/options/options.js');
    const sel = document.getElementById('outputLanguage') as HTMLSelectElement;
    expect(sel.value).toBe('ja');

    // 不正値が来た場合
    mock.storage.onChanged._trigger(
      { outputLanguage: { newValue: 'fr', oldValue: 'ja' } },
      'local',
    );
    // validateOutputLanguage を経由して 'en' にフォールバック
    expect(sel.value).toBe('en');
  });

  it('storage.onChanged で aiModel が変更されると select が更新される（別タブ整合性）', async () => {
    mock.storage.local._data['aiModel'] = 'claude-haiku-4-5';
    await import('../src/options/options.js');
    const sel = document.getElementById('aiModel') as HTMLSelectElement;
    expect(sel.value).toBe('claude-haiku-4-5');

    // 別タブの Options で aiModel を変更したことをシミュレート
    mock.storage.onChanged._trigger(
      { aiModel: { newValue: 'claude-sonnet-4-6', oldValue: 'claude-haiku-4-5' } },
      'local',
    );
    expect(sel.value).toBe('claude-sonnet-4-6');
  });

  it('storage.onChanged で aiModel の area="sync" は無視される', async () => {
    mock.storage.local._data['aiModel'] = 'claude-haiku-4-5';
    await import('../src/options/options.js');
    const sel = document.getElementById('aiModel') as HTMLSelectElement;

    mock.storage.onChanged._trigger(
      { aiModel: { newValue: 'claude-sonnet-4-6', oldValue: 'claude-haiku-4-5' } },
      'sync',
    );
    expect(sel.value).toBe('claude-haiku-4-5');
  });
});
