# Tarik export layer 1-4 + layer 1 per sub-periode (.xlsx dirender server).
# Versi PowerShell dari export_layer1234_subperiode.sh; base URL di-hardcode.
#
# Alur:
#   1. POST /auth/login                          -> token
#   2. GET  /periods (bila -PeriodId kosong)     -> pilih periode dari daftar
#   3. GET  /dashboard/layer-subperiod/export    -> simpan .xlsx
#
# Pakai:
#   .\export_layer1234_subperiode.ps1                      (username & password ditanya)
#   .\export_layer1234_subperiode.ps1 <username>           (password ditanya, tidak tampil)
#   .\export_layer1234_subperiode.ps1 <username> <password>
#
# Bila diblokir execution policy:
#   powershell -ExecutionPolicy Bypass -File .\export_layer1234_subperiode.ps1
#
# Opsional:
#   -Role SAU_SUPER_ADMIN   X-Active-Role; pakai role nasional agar semua unit ikut
#   -PeriodId 12            lewati menu; tanpa ini periode dipilih dari daftar
#   -Out tmp                folder tujuan file (default tmp\)
#
# File ini sengaja ASCII saja supaya aman dibaca Windows PowerShell 5.1.
param(
  [Parameter(Position = 0)][string]$Username,
  [Parameter(Position = 1)][string]$Password,
  [string]$Role = 'SAU_SUPER_ADMIN',
  [string]$PeriodId,
  [string]$Out = 'tmp'
)

$ErrorActionPreference = 'Stop'
# Progress bar Invoke-WebRequest membuat unduhan sangat lambat di PowerShell 5.1.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Base = 'https://qa-uko-be.sauwork.co.id/api/v1'
# Export dirender server untuk sampai 10.000 unit; beri waktu longgar.
$ExportTimeout = 900

function Log([string]$msg) { Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg" }
function Fail([string]$msg) { [Console]::Error.WriteLine("GAGAL: $msg"); exit 1 }

# Ringkas error HTTP jadi "HTTP <status>: <potongan body>" (jalan di PS 5.1 dan 7).
function Get-HttpError($err) {
  $status = '?'
  $body = ''
  $resp = $err.Exception.Response
  if ($resp) {
    try { $status = [int]$resp.StatusCode } catch {}
  }
  if ($err.ErrorDetails -and $err.ErrorDetails.Message) {
    $body = $err.ErrorDetails.Message
  } elseif ($resp -and ($resp | Get-Member -Name GetResponseStream)) {
    try {
      $stream = $resp.GetResponseStream()
      if ($stream.CanSeek) { $stream.Position = 0 }
      $body = (New-Object IO.StreamReader($stream)).ReadToEnd()
    } catch {}
  }
  if (-not $resp -and -not $body) { $body = $err.Exception.Message }
  if ($body.Length -gt 300) { $body = $body.Substring(0, 300) }
  return "HTTP ${status}: $body"
}

if (-not $Username) { $Username = Read-Host 'Username' }
if (-not $Username) { Fail 'username kosong' }
if (-not $Password) {
  $secure = Read-Host "Password untuk $Username" -AsSecureString
  $Password = (New-Object Management.Automation.PSCredential('x', $secure)).GetNetworkCredential().Password
}
if (-not $Password) { Fail 'password kosong' }

# --- 1. Login -------------------------------------------------------------
Log "Login sebagai $Username ke $Base"
$loginJson = @{ username = $Username; password = $Password } | ConvertTo-Json -Compress
try {
  # Kirim sebagai byte UTF-8; PS 5.1 meng-encode body string sebagai Latin-1.
  $login = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$Base/auth/login" `
    -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($loginJson))
} catch {
  Fail "login ($(Get-HttpError $_))"
}
if ("$($login.Content)" -notmatch '"token"\s*:\s*"([^"]*)"') { Fail 'token tidak ditemukan di respons login' }
$Token = $Matches[1]
if (-not $Token) { Fail 'token tidak ditemukan di respons login' }

