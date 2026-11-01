import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import useIsBrowser from '@docusaurus/useIsBrowser';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { sdlcSvg } from '../lib/sdlc';
import facts from '../data/facts.json';
import { Icon, type IconName } from './icons';
import SitePage from './SitePage';

const REPO = 'https://github.com/ESchuderer/BenchKeeper';
const SETUP = `${REPO}/blob/main/docs/setup.md`;
// Homepage features beyond the overview cards: title, link (relative to the site base unless absolute or `#`), one line.
const MORE_FEATURES: [string, string, string][] = [
  ['Local by default', '/overview/#defaults', 'Keep the app and each project setup on your machine: the app opens on 127.0.0.1 behind a one-time link and sends no telemetry, and a project setup stays out of the repository until you share it.'],
  ['Plan, diff and undo', '/app/#history', 'See every change as a diff or command before it runs, then undo a whole run or a single step.'],
  ['Dashboard', '/app/#dashboard', 'See which items of the global setup and of each project need attention, and fix them in one plan.'],
  ['Catalog', '/app/#skills', 'Browse the library skills and the packs on two pages, and build your own packs from the skills.'],
  ['Agent settings', '/app/#settings', 'Compare each agent setting with the value in effect and the suggested value with its reason, and change it through a plan.'],
  ['Rules', '/app/#rules', 'See which instruction files each agent loads, in load order, with their owner and the tokens they add to every session.'],
  ['Doctor', '/app/#doctor', 'Find rules that differ from the setup, missing plugins and skills and environment variables that turn features off, each with a planned fix or the step to do by hand.'],
  ['Lite install', '#levels', 'Install only the BenchKeeper plugin with `--level lite`: nothing else is written besides the app\'s run record for undo.'],
  ['Benchmark evidence', '/benchmark/', 'Read the recorded benchmark results and the tooling that compares agent setups on the same task.'],
];
const PART_ICONS: Record<string, IconName> = { rules: 'FileText', workflow: 'ListCheck', mattpocock: 'School', ponytail: 'Feather', app: 'Route', devcontainer: 'Container' };
// Backticks in facts.json become inline code and `[label](url)` a link, the same text the README renders.
export const md = (t: string) => t.split(/(`[^`]*`|\[[^[\]]+\]\((?:[^()\s]|\([^()\s]*\))+\))/).map((part, i) => {
  if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
  const link = /^\[([^[\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)$/.exec(part);
  return link ? <Link key={i} href={link[2]}>{link[1]}</Link> : part;
});
// An element id that a link may target: Docusaurus checks every link's anchor against the ids collected here.
export function useAnchor(id: string) {
  useBrokenLinks().collectAnchor(id);
  return id;
}
// A link relative to the site base (`/app/#history`), or `#id` and absolute links as they are.
export const siteLink = (href: string) => (href.startsWith('/') ? { to: href } : { href });

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={useAnchor(id)} className="band bk-section">
      <div className="container">
        <div className="bk-stack bk-narrow bk-section-head">
          <h2 className="bk-h2">{title}</h2>
          {intro && <p className="bk-dimmed bk-lead">{intro}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function Part({ icon, title, href, scope, children }: { icon: IconName; title: ReactNode; href?: string; scope: string; children: ReactNode }) {
  return (
    <div className="bk-card">
      <div className="bk-row">
        <span className="bk-icon-box"><Icon name={icon} /></span>
        {href ? <Link href={href} className="bk-strong">{title}</Link> : <span className="bk-strong">{title}</span>}
      </div>
      <p className="bk-scope">{scope}</p>
      <p className="bk-small">{children}</p>
    </div>
  );
}

export const half = Math.ceil(facts.sdlc.steps.length / 2);

export const SDLC_INTRO = 'The workflow skill sorts each task into a software change, a docs pass or research, and gives a software change a tier: how much process it gets. Quick: build, verify, ship. Full: spec, tickets, tests first, review. Several tasks on one branch run their long checks and reviews once at the end. A skill that matches the task loads in any tier, and each change type adds its own check.';

function Step({ n, children }: { n: number; children: ReactNode }) {
  return <li id={useAnchor(`step-${n}`)} className="bk-tl-item">{children}</li>;
}

export function StepList({ from, className = '' }: { from: number; className?: string }) {
  return (
    <ol className={`bk-timeline ${className}`} start={from + 1}>
      {facts.sdlc.steps.slice(from, from + half).map((st, i) => (
        <Step key={st.name} n={from + i + 1}>
          <span className={`bk-tl-bullet phase-${st.phase}`} aria-hidden="true">{from + i + 1}</span>
          <div className="bk-tl-title">
            <span className="bk-strong">{st.name}</span>
            {st.human && <span className="bk-badge decide">human in the loop</span>}
          </div>
          <p className="bk-small bk-dimmed">{md(from + i === 0 ? `${st.text} ${facts.sdlc.requirements}` : st.text)}</p>
        </Step>
      ))}
    </ol>
  );
}

// The SDLC ring with its tooltip: it follows the cursor on hover devices; a tap or click on a step jumps to its description.
export function Ring({ tip = true }: { tip?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = wrap.current, t = w?.querySelector<HTMLElement>('.ring-tip');
    if (!w || !t) return undefined;
    const place = (x: number, y: number) => {
      const r = w.getBoundingClientRect(), tw = t.offsetWidth, th = t.offsetHeight;
      let top = y - r.top + 16;
      if (top + th > r.height) top = y - r.top - th - 12;
      t.style.left = `${Math.max(4, Math.min(x - r.left + 16, r.width - tw - 4))}px`;
      t.style.top = `${Math.max(4, top)}px`;
    };
    const off: (() => void)[] = [];
    const on = (el: Element, ev: string, f: (e: Event) => void) => { el.addEventListener(ev, f); off.push(() => el.removeEventListener(ev, f)); };
    for (const el of w.querySelectorAll('[data-tip]')) {
      const show = (x: number, y: number) => { t.textContent = el.getAttribute('data-tip'); t.hidden = false; place(x, y); };
      if (matchMedia('(hover: hover)').matches) {
        on(el, 'mousemove', (e) => show((e as MouseEvent).clientX, (e as MouseEvent).clientY));
        on(el, 'mouseleave', () => { t.hidden = true; });
      }
      on(el, 'focus', () => { const b = el.getBoundingClientRect(); show(b.right, b.top); });
      on(el, 'blur', () => { t.hidden = true; });
      on(el, 'click', () => { t.hidden = true; });
    }
    return () => off.forEach((f) => f());
  }, []);
  return (
    <div className="ring-wrap" ref={wrap}>
      <div dangerouslySetInnerHTML={{ __html: sdlcSvg }} />
      {tip && <div className="ring-tip" role="tooltip" hidden></div>}
    </div>
  );
}

const repoSteps: [string, string, string][] = [
  ['Project setup, in each repository root', 'npx benchkeeper@6.25.0 projects apply --agents claude,codex', '--agents names the agents the repository uses. Where commands run and the default tier, library packs with --pack, and .benchkeeper/state.json. It stays on this machine: CLAUDE.local.md, AGENTS.override.md and the skills, all in .git/info/exclude. --share commits it to the repository instead. projects plan shows the changes first.'],
  ['Stack skills and the dev container, as a recorded session', "npx benchkeeper@6.25.0 sessions record -- claude '/benchkeeper:setting-up-projects'", "Codex: the same with codex '$benchkeeper:setting-up-projects'. With the matt-pocock pack, also /mattpocock-skills:setup-matt-pocock-skills. Commit the result."],
  ['Update later', 'npx benchkeeper@6.25.0 apply', 'With the version of the newest release. The plan lists what changed, including the plugin. Projects: npx benchkeeper@6.25.0 projects update, or Fix everything in the browser, updates each local setup in place; a shared one, or a setup still committed from before, gets a commit on a local branch for you to push.'],
  ['Track sessions', 'npx benchkeeper@6.25.0 sessions board', 'Writes a static page, board.html in the BenchKeeper config folder, from the Claude Code and Codex transcripts on this machine: per session the tier, the setup installed at the time, skills used, the last test run, cost (Claude Code as recorded, Codex estimated from tokens and OpenAI API prices, unpriced models left out), time and pull request links. The Sessions view in the browser app shows the same board.'],
];

const host = ['Rules and the plugins: BenchKeeper, optionally Ponytail and Matt Pocock\'s skills', 'Git and gh: branches, commits, pull requests', 'Dev Containers CLI and Docker or Podman', 'The agent, with --env host-agent'];
const container = ['The agent (default), started with devcontainer exec', 'Project toolchain at pinned versions', 'Installs, builds, lint, tests', 'Playwright browser', 'Non-root user, project mount only'];

function CmdRow({ id, cmd, note, copy }: { id: string; cmd: string; note: ReactNode; copy: ReturnType<typeof useCopy> }) {
  return (
    <div className="bk-stack bk-gap-6">
      <div className="bk-row bk-nowrap">
        <pre className="bk-code cmd">{cmd}</pre>
        <button type="button" className={`bk-icon-btn${copy.copied === id ? ' copied' : ''}`} onClick={() => copy.copy(id, cmd)} aria-label={`Copy command: ${cmd}`}>
          <Icon name="Copy" size={16} className="i-copy" /><Icon name="Check" size={16} className="i-done" />
        </button>
      </div>
      <p className="bk-small bk-dimmed">{note}</p>
    </div>
  );
}

// Copy buttons share one live status line; the check mark (on the pressed button only) and the status clear after 1.5 s.
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const done = (msg: string, id: string | null) => {
    clearTimeout(timer.current);
    setCopied(id); setStatus(msg);
    timer.current = setTimeout(() => { setCopied(null); setStatus(''); }, 1500);
  };
  // Clipboard needs a secure context (https or localhost).
  const copy = (id: string, cmd: string) => {
    if (!navigator.clipboard) return done('Copy is not available. Select the command instead.', null);
    navigator.clipboard.writeText(cmd).then(() => done('Copied', id), () => done('Copy failed. Select the command instead.', null));
  };
  return { copied, status, copy };
}

