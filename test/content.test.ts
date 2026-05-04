// content/index.ts: GET_SELECTED_TEXT / GET_PAGE_CONTENT のメッセージハンドリング
// Sprint 2: DOM 抽出の実装を含む（F-003, F-004）

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

beforeEach(async () => {
  mock = installChromeMock();
  // テスト用DOMを設定（jsdom 環境は document を持つ）
  document.body.innerHTML = `
    <h1>Test Page</h1>
    <p>Article content here.</p>
    <script>var secret = 'should not appear';</script>
    <style>.hidden { display: none; }</style>
    <noscript>Enable JavaScript</noscript>
  `;
  vi.resetModules();
  await import('../src/content/index.js');
});

afterEach(() => {
  uninstallChromeMock();
  document.body.innerHTML = '';
});

function callListener(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const listener = mock.runtime.onMessage._listeners[0] as
      | ((m: unknown, s: unknown, sr: (r: unknown) => void) => boolean | void)
      | undefined;
    if (!listener) return resolve(undefined);
    listener(message, {}, (r: unknown) => resolve(r));
  });
}

describe('content script', () => {
  it('GET_SELECTED_TEXT: 選択がない場合は空文字', async () => {
    const result = (await callListener({ type: 'GET_SELECTED_TEXT' })) as { selectedText: string };
    expect(result.selectedText).toBe('');
  });

  it('GET_PAGE_CONTENT: URL を返す（F-003）', async () => {
    const result = (await callListener({ type: 'GET_PAGE_CONTENT' })) as {
      url: string;
      content: string;
      truncated: boolean;
      originalLength: number;
    };
    expect(typeof result.url).toBe('string');
    expect(result.url.length).toBeGreaterThan(0);
  });

  it('GET_PAGE_CONTENT: content が空文字でない（F-003）', async () => {
    const result = (await callListener({ type: 'GET_PAGE_CONTENT' })) as {
      url: string;
      content: string;
      truncated: boolean;
    };
    expect(result.content.trim().length).toBeGreaterThan(0);
  });

  it('GET_PAGE_CONTENT: <script> の内容を含まない（F-003）', async () => {
    const result = (await callListener({ type: 'GET_PAGE_CONTENT' })) as { content: string };
    expect(result.content).not.toContain('should not appear');
  });

  it('GET_PAGE_CONTENT: <style> の内容を含まない（F-003）', async () => {
    const result = (await callListener({ type: 'GET_PAGE_CONTENT' })) as { content: string };
    expect(result.content).not.toContain('display: none');
  });

  it('GET_PAGE_CONTENT: <noscript> の内容を含まない（F-003）', async () => {
    const result = (await callListener({ type: 'GET_PAGE_CONTENT' })) as { content: string };
    expect(result.content).not.toContain('Enable JavaScript');
  });

  it('GET_PAGE_CONTENT: 本文テキストを含む（F-003）', async () => {
    const result = (await callListener({ type: 'GET_PAGE_CONTENT' })) as { content: string };
    expect(result.content).toContain('Article content here.');
  });

  it('GET_PAGE_CONTENT: truncated と originalLength が返される（F-012）', async () => {
    const result = (await callListener({ type: 'GET_PAGE_CONTENT' })) as {
      truncated: boolean;
      originalLength: number;
    };
    expect(typeof result.truncated).toBe('boolean');
    expect(typeof result.originalLength).toBe('number');
  });
});
