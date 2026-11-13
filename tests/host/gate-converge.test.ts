// task-11：闸门误判收敛（.env 模板 / /dev/tcp 探针 / story-shot-* 辅助容器）对称测试。

import { describe, expect, it } from 'vitest'

import { classifyTurnCall } from '../../src/host/gate/classify'

const CWD = '/workspace/proj'

function classify(command: string) {
  return classifyTurnCall({ tool: 'bash', args: { command }, cwd: CWD }, { cwd: CWD })
}

function write(path: string, content = '') {
  return classifyTurnCall({ tool: 'write', args: { path, content }, cwd: CWD }, { cwd: CWD })
}

describe('.env 模板放行、真实 .env 仍拦', () => {
  it('放行：.env.example / .env.prod.sample / config.env.template', () => {
    for (const path of [
      '.env.example',
      '.env.prod.sample',
      'config.env.template',
      '.env.template',
    ]) {
      const out = write(`${CWD}/${path}`, 'API_URL=http://localhost:3000')
      expect(out.gate, path).toBe(false)
    }
  })

  it('拦截：.env / .env.prod（真实密钥路径）', () => {
    expect(write(`${CWD}/.env`).gate).toBe(true)
    expect(write(`${CWD}/.env.prod`).gate).toBe(true)
  })

  it('模板里填了真密钥内容 → 仍拦（rule:secret-env-content）', () => {
    const out = write(`${CWD}/.env.example`, `API_KEY=sk_live_${'a'.repeat(32)}`)
    expect(out.gate).toBe(true)
    expect(out.reasons.join(' ')).toContain('secret-env-content')
  })

  it('命令写模板放行、写真实 .env 拦截', () => {
    expect(classify(`echo API_URL=x > ${CWD}/.env.example`).gate).toBe(false)
    expect(classify(`echo SECRET=x > ${CWD}/.env`).gate).toBe(true)
  })
})

describe('/dev/tcp 连通性探测不当作写文件', () => {
  it('放行：exec 3<>/dev/tcp 与 cat </dev/tcp', () => {
    expect(classify('exec 3<>/dev/tcp/127.0.0.1/5432 && echo ok').gate).toBe(false)
    expect(classify('cat < /dev/tcp/127.0.0.1/5432').gate).toBe(false)
    const out = classify('bash -c "echo > /dev/tcp/127.0.0.1/80"')
    expect(out.reasons.join(' ')).toContain('allow:dev-tcp-probe')
  })

  it('其它重定向仍按原规则（写工作区外 → 拦）', () => {
    expect(classify('echo x > /etc/passwd').gate).toBe(true)
    expect(classify('echo x > /opt/outside').gate).toBe(true)
  })
})

describe('dev 辅助容器白名单', () => {
  it('放行：story-shot-* / story-probe-* 的 stop、rm', () => {
    expect(classify('docker stop story-shot-1').gate).toBe(false)
    expect(classify('docker rm -f story-shot-abc').gate).toBe(false)
    expect(classify('docker stop story-probe-x').gate).toBe(false)
  })

  it('拦截：story-dev-postgres / postgres / dsh-dev 的 stop/rm', () => {
    expect(classify('docker stop story-dev-postgres').gate).toBe(true)
    expect(classify('docker rm dsh-dev').gate).toBe(true)
    expect(classify('docker stop postgres').gate).toBe(true)
  })
})

describe('回归原有规则', () => {
  it('生产库 / rm 工作区外 / git push main 仍拦', () => {
    expect(
      classify('docker exec postgres psql -d story -c "alter table t add column x int"').gate,
    ).toBe(true)
    expect(classify('rm -rf /tmp/probe-outside').gate).toBe(true)
    expect(classify('git push origin main').gate).toBe(true)
    expect(classify('rm -rf src/old-dir').gate).toBe(false)
  })
})

describe('SQL 判据按执行上下文（文件内容里的 SQL 不算）', () => {
  it('python 改 markdown（内容含 SQL 片段）→ 不拦', () => {
    const out = classify(
      `cd /workspace/proj && python3 - <<'PY'\np='docs/x.md'\nopen(p,'w').write("drop table users; delete from t")\nPY`,
    )
    expect(out.gate).toBe(false)
  })

  it('psql/docker exec psql 执行 drop/delete → 仍拦', () => {
    expect(classify('psql -d story -c "drop table users"').gate).toBe(true)
    expect(classify('docker exec postgres psql -d story -c "delete from users"').gate).toBe(true)
  })
})

describe('M8：edit/write 仓内写必须可审计（write-code，不 gate）', () => {
  it('工作区内 edit → effect=write-code、gate=false（供 autonomy 审计）', () => {
    const out = classifyTurnCall(
      { tool: 'edit', args: { path: '/workspace/proj/lib/a.ts' }, cwd: CWD },
      { cwd: CWD },
    )
    expect(out.gate).toBe(false)
    expect(out.effect).toBe('write-code')
    expect(out.reasons).toContain('allow:reversible-write')
  })

  it('工作区内 write → 同样 write-code；工作区外 edit → gate=true', () => {
    expect(
      classifyTurnCall(
        { tool: 'write', args: { path: '/workspace/proj/a.ts' }, cwd: CWD },
        { cwd: CWD },
      ).effect,
    ).toBe('write-code')
    expect(
      classifyTurnCall({ tool: 'edit', args: { path: '/etc/passwd' }, cwd: CWD }, { cwd: CWD })
        .gate,
    ).toBe(true)
  })
})
