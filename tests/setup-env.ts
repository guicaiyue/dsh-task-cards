// 单元测试的环境隔离：宿主容器可能带着 DTC_KERNEL/DTC_VERIFY=on 跑测试，
// 这里默认清掉，避免「批准入队」把旧路径的用例带偏。
// 需要测内核路径的用例自己设置 DTC_TEST_KERNEL=1 并在模块里打开开关。
if (process.env.DTC_TEST_KERNEL !== '1') {
  delete process.env.DTC_KERNEL
  delete process.env.DTC_VERIFY
}
