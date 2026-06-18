type IconProps = React.SVGProps<SVGSVGElement>

/**
 * Google Classroom logo (uxwing brand mark).
 * Source: https://uxwing.com/google-classroom-icon/
 * Solid-color paths only (gradient/mask shading overlays dropped to avoid
 * duplicate-id collisions when many instances render on one page).
 * Multi-color brand asset — colors are intentionally hardcoded (not themed).
 */
export function GoogleClassroomIcon({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox='0 0 333333 287879'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      fillRule='evenodd'
      clipRule='evenodd'
      aria-hidden='true'
      {...props}
    >
      <path fill='#0f9d58' d='M30303 30303h272727v227273H30303z' />
      <path
        fill='#57bb8a'
        d='M227272 151515c9407 0 17046-7639 17046-17045 0-9407-7639-17046-17046-17046-9406 0-17045 7639-17045 17046 0 9406 7639 17045 17045 17045zm0 11364c-18245 0-37879 9659-37879 21654v12437h75758v-12437c0-11995-19634-21654-37879-21654zm-121212-11364c9406 0 17045-7639 17045-17045 0-9407-7639-17046-17045-17046-9407 0-17046 7639-17046 17046 0 9406 7639 17046 17045 17046 17045zm0 11364c-18245 0-37879 9659-37879 21654v12437h75758v-12437c0-11995-19634-21654-37879-21654z'
      />
      <path
        fill='#f7f7f7'
        d='M166667 136364c12563 0 22727-10164 22727-22728 0-12563-10164-22727-22727-22727s-22727 10164-22727 22727 10164 22728 22727 22728zm0 15151c-25568 0-53030 13573-53030 30303v15152h106061v-15152c0-16730-27462-30303-53030-30303z'
      />
      <path fill='#f1f1f1' d='M196970 242424h68182v15152h-68182z' />
      <path
        fill='#f4b400'
        d='M310606 0H22727C10164 0 0 10164 0 22727v242424c0 12563 10164 22727 22727 22727h287879c12563 0 22727-10164 22727-22727V22727C333333 10164 323169 0 310606 0zm-7576 257576H30302V30304h272728v227272z'
      />
    </svg>
  )
}
