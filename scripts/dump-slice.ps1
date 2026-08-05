$base = 'http://localhost:5253'
$html = (Invoke-WebRequest -Uri "$base/search?game=mtg" -UseBasicParsing -TimeoutSec 30).Content
$i = $html.IndexOf('Mana value')
if ($i -lt 0) { Write-Output 'no Mana value label'; exit }
$slice = $html.Substring($i, 3500)
$slice.Substring(0, [Math]::Min(3500, $slice.Length))
