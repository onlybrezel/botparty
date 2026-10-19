param(
    [ValidateSet('checks', 'compose', 'lighthouse', 'performance', 'all')]
    [string]$Phase = 'all'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCommand) {
    $dockerBin = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin'
    if (-not (Test-Path (Join-Path $dockerBin 'docker.exe'))) { throw 'Docker CLI not found.' }
    $env:PATH = "$dockerBin;$env:PATH"
}
function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}
Push-Location $repoRoot
$runId = "botparty-local-ci-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$volume = "$runId-source"
$postgres = "$runId-postgres"
$redis = "$runId-redis"
$runner = "$runId-runner"
$snapshot = Join-Path ([IO.Path]::GetTempPath()) "$runId.tar"
$resultDir = Join-Path $repoRoot "data/local-ci/$runId"
$mountpoint = $null
$gitName = git config user.name
$gitEmail = git config user.email
if (-not $gitName -or -not $gitEmail) { throw 'Configure your Git name and email before running local CI.' }
New-Item -ItemType Directory -Path $resultDir -Force | Out-Null
try {
    $dirty = git status --porcelain --untracked-files=no
    if ($dirty) { throw 'Commit tracked changes first so the exact tested source is recorded.' }
    Invoke-Checked git @('archive', '--format=tar', "--output=$snapshot", 'HEAD')
    git rev-parse HEAD | Set-Content (Join-Path $resultDir 'source-commit.txt')
    Invoke-Checked docker @('build', '-f', 'docker/ci/Dockerfile', '-t', 'botparty-local-ci-runner:latest', '.')
    Invoke-Checked docker @('volume', 'create', $volume)
    $mountpoint = docker volume inspect --format '{{.Mountpoint}}' $volume
    if ($LASTEXITCODE -ne 0 -or -not $mountpoint) { throw 'Cannot locate disposable source volume.' }
    Invoke-Checked docker @('run', '--rm', '--mount', "type=volume,source=$volume,target=/snapshot", '--mount', "type=bind,source=$snapshot,target=/source.tar,readonly", '-e', "LOCAL_CI_GIT_NAME=$gitName", '-e', "LOCAL_CI_GIT_EMAIL=$gitEmail", 'botparty-local-ci-runner:latest', '-lc', 'set -e; tar -xf /source.tar -C /snapshot; cd /snapshot; git init -q; git config user.email "$LOCAL_CI_GIT_EMAIL"; git config user.name "$LOCAL_CI_GIT_NAME"; git add .; git commit -qm snapshot')
    Invoke-Checked docker @('run', '-d', '--name', $postgres, '-e', 'POSTGRES_USER=botparty', '-e', 'POSTGRES_PASSWORD=local-ci-password', '-e', 'POSTGRES_DB=migration_test', 'postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15')
    Invoke-Checked docker @('run', '-d', '--name', $redis, '--network', "container:$postgres", 'redis:7-alpine@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99')
    Invoke-Checked docker @('run', '--name', $runner, '--cpus', '4', '--memory', '8g', '--init', '--network', "container:$postgres", '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock', '--mount', "type=volume,source=$volume,target=$mountpoint", '-e', "LOCAL_CI_RUN_ID=$runId", '-w', $mountpoint, 'botparty-local-ci-runner:latest', '-lc', "mkdir -p data/local-ci; set -o pipefail; bash scripts/run-local-checks.sh $Phase 2>&1 | tee data/local-ci/$Phase.log")
} finally {
    # Copy results before removing only this run's explicitly named resources.
    docker cp "${runner}:${mountpoint}/data/local-ci/." $resultDir 2>$null
    docker cp "${runner}:${mountpoint}/apps/api/coverage" (Join-Path $resultDir 'api-coverage') 2>$null
    docker cp "${runner}:${mountpoint}/apps/web/coverage" (Join-Path $resultDir 'web-coverage') 2>$null
    # Nested Compose/upgrade resources carry this invocation's unique prefix.
    # Also clean these on interruption, when child-shell EXIT traps cannot run.
    $ownedContainers = docker ps -a --format '{{.ID}} {{.Names}}' | ForEach-Object { if (($_ -split ' ', 2)[1].StartsWith("$runId-")) { ($_ -split ' ', 2)[0] } }
    if ($ownedContainers) { docker rm -f @ownedContainers 2>$null | Out-Null }
    $ownedNetworks = docker network ls --format '{{.Name}}' | Where-Object { $_.StartsWith("$runId-") }
    if ($ownedNetworks) { docker network rm @ownedNetworks 2>$null | Out-Null }
    $ownedVolumes = docker volume ls --format '{{.Name}}' | Where-Object { $_.StartsWith("$runId-") }
    if ($ownedVolumes) { docker volume rm @ownedVolumes 2>$null | Out-Null }
    Remove-Item -LiteralPath $snapshot -ErrorAction SilentlyContinue
    Pop-Location
}
