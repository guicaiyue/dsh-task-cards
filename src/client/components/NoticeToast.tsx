// 批准之后的一条结果提示：推回原会话了（成功），或只结束了卡（附宿主给的原因）。
// 不静默——无论推没推回去，用户都要看到发生了什么。

import type { ActionNotice, Translate } from '../types'

interface Props {
  t: Translate
  notice: ActionNotice
  onClose: () => void
}

export function NoticeToast({ t, notice, onClose }: Props) {
  return (
    <div className={`dtc-notice${notice.pushed ? ' is-ok' : ' is-warn'}`} role="status">
      <span className="dtc-notice-text">
        {notice.pushed ? t('approvePushed') : notice.reason || t('approveNoSession')}
      </span>
      <button type="button" className="dtc-btn" onClick={onClose}>
        {t('close')}
      </button>
    </div>
  )
}
