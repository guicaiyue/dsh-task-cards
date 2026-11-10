// 内核开关：默认关闭，`DTC_KERNEL=on` 才让新调度接管派发。
//
// 回滚只需把环境变量去掉；旧路径（scanner + 直接投递）保持原样。

export function kernelEnabled(): boolean {
  return process.env.DTC_KERNEL === 'on'
}

/** 验收开关：DTC_VERIFY=on 时，派发成功后自动跑验收（默认关闭）。 */
export function verifyEnabled(): boolean {
  return process.env.DTC_VERIFY === 'on'
}
