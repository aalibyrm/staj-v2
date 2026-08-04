param(
  [string]$RepositoryUrl = "https://github.com/aalibyrm/staj-v2.git",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git bulunamadı. Git for Windows kurup terminali yeniden açın."
}

if (-not (Test-Path ".git")) {
  git init | Out-Host
}

git branch -M $Branch | Out-Host

$origin = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0) {
  git remote add origin $RepositoryUrl
} elseif ($origin.Trim() -ne $RepositoryUrl) {
  throw "origin farklı URL kullanıyor: $origin"
}

$name = git config --get user.name
$email = git config --get user.email
if (-not $name -or -not $email) {
  throw "Git kimliği eksik. Çalıştırın: git config --global user.name 'Ad Soyad'; git config --global user.email 'mail@example.com'"
}

Write-Host "Git bağlantısı hazır."
Write-Host "origin: $(git remote get-url origin)"
Write-Host "branch: $(git branch --show-current)"
Write-Host "Sonraki adım OMP içinde: /adaptive-github-init"
