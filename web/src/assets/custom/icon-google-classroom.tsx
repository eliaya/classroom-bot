type IconProps = React.SVGProps<SVGSVGElement>

/**
 * Google Classroom logo (classic green board mark).
 * Source reference: https://commons.wikimedia.org/wiki/File:Google_Classroom_Logo.svg
 * Multi-color brand mark — colors are intentionally hardcoded (brand asset, not themed).
 */
export function GoogleClassroomIcon({
  className,
  ...props
}: IconProps) {
  return (
    <svg
      viewBox='0 0 48 48'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
      {...props}
    >
      <path fill='#0F9D58' d='M40 8H8a2 2 0 0 0-2 2v28a2 2 0 0 0 2 2h32a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2z' />
      <circle fill='#FFF' cx='24' cy='22.5' r='3.5' />
      <path fill='#FFF' d='M17 31c0-2.8 3.1-4.5 7-4.5s7 1.7 7 4.5v1H17v-1z' />
      <circle fill='#57BB8A' cx='14.5' cy='23' r='2.5' />
      <path fill='#57BB8A' d='M9.5 30c0-2 2.2-3.2 5-3.2.5 0 1 .05 1.4.13C14.3 28 13.5 29.4 13.5 31v.5H9.5V30z' />
      <circle fill='#57BB8A' cx='33.5' cy='23' r='2.5' />
      <path fill='#57BB8A' d='M38.5 30c0-2-2.2-3.2-5-3.2-.5 0-1 .05-1.4.13C33.7 28 34.5 29.4 34.5 31v.5h4V30z' />
      <rect fill='#F1F1F1' x='30' y='34' width='8' height='2.5' rx='1.25' />
    </svg>
  )
}
