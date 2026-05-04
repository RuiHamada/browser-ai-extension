// Explain タブの UI ロジック（F-004, F-005, F-012, F-013, F-203, F-204）
// ページ全体または選択範囲を Claude API に送り、解説を Side Panel に表示する

import { sanitizeErrorMessage, sanitizeErrorForLog } from '../lib/sanitize.js';
import { SHORT_CONTENT_THRESHOLD, SELECTION_MAX_CHARS } from '../content/extract.js';

/** Explain タブで使う DOM 要素の参照 */
interface ExplainElements {
  btnExplainWhole: HTMLButtonElement;
  btnExplainSelection: HTMLButtonElement;
  explainResult: HTMLElement;
  explainLoading: HTMLElement;
  explainError: HTMLElement;
  truncatedNotice: HTMLElement;
  shortContentWarning: HTMLElement;
  shortContentWarningText: HTMLElement;
  btnRunAnyway: HTMLButtonElement;
  btnCancelShort: HTMLButtonElement;
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
    shortContentWarning: get('shortContentWarning'),
    shortContentWarningText: get('shortContentWarningText'),
    btnRunAnyway: get('btnRunAnyway') as HTMLButtonElement,
    btnCancelShort: get('btnCancelShort') as HTMLButtonElement,
  };
}

/** 現在実行中かどうか（二重実行防止） */
let isRunning = false;

/**
 * 短文警告ボタンのリスナー管理用 AbortController
 * reset 時や新規実行時に abort() で古いリスナーを一括剥がす（F-203）
 */
let shortWarningController: AbortController | null = null;

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

/** 短文警告ブロックを表示する（F-203） */
function showShortWarning(charCount: number, els: ExplainElements): void {
  els.shortContentWarningText.textContent =
    `Extracted ${charCount} chars from this page. The result may not be useful.`;
  els.shortContentWarning.classList.remove('hidden');
}

/** 短文警告ブロックを非表示にする */
function hideShortWarning(els: ExplainElements): void {
  els.shortContentWarning.classList.add('hidden');
  els.shortContentWarningText.textContent = '';
}

/**
 * 短文警告ボタンの pending なリスナーを AbortController で一括剥がす（F-203）
 * reset 時や新規 runExplain 実行時に呼ぶ
 */
function abortShortWarning(): void {
  if (shortWarningController) {
    shortWarningController.abort();
    shortWarningController = null;
  }
}

/**
 * Claude API に送信して結果を表示する内部処理（F-005, whole モード）
 * @param contentToExplain 送信するテキスト
 * @param truncated 切り詰めが発生したかどうか
 * @param originalLength 切り詰め前の元の文字数
 */
async function doExplainRequest(
  contentToExplain: string,
  truncated: boolean,
  originalLength: number,
  els: ExplainElements,
): Promise<void> {
  // 切り詰め通知（F-012）
  if (truncated) {
    els.truncatedNotice.textContent =
      `Note: The page content was truncated (${originalLength.toLocaleString()} characters total, ` +
      `showing first ${contentToExplain.length.toLocaleString()} characters).`;
    els.truncatedNotice.classList.remove('hidden');
  }

  // background 経由で Claude API に送信（F-005, whole モード）
  const resp = await chrome.runtime.sendMessage({
    type: 'EXPLAIN',
    mode: 'whole',
    content: contentToExplain,
  }) as { text?: string; error?: string };

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
}

/**
 * 選択モードで Claude API に送信して結果を表示する内部処理（F-301, F-302）
 * @param selectionText 選択テキスト（raw、SELECTION_MAX_CHARS 以内に収められる）
 * @param pageContent ページ本文（空の場合はフォールバック）
 * @param pageContentTruncated ページ本文の切り詰め通知フラグ
 * @param pageContentOriginalLength ページ本文の切り詰め前文字数
 */
