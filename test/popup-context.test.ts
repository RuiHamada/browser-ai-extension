import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chromeMock.js';

let mock: ChromeMock;

function selectText(node: Node, start: number, end: number): void {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  Object.defineProperty(range, 'getBoundingClientRect', {
    value: () => ({ left: 50, top: 50, right: 250, bottom: 70, width: 200, height: 20 }),
  });
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

beforeEach(async () => {
  mock = installChromeMock();
  document.body.innerHTML = '<article><p id="passage">Before the selection, <span>While the most demanding projects still call for Astra</span>, work happens at different scales afterward.</p></article>';
  vi.useFakeTimers();
  vi.resetModules();
  await import('../src/content/index.js');
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
  uninstallChromeMock();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('選択位置の自動解説', () => {
  it('前後の文章と選択範囲を区別して送信し、回答を Markdown として表示する', async () => {
    mock.runtime.sendMessage.mockResolvedValue({
      text: '## 意味\n**強調**された解説です。',
    });
    const selectedNode = document.querySelector('span')!.firstChild!;
    selectText(selectedNode, 0, selectedNode.textContent!.length);

    document.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(130);
    await Promise.resolve();
    await Promise.resolve();

    const message = mock.runtime.sendMessage.mock.calls[0]?.[0] as { userMessage: string };
    expect(message.userMessage).toContain('Page context');
    expect(message.userMessage).toContain('<before>\nBefore the selection,\n</before>');
    expect(message.userMessage).toContain('<selection>\nWhile the most demanding projects still call for Astra\n</selection>');
    expect(message.userMessage).toContain('<after>\n, work happens at different scales afterward.\n</after>');

    const popup = document.getElementById('browser-ai-floating-host')?.shadowRoot?.getElementById('explanation');
    expect(popup?.querySelector('h2')?.textContent).toBe('意味');
    expect(popup?.querySelector('strong')?.textContent).toBe('強調');
    expect(popup?.textContent).not.toContain('##');
  });

  it('単語の選択でも文中の前後を渡し、長いページの後半でも文脈を失わない', async () => {
    document.querySelector('article')!.innerHTML = `<p>${'unrelated '.repeat(2500)}</p><p id="target">She took a break because she was exhausted.</p>`;
    mock.runtime.sendMessage.mockResolvedValue({ text: 'この文では「休憩」を意味します。' });
    const node = document.getElementById('target')!.firstChild!;
    const start = node.textContent!.indexOf('break');
    selectText(node, start, start + 'break'.length);

    document.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(230);
    await Promise.resolve();

    const message = mock.runtime.sendMessage.mock.calls[0]?.[0] as { userMessage: string; useShortPrompt: boolean };
    expect(message.useShortPrompt).toBe(true);
    expect(message.userMessage).toContain('<selection>\nbreak\n</selection>');
    expect(message.userMessage).toContain('<before>\nShe took a\n</before>');
    expect(message.userMessage).toContain('<after>\nbecause she was exhausted.\n</after>');
    // 指示文は Side Panel の Explain selection と同じで、追加の指示は付けない
    expect(message.userMessage.startsWith('Page context (for reference, do not summarize this):\n<page>\n')).toBe(true);
    expect(message.userMessage).toContain('Explain the following selection within that context:\n<selection>\nbreak\n</selection>');
    expect(message.userMessage).not.toContain('Clarify');
  });
});
