import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import type { ReactNode } from 'react';

// Every page: the title as written (no "| BenchKeeper" suffix), its description, and the main landmark. The home page
// lays out its own full-width sections; the others sit in one container.
export default function SitePage({ title, description, imageAlt, home = false, children }: { title: string; description: string; imageAlt?: string; home?: boolean; children: ReactNode }) {
  return (
    <Layout description={description}>
      <Head>
        <title>{title}</title>
        <meta property="og:title" content={title} />
        {imageAlt && <meta property="og:image:alt" content={imageAlt} />}
      </Head>
      <main id="main" tabIndex={-1}>
        {home ? children : <div className="container bk-page">{children}</div>}
      </main>
    </Layout>
  );
}
