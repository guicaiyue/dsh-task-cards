// happy-dom 已经提供 window/document/fetch；这里只补面板用到的浏览器缺口。
// 每个用例自己 stub fetch，不在全局造数据——否则测试之间会互相污染。

// shell 里可能是 NODE_ENV=production；React 生产包会禁用 act()。
process.env.NODE_ENV = 'test'

import { afterEach } from 'vitest'

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})
