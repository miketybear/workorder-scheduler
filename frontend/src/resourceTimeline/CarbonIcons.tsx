import styles from './ResourceTimeline.module.css';

// Paths copied unchanged from @carbon/icons 11.91.0 (Apache-2.0); two icons do not justify the package.
export function RenewIcon() {
  return <svg className={styles.carbonIcon} viewBox="0 0 32 32" aria-hidden="true"><path d="M12,10H6.78A11,11,0,0,1,27,16h2A13,13,0,0,0,6,7.68V4H4v8h8Z" /><path d="M20,22h5.22A11,11,0,0,1,5,16H3a13,13,0,0,0,23,8.32V28h2V20H20Z" /></svg>;
}

export function UploadIcon() {
  return <svg className={styles.carbonIcon} viewBox="0 0 32 32" aria-hidden="true"><path d="M6 18 7.41 19.41 15 11.83 15 30 17 30 17 11.83 24.59 19.41 26 18 16 8 6 18z" /><path d="M6,8V4H26V8h2V4a2,2,0,0,0-2-2H6A2,2,0,0,0,4,4V8Z" /></svg>;
}
