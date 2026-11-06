# CHECKER REPORT — LocalPDF PR #94
## SHA `4a8c884e729c4e403f965083499faa437ed00236`
**Branch:** `integration/localpdf-windows-editor-translate-20261106`  
**Base:** PR #91 (`maker/localpdf-checker85-repairs-20261105`)  
**Checker session:** CloddsBot · 2026-11-06  
**Role:** Checker independiente (READ-ONLY sobre código de producción)

---

## A. IDENTIFICACIÓN DE EJECUCIÓN CI

### Push run para SHA `4a8c884e`

| Campo | Valor |
|-------|-------|
| Workflow principal | `localpdf-combined-editor-translation-hold.yml` |
| Run ID (push) | `42267196344` |
| Run ID (PR event) | `42267205296` |
| Evento | `push` + `pull_request` |
| SHA confirmado | `4a8c884e729c4e403f965083499faa437ed00236` ✓ |
| Rama | `integration/localpdf-windows-editor-translate-20261106` |
| PR | #94 |
| Iniciado | 2026-11-06T18:03:21 UTC |
| Terminado | 2026-11-06T18:09:06 UTC |

**Workflows ejecutados para SHA `4a8c884e`:**

| Workflow | Run ID (push) | Resultado |
|----------|---------------|-----------|
| `localpdf-combined-editor-translation-hold.yml` | 42267196344 | **SUCCESS** |
| `localpdf-native-editor-spike.yml` | 42267205557 | **FAILURE** |
| `localpdf-real-editor-text-roundtrip.yml` | 42267195748 | SUCCESS |
| `localpdf-real-upstream-editor-smoke.yml` | 42267194823 | SUCCESS |
| `localpdf-offline-translation-spike.yml` | 42267205949 | SUCCESS |

**Nota de Checker:** El único run con FAILURE es el workflow `localpdf-native-editor-spike.yml` (marcado HOLD, experimental). Ver INC-003.

---

## B. RESULTADOS CI — Workflow principal: `localpdf-combined-editor-translation-hold.yml` (run #42267196344)

### Job 1: `Combined source, PDF editor, translation and checker repair (Linux)` — **SUCCESS**

| Paso | Resultado | Evidencia |
|------|-----------|-----------|
| `source_binding_gate.py` | **PASS** | `{"status":"PASS","critical_file_count":350,"bound_file_count":386,"missing_critical_files":[],"stale_bound_files":[],"duplicate_bound_files":[]}` |
| Compilación Python + JS | **PASS** | Sin errores |
| New feature tests (external editor, translation, combined, frozen QA) | **PASS 17/17** (3 SKIP por plataforma) | `......ss.s.........` |
| Regressions P1/P2 + Windows worker contract | **PASS 82/82** | `...........` sin fallos |
| JS UI contracts | **PASS** | `PASS native advanced edit compare/Save As + reload-safe session identity` + `PASS local UI selected block → offline translation → manual replacement; stale context cleared` |

**Nota:** El step "Python unit/integration contracts" ejecutó únicamente las nuevas suites de test + regressions checker. No ejecuta `test_core.py` (ver NOTA-1).

### Job 2: `Integrated frozen Windows candidate + installed acceptance (NOT RELEASE)` — **SUCCESS**

| Paso | Resultado | Evidencia |
|------|-----------|-----------|
| Verificación SHA y detach HEAD | PASS | SHA `4a8c884e` verificado, branch guard pasado en detached HEAD |
| `build_windows.ps1` (AppContainer + source binding) | **PASS** | EXE producido, AppContainer probe PASS |
| Frozen NativeBridge external edit return (AppContainer) | **PASS** | — |
| GUI acceptance dependencies (pywinauto) | PASS | — |
| **Installed desktop GUI and external PDF ingress acceptance** (`windows_install_cycle_smoke.ps1`) | **PASS** | Instalación silenciosa, GUI, Word HTTP, PDF import, browser click, native dialog, desinstalación: todos PASS |
| New feature Windows contracts | PASS | — |

---

## C. RESULTADOS CI — Workflow spike: `localpdf-native-editor-spike.yml` (run #42267205557) — FAILURE

| Job | Runner | Resultado |
|-----|--------|-----------|
| Experimental native editor contract (ubuntu) | ubuntu-latest | SUCCESS |
| Experimental native editor contract (windows) | windows-2022 | SUCCESS |
| Third-party pinned real text/image engine tests | windows-2022 | SUCCESS |
| **Build Windows installer candidate, never release** | windows-2022 | **FAILURE** |

