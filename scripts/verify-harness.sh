#!/usr/bin/env bash
set -euo pipefail

required=(
  AGENTS.md
  .omp/config.yml
  .omp/agents/adaptive-builder.md
  .omp/agents/adaptive-auditor.md
  .omp/agents/adaptive-committer.md
  .omp/skills/caveman/SKILL.md
  .omp/skills/adaptive-platform/SKILL.md
  .omp/skills/adaptive-ui/SKILL.md
  .omp/commands/adaptive-bootstrap.md
  .omp/commands/adaptive-github-init.md
  .omp/commands/adaptive-ui-review.md
  docs/project/GIT-WORKFLOW.md
  docs/project/STATE.md
  docs/plans/ROADMAP.md
  docs/requirements/traceability-matrix.md
  docs/source/project-requirements.pdf
  docs/ui/UI-SPEC.md
  docs/ui/IMPLEMENTATION-WORKFLOW.md
  docs/ui/SCREEN-REFERENCE-MAP.md
  docs/ui/VISUAL-QA.md
  docs/ui/reference/00-contact-sheet.webp
  .gitignore
)

for file in "${required[@]}"; do
  [[ -f "$file" ]] || { echo "missing: $file" >&2; exit 1; }
done

brief_count=$(find docs/ui/screens -maxdepth 1 -type f -name '0[1-8]-*.md' | wc -l | tr -d ' ')
image_count=$(find docs/ui/reference -maxdepth 1 -type f -name '0[1-8]-*.webp' | wc -l | tr -d ' ')
[[ "$brief_count" == "8" ]] || { echo "expected 8 UI briefs, found $brief_count" >&2; exit 1; }
[[ "$image_count" == "8" ]] || { echo "expected 8 UI images, found $image_count" >&2; exit 1; }

if command -v omp >/dev/null 2>&1; then
  echo "omp: found"
  echo "run: omp models openai-codex --json"
else
  echo "warning: omp not found in PATH" >&2
fi

echo "harness files: OK"
echo "UI pack: 8 briefs + 8 references + contact sheet"
echo "next: open OMP, run /adaptive-github-init then /adaptive-bootstrap"
