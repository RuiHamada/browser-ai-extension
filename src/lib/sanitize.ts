// エラーメッセージのサニタイズユーティリティ（F-011）
// APIキーなどの機密情報がログや UI に漏洩しないようにする

/** APIキーパターン（sk-ant- で始まる文字列）を伏字にする正規表現 */
const API_KEY_PATTERN = /sk-ant-[^\s"']*/g;

/**
 * エラーメッセージ文字列から APIキーなどの機密情報を除去する（F-011）
 * paranoid check として sk-ant- パターンを [REDACTED] に置換する
 */
export function sanitizeErrorMessage(msg: string): string {
  return msg.replace(API_KEY_PATTERN, '[REDACTED]');
}

/**
 * エラーオブジェクトをログ出力用にサニタイズする（F-011）
 * message と stack の両方に sanitize を適用し、APIキーが残らないようにする
 * @param err - catch した error（型不定）
 * @returns message と stack を sanitize した安全なオブジェクト
 */
export function sanitizeErrorForLog(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      message: sanitizeErrorMessage(err.message),
      // Error.stack は Error.message を含むため、stack にも sanitize が必要
      stack: err.stack !== undefined ? sanitizeErrorMessage(err.stack) : undefined,
    };
  }
  return {
    message: sanitizeErrorMessage(String(err)),
  };
}
