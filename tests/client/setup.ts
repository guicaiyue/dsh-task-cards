// happy-dom 已经提供 window/document/fetch；这里只补面板用到的浏览器缺口。
// 每个用例自己 stub fetch，不在全局造数据——否则测试之间会互相污染。

// shell 里可能是 NODE_ENV=production；React 生产包会禁用 act()。
process.env.NODE_ENV = 'test'

import { afterEach } from 'vitest'

interface Entry {
  isIntersecting: boolean
  target: Element
}

/**
 * happy-dom 没有 IntersectionObserver。测试用它手动控制「卡片进入 / 离开视口」：
 * 用例里拿到最后一个实例，调 `enter()` / `leave()` 即可。
 */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  readonly targets = new Set<Element>()
  #callback: (entries: Entry[]) => void

  constructor(callback: (entries: Entry[]) => void) {
    this.#callback = callback
    MockIntersectionObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.targets.add(target)
  }

  unobserve(target: Element): void {
    this.targets.delete(target)
  }

  disconnect(): void {
    this.targets.clear()
    const index = MockIntersectionObserver.instances.indexOf(this)
    if (index >= 0) MockIntersectionObserver.instances.splice(index, 1)
  }

  takeRecords(): Entry[] {
    return []
  }

  enter(): void {
    this.#callback([...this.targets].map((target) => ({ isIntersecting: true, target })))
  }

  leave(): void {
    this.#callback([...this.targets].map((target) => ({ isIntersecting: false, target })))
  }
}

Object.assign(globalThis, { IntersectionObserver: MockIntersectionObserver })

/** 用例里取当前还活着、且盯着某个元素的视口观察器。 */
export function intersectionObserverFor(element: Element): MockIntersectionObserver {
  const found = MockIntersectionObserver.instances.find((item) => item.targets.has(element))
  if (!found) throw new Error('没有找到观察这个元素的 IntersectionObserver')
  return found
}

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  MockIntersectionObserver.instances = []
})
