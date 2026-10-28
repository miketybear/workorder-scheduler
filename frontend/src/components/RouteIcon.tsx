/** Carbon icons (IBM Carbon Design System, Apache-2.0), drawn in the current text colour. */
type IconProps = { size?: number };
const base = (size: number) => ({ 'aria-hidden': true, focusable: 'false', width: size, height: size, viewBox: '0 0 32 32', fill: 'currentColor' }) as const;

/** flow--sequence */
export function RouteIcon({ size = 20 }: IconProps) {
  return <svg {...base(size)}>
    <path d="M20,23h-8.1c0-.4-.2-.7-.4-1l10.5-10.5c.6.4,1.3.6,2,.6,2.2,0,4-1.8,4-4s-1.8-4-4-4-3.4,1.3-3.9,3h-7.1v2h7.1c0,.4.2.7.4,1l-10.5,10.5c-.6-.4-1.3-.6-2-.6-2.2,0-4,1.8-4,4s1.8,4,4,4,3.4-1.3,3.9-3h8.1v3h8v-8h-8v3ZM24,6c1.1,0,2,.9,2,2s-.9,2-2,2-2-.9-2-2,.9-2,2-2ZM8,26c-1.1,0-2-.9-2-2s.9-2,2-2,2,.9,2,2-.9,2-2,2ZM22,22h4v4h-4v-4ZM4,12V4l7,4-7,4Z" />
  </svg>;
}

/** checkmark--filled */
export function CheckmarkFilledIcon({ size = 20 }: IconProps) {
  return <svg {...base(size)}>
    <path fillRule="evenodd" d="M16,2A14,14,0,1,0,30,16,14,14,0,0,0,16,2ZM14,21.5908l-5-5L10.5906,15,14,18.4092,21.41,11l1.5957,1.5859Z" />
  </svg>;
}

/** calendar */
export function CalendarIcon({ size = 20 }: IconProps) {
  return <svg {...base(size)}>
    <path d="M26,4h-4V2h-2v2h-8V2h-2v2H6C4.9,4,4,4.9,4,6v20c0,1.1.9,2,2,2h20c1.1,0,2-.9,2-2V6c0-1.1-.9-2-2-2ZM26,26H6V12h20v14ZM26,10H6V6h4v2h2v-2h8v2h2v-2h4v4Z" />
  </svg>;
}

/** renew */
export function RenewIcon({ size = 20 }: IconProps) {
  return <svg {...base(size)}>
    <path d="M12,10H6.78A11,11,0,0,1,27,16h2A13,13,0,0,0,6,7.68V4H4v8h8Z" />
    <path d="M20,22h5.22A11,11,0,0,1,5,16H3a13,13,0,0,0,23,8.32V28h2V20H20Z" />
  </svg>;
}

/** filter */
export function FilterIcon({ size = 20 }: IconProps) {
  return <svg {...base(size)}>
    <path d="M18,28H14a2,2,0,0,1-2-2V18.41L4.59,11A2,2,0,0,1,4,9.59V6A2,2,0,0,1,6,4H26a2,2,0,0,1,2,2V9.59A2,2,0,0,1,27.41,11L20,18.41V26A2,2,0,0,1,18,28ZM6,6V9.59l8,8V26h4V17.59l8-8V6Z" />
  </svg>;
}

/** row--collapse: tighter rows */
export function RowCollapseIcon({ size = 20 }: IconProps) {
  return <svg {...base(size)}>
    <path d="M4,2H28V4H4Z M4,28H28v2H4Z M16,13.17,11.41,8.59,10,10l6,6,6-6-1.41-1.41Z M16,18.83l4.59,4.58L22,22l-6-6-6,6,1.41,1.41Z" />
  </svg>;
}

/** row--expand: roomier rows */
export function RowExpandIcon({ size = 20 }: IconProps) {
  return <svg {...base(size)}>
    <path d="M4,15H28v2H4Z M16,6.83l4.59,4.58L22,10,16,4,10,10l1.41,1.41Z M16,25.17l-4.59-4.58L10,22l6,6,6-6-1.41-1.41Z" />
  </svg>;
}

/** maximize */
export function MaximizeIcon({ size = 20 }: IconProps) {
  return <svg {...base(size)}>
    <path d="M20,2v2h6.586L18,12.582,19.414,14,28,5.414V12h2V2Z M14,19.416L12.592,18,4,26.586V20H2V30H12V28H5.414Z" />
  </svg>;
}

/** minimize */
export function MinimizeIcon({ size = 20 }: IconProps) {
  return <svg {...base(size)}>
    <path d="M4,18v2h6.586L2,28.582,3.414,30,12,21.414V28h2V18Z M30,3.416L28.592,2,20,10.586V4H18V14H28V12H21.414Z" />
  </svg>;
}

/** warning--filled */
export function WarningFilledIcon({ size = 20 }: IconProps) {
  return <svg {...base(size)}>
    <path fillRule="evenodd" d="M16,2C8.3,2,2,8.3,2,16s6.3,14,14,14s14-6.3,14-14C30,8.3,23.7,2,16,2z M14.9,8h2.2v11h-2.2V8z M16,25c-0.8,0-1.5-0.7-1.5-1.5S15.2,22,16,22c0.8,0,1.5,0.7,1.5,1.5S16.8,25,16,25z" />
  </svg>;
}
