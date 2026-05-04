// F-501 / F-502 / F-503: フローティング Explain ボタン（Shadow DOM 隔離）
// テキスト選択時に選択範囲付近に表示し、クリックで Side Panel Explain を起動する

/** Shadow ホスト要素の ID（重複防止チェックに使用） */
const FLOATING_HOST_ID = 'browser-ai-floating-host';

/** フローティングボタンの z-index（ホストページの上に出るが極端な値は避ける） */
const FLOATING_Z_INDEX = 2147483000;

/** デバウンス時間（ms）: 選択操作中の再描画コストを抑える */
const DEBOUNCE_MS = 80;

/** 選択テキストの最小文字数（trim 後） */
const MIN_SELECTION_CHARS = 2;

// Shadow DOM 内のスタイル（ホストページには影響しない）
const FLOATING_BUTTON_CSS = `
  :host {
    all: initial;
    display: block;
    position: fixed;
    z-index: ${FLOATING_Z_INDEX};
    pointer-events: none;
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
`;

// ----------------------------------------------------------------
// DOM 管理: ホスト要素と Shadow DOM
// ----------------------------------------------------------------

interface FloatingHost {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  button: HTMLButtonElement;
}

/** 既存のホスト要素を取得、なければ新規作成する（多重インスタンス防止） */
function getOrCreateHost(): FloatingHost {
  let host = document.getElementById(FLOATING_HOST_ID) as HTMLDivElement | null;

  if (host) {
    // 既存ホストを再利用（Shadow root はすでに存在する）
    const shadow = host.shadowRoot!;
    const button = shadow.querySelector('button') as HTMLButtonElement;
    return { host, shadow, button };
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

  // ボタン要素
  const button = document.createElement('button');
  button.textContent = 'Explain';
  button.setAttribute('aria-label', 'Explain selected text');
  button.setAttribute('tabindex', '0');
  button.type = 'button';
  shadow.appendChild(button);

  document.body.appendChild(host);

  return { host, shadow, button };
}

// ----------------------------------------------------------------
// 表示・非表示制御
// ----------------------------------------------------------------

/** ホスト要素が存在していても非表示状態にする */
function hideFloatingButton(): void {
  const host = document.getElementById(FLOATING_HOST_ID) as HTMLDivElement | null;
  if (host) {
    host.style.display = 'none';
  }
}

/**
 * 選択範囲の位置にフローティングボタンを配置して表示する。
 * @param rect 選択範囲の getBoundingClientRect() 結果
 */
function showFloatingButton(rect: DOMRect, onExplain: () => void): void {
  const { host, button } = getOrCreateHost();

  // クリックリスナーを付け替え（stale なリスナーが残らないよう一度削除して再追加）
  const newButton = button.cloneNode(true) as HTMLButtonElement;
  button.parentNode!.replaceChild(newButton, button);

  // クリックと Enter/Space で Explain を起動（クリックイベントのみで十分。button の keydown は自動）
  newButton.addEventListener('click', (e) => {
    e.stopPropagation(); // ホストページへの伝播を防ぐ
    onExplain();
  });

  // ビューポートサイズを取得してはみ出しをクランプ
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const btnW = 80; // ボタン概算幅（px）
  const btnH = 30; // ボタン概算高さ（px）

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

  const text = selection.toString().trim();

  if (text.length < MIN_SELECTION_CHARS) {
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

  showFloatingButton(rect, onExplain);
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
 * フローティング Explain ボタンを初期化し、DOM イベントリスナーを登録する。
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
