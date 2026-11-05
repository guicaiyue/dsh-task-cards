// 提交信息规范：type(scope): 中文摘要
//
// 只保留两条必要规则（type 枚举 + 摘要非空），其余交给 review：
// 规则越多，代理越容易为了过检查而写空洞的提交信息。

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'test', 'docs', 'chore', 'perf', 'ci', 'build', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      ['host', 'client', 'shared', 'contract', 'docs', 'ci', 'build', 'deps', 'release', 'repo'],
    ],
    'subject-empty': [2, 'never'],
    'header-max-length': [2, 'always', 100],
    'subject-case': [0],
    'body-max-line-length': [0],
  },
}
