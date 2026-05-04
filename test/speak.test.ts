// F-601 / F-602 / F-603: Speak ボタンのユニットテスト
// jsdom 環境で SpeechSynthesis をモックし、再生・停止・状態管理を検証する

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

// ----------------------------------------------------------------
// SpeechSynthesis モック
// ----------------------------------------------------------------

interface SpeechSynthesisMock {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  speaking: boolean;
  _utterances: SpeechSynthesisUtterance[];
  /** テスト用: 最後の utterance の onend を手動で発火させる */
  _fireEnd: () => void;
  /** テスト用: 最後の utterance の onerror を手動で発火させる */
  _fireError: (error?: string) => void;
}

/**
 * SpeechSynthesisUtterance のシンプルなモック実装。
 * jsdom は Web Speech API を実装していないため、テスト用にグローバルに設定する。
 */
class MockSpeechSynthesisUtterance {
  text: string;
  lang: string = '';
  rate: number = 1;
  pitch: number = 1;
  volume: number = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: ((ev: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((ev: SpeechSynthesisErrorEvent) => void) | null = null;
  onstart: ((ev: SpeechSynthesisEvent) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

/** SpeechSynthesis モックをインストールして返す */
function installSpeechSynthesisMock(): SpeechSynthesisMock {
  // SpeechSynthesisUtterance クラスをグローバルにモック
  (globalThis as unknown as Record<string, unknown>)['SpeechSynthesisUtterance'] =
    MockSpeechSynthesisUtterance;

  const speechMock: SpeechSynthesisMock = {
    speak: vi.fn(function (utterance: SpeechSynthesisUtterance) {
      speechMock._utterances.push(utterance);
      speechMock.speaking = true;
    }),
    cancel: vi.fn(function () {
      speechMock.speaking = false;
    }),
    speaking: false,
    _utterances: [],
    _fireEnd: () => {
      const last = speechMock._utterances[speechMock._utterances.length - 1];
      if (last?.onend) {
        speechMock.speaking = false;
        last.onend(new Event('end') as SpeechSynthesisEvent);
      }
    },
    _fireError: (error = 'synthesis-failed') => {
      const last = speechMock._utterances[speechMock._utterances.length - 1];
      if (last?.onerror) {
        speechMock.speaking = false;
        const ev = new Event('error') as SpeechSynthesisErrorEvent;
        Object.defineProperty(ev, 'error', { value: error });
        last.onerror(ev);
      }
    },
  };

  Object.defineProperty(window, 'speechSynthesis', {
    value: speechMock,
    writable: true,
    configurable: true,
  });

  return speechMock;
}

/** SpeechSynthesis を window から削除（未対応環境のシミュレーション） */
function removeSpeechSynthesis(): void {
  // configurable でないと delete が失敗する可能性があるため defineProperty で上書く
  Object.defineProperty(window, 'speechSynthesis', {
    value: undefined,
    writable: true,
    configurable: true,
  });
  // 'speechSynthesis' in window が false になるよう delete も試みる
  try {
    // @ts-expect-error -- テスト用に意図的に削除
    delete window.speechSynthesis;
  } catch {
    // 削除できなくても undefined にしてあるので機能検出は false 扱いになる
  }
}

// ----------------------------------------------------------------
// 選択モックヘルパー
// ----------------------------------------------------------------

function mockSelection(text: string): void {
  const range = {
    getBoundingClientRect: () => ({
      left: 100,
      top: 100,
      right: 200,
      bottom: 120,
      width: 100,
      height: 20,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    }),
  };

  const sel = {
    toString: () => text,
    isCollapsed: text.length === 0,
    anchorNode: document.body,
    focusNode: document.body,
    getRangeAt: () => range,
  };

  vi.spyOn(window, 'getSelection').mockReturnValue(sel as unknown as Selection);
}

function clearSelection(): void {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => '',
    isCollapsed: true,
    anchorNode: null,
    focusNode: null,
    getRangeAt: () => ({ getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
  } as unknown as Selection);
}

/** fake timers 使用時にデバウンス (80ms) を経過させる */
async function advanceDebounce(): Promise<void> {
  vi.advanceTimersByTime(100);
  await Promise.resolve();
  await Promise.resolve();
}

/** Shadow DOM 内の Explain ボタンを取得する */
function getExplainBtn(): HTMLButtonElement | null {
  const host = document.getElementById('browser-ai-floating-host');
  return (host?.shadowRoot?.querySelector('#explainBtn') as HTMLButtonElement | null) ?? null;
}

/** Shadow DOM 内の Speak ボタンを取得する */
function getSpeakBtn(): HTMLButtonElement | null {
  const host = document.getElementById('browser-ai-floating-host');
  return (host?.shadowRoot?.querySelector('#speakBtn') as HTMLButtonElement | null) ?? null;
}

// ----------------------------------------------------------------
// テスト
// ----------------------------------------------------------------

describe('Speak ボタン（F-601/F-602/F-603）', () => {
  let speechMock: SpeechSynthesisMock;

  beforeEach(async () => {
    mock = installChromeMock();
    speechMock = installSpeechSynthesisMock();
    document.body.innerHTML = '<p id="content">Hello world test content</p>';
    vi.useFakeTimers();
    vi.resetModules();
    await import('../src/content/index.js');
  });

  afterEach(() => {
    uninstallChromeMock();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
    // SpeechSynthesis モックをクリーン状態に戻す
    installSpeechSynthesisMock();
  });

  // F-601: 2 ボタンが存在する
  it('選択時に Explain と Speak の 2 ボタンが Shadow DOM に存在する', async () => {
    mockSelection('hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).not.toBeNull();

    const explainBtn = getExplainBtn();
    const speakBtn = getSpeakBtn();
    expect(explainBtn).not.toBeNull();
    expect(speakBtn).not.toBeNull();
  });

  // F-601: Explain ボタンの aria-label
  it('Explain ボタンは aria-label="Explain selected text" を持つ', async () => {
    mockSelection('hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const explainBtn = getExplainBtn();
    expect(explainBtn?.getAttribute('aria-label')).toBe('Explain selected text');
  });

  // F-601: Speak ボタンの aria-label
  it('Speak ボタンは aria-label="Speak selected text" を持つ', async () => {
    mockSelection('hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const speakBtn = getSpeakBtn();
    expect(speakBtn?.getAttribute('aria-label')).toBe('Speak selected text');
  });

  // F-601: Speak ボタンの role
  it('Speak ボタンは role="button" を持つ', async () => {
    mockSelection('hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const speakBtn = getSpeakBtn();
    expect(speakBtn?.getAttribute('role')).toBe('button');
  });

  // F-602: speak() が呼ばれ、lang === "en-US"、text === 選択文字列
  it('Speak クリックで speechSynthesis.speak が呼ばれ lang=en-US・text=選択文字列', async () => {
    const selText = 'Hello, this is a test sentence.';
    mockSelection(selText);
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const speakBtn = getSpeakBtn();
    expect(speakBtn).not.toBeNull();
    speakBtn!.click();

    expect(speechMock.speak).toHaveBeenCalledTimes(1);
    const utterance = speechMock._utterances[0];
    expect(utterance).toBeDefined();
    expect(utterance!.text).toBe(selText);
    expect(utterance!.lang).toBe('en-US');
  });

  // F-602: SPEAK_MAX_CHARS = 1000 で切り詰め
  it('1000 文字を超える選択は先頭 1000 文字までに切り詰めて発話する', async () => {
    const longText = 'a'.repeat(1500);
    mockSelection(longText);
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();

    expect(speechMock.speak).toHaveBeenCalledTimes(1);
    const utterance = speechMock._utterances[0]!;
    expect(utterance.text.length).toBe(1000);
    expect(utterance.text).toBe('a'.repeat(1000));
    expect(utterance.lang).toBe('en-US');
  });

  // F-602: rate / pitch / voice をセットしない
  it('utterance に rate / pitch / voice は設定されない（OS デフォルト固定）', async () => {
    mockSelection('Hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();

    const utterance = speechMock._utterances[0];
    expect(utterance).toBeDefined();
    // デフォルト値のままであること（明示的に上書きしていない）
    expect(utterance!.voice).toBeNull();
    // rate / pitch はデフォルト値 (1) のまま上書きしていないことを確認
    // （SpeechSynthesisUtterance のデフォルトは rate=1, pitch=1）
    expect(utterance!.rate).toBe(1);
    expect(utterance!.pitch).toBe(1);
  });

  // F-603: 再生中の Speak 再押下で cancel() が呼ばれる
  it('再生中に Speak を再度クリックすると speechSynthesis.cancel が呼ばれる', async () => {
    mockSelection('Hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const speakBtn = getSpeakBtn()!;

    // 1 回目のクリック前の cancel 呼び出し回数を記録する
    // （テスト間のモジュールインスタンス蓄積により事前に cancel が呼ばれる場合がある）
    const cancelCountBefore = speechMock.cancel.mock.calls.length;

    // 1 回目のクリック（再生開始）
    speakBtn.click();
    expect(speechMock.speak).toHaveBeenCalledTimes(1);

    // speaking を true に設定（モックの speak() が自動で設定している）
    expect(speechMock.speaking).toBe(true);

    // 2 回目のクリック（停止）
    // cloneNode されたボタンを再取得する
    const speakBtn2 = getSpeakBtn()!;
    speakBtn2.click();
    // 2 回目クリック後に cancel が追加で呼ばれていること
    expect(speechMock.cancel.mock.calls.length).toBeGreaterThan(cancelCountBefore);
  });

  // F-603: 再生中は aria-pressed="true"
  it('再生中は Speak ボタンが aria-pressed="true" を持つ', async () => {
    mockSelection('Hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const speakBtn = getSpeakBtn()!;
    expect(speakBtn.getAttribute('aria-pressed')).toBe('false');

    speakBtn.click();

    // speak() 後に aria-pressed="true" になっているはず
    // cloneNode で置換されているため再取得
    const speakBtnAfter = getSpeakBtn()!;
    expect(speakBtnAfter.getAttribute('aria-pressed')).toBe('true');
  });

  // F-603: onend 後に aria-pressed="false" に戻る
  it('onend 発火後に Speak ボタンが aria-pressed="false" に戻る', async () => {
    mockSelection('Hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();

    // onend を手動発火
    speechMock._fireEnd();
    await Promise.resolve();

    const speakBtn = getSpeakBtn();
    expect(speakBtn?.getAttribute('aria-pressed')).toBe('false');
  });

  // F-603: onerror 後に aria-pressed="false" に戻る
  it('onerror 発火後に Speak ボタンが aria-pressed="false" に戻る', async () => {
    mockSelection('Hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();

    // onerror を手動発火
    speechMock._fireError('synthesis-failed');
    await Promise.resolve();

    const speakBtn = getSpeakBtn();
    expect(speakBtn?.getAttribute('aria-pressed')).toBe('false');
  });

  // F-603: "interrupted" / "canceled" は正常停止扱いで console.error しない
  it('error="interrupted" の onerror では console.error を呼ばない', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockSelection('Hello world');
      document.dispatchEvent(new Event('selectionchange'));
      await advanceDebounce();

      getSpeakBtn()!.click();
      speechMock._fireError('interrupted');
      await Promise.resolve();

      expect(errorSpy).not.toHaveBeenCalled();
      // 状態は正しくリセットされる
      expect(getSpeakBtn()?.getAttribute('aria-pressed')).toBe('false');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('error="canceled" の onerror では console.error を呼ばない', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockSelection('Hello world');
      document.dispatchEvent(new Event('selectionchange'));
      await advanceDebounce();

      getSpeakBtn()!.click();
      speechMock._fireError('canceled');
      await Promise.resolve();

      expect(errorSpy).not.toHaveBeenCalled();
      expect(getSpeakBtn()?.getAttribute('aria-pressed')).toBe('false');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('予期しないエラー（例: synthesis-failed）は console.error を呼ぶ', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockSelection('Hello world');
      document.dispatchEvent(new Event('selectionchange'));
      await advanceDebounce();

      getSpeakBtn()!.click();
      speechMock._fireError('synthesis-failed');
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  // F-603: 選択解除でツールチップ非表示 + cancel() が呼ばれる
  it('選択解除でツールチップ非表示になる際に speechSynthesis.cancel が呼ばれる', async () => {
    // まず選択して Speak 開始
    mockSelection('Hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();
    expect(speechMock.speak).toHaveBeenCalledTimes(1);

    // 選択解除
    clearSelection();
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    // ツールチップが非表示
    const host = document.getElementById('browser-ai-floating-host');
    if (host) {
      expect(host.style.display).toBe('none');
    }

    // cancel() が呼ばれている（複数モジュールインスタンスが蓄積するため >= 1 で検証）
    expect(speechMock.cancel).toHaveBeenCalled();
  });

  // F-603: 別所クリックによる非表示でも cancel() が呼ばれる（mousedown → scheduleSelectionCheck → hide）
  it('選択外クリックで非表示になる際にも speechSynthesis.cancel が呼ばれる', async () => {
    // 選択して Speak 開始
    mockSelection('Hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();
    expect(speechMock.speak).toHaveBeenCalledTimes(1);

    // Speak 開始後に cancel が呼ばれた回数を記録する
    const cancelCountAfterSpeak = speechMock.cancel.mock.calls.length;

    // 選択解除状態にしてから mousedown を発火（フローティングホスト外）
    clearSelection();
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await advanceDebounce();

    // 選択解除・非表示処理で cancel が追加で呼ばれていること
    // （テスト間のモジュールインスタンス蓄積により正確な回数は保証できないため >= で検証）
    expect(speechMock.cancel.mock.calls.length).toBeGreaterThan(cancelCountAfterSpeak);
  });

  // F-601: speechSynthesis 未対応環境で Speak ボタンが disabled になる
  it('speechSynthesis が利用不可の環境では Speak ボタンが disabled になる', async () => {
    // speechSynthesis を削除してからモジュールをリロード
    removeSpeechSynthesis();
    vi.resetModules();
    await import('../src/content/index.js');

    mockSelection('hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const speakBtn = getSpeakBtn();
    expect(speakBtn).not.toBeNull();
    // disabled 属性または aria-disabled="true" で無効化されている
    const isDisabled = speakBtn!.disabled || speakBtn!.getAttribute('aria-disabled') === 'true';
    expect(isDisabled).toBe(true);
  });

  // 回帰: Explain ボタンのクリックで chrome.runtime.sendMessage が呼ばれる
  it('Explain ボタンクリックで FLOATING_EXPLAIN_REQUEST が送信される（回帰）', async () => {
    const selText = 'Hello world selection';
    mockSelection(selText);
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const explainBtn = getExplainBtn()!;
    expect(explainBtn).not.toBeNull();
    explainBtn.click();
    await Promise.resolve();

    expect(mock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FLOATING_EXPLAIN_REQUEST',
        selectionText: selText,
      }),
    );
  });

  // 回帰: Speak クリックは chrome.runtime.sendMessage を呼ばない
  it('Speak クリックは chrome.runtime.sendMessage を呼ばない（Side Panel 連携なし）', async () => {
    mockSelection('Hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();
    await Promise.resolve();

    // sendMessage は呼ばれていない（または Explain のみ）
    const calls = mock.runtime.sendMessage.mock.calls;
    const speakRelatedCalls = calls.filter((call) => {
      const msg = call[0] as { type?: string };
      return msg?.type === 'SPEAK_REQUEST' || msg?.type === undefined;
    });
    // Speak 専用のメッセージ型は存在しないはず
    expect(speechMock.speak).toHaveBeenCalledTimes(1);
    // sendMessage は呼ばれていないこと
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
    // speakRelatedCalls は空（Speak はローカルで完結する）
    expect(speakRelatedCalls).toHaveLength(0);
  });
});

// ----------------------------------------------------------------
// Codex レビュー指摘対応テスト（Sprint 10 修正）
// ----------------------------------------------------------------

describe('Speak 修正テスト（Codex レビュー指摘 Sprint 10）', () => {
  let speechMock: SpeechSynthesisMock;

  beforeEach(async () => {
    mock = installChromeMock();
    speechMock = installSpeechSynthesisMock();
    document.body.innerHTML = '<p id="content">Hello world test content</p>';
    vi.useFakeTimers();
    vi.resetModules();
    await import('../src/content/index.js');
  });

  afterEach(() => {
    uninstallChromeMock();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
    installSpeechSynthesisMock();
  });

  // [MEDIUM] 再選択時に再生中の音声が停止されること（F-603）
  it('再生中の状態で別の有効テキストを選択すると speechSynthesis.cancel が呼ばれる', async () => {
    // 最初の選択で Speak を開始する
    mockSelection('First selection text');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();
    expect(speechMock.speak).toHaveBeenCalledTimes(1);
    expect(speechMock.speaking).toBe(true);

    // 別の有効なテキストを選択する（selectionchange を発火）
    mockSelection('Second selection text');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    // 新しい選択検出時に cancel() が呼ばれていること
    expect(speechMock.cancel).toHaveBeenCalled();
  });

  // [LOW] Speak には trim 前の raw テキストが使われること
  it('前後に空白を含む選択で SpeechSynthesisUtterance.text が元のテキスト（空白込み）になる', async () => {
    // 前後に空白を含む選択テキスト
    const rawText = '  Hello, world!  ';
    mockSelection(rawText);
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();

    expect(speechMock.speak).toHaveBeenCalledTimes(1);
    const utterance = speechMock._utterances[0]!;
    // Speak には raw text（trim 前）が渡されていること
    expect(utterance.text).toBe(rawText);
    // trim 済みのテキストではないこと
    expect(utterance.text).not.toBe(rawText.trim());
  });

  // [LOW] stopSpeech の OR 条件: speaking=true かつ currentUtterance=null でも cancel される
  it('speaking=true かつ currentUtterance=null の状態でも選択解除時に cancel が呼ばれる', async () => {
    // Speak を開始する
    mockSelection('Some text to speak');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();
    expect(speechMock.speak).toHaveBeenCalledTimes(1);
    expect(speechMock.speaking).toBe(true);

    // onend を手動発火して currentUtterance を null にリセットする
    // （ただし speaking は true のまま維持して乖離状態を作る）
    speechMock._fireEnd();
    // speaking を手動で true に戻して乖離状態を再現する
    speechMock.speaking = true;

    // この状態（speaking=true, currentUtterance=null）で選択解除
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '',
      isCollapsed: true,
      anchorNode: null,
      focusNode: null,
      getRangeAt: () => ({ getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
    } as unknown as Selection);

    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    // OR 条件のため speaking=true でも cancel() が呼ばれること
    expect(speechMock.cancel).toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------
// スクロール時誤停止防止テスト（Codex 再レビュー指摘 Sprint 10）
// ----------------------------------------------------------------

describe('スクロール時の誤停止防止（lastSelectionText による差分検知）', () => {
  let speechMock: SpeechSynthesisMock;

  beforeEach(async () => {
    mock = installChromeMock();
    speechMock = installSpeechSynthesisMock();
    document.body.innerHTML = '<p id="content">Hello world test content</p>';
    vi.useFakeTimers();
    vi.resetModules();
    await import('../src/content/index.js');
  });

  afterEach(() => {
    uninstallChromeMock();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
    installSpeechSynthesisMock();
  });

  async function advanceDebounce(): Promise<void> {
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
  }

  // スクロール（同一テキスト選択維持）で cancel() が呼ばれないこと
  it('同一テキストを選択したまま scroll イベントが来ても speechSynthesis.cancel が呼ばれない', async () => {
    // テキストを選択して Speak を開始する
    mockSelection('Hello world');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();
    expect(speechMock.speak).toHaveBeenCalledTimes(1);
    expect(speechMock.speaking).toBe(true);

    // Speak 開始後の cancel 呼び出し回数を記録する
    const cancelCountAfterSpeak = speechMock.cancel.mock.calls.length;

    // 同一テキストを選択したまま scroll イベントを発火する
    // （onScroll → evaluateSelection の経路、rawText は変わらない）
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
    vi.advanceTimersByTime(60); // scroll デバウンス (50ms) を経過させる
    await Promise.resolve();
    await Promise.resolve();

    // cancel は追加で呼ばれていないこと（スクロールによる誤停止がない）
    expect(speechMock.cancel.mock.calls.length).toBe(cancelCountAfterSpeak);
  });

  // 別テキストの選択切替で cancel が呼ばれること（既存挙動の維持）
  it('別テキストを選択すると speechSynthesis.cancel が呼ばれる', async () => {
    // 最初の選択で Speak を開始する
    mockSelection('First selection text');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();
    expect(speechMock.speak).toHaveBeenCalledTimes(1);

    const cancelCountBefore = speechMock.cancel.mock.calls.length;

    // 別テキストを選択する
    mockSelection('Second selection text');
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    // 新しいテキストに切り替わったので cancel が呼ばれること
    expect(speechMock.cancel.mock.calls.length).toBeGreaterThan(cancelCountBefore);
  });

  // 同一テキスト → ツールチップ非表示 → 再選択で lastSelectionText がリセットされ
  // 次の選択切替で cancel が呼ばれること（lastSelectionText=null の状態を確認）
  it('選択解除後に lastSelectionText がリセットされ、次の別テキスト選択で cancel が呼ばれる', async () => {
    const selText = 'Hello world';

    // 最初の選択で Speak を開始する
    mockSelection(selText);
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    getSpeakBtn()!.click();
    expect(speechMock.speak).toHaveBeenCalledTimes(1);

    // 選択解除（hideFloatingButton → lastSelectionText = null）
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '',
      isCollapsed: true,
      anchorNode: null,
      focusNode: null,
      getRangeAt: () => ({ getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
    } as unknown as Selection);
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    // lastSelectionText が null にリセットされた状態で speaking を true に保つ（乖離状態を作る）
    speechMock.speaking = true;
    const cancelCountAfterHide = speechMock.cancel.mock.calls.length;

    // 同一テキストを再選択する（lastSelectionText=null のため、rawText !== null → stopSpeech が呼ばれる）
    mockSelection(selText);
    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    // lastSelectionText が null にリセットされているため、同一テキストでも cancel が呼ばれること
    expect(speechMock.cancel.mock.calls.length).toBeGreaterThan(cancelCountAfterHide);
  });
});

// ----------------------------------------------------------------
// 除外要素の回帰テスト（F-502 回帰）
// ----------------------------------------------------------------

describe('除外要素での Speak ボタン非表示（F-502 回帰）', () => {
  beforeEach(async () => {
    mock = installChromeMock();
    installSpeechSynthesisMock();
    document.body.innerHTML = '<p id="content">Hello world test content</p>';
    vi.useFakeTimers();
    vi.resetModules();
    await import('../src/content/index.js');
  });

  afterEach(() => {
    uninstallChromeMock();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function advanceDebounce(): Promise<void> {
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
  }

  it('<input type="password"> がアクティブな場合はツールチップが表示されない', async () => {
    const input = document.createElement('input');
    input.type = 'password';
    document.body.appendChild(input);
    input.focus();

    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'some text',
      isCollapsed: false,
      anchorNode: document.body,
      focusNode: document.body,
      getRangeAt: () => ({ getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
    } as unknown as Selection);

    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    if (host) {
      expect(host.style.display).toBe('none');
    } else {
      expect(host).toBeNull();
    }
  });

  it('<textarea> がアクティブな場合はツールチップが表示されない', async () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'some text',
      isCollapsed: false,
      anchorNode: document.body,
      focusNode: document.body,
      getRangeAt: () => ({ getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
    } as unknown as Selection);

    document.dispatchEvent(new Event('selectionchange'));
    await advanceDebounce();

    const host = document.getElementById('browser-ai-floating-host');
    if (host) {
      expect(host.style.display).toBe('none');
    } else {
      expect(host).toBeNull();
    }
  });
});
