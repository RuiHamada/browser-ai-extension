/** 選択位置の前後から、解説に必要な短い文脈を取得する。 */
export interface SelectionContext {
  before: string;
  after: string;
}

const CONTEXT_CHARS = 900;
const CONTENT_BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th';
const IGNORED_SELECTOR = [
  'script', 'style', 'noscript', 'nav', 'aside', 'footer', 'header',
  'form', 'svg', 'iframe', 'template', 'button', 'input', 'textarea',
  '[hidden]', '[aria-hidden="true"]', '#browser-ai-floating-host',
].join(',');

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 選択範囲を基準に取得するため、ページ先頭の本文切り詰めに左右されない。 */
export function getSelectionContext(selection: Selection, doc: Document = document): SelectionContext {
  if (selection.rangeCount === 0) return { before: '', after: '' };
  const range = selection.getRangeAt(0);
  if (typeof range.comparePoint !== 'function') return { before: '', after: '' };

  const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element
    : range.startContainer.parentElement;
  const block = startElement?.closest(CONTENT_BLOCK_SELECTOR);
  const localRoot = startElement?.closest('article, main, [role="main"]');
  const root = block?.contains(range.endContainer)
    ? block
    : localRoot?.contains(range.endContainer) ? localRoot : doc.body;
  if (!root) return { before: '', after: '' };

  let beforeText = '';
  let afterText = '';
  let afterLength = 0;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest(IGNORED_SELECTOR)) continue;
    const value = node.data;
    if (!value.trim()) continue;

    if (node === range.startContainer) {
      beforeText = `${beforeText} ${value.slice(0, range.startOffset)}`.slice(-CONTEXT_CHARS * 2);
    } else if (range.comparePoint(node, value.length) === -1) {
      beforeText = `${beforeText} ${value}`.slice(-CONTEXT_CHARS * 2);
    }

    if (node === range.endContainer) {
      const part = value.slice(range.endOffset);
      afterText += ` ${part}`;
      afterLength += part.length;
    } else if (range.comparePoint(node, 0) === 1) {
      afterText += ` ${value}`;
      afterLength += value.length;
    }

    if (afterLength >= CONTEXT_CHARS) break;
  }

  let before = normalize(beforeText).slice(-CONTEXT_CHARS);
  let after = normalize(afterText).slice(0, CONTEXT_CHARS);
  // 段落全体を選択した場合は、隣の段落を文脈として補う。
  if (root === block) {
    const previous = block.previousElementSibling;
    const next = block.nextElementSibling;
    if (!before && previous?.matches(CONTENT_BLOCK_SELECTOR)) {
      before = normalize(previous.textContent ?? '').slice(-CONTEXT_CHARS);
    }
    if (!after && next?.matches(CONTENT_BLOCK_SELECTOR)) {
      after = normalize(next.textContent ?? '').slice(0, CONTEXT_CHARS);
    }
  }
  return { before, after };
}
