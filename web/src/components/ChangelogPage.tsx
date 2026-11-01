import SitePage from './SitePage';
import Changelog from '../pages/_generated/changelog.md';

// The changelogs of the app, the setup content and the versions up to 6.25, written by scripts/generate.mjs.
export default function ChangelogPage() {
  return (
    <SitePage title="Changelog, BenchKeeper" description="The versions of BenchKeeper and what each one changed, from the changelogs of the app, the setup content and CHANGELOG.md.">
      <div className="bk-stack bk-wide">
        <h1 className="bk-title">Changelog</h1>
        <div className="doc"><Changelog /></div>
      </div>
    </SitePage>
  );
}
