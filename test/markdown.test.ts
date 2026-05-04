// markdown.ts: Markdown レンダラのユニットテスト（F-504）
// XSS 防止 6 ベクタ + 基本記法カバレッジ

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from '../src/sidepanel/markdown.js';

/** テスト用コンテナを生成する */
function makeContainer(): HTMLDivElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ----------------------------------------------------------------
// 基本記法テスト
// ----------------------------------------------------------------

describe('段落レンダリング', () => {
  it('通常テキストが <p> 要素として描画される', () => {
    const container = makeContainer();
    renderMarkdown(container, 'Hello world');
    const p = container.querySelector('p');
    expect(p).not.toBeNull();
    expect(p!.textContent).toBe('Hello world');
  });

  it('空行で段落が分割される', () => {
    const container = makeContainer();
    renderMarkdown(container, 'First paragraph\n\nSecond paragraph');
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0].textContent).toBe('First paragraph');
    expect(paragraphs[1].textContent).toBe('Second paragraph');
  });
});

describe('見出しレンダリング', () => {
  it('# が <h1> として描画される', () => {
    const container = makeContainer();
    renderMarkdown(container, '# Heading 1');
    const h = container.querySelector('h1');
    expect(h).not.toBeNull();
    expect(h!.textContent).toBe('Heading 1');
  });

  it('## が <h2> として描画される', () => {
    const container = makeContainer();
    renderMarkdown(container, '## Heading 2');
    const h = container.querySelector('h2');
    expect(h).not.toBeNull();
    expect(h!.textContent).toBe('Heading 2');
  });

  it('### が <h3> として描画される', () => {
    const container = makeContainer();
    renderMarkdown(container, '### Heading 3');
    const h = container.querySelector('h3');
    expect(h).not.toBeNull();
    expect(h!.textContent).toBe('Heading 3');
  });

  it('見出しとリストの組み合わせ（F-504 機能受け入れ条件）', () => {
    const container = makeContainer();
    renderMarkdown(container, '## Title\n\n- a\n- b\n');
    expect(container.querySelector('h2')?.textContent).toBe('Title');
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    const items = ul!.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('a');
    expect(items[1].textContent).toBe('b');
  });
});

describe('リストレンダリング', () => {
  it('- で始まる行が <ul><li> として描画される', () => {
    const container = makeContainer();
    renderMarkdown(container, '- item 1\n- item 2\n- item 3');
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    const items = ul!.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('item 1');
  });

  it('* で始まる行が <ul><li> として描画される', () => {
    const container = makeContainer();
    renderMarkdown(container, '* alpha\n* beta');
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    expect(ul!.querySelectorAll('li').length).toBe(2);
  });

  it('1. 2. で始まる行が <ol><li> として描画される', () => {
    const container = makeContainer();
    renderMarkdown(container, '1. first\n2. second\n3. third');
    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    const items = ol!.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[1].textContent).toBe('second');
  });
});

describe('インラインコードレンダリング', () => {
  it('バッククォートで囲まれたテキストが <code> として描画される（F-504 機能受け入れ条件）', () => {
    const container = makeContainer();
    renderMarkdown(container, '`code`');
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('code');
  });

  it('文中のインラインコードが正しく描画される', () => {
    const container = makeContainer();
    renderMarkdown(container, 'Use `const x = 1` here');
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('const x = 1');
  });
});

describe('コードブロックレンダリング', () => {
  it('フェンス付きコードブロックが <pre><code> 構造で描画される（F-504 機能受け入れ条件）', () => {
    const container = makeContainer();
    renderMarkdown(container, '```js\nconst x = 1;\n```');
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    const code = pre!.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toContain('const x = 1;');
  });

  it('コードブロックに markdown-codeblock クラスが付与される', () => {
    const container = makeContainer();
    renderMarkdown(container, '```\nsome code\n```');
    const pre = container.querySelector('pre');
    expect(pre!.classList.contains('markdown-codeblock')).toBe(true);
  });

  it('言語指定なしのコードブロックも正しく描画される', () => {
    const container = makeContainer();
    renderMarkdown(container, '```\nplain code\n```');
    const code = container.querySelector('pre > code');
    expect(code!.textContent).toContain('plain code');
  });
});

