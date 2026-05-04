// Claude API クライアント（F-005, F-011）
// APIキーはヘッダにのみ使用し、エラーログ・UI・例外メッセージには含めない

import { loadSettings } from './storage.js';
import { sanitizeErrorForLog } from './sanitize.js';

/** Claude API のメッセージ型 */
interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** callClaudeAPI のパラメータ */
export interface ClaudePayload {
  /** ユーザーへのプロンプト（最後のユーザー発話） */
  prompt: string;
  /** システムプロンプト（オプション） */
  system?: string;
  /** 会話履歴（チャット用） */
  history?: ClaudeMessage[];
}

/** callClaudeAPI の戻り値 */
export interface ClaudeResponse {
  text: string;
}

/**
 * Claude API を呼び出してテキストを返す（F-005, F-011）
 * HTTPエラーはステータスコード別に区別可能なメッセージを投げる。
 * APIキーは送信ヘッダにのみ使用し、エラーメッセージには含めない。
 */
export async function callClaudeAPI(payload: ClaudePayload): Promise<ClaudeResponse> {
  const settings = await loadSettings();

  // APIキー未設定チェック（F-010）
  if (!settings.apiKey.trim()) {
    throw new Error('API key is not configured. Please set your API key in Settings.');
  }

  const usedModel = settings.aiModel || DEFAULT_MODEL;

  // 会話履歴を組み立てる
  const messages: ClaudeMessage[] = [];
  if (payload.history?.length) {
    for (const h of payload.history) {
      messages.push({ role: h.role, content: h.content });
    }
  }
  messages.push({ role: 'user', content: payload.prompt });

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,       // APIキーはヘッダのみ
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: usedModel,
        max_tokens: 4096,
        system: payload.system ?? DEFAULT_SYSTEM,
        messages,
      }),
    });
  } catch (err) {
    // ネットワーク失敗（DNS解決失敗、接続拒否など）
    const safeErr = sanitizeErrorForLog(err);
    console.error('[claude] ネットワークエラー:', safeErr.message, safeErr.stack ?? '');
    throw new Error('Network error: Failed to reach the Anthropic API. Please check your internet connection.');
  }

  if (!response.ok) {
    // HTTPエラーをステータス別に区別（F-011）
    const errorMessage = await buildHttpErrorMessage(response);
    console.error('[claude] APIエラー:', response.status, response.statusText);
    throw new Error(errorMessage);
  }

  let data: { content: Array<{ type: string; text: string }> };
  try {
    data = await response.json() as typeof data;
  } catch (err) {
    const safeErr = sanitizeErrorForLog(err);
    console.error('[claude] レスポンスのJSON解析エラー:', safeErr.message, safeErr.stack ?? '');
    throw new Error('API error: Failed to parse response from the Anthropic API.');
  }

  const firstContent = data.content?.[0];
  if (!firstContent || firstContent.type !== 'text') {
    throw new Error('API error: Unexpected response format from the Anthropic API.');
  }

  return { text: firstContent.text };
}

/** デフォルトモデル */
const DEFAULT_MODEL = 'claude-haiku-4-5';

/** デフォルトシステムプロンプト（言語指定なし汎用） */
const DEFAULT_SYSTEM =
  'You are a helpful assistant. Always respond in English. ' +
  'Be concise and clear.';

/** 言語コードを "English" / "Japanese" の表示名に変換する */
function languageLabel(lang: 'en' | 'ja'): string {
  return lang === 'ja' ? 'Japanese' : 'English';
}

/**
 * Explainのシステムプロンプトを返す（F-005, F-013, F-201: 出力言語切替対応）
 * 言語ごとに "Always respond in {English|Japanese}." を動的に組み立てる
 */
export function getExplainSystemPrompt(lang: 'en' | 'ja' = 'en'): string {
  const label = languageLabel(lang);
  return (
    'You are a helpful reading assistant. ' +
    `Always respond in ${label}. ` +
    `When given web page content, provide a clear and concise explanation in ${label}. ` +
    'Focus on the main points and key information. ' +
    'Use bullet points or short paragraphs for readability.'
  );
}

/**
 * 短文入力に対応したExplainシステムプロンプトを返す（F-204）
 * 入力が単語・短いフレーズ・短い式の場合、その意味・用法・典型的な文脈を解説するよう指示する
 */
export function getShortExplainSystemPrompt(lang: 'en' | 'ja' = 'en'): string {
  const label = languageLabel(lang);
  return (
    'You are a helpful reading assistant. ' +
    `Always respond in ${label}. ` +
    'The input is a short word, phrase, or code expression. ' +
    `Explain the meaning, usage, and typical context of the given short word/phrase/expression in ${label}. ` +
    'Be concise but informative. Use bullet points or short paragraphs for readability.'
  );
}

/**
 * Chatのシステムプロンプトのベースを返す（F-006, F-201: 出力言語切替対応）
 * 言語ごとに "Always respond in {English|Japanese}." を動的に組み立てる
 */
export function getChatSystemPromptBase(lang: 'en' | 'ja' = 'en'): string {
  const label = languageLabel(lang);
  return (
    `You are a helpful assistant. Always respond in ${label}. ` +
    'Answer questions clearly and concisely based on the provided web page content. ' +
    'If the user asks about something not covered in the page content, answer from your general knowledge but clarify that.'
  );
}

/**
 * 後方互換のために旧定数を維持（既存コードからの参照を壊さないため）
 * @deprecated getExplainSystemPrompt() / getChatSystemPromptBase() を使うこと
 */
export const EXPLAIN_SYSTEM_PROMPT = getExplainSystemPrompt('en');
export const CHAT_SYSTEM_PROMPT_BASE = getChatSystemPromptBase('en');

/**
 * HTTPエラーをステータスコード別に区別可能なメッセージに変換する（F-011）
 * APIキーやリクエスト内容はメッセージに含めない
 */
async function buildHttpErrorMessage(response: Response): Promise<string> {
  const status = response.status;

  // レスポンスボディからAPIエラーメッセージを取得（APIキーは含まれないことを前提）
  let apiErrorDetail = '';
  try {
    const body = await response.text();
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    const msg = parsed.error?.message ?? '';
    // APIキーを含む可能性のある文字列は除外する（paranoid check）
    if (msg && !msg.includes('sk-ant') && !msg.includes('api-key')) {
      apiErrorDetail = msg;
    }
  } catch {
    // JSON解析失敗は無視
  }

  if (status === 401) {
    return 'Authentication error (401): Your API key is invalid or expired. Please check your settings.';
  }
  if (status === 403) {
    return 'Authorization error (403): You do not have permission to use this model or endpoint.';
  }
  if (status === 429) {
    return 'Rate limit exceeded (429): Too many requests. Please wait a moment and try again.';
  }
  if (status >= 400 && status < 500) {
    const detail = apiErrorDetail ? ` Detail: ${apiErrorDetail}` : '';
    return `Client error (${status}): The request was rejected by the API.${detail}`;
  }
  if (status >= 500) {
    return `Server error (${status}): The Anthropic API is temporarily unavailable. Please try again later.`;
  }

  return `Unexpected error (${status}): An unknown error occurred.`;
}
