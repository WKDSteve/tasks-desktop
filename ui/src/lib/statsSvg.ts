// The ways out of a card of the statistics that need the drawn page: the card alone on paper, and its drawing as an
// SVG file. The colours of the file are the ones the page computed (the tokens of the theme shown), written into it:
// a file read elsewhere knows no tokens.

import { clearPrintPages } from './exportDom';

/** The class on the root while one card is printed; the print rules (StatsCard) hide everything else. */
export const PRINT_CARD_CLASS = 'print-card';
/** The attribute on the card that is printed. */
export const PRINT_CARD_ATTR = 'data-print-card';

/**
 * Print the card `el` alone: everything else of the page is left off the paper, and the light theme is used for it
 * (paper is white). Both go when the dialog is done (`afterprint`).
 */
export function printCard(doc: Document, win: Pick<Window, 'print' | 'addEventListener'>, el: HTMLElement): boolean {
  const root = doc.documentElement;
  const theme = root.getAttribute('data-theme');
  const undo = (): void => {
    el.removeAttribute(PRINT_CARD_ATTR);
    root.classList.remove(PRINT_CARD_CLASS);
    if (theme === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  };
  try {
    clearPrintPages(doc);
    for (const other of doc.querySelectorAll(`[${PRINT_CARD_ATTR}]`)) other.removeAttribute(PRINT_CARD_ATTR);
    el.setAttribute(PRINT_CARD_ATTR, '');
    root.classList.add(PRINT_CARD_CLASS);
    root.setAttribute('data-theme', 'light');
    win.addEventListener('afterprint', undo, { once: true });
    win.print();
    return true;
  } catch {
    undo();
    return false;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Text for an SVG file: the five characters XML reads as markup are escaped. */
export function xmlText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The properties of a drawing the page sets by its style sheets; they are written into the file. */
const PAINT = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity', 'font-size', 'font-family'] as const;

/** A drawing of the page (`<svg>`) as the text of a file of its own, with the colours it is shown in now. */
export function svgFileOf(svg: SVGSVGElement, background: string, title: string): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((el, i) => {
    const into = to[i];
    if (!(into instanceof Element)) return;
    into.removeAttribute('class');
    const style = getComputedStyle(el);
    const set = PAINT.map((prop) => [prop, style.getPropertyValue(prop)] as const).filter(([, v]) => v !== '' && v !== 'normal');
    if (el !== svg && set.length > 0) into.setAttribute('style', set.map(([k, v]) => `${k}:${v}`).join(';'));
  });
  copy.removeAttribute('style');
  copy.setAttribute('xmlns', SVG_NS);
  const box = svg.viewBox.baseVal;
  if (box && box.width > 0) {
    copy.setAttribute('width', String(box.width));
    copy.setAttribute('height', String(box.height));
  }
  const back = svg.ownerDocument.createElementNS(SVG_NS, 'rect');
  back.setAttribute('x', String(box?.x ?? 0));
  back.setAttribute('y', String(box?.y ?? 0));
  back.setAttribute('width', '100%');
  back.setAttribute('height', '100%');
  back.setAttribute('fill', background);
  const name = svg.ownerDocument.createElementNS(SVG_NS, 'title');
  name.textContent = title;
  copy.prepend(name, back);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}\n`;
}

/**
 * The bars per area (drawn with boxes, not as a drawing) as an SVG file: each part of a bar a rectangle where it
 * stands, in its colour, the names of the areas and the totals as text.
 */
export function barsSvgOf(chart: HTMLElement, background: string, title: string): string {
  const frame = chart.getBoundingClientRect();
  const width = Math.ceil(frame.width);
  const height = Math.ceil(frame.height);
  const at = (el: Element): DOMRect => el.getBoundingClientRect();
  const parts: string[] = [];
  const text = (el: Element, anchor: 'start' | 'end'): void => {
    const r = at(el);
    const style = getComputedStyle(el);
    const x = anchor === 'end' ? r.right - frame.left : r.left - frame.left;
    const y = r.top - frame.top + r.height / 2;
    parts.push(
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" fill="${xmlText(style.color)}" font-size="${xmlText(style.fontSize)}" font-family="${xmlText(style.fontFamily)}">${xmlText(el.textContent?.trim() ?? '')}</text>`,
    );
  };
  for (const el of chart.querySelectorAll('.area')) text(el, 'end');
  for (const el of chart.querySelectorAll<HTMLElement>('.seg')) {
    const r = at(el);
    const fill = getComputedStyle(el).backgroundColor;
    parts.push(
      `<rect x="${(r.left - frame.left).toFixed(1)}" y="${(r.top - frame.top).toFixed(1)}" width="${r.width.toFixed(1)}" height="${r.height.toFixed(1)}" fill="${xmlText(fill)}"><title>${xmlText(el.title)}</title></rect>`,
    );
  }
  for (const el of chart.querySelectorAll('.total')) text(el, 'start');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<title>${xmlText(title)}</title><rect width="100%" height="100%" fill="${xmlText(background)}"/>${parts.join('')}</svg>\n`
  );
}
