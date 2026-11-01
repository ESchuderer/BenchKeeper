import Link from '@docusaurus/Link';
import SitePage from '../../components/SitePage';

export default function NotFound() {
  return (
    <SitePage title="Page not found, BenchKeeper" description="This page does not exist on the BenchKeeper site.">
      <div className="bk-stack bk-narrow">
        <h1 className="bk-title">Page not found</h1>
        <p className="bk-lead">
          Go to the <Link to="/">start page</Link>, the <Link to="/overview/">overview</Link> or <Link to="/app/">the app</Link>.
        </p>
      </div>
    </SitePage>
  );
}
