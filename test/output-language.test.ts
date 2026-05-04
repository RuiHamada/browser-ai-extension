// F-201: 出力言語切替機能のテスト
// - storage の outputLanguage 保存・読込・不正値フォールバック
// - validateOutputLanguage の動作
// - getExplainSystemPrompt / getChatSystemPromptBase の言語分岐
// - background EXPLAIN/CHAT ハンドラが outputLanguage を system prompt に埋め込むこと
// - Options の en/ja 切り替えが保存されること
// - Side Panel クイック切替で保存・UI 反映されること
// - chrome.storage.onChanged で Options ↔ Side Panel 同期

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
  vi.resetModules();
});

afterEach(() => {
  uninstallChromeMock();
  document.body.innerHTML = '';
});

// ----------------------------------------------------------------
// storage.ts: validateOutputLanguage / loadSettings
// ----------------------------------------------------------------
describe('validateOutputLanguage', () => {
  it('"en" を渡すと "en" を返す', async () => {
    const { validateOutputLanguage } = await import('../src/lib/storage.js');
    expect(validateOutputLanguage('en')).toBe('en');
  });

  it('"ja" を渡すと "ja" を返す', async () => {
    const { validateOutputLanguage } = await import('../src/lib/storage.js');
    expect(validateOutputLanguage('ja')).toBe('ja');
  });

  it('許可外の文字列はデフォルト "en" にフォールバック', async () => {
    const { validateOutputLanguage } = await import('../src/lib/storage.js');
    expect(validateOutputLanguage('fr')).toBe('en');
  });

  it('null はデフォルト "en" にフォールバック', async () => {
    const { validateOutputLanguage } = await import('../src/lib/storage.js');
    expect(validateOutputLanguage(null)).toBe('en');
  });

  it('数値はデフォルト "en" にフォールバック', async () => {
    const { validateOutputLanguage } = await import('../src/lib/storage.js');
    expect(validateOutputLanguage(42)).toBe('en');
  });
});

describe('loadSettings: outputLanguage', () => {
  it('未設定時はデフォルト "en" を返す', async () => {
    const { loadSettings } = await import('../src/lib/storage.js');
    const s = await loadSettings();
    expect(s.outputLanguage).toBe('en');
  });

  it('"ja" が保存済みなら "ja" を返す', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    const { loadSettings } = await import('../src/lib/storage.js');
    const s = await loadSettings();
    expect(s.outputLanguage).toBe('ja');
  });

  it('不正値はデフォルト "en" にフォールバック', async () => {
    mock.storage.local._data['outputLanguage'] = 'zh';
    const { loadSettings } = await import('../src/lib/storage.js');
    const s = await loadSettings();
    expect(s.outputLanguage).toBe('en');
  });
});

