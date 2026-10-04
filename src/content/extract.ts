// DOM本文抽出ロジック（F-003, F-202）
// <script> / <style> / <noscript> などを除外し、本文コンテナを優先して抽出する

/** 抽出テキストの上限文字数（F-012: 長大ページの切り詰め） */
export const CONTENT_MAX_CHARS = 20000;

/** 選択テキストの上限文字数（F-302: 長い選択の切り詰め） */
export const SELECTION_MAX_CHARS = 5000;

/**
 * 抽出結果が極端に短い場合の警告閾値（F-203, F-204）
 * 空白正規化後の文字数がこれ未満の場合、短文扱いとする
 */
export const SHORT_CONTENT_THRESHOLD = 40;

/**
 * テキスト収集から除外するタグ名の一覧（大文字で統一、F-202）
 * 既存: SCRIPT / STYLE / NOSCRIPT / HEAD / META / LINK / TITLE
 * 追加: NAV / ASIDE / FOOTER / HEADER / FORM / SVG / IFRAME / TEMPLATE / BUTTON
 */
const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'TITLE',
  'NAV', 'ASIDE', 'FOOTER', 'HEADER', 'FORM', 'SVG', 'IFRAME', 'TEMPLATE', 'BUTTON',
]);

/**
 * DOMツリーを再帰的に走査してテキストノードを収集する（F-202）
 * - 除外タグ配下のノードはスキップ
 * - aria-hidden="true" / hidden 属性の要素はスキップ
 * - open な Shadow Root が存在すればその子ノードも再帰収集
 */
function collectText(node: Node, parts: string[]): void {
  // 要素ノードの場合
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;

    // 拡張機能がページ上に挿入したポップアップを本文に混ぜない。
    if (el.id === 'browser-ai-floating-host') return;

    // 除外タグはスキップ（SVG名前空間は tagName が小文字になるため toUpperCase で統一）
    if (EXCLUDED_TAGS.has(el.tagName.toUpperCase())) return;

    // aria-hidden="true" の要素はスキップ
    if (el.getAttribute('aria-hidden') === 'true') return;

    // hidden 属性のある要素はスキップ
    if (el.hasAttribute('hidden')) return;

    // 通常の子ノードを再帰収集
    for (const child of el.childNodes) {
      collectText(child, parts);
    }

    // open な Shadow Root が存在すればその子ノードも収集（F-202: Shadow DOM 対応）
    const shadow = (el as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot;
    if (shadow && shadow.mode === 'open') {
      for (const child of shadow.childNodes) {
        collectText(child, parts);
      }
    }

    return;
  }

  // テキストノードの場合、トリムして空でなければ追加
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim();
    if (text) parts.push(text);
  }
}

/**
 * 本文コンテナを優先順で選択する（F-202）
 * 優先順: <main> → <article>（最大 innerText 長） → [role="main"] → <body>（フォールバック）
 */
function selectContainer(doc: Document): Element {
  // 1. <main> 要素（最初の1つ）
  const main = doc.querySelector('main');
  if (main) return main;

  // 2. <article> 要素（複数あれば最大テキスト長のもの）
  const articles = Array.from(doc.querySelectorAll('article'));
  if (articles.length > 0) {
    const largest = articles.reduce((best, curr) =>
      (curr.textContent?.length ?? 0) > (best.textContent?.length ?? 0) ? curr : best
    );
    return largest;
  }

  // 3. role="main" を持つ要素
  const roleMain = doc.querySelector('[role="main"]');
  if (roleMain) return roleMain;

  // 4. フォールバック: <body>
  return doc.body ?? doc.documentElement;
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
 * テキストノード配列を正規化してひとつの文字列にまとめる
 * - すべての空白・改行・タブを単一スペースに正規化（F-202: 「連続する空白・改行を1つにまとめる」）
 * - 前後トリム
 */
function normalizeText(parts: string[]): string {
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * ページ全体の本文テキストを抽出する（F-003, F-202）
 * - 本文コンテナ優先選択（main > article > [role="main"] > body）
 * - 除外タグ拡張（nav / aside / footer / header 等）
 * - open Shadow DOM 走査
 * - 空白正規化（改行・タブ・連続空白すべてを単一スペース1つに正規化）
 * - セマンティックコンテナの抽出結果が SHORT_CONTENT_THRESHOLD 未満の場合は body で再抽出してより長い方を採用（F-202）
 * - 最大 CONTENT_MAX_CHARS 文字に切り詰め
 */
export function extractPageContent(doc: Document = document): ExtractResult {
  const container = selectContainer(doc);
  const parts: string[] = [];
  collectText(container, parts);
  const normalized = normalizeText(parts);

  // body フォールバック（F-202）:
  // セマンティックコンテナ（main/article/role=main）を選択したが、抽出結果が短すぎる場合は
  // body 全体で再抽出して長い方を採用する。両方短ければセマンティックコンテナの結果を優先。
  const bodyEl = doc.body ?? doc.documentElement;
  let finalContent = normalized;
  if (container !== bodyEl && normalized.length < SHORT_CONTENT_THRESHOLD) {
    const bodyParts: string[] = [];
    collectText(bodyEl, bodyParts);
    const bodyNormalized = normalizeText(bodyParts);
    if (bodyNormalized.length > normalized.length) {
      finalContent = bodyNormalized;
    }
  }

  const originalLength = finalContent.length;

  if (originalLength > CONTENT_MAX_CHARS) {
    return {
      content: finalContent.slice(0, CONTENT_MAX_CHARS),
      truncated: true,
      originalLength,
    };
  }

  return {
    content: finalContent,
    truncated: false,
    originalLength,
  };
}
