# Compila o frontend e inicia o backend. Depois abra http://localhost:5080
$root = $PSScriptRoot

Push-Location "$root\frontend"
if (-not (Test-Path node_modules)) { npm install }
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
Pop-Location

Push-Location "$root\backend"
dotnet run
Pop-Location
