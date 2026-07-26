// Site Adapter: GitHub - Repository info
// Uses GitHub's public API via page fetch (with your auth cookies)

export const description = 'Get GitHub repository information';
export const params = ['owner', 'repo'];
export const examples = [
  { params: { owner: 'zzfcharlie', repo: 'auto-browser' }, desc: 'Get auto-browser repo info' },
];

export default async function execute(page, { owner, repo }) {
  return page.evaluate(async ({ owner, repo }) => {
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      credentials: 'include',
    });
    const data = await resp.json();
    return {
      name: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      forks: data.forks_count,
      language: data.language,
      topics: data.topics,
      updatedAt: data.updated_at,
      license: data.license?.spdx_id,
      url: data.html_url,
    };
  }, { owner, repo });
}
