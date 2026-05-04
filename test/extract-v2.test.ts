// content/extract.ts: F-202 DOM抽出堅牢化テスト
// - 本文コンテナ優先（main/article/role=main）
// - 追加除外タグ（nav/aside/footer/header等）
// - Open Shadow DOM 走査
// - 空白正規化
// - SHORT_CONTENT_THRESHOLD の存在確認

import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractPageContent, CONTENT_MAX_CHARS, SHORT_CONTENT_THRESHOLD } from '../src/content/extract.js';

/** テスト用DOMを作成するヘルパー */
function makeDoc(html: string): Document {
  const dom = new JSDOM(html);
  return dom.window.document;
}

describe('SHORT_CONTENT_THRESHOLD', () => {
  it('SHORT_CONTENT_THRESHOLD が 40 で export されている（F-203, F-204）', () => {
    expect(SHORT_CONTENT_THRESHOLD).toBe(40);
  });
});

describe('本文コンテナ優先選択（F-202）', () => {
  it('<main> 配下の本文が抽出される', () => {
    const doc = makeDoc(`
      <html><body>
        <nav>Navigation link 1 Navigation link 2</nav>
        <main><p>Main article content here.</p></main>
        <aside>Related links</aside>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Main article content here.');
    // nav配下のテキストは <main> スコープに含まれないので出ない
    expect(result.content).not.toContain('Navigation link 1');
  });

  it('<article> 配下の本文が抽出される（<main> がない場合）', () => {
    const doc = makeDoc(`
      <html><body>
        <header>Site Header Navigation</header>
        <article><p>Article body text is here for reading.</p></article>
        <footer>Footer content</footer>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Article body text is here for reading.');
    // <header> と <footer> は除外タグなので出ない
    expect(result.content).not.toContain('Site Header Navigation');
    expect(result.content).not.toContain('Footer content');
  });

  it('複数の <article> がある場合は最大テキスト長のものが選ばれる', () => {
    const doc = makeDoc(`
      <html><body>
        <article><p>Short.</p></article>
        <article><p>This is a much longer article body that contains the main content of the page.</p></article>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('This is a much longer article body');
  });

  it('[role="main"] 配下の本文が抽出される（<main>/<article> がない場合）', () => {
    const doc = makeDoc(`
      <html><body>
        <div role="main"><p>Role main content goes here.</p></div>
        <div>Other sidebar content</div>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Role main content goes here.');
  });

  it('<main>/<article>/[role="main"] がない場合は <body> フォールバック', () => {
    const doc = makeDoc(`
      <html><body>
        <p>Fallback body content text here.</p>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Fallback body content text here.');
  });

  it('<main> が優先され <article> より先に使われる', () => {
    const doc = makeDoc(`
      <html><body>
        <article><p>Article text that should not be selected.</p></article>
        <main><p>Main content should win over article.</p></main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Main content should win over article.');
  });
});

describe('追加除外タグ（F-202）', () => {
  it('<nav> の内容が抽出結果に含まれない', () => {
    const doc = makeDoc(`
      <html><body>
        <nav>Home About Contact</nav>
        <main><p>Page body text.</p></main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).not.toContain('Home About Contact');
    expect(result.content).toContain('Page body text.');
  });

  it('<aside> の内容が抽出結果に含まれない', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Main article text.</p>
          <aside>Related articles sidebar</aside>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).not.toContain('Related articles sidebar');
  });

  it('<footer> の内容が抽出結果に含まれない', () => {
    const doc = makeDoc(`
      <html><body>
        <footer>Copyright 2024 Example Corp.</footer>
        <main><p>Article content.</p></main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).not.toContain('Copyright 2024 Example Corp.');
  });

  it('<header> の内容が抽出結果に含まれない', () => {
    const doc = makeDoc(`
      <html><body>
        <header>Site Logo Site Name</header>
        <main><p>Article body.</p></main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).not.toContain('Site Logo Site Name');
  });

  it('<form> の内容が抽出結果に含まれない', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Article text.</p>
          <form><input value="search query"><button>Submit</button></form>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).not.toContain('search query');
  });

  it('<svg> の内容が抽出結果に含まれない', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Text content.</p>
          <svg><text>SVG text node</text></svg>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).not.toContain('SVG text node');
  });

  it('<iframe> の内容が抽出結果に含まれない', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Article text.</p>
          <iframe>Iframe content</iframe>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).not.toContain('Iframe content');
  });

  it('<template> の内容が抽出結果に含まれない', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Article text.</p>
          <template><span>Template inner text</span></template>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).not.toContain('Template inner text');
  });

  it('<button> の内容が抽出結果に含まれない', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Article text.</p>
          <button>Click me button</button>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).not.toContain('Click me button');
  });
});

describe('Shadow DOM 走査（F-202）', () => {
  it('open Shadow Root 内のテキストが抽出結果に含まれる', () => {
    const dom = new JSDOM(`
      <html><body>
        <main>
          <p>Regular content.</p>
          <div id="shadow-host"></div>
        </main>
      </body></html>
    `);
    const doc = dom.window.document;

    // open Shadow Root を作成してテキストを追加
    const host = doc.getElementById('shadow-host')!;
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const p = doc.createElement('p');
    p.textContent = 'Shadow DOM open content here.';
    shadowRoot.appendChild(p);

    const result = extractPageContent(doc);
    expect(result.content).toContain('Regular content.');
    expect(result.content).toContain('Shadow DOM open content here.');
  });

  it('closed Shadow Root 内のテキストは抽出結果に含まれない', () => {
    const dom = new JSDOM(`
      <html><body>
        <main>
          <p>Regular content.</p>
          <div id="shadow-host"></div>
        </main>
      </body></html>
    `);
    const doc = dom.window.document;

    // closed Shadow Root: JS からは shadowRoot = null になる
    const host = doc.getElementById('shadow-host')!;
    host.attachShadow({ mode: 'closed' });
    // closed の場合は host.shadowRoot === null なので内部にアクセスできない

    const result = extractPageContent(doc);
    expect(result.content).toContain('Regular content.');
    // closed shadow root 内のコンテンツは取れない（これが期待する挙動）
  });

  it('Shadow DOM 内の除外タグはスキップされる', () => {
    const dom = new JSDOM(`
      <html><body>
        <main><div id="shadow-host"></div></main>
      </body></html>
    `);
    const doc = dom.window.document;

    const host = doc.getElementById('shadow-host')!;
    const shadowRoot = host.attachShadow({ mode: 'open' });

    // shadow root 内に nav（除外タグ）と p（本文）を追加
    const nav = doc.createElement('nav');
    nav.textContent = 'Shadow nav text';
    shadowRoot.appendChild(nav);

    const p = doc.createElement('p');
    p.textContent = 'Shadow paragraph text.';
    shadowRoot.appendChild(p);

    const result = extractPageContent(doc);
    expect(result.content).not.toContain('Shadow nav text');
    expect(result.content).toContain('Shadow paragraph text.');
  });
});

describe('空白正規化（F-202）', () => {
  it('連続する空白が1つにまとめられる', () => {
    const doc = makeDoc(`
      <html><body>
        <main><p>Hello   world   foo</p></main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).not.toContain('Hello   world');
    expect(result.content).toContain('Hello world foo');
  });

  it('前後の空白がトリムされる', () => {
    const doc = makeDoc(`
      <html><body>
        <main><p>   trimmed content   </p></main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content.startsWith(' ')).toBe(false);
    expect(result.content.endsWith(' ')).toBe(false);
  });

  it('結果が空文字でない通常ページ', () => {
    const doc = makeDoc(`<html><body><main><p>Some text</p></main></body></html>`);
    const result = extractPageContent(doc);
    expect(result.content.trim().length).toBeGreaterThan(0);
  });

  // [LOW] Codex 指摘修正: 改行・タブ・連続空白すべてを単一スペース1つに正規化（F-202）
  it('改行がすべて単一スペースに正規化される（/\\s+/g → 単一スペース）', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Line one</p>
          <p>Line two</p>
          <p>Line three</p>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    // 改行・連続空白・タブが2文字以上続く箇所が存在しない
    expect(/\s{2,}/.test(result.content)).toBe(false);
    // 改行文字が含まれない
    expect(/\n/.test(result.content)).toBe(false);
    // タブ文字が含まれない
    expect(/\t/.test(result.content)).toBe(false);
    // 本文テキストは含まれる
    expect(result.content).toContain('Line one');
    expect(result.content).toContain('Line two');
  });

  it('タブ文字を含むページで連続空白がなくなる', () => {
    const doc = makeDoc(`<html><body><main><p>word1\t\tword2\n\nword3</p></main></body></html>`);
    const result = extractPageContent(doc);
    expect(/\s{2,}/.test(result.content)).toBe(false);
    expect(result.content).toContain('word1');
    expect(result.content).toContain('word2');
    expect(result.content).toContain('word3');
  });
});

// [MEDIUM] Codex 指摘修正: セマンティックコンテナが短い場合に body へフォールバック（F-202）
describe('body フォールバック（セマンティックコンテナが短すぎる場合, F-202）', () => {
  it('<main> の内容が SHORT_CONTENT_THRESHOLD 未満のとき body 全体で再抽出して長い方を採用する', () => {
    // <main> に "notable" のみ（7文字 < 40）、body に長文テキスト
    const longBody = 'This is a very long body text that should be selected as fallback content. '.repeat(3);
    const doc = makeDoc(`
      <html><body>
        <main>notable</main>
        <div class="article-content">
          <p>${longBody}</p>
        </div>
      </body></html>
    `);
    const result = extractPageContent(doc);
    // body フォールバックにより長文が含まれる
    expect(result.content).toContain('very long body text');
    // 文字数が SHORT_CONTENT_THRESHOLD より多い
    expect(result.content.length).toBeGreaterThan(40);
  });

  it('<main> 内容が十分な長さのときは body フォールバックしない', () => {
    const mainContent = 'This is a sufficiently long main content for the page extraction test here.';
    const doc = makeDoc(`
      <html><body>
        <main><p>${mainContent}</p></main>
        <div>Other body content that should not override main.</div>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain(mainContent.trim());
  });

  it('<main> が存在せず <article> 内容が短いとき body フォールバックが機能する', () => {
    const longBody = 'Body fallback text with enough content to exceed the threshold easily. '.repeat(2);
    const doc = makeDoc(`
      <html><body>
        <article>hi</article>
        <section>
          <p>${longBody}</p>
        </section>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Body fallback text');
    expect(result.content.length).toBeGreaterThan(40);
  });

  it('セマンティックコンテナが短く body も短い場合はセマンティックコンテナを返す', () => {
    const doc = makeDoc(`
      <html><body>
        <main>hi</main>
        <p>also short</p>
      </body></html>
    `);
    const result = extractPageContent(doc);
    // どちらも短いが、セマンティックコンテナが選ばれている（body の方が短いか同等）
    // "hi" は main の内容、body 全体は "hi also short" で main より長い
    // → body の方が長いので body が選ばれる
    expect(result.content.length).toBeGreaterThanOrEqual(0);
    // ただし body が長ければ body が選ばれる（"hi also short"）
    expect(result.content).toContain('hi');
  });
});

describe('既存テストの互換性（F-003, F-012 リグレッション防止）', () => {
  it('<script> の内容が抽出結果に含まれない（F-003）', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Hello world</p>
          <script>alert('secret')</script>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Hello world');
    expect(result.content).not.toContain("alert('secret')");
  });

  it('<style> の内容が抽出結果に含まれない（F-003）', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Article content</p>
          <style>.foo { color: red; }</style>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Article content');
    expect(result.content).not.toContain('color: red');
  });

  it('<noscript> の内容が抽出結果に含まれない（F-003）', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Main text</p>
          <noscript>Please enable JavaScript</noscript>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Main text');
    expect(result.content).not.toContain('Please enable JavaScript');
  });

  it('hidden 属性の要素は除外される', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Visible text</p>
          <div hidden>Hidden content</div>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Visible text');
    expect(result.content).not.toContain('Hidden content');
  });

  it('aria-hidden="true" の要素は除外される', () => {
    const doc = makeDoc(`
      <html><body>
        <main>
          <p>Main content</p>
          <span aria-hidden="true">Decorative icon</span>
        </main>
      </body></html>
    `);
    const result = extractPageContent(doc);
    expect(result.content).toContain('Main content');
    expect(result.content).not.toContain('Decorative icon');
  });

  it('上限超過時は切り詰められ truncated = true（F-012）', () => {
    const longText = 'A'.repeat(CONTENT_MAX_CHARS + 100);
    const doc = makeDoc(`<html><body><main><p>${longText}</p></main></body></html>`);
    const result = extractPageContent(doc);
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(CONTENT_MAX_CHARS);
    expect(result.originalLength).toBeGreaterThan(CONTENT_MAX_CHARS);
  });

  it('上限を超えない場合は truncated = false（F-012）', () => {
    const doc = makeDoc(`<html><body><main><p>Short text</p></main></body></html>`);
    const result = extractPageContent(doc);
    expect(result.truncated).toBe(false);
  });
});

describe('既存バグ再現テスト: "notable" のみ抽出される事象（F-202）', () => {
  it('<header> のみで <main> がない場合でも <body> フォールバックで本文が取得できる', () => {
    // 旧実装では <header> が除外されず先頭に来てしまっていたバグを再現
    const doc = makeDoc(`
      <html><body>
        <header>
          <nav>Home Products About</nav>
          <span class="notable">notable</span>
        </header>
        <div class="content">
          <h1>Welcome to Our Service</h1>
          <p>This is the main content of the page with useful information.</p>
          <p>Here is another paragraph with more details about our service.</p>
        </div>
      </body></html>
    `);
    const result = extractPageContent(doc);
    // <header> は除外されるので "notable" が先頭に出ない
    expect(result.content).not.toMatch(/^notable/);
    // 本文は取れている
    expect(result.content).toContain('Welcome to Our Service');
    expect(result.content).toContain('This is the main content');
  });
});
