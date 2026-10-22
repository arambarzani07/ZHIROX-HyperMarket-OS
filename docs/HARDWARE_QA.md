# Windows Read-only Hardware QA — 0.26.0-dev.0

**Status: hardware discovery only, not hardware certification.** All source changes are on `feat/offline-foundation`. Existing supermarket `Admin.exe`, `Cashier.exe`, Windows SQL Server and attached printers remain **strictly read-only**. Neither printer jobs nor cash drawer pulses are sent.

## 1. Printer and device names (Windows only)
From an extracted **QA ZIP** on an authorized test Windows computer, in PowerShell:

```powershell
.\runtime\node.exe scripts\windows-preflight.mjs --strict
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows-device-inspect.ps1
```

The second command only enumerates installed Windows Print Queues using `Win32_Printer` and present generic PnP devices with HID/Keyboard/Ports/USB classes. It reports a local JSON object. **No test receipt is printed**, no software is installed, no device configuration changes, no SQL Server/legacy POS access and no restart or service stop. In some restricted Windows accounts, Windows blocks enumeration; a warning is reported rather than bypassing restrictions.

Printed names and port information may identify a device but do **not** prove the printer is attached, powered on, working, correctly configured for Sorani fonts, or has a compatible drawer pulse. Generic HID listings are only *possible input devices*, never confirmed barcode scanners or scales.

## 2. Keyboard-wedge scanner test — no database/network connection
Scanners that act like keyboards may be checked safely inside a QA-only command prompt using the bundled Node runtime:

```powershell
.\runtime\node.exe scripts\scanner-readonly.mjs
```

Scan a barcode then Enter. To finish type `STOP`. For one explicit test string:

```powershell
.\runtime\node.exe scripts\scanner-readonly.mjs --barcode 2700002029709
```

The tool preserves all leading zeros, rejects unexpected spaces/control characters, validates an EAN-13 checksum, and for the market's **27-prefix + 7-digit product code** scheme splits the known example into:

- Prefix: **27**
- Item code: **0000202**
- Opaque vendor-specific encoded digits: **970**
- EAN-13 check digit: **9**

**Critical limit:** three encoded digits are *not* sufficient to infer unit type, amount, scale precision or whether the code represents weight or price. Do **not** post stock or money from this read-only decoder. It deliberately returns `quantity:null`, `price:null`, `can_post_sale:false`. Exact unit/carton barcode lookups in the existing POS are left untouched.

To enable weighted-item selling later, collect actual label specifications (weight/price encoding, position and decimal scale), verified scale examples, measurement unit, rounding rules and expected POS stock deduction **before** any transactional integration.

## 3. Tests and acceptance

Windows GitHub Actions now runs peripheral inventory without printing or touching devices, as well as scale parser unit tests. A Windows GitHub runner is not the market's actual printer/scanner/drawer. On the market PC, only these non-mutating diagnostic commands are authorized by default; a test print, scale configuration, or drawer pulse needs a separate explicit approval.

Future QA with consent:
1. Observe scanner entries (keyboard HID vs COM/USB), confirm exact barcode including zeros.
2. Test Sorani RTL receipt on an isolated test printer.
3. Verify 27-prefix scale format with real labels and independently measured weights/prices.
4. Verify cash drawer pulse only using authorized, isolated test hardware.
5. Reconcile all device events against cash sale/stock transaction and real backup restore.

**No production merge, no automatic installer and no hardware-readiness claim until manual Windows device acceptance succeeds.**
