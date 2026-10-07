import { useEffect, useRef } from 'react';

function available(element: HTMLElement) {
  const closed = element.closest('details:not([open])');
  return !element.closest('[hidden], [inert]') && !element.matches(':disabled') &&
    (!closed || element === closed.querySelector('summary'));
}

// The workspace retains panels across routes; a hidden panel must release keyboard focus.
export function usePanelFocus(enabled: boolean, panelKey: unknown) {
  const workspace = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const previousPanel = useRef<HTMLElement | null>(null);
  const previousKey = useRef<unknown>(null);
  useEffect(() => {
    const root = workspace.current;
    if (!root) return;
    if (!enabled) {
      if (!previousPanel.current) return;
      const focused = document.activeElement;
      if (focused === document.body || (focused && previousPanel.current?.contains(focused))) {
        const target = opener.current;
        if (target?.isConnected && available(target)) target.focus({ preventScroll: true });
        else if (!panelKey && available(root)) root.focus({ preventScroll: true });
      }
      if (!panelKey) { opener.current = null; previousPanel.current = null; }
      return;
    }
    const panel = root.querySelector<HTMLElement>('[role="dialog"]');
    if (!panel) return;
    const focused = document.activeElement;
    const fromWorkspace = panelKey !== previousKey.current && focused && root.contains(focused) &&
      !previousPanel.current?.contains(focused);
    if ((!opener.current || fromWorkspace) && focused instanceof HTMLElement &&
        focused !== document.body && !panel.contains(focused)) {
      opener.current = focused;
    }
    previousKey.current = panelKey;
    previousPanel.current = panel;
    panel.focus({ preventScroll: true });
    let focusTimer: number | undefined;
    function retain(event: FocusEvent) {
      if (!(event.target instanceof Node) || !panel!.contains(event.target)) return;
      // Disabling the focused Save button sends browser focus to the body.
      // Wait until the browser finishes moving focus for an ordinary Tab.
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        if (panel!.isConnected && available(panel!) && document.activeElement === document.body) {
          panel!.focus({ preventScroll: true });
        }
      });
    }
    function tab(event: KeyboardEvent) {
      if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      const controls = [...panel!.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]')]
        .filter((element) => element.tabIndex >= 0 && available(element));
      const first = controls[0], last = controls.at(-1);
      const focused = document.activeElement;
      if (focused !== document.body && focused && !panel!.contains(focused)) return;
      if (!first || focused === panel || focused === document.body || (event.shiftKey ? focused === first : focused === last)) {
        event.preventDefault();
        (event.shiftKey ? last ?? panel : first ?? panel)!.focus({ preventScroll: true });
      }
    }
    document.addEventListener('keydown', tab);
    panel.addEventListener('focusout', retain);
    return () => {
      document.removeEventListener('keydown', tab);
      panel.removeEventListener('focusout', retain);
      window.clearTimeout(focusTimer);
      if (!root.isConnected && opener.current?.isConnected && available(opener.current)) {
        opener.current.focus({ preventScroll: true });
      }
    };
  }, [enabled, panelKey]);
  return workspace;
}
