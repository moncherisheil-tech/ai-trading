export interface DeveloperCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
  url: string;
}

export interface DeveloperRelease {
  tagName: string;
  publishedAt: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  url: string;
}

export interface DeveloperActivityResult {
  repoPath: string;
  generatedAt: string;
  commitsLast30Days: number;
  latestCommits: DeveloperCommit[];
  latestReleases: DeveloperRelease[];
  severity: 'healthy' | 'warning' | 'severe';
  warning: string | null;
}

const DEFAULT_TIMEOUT_MS = 12_000;

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'MonCheri-Quantum-Developer-Tracker',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} for ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDeveloperActivity(repoPath: string): Promise<DeveloperActivityResult> {
  const normalizedRepo = (repoPath || '').trim().replace(/^\/+|\/+$/g, '');
  if (!/^[^/]+\/[^/]+$/.test(normalizedRepo)) {
    throw new Error(`Invalid GitHub repo path: "${repoPath}". Expected format "owner/repo".`);
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const commitsUrl = `https://api.github.com/repos/${normalizedRepo}/commits?since=${encodeURIComponent(since)}&per_page=10`;
  const releasesUrl = `https://api.github.com/repos/${normalizedRepo}/releases?per_page=5`;

  const [commitsRaw, releasesRaw] = await Promise.all([
    fetchJson<
      Array<{
        sha?: string;
        html_url?: string;
        commit?: {
          message?: string;
          author?: { name?: string; date?: string };
        };
      }>
    >(commitsUrl).catch(() => []),
    fetchJson<
      Array<{
        tag_name?: string;
        name?: string;
        draft?: boolean;
        prerelease?: boolean;
        html_url?: string;
        published_at?: string;
      }>
    >(releasesUrl).catch(() => []),
  ]);

  const latestCommits: DeveloperCommit[] = commitsRaw.map((item) => ({
    sha: item.sha ?? '',
    author: item.commit?.author?.name ?? 'unknown',
    date: item.commit?.author?.date ?? new Date(0).toISOString(),
    message: item.commit?.message ?? 'No message',
    url: item.html_url ?? '',
  }));

  const latestReleases: DeveloperRelease[] = releasesRaw.map((item) => ({
    tagName: item.tag_name ?? 'untagged',
    publishedAt: item.published_at ?? '',
    name: item.name ?? '',
    draft: Boolean(item.draft),
    prerelease: Boolean(item.prerelease),
    url: item.html_url ?? '',
  }));

  const commitsLast30Days = latestCommits.length;
  const severe = commitsLast30Days === 0;

  return {
    repoPath: normalizedRepo,
    generatedAt: new Date().toISOString(),
    commitsLast30Days,
    latestCommits,
    latestReleases,
    severity: severe ? 'severe' : commitsLast30Days < 3 ? 'warning' : 'healthy',
    warning: severe ? 'Red Flag: Abandoned Project' : null,
  };
}
