// Explain タブの UI ロジック（F-004, F-005, F-012, F-013）
// ページ全体または選択範囲を Claude API に送り、英語解説を Side Panel に表示する

import { sanitizeErrorMessage, sanitizeErrorForLog } from '../lib/sanitize.js';

/** Explain タブで使う DOM 要素の参照 */
interface ExplainElements {
  btnExplainWhole: HTMLButtonElement;
  btnExplainSelection: HTMLButtonElement;
  explainResult: HTMLElement;
  explainLoading: HTMLElement;
  explainError: HTMLElement;
  truncatedNotice: HTMLElement;
}

/** DOM 要素を取得する（要素が存在しない場合はエラー） */
function getElements(): ExplainElements {
  const get = (id: string): HTMLElement => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element not found: ${id}`);
    return el;
  };
  return {
    btnExplainWhole: get('btnExplainWhole') as HTMLButtonElement,
    btnExplainSelection: get('btnExplainSelection') as HTMLButtonElement,
    explainResult: get('explainResult'),
    explainLoading: get('explainLoading'),
    explainError: get('explainError'),
    truncatedNotice: get('truncatedNotice'),
  };
}

/** 現在実行中かどうか（二重実行防止） */
let isRunning = false;

/** Explain の実行中状態を設定する */
function setRunning(running: boolean, els: ExplainElements): void {
  isRunning = running;
  els.btnExplainWhole.disabled = running;
  els.btnExplainSelection.disabled = running;
  els.explainLoading.classList.toggle('hidden', !running);
}

/** エラーメッセージを表示する（APIキーやスタックトレースは含めない） */
function showError(message: string, els: ExplainElements): void {
  els.explainError.textContent = message;
  els.explainError.classList.remove('hidden');
}

/** エラー表示をクリアする */
function clearError(els: ExplainElements): void {
  els.explainError.textContent = '';
  els.explainError.classList.add('hidden');
}

/** 結果テキストを表示する */
function showResult(text: string, els: ExplainElements): void {
  // 改行をそのまま表示するために textContent を使う
  els.explainResult.textContent = text;
  els.explainResult.classList.remove('hidden');
}

/**
 * ページ全体または選択範囲のテキストを取得してExplainを実行する（F-005）
 * @param mode 'whole' | 'selection'
 */
async function runExplain(mode: 'whole' | 'selection'): Promise<void> {
  if (isRunning) return;

  let els: ExplainElements;
  try {
    els = getElements();
  } catch (e) {
    console.error('[explain] DOM要素取得エラー:', e);
    return;
  }

  clearError(els);
  els.truncatedNotice.classList.add('hidden');
  setRunning(true, els);

  try {
    // アクティブタブを取得
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showError('Could not identify the active tab. Please try again.', els);
      return;
    }

    let contentToExplain: string;

    if (mode === 'selection') {
      // 選択テキストを取得（F-004）
      const selResp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTED_TEXT' }) as
        { selectedText: string };
      const selected = selResp?.selectedText?.trim() ?? '';
      if (!selected) {
        showError('No text is selected. Please select some text on the page first.', els);
        return;
      }
      contentToExplain = selected;
    } else {
      // ページ全体の本文を取得（F-003）
      const pageResp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' }) as
        { url: string; content: string; truncated: boolean; originalLength: number };

      if (!pageResp?.content?.trim()) {
        showError('Could not extract page content. The page may not be accessible.', els);
        return;
      }

      contentToExplain = pageResp.content;

      // 切り詰め通知（F-012）
      if (pageResp.truncated) {
        els.truncatedNotice.textContent =
          `Note: The page content was truncated (${pageResp.originalLength.toLocaleString()} characters total, ` +
          `showing first ${contentToExplain.length.toLocaleString()} characters).`;
        els.truncatedNotice.classList.remove('hidden');
      }
    }

    // background 経由で Claude API に送信（F-005）
    const resp = await chrome.runtime.sendMessage({ type: 'EXPLAIN', content: contentToExplain }) as
      { text?: string; error?: string };

    if (resp?.error) {
      // background から受け取ったエラーメッセージも深層防御として再 sanitize する（F-011）
      showError(sanitizeErrorMessage(resp.error), els);
      return;
    }

    if (!resp?.text) {
      showError('Received an empty response from the API. Please try again.', els);
      return;
    }

    showResult(resp.text, els);
  } catch (e) {
    // message・stack 両方をサニタイズしてからログに出す（APIキー漏洩防止）
    const safeLog = sanitizeErrorForLog(e);
    console.error('[explain] 実行エラー:', safeLog.message, safeLog.stack ?? '');
    // エラーメッセージからAPIキーを除外してから表示する
    const rawMsg = e instanceof Error ? e.message : String(e);
    const safeMsg = sanitizeErrorMessage(rawMsg);
    showError(safeMsg, els);
  } finally {
    setRunning(false, els);
  }
}

/** Explain タブを初期化してイベントリスナーを設定する */
export function initExplain(): void {
  let els: ExplainElements;
  try {
    els = getElements();
  } catch {
    // DOM 要素がまだ存在しない場合はスキップ
    return;
  }

  // 「ページ全体を Explain」ボタン（F-005）
  els.btnExplainWhole.addEventListener('click', () => {
    void runExplain('whole');
  });

  // 「選択範囲のみを Explain」ボタン（F-004）
  els.btnExplainSelection.addEventListener('click', () => {
    void runExplain('selection');
  });
}

/** Explain タブの状態をリセットする（タブ変更時などに呼ぶ） */
export function resetExplain(): void {
  try {
    const els = getElements();
    els.explainResult.textContent = '';
    els.explainResult.classList.add('hidden');
    clearError(els);
    els.truncatedNotice.classList.add('hidden');
    isRunning = false;
  } catch {
    // DOM がない場合は無視
  }
}
