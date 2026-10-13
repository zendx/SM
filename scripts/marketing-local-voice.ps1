Add-Type -AssemblyName System.Speech
$marketingRoot = Split-Path -Parent $PSScriptRoot
$marketingOutput = Join-Path $marketingRoot 'docs/marketing-video/audio'
New-Item -ItemType Directory -Path $marketingOutput -Force | Out-Null
$marketingScenes = Get-Content -LiteralPath (Join-Path $marketingRoot 'docs/marketing-video/scenes.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$marketingSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $marketingSynth.SelectVoice('Microsoft Zira Desktop')
    $marketingSynth.Rate = 0
    for ($marketingIndex = 0; $marketingIndex -lt $marketingScenes.Count; $marketingIndex++) {
        $marketingWave = Join-Path $marketingOutput ('voice-{0:D2}.wav' -f $marketingIndex)
        $marketingSynth.SetOutputToWaveFile($marketingWave)
        $marketingSynth.Speak($marketingScenes[$marketingIndex].voice)
        $marketingSynth.SetOutputToNull()
        Write-Output ('Narration scene {0} ready' -f ($marketingIndex + 1))
    }
} finally {
    $marketingSynth.Dispose()
}
