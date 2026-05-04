// 単一 Chat 画面のロジック（F-401〜F-404）
// クイックアクション・Welcome メッセージ・短文警告・自由入力 Chat を統合

import type { ChatMessage } from '../types/messages.js';
import { sanitizeErrorMessage, sanitizeErrorForLog } from '../lib/sanitize.js';
import { CONTENT_MAX_CHARS, SELECTION_MAX_CHARS, SHORT_CONTENT_THRESHOLD } from '../content/extract.js';

// ----------------------------------------------------------------
// クイックアクション定義（F-402: ラベル・プロンプト本文は仕様で固定）
// ----------------------------------------------------------------

/** クイックアクションの種別 */
type QuickActionKind = 'whole-page' | 'selection';

interface QuickAction {
  /** HTML 要素 ID */
  id: string;
  /** ボタンラベル */
  label: string;
  /** 種別（ページ本文取得 / 選択テキスト取得） */
  kind: QuickActionKind;
  /** user バブルに表示され、かつ API に送信される固定プロンプト本文（F-402 表） */
  prompt: string;
}

/** F-402 表に基づく 6 個のクイックアクション（順序・文言は仕様で固定） */
const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'qaExplainPage',
    label: 'Explain page',
    kind: 'whole-page',
    prompt: 'Explain this page in clear English. Cover the main topic, key points, and any important terminology.',
  },
  {
    id: 'qaExplainSelection',
    label: 'Explain selection',
    kind: 'selection',
    prompt: 'Explain the selected text within the context of this page. Clarify meaning, usage, and any nuance.',
  },
  {
    id: 'qaSummary',
    label: 'Summary',
    kind: 'whole-page',
    prompt: 'Summarize this page in 5 concise bullet points.',
  },
  {
    id: 'qaDetailed',
    label: 'Detailed',
    kind: 'whole-page',
    prompt: 'Provide a detailed explanation of this page, including background context and implications.',
  },
  {
    id: 'qaBeginner',
    label: 'Beginner-friendly',
    kind: 'whole-page',
    prompt: 'Explain this page as if to a beginner with no prior knowledge of the topic. Use simple words and short sentences.',
  },
  {
    id: 'qaExpert',
    label: 'Expert-level',
    kind: 'whole-page',
    prompt: 'Explain this page at an expert level. Use precise terminology and discuss subtle technical details.',
  },
];

// ----------------------------------------------------------------
// DOM 要素の型
// ----------------------------------------------------------------

interface ChatElements {
  chatMessages: HTMLElement;
  chatInput: HTMLTextAreaElement;
  btnChatSend: HTMLButtonElement;
  btnChatClear: HTMLButtonElement;
  shortContentWarning: HTMLElement;
  shortContentWarningText: HTMLElement;
  btnRunAnyway: HTMLButtonElement;
  btnCancelShort: HTMLButtonElement;
}

// ----------------------------------------------------------------
// モジュールスコープ状態（セッション中のみ保持）
// ----------------------------------------------------------------

/** セッション中の会話履歴（永続化しない） */
let chatHistory: ChatMessage[] = [];

/** 現在ページの本文キャッシュ（URL が変わったらクリア） */
let cachedPageContent = '';

/** 現在 API 呼び出し中かどうか（二重送信防止） */
let isSending = false;

/**
 * 短文警告ボタンの pending なリスナーを AbortController で一括剥がす。
 * resetChat 時や新規クイックアクション実行時に呼ぶ（F-203）
 */
let shortWarningController: AbortController | null = null;

/**
 * 世代カウンタ: pre-fetch / API 呼び出し中に resetChat() が呼ばれた場合に
 * stale な描画・履歴追加を防ぐ（HIGH-1 拡張）
 * - resetChat() だけがインクリメントする
 * - runQuickAction / sendFreeInput / onRunAnyway は最初に currentGeneration をスナップショットし、
 *   各 await 後に isStale() でチェックする
 */
let currentGeneration = 0;

/** stale チェックヘルパー: gen が現在の世代と一致しない場合 true */
function isStale(gen: number): boolean {
  return gen !== currentGeneration;
}

/**
 * 選択コンテキストモード（HIGH-2: F-403 follow-up での selection 引き継ぎ）
 * - 'selection': Explain selection クイックアクション後の follow-up も selection コンテキストを使う
 * - 'whole': whole-page 系に切り替えた後
 * - null: 未設定（通常モード）
 */
