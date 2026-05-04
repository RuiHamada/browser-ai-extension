/**
 * markdown.ts - 軽量な安全 Markdown -> DOM レンダラ（F-504）
 *
 * innerHTML を一切使わず document.createElement ベースで DOM ノードを直接組み立てる。
 * <script> / <iframe> 等の危険要素・on* 属性は絶対に生成しない。
 * リンクは http: / https: / mailto: のみ許可。
 * レンダリング例外時はプレーンテキストにフォールバックする。
 */

// ----------------------------------------------------------------
// URL スキーム検証
// ----------------------------------------------------------------

/** 安全な URL スキームかどうかを検証する */
function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:')
  );
}

// ----------------------------------------------------------------
// インライン要素パーサ（**bold**, *italic*, `code`, [link](url)）
// ----------------------------------------------------------------

/**
 * インライン Markdown 記法を含むテキストをパースして DOM ノード列を返す。
 * HTML タグは文字列として扱う（解釈しない）。
 */
function parseInline(text: string, doc: Document): Node[] {
  const nodes: Node[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // コードブロック記法（インライン）: `code`
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/s);
    if (codeMatch) {
      const [full, before, code] = codeMatch;
      if (before) nodes.push(...parseInlineSimple(before, doc));
      const codeEl = doc.createElement('code');
      codeEl.textContent = code;
      nodes.push(codeEl);
      remaining = remaining.slice(full.length);
      continue;
    }

    // リンク: [text](url)
    const linkMatch = remaining.match(/^(.*?)\[([^\]]*)\]\(([^)]*)\)/s);
    if (linkMatch) {
      const [full, before, linkText, href] = linkMatch;
      if (before) nodes.push(...parseInlineSimple(before, doc));
      if (isSafeUrl(href)) {
        const a = doc.createElement('a');
        a.textContent = linkText;
        a.setAttribute('href', href);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        nodes.push(a);
      } else {
        // 不正スキームはテキストのみ表示
        nodes.push(doc.createTextNode(linkText));
      }
      remaining = remaining.slice(full.length);
      continue;
    }

    // 残りはシンプルなインライン記法（太字・イタリック）に委譲
    nodes.push(...parseInlineSimple(remaining, doc));
    break;
  }

  return nodes;
}

/**
 * コード・リンク以外のインライン記法（**bold**, *italic*, _italic_）をパースする。
 * 再帰なしでシーケンシャルに処理する。
 */
function parseInlineSimple(text: string, doc: Document): Node[] {
  const nodes: Node[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // 太字: **...**
    const boldMatch = remaining.match(/^([\s\S]*?)\*\*([^*]+)\*\*/);
    // イタリック: *...* または _..._
    const italicStarMatch = remaining.match(/^([\s\S]*?)\*([^*]+)\*/);
    const italicUnderMatch = remaining.match(/^([\s\S]*?)_([^_]+)_/);

    // 最も早く現れる記法を優先
    type MatchEntry = { index: number; match: RegExpMatchArray; tag: 'strong' | 'em' };
    const candidates: MatchEntry[] = [];
    if (boldMatch) candidates.push({ index: boldMatch[1].length, match: boldMatch, tag: 'strong' });
    if (italicStarMatch) candidates.push({ index: italicStarMatch[1].length, match: italicStarMatch, tag: 'em' });
    if (italicUnderMatch) candidates.push({ index: italicUnderMatch[1].length, match: italicUnderMatch, tag: 'em' });

    if (candidates.length === 0) {
      nodes.push(doc.createTextNode(remaining));
      break;
    }

    // 最も前にある（index が最小の）候補を選ぶ。同じ場合は太字優先
    candidates.sort((a, b) => a.index - b.index || (a.tag === 'strong' ? -1 : 1));
    const best = candidates[0];
    const [full, before, inner] = best.match;

    if (before) nodes.push(doc.createTextNode(before));
    const el = doc.createElement(best.tag);
    el.textContent = inner;
    nodes.push(el);
    remaining = remaining.slice(full.length);
  }

  return nodes;
}

// ----------------------------------------------------------------
// ブロックレベルパーサ
// ----------------------------------------------------------------

/** コードブロックを表す内部型 */
interface CodeBlock {
  kind: 'codeblock';
  lang: string;
  code: string;
}

/** 見出しを表す内部型 */
interface HeadingBlock {
  kind: 'heading';
  level: 1 | 2 | 3;
  text: string;
}

