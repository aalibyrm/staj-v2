$ErrorActionPreference = "Stop"

$required = @(
  "AGENTS.md",
  ".omp/config.yml",
  ".omp/agents/adaptive-builder.md",
  ".omp/agents/adaptive-auditor.md",
  ".omp/agents/adaptive-committer.md",
  ".omp/skills/caveman/SKILL.md",
  ".omp/skills/adaptive-platform/SKILL.md",
  ".omp/skills/adaptive-ui/SKILL.md",
  ".omp/commands/adaptive-bootstrap.md",
  ".omp/commands/adaptive-github-init.md",
  ".omp/commands/adaptive-ui-review.md",
  "docs/project/GIT-WORKFLOW.md",
  "docs/project/STATE.md",
  "docs/plans/ROADMAP.md",
  "docs/requirements/traceability-matrix.md",
  "docs/source/project-requirements.pdf",
  "docs/ui/UI-SPEC.md",
  "docs/ui/IMPLEMENTATION-WORKFLOW.md",
  "docs/ui/SCREEN-REFERENCE-MAP.md",
  "docs/ui/VISUAL-QA.md",
  "docs/ui/reference/00-contact-sheet.webp",
  ".gitignore"
)

$screenBriefs = 1..8 | ForEach-Object {
  $n = "{0:D2}" -f $_
  Get-ChildItem "docs/ui/screens/$n-*.md" -ErrorAction SilentlyContinue
}
$screenImages = 1..8 | ForEach-Object {
  $n = "{0:D2}" -f $_
  Get-ChildItem "docs/ui/reference/$n-*.webp" -ErrorAction SilentlyContinue
}

$missing = $required | Where-Object { -not (Test-Path $_) }
if ($missing.Count -gt 0) {
  Write-Error ("Missing harness files: " + ($missing -join ", "))
}
if ($screenBriefs.Count -ne 8) { Write-Error "Expected 8 UI screen briefs; found $($screenBriefs.Count)." }
if ($screenImages.Count -ne 8) { Write-Error "Expected 8 UI reference images; found $($screenImages.Count)." }

if (-not (Get-Command omp -ErrorAction SilentlyContinue)) {
  Write-Warning "omp not found in PATH. Install/update Oh My Pi before use."
} else {
  Write-Host "omp: found"
  Write-Host "Run: omp models openai-codex --json"
}

Write-Host "Harness files: OK"
Write-Host "UI pack: 8 briefs + 8 references + contact sheet"
Write-Host "Next: start OMP, run /adaptive-github-init then /adaptive-bootstrap"
