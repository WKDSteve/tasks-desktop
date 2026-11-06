// The picture of a view: the sheet the printer gets (its rows and groups, nothing of a private or unclassified area), as
// one long PNG. A module of its own: the library comes when a picture is asked for. Only in the web variant: drawing goes
// through an SVG image with a data: address, which the policy of the hub's page does not allow (`img-src 'self'`).

import { saveBlob } from './dailyExport';
import type { PrintSheet } from './export';
import { sheetElement } from './exportDom';

const WIDTH = 1100;
const SCALE = 2;
/** The longest side of a canvas in Chrome. Above it a canvas gives no image, and the library hands on an empty file. */
const MAX_CANVAS = 65_535;

/** Whether a sheet of this height (CSS pixels) fits a canvas. */
export function fitsCanvas(height: number): boolean {
  return height * SCALE <= MAX_CANVAS;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Whether the bytes are a PNG with a picture in it: the file a canvas that failed gives is a few bytes of nothing. */
export function isPicture(head: Uint8Array): boolean {
  if (!PNG_SIGNATURE.every((byte, i) => head[i] === byte)) return false;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  return head.length >= 24 && view.getUint32(16) > 0 && view.getUint32(20) > 0;
}

export type PngResult = 'saved' | 'too_long' | 'failed';

/** The look of the sheet, on the elements: no rule of the page reaches the picture. */
function dress(page: HTMLElement): void {
  page.style.cssText = `position:fixed;left:-${WIDTH * 2}px;top:0;width:${WIDTH}px;padding:24px;box-sizing:border-box;background:#fff;color:#000;font:13px/1.4 system-ui,sans-serif`;
  for (const table of page.querySelectorAll('table')) table.style.cssText = 'border-collapse:collapse;width:100%;margin:8px 0 16px';
  for (const cell of page.querySelectorAll<HTMLElement>('th,td')) cell.style.cssText = 'border:1px solid #999;padding:3px 6px;text-align:left;overflow-wrap:anywhere';
  for (const h of page.querySelectorAll<HTMLElement>('h1')) h.style.cssText = 'font-size:18px;margin:0 0 6px';
  for (const h of page.querySelectorAll<HTMLElement>('h2')) h.style.cssText = 'font-size:15px;margin:14px 0 4px';
  for (const p of page.querySelectorAll<HTMLElement>('p')) p.style.cssText = 'margin:0 0 4px';
}

/** Draw `sheet` and save it as `name`. A sheet too long for a canvas is not drawn: it is for the printer. */
export async function savePng(doc: Document, sheet: PrintSheet, name: string): Promise<PngResult> {
  const page = sheetElement(doc, sheet, 'view-png');
  dress(page);
  doc.body.append(page);
  try {
    if (!fitsCanvas(page.getBoundingClientRect().height)) return 'too_long';
    const { domToBlob } = await import('modern-screenshot');
    // No fonts of the page in the picture: the system's are enough for a table, and there is nothing to fetch.
    const blob = await domToBlob(page, { type: 'image/png', scale: SCALE, backgroundColor: '#ffffff', font: false });
    if (!isPicture(new Uint8Array(await blob.slice(0, 24).arrayBuffer()))) return 'failed';
    return saveBlob(doc, name, blob) ? 'saved' : 'failed';
  } catch {
    return 'failed';
  } finally {
    page.remove();
  }
}
