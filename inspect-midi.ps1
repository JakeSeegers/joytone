# Quick MIDI inspector — shows channels and note numbers used
param([string]$path = "midi\drums\4 On The Floor\House 4otf 1.mid")

$fullPath = Join-Path $PSScriptRoot $path
$bytes = [System.IO.File]::ReadAllBytes($fullPath)

function ReadUint32($b, $pos) {
    return ([int]$b[$pos] -shl 24) -bor ([int]$b[$pos+1] -shl 16) -bor ([int]$b[$pos+2] -shl 8) -bor [int]$b[$pos+3]
}
function ReadUint16($b, $pos) {
    return ([int]$b[$pos] -shl 8) -bor [int]$b[$pos+1]
}
function ReadVLQ($b, $pos) {
    $val = 0; $bytes = 0
    do { $byte = $b[$pos + $bytes]; $val = ($val -shl 7) -bor ($byte -band 0x7F); $bytes++ } while ($byte -band 0x80)
    return $val, $bytes
}

$header = [System.Text.Encoding]::ASCII.GetString($bytes, 0, 4)
Write-Host "Header: $header"
$format  = ReadUint16 $bytes 8
$nTracks = ReadUint16 $bytes 10
$ppq     = ReadUint16 $bytes 12
Write-Host "Format: $format  Tracks: $nTracks  PPQ: $ppq"

$pos = 14
$channels = @{}
$notes    = @{}

for ($ti = 0; $ti -lt $nTracks; $ti++) {
    $tag  = [System.Text.Encoding]::ASCII.GetString($bytes, $pos, 4)
    $tLen = ReadUint32 $bytes ($pos + 4)
    $tEnd = $pos + 8 + $tLen
    $pos += 8
    $rs = 0

    while ($pos -lt $tEnd) {
        $vlq = ReadVLQ $bytes $pos
        $pos += $vlq[1]
        if ($pos -ge $tEnd) { break }

        $sb = $bytes[$pos]
        if ($sb -eq 0xFF) {
            $pos++
            $mt = $bytes[$pos++]
            $ml = ReadVLQ $bytes $pos
            $pos += $ml[1] + $ml[0]
        } elseif ($sb -eq 0xF0 -or $sb -eq 0xF7) {
            $pos++
            $sl = ReadVLQ $bytes $pos
            $pos += $sl[1] + $sl[0]
        } else {
            if ($sb -band 0x80) { $rs = $sb; $pos++ } else { $sb = $rs }
            $type = ($sb -band 0xF0) -shr 4
            $ch   = $sb -band 0x0F
            if ($type -eq 0x9 -or $type -eq 0x8) {
                $note = $bytes[$pos]; $vel = $bytes[$pos+1]; $pos += 2
                if ($type -eq 0x9 -and $vel -gt 0) {
                    $channels[$ch] = ($channels[$ch] + 1)
                    $notes[$note]  = ($notes[$note]  + 1)
                }
            } elseif ($type -eq 0xA -or $type -eq 0xB -or $type -eq 0xE) { $pos += 2 }
            elseif ($type -eq 0xC -or $type -eq 0xD) { $pos += 1 }
        }
    }
    $pos = $tEnd
}

Write-Host "`nChannels used (0-indexed):"
$channels.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host "  Ch $($_.Name): $($_.Value) note-on events" }

Write-Host "`nNote numbers used:"
$notes.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host "  Note $($_.Name): $($_.Value) hits" }
