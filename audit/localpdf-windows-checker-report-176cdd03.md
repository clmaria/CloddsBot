# CHECKER REPORT — LocalPDF PR #91
## SHA `176cdd03c998c58b80b77c5c70de958ebdd1c1ab`
**Branch:** `maker/localpdf-checker85-repairs-20261105`  
**Base:** `62ca54bc` (PR #84 — previous Checker verdict: CHANGES REQUIRED)  
**Checker session:** CloddsBot · 2026-11-06  
**Role:** Checker independiente (READ-ONLY sobre código de producción)

---

## A. IDENTIFICACIÓN DE EJECUCIÓN CI

### Push run para SHA `176cdd03`

| Campo | Valor |
|-------|-------|
| Run ID | `42121186651` |
| Evento | `push` |
| SHA confirmado | `176cdd03c998c58b80b77c5c70de958ebdd1c1ab` ✓ |
| Rama | `maker/localpdf-checker85-repairs-20261105` |
| PR | #91 |
| Iniciado | 2026-11-05 22:24:10 UTC |
| Terminado | 2026-11-05 22:25:34 UTC |

**Nota de Checker:** No se hereda ningún resultado CI de commits anteriores. Únicamente el run `42121186651` cubre el SHA auditado.

---

## B. RESULTADOS CI — Run #42121186651

### Job 1: `source-and-regression` (ubuntu-latest) — **SUCCESS**

| Paso | Resultado | Evidencia |
|------|-----------|-----------|
| `python scripts/source_binding_gate.py` | **PASS** | `{"status":"PASS","critical_file_count":330,"bound_file_count":364,"missing_critical_files":[],"stale_bound_files":[],"duplicate_bound_files":[]}` |
| Compilación Python + JS | **PASS** | `python -m compileall -q desktop app localpdf_v30 tests` sin errores |
| `tesseract --version` | **PASS** | `tesseract 5.3.4` instalado en job via `apt-get` |
| `openssl version` | **PASS** | `OpenSSL 3.0.13` disponible |
| 8 tests de `test_core.py` (incl. `test_real_pades_cms_is_preserved_by_ingress_and_blocks_pdf_rewriting` y `test_manual_region_redaction_ocr_negative_control_for_visible_vector_text`) | **PASS 8/8** | `........` sin fallos, 0 SKIP |
| Suite de regresión completa (otros 8 test files) | **PASS** con 1 SKIP | `s` = 1 skip esperado (guard de plataforma Windows) |

### Job 2: `native-windows` (windows-2022) — **FAILURE** ⚠️

| Paso | Resultado | Evidencia |
|------|-----------|-----------|
| Checkout SHA `176cdd03` | OK | `176cdd03c998c58b80b77c5c70de958ebdd1c1ab` verificado por git |
| `setup-python@3.11` | OK | CPython 3.11.9 |
| `./desktop/build_windows.ps1` | **FALLO** | `Exception: … build_windows.ps1:10 — throw 'Wrong branch; use PR #82 or detached exact HEAD.'` |
| Binario producido | **NO** | Ningún artefacto generado |
| Tests Windows (AppContainer, nonadmin, Unicode) | **NOT_RUN** | El build falló antes de ejecutarlos |

**Duración del job:** ~15 segundos (fallo inmediato en build, no timeout de 35 min).

---

## C. TESTS EJECUTADOS INDEPENDIENTEMENTE POR EL CHECKER

**Entorno Checker:** Linux x86_64, Python 3.13.18, pytest-9.0.2  
**SHA verificado:** `git rev-parse HEAD` = `176cdd03c998c58b80b77c5c70de958ebdd1c1ab` ✓  
**OpenSSL:** 3.0.13 ✓  **Tesseract:** NO disponible (no instalado en entorno Checker)

### C.1 — `python scripts/source_binding_gate.py`

```json
{
  "status": "PASS",
  "critical_file_count": 330,
  "bound_file_count": 364,
  "missing_critical_files": [],
  "stale_bound_files": [],
  "duplicate_bound_files": []
}
```

**Resultado:** **PASS** ✓

### C.2 — `test_real_pades_cms_is_preserved_by_ingress_and_blocks_pdf_rewriting`

**Resultado:** **PASS** ✓ (1.21 s)

**Qué verifica:**
- Genera firma CMS real con `sign_pades_b_b` + `_make_test_pkcs12()` usando OpenSSL
- Verifica `proof["cryptographic_integrity_verified"] is True` y `proof["current_revision_valid"] is True`
- En Linux: ejecuta el worker de ingesta directamente sobre el PDF firmado
- Confirma que el modo de ingesta es `"signed-byte-preserving"` y el hash de bytes se preserva
- Prueba 10 operaciones de reescritura (rotate, split, delete_pages, merge, bookmark, redact, visual_text_edit x2, reflow_box_edit x2) — todas denegadas con `ValueError("populated PDF signature")`
- Verifica que los bytes del PDF firmado no cambian tras cada denegación
- Verifica que `verify_pdf_signatures()["all_current_revision_valid"]` sigue siendo `True` al final

**Alcance de la firma:** Self-signed QA certificate, CMS real, NO es confianza CA/eIDAS.  
**Diferencia respecto a PR #84:** En PR #84 todos los fixtures de firma eran estructuras sintéticas (`/Sig`, `/ByteRange` construidos a mano sin CMS real). Esta prueba usa criptografía real.

### C.3 — `test_manual_region_redaction_ocr_negative_control_for_visible_vector_text`

**Resultado:** **NOT_TESTED** (SKIPPED — `requires independent Tesseract OCR`, `tests/test_core.py:987`)

**Razón:** Tesseract no está instalado en el entorno Checker. El test tiene `@pytest.mark.skipif(not shutil.which("tesseract"), ...)` que lo hace opcional. CI sí lo ejecutó (Tesseract instalado en el job) y pasó.

**Nota de Checker:** El skip es el comportamiento correcto declarado. No se declara FAIL por ausencia de Tesseract.

### C.4 — `tests/test_windows_pdf_worker_contract.py` (21 tests)

**Resultado:** **PASS 21/21** ✓ (0.17 s)

### C.5 — `tests/test_checker_p1_p2_regressions.py` + `tests/test_pdfium_thread_safety.py`

**Resultado:** **PASS** ✓

---

## D. MATRIZ DE VERIFICACIÓN DE INCIDENTES

### INC-001 — Windows 10/11 con cuenta de usuario estándar

| Campo | Estado |
|-------|--------|
| Estado | **ABIERTO / NOT_TESTED** |
| Script creado | Sí — `desktop/windows_client_nonadmin_acceptance.ps1` existe |
| Guards del script | Rechaza token Administrator elevado; rechaza miembro del grupo Administrators (SID S-1-5-32-544, incluso con UAC filtrado); requiere `InstallationType == 'Client'` y Windows 10+ build ≥ 10240; verifica SHA-256 del instalador y del EXE instalado; requiere flag explícito `-PermitFreshInstallAndUninstall` |
| Ejecutado en Windows Server 2022 (CI) | **NO** — el guard `InstallationType != 'Client'` rechazaría Server 2022 |
| Ejecutado en Windows 10/11 Client real | **NUNCA** |
| Binario disponible para instalar | **NO** — INC-002 impide producir el binario |

**Decisión:** INC-001 permanece ABIERTO. La existencia del script no sustituye evidencia de ejecución.

---

### INC-002 — Build script rechaza la rama Maker *(NUEVO)*

| Campo | Valor |
|-------|-------|
| Archivo | `desktop/build_windows.ps1:9-10` |
| Código | `$branch -notin @('integration/localpdf-beta-wordfirst-20261017', 'feature/windows-pdf-ingress-edit-p0-20261018')` |
| Error | `throw 'Wrong branch; use PR #82 or detached exact HEAD.'` |
| SHA afectado | `176cdd03` |
| Consecuencia | Binario no generado → Tests de AppContainer, nonadmin y Unicode: NOT_RUN |

**Reproducible:** Sí. La rama Maker no está en el allowlist. El test de CI reprodujo el fallo en run #42121186651.

**Acción requerida por Maker:** Añadir `maker/localpdf-checker85-repairs-20261105` al allowlist de ramas en `build_windows.ps1:9`, o usar estrategia de detached HEAD en el job `native-windows`.

---

### INC-003 — Tests Windows sin ejecutar debido a INC-002

Los siguientes tests de PR #91 **no han podido ejecutarse en ningún entorno** porque dependen del binario que INC-002 impide construir:

| Test | Archivo | Estado |
|------|---------|--------|
| Test de ruta Unicode/espacios en worker | `tests/test_windows_pdf_worker_contract.py` | Algunas variantes requieren EXE instalado |
| `LOCALPDF_STANDARD_USER_QA=1` mode | `tests/test_windows_pdf_worker_contract.py` | NOT_RUN (CI) |
| AppContainer acceptance probe | — | NOT_RUN |
| `windows_client_nonadmin_acceptance.ps1` | `desktop/` | NOT_RUN |

**Nota:** Los 21 tests de `test_windows_pdf_worker_contract.py` que el Checker ejecutó en Linux pasaron, pero las variantes nativas que requieren el EXE real no se pueden verificar sin el binario.

---

## E. RESUMEN DE RESULTADOS

| Categoría | PASS | FAIL | NOT_TESTED | Notas |
|-----------|------|------|------------|-------|
| Source binding gate | ✓ | — | — | 330 críticos, 364 bound |
| Firma CMS real (PAdES/CAdES) | ✓ | — | — | Criptografía real, no sintética |
| OCR control negativo | — | — | ✓ | Tesseract ausente en Checker |
| Regresiones P0 Linux | ✓ | — | — | 44+ tests core, suite completa |
| Worker contract (Linux) | ✓ | — | — | 21 tests |
| Build nativo Windows | — | ✗ | — | **INC-002**: branch guard |
| AppContainer sandbox | — | — | ✓ | Binario no producido |
| Standard user Windows 10/11 | — | — | ✓ | **INC-001**: sin evidencia real |
| Unicode/espacios en EXE | — | — | ✓ | Binario no producido |

---

## F. FALLOS REPRODUCIBLES PARA MAKER

### FALLO-1 (INC-002) — Prioridad ALTA

**Archivo:** `desktop/build_windows.ps1`, línea 9  
**Reproducción:** `gh run view 42121186651 -R clmaria/LocalPDF --log-failed` → ver `build_windows.ps1:10`  
**Descripción:** El guard de rama solo permite `integration/localpdf-beta-wordfirst-20261017` y `feature/windows-pdf-ingress-edit-p0-20261018`. La rama `maker/localpdf-checker85-repairs-20261105` no está en la lista y el build falla inmediatamente.  
**Fix mínimo:** Añadir la rama Maker al array en línea 9, o hacer que CI use `git checkout --detach HEAD` antes de llamar al script (detached HEAD satisface la condición `$branch == ""`).

```diff
-if ($LASTEXITCODE -ne 0 -or ($branch -and $branch -notin @('integration/localpdf-beta-wordfirst-20261017', 'feature/windows-pdf-ingress-edit-p0-20261018'))) {
+if ($LASTEXITCODE -ne 0 -or ($branch -and $branch -notin @('integration/localpdf-beta-wordfirst-20261017', 'feature/windows-pdf-ingress-edit-p0-20261018', 'maker/localpdf-checker85-repairs-20261105'))) {
```

**Impacto si no se corrige:** Todos los tests Windows específicos de PR #91 permanecen NOT_RUN. INC-001 no puede cerrarse.

---

### NOTA-1 (INC-001) — Pendiente de hardware

**Descripción:** Incluso si se corrige INC-002 y el binario se produce, INC-001 requiere ejecución manual del script `desktop/windows_client_nonadmin_acceptance.ps1` en un equipo **Windows 10/11 Client físico o de VM** con cuenta estándar real (no Administrator, no miembro de Administrators aunque con UAC activo, no Windows Server).  
**Acción:** Ejecutar el script con los parámetros correctos y entregar el archivo `EvidencePath` al Checker para su verificación.

---

## G. VEREDICTO

**Estado de PR #91:** **CHANGES REQUIRED** (mismos que PR #84, más INC-002 nuevo)

| INC | Descripción | Estado |
|-----|-------------|--------|
| INC-001 | Windows 10/11 standard-user acceptance | **ABIERTO** |
| INC-002 | `build_windows.ps1` branch guard rechaza rama Maker | **NUEVO / ABIERTO** |
| INC-003 | Tests Windows dependientes del binario | **BLOQUEADOS por INC-002** |

**Lo que PR #91 ha avanzado (reconocido sin cambiar el veredicto):**
- Firma CMS real con OpenSSL — probado y funcional en Linux ✓
- Guard de ingesta byte-preserving para PDFs firmados — funciona con firmas reales ✓
- Tesseract provisioned en CI con test de control negativo OCR (PASS en CI) ✓
- Script de aceptación `windows_client_nonadmin_acceptance.ps1` con guards sólidos ✓
- Suite de regresión P1/P2 completa pasa sin modificar código de producción ✓

**Lo que falta antes de que el Checker pueda aprobar:**
1. Corregir `build_windows.ps1` (INC-002) → producir binario Windows desde la rama Maker
2. Ejecutar y entregar evidencia del script `windows_client_nonadmin_acceptance.ps1` en Windows 10/11 Client estándar real (INC-001)

**El Checker NO aprueba ni fusiona esta PR.**

---

*Checker independiente: CloddsBot*  
*Fecha: 2026-11-06*  
*SHA auditado: 176cdd03c998c58b80b77c5c70de958ebdd1c1ab*  
*Run CI verificado: #42121186651*
