// content/extract.ts: DOM本文抽出ロジック（F-003, F-012）

import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractPageContent, CONTENT_MAX_CHARS } from '../src/content/extract.js';

/** テスト用DOMを作成するヘルパー */
function makeDoc(html: string): Document {
  const dom = new JSDOM(html);
  return dom.window.document;
}

describe('extractPageContent', () => {
  it('<script> の内容が抽出結果に含まれない（F-003）', () => {
    const doc = makeDoc(`
      <html><body>
        <p>Hello world</p>
        <script>alert('secret')</script>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Hello world');
    expect(result.content).not.toContain("alert('secret')");
  });

  it('<style> の内容が抽出結果に含まれない（F-003）', () => {
    const doc = makeDoc(`
      <html><body>
        <p>Article content</p>
        <style>.foo { color: red; }</style>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Article content');
    expect(result.content).not.toContain('color: red');
  });

  it('<noscript> の内容が抽出結果に含まれない（F-003）', () => {
    const doc = makeDoc(`
      <html><body>
        <p>Main text</p>
        <noscript>Please enable JavaScript</noscript>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Main text');
    expect(result.content).not.toContain('Please enable JavaScript');
  });

  it('通常の本文テキストが抽出される（F-003）', () => {
    const doc = makeDoc(`
      <html><body>
        <h1>Title</h1>
        <p>First paragraph.</p>
        <p>Second paragraph.</p>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Title');
    expect(result.content).toContain('First paragraph.');
    expect(result.content).toContain('Second paragraph.');
  });

  it('空でないページで content は空文字でない（F-003）', () => {
    const doc = makeDoc(`<html><body><p>Some text</p></body></html>`);
    const result = extractPageContent(doc);
    expect(result.content.trim().length).toBeGreaterThan(0);
  });

  it('上限を超えない場合は truncated = false（F-012）', () => {
    const doc = makeDoc(`<html><body><p>Short text</p></body></html>`);
    const result = extractPageContent(doc);
    expect(result.truncated).toBe(false);
  });

  it('上限超過時は切り詰められ truncated = true（F-012）', () => {
    // CONTENT_MAX_CHARS を超えるテキストを生成
    const longText = 'A'.repeat(CONTENT_MAX_CHARS + 100);
    const doc = makeDoc(`<html><body><p>${longText}</p></body></html>`);
    const result = extractPageContent(doc);
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(CONTENT_MAX_CHARS);
    expect(result.originalLength).toBeGreaterThan(CONTENT_MAX_CHARS);
  });

  it('hidden 属性の要素は除外される', () => {
    const doc = makeDoc(`
      <html><body>
        <p>Visible text</p>
        <div hidden>Hidden content</div>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Visible text');
    expect(result.content).not.toContain('Hidden content');
  });

  it('aria-hidden="true" の要素は除外される', () => {
    const doc = makeDoc(`
      <html><body>
        <p>Main content</p>
        <span aria-hidden="true">Decorative icon</span>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Main content');
    expect(result.content).not.toContain('Decorative icon');
  });

  it('script/style/noscript が複数ある場合もすべて除外される', () => {
    const doc = makeDoc(`
      <html>
        <head>
          <script>var x = 1;</script>
          <style>body { margin: 0; }</style>
        </head>
        <body>
          <p>Real content</p>
          <script>var y = 2;</script>
          <style>.hidden { display: none; }</style>
          <noscript>Enable JS</noscript>
        </body>
      </html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Real content');
    expect(result.content).not.toContain('var x');
    expect(result.content).not.toContain('var y');
    expect(result.content).not.toContain('margin: 0');
    expect(result.content).not.toContain('display: none');
    expect(result.content).not.toContain('Enable JS');
  });
});
