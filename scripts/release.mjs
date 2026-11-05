#!/usr/bin/env node
// 发版：changeset 收敛版本 → 打包 → 打 tag → 提示推送。
//
// 只出 GitHub Release，不发 npm（本包作为插件被 link:/git 安装）。

import { execFileSync } from 'node:child_process'

function run(command, args) {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit' })
}

run('pnpm', ['changeset', 'version'])
run('pnpm', ['build'])
const version = execFileSync('node', ['-p', 'require("./package.json").version'], {
  encoding: 'utf8',
}).trim()
run('git', ['add', '-A'])
run('git', ['commit', '-m', `chore(release): v${version}`])
run('git', ['tag', '-a', `v${version}`, '-m', `v${version}`])
console.log(`\n已打 tag v${version}；推送：git push origin main --follow-tags`)
