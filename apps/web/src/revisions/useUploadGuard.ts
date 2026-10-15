import { useBlocker } from '@tanstack/react-router'

export const LEAVE_UPLOAD_QUESTION = 'The upload is still running. Stop it and leave?'

/**
 * While `active`, leaving the page asks first: closing the tab or reloading (the browser's prompt),
 * and moving to another screen (a confirm). Changing only the search of the same screen, such as the
 * page number, never asks.
 */
export function useUploadGuard(active: boolean): void {
  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      active && current.fullPath !== next.fullPath && !window.confirm(LEAVE_UPLOAD_QUESTION),
    enableBeforeUnload: active,
    disabled: !active,
  })
}
