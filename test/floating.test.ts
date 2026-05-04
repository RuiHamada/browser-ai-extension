// F-501 / F-502 / F-503: フローティング Explain ボタンのユニットテスト
// jsdom 環境で選択状態・Shadow DOM・メッセージ送信を検証する

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

/**
 * window.getSelection() をモックして指定テキストが選択された状態を再現する。
 * jsdom では Range.getBoundingClientRect が常に空矩形を返すため、
 * rect 取得部分もスタブする。
 */
function mockSelection(text: string): void {
  const range = {
    getBoundingClientRect: () => ({
      left: 100,
      top: 100,
      right: 200,
      bottom: 120,
      width: 100,
      height: 20,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    }),
  };

  const sel = {
    toString: () => text,
    isCollapsed: text.length === 0,
    anchorNode: document.body,
    focusNode: document.body,
    getRangeAt: () => range,
  };

  vi.spyOn(window, 'getSelection').mockReturnValue(sel as unknown as Selection);
}

/** window.getSelection を null / 空選択状態にリセットする */
function clearSelection(): void {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => '',
    isCollapsed: true,
    anchorNode: null,
    focusNode: null,
    getRangeAt: () => ({ getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
  } as unknown as Selection);
}

/** デバウンスをスキップして selectionchange イベントを発火する */
async function triggerSelectionChange(): Promise<void> {
  document.dispatchEvent(new Event('selectionchange'));
  // デバウンス (80ms) を経過させる
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
}

beforeEach(async () => {
  mock = installChromeMock();
  document.body.innerHTML = '<p id="content">Hello world test content</p>';
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

/** デバウンスタイマーを進める（fake timers 使用時） */
async function advanceDebounce(): Promise<void> {
  vi.advanceTimersByTime(100);
  await Promise.resolve();
  await Promise.resolve();
}

describe('フローティング Explain ボタン（F-501/F-502）', () => {
  it('2 文字未満の選択ではホスト要素が表示されない', async () => {
    mockSelection('a');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    // 存在しないか、存在しても非表示
    if (host) {
      expect(host.style.display).toBe('none');
    } else {
      expect(host).toBeNull();
    }
  });

  it('空の選択ではホスト要素が表示されない', async () => {
    clearSelection();
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    if (host) {
      expect(host.style.display).toBe('none');
    } else {
      expect(host).toBeNull();
    }
  });

  it('<input type="password"> がアクティブな場合はホスト要素が表示されない', async () => {
    // password input を作成してフォーカス
    const input = document.createElement('input');
    input.type = 'password';
    document.body.appendChild(input);
    input.focus();

    mockSelection('some selected text');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    if (host) {
      expect(host.style.display).toBe('none');
    } else {
      expect(host).toBeNull();
    }
  });

  it('2 文字以上の通常テキスト選択でホスト要素が DOM に追加される', async () => {
    mockSelection('selected text here');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    expect(host).not.toBeNull();
  });

  it('ホスト要素の Shadow Root にボタンが存在する', async () => {
    mockSelection('selected text here');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).not.toBeNull();

    const button = host?.shadowRoot?.querySelector('button');
    expect(button).not.toBeNull();
  });

  it('ボタンに aria-label="Explain selected text" が設定されている', async () => {
    mockSelection('selected text here');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    const button = host?.shadowRoot?.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Explain selected text');
  });

  it('選択解除（isCollapsed=true）でボタンが非表示になる', async () => {
    // まず選択を作成して表示
    mockSelection('selected text here');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    // 選択解除
    clearSelection();
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    if (host) {
      expect(host.style.display).toBe('none');
    }
  });

  it('ボタンクリックで chrome.runtime.sendMessage が FLOATING_EXPLAIN_REQUEST で呼ばれる', async () => {
    const selText = 'selected text for explain';
    mockSelection(selText);
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    const button = host?.shadowRoot?.querySelector('button') as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    button?.click();
    await Promise.resolve();

    expect(mock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FLOATING_EXPLAIN_REQUEST',
        selectionText: selText,
      }),
    );
  });

  it('多重インスタンスが作成されない（ホスト要素は 1 つのみ）', async () => {
    mockSelection('first selection');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    mockSelection('second selection');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const hosts = document.querySelectorAll('#browser-ai-floating-host');
    expect(hosts.length).toBe(1);
  });
});
