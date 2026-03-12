$src = "C:\Users\v1sua\Downloads\atuaanalyze"
$base = "C:\Users\v1sua\atua\plans"

Write-Host "Organizing Atua plans..." -ForegroundColor Cyan

# Create directories
@("complete", "inprogress", "todo", "reference") | ForEach-Object {
    New-Item -ItemType Directory -Path "$base\$_" -Force | Out-Null
}

# complete/ — Work CC already did
$complete = @(
    "catalyst-phase0-audit.md",
    "catalyst-codebase-audit.md",
    "catalyst-monorepo-plan.md",
    "catalyst-tiered-engine-spec.md",
    "catalyst-tiered-engine-addendum.md",
    "catalyst-tiered-engine-plan.md",
    "catalyst-workers-plan.md",
    "catalyst-workers-roadmap.md",
    "phase14-cc-kickoffs.md"
)
foreach ($f in $complete) {
    if (Test-Path "$src\$f") {
        Copy-Item "$src\$f" "$base\complete\$f" -Force
        Write-Host "  complete/$f" -ForegroundColor Green
    } else { Write-Host "  MISSING: $f" -ForegroundColor Red }
}

# inprogress/ — Needs corrections
$inprogress = @(
    "atua-unified-spec.md",
    "atua-hyperkernel-spec.md",
    "atua-implementation-plan.md",
    "catalyst-roadma2p.md"
)
foreach ($f in $inprogress) {
    if (Test-Path "$src\$f") {
        Copy-Item "$src\$f" "$base\inprogress\$f" -Force
        Write-Host "  inprogress/$f" -ForegroundColor Yellow
    } else { Write-Host "  MISSING: $f" -ForegroundColor Red }
}

# todo/ — Ready for CC
$todo = @(
    "atua-mcp-spec.md",
    "pi-atua-spec.md",
    "conductor-implementation-plan.md",
    "pi-hive-spec.md",
    "hive-implementation-plan.md",
    "pi-hive-dual-mode-addendum.md",
    "hashbrown-atua-spec.md",
    "sizzle-implementation-plan.md",
    "atua-transport-spec.md",
    "atua-transport-implementation-plan.md",
    "atua-embedded-agent-spec.md",
    "embedded-agent-implementation-plan.md"
)
foreach ($f in $todo) {
    if (Test-Path "$src\$f") {
        Copy-Item "$src\$f" "$base\todo\$f" -Force
        Write-Host "  todo/$f" -ForegroundColor Blue
    } else { Write-Host "  MISSING: $f" -ForegroundColor Red }
}

# reference/ — Pi docs, separate projects
$reference = @(
    "AGENTSpi.md",
    "extensions.md",
    "sdk.md",
    "packages.md",
    "new2PLAN.md"
)
foreach ($f in $reference) {
    if (Test-Path "$src\$f") {
        Copy-Item "$src\$f" "$base\reference\$f" -Force
        Write-Host "  reference/$f" -ForegroundColor DarkGray
    } else { Write-Host "  MISSING: $f" -ForegroundColor Red }
}

Write-Host ""
Write-Host "Files from atuaanalyze organized." -ForegroundColor Cyan
Write-Host ""
Write-Host "NOW: Copy these files from your latest Claude chat downloads:" -ForegroundColor White
Write-Host "  -> $base\inprogress\atua-architecture-clarification.md" -ForegroundColor Yellow
Write-Host "  -> $base\inprogress\atua-runtime-execution-spec.md" -ForegroundColor Yellow
Write-Host "  -> $base\todo\atuabox-spec.md" -ForegroundColor Blue
Write-Host "  -> $base\todo\atua-build-ui-spec.md" -ForegroundColor Blue
Write-Host "  -> $base\todo\fabric-implementation-plan.md" -ForegroundColor Blue
Write-Host "  -> $base\README.md" -ForegroundColor White
Write-Host ""
Write-Host "Total: 9 complete, 6 inprogress, 17 todo, 5 reference, 1 README" -ForegroundColor Cyan
