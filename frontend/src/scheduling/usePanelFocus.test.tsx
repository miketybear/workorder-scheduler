import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { usePanelFocus } from './usePanelFocus';

function Workspace({ panel, active = true }: { panel: string | null; active?: boolean }) {
  const workspace = usePanelFocus(active && !!panel, panel);
  return <div hidden={!active} ref={workspace} tabIndex={-1}>
    <button>WO opener</button><button>Background action</button>
    {panel && <section role="dialog" aria-label={panel} tabIndex={-1}>
      <button>First</button><input aria-label="Edit" /><fieldset disabled><button>Disabled</button></fieldset>
      <div hidden><button>Hidden</button></div>
      <details><summary>Paste</summary><textarea aria-label="Paste data" /><button>Apply paste</button></details>
      <button>Last</button>
    </section>}
  </div>;
}

it('enters each panel, cycles at both boundaries, and skips disabled/hidden/closed controls', () => {
  const view = render(<Workspace panel={null} />);
  const opener = screen.getByText('WO opener'); opener.focus();
  for (const panel of ['single', 'chooser', 'batch']) {
    view.rerender(<Workspace panel={panel} />);
    const dialog = screen.getByRole('dialog', { name: panel });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByText('First')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(screen.getByText('Last')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.getByText('First')).toHaveFocus();
  }
  view.rerender(<Workspace panel={null} />);
  expect(opener).toHaveFocus();
});

it('includes newly opened details and returns focus to a stable opener after chooser-to-editor', () => {
  const view = render(<Workspace panel={null} />);
  const opener = screen.getByText('WO opener'); opener.focus();
  view.rerender(<Workspace panel="chooser" />);
  screen.getByText('First').focus();
  view.rerender(<Workspace panel="editor" />);
  const details = screen.getByText('Paste').closest('details')!;
  details.open = true;
  screen.getByLabelText('Paste data').focus();
  expect(screen.getByLabelText('Paste data')).toHaveFocus();
  view.rerender(<Workspace panel={null} />);
  expect(opener).toHaveFocus();
});

it('returns to the latest workspace opener when replacing a panel from the background', () => {
  const view = render(<Workspace panel={null} />);
  screen.getByText('WO opener').focus();
  view.rerender(<Workspace panel="chooser" />);
  const next = screen.getByText('Background action'); next.focus();
  view.rerender(<Workspace panel="other WO" />);
  expect(screen.getByRole('dialog', { name: 'other WO' })).toHaveFocus();
  view.rerender(<Workspace panel={null} />);
  expect(next).toHaveFocus();
});

it('releases hidden routes without stealing focus and re-enters the retained editor', () => {
  const view = render(<><button>Settings action</button><Workspace panel={null} /></>);
  screen.getByText('WO opener').focus();
  view.rerender(<><button>Settings action</button><Workspace panel="batch" /></>);
  screen.getByText('Settings action').focus();
  view.rerender(<><button>Settings action</button><Workspace panel="batch" active={false} /></>);
  fireEvent.keyDown(screen.getByText('Settings action'), { key: 'Tab' });
  expect(screen.getByText('Settings action')).toHaveFocus();
  view.rerender(<><button>Settings action</button><Workspace panel="batch" /></>);
  expect(screen.getByRole('dialog')).toHaveFocus();
  view.rerender(<><button>Settings action</button><Workspace panel={null} /></>);
  expect(screen.getByText('WO opener')).toHaveFocus();
});

it('does not focus the workspace before a panel opens or steal focus from external navigation', () => {
  const view = render(<><button>External</button><Workspace panel={null} /></>);
  expect(document.body).toHaveFocus();
  screen.getByText('WO opener').focus();
  view.rerender(<><button>External</button><Workspace panel="single" /></>);
  screen.getByText('External').focus();
  view.rerender(<><button>External</button><Workspace panel={null} /></>);
  expect(screen.getByText('External')).toHaveFocus();
});

it('restores a connected opener on unmount and handles a panel with no enabled controls', () => {
  const outside = document.createElement('button'); document.body.append(outside); outside.focus();
  const view = render(<Workspace panel="single" />);
  const dialog = screen.getByRole('dialog');
  dialog.querySelectorAll('button,input,summary').forEach((element) => element.setAttribute('tabindex', '-1'));
  fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(dialog).toHaveFocus();
  view.unmount();
  expect(outside).toHaveFocus(); outside.remove();
});

it('retains focus when a panel control loses it and leaves external navigation alone', async () => {
  render(<Workspace panel="batch" />);
  const first = screen.getByText('First'); first.focus();
  await act(async () => first.blur());
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
  first.focus();
  await act(async () => screen.getByText('Background action').focus());
  expect(screen.getByText('Background action')).toHaveFocus();
});
