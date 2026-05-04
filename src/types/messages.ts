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
  | {
      type: 'CHAT';
      /** 最新のユーザー入力（クイックアクション・自由入力とも、コンテキスト埋め込み済み） */
      userMessage: string;
      /** 会話履歴（最新メッセージを含まない） */
      history: ChatMessage[];
      /**
       * ページ本文（後方互換で残す）。
       * Sprint 7 以降は userMessage にコンテキストを埋め込む方式を採用するため通常は空文字。
       * background 側では pageContent が空のときは userMessage をそのまま使う。
       */
      pageContent: string;
      /**
       * F-204: 選択テキストが短い場合（< 40 文字）に短文 system プロンプトを使うフラグ。
       * undefined / false のときは通常プロンプト。
       */
      useShortPrompt?: boolean;
    }
  | {
      /** F-503: フローティングボタンクリック時に content script から background へ送るメッセージ */
      type: 'FLOATING_EXPLAIN_REQUEST';
      /** ユーザーが選択した文字列（空でない保証あり） */
      selectionText: string;
    }
  | {
      /** F-503: Side Panel が初期化完了したことを background に通知するメッセージ */
      type: 'SIDE_PANEL_READY';
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
  | {
      /**
       * F-503: background から Side Panel へ送る「クイックアクション自動実行」指示。
       * actionId には既存クイックアクションの要素 ID（'qaExplainSelection' 等）を指定する。
       */
      type: 'QUICK_ACTION_AUTORUN';
      actionId: string;
      /** content script が取得した選択テキスト（Side Panel 側で GET_SELECTED_TEXT を省略できる） */
      selectionText: string;
    }
  ;

export type Message = BackgroundMessage | ContentMessage | BroadcastMessage;
