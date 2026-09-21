$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine([System.Globalization.CultureInfo]::GetCultureInfo('en-US'))
try {
    $phrases = New-Object System.Speech.Recognition.Choices
    $phrases.Add([string[]]@(
        'I gave a shark a brain',
        'Then I taught the fish to outsmart it',
        'All because I asked Claude one question',
        'Can you teach me AI by building a game',
        'Now the fish evolve to escape',
        'The shark evolves to catch them',
        'And the coolest part',
        'You can click a fish and see the calculations behind its next move',
        'That is when neural networks finally clicked for me',
        'That''s when neural networks finally clicked for me'
    ))
    $builder = New-Object System.Speech.Recognition.GrammarBuilder
    $builder.Culture = [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
    $builder.Append($phrases)
    $grammar = New-Object System.Speech.Recognition.Grammar($builder)
    $engine.LoadGrammar($grammar)
    $engine.SetInputToWaveFile((Join-Path $PSScriptRoot '..\assets\linkedin\elevenlabs-analysis.wav'))
    $results = @()
    while ($true) {
        try { $result = $engine.Recognize() } catch {
            if ($results.Count -gt 0 -and $_.Exception.Message -like '*No audio input*') { break }
            throw
        }
        if ($null -eq $result) { break }
        $results += [pscustomobject]@{ text=$result.Text; start=$result.Audio.AudioPosition.TotalSeconds; duration=$result.Audio.Duration.TotalSeconds; confidence=$result.Confidence }
    }
    $results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '..\assets\linkedin\elevenlabs-alignment.json') -Encoding UTF8
    $results | Format-Table -AutoSize
} finally { $engine.Dispose() }
