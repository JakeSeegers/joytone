# generate-manifest.ps1
# Run from the stepsequencer folder: powershell -ExecutionPolicy Bypass -File generate-manifest.ps1
# Outputs midi-manifest.json

$root = $PSScriptRoot
$midiRoot = Join-Path $root "midi"

# (The chord-progression library was removed — only drum loops are indexed now.)

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

$allEntries = $drumEntries

# ── WRITE JSON ─────────────────────────────────────────────────────
$json = $allEntries | ConvertTo-Json -Depth 5
$outPath = Join-Path $root "midi-manifest.json"
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Done! $($allEntries.Count) total entries written to midi-manifest.json"
