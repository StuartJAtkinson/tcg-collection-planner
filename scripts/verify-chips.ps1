$h = (Invoke-WebRequest -Uri 'http://localhost:5253/search?game=mtgo' -UseBasicParsing -TimeoutSec 30).Content
# check the actual class string on Kind buttons
$i = $h.IndexOf('Kind</div>')
$slice = $h.Substring($i, 300)
Write-Output $slice.Substring(0, [Math]::Min(300, $slice.Length))
