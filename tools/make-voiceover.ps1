# Generate six local narration clips using the installed Windows voice.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$voiceOutput = Join-Path $PSScriptRoot '..\assets\linkedin'
$voiceLines = @(
    'I asked Claude to teach me how A I works.',
    'Then we gave the shark a brain.',
    'Watch its neural network turn numbers into decisions.',
    'Fish learn to escape. Sharks learn to hunt.',
    'Built from scratch in JavaScript.',
    'Click a fish. Explore its brain.'
)
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $speaker.SelectVoice('Microsoft Zira Desktop')
    $speaker.Rate = 1
    $speaker.Volume = 100
    for ($clipIndex = 0; $clipIndex -lt $voiceLines.Length; $clipIndex++) {
        $clipPath = Join-Path $voiceOutput ('voice-' + $clipIndex + '.wav')
        $speaker.SetOutputToWaveFile($clipPath)
        $speaker.Speak($voiceLines[$clipIndex])
        $speaker.SetOutputToNull()
        Write-Output ('Created voice-' + $clipIndex + '.wav')
    }
    $voiceLines | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $voiceOutput 'voiceover-script.json') -Encoding UTF8
} finally {
    $speaker.Dispose()
}
