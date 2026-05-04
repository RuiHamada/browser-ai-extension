// F-501 / F-502 / F-503: フローティング Explain ボタン（Shadow DOM 隔離）
// テキスト選択時に選択範囲付近に表示し、クリックで Side Panel Explain を起動する
// F-601 / F-602 / F-603: Speak ボタンの追加（Web Speech API 連携）

/** Shadow ホスト要素の ID（重複防止チェックに使用） */
const FLOATING_HOST_ID = 'browser-ai-floating-host';

/** フローティングボタンの z-index（ホストページの上に出るが極端な値は避ける） */
const FLOATING_Z_INDEX = 2147483000;

/** デバウンス時間（ms）: 選択操作中の再描画コストを抑える */
const DEBOUNCE_MS = 80;

/** 選択テキストの最小文字数（trim 後） */
const MIN_SELECTION_CHARS = 2;

/** Speak で読み上げる最大文字数（F-602） */
const SPEAK_MAX_CHARS = 1000;

// ----------------------------------------------------------------
// 再生状態管理（F-603）
// ----------------------------------------------------------------

/** 現在再生中の utterance（null なら非再生） */
let currentUtterance: SpeechSynthesisUtterance | null = null;

/** 直前に有効と判定した選択テキスト（スクロール時の誤停止防止に使用） */
let lastSelectionText: string | null = null;

