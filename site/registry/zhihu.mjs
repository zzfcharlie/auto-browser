// Site Adapter: Zhihu - Hot list

export const description = 'Get Zhihu hot list';
export const params = [];
export const examples = [{ params: {}, desc: 'Today\'s hot topics' }];

export default async function execute(page) {
  return page.evaluate(async () => {
    const resp = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=20', {
      headers: { 'Accept': 'application/json' },
      credentials: 'include',
    });
    const data = await resp.json();
    return (data.data || []).map(item => ({
      title: item.target.title,
      // Use title_area if available
      excerpt: item.target.excerpt || item.target.title_area?.text || '',
      hot: item.detail_text || '',
      url: `https://www.zhihu.com/question/${item.target.id}`,
      answerCount: item.target.answer_count,
      followerCount: item.target.follower_count,
    }));
  });
}
