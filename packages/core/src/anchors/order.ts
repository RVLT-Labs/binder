/**
 * Reading order within a document version: page ascending, then top to bottom. Coordinates have
 * their origin at the bottom left, so top to bottom is y descending (page height minus y ascending).
 */
export function compareReadingOrder(
  a: { pageIndex: number; y: number },
  b: { pageIndex: number; y: number },
): number {
  return a.pageIndex - b.pageIndex || b.y - a.y
}