/** 箇条書きアイテムを表す内部型 */
interface ListItem {
  kind: 'listitem';
  ordered: boolean;
  text: string;
}

/** 段落を表す内部型 */
interface ParagraphBlock {
  kind: 'paragraph';
  text: string;
}

/** 空行を表す内部型 */
interface BlankBlock {
  kind: 'blank';
}

/** 列アライメント */
type ColAlign = 'left' | 'center' | 'right' | 'none';

/** パイプテーブルを表す内部型（GFM 風） */
interface TableBlock {
  kind: 'table';
  alignments: ColAlign[];
  headers: string[];
  rows: string[][];
}

type Block = CodeBlock | HeadingBlock | ListItem | ParagraphBlock | BlankBlock | TableBlock;

// ----------------------------------------------------------------
// テーブルパーサ ユーティリティ
// ----------------------------------------------------------------

/**
 * パイプ区切り行をセル文字列配列に分解する。
 * 前後の | は任意。各セルは trim する。
 */
function splitTableRow(line: string): string[] {
  // 先頭・末尾の | を除去してから分割
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * 区切り行（|---|:---:|---:|）かどうかを判定し、列アライメントを返す。
 * 区切り行でなければ null を返す。
 */
function parseSeparatorRow(line: string): ColAlign[] | null {
  const cells = splitTableRow(line);
  const alignments: ColAlign[] = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) alignments.push('center');
    else if (right) alignments.push('right');
    else if (left) alignments.push('left');
    else alignments.push('none');
  }
  // 少なくとも 1 列必要
  if (alignments.length === 0) return null;
  return alignments;
}

/** パイプテーブルの行かどうか（| を含む行） */
function isTableRow(line: string): boolean {
  return line.includes('|');
}

/**
 * Markdown テキストをブロック列にパースする。
 * フェンス付きコードブロック（```）を優先的に処理し、
 * 残りを行単位で見出し / リスト / 段落に分類する。
 */
function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // コードブロック開始: ``` または ~~~
    const fenceMatch = line.match(/^(`{3,}|~{3,})\s*(\S*)/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const lang = fenceMatch[2] ?? '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence.slice(0, 3))) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 閉じ fence をスキップ
      blocks.push({ kind: 'codeblock', lang, code: codeLines.join('\n') });
      continue;
    }

    // 見出し: # / ## / ###
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 3) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: headingMatch[2].trim() });
      i++;
      continue;
    }

    // 順序なしリスト: - または *
    const ulMatch = line.match(/^[-*]\s+(.*)/);
    if (ulMatch) {
      blocks.push({ kind: 'listitem', ordered: false, text: ulMatch[1] });
      i++;
      continue;
    }

    // 順序付きリスト: 1. 2. など
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      blocks.push({ kind: 'listitem', ordered: true, text: olMatch[1] });
      i++;
      continue;
    }

    // 空行
    if (line.trim() === '') {
      blocks.push({ kind: 'blank' });
      i++;
      continue;
    }

    // パイプテーブル: ヘッダ行 + 区切り行 + 1行以上のデータ行
    if (isTableRow(line) && i + 1 < lines.length) {
      const separatorAlignments = parseSeparatorRow(lines[i + 1]);
      if (separatorAlignments !== null && isTableRow(lines[i + 1])) {
        const headers = splitTableRow(line);
        const colCount = headers.length;
        const rows: string[][] = [];
        i += 2; // ヘッダ行と区切り行をスキップ
        // データ行を連続して取り込む
        while (i < lines.length && isTableRow(lines[i]) && lines[i].trim() !== '') {
          const cells = splitTableRow(lines[i]);
          // 列数を正規化：足りない列は空文字、多い列は切り捨て
          const normalizedCells: string[] = [];
          for (let ci = 0; ci < colCount; ci++) {
            normalizedCells.push(cells[ci] ?? '');
          }
          rows.push(normalizedCells);
          i++;
        }
        // データ行がゼロ行の場合は表として扱わず段落にフォールバック
        if (rows.length > 0) {
          blocks.push({ kind: 'table', alignments: separatorAlignments, headers, rows });
          continue;
        }
        // フォールバック: i をヘッダ行に戻して段落として処理
        i -= 2;
      }
    }

    // 段落（連続行を結合）
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^(#{1,3}\s|[-*]\s|\d+\.\s|`{3,}|~{3,})/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ kind: 'paragraph', text: paraLines.join('\n') });
  }

  return blocks;
}

/**
 * ブロック列を DOM 要素列に変換する。
 * 連続するリストアイテムは同一の <ul>/<ol> にまとめる。
 */
