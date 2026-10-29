# Windows version of tools/make-keystore.sh — creates the permanent HGI Billing release (upload) key ON YOUR PC.
# Needs a Java JDK 17+ (keytool). Run in PowerShell:   powershell -ExecutionPolicy Bypass -File tools\make-keystore.ps1
# KEEP hgi-release.jks AND THE PASSWORD SAFE (password manager + an offline copy). Without them you can never
# publish an update of the app on Google Play.
$ErrorActionPreference = 'Stop'
$out = if ($args.Count -gt 0) { $args[0] } else { 'hgi-release.jks' }
if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) { throw 'keytool not found — install a Java JDK 17+ (e.g. Eclipse Temurin) and reopen PowerShell' }
if (Test-Path $out) { throw "$out already exists — refusing to overwrite" }
$p1 = Read-Host 'Choose a keystore password (min 8 chars)' -AsSecureString
$p2 = Read-Host 'Repeat password' -AsSecureString
$pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
$pwb = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
if ($pw.Length -lt 8) { throw 'too short' }
if ($pw -ne $pwb) { throw 'passwords differ' }
keytool -genkeypair -keystore $out -storepass $pw -keypass $pw -alias hgi-release -keyalg RSA -keysize 4096 -validity 10000 `
  -dname 'CN=HARIGURU INDUSTRIES, O=HARIGURU INDUSTRIES, L=Ahmedabad, ST=Gujarat, C=IN' -noprompt
[IO.File]::WriteAllText("$out.base64.txt", [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $out))))
$list = keytool -list -v -keystore $out -storepass $pw -alias hgi-release
$sha256 = (($list | Select-String 'SHA256:') -split 'SHA256:\s*')[1].Trim()
$sha1 = (($list | Select-String 'SHA1:') -split 'SHA1:\s*')[1].Trim()
Write-Host ""
Write-Host "Created $out. Add these GitHub secrets (repo → Settings → Secrets and variables → Actions → Secrets):"
Write-Host "  ANDROID_KEYSTORE_BASE64   = contents of $out.base64.txt  (delete that .txt file afterwards)"
Write-Host "  ANDROID_KEYSTORE_PASSWORD = the password you chose"
Write-Host "  ANDROID_KEY_ALIAS         = hgi-release"
Write-Host "  ANDROID_KEY_PASSWORD      = the same password"
Write-Host ""
Write-Host "And this repository VARIABLE (… → Variables):  ANDROID_CERT_SHA256 = $sha256"
Write-Host ""
Write-Host "Google Cloud → Credentials → OAuth client (Android): package in.hariguru.billing, SHA-1 $sha1"
