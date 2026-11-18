// @vitest-environment jsdom
// One card on paper and the bars as a file, in a DOM: a dialog that sends no `afterprint` leaves nothing behind, and
// the file names an area only as the view allows.
import { afterEach, describe, expect, it } from 'vitest';
import { clearPrintPages } from './exportDom';
import { barsSvgOf, PRINT_CARD_ATTR, PRINT_CARD_CLASS, printCard } from './statsSvg';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
});

/** A window whose dialog never says it is done; `done` sends the `afterprint` of every print so far. */
function silentWindow(): { win: Pick<Window, 'print' | 'addEventListener'>; done: () => void } {
  const after: (() => void)[] = [];
  const addEventListener = ((_: string, fn: () => void) => {
    after.push(fn);
  }) as unknown as Window['addEventListener'];
  return { win: { print: () => undefined, addEventListener }, done: () => after.splice(0).forEach((fn) => fn()) };
}

describe('a card on paper', () => {
  it('keeps the theme of the person when a dialog before it sent no afterprint', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    const a = document.createElement('section');
    const b = document.createElement('section');
    document.body.append(a, b);
    const { win, done } = silentWindow();
    expect(printCard(document, win, a)).toBe(true);
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(printCard(document, win, b)).toBe(true);
    expect(a.hasAttribute(PRINT_CARD_ATTR)).toBe(false);
    done();
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.classList.contains(PRINT_CARD_CLASS)).toBe(false);
    expect(b.hasAttribute(PRINT_CARD_ATTR)).toBe(false);
  });

  it('is taken away, theme and all, when a whole view is printed after it', () => {
    const root = document.documentElement;
    const card = document.createElement('section');
    document.body.append(card);
    printCard(document, silentWindow().win, card);
    clearPrintPages(document);
    expect(root.classList.contains(PRINT_CARD_CLASS)).toBe(false);
    expect(card.hasAttribute(PRINT_CARD_ATTR)).toBe(false);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});

describe('the bars as a file', () => {
  it('names each area as it is told, never by the text shown', () => {
    const chart = document.createElement('div');
    chart.innerHTML =
      '<button class="area" data-area="pub">pub</button><span class="total">2</span>' +
      '<button class="area" data-area="secret">secret</button><span class="total">1</span>';
    document.body.append(chart);
    const svg = barsSvgOf(chart, 'white', 'Bars <&>', (el) => (el.getAttribute('data-area') === 'secret' ? '(hidden)' : 'pub'));
    expect(svg).toContain('>pub</text>');
    expect(svg).toContain('>(hidden)</text>');
    expect(svg).not.toContain('secret');
    expect(svg).toContain('<title>Bars &#60;&#38;&#62;</title>');
  });
});
