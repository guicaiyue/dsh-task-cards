#!/usr/bin/env node
// 发版：changeset 收敛版本 → 构建 → 打包 tgz → 打 tag → 推 → 建 GitHub Release 并附上 tgz。
//
// 只出 GitHub Release，不发 npm。安装方（生产 dsh）拿 Release 里的 tgz 装，
// 不再 link 源码仓库：
//   dsh plugin --profile web add file:/path/to/dsh-task-cards-<version>.tgz
//
// 参数：
//   --no-push   只本地提交 + 打 tag + 出 tgz，不推远端、不建 Release
//   --dry-run   只打印将执行的命令

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const argv = new Set(process.argv.slice(2))
const NO_PUSH = argv.has('--no-push')
const DRY = argv.has('--dry-run')

function run(command, args, opts = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  if (DRY) return ''
  return execFileSync(command, args, { encoding: 'utf8', ...opts })
}

function runInherit(command, args) {
  console.log(`$ ${command} ${args.join(' ')}`)
  if (DRY) return
  execFileSync(command, args, { stdio: 'inherit' })
}

// ① 版本收敛
runInherit('pnpm', ['changeset', 'version'])

// ② 构建（lib/ 是 gitignore 的产物，必须现编）
runInherit('pnpm', ['build'])

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const version = pkg.version
const tag = `v${version}`
const tgz = `${pkg.name}-${version}.tgz`

// ③ 打包：产出的 tgz 就是安装源，必须能被 dsh 解析（lib/ + cordis.patch.yml 都在 files 里）
runInherit('pnpm', ['pack', '--pack-destination', '.'])

if (!DRY && !existsSync(tgz)) {
  console.error(`\n打包失败：没有产出 ${tgz}`)
  process.exit(1)
}

// ④ 提交 + 打 tag
run('git', ['add', '-A'])
run('git', ['commit', '-m', `chore(release): ${tag}`])
run('git', ['tag', '-a', tag, '-m', tag])

if (NO_PUSH) {
  console.log(`\n已本地提交并打 tag ${tag}，产物 ${tgz}。未推送（--no-push）。`)
  process.exit(0)
}

// ⑤ 推 main + tag（Release 建在远端 tag 上）
runInherit('git', ['push', 'origin', 'HEAD', '--follow-tags'])

// ⑥ 建 GitHub Release 并上传 tgz
//    说明文字优先用人工写好的 .changeset/release-notes.md，没有就让 gh 从提交历史生成。
const notesFile = '.changeset/release-notes.md'
const notesArgs = existsSync(notesFile) ? ['--notes-file', notesFile] : ['--generate-notes']

runInherit('gh', ['release', 'create', tag, tgz, '--title', tag, '--verify-tag', ...notesArgs])

console.log(`\n已发布 ${tag}，安装：`)
console.log(`  dsh plugin --profile web add file:<下载路径>/${tgz}`)

// 清理本地 tgz（Release 已经有副本，仓库里不留大文件）
if (!DRY) rmSync(join(process.cwd(), tgz), { force: true })
