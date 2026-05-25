# generate-manifest.ps1
# Run from the stepsequencer folder: powershell -ExecutionPolicy Bypass -File generate-manifest.ps1
# Outputs midi-manifest.json

$root = $PSScriptRoot
$midiRoot = Join-Path $root "midi"
$entries = @()

# ── CHORD PROGRESSIONS ─────────────────────────────────────────────
# Structure: midi/chords/{Major|Minor|Modal}/{style}/Key - Progression - Moods.mid

$chordFiles = Get-ChildItem -Path (Join-Path $midiRoot "chords") -Filter "*.mid" -Recurse

foreach ($f in $chordFiles) {
    # Relative path with forward slashes for the browser
    $rel = $f.FullName.Replace($root, "").Replace("\", "/").TrimStart("/")

    # Parse folder levels
    $parts = $f.DirectoryName.Replace($root, "").TrimStart("\").Split("\")
    # parts[0]=midi, parts[1]=chords, parts[2]=Major|Minor|Modal, parts[3]=pop style etc.
    $category = if ($parts.Length -gt 2) { $parts[2] } else { "Unknown" }
    $styleRaw  = if ($parts.Length -gt 3) { $parts[3] } else { "" }
    $style     = $styleRaw -replace " style", "" -replace " ", ""

    # Parse filename: "A - I V vi IV - Hopeful Romantic"
    $name  = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
    $segs  = $name -split " - ", 3
    $key   = if ($segs.Length -gt 0) { $segs[0].Trim() } else { "?" }
    $prog  = if ($segs.Length -gt 1) { $segs[1].Trim() } else { "" }
    $moodStr = if ($segs.Length -gt 2) { $segs[2].Trim() } else { "" }
    $moods = if ($moodStr) { $moodStr -split " " } else { @() }

    $entries += [PSCustomObject]@{
        path        = $rel
        deck        = "chords"
        category    = $category
        style       = $style
        key         = $key
        progression = $prog
        moods       = $moods
    }
}

Write-Host "Chord files indexed: $($entries.Count)"

# ── DRUM LOOPS ─────────────────────────────────────────────────────
# Structure: midi/drums/{feel folder}/{Genre feel number.mid}

$drumFiles = Get-ChildItem -Path (Join-Path $midiRoot "drums") -Filter "*.mid" -Recurse
$drumEntries = @()

foreach ($f in $drumFiles) {
    $rel = $f.FullName.Replace($root, "").Replace("\", "/").TrimStart("/")

    # Folder name tells us the feel category
    $folderParts = $f.DirectoryName.Replace($root, "").TrimStart("\").Split("\")
    # Could be: midi\drums\4 On The Floor  or  midi\drums\Percussion\Full Percussion
    $feelFolder  = if ($folderParts.Length -gt 2) { $folderParts[2] } else { "" }
    $subFolder   = if ($folderParts.Length -gt 3) { $folderParts[3] } else { "" }

    # Normalize feel
    $feel = switch -Wildcard ($feelFolder) {
        "*Floor*"      { "4otf" }
        "*Groovy*"     { "groovy" }
        "*Halftime*"   { "halftime" }
        "*Percussion*" { "percussion" }
        default        { $feelFolder.ToLower() -replace " ", "" }
    }

    $density = ""
    if ($subFolder -match "Empty")  { $density = "empty" }
    if ($subFolder -match "Full")   { $density = "full" }
    if ($subFolder -match "Medium") { $density = "medium" }

    # Parse filename: "House 4otf 1" or "House groovy 15"
    $name   = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
    $words  = $name -split " "
    $genre  = if ($words.Length -gt 0) { $words[0] } else { "Unknown" }
    $idx    = if ($words.Length -gt 1) { [int]($words[-1] -replace "[^0-9]", "0") } else { 0 }

    $drumEntries += [PSCustomObject]@{
        path    = $rel
        deck    = "drums"
        feel    = $feel
        density = $density
        genre   = $genre
        index   = $idx
    }
}

Write-Host "Drum files indexed: $($drumEntries.Count)"

$allEntries = $entries + $drumEntries

# ── WRITE JSON ─────────────────────────────────────────────────────
$json = $allEntries | ConvertTo-Json -Depth 5
$outPath = Join-Path $root "midi-manifest.json"
[System.IO.File]::WriteAllText($outPath, $json, [System.Text.Encoding]::UTF8)

Write-Host "Done! $($allEntries.Count) total entries written to midi-manifest.json"
