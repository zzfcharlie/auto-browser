export async function detectFramework(page) {
  return page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const signals = {
      'element-plus': [
        () => document.querySelectorAll('.el-form-item, .el-input, .el-select, .el-button').length > 3,
        () => html.includes('element-plus'),
        () => !!document.querySelector('[class*="el-"]')
      ],
      'ant-design': [
        () => document.querySelectorAll('.ant-form-item, .ant-input, .ant-select, .ant-btn').length > 3,
        () => html.includes('ant-design') || html.includes('antd'),
        () => !!document.querySelector('[class*="ant-"]')
      ],
      'mui': [
        () => document.querySelectorAll('[class*="Mui"]').length > 3,
        () => html.includes('mui') || html.includes('material-ui'),
        () => !!document.querySelector('[class*="MuiButton"]')
      ]
    };
    const results = {};
    for (const [fw, checks] of Object.entries(signals)) {
      results[fw] = checks.filter(c => { try { return c(); } catch { return false; } }).length;
    }
    const best = Object.entries(results).sort((a, b) => b[1] - a[1])[0];
    return { detected: best[1] > 0 ? best[0] : 'unknown', confidence: best[1], results };
  });
}