// Quick start tabs (WAI-ARIA tabs pattern). Without JavaScript both panels show under their own headings. With it, the
// head script's `js` class shows the tab bar and the first panel from the first paint (custom.css), and hydration wires them.
function QuickStart({ copy }: { copy: ReturnType<typeof useCopy> }) {
  // False while the server renders and during hydration, true afterwards and on client-side navigation.
  const js = useIsBrowser();
  const [sel, setSel] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const paths = facts.quickstart.paths;
  const pick = (i: number, focus = false) => { setSel(i); if (focus) tabs.current[i]?.focus(); };
  return (
    <div className={`qs${js ? ' qs-js' : ''}`}>
      <div role="tablist" aria-label="Install path" className="qs-tabs" hidden={!js}>
          {paths.map((p, i) => (
            <button key={p.name} ref={(b) => { tabs.current[i] = b; }} type="button" role="tab" id={`qs-tab-${i}`} aria-controls={`qs-panel-${i}`}
              aria-selected={i === sel} tabIndex={i === sel ? 0 : -1} onClick={() => pick(i)}
              onKeyDown={(e) => {
                const n = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: paths.length - 1 } as Record<string, number>)[e.key];
                if (n === undefined) return;
                e.preventDefault(); pick((n + paths.length) % paths.length, true);
              }}>{p.name}</button>
          ))}
      </div>
      {paths.map((p, i) => (
        <div key={p.name} id={`qs-panel-${i}`} className="qs-panel" hidden={js && i !== sel}
          {...(js ? { role: 'tabpanel', 'aria-labelledby': `qs-tab-${i}` } : {})}>
          <h3 className="bk-h3 qs-h">{p.name}</h3>
          <div className="bk-stack">
            {p.steps.map((st, k) => <CmdRow key={st.command} id={`qs-${i}-${k}`} cmd={st.command} note={md(st.text)} copy={copy} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Side({ label, decide = false, items }: { label: string; decide?: boolean; items: string[] }) {
  return (
    <div className={`bk-card bk-side${decide ? ' decide' : ''}`}>
      <span className={`bk-badge${decide ? ' decide' : ''}`}>{label}</span>
      <ul className="bk-list bk-small">{items.map((t) => <li key={t}>{t}</li>)}</ul>
    </div>
  );
}

function Feature({ title, href, text }: { title: string; href: string; text: string }) {
  return (
    <div className="bk-stack bk-gap-4">
      <Link {...siteLink(href)} className="bk-strong">{title}</Link>
      <p className="bk-small bk-dimmed">{md(text)}</p>
    </div>
  );
}

export default function Page() {
  const { tagline: description } = facts;
  const copy = useCopy();
  return (
    <SitePage home title="BenchKeeper: rules, workflow and setup for Claude Code and Codex" description={description} imageAlt={`BenchKeeper logo. ${description}`}>
      <div className="hero bk-hero">
        <div className="container">
          <div className="bk-grid cols-md-2 bk-center">
            <div className="bk-stack bk-gap-lg">
              <span className="bk-badge bk-badge-light">Setup for Claude Code and Codex</span>
              <h1 className="bk-display"><span className="grad">BenchKeeper</span></h1>
              <p className="bk-xl">
                Short rules and a workflow skill that sizes each change for Claude Code and Codex, installed by an app that shows each change first and can undo the run.
                Each repository adds its dev container, AGENTS.md and stack skills.
              </p>
              <div className="bk-row bk-wrap">
                <Link className="button button--primary button--lg" href="#start">Set up your machine</Link>
                <Link className="button button--secondary button--lg" href="#sdlc">See the workflow</Link>
                <Link className="button button--secondary button--lg" to="/overview/">What it brings</Link>
              </div>
            </div>
            <div className="bk-hero-logo">
              <img src={useBaseUrl('/logo.svg')} alt="BenchKeeper logo: a brain inside a gear, circled by a loop of arrows" className="logo" width={300} height={300} />
            </div>
          </div>
        </div>
      </div>

      <Section id="sdlc" title="One loop, sized to the change" intro={SDLC_INTRO}>
        <Ring />
        <div className="bk-grid cols-sm-2 bk-mt-40">
          <StepList from={0} className="steps-first" />
          <StepList from={half} />
        </div>
      </Section>

      <Section id="parts" title="What gets installed">
        <div className="bk-grid cols-sm-2 cols-md-3">
          {facts.parts.map((p) => <Part key={p.id} icon={PART_ICONS[p.id]} title={md(p.title)} href={p.href} scope={p.scope}>{md(p.text)}</Part>)}
        </div>
      </Section>

      <Section id="features" title="Features">
        <div className="bk-grid cols-sm-2">
          {[...facts.overview.parts.map((p): [string, string, string] => [p.title, `/overview/#${p.id}`, `${p.text.split('. ')[0]}.`]), ...MORE_FEATURES].map(([title, href, text]) => (
            <Feature key={title} title={title} href={href} text={text} />
          ))}
        </div>
      </Section>

      <Section id="levels" title="Three sizes" intro="Start with the plugin and add what you need. Each level contains the one before.">
        <div className="bk-grid cols-md-3">
          {facts.levels.map((l) => (
            <div key={l.name} className="bk-card">
              <h3 className="bk-h3">{l.name}</h3>
              <p className="bk-small">{md(l.contains)}</p>
              <p className="bk-small bk-dimmed">Writes: {md(l.writes)}.</p>
              <pre className="bk-code cmd">{l.command}</pre>
            </div>
          ))}
        </div>
      </Section>

      <Section id="start" title="Quick start" intro={<>{facts.quickstart.needs} <Link href={`${SETUP}#prerequisites`}>Full list of tools.</Link> {facts.quickstart.choose} <Link to="/app/">The app, view by view, with screenshots.</Link></>}>
        <div className="bk-stack bk-gap-lg bk-narrow">
          <QuickStart copy={copy} />
          <p className="bk-small">{facts.quickstart.next} {md(facts.quickstart.changes)}</p>
          <div className="bk-row bk-wrap">
            {facts.quickstart.links.map((l) => (
              <Link key={l.anchor} className="bk-small" {...(l.anchor === 'levels' ? { href: '#levels' } : l.anchor === 'what-the-app-writes-and-what-it-never-does' ? { to: '/writes/' } : { href: `${SETUP}#${l.anchor}` })}>{l.label}</Link>
            ))}
          </div>
          <span className="sr-only" aria-live="polite">{copy.status}</span>
        </div>
      </Section>

      <Section id="repos" title="Each repository, updates and sessions">
        <ol className="bk-stack bk-gap-lg bk-narrow bk-plain">
          {repoSteps.map(([title, cmd, note], k) => (
            <li key={title} className="bk-row bk-nowrap bk-top">
              <span className="bk-num" aria-hidden="true">{k + 1}</span>
              <div className="bk-stack bk-gap-6 bk-grow">
                <span className="bk-strong">{title}</span>
                <CmdRow id={`repo-${k}`} cmd={cmd} note={note} copy={copy} />
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="selected" title="Why this stack">
        <ul className="bk-list bk-narrow">
          {facts.stack.reasons.map((r) => <li key={r.name}><span className="bk-strong">{r.name}:</span> {r.text}</li>)}
        </ul>
      </Section>

      <Section id="where" title="Where things run" intro="By default the agent runs inside the repository's dev container, together with the project commands. With --env host-agent it stays on the host and sends project commands through devcontainer exec.">
        <div className="bk-grid cols-md-3">
          <Side label="Host, one per machine" items={host} />
          <div className="bk-stack bk-center bk-gap-6">
            <span className="bk-num bk-num-lg"><Icon name="ArrowRight" size={22} className="bk-md-only" /><Icon name="ArrowDown" size={22} className="bk-sm-only" /></span>
            <span className="bk-mono bk-small bk-dimmed">devcontainer exec</span>
          </div>
          <Side label="Devcontainer, one per repository" decide items={container} />
        </div>
        <div className="bk-alert bk-mt-xl" role="note">
          <Icon name="AlertTriangle" />
          <div>
            <p className="bk-strong">Isolation</p>
            <p className="bk-small">In the default container environment the agent sees the project mount instead of your home folder, but a container shares the host kernel and is not a security boundary. With --env host-agent, projects apply --sandbox turns on Claude Code's sandbox. For a separate kernel, use a Docker Sandboxes microVM (--env sandbox, untested) or a VM.</p>
          </div>
        </div>
      </Section>
    </SitePage>
  );
}
