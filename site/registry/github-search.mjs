// Site Adapter: GitHub - Search repositories

export const description = 'Search GitHub repositories';
export const params = ['query', 'sort'];
export const examples = [
  { params: { query: 'browser automation' }, desc: 'Search repos' },
  { params: { query: 'puppeteer', sort: 'stars' }, desc: 'Sort by stars' },
];

export default async function execute(page, { query, sort = 'stars', order = 'desc' }) {
  return page.evaluate(async ({ query, sort, order }) => {
    const resp = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}&per_page=10`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      credentials: 'include',
    });
    const data = await resp.json();
    return (data.items || []).map(r => ({
      name: r.full_name,
      description: r.description,
      stars: r.stargazers_count,
      forks: r.forks_count,
      language: r.language,
      url: r.html_url,
    }));
  }, { query, sort, order });
}