describe('saveSettings: outputLanguage', () => {
  it('outputLanguage を保存すると storage に反映される', async () => {
    const { saveSettings } = await import('../src/lib/storage.js');
    await saveSettings({ outputLanguage: 'ja' });
    expect(mock.storage.local._data['outputLanguage']).toBe('ja');
    // sync には書き込まれない
    expect(mock.storage.sync.set).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------
// claude.ts: getExplainSystemPrompt / getChatSystemPromptBase
// ----------------------------------------------------------------
describe('getExplainSystemPrompt', () => {
  it('lang="en" のとき "English" を含み "Japanese" を含まない', async () => {
    const { getExplainSystemPrompt } = await import('../src/lib/claude.js');
    const prompt = getExplainSystemPrompt('en');
    expect(prompt).toContain('English');
    expect(prompt).not.toContain('Japanese');
  });

  it('lang="ja" のとき "Japanese" を含み "English" を含まない', async () => {
    const { getExplainSystemPrompt } = await import('../src/lib/claude.js');
    const prompt = getExplainSystemPrompt('ja');
    expect(prompt).toContain('Japanese');
    expect(prompt).not.toContain('English');
  });

  it('引数なし（デフォルト）のとき "English" を含む', async () => {
    const { getExplainSystemPrompt } = await import('../src/lib/claude.js');
    expect(getExplainSystemPrompt()).toContain('English');
  });
});

describe('getChatSystemPromptBase', () => {
  it('lang="en" のとき "English" を含み "Japanese" を含まない', async () => {
    const { getChatSystemPromptBase } = await import('../src/lib/claude.js');
    const prompt = getChatSystemPromptBase('en');
    expect(prompt).toContain('English');
    expect(prompt).not.toContain('Japanese');
  });

  it('lang="ja" のとき "Japanese" を含み "English" を含まない', async () => {
    const { getChatSystemPromptBase } = await import('../src/lib/claude.js');
    const prompt = getChatSystemPromptBase('ja');
    expect(prompt).toContain('Japanese');
    expect(prompt).not.toContain('English');
  });

  it('引数なし（デフォルト）のとき "English" を含む', async () => {
    const { getChatSystemPromptBase } = await import('../src/lib/claude.js');
    expect(getChatSystemPromptBase()).toContain('English');
  });
});

// ----------------------------------------------------------------
// background: EXPLAIN / CHAT ハンドラが outputLanguage を system に埋め込む
// ----------------------------------------------------------------
describe('background EXPLAIN ハンドラ: outputLanguage → system prompt', () => {
  const fetchMock = vi.fn();

  beforeEach(async () => {
    fetchMock.mockReset();
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
    // 成功レスポンスを設定
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

  it('outputLanguage="en" のとき EXPLAIN system に "English" が含まれる', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await callListener({ type: 'EXPLAIN', content: 'test content' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    expect(body.system).toContain('English');
    expect(body.system).not.toContain('Japanese');
  });

  it('outputLanguage="ja" のとき EXPLAIN system に "Japanese" が含まれる', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await callListener({ type: 'EXPLAIN', content: 'test content' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    expect(body.system).toContain('Japanese');
    expect(body.system).not.toContain('English');
  });
});

describe('background CHAT ハンドラ: outputLanguage → system prompt', () => {
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

  it('outputLanguage="en" のとき CHAT system に "English" が含まれる', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await callListener({ type: 'CHAT', userMessage: 'hi', history: [], pageContent: '' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    expect(body.system).toContain('English');
    expect(body.system).not.toContain('Japanese');
  });

  it('outputLanguage="ja" のとき CHAT system に "Japanese" が含まれる', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await callListener({ type: 'CHAT', userMessage: 'hi', history: [], pageContent: '' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
    expect(body.system).toContain('Japanese');
    expect(body.system).not.toContain('English');
  });
});

// ----------------------------------------------------------------
// Options ページ: outputLanguage の保存・読込
// ----------------------------------------------------------------
describe('options ページ: outputLanguage', () => {
  function setupDom(): void {
    document.body.innerHTML = `
      <input type="password" id="apiKey" />
      <span id="apiKeyMask" class="api-key-mask"></span>
      <select id="aiModel">
        <option value="claude-haiku-4-5">Haiku</option>
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
    setupDom();
    vi.resetModules();
  });

  it('保存済みの outputLanguage="ja" が select に反映される', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await import('../src/options/options.js');
    const sel = document.getElementById('outputLanguage') as HTMLSelectElement;
    expect(sel.value).toBe('ja');
  });

  it('保存済みがない場合は select がデフォルト "en" になる', async () => {
    await import('../src/options/options.js');
    const sel = document.getElementById('outputLanguage') as HTMLSelectElement;
    expect(sel.value).toBe('en');
  });

  it('保存ボタンで選択した outputLanguage が storage に保存される', async () => {
    await import('../src/options/options.js');
    const sel = document.getElementById('outputLanguage') as HTMLSelectElement;
    sel.value = 'ja';
    (document.getElementById('btnSave') as HTMLButtonElement).click();
    expect(mock.storage.local._data['outputLanguage']).toBe('ja');
    // sync には書き込まれない
    expect(mock.storage.sync.set).not.toHaveBeenCalled();
  });

  it('en に戻して保存すると "en" が storage に保存される', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await import('../src/options/options.js');
    const sel = document.getElementById('outputLanguage') as HTMLSelectElement;
    sel.value = 'en';
    (document.getElementById('btnSave') as HTMLButtonElement).click();
    expect(mock.storage.local._data['outputLanguage']).toBe('en');
  });
});

// ----------------------------------------------------------------
// Side Panel: クイック切替・storage.onChanged 同期
// ----------------------------------------------------------------
describe('sidepanel: outputLanguage クイック切替と onChanged 同期', () => {
  function setupDom(): void {
    document.body.innerHTML = `
      <span id="currentUrl">Loading...</span>
      <button id="btnSettings"></button>
      <div id="apiKeyWarning" class="hidden">
        <button id="linkToOptions"></button>
      </div>
      <div id="mainContent" class="hidden"></div>
      <select id="outputLanguageSelect">
        <option value="en">EN</option>
        <option value="ja">JA</option>
      </select>
    `;
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  beforeEach(() => {
    setupDom();
    vi.resetModules();
  });

  it('初期化時にストレージの outputLanguage がセレクトに反映される', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await import('../src/sidepanel/index.js');
    await flush();
    const sel = document.getElementById('outputLanguageSelect') as HTMLSelectElement;
    expect(sel.value).toBe('ja');
  });

  it('ストレージ未設定の場合はセレクトがデフォルト "en" になる', async () => {
    await import('../src/sidepanel/index.js');
    await flush();
    const sel = document.getElementById('outputLanguageSelect') as HTMLSelectElement;
    expect(sel.value).toBe('en');
  });

  it('セレクト変更で storage.local.set が呼ばれ outputLanguage が保存される', async () => {
    await import('../src/sidepanel/index.js');
    await flush();
    const sel = document.getElementById('outputLanguageSelect') as HTMLSelectElement;
    sel.value = 'ja';
    sel.dispatchEvent(new Event('change'));
    expect(mock.storage.local.set).toHaveBeenCalledWith({ outputLanguage: 'ja' });
  });

  it('storage.onChanged で outputLanguage が変わるとセレクトが更新される（Options→SidePanel 同期）', async () => {
    await import('../src/sidepanel/index.js');
    await flush();
    const sel = document.getElementById('outputLanguageSelect') as HTMLSelectElement;
    expect(sel.value).toBe('en');

    // Options ページで ja に変更されたことをシミュレート
    mock.storage.onChanged._trigger(
      { outputLanguage: { newValue: 'ja', oldValue: 'en' } },
      'local',
    );
    expect(sel.value).toBe('ja');
  });

  it('storage.onChanged で area が "sync" の場合はセレクトが更新されない', async () => {
    mock.storage.local._data['outputLanguage'] = 'en';
    await import('../src/sidepanel/index.js');
    await flush();
    const sel = document.getElementById('outputLanguageSelect') as HTMLSelectElement;

    // sync の変更は無視される
    mock.storage.onChanged._trigger(
      { outputLanguage: { newValue: 'ja', oldValue: 'en' } },
      'sync',
    );
    expect(sel.value).toBe('en');
  });

  it('onChanged で不正値が来てもデフォルト "en" に安全にフォールバックする', async () => {
    mock.storage.local._data['outputLanguage'] = 'ja';
    await import('../src/sidepanel/index.js');
    await flush();
    const sel = document.getElementById('outputLanguageSelect') as HTMLSelectElement;
    expect(sel.value).toBe('ja');

    mock.storage.onChanged._trigger(
      { outputLanguage: { newValue: 'invalid', oldValue: 'ja' } },
      'local',
    );
    expect(sel.value).toBe('en');
  });
});
