import { useEffect } from 'react';
import styles from '../App.module.css';

/** Carbon-style toast: a short confirmation that closes itself after five seconds. */
export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);
  if (!message) return null;
  return <div role="status" className={styles.toast}>
    <span>{message}</span>
    <button type="button" className={styles.toastClose} aria-label="Đóng thông báo" onClick={onClose}>×</button>
  </div>;
}
