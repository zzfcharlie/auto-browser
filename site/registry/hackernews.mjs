// Site Adapter: HackerNews - Top stories

export const description = 'Get top stories from HackerNews';
export const params = ['count'];
export const examples = [
  { params: {}, desc: 'Top 10 stories' },
  { params: { count: '20' }, desc: 'Top 20 stories' },
];

export default async function execute(page, { count = '10' }) {
  return page.evaluate(async ({ count }) => {
    // Get top story IDs
    const idsResp = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = await idsResp.json();
    const topIds = ids.slice(0, parseInt(count) || 10);

    const stories = await Promise.all(
      topIds.map(async (id) => {
        const resp = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        const item = await resp.json();
        return {
          title: item.title,
          url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
          points: item.score,
          author: item.by,
          comments: item.descendants || 0,
        };
      })
    );
    return stories;
  }, { count });
}
