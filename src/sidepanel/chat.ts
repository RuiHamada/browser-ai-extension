// Chat タブの UI ロジック（F-006, F-007, F-008）
// ページ本文をコンテキストに含めた会話履歴管理と送受信

import type { ChatMessage } from '../types/messages.js';
import { sanitizeErrorMessage, sanitizeErrorForLog } from '../lib/sanitize.js';
import { CONTENT_MAX_CHARS } from '../content/extract.js';

/** Chat タブで使う DOM 要素の参照 */
interface ChatElements {
  chatMessages: HTMLElement;
  chatInput: HTMLTextAreaElement;
  btnChatSend: HTMLButtonElement;
  btnChatClear: HTMLButtonElement;
  chatLoading: HTMLElement;
  chatError: HTMLElement;
}

/** セッション中の会話履歴（タブを閉じたら破棄。永続化しない） */
let chatHistory: ChatMessage[] = [];

/** 現在ページの本文キャッシュ（URL が変わったらクリアする） */
let cachedPageContent = '';

/** 現在 API 呼び出し中かどうか（二重送信防止） */
let isSending = false;

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
    chatLoading: get('chatLoading'),
    chatError: get('chatError'),
  };
}

/** エラーメッセージを表示する */
function showError(message: string, els: ChatElements): void {
  els.chatError.textContent = message;
  els.chatError.classList.remove('hidden');
}

/** エラー表示をクリアする */
function clearError(els: ChatElements): void {
  els.chatError.textContent = '';
  els.chatError.classList.add('hidden');
}

/** 送信ボタンの有効/無効を切り替える（二重送信防止） */
function setSending(sending: boolean, els: ChatElements): void {
  isSending = sending;
  els.btnChatSend.disabled = sending;
  els.chatInput.disabled = sending;
  els.chatLoading.classList.toggle('hidden', !sending);
}

/**
 * メッセージを会話ログに追加して表示する。
 * textContent を使って XSS を防ぐ。
 */
function appendMessageBubble(role: 'user' | 'assistant', text: string, els: ChatElements): void {
  const bubble = document.createElement('div');
  bubble.classList.add('chat-bubble', `chat-bubble--${role}`);

  const label = document.createElement('span');
  label.classList.add('chat-bubble__label');
  label.textContent = role === 'user' ? 'You' : 'AI';

  const body = document.createElement('div');
  body.classList.add('chat-bubble__body');
  body.textContent = text;

  bubble.appendChild(label);
  bubble.appendChild(body);
  els.chatMessages.appendChild(bubble);

  // 最新メッセージまでスクロール
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

/**
 * アクティブタブのページ本文をキャッシュして返す。
 * 既にキャッシュがある場合はそのまま使用（同一セッション内の再利用）。
 */
async function fetchPageContent(): Promise<string> {
  if (cachedPageContent) return cachedPageContent;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return '';

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' }) as
      { content: string; truncated: boolean; originalLength: number } | undefined;
    if (resp?.content) {
      // Sprint 2 と同じ truncate ロジックを共通化（extract.ts の CONTENT_MAX_CHARS を流用）
      cachedPageContent = resp.content.slice(0, CONTENT_MAX_CHARS);
    }
  } catch (e) {
    // content script が注入されていないページ（chrome:// など）は無視
    // 深層防御: sanitizeErrorForLog 経由でAPIキー漏洩を防ぐ
    const safeLog = sanitizeErrorForLog(e);
    console.error('[chat] ページ本文取得エラー:', safeLog.message, safeLog.stack ?? '');
  }
  return cachedPageContent;
}

/** ユーザーの入力を送信してアシスタント応答を受け取る */
async function sendMessage(): Promise<void> {
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

  clearError(els);
  setSending(true, els);

  // ユーザーの発話を即座に画面に表示する
  appendMessageBubble('user', userText, els);
  els.chatInput.value = '';

  try {
    // ページ本文を取得（キャッシュがあれば再利用）
    const pageContent = await fetchPageContent();

    // background に CHAT メッセージを送信（F-006）
    // chatHistory のスナップショットを渡す（参照共有によるミュータブル問題を防ぐ）
    const resp = await chrome.runtime.sendMessage({
      type: 'CHAT',
      userMessage: userText,
      history: [...chatHistory],
      pageContent,
    }) as { text?: string; error?: string };

    if (resp?.error) {
      showError(sanitizeErrorMessage(resp.error), els);
      // 送信失敗した場合は履歴に追加しない
      return;
    }

    if (!resp?.text) {
      showError('Received an empty response from the API. Please try again.', els);
      return;
    }

    // 成功時のみ履歴に追加（F-006: 会話履歴が API リクエストに蓄積される）
    chatHistory.push({ role: 'user', content: userText });
    chatHistory.push({ role: 'assistant', content: resp.text });

    appendMessageBubble('assistant', resp.text, els);
  } catch (e) {
    const safeLog = sanitizeErrorForLog(e);
    console.error('[chat] 送信エラー:', safeLog.message, safeLog.stack ?? '');
    const rawMsg = e instanceof Error ? e.message : String(e);
    showError(sanitizeErrorMessage(rawMsg), els);
  } finally {
    setSending(false, els);
  }
}

/** Chat 履歴と画面をクリアする（F-006: 明示クリア） */
export function resetChat(): void {
  chatHistory = [];
  cachedPageContent = '';
  try {
    const els = getElements();
    els.chatMessages.innerHTML = '';
    clearError(els);
    els.chatInput.value = '';
    setSending(false, els);
  } catch {
    // DOM がない場合（テスト環境など）は無視
  }
}

/**
 * ページが変わったときにページ本文キャッシュだけをリセットする。
 * 会話履歴は resetChat() 呼び出し元が管理する。
 */
export function clearPageContentCache(): void {
  cachedPageContent = '';
}

/** 現在の会話履歴を返す（テスト用） */
export function getChatHistory(): ReadonlyArray<ChatMessage> {
  return chatHistory;
}

/** Chat タブを初期化してイベントリスナーを設定する */
export function initChat(): void {
  let els: ChatElements;
  try {
    els = getElements();
  } catch {
    // DOM 要素がまだ存在しない場合はスキップ
    return;
  }

  // 送信ボタン
  els.btnChatSend.addEventListener('click', () => {
    void sendMessage();
  });

  // Enter 送信 / Shift+Enter 改行（F-006 Should 要件）
  els.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  });

  // 明示クリアボタン（F-006: 履歴破棄）
  els.btnChatClear.addEventListener('click', () => {
    resetChat();
  });
}
