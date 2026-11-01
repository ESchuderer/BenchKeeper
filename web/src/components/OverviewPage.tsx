import Link from '@docusaurus/Link';
import type { ReactNode } from 'react';
import facts from '../data/facts.json';
import { Ring, SDLC_INTRO, StepList, half, md, useAnchor } from './Page';
import SitePage from './SitePage';

const REPO = 'https://github.com/ESchuderer/BenchKeeper';
const { overview } = facts;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={useAnchor(id)} aria-labelledby={`${id}-h`} className="bk-stack">
      <h2 id={`${id}-h`} className="bk-h2-sm">{title}</h2>
      {intro && <p className="bk-narrow">{intro}</p>}
      {children}
    </section>
  );
}

function Source({ path }: { path: string }) {
  return <p className="bk-small">Source: <Link href={`${REPO}/blob/main/${path}`}>{path}</Link></p>;
}

function Card({ id, children }: { id: string; children: ReactNode }) {
  return <div id={useAnchor(id)} className="bk-card">{children}</div>;
}

export default function OverviewPage() {
  return (
    <SitePage title={`${overview.title}, BenchKeeper`} description={overview.audience}>
      <div className="bk-stack bk-gap-56">
        <div className="bk-stack bk-narrow">
          <h1 className="bk-title">{overview.title}</h1>
          <p className="bk-lead">{md(facts.description)}</p>
          <p>{overview.audience} <Link to="/#start">Quick start</Link>, <Link to="/app/">the app with screenshots</Link>, <Link href={`${REPO}/blob/main/docs/skills.md`}>what each skill does</Link>.</p>
        </div>
        <Section id="sdlc" title="The workflow" intro={SDLC_INTRO}>
          <Ring tip={false} />
          <div className="bk-grid cols-sm-2">
            <StepList from={0} className="steps-first" />
            <StepList from={half} />
          </div>
        </Section>
        <Section id="brings" title="What it brings">
          <div className="bk-grid cols-md-2">
            {overview.parts.map((p) => (
              <Card key={p.id} id={p.id}>
                <h3 className="bk-h3">{p.title}</h3>
                <p className="bk-small">{md(p.text)}</p>
                <Source path={p.evidence} />
              </Card>
            ))}
          </div>
        </Section>
        <Section id="defaults" title="Opinionated defaults">
          <div className="bk-grid cols-md-2">
            {overview.defaults.map((d) => (
              <div key={d.title} className="bk-card">
                <h3 className="bk-h3">{d.title}</h3>
                <p className="bk-small">{md(d.text)}</p>
                <p className="bk-small"><span className="bk-strong">Why:</span> {d.reason}</p>
                <Source path={d.evidence} />
              </div>
            ))}
          </div>
        </Section>
      </div>
    </SitePage>
  );
}