async function doSelectionExplainRequest(
  selectionText: string,
  pageContent: string,
  pageContentTruncated: boolean,
  pageContentOriginalLength: number,
  els: ExplainElements,
): Promise<void> {
  // ページ本文の切り詰め通知（F-012: 既存 UX に準ずる）
  if (pageContentTruncated) {
    els.truncatedNotice.textContent =
      `Note: The page content was truncated (${pageContentOriginalLength.toLocaleString()} characters total, ` +
      `showing first ${pageContent.length.toLocaleString()} characters).`;
    els.truncatedNotice.classList.remove('hidden');
  }

  // 選択テキストが SELECTION_MAX_CHARS を超える場合は切り詰め通知（F-302）
  const selectionTruncated = selectionText.length > SELECTION_MAX_CHARS;
  if (selectionTruncated) {
    // 既存の truncatedNotice に追記する（ページ本文切り詰めと重複する場合はまとめて表示）
    const existingText = els.truncatedNotice.textContent ?? '';
    const selectionNotice =
      `Note: The selected text was truncated to ${SELECTION_MAX_CHARS.toLocaleString()} characters ` +
      `(original: ${selectionText.length.toLocaleString()} characters).`;
    els.truncatedNotice.textContent = existingText
      ? `${existingText}\n${selectionNotice}`
      : selectionNotice;
    els.truncatedNotice.classList.remove('hidden');
  }

  // background 経由で Claude API に送信（F-301, F-302: 選択モード）
  const resp = await chrome.runtime.sendMessage({
    type: 'EXPLAIN',
    mode: 'selection',
    selectionText,
    pageContent,
  }) as { text?: string; error?: string };

  if (resp?.error) {
    showError(sanitizeErrorMessage(resp.error), els);
    return;
  }

  if (!resp?.text) {
    showError('Received an empty response from the API. Please try again.', els);
    return;
  }

  showResult(resp.text, els);
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
  hideShortWarning(els);
  // textContent を先にクリアしてから hidden にする（連続実行時に前回のテキストが残らないようにする）
  els.truncatedNotice.textContent = '';
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
    let truncated = false;
    let originalLength = 0;

    if (mode === 'selection') {
      // 選択テキストを取得（F-004, F-301）
      const selResp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTED_TEXT' }) as
        { selectedText: string };
      const selected = selResp?.selectedText?.trim() ?? '';
      if (!selected) {
        showError('No text is selected. Please select some text on the page first.', els);
        return;
      }

      // ページ本文も取得（F-301）。失敗した場合は空文字でフォールバック
      let pageContent = '';
      let pageContentTruncated = false;
      let pageContentOriginalLength = 0;
      try {
        const pageResp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' }) as
          { url: string; content: string; truncated: boolean; originalLength: number };
        pageContent = pageResp?.content ?? '';
        pageContentTruncated = pageResp?.truncated ?? false;
        pageContentOriginalLength = pageResp?.originalLength ?? 0;
      } catch {
        // content script が応答しない場合などはフォールバック（pageContent = '' のまま）
        console.error('[explain] ページ本文取得失敗（選択モードではフォールバック実行）');
      }

      // 選択モードでは F-203 の短文警告を表示しない（F-303）
      // F-204 の短文プロンプト切替は background 側で selectionText.length を見て行われる
      await doSelectionExplainRequest(
        selected,
        pageContent,
        pageContentTruncated,
        pageContentOriginalLength,
        els,
      );
      return;
    }

    // ページ全体モード: ページ本文を取得（F-003）
    const pageResp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' }) as
      { url: string; content: string; truncated: boolean; originalLength: number };

    if (!pageResp?.content?.trim()) {
      showError('Could not extract page content. The page may not be accessible.', els);
      return;
    }

    contentToExplain = pageResp.content;
    truncated = pageResp.truncated;
    originalLength = pageResp.originalLength;

    // 短文チェック（F-203）: ページ全体モードでのみ警告を表示
    // 40文字未満の場合は警告を表示し、ユーザーの確認を待つ
    if (contentToExplain.length < SHORT_CONTENT_THRESHOLD) {
      // 前回の未解決リスナーを AbortController で一括破棄（TAB_CHANGED リセット後の古いハンドラ発火を防ぐ）
      abortShortWarning();

      setRunning(false, els);
      showShortWarning(contentToExplain.length, els);

      // 今回の確認 UI 用 controller を生成
      const controller = new AbortController();
      shortWarningController = controller;

      // ユーザーが「Run anyway」または「Cancel」を押すまで待つ
      await new Promise<void>((resolve, reject) => {
        const capturedContent = contentToExplain;
        const capturedTruncated = truncated;
        const capturedOriginalLength = originalLength;

        const onRunAnyway = (): void => {
          // abort() を先に呼ぶことで onCancel リスナーも DOM から確実に剥がす（F-203）
          controller.abort();
          shortWarningController = null;
          hideShortWarning(els);
          setRunning(true, els);
          // 短文用プロンプト（F-204）は background 側で content 長を見て自動選択される
          doExplainRequest(capturedContent, capturedTruncated, capturedOriginalLength, els)
            .then(resolve)
            .catch(reject);
        };

        const onCancel = (): void => {
          // abort() を先に呼ぶことで onRunAnyway リスナーも DOM から確実に剥がす（F-203）
          controller.abort();
          shortWarningController = null;
          hideShortWarning(els);
          resolve();
        };

        // { signal } で登録することで controller.abort() 時に自動 removeEventListener される
        els.btnRunAnyway.addEventListener('click', onRunAnyway, { signal: controller.signal });
        els.btnCancelShort.addEventListener('click', onCancel, { signal: controller.signal });
      });

      return;
    }

    // 通常フロー: 警告なしで即 API 送信
    await doExplainRequest(contentToExplain, truncated, originalLength, els);
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
  // 短文警告の pending なリスナーを破棄する（TAB_CHANGED 後に古いハンドラが発火するのを防ぐ）
  abortShortWarning();
  try {
    const els = getElements();
    els.explainResult.textContent = '';
    els.explainResult.classList.add('hidden');
    clearError(els);
    els.truncatedNotice.classList.add('hidden');
    hideShortWarning(els);
    isRunning = false;
  } catch {
    // DOM がない場合は無視
  }
}
