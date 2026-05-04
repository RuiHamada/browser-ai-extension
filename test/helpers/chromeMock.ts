// chrome.* API のモック生成ヘルパー
// chrome.storage.local / sync, runtime, tabs, sidePanel を spy として用意する

import { vi } from 'vitest';

export interface ChromeMock {
  storage: {
    local: {
      _data: Record<string, unknown>;
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
    sync: {
      _data: Record<string, unknown>;
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };
    onChanged: {
      _listeners: Function[];
      addListener: ReturnType<typeof vi.fn>;
      /** テスト用ヘルパー: onChanged イベントを手動でトリガーする */
      _trigger: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void;
    };
  };
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: { addListener: ReturnType<typeof vi.fn>; _listeners: Function[] };
    openOptionsPage: ReturnType<typeof vi.fn>;
    lastError: undefined | { message: string };
  };
  tabs: {
    query: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    onActivated: { addListener: ReturnType<typeof vi.fn>; _listeners: Function[] };
    onUpdated: { addListener: ReturnType<typeof vi.fn>; _listeners: Function[] };
  };
  sidePanel: {
    open: ReturnType<typeof vi.fn>;
    setPanelBehavior: ReturnType<typeof vi.fn>;
  };
}

/** クリーンな chrome モックを作って globalThis.chrome に設定する */
export function installChromeMock(): ChromeMock {
  const localData: Record<string, unknown> = {};
  const syncData: Record<string, unknown> = {};

  // onChanged リスナーのリスト（storage.onChanged 用）
  const onChangedListeners: Function[] = [];

  const mock: ChromeMock = {
    storage: {
      local: {
        _data: localData,
        get: vi.fn((keys: string[] | string | null, cb: (data: Record<string, unknown>) => void) => {
          let result: Record<string, unknown> = {};
          if (keys === null || keys === undefined) {
            result = { ...localData };
          } else if (typeof keys === 'string') {
            if (keys in localData) result[keys] = localData[keys];
          } else if (Array.isArray(keys)) {
            for (const k of keys) {
              if (k in localData) result[k] = localData[k];
            }
          }
          cb(result);
        }),
        set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(localData, items);
          if (cb) cb();
        }),
        remove: vi.fn((key: string | string[], cb?: () => void) => {
          const keys = Array.isArray(key) ? key : [key];
          for (const k of keys) delete localData[k];
          if (cb) cb();
        }),
      },
      sync: {
        _data: syncData,
        get: vi.fn(),
        set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(syncData, items);
          if (cb) cb();
        }),
      },
      onChanged: {
        _listeners: onChangedListeners,
        addListener: vi.fn(function (fn: Function) {
          onChangedListeners.push(fn);
        }),
        _trigger: (changes, area) => {
          for (const fn of onChangedListeners) {
            fn(changes, area);
          }
        },
      },
    },
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve({ ok: true })),
      onMessage: {
        _listeners: [],
        addListener: vi.fn(function (this: unknown, fn: Function) {
          mock.runtime.onMessage._listeners.push(fn);
        }),
      },
      openOptionsPage: vi.fn(),
      lastError: undefined,
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([{ id: 1, url: 'https://example.com', windowId: 10, active: true }])),
      get: vi.fn((id: number) => Promise.resolve({ id, url: 'https://example.com' })),
      sendMessage: vi.fn(() => Promise.resolve({})),
      onActivated: {
        _listeners: [] as Function[],
        addListener: vi.fn(function (fn: Function) {
          mock.tabs.onActivated._listeners.push(fn);
        }),
      },
      onUpdated: {
        _listeners: [] as Function[],
        addListener: vi.fn(function (fn: Function) {
          mock.tabs.onUpdated._listeners.push(fn);
        }),
      },
    },
    sidePanel: {
      open: vi.fn(() => Promise.resolve()),
      setPanelBehavior: vi.fn(() => Promise.resolve()),
    },
  };

  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;
  return mock;
}

/** 既存モックを破棄 */
export function uninstallChromeMock(): void {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
}
