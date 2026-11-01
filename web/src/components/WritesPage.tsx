import MDXContent from '@theme/MDXContent';
import SitePage from './SitePage';
import Writes from '../pages/_generated/writes.md';

// The sections of docs/setup.md and docs/security.md, written by scripts/generate.mjs.
export default function WritesPage() {
  return (
    <SitePage title="What the app writes, BenchKeeper" description="What the BenchKeeper app writes to your machine and repositories, where each write is confined, and what it never does, from docs/setup.md and docs/security.md.">
      <div className="bk-stack bk-wide">
        <h1 className="bk-title">What the app writes and what it never does</h1>
        <div className="doc"><MDXContent><Writes /></MDXContent></div>
      </div>
    </SitePage>
  );
}
