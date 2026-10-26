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

/** warning--filled */
export function WarningFilledIcon({ size = 20 }: IconProps) {
  return <svg {...base(size)}>
    <path fillRule="evenodd" d="M16,2C8.3,2,2,8.3,2,16s6.3,14,14,14s14-6.3,14-14C30,8.3,23.7,2,16,2z M14.9,8h2.2v11h-2.2V8z M16,25c-0.8,0-1.5-0.7-1.5-1.5S15.2,22,16,22c0.8,0,1.5,0.7,1.5,1.5S16.8,25,16,25z" />
  </svg>;
}