describe('太字・イタリックレンダリング', () => {
  it('**text** が <strong> として描画される（F-504 機能受け入れ条件）', () => {
    const container = makeContainer();
    renderMarkdown(container, '**bold**');
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('bold');
  });

  it('*text* が <em> として描画される', () => {
    const container = makeContainer();
    renderMarkdown(container, '*italic*');
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe('italic');
  });

  it('_text_ が <em> として描画される', () => {
    const container = makeContainer();
    renderMarkdown(container, '_italic_');
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe('italic');
  });
});

describe('リンクレンダリング', () => {
  it('通常リンクが <a> として描画される（F-504 機能受け入れ条件）', () => {
    const container = makeContainer();
    renderMarkdown(container, '[link](https://example.com)');
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.textContent).toBe('link');
    expect(a!.getAttribute('href')).toBe('https://example.com');
    expect(a!.getAttribute('target')).toBe('_blank');
    expect(a!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('http:// リンクも許可される', () => {
    const container = makeContainer();
    renderMarkdown(container, '[link](http://example.com)');
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('http://example.com');
  });

  it('mailto: リンクも許可される', () => {
    const container = makeContainer();
    renderMarkdown(container, '[email](mailto:user@example.com)');
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('mailto:user@example.com');
  });
});

// ----------------------------------------------------------------
// XSS 防止テスト（F-504 受け入れ条件 6 ベクタ）
// ----------------------------------------------------------------

describe('XSS 防止（F-504）', () => {
  // ベクタ 1: <script> タグ
  it('ベクタ1: <script>alert(1)</script> を含む応答で <script> 要素が生成されない', () => {
    const container = makeContainer();
    renderMarkdown(container, '<script>alert(1)</script>');
    // <script> 要素が DOM に存在してはならない
    expect(container.querySelector('script')).toBeNull();
    // テキストとして表示されるか確認（安全フォールバックまたは段落に含まれる）
    expect(container.textContent).toContain('alert(1)');
  });

  // ベクタ 2: <img onerror>
  it('ベクタ2: <img src=x onerror="alert(1)"> で <img> や onerror 属性が生成されない', () => {
    const container = makeContainer();
    renderMarkdown(container, '<img src="x" onerror="alert(1)">');
    // <img> 要素は生成されない（自前実装ではすべての HTML タグをテキスト扱い）
    expect(container.querySelector('img')).toBeNull();
    // onerror 属性を持つ要素も存在しない
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  // ベクタ 3: javascript: リンク
  it('ベクタ3: [click](javascript:alert(1)) で href に javascript: が付与されない', () => {
    const container = makeContainer();
    renderMarkdown(container, '[click](javascript:alert(1))');
    const links = container.querySelectorAll('a');
    for (const link of Array.from(links)) {
      const href = link.getAttribute('href') ?? '';
      expect(href.toLowerCase()).not.toContain('javascript:');
    }
    // テキスト「click」は表示される（プレーンテキスト化）
    expect(container.textContent).toContain('click');
  });

  // ベクタ 4: <iframe>
  it('ベクタ4: <iframe src="..."></iframe> で <iframe> 要素が生成されない', () => {
    const container = makeContainer();
    renderMarkdown(container, '<iframe src="https://evil.example.com"></iframe>');
    expect(container.querySelector('iframe')).toBeNull();
  });

  // ベクタ 5: onclick 属性
  it('ベクタ5: <a href="..." onclick="alert(1)">x</a> で onclick 属性が生成されない', () => {
    const container = makeContainer();
    renderMarkdown(container, '<a href="https://example.com" onclick="alert(1)">x</a>');
    // 自前実装では HTML タグはテキスト扱いなので <a> 要素自体が生成されない
    const links = container.querySelectorAll('a');
    for (const link of Array.from(links)) {
      expect(link.getAttribute('onclick')).toBeNull();
    }
    // onclick 属性を持つ要素が DOM に存在しないことを確認
    expect(container.querySelector('[onclick]')).toBeNull();
  });

  // ベクタ 6: レンダリング例外時のフォールバック
  it('ベクタ6: レンダリング中に例外が発生した場合プレーンテキストにフォールバックする', () => {
    const container = makeContainer();
    const originalTextContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');

    // parseBlocks が投げる例外をシミュレートするためパッチ
    // 実際にはエラーが出る入力を使う代わりに、内部実装を汚染してみる
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // 通常の入力でフォールバックが起きないことを確認
      renderMarkdown(container, 'normal text');
      expect(container.textContent).toContain('normal text');
    } finally {
      consoleSpy.mockRestore();
    }

    // 例外をシミュレートするために renderMarkdown を直接テスト
    // AppendChild が例外を投げるケースで container.textContent が設定される
    const badContainer = document.createElement('div');
    // appendChild をオーバーライドして例外を投げさせる
    const originalAppendChild = badContainer.appendChild.bind(badContainer);
    let callCount = 0;
    badContainer.appendChild = (node: Node) => {
      callCount++;
      if (callCount === 1) throw new Error('Simulated render error');
      return originalAppendChild(node);
    };

    const consoleSpy2 = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderMarkdown(badContainer, 'fallback test content');
      // フォールバック後は textContent にオリジナル文字列が入る
      expect(badContainer.textContent).toBe('fallback test content');
      // console.error が呼ばれたことを確認
      expect(consoleSpy2).toHaveBeenCalled();
    } finally {
      consoleSpy2.mockRestore();
    }
  });
});

// ----------------------------------------------------------------
// data: / vbscript: URL スキームの拒否
// ----------------------------------------------------------------

describe('不正 URL スキームの拒否', () => {
  it('data: スキームのリンクが無効化される', () => {
    const container = makeContainer();
    renderMarkdown(container, '[click](data:text/html,<script>alert(1)</script>)');
    const links = container.querySelectorAll('a');
    for (const link of Array.from(links)) {
      const href = link.getAttribute('href') ?? '';
      expect(href.toLowerCase()).not.toContain('data:');
    }
  });

  it('vbscript: スキームのリンクが無効化される', () => {
    const container = makeContainer();
    renderMarkdown(container, '[click](vbscript:msgbox(1))');
    const links = container.querySelectorAll('a');
    for (const link of Array.from(links)) {
      const href = link.getAttribute('href') ?? '';
      expect(href.toLowerCase()).not.toContain('vbscript:');
    }
  });
});

// ----------------------------------------------------------------
// テーブルレンダリング（F-504 拡張: GFM 風パイプテーブル）
// ----------------------------------------------------------------

describe('テーブルレンダリング', () => {
  it('基本テーブル（ヘッダ + 区切り + 2 行）が table/thead/tbody/th/td で構造化される', () => {
    const container = makeContainer();
    renderMarkdown(container, '| Name | Age |\n|---|---|\n| Alice | 30 |\n| Bob | 25 |');
    expect(container.querySelector('table.md-table')).not.toBeNull();
    expect(container.querySelector('thead')).not.toBeNull();
    expect(container.querySelector('tbody')).not.toBeNull();
    const ths = container.querySelectorAll('thead th');
    expect(ths.length).toBe(2);
    expect(ths[0].textContent).toBe('Name');
    expect(ths[1].textContent).toBe('Age');
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelectorAll('td')[0].textContent).toBe('Alice');
    expect(rows[0].querySelectorAll('td')[1].textContent).toBe('30');
    expect(rows[1].querySelectorAll('td')[0].textContent).toBe('Bob');
  });

  it('セル内の bold / italic / code / link がインラインで反映される', () => {
    const container = makeContainer();
    renderMarkdown(
      container,
      '| A | B |\n|---|---|\n| **bold** | `code` |\n| *italic* | [link](https://example.com) |',
    );
    const tds = container.querySelectorAll('tbody td');
    expect(tds[0].querySelector('strong')?.textContent).toBe('bold');
    expect(tds[1].querySelector('code')?.textContent).toBe('code');
    expect(tds[2].querySelector('em')?.textContent).toBe('italic');
    const a = tds[3].querySelector('a');
    expect(a?.textContent).toBe('link');
    expect(a?.getAttribute('href')).toBe('https://example.com');
  });

  it(':--- が left、:---: が center、---: が right の text-align になる', () => {
    const container = makeContainer();
    renderMarkdown(container, '| L | C | R | N |\n|:---|:---:|---:|---|\n| a | b | c | d |');
    const ths = container.querySelectorAll('thead th');
    expect((ths[0] as HTMLElement).style.textAlign).toBe('left');
    expect((ths[1] as HTMLElement).style.textAlign).toBe('center');
    expect((ths[2] as HTMLElement).style.textAlign).toBe('right');
    // none はスタイル未設定
    expect((ths[3] as HTMLElement).style.textAlign).toBe('');
    const tds = container.querySelectorAll('tbody td');
    expect((tds[0] as HTMLElement).style.textAlign).toBe('left');
    expect((tds[1] as HTMLElement).style.textAlign).toBe('center');
    expect((tds[2] as HTMLElement).style.textAlign).toBe('right');
    expect((tds[3] as HTMLElement).style.textAlign).toBe('');
  });

  it('列数が不揃い（ヘッダ 3 列、データ 2 列）の場合: 足りない td は空、余分は無視', () => {
    const container = makeContainer();
    renderMarkdown(container, '| A | B | C |\n|---|---|---|\n| x | y |');
    const row = container.querySelector('tbody tr');
    expect(row).not.toBeNull();
    const tds = row!.querySelectorAll('td');
    // ヘッダが 3 列なので td も 3 つ生成される
    expect(tds.length).toBe(3);
    expect(tds[0].textContent).toBe('x');
    expect(tds[1].textContent).toBe('y');
    expect(tds[2].textContent).toBe('');
  });

  it('表の前後に段落がある場合、段落と表が共存する', () => {
    const container = makeContainer();
    renderMarkdown(
      container,
      'Before\n\n| H1 | H2 |\n|---|---|\n| a | b |\n\nAfter',
    );
    const paras = container.querySelectorAll('p');
    expect(paras.length).toBe(2);
    expect(paras[0].textContent).toBe('Before');
    expect(paras[1].textContent).toBe('After');
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('区切り行がない場合（ただのパイプ行）は段落として扱う（誤検出しない）', () => {
    const container = makeContainer();
    // 2 行目が区切り行パターンでない
    renderMarkdown(container, '| a | b |\n| c | d |');
    expect(container.querySelector('table')).toBeNull();
    // 段落かテキストとして描画される
    expect(container.textContent).toContain('a');
    expect(container.textContent).toContain('b');
  });

  it('XSS: セルに <script> を入れても script 要素が生成されない', () => {
    const container = makeContainer();
    renderMarkdown(
      container,
      '| H |\n|---|\n| <script>alert(1)</script> |',
    );
    expect(container.querySelector('script')).toBeNull();
    // テキストとして表示
    expect(container.textContent).toContain('alert(1)');
  });

  it('XSS: セルに <img onerror> を入れても img/onerror 属性が生成されない', () => {
    const container = makeContainer();
    renderMarkdown(
      container,
      '| H |\n|---|\n| <img src=x onerror="alert(1)"> |',
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it('XSS: セル内の javascript: リンクが無効化される', () => {
    const container = makeContainer();
    renderMarkdown(
      container,
      '| H |\n|---|\n| [click](javascript:alert(1)) |',
    );
    const links = container.querySelectorAll('a');
    for (const link of Array.from(links)) {
      expect((link.getAttribute('href') ?? '').toLowerCase()).not.toContain('javascript:');
    }
    expect(container.textContent).toContain('click');
  });

  it('テーブルが md-table-wrapper コンテナに包まれる（横スクロール対応）', () => {
    const container = makeContainer();
    renderMarkdown(container, '| X |\n|---|\n| 1 |');
    const wrapper = container.querySelector('.md-table-wrapper');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('table.md-table')).not.toBeNull();
  });
});

// ----------------------------------------------------------------
// 複合テスト
// ----------------------------------------------------------------

describe('複合 Markdown レンダリング', () => {
  it('見出し + ul + コードブロック + リンクの組み合わせ', () => {
    const container = makeContainer();
    const md = `## Overview

- Point one
- Point two

\`\`\`ts
const a = 1;
\`\`\`

See [docs](https://docs.example.com) for more.`;

    renderMarkdown(container, md);

    expect(container.querySelector('h2')?.textContent).toBe('Overview');
    expect(container.querySelectorAll('li').length).toBe(2);
    expect(container.querySelector('pre.markdown-codeblock code')?.textContent).toContain('const a = 1;');
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://docs.example.com');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('空文字列を渡してもエラーにならない', () => {
    const container = makeContainer();
    expect(() => renderMarkdown(container, '')).not.toThrow();
  });
});
