// chrome.storage.local を使った設定の読み書きユーティリティ
// APIキーは必ず chrome.storage.local にのみ保存し、sync には書き込まない

import type { Settings, AiModelId, OutputLanguage } from '../types/messages.js';
import { DEFAULT_SETTINGS, AVAILABLE_MODELS } from '../types/messages.js';

/** 許可されたモデル ID の Set（ランタイム検証用） */
const ALLOWED_MODEL_IDS = new Set<string>(AVAILABLE_MODELS.map((m) => m.value));

/** 許可された出力言語の Set（ランタイム検証用） */
const ALLOWED_OUTPUT_LANGUAGES = new Set<string>(['en', 'ja']);

/**
 * ストレージから読み出した値が有効なモデル ID かどうか確認し、
 * 無効な場合はデフォルト値にフォールバックする（破損ストレージへの防御）
 */
function validateAiModel(raw: unknown): AiModelId {
  if (typeof raw === 'string' && ALLOWED_MODEL_IDS.has(raw)) {
    return raw as AiModelId;
  }
  return DEFAULT_SETTINGS.aiModel;
}

/**
 * ストレージから読み出した値が有効な出力言語かどうか確認し、
 * 無効な場合はデフォルト値にフォールバックする（validateAiModel と同パターン）
 */
export function validateOutputLanguage(raw: unknown): OutputLanguage {
  if (typeof raw === 'string' && ALLOWED_OUTPUT_LANGUAGES.has(raw)) {
    return raw as OutputLanguage;
  }
  return DEFAULT_SETTINGS.outputLanguage;
}

/** 設定を chrome.storage.local から読み込む */
export async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiKey', 'aiModel', 'outputLanguage'], (data) => {
      resolve({
        apiKey: typeof data['apiKey'] === 'string' ? data['apiKey'] : DEFAULT_SETTINGS.apiKey,
        // 許可リスト外の値はデフォルトにフォールバック
        aiModel: validateAiModel(data['aiModel']),
        // 許可リスト外の値はデフォルトにフォールバック
        outputLanguage: validateOutputLanguage(data['outputLanguage']),
      });
    });
  });
}

/** 設定を chrome.storage.local に保存する */
export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(settings, resolve);
  });
}

/** APIキーが設定済みかどうか確認する */
export async function hasApiKey(): Promise<boolean> {
  const settings = await loadSettings();
  return settings.apiKey.trim().length > 0;
}
