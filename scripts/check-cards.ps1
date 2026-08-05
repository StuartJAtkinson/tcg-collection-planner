$ErrorActionPreference = 'Stop'

function Get-Card-Names($url) {
  $h = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30).Content
  # CardSurface uses <img alt="CardName" ...> per card tile — extract names from alt text
  [regex]::Matches($h, 'alt="([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
}

"=== /search?game=mtgo (no cmc) ==="
Get-Card-Names 'http://localhost:5253/search?game=mtgo' | Select-Object -First 10
""
"=== /search?game=mtgo&cmcMin=2&cmcMax=5 (range 2-5) ==="
Get-Card-Names 'http://localhost:5253/search?game=mtgo&cmcMin=2&cmcMax=5' | Select-Object -First 10
""
"=== /search?game=mtgo&cmcMax=0 (≤ 0, lands) ==="
Get-Card-Names 'http://localhost:5253/search?game=mtgo&cmcMax=0' | Select-Object -First 10
""
"=== /search?game=mtgo&cmcMin=7 (≥ 7) ==="
Get-Card-Names 'http://localhost:5253/search?game=mtgo&cmcMin=7' | Select-Object -First 10