function blocksToDOM(blocks: Block[], doc: Document): Node[] {
  const nodes: Node[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];

    if (block.kind === 'blank') {
      i++;
      continue;
    }

    if (block.kind === 'heading') {
      const tagName = `h${block.level}` as 'h1' | 'h2' | 'h3';
      const el = doc.createElement(tagName);
      for (const node of parseInline(block.text, doc)) {
        el.appendChild(node);
      }
      nodes.push(el);
      i++;
      continue;
    }

    if (block.kind === 'codeblock') {
      const pre = doc.createElement('pre');
      pre.classList.add('markdown-codeblock');
      const code = doc.createElement('code');
      if (block.lang) code.dataset['lang'] = block.lang;
      code.textContent = block.code;
      pre.appendChild(code);
      nodes.push(pre);
      i++;
      continue;
    }

    if (block.kind === 'listitem') {
      // 連続する同種リストアイテムをグループ化
      const isOrdered = block.ordered;
      const listEl = doc.createElement(isOrdered ? 'ol' : 'ul');
      while (i < blocks.length && blocks[i].kind === 'listitem') {
        const item = blocks[i] as ListItem;
        if (item.ordered !== isOrdered) break;
        const li = doc.createElement('li');
        for (const node of parseInline(item.text, doc)) {
          li.appendChild(node);
        }
        listEl.appendChild(li);
        i++;
      }
      nodes.push(listEl);
      continue;
    }

    if (block.kind === 'table') {
      // テーブル全体をスクロール可能なコンテナで包む
      const wrapper = doc.createElement('div');
      wrapper.classList.add('md-table-wrapper');

      const table = doc.createElement('table');
      table.classList.add('md-table');

      // ヘッダ行
      const thead = doc.createElement('thead');
      const headerRow = doc.createElement('tr');
      for (let ci = 0; ci < block.headers.length; ci++) {
        const th = doc.createElement('th');
        const align = block.alignments[ci] ?? 'none';
        if (align !== 'none') th.style.textAlign = align;
        for (const node of parseInline(block.headers[ci], doc)) {
          th.appendChild(node);
        }
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // データ行
      const tbody = doc.createElement('tbody');
      for (const rowCells of block.rows) {
        const tr = doc.createElement('tr');
        for (let ci = 0; ci < block.headers.length; ci++) {
          const td = doc.createElement('td');
          const align = block.alignments[ci] ?? 'none';
          if (align !== 'none') td.style.textAlign = align;
          for (const node of parseInline(rowCells[ci] ?? '', doc)) {
            td.appendChild(node);
          }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);

      wrapper.appendChild(table);
      nodes.push(wrapper);
      i++;
      continue;
    }

    if (block.kind === 'paragraph') {
      const p = doc.createElement('p');
      // 行末改行を <br> に変換する
      const lines = block.text.split('\n');
      for (let li = 0; li < lines.length; li++) {
        const inlineNodes = parseInline(lines[li], doc);
        for (const n of inlineNodes) p.appendChild(n);
        if (li < lines.length - 1) {
          p.appendChild(doc.createElement('br'));
        }
      }
      nodes.push(p);
      i++;
      continue;
    }

    // 到達しないはずだが型安全のためスキップ
    i++;
  }

  return nodes;
}

// ----------------------------------------------------------------
// 公開 API
// ----------------------------------------------------------------

/**
 * Markdown テキストをパースして container DOM 要素に追加する（F-504）。
 *
 * - innerHTML を一切使わないため XSS-safe
 * - <script> / <iframe> 等の危険要素は生成しない
 * - on* 属性は生成しない
 * - リンクは http: / https: / mailto: のみ許可
 * - 例外が発生した場合はプレーンテキストにフォールバックする
 *
 * @param container 描画先 DOM 要素（既存の子要素はクリアしない）
 * @param markdown Markdown 文字列
 * @param doc DOM ファクトリ（省略時は window.document）
 */
export function renderMarkdown(
  container: HTMLElement,
  markdown: string,
  doc: Document = document,
): void {
  try {
    const blocks = parseBlocks(markdown);
    const domNodes = blocksToDOM(blocks, doc);
    for (const node of domNodes) {
      container.appendChild(node);
    }
  } catch (err) {
    // レンダリング失敗時はプレーンテキストにフォールバック（F-504）
    console.error('[markdown] レンダリング失敗、プレーンテキストにフォールバック:', err);
    container.textContent = markdown;
  }
}
