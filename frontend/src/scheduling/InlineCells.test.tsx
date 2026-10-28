import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PicSelect } from './InlineCells';

it('shows only the person code in the closed PIC cell and keeps "code — name" in the list', () => {
  render(<PicSelect label="PIC" value="CUONGLV" pics={['CUONGLV', 'BANPV']} names={{ CUONGLV: 'Le Viet Cuong', BANPV: 'Pham Van Ban' }}
    disabled={false} onChange={() => {}} />);
  const select = screen.getByRole('combobox', { name: 'PIC' });
  expect(select.parentElement).toHaveTextContent(/CUONGLV$/);
  expect(select).toHaveAttribute('title', 'CUONGLV — Le Viet Cuong');
  expect(screen.getByRole('option', { name: 'CUONGLV — Le Viet Cuong' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'BANPV — Pham Van Ban' })).toBeInTheDocument();
});