// Shadow DOM 内のスタイル（ホストページには影響しない）
const FLOATING_BUTTON_CSS = `
  :host {
    all: initial;
    display: block;
    position: fixed;
    z-index: ${FLOATING_Z_INDEX};
    pointer-events: none;
  }
  .btn-container {
    display: flex;
    flex-direction: row;
    gap: 6px;
    pointer-events: auto;
  }
  button {
    pointer-events: auto;
    background: rgba(30, 30, 40, 0.92);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 13px;
    font-family: system-ui, sans-serif;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    transition: background 0.12s;
    line-height: 1.5;
    white-space: nowrap;
  }
  button:hover,
  button:focus-visible {
    background: rgba(10, 10, 20, 0.98);
    outline: 2px solid #7eb8f7;
    outline-offset: 1px;
  }
  button:active {
    background: rgba(0, 0, 10, 1);
  }
  button[aria-pressed="true"] {
    background: rgba(50, 100, 180, 0.95);
  }
  button[aria-pressed="true"]:hover,
  button[aria-pressed="true"]:focus-visible {
    background: rgba(30, 80, 160, 0.98);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

// ----------------------------------------------------------------
// DOM 管理: ホスト要素と Shadow DOM
// ----------------------------------------------------------------

interface FloatingHost {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  explainBtn: HTMLButtonElement;
  speakBtn: HTMLButtonElement;
}

/** 既存のホスト要素を取得、なければ新規作成する（多重インスタンス防止） */
function getOrCreateHost(): FloatingHost {
  let host = document.getElementById(FLOATING_HOST_ID) as HTMLDivElement | null;

  if (host) {
    // 既存ホストを再利用（Shadow root はすでに存在する）
    const shadow = host.shadowRoot!;
    const explainBtn = shadow.querySelector('#explainBtn') as HTMLButtonElement;
    const speakBtn = shadow.querySelector('#speakBtn') as HTMLButtonElement;
    return { host, shadow, explainBtn, speakBtn };
  }

  // 新規作成
  host = document.createElement('div');
  host.id = FLOATING_HOST_ID;
  // aria-hidden は付けない。Shadow 内の button[aria-label] をスクリーンリーダーに見せる。
  // ホスト自体は presentational なので role="presentation" を付与する。
  host.setAttribute('role', 'presentation');

  const shadow = host.attachShadow({ mode: 'open' });

  // スタイルシートを Shadow DOM 内に追加
  const style = document.createElement('style');
  style.textContent = FLOATING_BUTTON_CSS;
  shadow.appendChild(style);

  // 2 ボタンを横並びにするコンテナ
  const container = document.createElement('div');
  container.className = 'btn-container';
  shadow.appendChild(container);

  // Explain ボタン
  const explainBtn = document.createElement('button');
  explainBtn.id = 'explainBtn';
  explainBtn.textContent = 'Explain';
  explainBtn.setAttribute('aria-label', 'Explain selected text');
  explainBtn.setAttribute('tabindex', '0');
  explainBtn.type = 'button';
  container.appendChild(explainBtn);

  // Speak ボタン
  const speakBtn = document.createElement('button');
  speakBtn.id = 'speakBtn';
  speakBtn.textContent = '🔊 Speak';
  speakBtn.setAttribute('role', 'button');
  speakBtn.setAttribute('aria-label', 'Speak selected text');
  speakBtn.setAttribute('aria-pressed', 'false');
  speakBtn.setAttribute('tabindex', '0');
  speakBtn.type = 'button';

  // Web Speech API 未対応環境では Speak ボタンを無効化（描画時点で判定、F-601）
  if (!('speechSynthesis' in window)) {
    speakBtn.disabled = true;
    speakBtn.setAttribute('aria-disabled', 'true');
  }

  container.appendChild(speakBtn);

  document.body.appendChild(host);

  return { host, shadow, explainBtn, speakBtn };
}

// ----------------------------------------------------------------
// 表示・非表示制御
// ----------------------------------------------------------------

/** ホスト要素が存在していても非表示状態にする。再生中なら停止する（F-603） */
function hideFloatingButton(): void {
  const host = document.getElementById(FLOATING_HOST_ID) as HTMLDivElement | null;
  if (host) {
    host.style.display = 'none';
  }
  // 非表示時は再生を停止し、選択テキストのキャッシュをクリアする
  // （次回の新規選択で差分検知が正しく機能するよう null に戻す）
  stopSpeech();
  lastSelectionText = null;
}

/**
 * 選択範囲の位置にフローティングボタンを配置して表示する。
 * @param rect 選択範囲の getBoundingClientRect() 結果
 * @param onExplain Explain ボタンクリック時コールバック
 * @param rawSelectionText 選択テキスト（trim 前。Speak に使用）
 */
function showFloatingButton(
  rect: DOMRect,
  onExplain: () => void,
  rawSelectionText: string,
): void {
  const { host, explainBtn, speakBtn } = getOrCreateHost();

  // Explain ボタン: クリックリスナーを付け替え（stale なリスナーが残らないよう cloneNode で置換）
  const newExplainBtn = explainBtn.cloneNode(true) as HTMLButtonElement;
  explainBtn.parentNode!.replaceChild(newExplainBtn, explainBtn);
  newExplainBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onExplain();
  });

  // Speak ボタン: クリックリスナーを付け替え
  const newSpeakBtn = speakBtn.cloneNode(true) as HTMLButtonElement;
  speakBtn.parentNode!.replaceChild(newSpeakBtn, speakBtn);

  // speechSynthesis が利用可能なら Speak ボタンを有効化
  const speechAvailable = 'speechSynthesis' in window;
  if (!speechAvailable) {
    newSpeakBtn.disabled = true;
    newSpeakBtn.setAttribute('aria-disabled', 'true');
  } else {
    // Speak には raw テキスト（trim 前）を使用する（テキストの厳密性）
    newSpeakBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSpeak(newSpeakBtn, rawSelectionText);
    });
  }

  // ビューポートサイズを取得してはみ出しをクランプ
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const btnW = 160; // 2 ボタン合計の概算幅（px）
  const btnH = 30;  // ボタン概算高さ（px）

  // デフォルト: 選択範囲の右下に配置（8px オフセット）
  let left = rect.right + 8;
  let top = rect.bottom + 8;

  // 右端でクランプ
  if (left + btnW > vw) {
    left = rect.left - btnW - 8;
    if (left < 0) left = 8;
  }
  // 下端でクランプ
  if (top + btnH > vh) {
    top = rect.top - btnH - 8;
    if (top < 0) top = 8;
  }

  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
  host.style.display = 'block';
}

// ----------------------------------------------------------------
// Web Speech API 連携（F-602 / F-603）
// ----------------------------------------------------------------

/**
 * 再生を停止して状態をリセットする。
 * cancel を呼んでも onerror/onend が発火しないブラウザもあるため、
 * ここで直接 currentUtterance をクリアする。
 * speaking=true かつ currentUtterance=null の乖離状態（外部から cancel された直後等）でも
 * 確実にキャンセルできるよう OR 条件でチェックする（F-603）。
 */
function stopSpeech(): void {
  if (currentUtterance !== null || window.speechSynthesis?.speaking) {
    currentUtterance = null;
    window.speechSynthesis?.cancel();
    // Speak ボタンの aria-pressed をリセット
    resetSpeakButtonState();
  }
}

/** Shadow DOM 内の Speak ボタンを「停止中」状態に戻す */
function resetSpeakButtonState(): void {
  const host = document.getElementById(FLOATING_HOST_ID);
  if (!host?.shadowRoot) return;
  const speakBtn = host.shadowRoot.querySelector('#speakBtn') as HTMLButtonElement | null;
  if (speakBtn) {
    speakBtn.setAttribute('aria-pressed', 'false');
  }
}

/**
 * Speak ボタンクリック時の処理（F-602/F-603）。
 * @param speakBtn Speak ボタン DOM 要素（aria-pressed を更新する）
 * @param selectionText 読み上げ対象のテキスト
 */
function handleSpeak(speakBtn: HTMLButtonElement, selectionText: string): void {
  // 再生中なら停止（toggle 動作、F-603）
  if (currentUtterance !== null || window.speechSynthesis.speaking) {
    stopSpeech();
    return;
  }

  // 長すぎる選択は切り詰める（F-602）
  const text = selectionText.slice(0, SPEAK_MAX_CHARS);
  if (!text.trim()) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';

  // onend: 再生完了時に状態リセット
  utterance.onend = () => {
    if (currentUtterance === utterance) {
      currentUtterance = null;
      resetSpeakButtonState();
    }
  };

  // onerror: エラー時にも状態リセット
  // "interrupted" / "canceled" は cancel() を呼ぶと仕様上必ず発火する正常停止イベントなのでログしない
  utterance.onerror = (ev) => {
    if (ev.error !== 'interrupted' && ev.error !== 'canceled') {
      console.error('[floating] SpeechSynthesis エラー:', ev.error);
    }
    if (currentUtterance === utterance) {
      currentUtterance = null;
      resetSpeakButtonState();
    }
  };

  currentUtterance = utterance;
  speakBtn.setAttribute('aria-pressed', 'true');

  window.speechSynthesis.speak(utterance);
}

// ----------------------------------------------------------------
// 起動条件チェック
// ----------------------------------------------------------------

/**
 * 選択範囲が起動禁止コンテキスト内にあるか判定する。
 * 仕様 F-502 に従い、以下を禁止:
 * - `<input>` 全般（type 問わず。input はカーソル位置のみ持ち、選択は activeElement で判定）
 * - `<textarea>`
 * - `contenteditable`（"false" 以外）要素内
 */
function isSelectionInForbiddenContext(selection: Selection): boolean {
  // activeElement が input / textarea なら禁止（anchorNode は body になる場合があるため activeElement を優先）
  const active = document.activeElement as HTMLElement | null;
  if (active instanceof HTMLInputElement) {
    return true;
  }
  if (active instanceof HTMLTextAreaElement) {
    return true;
  }

  // 選択アンカー / フォーカスノードの祖先チェック
  const nodesToCheck = [selection.anchorNode, selection.focusNode].filter(
    (n): n is Node => n !== null,
  );

  for (const node of nodesToCheck) {
    let current: Node | null = node;
    while (current && current !== document) {
      if (current instanceof HTMLElement) {
        // input 全般（パスワードを含む）
        if (current.tagName === 'INPUT') {
          return true;
        }
        // テキストエリア
        if (current.tagName === 'TEXTAREA') {
          return true;
        }
        // contenteditable（"false" で明示的に無効化されている場合は読み物として扱い除外しない）
        const ce = current.getAttribute('contenteditable');
        if (ce !== null && ce !== 'false') {
          return true;
        }
        // フローティングボタンホスト自身（自己再発火防止）
        if (current.id === FLOATING_HOST_ID) {
          return true;
        }
      }
      current = current.parentNode;
    }
  }

  return false;
}

// ----------------------------------------------------------------
// Selection 監視（F-502）
// ----------------------------------------------------------------

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** デバウンスして選択状態を評価・ボタンを更新する */
function scheduleSelectionCheck(onExplain: () => void): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    evaluateSelection(onExplain);
  }, DEBOUNCE_MS);
}

/**
 * 現在の選択を評価してフローティングボタンの表示・非表示を更新する。
 */
function evaluateSelection(onExplain: () => void): void {
  const selection = window.getSelection();

  if (!selection || selection.isCollapsed) {
    hideFloatingButton();
    return;
  }

  // raw text（trim 前）と trimmed text の両方を保持する
  const rawText = selection.toString();
  const trimmedText = rawText.trim();

  // 起動条件判定は trimmed テキストで行う（MIN_SELECTION_CHARS）
  if (trimmedText.length < MIN_SELECTION_CHARS) {
    hideFloatingButton();
    return;
  }

  if (isSelectionInForbiddenContext(selection)) {
    hideFloatingButton();
    return;
  }

  // 選択範囲のクライアント矩形を取得
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  if (rect.width === 0 && rect.height === 0) {
    hideFloatingButton();
    return;
  }

  // 選択テキストが変化した場合のみ再生を停止する（F-603）
  // スクロールでは同一テキストのまま evaluateSelection が呼ばれるため、
  // rawText が変わっていないときは停止しない（スクロール時の誤停止防止）
  if (rawText !== lastSelectionText) {
    stopSpeech();
    lastSelectionText = rawText;
  }

  // Speak には raw text（trim 前）を渡す
  showFloatingButton(rect, onExplain, rawText);
}

// ----------------------------------------------------------------
// スクロール追従
// ----------------------------------------------------------------

let scrollUpdateTimer: ReturnType<typeof setTimeout> | null = null;

/** スクロール時にボタン位置を選択範囲に追従させる */
function onScroll(onExplain: () => void): void {
  if (scrollUpdateTimer !== null) {
    clearTimeout(scrollUpdateTimer);
  }
  scrollUpdateTimer = setTimeout(() => {
    scrollUpdateTimer = null;
    evaluateSelection(onExplain);
  }, 50);
}

// ----------------------------------------------------------------
// 公開エントリポイント: フローティングボタンを初期化する
// ----------------------------------------------------------------

/**
 * フローティング Explain ボタン（および Speak ボタン）を初期化し、DOM イベントリスナーを登録する。
 * content script のトップレベルから一度だけ呼ぶ。
 * @param onExplain ボタンクリック時に呼ぶコールバック
 */
export function initFloatingButton(onExplain: () => void): void {
  document.addEventListener('selectionchange', () => {
    scheduleSelectionCheck(onExplain);
  });

  // mouseup: テキスト選択直後のトリガー（selectionchange が先に来るが念のため補完）
  document.addEventListener('mouseup', () => {
    scheduleSelectionCheck(onExplain);
  });

  // mousedown: フローティングボタン以外の場所クリックで選択解除前に非表示
  document.addEventListener('mousedown', (e) => {
    const target = e.target as Node | null;
    const host = document.getElementById(FLOATING_HOST_ID);
    // ホスト要素やその子孫でなければ非表示（ただし評価は selectionchange に任せる）
    if (host && target && !host.contains(target)) {
      // すぐに非表示にはしない（選択操作の mousedown でも発火するため、短いタイムアウトで評価）
      scheduleSelectionCheck(onExplain);
    }
  });

  // keyup: キーボード選択への対応
  document.addEventListener('keyup', (e) => {
    const selectionKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
    if (e.shiftKey || selectionKeys.includes(e.key)) {
      scheduleSelectionCheck(onExplain);
    }
  });

  // スクロール追従
  document.addEventListener('scroll', () => {
    onScroll(onExplain);
  }, { capture: true, passive: true });

  // タブ非表示時に非表示化
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hideFloatingButton();
    }
  });
}
