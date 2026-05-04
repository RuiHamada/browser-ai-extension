// バックグラウンドサービスワーカーへ送るメッセージ型（discriminated union）

// 利用可能なモデル一覧（Claude 4.x 系の現行エイリアス）
export const AVAILABLE_MODELS = [
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 - Fast' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 - Balanced' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 - Most capable' },
] as const;

/** 利用可能なモデル ID のユニオン型 */
export type AiModelId = typeof AVAILABLE_MODELS[number]['value'];

/** 出力言語の選択肢 */
export type OutputLanguage = 'en' | 'ja';

// 拡張機能の設定
export interface Settings {
  apiKey: string;
  /** 利用可能なモデル ID のみ許可（許可リスト外はストレージ読み込み時にフォールバック） */
  aiModel: AiModelId;
  /** AI 出力言語（'en': English / 'ja': Japanese）、デフォルトは 'en' */
  outputLanguage: OutputLanguage;
}

// デフォルト設定値
export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  aiModel: 'claude-haiku-4-5',
  outputLanguage: 'en',
};

/** Chatの一往復メッセージ（role と content のペア） */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type BackgroundMessage =
  | { type: 'OPEN_SIDE_PANEL' }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: Partial<Settings> }
  /** ページ全体モード: content のみ送信（F-005 既存） */
  | { type: 'EXPLAIN'; mode: 'whole'; content: string }
  /**
   * 選択モード: 選択テキストとページ本文を両方送信（F-301）
   * pageContent が空のときはフォールバック（選択テキストのみで Explain）
   */
  | { type: 'EXPLAIN'; mode: 'selection'; selectionText: string; pageContent: string }
  | {
      type: 'CHAT';
      /** 最新のユーザー入力 */
      userMessage: string;
      /** 会話履歴（最新メッセージを含まない） */
      history: ChatMessage[];
      /** ページ本文（システムコンテキストとして使用） */
      pageContent: string;
    }
  ;

// コンテンツスクリプトへ送るメッセージ型
export type ContentMessage =
  | { type: 'GET_PAGE_CONTENT' }
  | { type: 'GET_SELECTED_TEXT' }
  ;

// バックグラウンドからサイドパネルへのブロードキャストメッセージ型
export type BroadcastMessage =
  | { type: 'TAB_CHANGED'; url: string; tabId: number }
  ;

export type Message = BackgroundMessage | ContentMessage | BroadcastMessage;
