import Link from '@docusaurus/Link';
import SitePage from './SitePage';

const RESEARCH = 'https://github.com/ESchuderer/BenchKeeper-research';
const FILE = `${RESEARCH}/blob/main`;
// What a column of a recorded result means and how to compare it, from research bench/results/2026-10-18-mistreevous.md and the research README.
const READING: [string, string, string][] = [
  ['Score', 'Brownfield score from 0 to 100: hidden checks 35, test suite green 10, static checks 15, process checks 15, model review 25.', 'Medians of 3 rounds per arm; descriptive only, no significance tests.'],
  ['Score vs A', 'Difference of the median to plain Claude Code (arm A).', 'One arm varies by up to about 8 points between rounds, so with 3 rounds a median difference below about 3 points is not measurable.'],
  ['Minutes', 'The agent\'s time summed over the steps.', 'At equal quality, the cheaper and faster setup is the better choice.'],
  ['Cost, USD', 'The API-equivalent figure the agent reports. The trials ran on a subscription, where it counts against the usage window.', 'A higher cost needs a median at least 3 points higher and a lead in at least 2 of 3 rounds.'],
  ['Review', 'A blinded code review: Claude Opus 5.5 rates 8 criteria from 1 to 5, twice per trial.', 'A model rating is noisy and a Claude reviewer may favor Claude-written code: keep the review model fixed and read the bug list before the number.'],
];

// Statements come only from files in BenchKeeper-research; each names its source in a comment.
export default function BenchmarkPage() {
  return (
    <SitePage title="Benchmark, BenchKeeper" description="What the BenchKeeper benchmark measures, how a result is produced, how to read one, and where the recorded results and the method live.">
      <div className="bk-stack bk-wide">
        <h1 className="bk-title">How the benchmark works</h1>
        {/* research README.md */}
        <p>The benchmark measures what an agent setup does to the code an agent writes. The tooling, the reports and the recorded results live in <Link href={RESEARCH}>BenchKeeper-research</Link>.</p>

        <h2 className="bk-h2-sm">How a result is produced</h2>
        {/* research bench/SCENARIOS.md, bench/results/2026-10-18-mistreevous.md "Method" */}
        <p>Each setup (an arm) gets the same brief, hidden tests, scorer, app review, timeout and follow-up rule, and each trial runs in its own container with only its arm's components. In a brownfield brief, each step runs in a new session on the repository state the previous step left, and a step's checks run after it ends. Minutes, cost and skills are reported, not scored.</p>

        <h2 className="bk-h2-sm">How to read a result</h2>
        <table className="bk-table">
          <thead>
            <tr><th scope="col" style={{ width: '20%' }}>Column</th><th scope="col">What it is</th><th scope="col">How to compare it</th></tr>
          </thead>
          <tbody>
            {READING.map(([col, what, how]) => <tr key={col}><th scope="row">{col}</th><td>{what}</td><td>{how}</td></tr>)}
          </tbody>
        </table>

        <h2 className="bk-h2-sm">Where the results and the method live</h2>
        {/* research README.md "Recorded results", research bench/ORIGIN.md and bench/PROTOCOL.md */}
        <p>The reports of the mistreevous brief, <Link href={`${FILE}/bench/results/2026-10-18-mistreevous.md`}>on Sonnet 5.5</Link> and <Link href={`${FILE}/bench/results/2026-10-19-mistreevous-opusplan.md`}>on opusplan</Link>, with the per-trial files they rest on next to them. The raw trial data was removed, so these tables cannot be recomputed.</p>
        <p>The compared arms are in <Link href={`${FILE}/bench/SCENARIOS.md`}><code>bench/SCENARIOS.md</code></Link>, the source of every file in <Link href={`${FILE}/bench/ORIGIN.md`}><code>bench/ORIGIN.md</code></Link>, and the protocol in <Link href={`${FILE}/bench/PROTOCOL.md`}><code>bench/PROTOCOL.md</code></Link>. New runs go into the research repository.</p>
      </div>
    </SitePage>
  );
}
