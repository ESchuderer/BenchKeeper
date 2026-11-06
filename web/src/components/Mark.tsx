import type { CSSProperties } from 'react';

// The CedarLoom mark in the colors of the page's scheme. The brand has no dark-scheme icon yet: in the dark scheme the
// mark is the left square of the dark logo (global.css, .mark), which draws it in the dark colors.
export default function Mark({ base, size, alt = '', style }: { base: string; size: number; alt?: string; style?: CSSProperties }) {
  return (
    <>
      <img src={`${base}/brand/cedarloom-icon.svg`} alt={alt} width={size} height={size} className="mark mark-light" style={style} />
      <img src={`${base}/brand/cedarloom-dark.svg`} alt={alt} width={size} height={size} className="mark mark-dark" style={style} />
    </>
  );
}
