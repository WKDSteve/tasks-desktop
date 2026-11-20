// What the editor of a text says about its images: an image without a description has nothing a screen reader can
// say and nothing to show when the file is missing.

/** Whether the text has an image without a description: `![](…)` or `![ ](…)`. */
export function lacksAlt(text: string): boolean {
  return /!\[\s*\]\(/.test(text);
}

/** Whether the text names an image below `assets/` of its folder (`![…](assets/…)`): only such a text is drawn with it. */
export function hasAssetImage(text: string): boolean {
  return /!\[[^\]]*\]\(\s*(?:\.\/)?assets\//.test(text);
}
