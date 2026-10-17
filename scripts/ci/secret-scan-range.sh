#!/usr/bin/env bash
# 輸出 gitleaks --log-opts 範圍到 stdout；說明訊息走 stderr。
# 輸入（env）：EVENT_NAME BASE_REF REF BEFORE SHA
set -euo pipefail
zero=0000000000000000000000000000000000000000
case "$EVENT_NAME" in
  pull_request)
    base="origin/${BASE_REF}"
    if ! git rev-parse --verify --quiet "${base}^{commit}" >/dev/null; then
      echo "::error::範圍底端 ${base} 不在 clone 內，停止掃描。" >&2
      exit 1
    fi
    log_opts="${base}..HEAD"
    ;;
  push)
    if [ -z "$BEFORE" ] || [ "$BEFORE" = "$zero" ]; then
      echo "::warning::退回模式：event.before 為空或全 0（新分支），改掃 -n 100。" >&2
      log_opts="-n 100 ${SHA}"
    else
      if git cat-file -e "${BEFORE}^{commit}" 2>/dev/null; then
        log_opts="${BEFORE}..${SHA}"
      elif [ "$REF" != "refs/heads/main" ] && git rev-parse --verify --quiet "origin/main^{commit}" >/dev/null; then
        echo "::warning::${BEFORE} 不在 clone 內（分支被強推），改掃 origin/main..${SHA}。" >&2
        log_opts="origin/main..${SHA}"
      else
        echo "::error::範圍底端 ${BEFORE} 不在 clone 內，停止掃描。" >&2
        exit 1
      fi
    fi
    ;;
  schedule|workflow_dispatch)
    log_opts="--all"
    ;;
  *)
    echo "::error::未支援的事件 ${EVENT_NAME}" >&2
    exit 1
    ;;
esac
# shellcheck disable=SC2086
count=$(git rev-list --count ${log_opts})
echo "掃描範圍：--log-opts=\"${log_opts}\"（${count} 個 commit）" >&2
echo "${log_opts}"
