import { describe, expect, it } from 'vitest';
import {
  INK_COLORS,
  INK_SCHEMA,
  PAGE_H,
  PAGE_W,
  boardName,
  boardOfAsset,
  boardSvg,
  drawsWith,
  emptyDoc,
  eraseAt,
  erasesWith,
  inkEtag,
  pageBounds,
  parseInk,
  pressureOf,
  radiusAt,
  recorded,
  redone,
  rulesPath,
  serializeInk,
  strokePath,
  undone,
  withPage,
  withPageAfter,
  type InkDoc,
  type InkPalette,
  type InkStroke,
} from './ink';

const line = (x0: number, y0: number, x1: number, y1: number, p = 0.5, n = 10): number[] => {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, p);
  return out;
};
const pen = (points: number[], over: Partial<InkStroke> = {}): InkStroke => ({ tool: 'pen', color: 'text', width: 6, points, ...over });
const palette: InkPalette = {
  colors: Object.fromEntries(INK_COLORS.map((c, i) => [c, `rgb(${i}, 0, 0)`])) as InkPalette['colors'],
  paper: 'rgb(255, 255, 255)',
  rule: 'rgb(200, 200, 200)',
};

describe('the board file', () => {
  it('reads back what it wrote, points rounded', () => {
    const doc: InkDoc = { schema: INK_SCHEMA, pages: [{ background: 'grid', strokes: [pen([1.234, 2.345, 0.4567])] }] };
    const back = parseInk(serializeInk(doc));
    expect(back?.pages[0]?.background).toBe('grid');
    expect(back?.pages[0]?.strokes[0]?.points).toEqual([1.2, 2.3, 0.46]);
  });

  it('is no board without its schema, and leaves out what does not read', () => {
    expect(parseInk('nope')).toBeNull();
    expect(parseInk('{"pages":[]}')).toBeNull();
    const doc = parseInk(
      JSON.stringify({
        schema: INK_SCHEMA,
        pages: [
          {
            background: 'wallpaper',
            image: { href: 'javascript:alert(1)', x: 0, y: 0, w: 10, h: 10 },
            strokes: [
              pen([1, 2, 0.5]),
              { ...pen([1, 2]), note: 'two numbers' },
              { ...pen([1, 2, 0.5]), color: 'red' },
              { ...pen([1, 2, 0.5]), width: 7 },
              { ...pen([1, 0, 0.5]), points: [1, 'x', 0.5] },
            ],
          },
          'not a page',
        ],
      }),
    );
    expect(doc?.pages).toHaveLength(1);
    expect(doc?.pages[0]?.background).toBe('none');
    expect(doc?.pages[0]?.image).toBeUndefined();
    expect(doc?.pages[0]?.strokes).toHaveLength(1);
  });

  it('keeps a picture behind only as a raster data address', () => {
    const href = 'data:image/png;base64,iVBORw0KGgo=';
    const doc = parseInk(JSON.stringify({ schema: INK_SCHEMA, pages: [{ background: 'none', image: { href, x: 0, y: 0, w: 5, h: 5 }, strokes: [] }] }));
    expect(doc?.pages[0]?.image?.href).toBe(href);
    const svg = parseInk(
      JSON.stringify({ schema: INK_SCHEMA, pages: [{ image: { href: 'data:image/svg+xml;base64,PHN2Zy8+', x: 0, y: 0, w: 5, h: 5 }, strokes: [] }] }),
    );
    expect(svg?.pages[0]?.image).toBeUndefined();
  });

  it('has a page even when none was kept', () => {
    expect(parseInk(JSON.stringify({ schema: INK_SCHEMA, pages: [] }))?.pages).toHaveLength(1);
  });
});

