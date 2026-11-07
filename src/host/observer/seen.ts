// 「用户已经回到原会话」的轻量记录：只存每个会话最后一条用户消息的时间。
//
// 观察者是异步跑的（另起一个模型会话，几秒到几十秒）。如果卡片落盘之前，
// 用户已经在原会话里发了下一句，那这一轮的回复他必然看过——卡片只该留档，
// 不该再亮未读圆点。这是「已看过」唯一可靠又便宜的信号，不猜、不读屏。

const MAX_SESSIONS = 500

export class SeenTracker {
  #lastUserAt = new Map<string, number>()

  /** 收到一条用户消息：记下时间（超过上限就丢最早的，长跑宿主不能无限长）。 */
  markUser(sessionId: string, at: number = Date.now()): void {
    this.#lastUserAt.set(sessionId, at)
    if (this.#lastUserAt.size > MAX_SESSIONS) {
      const oldest = this.#lastUserAt.keys().next().value
      if (oldest !== undefined) this.#lastUserAt.delete(oldest)
    }
  }

  /** 回合结束时的游标：此刻之前不可能是「已看过」。 */
  mark(sessionId: string): number {
    return this.#lastUserAt.get(sessionId) ?? 0
  }

  /** 建卡时判断：游标之后用户又说过话。 */
  seenSince(sessionId: string, mark: number): boolean {
    return this.mark(sessionId) > mark
  }
}
