#!/usr/bin/env bash
# 把本仓库的 skill 软链到 Claude Code 和/或 codex 的 skills 目录。
# 软链而不是复制：git pull 之后立刻生效。
#
#   ./scripts/install.sh              装全部，装到检测到的所有 agent
#   ./scripts/install.sh novel-characters
#   ./scripts/install.sh --claude     只装到 Claude Code
#   ./scripts/install.sh --codex      只装到 codex
#   ./scripts/install.sh --uninstall  取消软链
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$REPO/skills"

targets=()
wanted=()
uninstall=0

for arg in "$@"; do
  case "$arg" in
    --claude)    targets+=("$HOME/.claude/skills") ;;
    --codex)     targets+=("$HOME/.codex/skills") ;;
    --uninstall) uninstall=1 ;;
    -h|--help)   sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)          echo "未知选项 $arg" >&2; exit 1 ;;
    *)           wanted+=("$arg") ;;
  esac
done

# 没指定目标就自动检测：哪个 agent 装了就装到哪
if [ ${#targets[@]} -eq 0 ]; then
  [ -d "$HOME/.claude" ] && targets+=("$HOME/.claude/skills")
  [ -d "$HOME/.codex" ] && targets+=("$HOME/.codex/skills")
fi
if [ ${#targets[@]} -eq 0 ]; then
  echo "没找到 ~/.claude 或 ~/.codex，指定 --claude 或 --codex 试试" >&2
  exit 1
fi

# 没指定 skill 就装全部
if [ ${#wanted[@]} -eq 0 ]; then
  for d in "$SKILLS_DIR"/*/; do
    [ -f "$d/SKILL.md" ] && wanted+=("$(basename "$d")")
  done
fi

for target in "${targets[@]}"; do
  mkdir -p "$target"
  for name in "${wanted[@]}"; do
    src="$SKILLS_DIR/$name"
    dst="$target/$name"
    if [ ! -f "$src/SKILL.md" ]; then
      echo "✗ $name — 不是一个 skill（缺 SKILL.md）" >&2
      exit 1
    fi
    if [ "$uninstall" -eq 1 ]; then
      if [ -L "$dst" ]; then rm "$dst"; echo "− $dst"; fi
      continue
    fi
    # 只覆盖软链；真实目录是用户自己放的，不动
    if [ -e "$dst" ] && [ ! -L "$dst" ]; then
      echo "✗ $dst 已存在且不是软链，跳过" >&2
      continue
    fi
    ln -sfn "$src" "$dst"
    echo "✓ $dst → $src"
  done
done