describe('a stroke', () => {
  it('grows with the pressure of a pen; a mouse presses half, a marker is wide and even', () => {
    expect(pressureOf('mouse', 0)).toBe(0.5);
    expect(pressureOf('pen', 0)).toBe(0.5);
    expect(pressureOf('pen', 0.9)).toBe(0.9);
    expect(radiusAt({ tool: 'pen', width: 6 }, 1)).toBeGreaterThan(radiusAt({ tool: 'pen', width: 6 }, 0.1));
    expect(radiusAt({ tool: 'marker', width: 6 }, 0.1)).toBe(radiusAt({ tool: 'marker', width: 6 }, 1));
    expect(radiusAt({ tool: 'marker', width: 6 }, 1)).toBeGreaterThan(radiusAt({ tool: 'pen', width: 6 }, 1));
  });

  it('is drawn as a closed outline, a dot as a circle', () => {
    const d = strokePath(pen(line(0, 0, 100, 0)));
    expect(d).toMatch(/^M[-\d.]+ [-\d.]+.*Z$/);
    expect(d).toContain('A');
    expect(strokePath(pen([5, 5, 0.5]))).toMatch(/^M.*A.*A.*Z$/);
    expect(strokePath(pen([]))).toBe('');
  });

  it('is wider where it was pressed harder', () => {
    const outline = (p: number) => {
      // A line far below its own length: every number above 900 is a y of its edges.
      const nums = (strokePath(pen(line(0, 1000, 200, 1000, p))).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const ys = nums.filter((y) => y > 900);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(outline(1)).toBeGreaterThan(outline(0.1));
  });
});

describe('the eraser', () => {
  it('takes the strokes it touches, and only those', () => {
    const page = { background: 'none' as const, strokes: [pen(line(0, 0, 100, 0)), pen(line(0, 200, 100, 200))] };
    const after = eraseAt(page, 50, 3, 4);
    expect(after.strokes).toHaveLength(1);
    expect(after.strokes[0]?.points[1]).toBe(200);
    expect(eraseAt(page, 50, 100, 4)).toBe(page);
  });

  it('touches a dot as well', () => {
    const page = { background: 'none' as const, strokes: [pen([10, 10, 0.5])] };
    expect(eraseAt(page, 12, 10, 1).strokes).toHaveLength(0);
  });

  it('is the eraser end of a pen or its button, never a mouse or a finger', () => {
    expect(erasesWith({ pointerType: 'pen', button: 5, buttons: 32 })).toBe(true);
    expect(erasesWith({ pointerType: 'pen', button: -1, buttons: 32 })).toBe(true);
    expect(erasesWith({ pointerType: 'pen', button: 0, buttons: 1 })).toBe(false);
    expect(erasesWith({ pointerType: 'mouse', button: 5, buttons: 32 })).toBe(false);
  });
});

describe('the palm', () => {
  it('draws with a finger only until a pen was seen', () => {
    expect(drawsWith('touch', false)).toBe(true);
    expect(drawsWith('touch', true)).toBe(false);
    expect(drawsWith('pen', true)).toBe(true);
    expect(drawsWith('mouse', true)).toBe(true);
  });
});

describe('undo and redo', () => {
  it('go back and forth; a new change drops what was undone', () => {
    const a = emptyDoc();
    const b = withPage(a, 0, { background: 'none', strokes: [pen([1, 1, 0.5])] });
    const c = withPage(b, 0, { background: 'none', strokes: [] });
    let h = recorded(recorded({ past: [], future: [] }, a), b);
    const back = undone(h, c);
    expect(back?.doc).toBe(b);
    h = back?.history ?? h;
    const fwd = redone(h, b);
    expect(fwd?.doc).toBe(c);
    expect(undone({ past: [], future: [] }, a)).toBeNull();
    expect(redone({ past: [], future: [] }, a)).toBeNull();
    expect(recorded(h, b).future).toEqual([]);
  });
});

describe('pages', () => {
  it('a new one comes after the current one with its background', () => {
    const doc: InkDoc = { schema: INK_SCHEMA, pages: [{ background: 'lines', strokes: [] }, { background: 'none', strokes: [] }] };
    const more = withPageAfter(doc, 0);
    expect(more.pages.map((p) => p.background)).toEqual(['lines', 'lines', 'none']);
  });

  it('a page is as large as its strokes, at least the page', () => {
    expect(pageBounds({ background: 'none', strokes: [] })).toEqual({ x: 0, y: 0, w: PAGE_W, h: PAGE_H });
    const b = pageBounds({ background: 'none', strokes: [pen([-100, 2000, 1])] });
    expect(b.x).toBeLessThan(-100);
    expect(b.y + b.h).toBeGreaterThan(2000);
  });

  it('the rules of a background', () => {
    expect(rulesPath('none', 0)).toBe('');
    expect(rulesPath('lines', 0)).not.toContain('V');
    expect(rulesPath('grid', 0)).toContain('V');
  });
});

describe('the preview', () => {
  it('draws every page below the other in the colours given, with a title', () => {
    const doc: InkDoc = {
      schema: INK_SCHEMA,
      pages: [
        { background: 'grid', strokes: [pen(line(100, 100, 200, 100), { color: 'bad' })] },
        { background: 'none', strokes: [pen(line(100, 100, 200, 100), { tool: 'marker', color: 'ok' })] },
      ],
    };
    const svg = boardSvg(doc, palette, 'Sketch <1> & "2"');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<title>Sketch &lt;1> &amp; &quot;2&quot;</title>');
    expect(svg).toContain(`fill="${palette.colors.bad}"`);
    expect(svg).toContain(`fill="${palette.colors.ok}" fill-opacity="0.35"`);
    expect(svg).toContain('translate(0 1040)');
    expect(svg).toContain(`viewBox="0 0 ${PAGE_W} ${2 * PAGE_H + 40}"`);
  });

  it('carries no colour that could leave its attribute', () => {
    const svg = boardSvg(
      { schema: INK_SCHEMA, pages: [{ background: 'none', strokes: [pen([1, 1, 0.5])] }] },
      { ...palette, colors: { ...palette.colors, text: '"/><script>x</script>' }, paper: 'url(x)' },
      'x',
    );
    expect(svg).not.toContain('<script');
    expect(svg).toContain('fill="black"');
    expect(svg).toContain('fill="white"');
  });
});

describe('names', () => {
  it('a new board is named by the wall clock', () => {
    expect(boardName(new Date(2026, 10, 20, 9, 5).getTime())).toBe('board-2026-11-20-0905');
  });

  it('the board of an asset below assets/boards/', () => {
    expect(boardOfAsset('assets/boards/board-1.svg')).toBe('board-1');
    expect(boardOfAsset('assets/boards/board-1.ink.json')).toBe('board-1');
    expect(boardOfAsset('assets/images/board-1.svg')).toBeNull();
    expect(boardOfAsset('assets/boards/a/b.svg')).toBeNull();
  });

  it('the etag is the one the engine gives', async () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223...
    expect(await inkEtag('abc')).toBe('sha256:ba7816bf8f01cfea');
  });
});
