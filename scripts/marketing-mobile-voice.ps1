Add-Type -AssemblyName System.Speech

$marketingRoot = Split-Path -Parent $PSScriptRoot
$output = Join-Path $marketingRoot 'docs/marketing-video-mobile/audio'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$text = Get-Content -LiteralPath (Join-Path $marketingRoot 'docs/marketing-video-mobile/narration.txt') -Raw -Encoding UTF8
$escape = [System.Security.SecurityElement]::Escape($text.Trim())
$ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="Microsoft Zira Desktop"><prosody rate="-2%">' + $escape.Replace("`r`n`r`n", '<break time="250ms"/>').Replace("`n`n", '<break time="250ms"/>') + '</prosody></voice></speak>'
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $synth.SelectVoice('Microsoft Zira Desktop')
    $synth.SetOutputToWaveFile((Join-Path $output 'narration.wav'))
    $synth.SpeakSsml($ssml)
    $synth.SetOutputToNull()
    Write-Output 'Local English narration saved.'
} finally {
    $synth.Dispose()
}
