// Outline icons from Tabler Icons (MIT, Copyright (c) 2020-2026 Pawel Kuna), path data only: the site loads no icon package.
import type { SVGProps } from 'react';

export type IconName = 'BrandGithub' | 'GitFork' | 'Star' | 'Tag' | 'Copy' | 'Check' | 'AlertTriangle' | 'ArrowDown' | 'ArrowRight' | 'Container' | 'Feather' | 'FileText' | 'ListCheck' | 'Route' | 'School' | 'Moon' | 'Sun';

const PATHS: Record<IconName, string[]> = {
  BrandGithub: ["M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5"],
  GitFork: ["M10 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M15 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M7 8v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2v-2", "M12 12l0 4"],
  Star: ["M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245"],
  Tag: ["M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3"],
  Copy: ["M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666", "M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"],
  Check: ["M5 12l5 5l10 -10"],
  AlertTriangle: ["M12 9v4", "M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0", "M12 16h.01"],
  ArrowDown: ["M12 5l0 14", "M18 13l-6 6", "M6 13l6 6"],
  ArrowRight: ["M5 12l14 0", "M13 18l6 -6", "M13 6l6 6"],
  Container: ["M20 4v.01", "M20 20v.01", "M20 16v.01", "M20 12v.01", "M20 8v.01", "M8 5a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1l0 -14", "M4 4v.01", "M4 20v.01", "M4 16v.01", "M4 12v.01", "M4 8v.01"],
  Feather: ["M4 20l10 -10m0 -5v5h5m-9 -1v5h5m-9 -1v5h5m-5 -5l4 -4l4 -4", "M19 10c.638 -.636 1 -1.515 1 -2.486a3.515 3.515 0 0 0 -3.517 -3.514c-.97 0 -1.847 .367 -2.483 1m-3 13l4 -4l4 -4"],
  FileText: ["M14 3v4a1 1 0 0 0 1 1h4", "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2", "M9 9l1 0", "M9 13l6 0", "M9 17l6 0"],
  ListCheck: ["M3.5 5.5l1.5 1.5l2.5 -2.5", "M3.5 11.5l1.5 1.5l2.5 -2.5", "M3.5 17.5l1.5 1.5l2.5 -2.5", "M11 6l9 0", "M11 12l9 0", "M11 18l9 0"],
  Route: ["M3 19a2 2 0 1 0 4 0a2 2 0 0 0 -4 0", "M19 7a2 2 0 1 0 0 -4a2 2 0 0 0 0 4", "M11 19h5.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h4.5"],
  School: ["M22 9l-10 -4l-10 4l10 4l10 -4v6", "M6 10.6v5.4a6 3 0 0 0 12 0v-5.4"],
  Moon: ["M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008"],
  Sun: ["M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"],
};

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

// The same icon as an SVG string, for the header widget that the config writes as HTML.
export const iconSvg = (name: IconName, size: number, cls = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${cls ? ` class="${cls}"` : ''}>${PATHS[name].map((d) => `<path d="${d}"/>`).join('')}</svg>`;
