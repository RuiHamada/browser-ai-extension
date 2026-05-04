// manifest.json の妥当性検証
// MV3 / Side Panel API / 必要権限の存在を保証する

import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';

describe('manifest.json', () => {
  it('Manifest V3 である', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('side_panel が定義されている（F-009）', () => {
    expect(manifest.side_panel).toBeDefined();
    expect(manifest.side_panel.default_path).toBeTruthy();
  });

  it('background.service_worker が定義されている', () => {
    expect(manifest.background?.service_worker).toBeTruthy();
  });

  it('options_page と action.default_popup が定義されている', () => {
    expect(manifest.options_page).toBeTruthy();
    expect(manifest.action?.default_popup).toBeTruthy();
  });

  it('storage / sidePanel 権限を持つ', () => {
    expect(manifest.permissions).toContain('storage');
    expect(manifest.permissions).toContain('sidePanel');
  });

  it('host_permissions に Anthropic API のオリジンが含まれる', () => {
    expect(manifest.host_permissions.some((h: string) => h.includes('api.anthropic.com'))).toBe(true);
  });
});
