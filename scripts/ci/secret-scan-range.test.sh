#!/usr/bin/env bash
# secret-scan-range.sh 的行為測試：檢查「哪些 commit 會被掃到」。
set -uo pipefail
script="$(cd "$(dirname "$0")" && pwd)/secret-scan-range.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail=0

g() { git -C "$work/repo" "$@"; }
commit() { g commit -q --allow-empty -m "$1" && g rev-parse HEAD; }

git init -q -b main "$work/repo"
g config user.email t@example.com
g config user.name test
c0=$(commit c0)
c1=$(commit c1)
c2=$(commit c2)
g update-ref refs/remotes/origin/main "$c2"
g checkout -q -b feature
f1=$(commit f1)
g checkout -q --orphan orphan
o1=$(commit o1)
g checkout -q feature
zero=0000000000000000000000000000000000000000

# 用法：scan_set <EVENT_NAME> <REF> <BEFORE> <SHA> <LAST_SUCCESS_SHA> [BASE_REF]
scan_set() {
  local opts
  opts=$(cd "$work/repo" && EVENT_NAME="$1" REF="$2" BEFORE="$3" SHA="$4" \
    LAST_SUCCESS_SHA="$5" BASE_REF="${6:-}" bash "$script" 2>/dev/null) || { echo "EXIT_NONZERO"; return; }
  # shellcheck disable=SC2086
  g rev-list $opts
}

expect() {
  local name="$1" set="$2" want="$3" unwanted="${4:-}" c
  for c in $want; do
    grep -qx "$c" <<<"$set" || { echo "FAIL: ${name}：應掃到 ${c:0:7}"; fail=1; return; }
  done
  for c in $unwanted; do
    grep -qx "$c" <<<"$set" && { echo "FAIL: ${name}：不應掃到 ${c:0:7}"; fail=1; return; }
  done
  echo "ok: $name"
}

expect_exit() {
  if [ "$2" = "EXIT_NONZERO" ]; then echo "ok: $1"; else echo "FAIL: ${1}：應失敗"; fail=1; fi
}

s=$(scan_set push refs/heads/main "$c1" "$c2" "$c0")
expect "main：上一次掃描被取消時，涵蓋上次成功之後所有 commit" "$s" "$c1 $c2" "$c0"

s=$(scan_set push refs/heads/main "$c1" "$c2" "$c1")
expect "main：上一次成功時，只掃新 commit" "$s" "$c2" "$c1 $c0"

s=$(scan_set push refs/heads/main "$c1" "$c2" "")
expect "main：查不到上次成功時，掃整段歷史" "$s" "$c0 $c1 $c2"

s=$(scan_set push refs/heads/main "$c1" "$c2" "$o1")
expect "main：上次成功不是祖先時，掃整段歷史" "$s" "$c0 $c1 $c2"

s=$(scan_set push refs/heads/feature "2222222222222222222222222222222222222222" "$f1" "$o1")
expect "非 main 被強推：改掃 origin/main..sha" "$s" "$f1" "$c2"

s=$(scan_set push refs/heads/feature "$c2" "$f1" "$c1")
expect "非 main：上一次掃描被取消時，涵蓋上次成功之後所有 commit" "$s" "$c2 $f1" "$c1"

s=$(scan_set push refs/heads/feature "$zero" "$f1" "")
expect "新分支：退回 -n 100" "$s" "$f1 $c0"

s=$(scan_set pull_request refs/pull/1/merge "" "$f1" "" main)
expect "PR：掃 origin/base..HEAD" "$s" "$f1" "$c2"

s=$(scan_set pull_request refs/pull/1/merge "" "$f1" "" nope)
expect_exit "PR：base 不在 clone 內時失敗" "$s"

s=$(scan_set push refs/heads/main "1111111111111111111111111111111111111111" "$c2" "")
expect "main：before 不在 clone 內且查不到上次成功，掃整段歷史" "$s" "$c0 $c1 $c2"

s=$(scan_set workflow_dispatch refs/heads/main "" "$c2" "")
expect "dispatch：掃全部" "$s" "$c0 $f1 $o1"

exit "$fail"
