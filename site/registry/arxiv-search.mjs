// Site Adapter: arXiv - Search papers

export const description = 'Search arXiv research papers';
export const params = ['query', 'maxResults'];
export const examples = [
  { params: { query: 'transformer' }, desc: 'Search papers' },
  { params: { query: 'RAG', maxResults: '20' }, desc: 'RAG papers' },
];

export default async function execute(page, { query, maxResults = '5' }) {
  return page.evaluate(async ({ query, maxResults }) => {
    const resp = await fetch(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`);
    const xml = await resp.text();

    // Simple XML parse using DOMParser
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const entries = doc.querySelectorAll('entry');

    return Array.from(entries).map(entry => ({
      title: entry.querySelector('title')?.textContent?.trim(),
      authors: Array.from(entry.querySelectorAll('author name')).map(a => a.textContent),
      summary: entry.querySelector('summary')?.textContent?.trim().slice(0, 300),
      published: entry.querySelector('published')?.textContent,
      link: entry.querySelector('id')?.textContent,
      pdf: Array.from(entry.querySelectorAll('link'))
        .find(l => l.getAttribute('title') === 'pdf')
        ?.getAttribute('href'),
    }));
  }, { query, maxResults });
}
