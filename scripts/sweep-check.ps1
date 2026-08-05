$base = 'http://localhost:5253'
$t = (Invoke-WebRequest -Uri "$base/search?game=mtg" -UseBasicParsing -TimeoutSec 30).Content

"=== issue 3: tri-state chips (em-dash separator) ==="
$pat3 = [char]0x2014 + ' (off|in|out)"'
$triStates = ([regex]::Matches($t, $pat3)).Count
Write-Output "  tri-state titles with em-dash separator: $triStates (expect >=12)"

"=== issue 5: kind order desc by count ==="
$em = [regex]::Escape([char]0x2014)
$pat5 = 'title="([A-Za-z][^"]+?) ' + $em + ' off"[^>]*>\s*<span>([^<]+)</span>[^<]*<span class="text-neutral-500"> <!-- -->(\d+)'
$kinds = [regex]::Matches($t, $pat5) | ForEach-Object { "$($_.Groups[2].Value) = $($_.Groups[3].Value)" }
$kinds | ForEach-Object { "  $_" }
