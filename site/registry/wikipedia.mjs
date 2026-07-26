// Site Adapter: Wikipedia - Get summary

export const description = 'Get Wikipedia article summary';
export const params = ['title'];
export const examples = [
  { params: { title: 'Python' }, desc: 'Python summary' },
  { params: { title: 'Artificial intelligence' }, desc: 'AI summary' },
];

export default async function execute(page, { title }) {
  const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

  return page.evaluate(async ({ url }) => {
    const resp = await fetch(url);
    const data = await resp.json();
    return {
      title: data.title,
      extract: data.extract,
      url: data.content_urls?.desktop?.page,
      thumbnail: data.thumbnail?.source,
    };
  }, { url: apiUrl });
}
