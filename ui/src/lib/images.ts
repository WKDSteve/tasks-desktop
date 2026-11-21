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

/**
 * Whether a path below the container's folder is an image the hub hands on (`GET /api/tasks/asset`): a plain path
 * below `assets/` of a picture kind (png, jpg, jpeg, gif, webp, svg). A PDF or a video below `assets/` is none.
 */
export function isAssetImage(path: string | undefined): path is string {
  if (typeof path !== 'string' || !path.startsWith('assets/')) return false;
  if (path.split('/').some((part) => part === '' || part === '.' || part === '..') || /[\s\\]/.test(path)) return false;
  return /\.(?:png|jpe?g|gif|webp|svg)$/i.test(path);
}
