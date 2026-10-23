# Read-only Windows peripheral inventory. No test print, USB command, spool job,
# device restart, open-drawer pulse, serial-number collection or persistence.
# Windows PowerShell 5.1 and PowerShell 7 supported; output is local JSON only.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  Write-Error 'Windows is required'
  exit 1
}
$warnings = [System.Collections.Generic.List[string]]::new()
$printers = @()
$possibleInputDevices = @()
try {
  # Win32_Printer returns installed print queues, not proof that a printer is physically connected.
  $printers = @(Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop |
    Select-Object -First 100 |
    ForEach-Object {
      [ordered]@{
        name = [string]$_.Name
        driver = [string]$_.DriverName
        port = [string]$_.PortName
        default = [bool]$_.Default
        status = [string]$_.PrinterStatus
        physical_print_verified = $false
      }
    })
} catch {
  $warnings.Add('printer_enumeration_unavailable')
}
try {
  # A generic HID/keyboard listing is not proof of a barcode scanner or scale.
  if (Get-Command Get-PnpDevice -ErrorAction SilentlyContinue) {
    $possibleInputDevices = @(Get-PnpDevice -PresentOnly -ErrorAction Stop |
      Where-Object { $_.Class -in @('HIDClass','Keyboard','Ports','USB') } |
      Select-Object -First 100 |
      ForEach-Object {
        [ordered]@{
          name = [string]$_.FriendlyName
          device_class = [string]$_.Class
          status = [string]$_.Status
          confirmed_scanner = $false
          confirmed_scale = $false
        }
      })
  } else {
    $warnings.Add('pnp_listing_unavailable')
  }
} catch {
  $warnings.Add('pnp_enumeration_unavailable')
}
[ordered]@{
  schema = 1
  read_only = $true
  windows = $true
  source = 'Windows installed print queues and generic Plug-and-Play inventory'
  printer_queues = $printers
  possible_input_devices = $possibleInputDevices
  warnings = @($warnings.ToArray())
  printer_tested = $false
  scanner_tested = $false
  scale_tested = $false
  cash_drawer_tested = $false
  printed_pages = 0
  destructive_actions = 0
} | ConvertTo-Json -Depth 5
