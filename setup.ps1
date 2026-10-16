$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

try {
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        throw "Python was not found on PATH. Install Python 3.10+ and run this script again."
    }

    if (-not (Test-Path ".venv")) {
        python -m venv .venv
    }

    & ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
    & ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt

    if (-not (Test-Path ".git")) {
        git init
    }

    Write-Host "Setup finished. Opening VS Code..." -ForegroundColor Green
    code .
}
catch {
    Write-Host "Setup failed: $_" -ForegroundColor Red
}

Read-Host "Press Enter to close this window"