**Fallo exacto** (Job #128062601662, step 7 `windows_install_cycle_smoke.ps1`):

```
Windows installed GUI evidence: ...\LocalPDF-Windows-installed-gui.json
Windows CI installed-cycle evidence: ...\LocalPDF-Windows-installed-cycle.json (FAIL)
Exception: ...\desktop\windows_install_cycle_smoke.ps1:166
  Native installed cycle failed: Install or GUI: LocalPDF GUI process did not terminate after closing the window.
```

**Origen del error:** `windows_installed_gui_smoke.ps1:67` — `CloseMainWindow()` enviado, proceso no exitó en 15 segundos (`WaitForExit(15000)`).

**Observación crítica:** El MISMO script `windows_install_cycle_smoke.ps1` corriendo sobre el MISMO SHA `4a8c884e` **pasó** en el Job 2 del workflow integrado (run #42267196344) y **falló** en el spike workflow. El build fue exitoso y el artefacto fue subido (48 MB, ID #13528331180). Este comportamiento es indicativo de fallo flaky por timing en CI runner bajo carga compartida.

**Ver INC-003 para clasificación y acción requerida.**

---

## D. TESTS EJECUTADOS INDEPENDIENTEMENTE POR EL CHECKER

**Entorno Checker:** Linux x86_64, Python 3.13.18, pytest-9.0.2  
**SHA verificado:** `git rev-parse HEAD` = `4a8c884e729c4e403f965083499faa437ed00236` ✓  
**OpenSSL:** disponible ✓  **Tesseract:** NO disponible (no instalado en entorno Checker)

### D.1 — `python scripts/source_binding_gate.py`

```json
{
  "status": "PASS",
  "critical_file_count": 350,
  "bound_file_count": 386,
  "missing_critical_files": [],
  "stale_bound_files": [],
  "duplicate_bound_files": []
}
```

**Resultado:** **PASS** ✓

### D.2 — `test_real_pades_cms_is_preserved_by_ingress_and_blocks_pdf_rewriting`

**Resultado:** **PASS** ✓ (1.01 s)

Verificación idéntica a PR #91. Firma CMS real con OpenSSL, 10 operaciones de reescritura denegadas, bytes del PDF firmado intactos al finalizar.

### D.3 — `test_manual_region_redaction_ocr_negative_control_for_visible_vector_text`

**Resultado:** **SKIPPED** (Tesseract ausente en entorno Checker) — comportamiento correcto declarado ✓

### D.4 — Nuevas suites de PR #94

| Suite | Resultado | Tests |
|-------|-----------|-------|
| `test_external_pdf_editor.py` | **PASS 7, SKIP 3** | 3 SKIP por `sys.platform != "win32"` (guard correcto) |
| `test_local_translation.py` | **PASS 5** | — |
| `test_combined_pdf_editor_translation.py` | **PASS 2** | — |

**Total nuevas suites:** 14 PASS, 3 SKIP ✓

### D.5 — `test_checker_p1_p2_regressions.py` + `test_windows_pdf_worker_contract.py`

**Resultado:** **PASS 82/82** ✓ (1.13 s)

### D.6 — `test_safe_share_also_sanitizes_active_content` (pre-existing finding)

**Resultado:** **FAIL** con `ValueError: Tesseract is required for independent OCR verification` (`app/core.py:831`)

**Análisis de preexistencia:**
- El test existe en `tests/test_core.py:443` desde antes de PR #94 (presente en commit más antiguo disponible `fddb391`)
- `git diff fddb391 4a8c884 -- tests/test_core.py` = vacío (test no modificado en PR #94)
- El test llama `privacy_scan(item, include_values=False, deep_ocr=True)` → `_ocr_text_for_pages` → falla sin Tesseract
- El test carece de `@pytest.mark.skipif(not shutil.which("tesseract"), ...)` a diferencia de otros tests OCR en la misma suite
- **El fallo es PRE-EXISTENTE, no introducido por PR #94**
- CI no ejecuta `test_core.py` para esta rama de integración (sólo las suites específicas de las nuevas funcionalidades + checker regressions)

**Acción necesaria:** Añadir guard de Tesseract a `test_safe_share_also_sanitizes_active_content` (pre-existente, fuera del scope de PR #94)

---

## E. VERIFICACIÓN DE CÓDIGO DE SEGURIDAD (READ-ONLY)

### E.1 — Código de producción no modificado

Los siguientes archivos de seguridad críticos **NO fueron modificados** por PR #94:

| Archivo | Cambio en PR #94 |
|---------|------------------|
| `app/core.py` | NO |
| `app/pdf_ingest_worker.py` | NO |
| `app/pdfium_guard.py` | NO |
| `app/windows_pdf_sandbox.py` | NO |
| `app/main.py` | NO |

**Verificado por:** `git diff fddb391 4a8c884 -- app/core.py app/pdf_ingest_worker.py app/pdfium_guard.py app/windows_pdf_sandbox.py app/main.py` = vacío

### E.2 — `app/local_translation.py` (nuevo, 120 líneas)

- Cabecera: `"No network APIs, model downloads, credentials, PDF mutations or persistent text."`
- `"network_requests": False, "automatic_model_downloads": False` en metadata devuelto
- Únicamente uso de inferencia local instalada; sin llamadas a APIs remotas

**Verificación Checker:** Confirmado — sin dependencias de red visibles en el código

### E.3 — `desktop/external_pdf_editor.py` (nuevo, 122 líneas)

- Abre COPIA staged (nunca el original)
- Verifica `original_digest` SHA-256 antes y después
- El caller debe usar `store.add_untrusted_bytes`, NO escritura directa en store
- PDFs firmados rechazados antes del staging

**Verificación Checker:** Modelo de confianza correcto ✓

### E.4 — `build_windows.ps1` — INC-002 de PR #91 RESUELTO

```powershell
# CI usa detached HEAD (git checkout --detach HEAD antes de llamar al script)
# La rama Maker está ahora en el allowlist
if ($LASTEXITCODE -ne 0 -or ($branch -and $branch -notin @(
    'integration/localpdf-beta-wordfirst-20261017',
    'feature/windows-pdf-ingress-edit-p0-20261018',
    'maker/localpdf-checker85-repairs-20261105'))) {
    throw 'Wrong branch; use PR #82, P0 Windows, scoped Maker #85 or detached exact HEAD.'
}
```

CI confirmó que el build se ejecutó con detached HEAD (step "Detach exact checked-out HEAD to preserve guarded branch allowlist": PASS) → branch guard pasado → EXE producido.

---

## F. MATRIZ DE VERIFICACIÓN DE INCIDENTES

### INC-001 — Windows 10/11 con cuenta de usuario estándar

| Campo | Estado |
|-------|--------|
| Estado | **ABIERTO / NOT_TESTED** |
| Script | `desktop/windows_client_nonadmin_acceptance.ps1` — sin cambios en PR #94 |
| Ejecutado en Windows 10/11 Client real | **NUNCA** |
| Binario disponible | Sí (artefacto CI subido) |

**Decisión:** INC-001 permanece ABIERTO. PR #94 no aporta evidencia de Windows 10/11 Client estándar.

---

### INC-002 — Build script rechazaba la rama Maker *(de PR #91)*

| Campo | Estado |
|-------|--------|
| Estado | **RESUELTO** ✓ |
| Corrección | CI usa `git checkout --detach HEAD` antes de `build_windows.ps1`; rama Maker añadida al allowlist |
| Evidencia | Step "Detach exact checked-out HEAD" PASS en run #42267196344 job 2; EXE producido |

---

### INC-003 — GUI process no termina en smoke test del workflow spike *(NUEVO)*

| Campo | Valor |
|-------|-------|
| Archivo | `desktop/windows_installed_gui_smoke.ps1:67` |
| Error | `'LocalPDF GUI process did not terminate after closing the window.'` |
| Código | `if (-not $primary.WaitForExit(15000)) { throw ... }` |
| Workflow afectado | `localpdf-native-editor-spike.yml` (HOLD, experimental) |
| Workflow integrado | `localpdf-combined-editor-translation-hold.yml` — MISMO script, MISMO SHA — **PASS** |
| Reproducible | FLAKY — no determinista entre runners. Podría deberse a carga del runner o a startup time incrementado por las nuevas funcionalidades |
| Binario producido | Sí — el build completó antes del smoke test; artefacto subido (48 MB) |

**Clasificación:** El workflow spike está marcado HOLD/experimental. El workflow integrado (que es el candidato real) pasó el mismo test. Sin embargo, el fallo en el spike debe ser investigado y reproducirse consistentemente o descartarse con evidencia de estabilidad.

**Acción requerida por Maker:**
1. Investigar por qué el GUI process no termina en 15 segundos bajo carga de runner compartida
2. Reproducir o descartar (re-run del spike workflow para verificar si es flaky)
3. Documentar si el timeout de 15 segundos necesita ajuste para los nuevos módulos (external editor + translation)

---

### NOTA-1 — `test_safe_share_also_sanitizes_active_content` sin guard de Tesseract *(pre-existente)*

| Campo | Estado |
|-------|--------|
| Estado | **PRE-EXISTENTE** (no introducido por PR #94) |
| Archivo | `tests/test_core.py:443` |
| Fallo | `ValueError: Tesseract is required for independent OCR verification` sin Tesseract |
| Introducido en PR #94 | **NO** — test no modificado (git diff vacío) |
| CI ejecuta este test | **NO** — `test_core.py` no incluido en las suites de esta rama de integración |

**Recomendación:** Añadir `@pytest.mark.skipif(not shutil.which("tesseract"), reason="requires Tesseract")` al test, en una PR separada. No bloquea PR #94.

---

## G. RESUMEN DE RESULTADOS

| Categoría | PASS | FAIL | NOT_TESTED | Notas |
|-----------|------|------|------------|-------|
| Source binding gate | ✓ | — | — | 350 críticos, 386 bound |
| Firma CMS real (PAdES) | ✓ | — | — | Criptografía real, OpenSSL |
| OCR control negativo | — | — | ✓ | Tesseract ausente en Checker (SKIP correcto) |
| Regressions P1/P2 Linux | ✓ | — | — | 82 tests |
| Worker contract (Linux) | ✓ | — | — | 21 tests (en P1/P2) |
| Nuevas suites (editor, translation) | ✓ | — | — | 14 PASS, 3 SKIP (Windows guards) |
| INC-002 build branch guard | ✓ **RESUELTO** | — | — | Detached HEAD + Maker branch añadida |
| Build nativo Windows | ✓ | — | — | EXE producido en CI integrado |
| GUI smoke (integrado) | ✓ | — | — | `windows_install_cycle_smoke.ps1` PASS |
| GUI smoke (spike workflow) | — | ✗ | — | **INC-003**: timeout flaky |
| AppContainer sandbox | ✓ | — | — | Frozen probe PASS en CI |
| Standard user Windows 10/11 | — | — | ✓ | **INC-001**: sin evidencia real |
| `test_safe_share_also_sanitizes_active_content` | — | ✗ | — | **NOTA-1**: pre-existente, sin Tesseract guard |

---

## H. FALLOS REPRODUCIBLES PARA MAKER

### FALLO-1 (INC-003) — Prioridad MEDIA (workflow HOLD/experimental)

**Archivo:** `desktop/windows_installed_gui_smoke.ps1`, línea 67  
**Reproducción:** `gh run view 42267205557 -R clmaria/LocalPDF --log-failed`  
**Descripción:** El proceso GUI no termina en 15 segundos tras `CloseMainWindow()`. El mismo test pasa en el workflow integrado (run #42267196344). Comportamiento flaky en CI runner bajo carga.  
**Fix sugerido:** Incrementar el timeout de `WaitForExit(15000)` o añadir retry de close, o investigar si los nuevos módulos (external editor, translation) incrementan el shutdown time.

---

### NOTA-1 (pre-existente) — Prioridad BAJA

**Archivo:** `tests/test_core.py:443`  
**Descripción:** `test_safe_share_also_sanitizes_active_content` falla sin Tesseract (pre-existente, no introducido en PR #94)  
**Fix sugerido:** Añadir `@pytest.mark.skipif(not shutil.which("tesseract"), reason="requires Tesseract")` en PR separada.

---

### NOTA-2 (INC-001) — Sin hardware disponible

**Acción:** Ejecutar `desktop/windows_client_nonadmin_acceptance.ps1` en Windows 10/11 Client físico/VM con cuenta estándar y entregar evidencia al Checker.

---

## I. VEREDICTO

**Estado de PR #94:** **CHANGES REQUIRED**

| INC | Descripción | Estado |
|-----|-------------|--------|
| INC-001 | Windows 10/11 standard-user acceptance | **ABIERTO** (sin evidencia de hardware real) |
| INC-002 | `build_windows.ps1` branch guard rechazaba Maker | **RESUELTO** ✓ |
| INC-003 | GUI process no termina en spike workflow | **NUEVO / ABIERTO** (flaky CI, workflow HOLD) |
| NOTA-1 | `test_safe_share_also_sanitizes_active_content` sin Tesseract guard | **PRE-EXISTENTE** (fuera de scope PR #94) |

**Lo que PR #94 ha avanzado (reconocido sin cambiar el veredicto):**
- INC-002 de PR #91 correctamente resuelto (detached HEAD en CI + Maker branch en allowlist) ✓
- EXE Windows producido exitosamente en CI integrado ✓
- `app/local_translation.py`: traducción offline sin llamadas de red ✓
- `desktop/external_pdf_editor.py`: modelo de confianza correcto (staged copy, digest check, `add_untrusted_bytes`) ✓
- 14 nuevos tests de las nuevas funcionalidades pasan ✓
- `windows_install_cycle_smoke.ps1` pasa en el workflow integrado ✓
- Código de producción de seguridad (core, ingest, pdfium, sandbox) sin cambios ✓

**Lo que falta antes de que el Checker pueda aprobar:**
1. Resolver INC-003: investigar y reproducir o descartar consistentemente el GUI timeout flaky en el spike workflow
2. Resolver INC-001: evidencia de `windows_client_nonadmin_acceptance.ps1` en Windows 10/11 Client estándar real

**El Checker NO aprueba ni fusiona esta PR.**

---

*Checker independiente: CloddsBot*  
*Fecha: 2026-11-06*  
*SHA auditado: 4a8c884e729c4e403f965083499faa437ed00236*  
*Runs CI verificados: #42267196344 (integrado, push), #42267205557 (spike, FAILURE)*
