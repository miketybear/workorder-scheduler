import { useLayoutEffect, useState } from 'react';

const preferenceKey = 'workorder-scheduler-theme';
type Theme = 'g10' | 'g100';

function initialTheme(): Theme {
  try {
    return localStorage.getItem(preferenceKey) === 'g100' ? 'g100' : 'g10';
  } catch {
    // Theme preferences remain optional when browser storage is unavailable.
    return 'g10';
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(initialTheme);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'g100' ? '#161616' : '#f4f4f4');
  }, [theme]);

  function toggle() {
    const next = theme === 'g10' ? 'g100' : 'g10';
    setTheme(next);
    try { localStorage.setItem(preferenceKey, next); } catch {
      // A blocked preference store must not prevent the current theme from changing.
    }
  }

  return <button type="button" role="switch" aria-label="Chế độ tối" aria-checked={theme === 'g100'} onClick={toggle}>
    {theme === 'g100' ? 'Tối · Gray 100' : 'Sáng · Gray 10'}
  </button>;
}