$Headers = @{ Authorization = "Bearer $Token"; 'X-Active-Role' = $Role }

# --- 2. Periode -----------------------------------------------------------
# Tanpa -PeriodId: tampilkan daftar periode, pilih nomor (Enter = periode OPEN).
if (-not $PeriodId) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "$Base/periods" -Headers $Headers
  } catch {
    Fail "ambil daftar periode ($(Get-HttpError $_))"
  }
  $periods = @((ConvertFrom-Json $resp.Content).data |
    Sort-Object -Property @{ Expression = { [int]$_.year }; Descending = $true },
                          @{ Expression = { [int]$_.month }; Descending = $true })
  if ($periods.Count -eq 0) { Fail 'tidak ada periode' }

  $default = 0
  for ($i = 0; $i -lt $periods.Count; $i++) {
    if ($periods[$i].status -eq 'OPEN') { $default = $i; break }
  }

  Write-Host ''
  Write-Host 'Daftar periode:'
  for ($i = 0; $i -lt $periods.Count; $i++) {
    $p = $periods[$i]
    $mark = if ($i -eq $default) { '*' } else { ' ' }
    Write-Host ("{0} [{1,2}] period_id={2,-4} {3}-{4:D2}  {5,-6}  {6} s/d {7}" -f `
      $mark, ($i + 1), $p.period_id, $p.year, [int]$p.month, $p.status, $p.start_date, $p.end_date)
  }
  Write-Host ''

  while ($true) {
    $pick = Read-Host "Pilih nomor periode [Enter = $($default + 1)]"
    if (-not $pick) { $idx = $default; break }
    $num = 0
    if ([int]::TryParse($pick, [ref]$num) -and $num -ge 1 -and $num -le $periods.Count) { $idx = $num - 1; break }
    Write-Host "Nomor tidak valid, masukkan 1-$($periods.Count)."
  }
  $PeriodId = "$($periods[$idx].period_id)"
  Log "Periode dipilih: period_id=$PeriodId ($($periods[$idx].year)-$($periods[$idx].month), $($periods[$idx].status))"
}

# --- 3. Export ------------------------------------------------------------
$Url = "$Base/dashboard/layer-subperiod/export?period_id=$PeriodId"
$Tmp = [IO.Path]::GetTempFileName()
try {
  Log "Export: GET $Url (bisa beberapa menit)"
  try {
    $export = Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers $Headers `
      -TimeoutSec $ExportTimeout -OutFile $Tmp -PassThru
  } catch {
    Fail "export ($(Get-HttpError $_))"
  }

  $buf = New-Object byte[] 2
  $fs = [IO.File]::OpenRead($Tmp)
  try { $n = $fs.Read($buf, 0, 2) } finally { $fs.Close() }
  if ($n -lt 2 -or $buf[0] -ne 0x50 -or $buf[1] -ne 0x4B) { Fail 'respons export bukan file .xlsx' }

  # Header berupa string di PS 5.1, string[] di PS 7.
  $Name = ''
  $disposition = "$($export.Headers['Content-Disposition'])"
  if ($disposition -match 'filename="([^"]*)"') { $Name = [IO.Path]::GetFileName($Matches[1]) }
  if (-not $Name) { $Name = "layer1234_subperiode_$PeriodId.xlsx" }
  $Name = ($Name -replace '\.xlsx$', '') + "_$(Get-Date -Format 'yyyyMMdd-HHmm').xlsx"

  New-Item -ItemType Directory -Force -Path $Out | Out-Null
  $Dest = Join-Path $Out $Name
  Move-Item -Force -LiteralPath $Tmp -Destination $Dest
  Log "Tersimpan: $Dest ($((Get-Item -LiteralPath $Dest).Length) byte)"
} finally {
  if (Test-Path -LiteralPath $Tmp) { Remove-Item -Force -LiteralPath $Tmp }
}
