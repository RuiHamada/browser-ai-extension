// messages.ts: 型定義とデフォルト値の整合性
// F-002 のモデル一覧、デフォルト設定値の妥当性を検証する

import { describe, expect, it } from 'vitest';
import { AVAILABLE_MODELS, DEFAULT_SETTINGS } from '../src/types/messages.js';

describe('types/messages', () => {
  it('AVAILABLE_MODELS は最低 2 件以上ある（F-002 受け入れ条件）', () => {
    expect(AVAILABLE_MODELS.length).toBeGreaterThanOrEqual(2);
    for (const m of AVAILABLE_MODELS) {
      expect(typeof m.value).toBe('string');
      expect(m.value.length).toBeGreaterThan(0);
      expect(typeof m.label).toBe('string');
      expect(m.label.length).toBeGreaterThan(0);
    }
  });

  it('DEFAULT_SETTINGS.aiModel は AVAILABLE_MODELS のいずれかに一致する', () => {
    const values = AVAILABLE_MODELS.map((m) => m.value);
    expect(values).toContain(DEFAULT_SETTINGS.aiModel);
  });

  it('DEFAULT_SETTINGS.apiKey は空文字（未設定の表現）', () => {
    expect(DEFAULT_SETTINGS.apiKey).toBe('');
  });

  it('AVAILABLE_MODELS の value は重複しない', () => {
    const values = AVAILABLE_MODELS.map((m) => m.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
