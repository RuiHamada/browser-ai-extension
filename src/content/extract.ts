// DOM本文抽出ロジック（F-003）
// <script> / <style> / <noscript> を除外し、本文相当のテキストを抽出する

/** 抽出テキストの上限文字数（F-012: 長大ページの切り詰め） */
export const CONTENT_MAX_CHARS = 20000;

/** 除外するタグ名の一覧 */
const EXCLUDED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'TITLE']);

/**
 * DOMツリーを再帰的に走査してテキストノードを収集する。
 * 除外タグ配下のノードはスキップする。
 */
function collectText(node: Node, parts: string[]): void {
  // 要素ノードの場合、除外タグなら再帰をスキップ
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (EXCLUDED_TAGS.has(el.tagName)) return;
    // hidden 要素はスキップ（CSSによる hidden チェックは content script なので style は利用できないが
    // aria-hidden や hidden 属性は除外する）
    if (el.getAttribute('aria-hidden') === 'true') return;
    if (el.hasAttribute('hidden')) return;
    for (const child of el.childNodes) {
      collectText(child, parts);
    }
    return;
  }

  // テキストノードの場合、トリムして空でなければ追加
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim();
    if (text) parts.push(text);
  }
}

export interface ExtractResult {
  /** 抽出されたページ本文テキスト */
  content: string;
  /** 切り詰めが発生したかどうか */
  truncated: boolean;
  /** 切り詰め前の元の文字数 */
  originalLength: number;
}

/**
 * ページ全体の本文テキストを抽出する（F-003）
 * <script> / <style> / <noscript> を除外し、最大 CONTENT_MAX_CHARS 文字に切り詰める
 */
export function extractPageContent(doc: Document = document): ExtractResult {
  const parts: string[] = [];
  collectText(doc.body ?? doc.documentElement, parts);
  const raw = parts.join('\n');
  const originalLength = raw.length;

  if (originalLength > CONTENT_MAX_CHARS) {
    return {
      content: raw.slice(0, CONTENT_MAX_CHARS),
      truncated: true,
      originalLength,
    };
  }

  return {
    content: raw,
    truncated: false,
    originalLength,
  };
}
