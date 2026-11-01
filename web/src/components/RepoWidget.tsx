import Link from '@docusaurus/Link';
import data from '../pages/_generated/data.json';
import { Icon } from './icons';

const SLUG = 'ESchuderer/BenchKeeper';
type Facts = { tag?: string; stars?: string; forks?: string };

// The repository in the header: icon and name, then latest release, stars and forks when the build could read them.
export default function RepoWidget() {
  const { tag, stars, forks } = data.repo as Facts;
  return (
    <Link href={`https://github.com/${SLUG}`} className="repo">
      <Icon name="BrandGithub" size={28} className="repo-icon" />
      <span className="repo-text">
        <span className="repo-name">{SLUG}</span>
        {(tag || stars || forks) && (
          <span className="repo-facts">
            {tag && <span><Icon name="Tag" size={12} /><span className="sr-only">latest release </span>{tag}</span>}
            {stars && <span><Icon name="Star" size={12} />{stars}<span className="sr-only"> stars</span></span>}
            {forks && <span><Icon name="GitFork" size={12} />{forks}<span className="sr-only"> forks</span></span>}
          </span>
        )}
      </span>
    </Link>
  );
}