let currentContextMode: 'whole' | 'selection' | null = null;

/** 選択モード時に保持する選択テキスト（resetChat() でクリアする） */
let currentSelectionText: string | null = null;

// ----------------------------------------------------------------
// DOM ヘルパー
// ----------------------------------------------------------------

/** DOM 要素を取得する（要素がなければ例外） */
function getElements(): ChatElements {
  const get = (id: string): HTMLElement => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element not found: ${id}`);
    return el;
  };
  return {
    chatMessages: get('chatMessages'),
    chatInput: get('chatInput') as HTMLTextAreaElement,
    btnChatSend: get('btnChatSend') as HTMLButtonElement,
    btnChatClear: get('btnChatClear') as HTMLButtonElement,
    shortContentWarning: get('shortContentWarning'),
    shortContentWarningText: get('shortContentWarningText'),
    btnRunAnyway: get('btnRunAnyway') as HTMLButtonElement,
    btnCancelShort: get('btnCancelShort') as HTMLButtonElement,
  };
}

/** クイックアクションボタン要素を取得する（存在しない要素はスキップ） */
function getQuickActionButtons(): HTMLButtonElement[] {
  return QUICK_ACTIONS
    .map((qa) => document.getElementById(qa.id) as HTMLButtonElement | null)
    .filter((el): el is HTMLButtonElement => el !== null);
}

// ----------------------------------------------------------------
// メッセージバブル表示
// ----------------------------------------------------------------

/**
 * メッセージバブルを追加して表示する。
 * textContent を使って XSS を防ぐ。
 */
function appendMessageBubble(
  role: 'user' | 'assistant' | 'error' | 'meta',
  text: string,
  els: ChatElements,
): void {
  const bubble = document.createElement('div');
  bubble.classList.add('chat-bubble');

  if (role === 'error') {
    bubble.classList.add('chat-bubble--error');
  } else if (role === 'meta') {
    bubble.classList.add('chat-bubble--meta');
  } else {
    bubble.classList.add(`chat-bubble--${role}`);

    const label = document.createElement('span');
    label.classList.add('chat-bubble__label');
    label.textContent = role === 'user' ? 'You' : 'AI';
    bubble.appendChild(label);
  }

  const body = document.createElement('div');
  body.classList.add('chat-bubble__body');
  body.textContent = text;
  bubble.appendChild(body);

  els.chatMessages.appendChild(bubble);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

// ----------------------------------------------------------------
// Welcome メッセージ（F-401）
// ----------------------------------------------------------------

/** Welcome メッセージを表示する（初期表示・クリア後に必ず呼ぶ） */
function appendWelcomeMessage(els: ChatElements): void {
  appendMessageBubble(
    'assistant',
    'Welcome! Select text on the page or pick a quick action below.',
    els,
  );
}

// ----------------------------------------------------------------
// 送信状態の制御
// ----------------------------------------------------------------

/** 送信中状態を設定して UI を更新する（F-402: 応答中はボタン disabled） */
function setSending(sending: boolean, els: ChatElements): void {
  isSending = sending;
  els.btnChatSend.disabled = sending;
  els.chatInput.disabled = sending;
  // クイックアクションボタンも一括 disabled
  for (const btn of getQuickActionButtons()) {
    btn.disabled = sending;
  }
}

// ----------------------------------------------------------------
// 短文警告（F-203）
// ----------------------------------------------------------------

/** 短文警告の pending リスナーを破棄する（F-203） */
function abortShortWarning(): void {
  if (shortWarningController) {
    shortWarningController.abort();
    shortWarningController = null;
  }
}

/** 短文警告ブロックを表示する（F-203） */
function showShortWarning(charCount: number, els: ChatElements): void {
  els.shortContentWarningText.textContent =
    `Extracted ${charCount} chars from this page. The result may not be useful.`;
  els.shortContentWarning.classList.remove('hidden');
}

/** 短文警告ブロックを非表示にする */
function hideShortWarning(els: ChatElements): void {
  els.shortContentWarning.classList.add('hidden');
  els.shortContentWarningText.textContent = '';
}

// ----------------------------------------------------------------
// ページ本文・選択テキスト取得
// ----------------------------------------------------------------

/**
 * アクティブタブのページ本文をキャッシュして返す（F-202）。
 * 既にキャッシュがある場合はそのまま使用。
 */
async function fetchPageContent(): Promise<string> {
  if (cachedPageContent) return cachedPageContent;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return '';

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' }) as
      { content: string; truncated: boolean; originalLength: number } | undefined;
    if (resp?.content) {
      cachedPageContent = resp.content.slice(0, CONTENT_MAX_CHARS);
    }
  } catch (e) {
    const safeLog = sanitizeErrorForLog(e);
    console.error('[chat] ページ本文取得エラー:', safeLog.message, safeLog.stack ?? '');
  }
  return cachedPageContent;
}

/** アクティブタブの選択テキストを取得する（F-004） */
async function fetchSelectedText(): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return '';

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTED_TEXT' }) as
      { selectedText: string } | undefined;
    return resp?.selectedText?.trim() ?? '';
  } catch (e) {
    const safeLog = sanitizeErrorForLog(e);
    console.error('[chat] 選択テキスト取得エラー:', safeLog.message, safeLog.stack ?? '');
    return '';
  }
}

// ----------------------------------------------------------------
// CHAT メッセージ送信（内部実装）
// ----------------------------------------------------------------

/**
 * API に送信する user message content を組み立てる。
 * - whole-page: プロンプト本文 + pageContent を末尾に付与（F-403）
 * - selection: F-301/F-302 の「Page context」+「Explain the following selection」構造
 * - plain: プロンプト本文のみ（自由入力 Chat）
 *
 * 表示用は displayText、API 送信用は apiContent を返す。
 * 「最新 user メッセージにのみコンテキスト付与」の原則（F-403）のため、
 * 過去メッセージの history はプロンプト本文のみで積まれている。
 */
interface PreparedMessage {
  /** user バブルに表示するテキスト（pageText / selectionText を含まない） */
  displayText: string;
  /** API に送信する user content（pageText / selectionText を含む最終版） */
  apiContent: string;
  /** 切り詰め通知テキスト（あれば表示する、F-012） */
  truncatedNotice?: string;
  /** 短文 system プロンプトを使うかどうか（F-204） */
  useShortPrompt: boolean;
  /** 選択テキストが空だった場合の早期エラーメッセージ */
  earlyError?: string;
  /** selection 種別の場合に取得した生の選択テキスト（HIGH-2: コンテキスト引き継ぎ用） */
  rawSelectionText?: string;
}

/** whole-page 種別メッセージを組み立てる */
async function prepareWholePageMessage(prompt: string): Promise<PreparedMessage> {
  const pageContent = await fetchPageContent();

  let truncatedNotice: string | undefined;
  // pageContent の truncation はキャッシュ取得時には不明なため、
  // ここでは content_max_chars との比較を省略（既存 chat.ts と同方針）

  const apiContent = pageContent.trim()
    ? `${prompt}\n\nPage content:\n${pageContent}`
    : prompt;

  return {
    displayText: prompt,
    apiContent,
    truncatedNotice,
    useShortPrompt: false,
  };
}

/** selection 種別メッセージを組み立てる（F-301/F-302/F-303/F-204） */
async function prepareSelectionMessage(prompt: string): Promise<PreparedMessage> {
  const selectionText = await fetchSelectedText();

  if (!selectionText) {
    return {
      displayText: prompt,
      apiContent: prompt,
      useShortPrompt: false,
      earlyError: 'No text is selected. Please select some text on the page first.',
    };
  }

  const pageContent = await fetchPageContent();

  // 選択テキストを SELECTION_MAX_CHARS で切り詰め（F-302）
  let truncatedNotice: string | undefined;
  const truncatedSelection = selectionText.length > SELECTION_MAX_CHARS
    ? selectionText.slice(0, SELECTION_MAX_CHARS - 1) + '…'
    : selectionText;

  if (selectionText.length > SELECTION_MAX_CHARS) {
    truncatedNotice =
      `Note: The selected text was truncated to ${SELECTION_MAX_CHARS.toLocaleString()} characters ` +
      `(original: ${selectionText.length.toLocaleString()} characters).`;
  }

  // F-302: Page context + Explain the following selection の構造
  let apiContent: string;
  if (pageContent.trim()) {
    apiContent =
      `Page context (for reference, do not summarize this):\n<page>\n${pageContent}\n</page>\n\n` +
      `Explain the following selection within that context:\n<selection>\n${truncatedSelection}\n</selection>`;
  } else {
    // ページ本文が空の場合はフォールバック（F-301）
    apiContent = `Please explain the following text:\n\n${truncatedSelection}`;
  }

  // F-204: 選択テキストが短い場合は短文 system プロンプトを使う（F-303: 警告 UI は出さない）
  const useShortPrompt = selectionText.length < SHORT_CONTENT_THRESHOLD;

  return {
    displayText: prompt,
    apiContent,
    truncatedNotice,
    useShortPrompt,
    rawSelectionText: selectionText, // HIGH-2: 後続 follow-up でのコンテキスト引き継ぎ用
  };
}

/**
 * メッセージを送信してアシスタント応答をバブルに追加する（共通経路）。
 * @param displayText user バブルに表示するテキスト
 * @param apiContent API に送信する user content
 * @param useShortPrompt F-204 の短文プロンプトを使うかどうか
 * @param els DOM 要素
 * @param gen 呼び出し元が pre-fetch 前にスナップショットした世代番号（HIGH-1 拡張）
 */
async function doSendMessage(
  displayText: string,
  apiContent: string,
  useShortPrompt: boolean,
  els: ChatElements,
  gen: number,
): Promise<void> {
  // 世代ガード: この関数に到達するまでの間に resetChat() が呼ばれた場合は早期リターン
  if (isStale(gen)) return;

  // user バブルを表示（表示テキストは pageText/selectionText を含まない）
  appendMessageBubble('user', displayText, els);

  try {
    // background に CHAT メッセージを送信
    // 最新 user メッセージにのみコンテキストを付与（F-403: 過去 history はプロンプト本文のみ）
    const resp = await chrome.runtime.sendMessage({
      type: 'CHAT',
      userMessage: apiContent,
      history: [...chatHistory],
      pageContent: '',           // コンテキストは apiContent に埋め込み済みのため空
      useShortPrompt,            // F-204 の短文フラグ
    }) as { text?: string; error?: string };

    // 世代ガード: API resolve までの間に resetChat() が呼ばれた場合は破棄（HIGH-1）
    if (isStale(gen)) return;

    if (resp?.error) {
      appendMessageBubble('error', sanitizeErrorMessage(resp.error), els);
      return;
    }

    if (!resp?.text) {
      appendMessageBubble('error', 'Received an empty response from the API. Please try again.', els);
      return;
    }

    // 成功時のみ履歴に追加（表示テキストを history に積む）
    chatHistory.push({ role: 'user', content: displayText });
    chatHistory.push({ role: 'assistant', content: resp.text });

    appendMessageBubble('assistant', resp.text, els);
  } catch (e) {
    // 世代ガード（エラーパスも同様）
    if (isStale(gen)) return;
    const safeLog = sanitizeErrorForLog(e);
    console.error('[chat] 送信エラー:', safeLog.message, safeLog.stack ?? '');
    const rawMsg = e instanceof Error ? e.message : String(e);
    appendMessageBubble('error', sanitizeErrorMessage(rawMsg), els);
  }
}

// ----------------------------------------------------------------
// クイックアクション実行（F-402）
// ----------------------------------------------------------------

/**
 * クイックアクションを実行する。
 * whole-page 種別は F-203 短文チェックあり、selection 種別は F-303 に従い短文警告なし。
 */
async function runQuickAction(qa: QuickAction): Promise<void> {
  if (isSending) return;

  let els: ChatElements;
  try {
    els = getElements();
  } catch (e) {
    console.error('[chat] DOM要素取得エラー:', e);
    return;
  }

  // pre-fetch 前に世代をスナップショット（HIGH-1 拡張: pre-fetch 中の reset にも対応）
  const myGen = currentGeneration;

  // 前回の未解決短文警告リスナーを破棄（F-203）
  abortShortWarning();
  hideShortWarning(els);

  setSending(true, els);

  try {
    if (qa.kind === 'whole-page') {
      // whole-page 系はコンテキストモードを 'whole' にセット（HIGH-2: selection モードを解除）
      currentContextMode = 'whole';
      currentSelectionText = null;

      // ページ本文を取得して短文チェック（F-203: "Explain page" クイックアクション時のみ）
      const pageContent = await fetchPageContent();

      // pre-fetch 後の stale チェック（HIGH-1 拡張）
      if (isStale(myGen)) return;

      // MEDIUM-1: 短文警告は "Explain page"（id="qaExplainPage"）のみ発火する
      const isExplainPage = qa.id === 'qaExplainPage';
      if (isExplainPage && pageContent.trim() && pageContent.length < SHORT_CONTENT_THRESHOLD) {
        // 短文警告を表示してユーザーの確認を待つ（F-203）
        setSending(false, els);
        showShortWarning(pageContent.length, els);

        const controller = new AbortController();
        shortWarningController = controller;

        await new Promise<void>((resolve) => {
          const onRunAnyway = (): void => {
            controller.abort();
            shortWarningController = null;
            hideShortWarning(els);
            // Run anyway 時も stale チェック（onRunAnyway は非同期コールバックなので再確認）
            if (isStale(myGen)) {
              resolve();
              return;
            }
            setSending(true, els);
            // MEDIUM-2: Run anyway 時は useShortPrompt: true を送信（F-204）
            doSendMessage(qa.prompt, `${qa.prompt}\n\nPage content:\n${pageContent}`, true, els, myGen)
              .then(resolve)
              .catch(() => resolve());
          };

          const onCancel = (): void => {
            controller.abort();
            shortWarningController = null;
            hideShortWarning(els);
            resolve();
          };

          els.btnRunAnyway.addEventListener('click', onRunAnyway, { signal: controller.signal });
          els.btnCancelShort.addEventListener('click', onCancel, { signal: controller.signal });
        });

        return;
      }

      // 通常フロー（短文警告なし）
      const prepared = await prepareWholePageMessage(qa.prompt);
      // prepareWholePageMessage 後の stale チェック（HIGH-1 拡張）
      if (isStale(myGen)) return;
      if (prepared.earlyError) {
        appendMessageBubble('error', prepared.earlyError, els);
        return;
      }
      if (prepared.truncatedNotice) {
        appendMessageBubble('meta', prepared.truncatedNotice, els);
      }
      await doSendMessage(prepared.displayText, prepared.apiContent, prepared.useShortPrompt, els, myGen);
    } else {
      // selection 種別（F-303: 短文警告なし）
      const prepared = await prepareSelectionMessage(qa.prompt);
      // prepareSelectionMessage 後の stale チェック（HIGH-1 拡張）
      if (isStale(myGen)) return;
      if (prepared.earlyError) {
        appendMessageBubble('error', prepared.earlyError, els);
        return;
      }
      if (prepared.truncatedNotice) {
        appendMessageBubble('meta', prepared.truncatedNotice, els);
      }
      // HIGH-2: selection 成功時はコンテキストモードをセット（後続 follow-up に引き継ぐ）
      // prepared.rawSelectionText は prepareSelectionMessage 内で取得済みのため再呼び出し不要
      if (prepared.rawSelectionText) {
        currentContextMode = 'selection';
        currentSelectionText = prepared.rawSelectionText;
      }
      await doSendMessage(prepared.displayText, prepared.apiContent, prepared.useShortPrompt, els, myGen);
    }
  } catch (e) {
    const safeLog = sanitizeErrorForLog(e);
    console.error('[chat] クイックアクションエラー:', safeLog.message, safeLog.stack ?? '');
    const rawMsg = e instanceof Error ? e.message : String(e);
    appendMessageBubble('error', sanitizeErrorMessage(rawMsg), els);
  } finally {
    setSending(false, els);
  }
}

// ----------------------------------------------------------------
// 自由入力 Chat 送信（F-006）
// ----------------------------------------------------------------

/** ユーザーの自由入力を送信する */
async function sendFreeInput(): Promise<void> {
  if (isSending) return;

  let els: ChatElements;
  try {
    els = getElements();
  } catch (e) {
    console.error('[chat] DOM要素取得エラー:', e);
    return;
  }

  const userText = els.chatInput.value.trim();
  if (!userText) return;

  // pre-fetch 前に世代をスナップショット（HIGH-1 拡張: pre-fetch 中の reset にも対応）
  const myGen = currentGeneration;

  els.chatInput.value = '';
  setSending(true, els);

  try {
    let apiContent: string;

    if (currentContextMode === 'selection' && currentSelectionText) {
      // HIGH-2: selection モード中の follow-up は selection コンテキストを維持（F-403）
      const pageContent = await fetchPageContent();
      // fetchPageContent 後の stale チェック（HIGH-1 拡張）
      if (isStale(myGen)) return;
      const truncatedSelection = currentSelectionText.length > SELECTION_MAX_CHARS
        ? currentSelectionText.slice(0, SELECTION_MAX_CHARS - 1) + '…'
        : currentSelectionText;

      if (pageContent.trim()) {
        apiContent =
          `Page context (for reference):\n<page>\n${pageContent}\n</page>\n\n` +
          `User question about the selection "<selection>${truncatedSelection}</selection>": ${userText}`;
      } else {
        apiContent =
          `User question about the selection "<selection>${truncatedSelection}</selection>": ${userText}`;
      }
    } else {
      // 通常モード: 最新メッセージにのみページ本文を付与（F-403）
      const pageContent = await fetchPageContent();
      // fetchPageContent 後の stale チェック（HIGH-1 拡張）
      if (isStale(myGen)) return;
      apiContent = pageContent.trim()
        ? `${userText}\n\nPage content:\n${pageContent}`
        : userText;
    }

    await doSendMessage(userText, apiContent, false, els, myGen);
  } catch (e) {
    const safeLog = sanitizeErrorForLog(e);
    console.error('[chat] 自由入力送信エラー:', safeLog.message, safeLog.stack ?? '');
    const rawMsg = e instanceof Error ? e.message : String(e);
    appendMessageBubble('error', sanitizeErrorMessage(rawMsg), els);
  } finally {
    setSending(false, els);
  }
}

// ----------------------------------------------------------------
// 公開 API
// ----------------------------------------------------------------

/** 現在の会話履歴を返す（テスト用） */
export function getChatHistory(): ReadonlyArray<ChatMessage> {
  return chatHistory;
}

/** 現在の選択コンテキストモードを返す（テスト用） */
export function getContextMode(): typeof currentContextMode {
  return currentContextMode;
}

/** 現在の選択テキストを返す（テスト用） */
export function getSelectionText(): string | null {
  return currentSelectionText;
}

/** ページ本文キャッシュのみをリセットする（URL 変化時に呼ぶ） */
export function clearPageContentCache(): void {
  cachedPageContent = '';
}

/**
 * Chat 履歴と画面をクリアして Welcome メッセージを再表示する（F-404）。
 * URL 変化（F-008）や Clear ボタン押下で呼ぶ。
 */
export function resetChat(): void {
  chatHistory = [];
  cachedPageContent = '';
  // 世代カウンタをインクリメントして in-flight な応答を無効化（HIGH-1）
  currentGeneration++;
  // 選択コンテキストをクリア（HIGH-2）
  currentContextMode = null;
  currentSelectionText = null;
  abortShortWarning();
  try {
    const els = getElements();
    els.chatMessages.innerHTML = '';
    hideShortWarning(els);
    els.chatInput.value = '';
    setSending(false, els);
    // Welcome メッセージを再表示（F-401）
    appendWelcomeMessage(els);
  } catch {
    // DOM がない場合（テスト環境など）は無視
  }
}

/** Chat 画面を初期化してイベントリスナーを設定する（F-401〜F-404） */
export function initChat(): void {
  let els: ChatElements;
  try {
    els = getElements();
  } catch {
    // DOM 要素がまだ存在しない場合はスキップ
    return;
  }

  // 初期 Welcome メッセージを表示（F-401）
  appendWelcomeMessage(els);

  // Send ボタン
  els.btnChatSend.addEventListener('click', () => {
    void sendFreeInput();
  });

  // Enter 送信 / Shift+Enter 改行（F-006）
  els.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendFreeInput();
    }
  });

  // Clear ボタン（F-404）
  els.btnChatClear.addEventListener('click', () => {
    resetChat();
  });

  // クイックアクションボタン（F-402）
  for (const qa of QUICK_ACTIONS) {
    const btn = document.getElementById(qa.id);
    if (btn) {
      btn.addEventListener('click', () => {
        void runQuickAction(qa);
      });
    }
  }
}
