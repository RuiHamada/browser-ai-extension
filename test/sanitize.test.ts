// sanitize ユーティリティのテスト（F-011: APIキー漏洩防止）
// message および stack の両方から sk-ant- パターンが除去されることを保証する

import { describe, expect, it } from 'vitest';
import { sanitizeErrorMessage, sanitizeErrorForLog } from '../src/lib/sanitize.js';

describe('sanitizeErrorMessage', () => {
  it('APIキーを含む文字列を [REDACTED] に置換する', () => {
    const result = sanitizeErrorMessage('Error: sk-ant-api03-SECRETKEY001 is invalid');
    expect(result).not.toContain('sk-ant-api03-SECRETKEY001');
    expect(result).toContain('[REDACTED]');
  });

  it('APIキーを含まない文字列はそのまま返す', () => {
    const msg = 'Network error: connection refused';
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });

  it('複数の APIキーパターンをすべて置換する', () => {
    const msg = 'Keys: sk-ant-abc123 and sk-ant-def456 found';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('sk-ant-abc123');
    expect(result).not.toContain('sk-ant-def456');
    expect(result.match(/\[REDACTED\]/g)?.length).toBe(2);
  });

  it('空文字列を渡してもエラーにならない', () => {
    expect(sanitizeErrorMessage('')).toBe('');
  });

  it('スペースで区切られた APIキーを除去する', () => {
    const result = sanitizeErrorMessage('sk-ant-api03-SECRETKEY001 present');
    expect(result).not.toContain('SECRETKEY001');
  });

  it('引用符で区切られた APIキーを除去する', () => {
    const result = sanitizeErrorMessage('"sk-ant-api03-SECRETKEY001"');
    expect(result).not.toContain('SECRETKEY001');
    // 引用符は区切り文字なので sk-ant- 以降の引用符前まで置換される
    expect(result).toContain('[REDACTED]');
  });
});

describe('sanitizeErrorForLog', () => {
  it('Error インスタンスの message を sanitize する', () => {
    const err = new Error('sk-ant-api03-SECRET exposed');
    const safe = sanitizeErrorForLog(err);
    expect(safe.message).not.toContain('sk-ant-api03-SECRET');
    expect(safe.message).toContain('[REDACTED]');
  });

  it('Error インスタンスの stack を sanitize する（stack は message を含む）', () => {
    const err = new Error('sk-ant-api03-SECRETKEY in message');
    const safe = sanitizeErrorForLog(err);
    // stack には message が含まれるため、stack も sanitize されていること
    if (safe.stack) {
      expect(safe.stack).not.toContain('sk-ant-api03-SECRETKEY');
      expect(safe.stack).toContain('[REDACTED]');
    }
  });

  it('stack にのみ APIキーが含まれるケースでも除去される', () => {
    // Error.stack を手動で上書きして stack だけにキーを埋め込む
    const err = new Error('normal error message');
    Object.defineProperty(err, 'stack', {
      value: 'Error: normal error message\n    at sk-ant-api03-IN-STACK somewhere',
      writable: true,
    });
    const safe = sanitizeErrorForLog(err);
    expect(safe.stack).not.toContain('sk-ant-api03-IN-STACK');
    expect(safe.stack).toContain('[REDACTED]');
    // 通常のスタックトレース部分は残る
    expect(safe.stack).toContain('normal error message');
  });

  it('非 Error オブジェクト（文字列）を sanitize する', () => {
    const safe = sanitizeErrorForLog('sk-ant-api03-STRINGERROR occurred');
    expect(safe.message).not.toContain('sk-ant-api03-STRINGERROR');
    expect(safe.message).toContain('[REDACTED]');
    expect(safe.stack).toBeUndefined();
  });

  it('非 Error オブジェクト（数値）を文字列変換して返す', () => {
    const safe = sanitizeErrorForLog(42);
    expect(safe.message).toBe('42');
    expect(safe.stack).toBeUndefined();
  });

  it('null を渡してもエラーにならない', () => {
    const safe = sanitizeErrorForLog(null);
    expect(safe.message).toBe('null');
    expect(safe.stack).toBeUndefined();
  });

  it('message と stack の両方に APIキーが含まれていても両方除去される', () => {
    const err = new Error('sk-ant-api03-IN-MESSAGE exposed');
    Object.defineProperty(err, 'stack', {
      value: 'Error: sk-ant-api03-IN-MESSAGE exposed\n    at callSite (sk-ant-api03-IN-STACK)',
      writable: true,
    });
    const safe = sanitizeErrorForLog(err);
    expect(safe.message).not.toContain('sk-ant-');
    expect(safe.stack).not.toContain('sk-ant-');
  });
});
