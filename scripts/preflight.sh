#!/usr/bin/env bash
# 插件仓自检：改完代码跑这一条，等于「verify + 度量快照」。
#
#   ./scripts/preflight.sh              # 在 docker/dev 容器里跑
#   ./scripts/preflight.sh --no-shot    # 只 verify，不拍快照
set -uo pipefail
cd "$(dirname "$0")/.."

FAILED=0
echo "———— ① pnpm verify ————"
if pnpm verify >/tmp/dtc-verify.log 2>&1; then
  grep -E 'Tests +[0-9]+|代码预算|ABI 检查|检查通过' /tmp/dtc-verify.log | tail -8
else
  echo "失败，日志末尾："
  tail -20 /tmp/dtc-verify.log
  FAILED=1
fi

if [ "${1:-}" != "--no-shot" ]; then
  echo
  echo "———— ② 度量快照 ————"
  node scripts/snapshot-metrics.mjs 2>&1 | tail -3 || FAILED=1
fi

echo
[ "$FAILED" = "0" ] && echo "结论：可以提交" || echo "结论：先修"
exit "$FAILED"
