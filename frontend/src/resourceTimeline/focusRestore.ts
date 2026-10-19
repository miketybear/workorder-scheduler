// A dialog hands focus back to the card that opened it. That is not keyboard navigation, so the card must
// not pop its tooltip open (the mouse is elsewhere, nothing would ever dismiss it).
let restoring = false;

export function restoreFocus(element: HTMLElement): void {
  restoring = true;
  try { element.focus(); } finally { restoring = false; }
}

export function isRestoringFocus(): boolean { return restoring; }
