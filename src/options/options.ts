// 設定ページのスクリプト
// APIキーとモデル選択を chrome.storage.local に保存する

import { AVAILABLE_MODELS, DEFAULT_SETTINGS } from '../types/messages.js';
import { validateOutputLanguage } from '../lib/storage.js';

const $i = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const $s = (id: string): HTMLSelectElement => document.getElementById(id) as HTMLSelectElement;
const $e = (id: string): HTMLElement => document.getElementById(id)!;

// APIキーを末尾4文字のみ見せるマスク文字列を生成する（例: sk-ant-...XXXX）
// キーが短い場合は全体を伏字にする
function maskApiKey(key: string): string {
  if (key.length <= 4) {
    return '****';
  }
  const suffix = key.slice(-4);
  // プレフィックスが識別できる長さなら先頭を残す
  const prefix = key.startsWith('sk-ant-') ? 'sk-ant-' : key.slice(0, 4);
  return `${prefix}...${suffix}`;
}

// モデル選択肢を動的に生成
function buildModelOptions(): void {
  const select = $s('aiModel');
  select.innerHTML = '';
  for (const model of AVAILABLE_MODELS) {
    const opt = document.createElement('option');
    opt.value = model.value;
    opt.textContent = model.label;
    select.appendChild(opt);
  }
}

// 設定を読み込んで画面に反映
function loadSettings(): void {
  chrome.storage.local.get(['apiKey', 'aiModel', 'outputLanguage'], (data) => {
    if (data['apiKey']) {
      const key = data['apiKey'] as string;
      // 保存済みキーは入力欄にロードしない。マスク表示だけを span に出す
      $e('apiKeyMask').textContent = `Saved: ${maskApiKey(key)}`;
      $e('apiKeyMask').style.display = 'block';
    } else {
      $e('apiKeyMask').style.display = 'none';
    }
    if (data['aiModel']) {
      $s('aiModel').value = data['aiModel'] as string;
    } else {
      $s('aiModel').value = DEFAULT_SETTINGS.aiModel;
    }
    // 出力言語: 要素が存在する場合のみ設定（不正値はデフォルトにフォールバック）
    const outputLangEl = document.getElementById('outputLanguage') as HTMLSelectElement | null;
    if (outputLangEl) {
      outputLangEl.value = validateOutputLanguage(data['outputLanguage']);
    }
  });
}

// 設定を保存する
$e('btnSave').addEventListener('click', () => {
  const apiKey = $i('apiKey').value.trim();
  const aiModel = $s('aiModel').value;
  // outputLanguage 要素がない場合はデフォルト "en" を使用
  const outputLangEl = document.getElementById('outputLanguage') as HTMLSelectElement | null;
  const outputLanguage = outputLangEl ? outputLangEl.value : 'en';

  // APIキーが入力されている場合のみ保存対象に含める
  const toSave: Record<string, string> = { aiModel, outputLanguage };
  if (apiKey) {
    toSave['apiKey'] = apiKey;
  }

  chrome.storage.local.set(toSave, () => {
    // 保存後は入力欄をクリアし、マスク表示を更新する（平文が残らないようにする）
    if (apiKey) {
      $i('apiKey').value = '';
      $e('apiKeyMask').textContent = `Saved: ${maskApiKey(apiKey)}`;
      $e('apiKeyMask').style.display = 'block';
    }
    const s = $e('saveStatus');
    s.textContent = 'Settings saved';
    s.className = 'status show success';
    setTimeout(() => s.classList.remove('show'), 3000);
  });
});

// APIキーを削除する
$e('btnClearApiKey').addEventListener('click', () => {
  chrome.storage.local.remove('apiKey', () => {
    $i('apiKey').value = '';
    $e('apiKeyMask').textContent = '';
    $e('apiKeyMask').style.display = 'none';
    const s = $e('saveStatus');
    s.textContent = 'API key cleared';
    s.className = 'status show success';
    setTimeout(() => s.classList.remove('show'), 3000);
  });
});

// chrome.storage.onChanged を購読し、外部（Side Panel 等）からの変更を反映する
// area が 'local' のときのみ処理し、'sync' は無視する
chrome.storage.onChanged.addListener(
  (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;

    // outputLanguage が変更された場合は select を更新（不正値はフォールバック）
    if ('outputLanguage' in changes) {
      const outputLangEl = document.getElementById('outputLanguage') as HTMLSelectElement | null;
      if (outputLangEl) {
        outputLangEl.value = validateOutputLanguage(changes['outputLanguage']?.newValue);
      }
    }

    // aiModel が変更された場合は select を更新（別タブで Options を 2 枚開いた場合の整合性）
    if ('aiModel' in changes) {
      const newModel = changes['aiModel']?.newValue;
      if (typeof newModel === 'string') {
        const modelEl = document.getElementById('aiModel') as HTMLSelectElement | null;
        if (modelEl) {
          modelEl.value = newModel;
        }
      }
    }
  },
);

// 初期化
buildModelOptions();
loadSettings();
