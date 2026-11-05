# INFORME MAESTRO DE AUDITORÍA INDEPENDIENTE — LocalPDF Windows P0
**Checker:** Claude Sonnet 4.6 (CloddsBot session)  
**Fecha:** 2026-11-05  
**SHA auditado:** `62ca54bc73b294bc482dd1501dc0cef6808e8e9a`  
**Rama:** `feature/windows-pdf-ingress-edit-p0-20261018`  
**PR:** #84 — clmaria/LocalPDF  
**Hilo de auditoría previo:** Issue #85  
**Ejecución CI de referencia:** actions/runs/39204580388  
**Rol:** Checker independiente — READ-ONLY. Sin modificaciones de código. Sin fusiones. Sin releases.

---

## SECCIÓN A — Estado del SHA y CI

### A.1 Verificación del SHA

```
SHA auditado (referencia):  62ca54bc73b294bc482dd1501dc0cef6808e8e9a
SHA confirmado (FETCH_HEAD): 62ca54bc73b294bc482dd1501dc0cef6808e8e9a  ✓
```

Procedimiento: clone fresh del repositorio `clmaria/LocalPDF` con depth=1 sobre la rama principal; luego `git fetch --depth=50 origin feature/windows-pdf-ingress-edit-p0-20261018` y comprobación de FETCH_HEAD. El SHA coincide exactamente con la referencia del encargo.

### A.2 Estado de los checks de CI (run #39204580388)

| Job | Runner | Estado | Duración |
|-----|--------|--------|----------|
| `source-and-regression` | ubuntu-latest | **SUCCESS** ✓ | ~12 min |
| `native-windows` | windows-2022 | **SUCCESS** ✓ | ~31 min |
| Kody (code review bot) | — | SKIPPED | — |

**CI: 2/2 SUCCESS para el SHA `62ca54bc`.**

---

## SECCIÓN B — Matriz de Auditoría de Seguridad

### B.1 Bloqueo de PDFs firmados (AppContainer + core)

| ID | Control | Resultado | Evidencia |
|----|---------|-----------|-----------|
| B-01 | `_contains_pdf_signature` detecta firma `/Sig` en campo AcroForm | PASS | `pdf_ingest_worker.py:71` — recorre `/Kids` con límite 10 000 nodos, hereda `/FT=/Sig`, comprueba `/V` con `/ByteRange` |
| B-02 | `_contains_pdf_signature` detecta `/Perms` en catálogo | PASS | `pdf_ingest_worker.py:71` — comprueba `reader.trailer["/Root"]["/Perms"]` |
| B-03 | Protección es estructural, NO criptográfica | LIMITACIÓN CONOCIDA | Synthetic signatures only — ver INC-002 |
| B-04 | `_reject_rewrite_of_signed_pdf` bloquea todos los editores | PASS | `core.py:2020` — llamado desde `_write_pdf` para todos los padres |
| B-05 | `_write_pdf` es la última valla antes de serializar | PASS | `core.py:434` — `for parent_id in dict.fromkeys(parents): _reject_rewrite_of_signed_pdf(...)` precede a `PdfWriter.write` |
| B-06 | `visual_text_edit` llama al guard antes de editar | PASS | `core.py:1870` — guard invocado antes de cualquier modificación |
| B-07 | `reflow_box_edit` llama al guard antes de editar | PASS | `core.py:3424` — mismo patrón |
| B-08 | Test `test_signed_pdf_blocks_all_rewrite_editors_and_preserves_source` | PASS (CI) | `tests/test_core.py:513` — firma real + sintética; redact/visual_text_edit/reflow_box_edit lanzan ValueError; bytes fuente sin cambios |
| B-09 | Test `test_pdf_writer_sink_blocks_signed_page_operations` | PASS (CI) | `tests/test_core.py:624` — rotate/split/delete/merge bloqueados por el sink |

### B.2 Redacción irreversible y eliminación de metadatos

| ID | Control | Resultado | Evidencia |
|----|---------|-----------|-----------|
| B-10 | `_redact_regions_raster` rasteriza páginas tocadas a 220 DPI | PASS | `core.py:646` — `pypdfium2` → PIL → página quemada |
| B-11 | DocumentInfo nunca copiado en la salida redactada | PASS | `core.py` — no hay llamada a `clone_document_info` en rutas de redacción |
| B-12 | XMP de páginas no tocadas eliminado (`/Metadata` excluido) | PASS | `core.py` — `excluded_keys=["/Metadata"]` en páginas sin rasterizar |
| B-13 | Postcondición fail-closed: texto no debe aparecer tras redacción | PASS (CI) | `test_region_redaction_drops_confidential_source_document_info` y `test_region_redaction_drops_unmodified_page_private_xmp_without_rasterizing_it` |
| B-14 | Redacción en modo destructivo con `visual_text_edit` elimina DocumentInfo | PASS (CI) | `test_destructive_text_replace_drops_sensitive_document_info_but_overlay_keeps_it` |
| B-15 | `reflow_box_edit` destructivo elimina DocumentInfo y XMP | PASS (CI) | `test_destructive_box_reflow_clears_private_info_and_untouched_page_xmp` |
| B-16 | Verificación de texto residual post-redacción por OCR | **FALTA** | Ver INC-003 — solo se extrae texto via pypdfium2, no se aplica OCR visual |

### B.3 Bloqueo de contenido activo PDF

| ID | Control | Resultado | Evidencia |
|----|---------|-----------|-----------|
| B-17 | `_reject_active_pdf_content` bloquea `/OpenAction` | PASS | `pdf_ingest_worker.py:14` |
| B-18 | Bloquea `/JavaScript` a nivel de documento y anotación | PASS | `pdf_ingest_worker.py:14` — bloquea `/JS` en `/Names`, anotaciones `/Type=/Action /S=/JavaScript` |
| B-19 | Bloquea `/EmbeddedFiles` | PASS | `pdf_ingest_worker.py:14` |
| B-20 | Bloquea XFA | PASS | `pdf_ingest_worker.py:14` — `/XFA` en `/AcroForm` |
| B-21 | Mantiene campos AcroForm pasivos | PASS | El allowlist permite `/AcroForm` sin acciones |
| B-22 | Bloquea `/GoToR` (remote goto) | PASS | `pdf_ingest_worker.py:14` |
| B-23 | Bloquea URI de tipo file:// en anotaciones | PASS | `pdf_ingest_worker.py:14` |

### B.4 AppContainer y Sandbox

| ID | Control | Resultado | Evidencia |
|----|---------|-----------|-----------|
| B-24 | AppContainer SID sin capacidades | PASS | `desktop/windows_pdf_sandbox.py` — `CreateAppContainerProfile` + `SECURITY_CAPABILITIES` con capacidades vacías |
| B-25 | Workspace con Low Integrity Level | PASS | `icacls.exe /setintegritylevel (OI)(CI)L` |
| B-26 | Job Object con `KILL_ON_JOB_CLOSE` | PASS | `desktop/windows_pdf_sandbox.py` — JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
| B-27 | Límite de memoria: 768 MB | PASS | `desktop/windows_pdf_sandbox.py` — PROCESS_MEMORY_LIMIT |
| B-28 | Canarios: archivo denegado + loopback denegado | PASS | El worker comprueba que no puede acceder al archivo canario ni a 127.0.0.1 antes de continuar |
| B-29 | `IsAppContainer` token check en el worker | PASS | `pdf_ingest_worker.py:118` — `GetTokenInformation(TokenIsAppContainer)` |
| B-30 | Windows 10/11 usuario estándar (no admin) testado | **NO TESTADO** | Ver INC-001 — CI corre en windows-2022 sin restricción de privilegios de usuario |

### B.5 Thread-safety PDFium

| ID | Control | Resultado | Evidencia |
|----|---------|-----------|-----------|
| B-31 | `RLock` compartido serializa todas las llamadas PDFium | PASS | `app/pdfium_guard.py` — `_pdfium_process_lock = RLock()` |
| B-32 | Re-entrante para evitar deadlock entre helpers | PASS | `RLock` (no `Lock`) permite recursión desde el mismo hilo |
| B-33 | Todos los entry points de PDFium decorados con `@serialized_pdfium` | PASS (CI) | `test_all_pypdfium_entry_points_use_one_guard` — introspección confirma `__wrapped__` y `_pdfium_process_lock` |
| B-34 | Test concurrente real: 6 hilos, 12 renders, `maximum == 1` | PASS (CI) | `test_real_pdfium_preview_concurrency_has_shared_process_mutex` |

### B.6 Source Binding Gate

| ID | Control | Resultado | Evidencia |
|----|---------|-----------|-----------|
| B-35 | `scripts/source_binding_gate.py` verifica inventario de archivos críticos | PASS (CI) | Ejecutado en `source-and-regression` job |
| B-36 | `tests/test_pdfium_thread_safety.py` incluido en el inventario | PASS | El gate lo incluye según el comentario de CI: "Source inventory now includes real 6-thread PDFium overlap regression" |

---

## SECCIÓN C — Incidentes

### INC-001 — CRÍTICO: Windows 10/11 usuario estándar no testado

**Severidad:** CRÍTICA  
**Área:** AppContainer / Windows security  
**Descripción:** El CI nativo corre en `windows-2022` sin restricción de privilegios. No hay evidencia de que el flujo completo (instalación, ingreso PDF, AppContainer, canarios, edición, Save As) funcione cuando el usuario Windows no tiene privilegios de administrador.

**Riesgo:** `CreateAppContainerProfile` requiere permisos específicos. En instalaciones per-user de Inno Setup sobre Windows 10 Home con cuentas estándar, la creación del perfil AppContainer puede fallar silenciosamente o no activar el sandbox, dejando el worker en un proceso no confinado.

**Evidencia de ausencia:** No hay test fixture con `runas /lowintegrity` ni llamada a `IsUserAnAdmin()` en el instalador. El script `windows_install_cycle_smoke.ps1` no restringe el token del proceso de test.

**Remediación requerida:** Añadir un step en el CI nativo que cree un usuario Windows estándar temporal, ejecute la instalación y el flujo PDF bajo ese token, y verifique la salida de `IsAppContainer`.

---

### INC-002 — CRÍTICO: Firma PAdES real nunca verificada

**Severidad:** CRÍTICA  
**Área:** Bloqueo de PDFs firmados  
**Descripción:** Todos los tests de firma (`test_signed_pdf_blocks_all_rewrite_editors_and_preserves_source`, `test_pdf_writer_sink_blocks_signed_page_operations`) utilizan estructuras sintéticas (creadas con pypdf sin certificado real) o firmas mínimas sin cadena de confianza. No hay test con un PDF firmado por una CA reconocida (p.ej. un PDF/A firmado con eIDAS o un testamento notarial).

**Riesgo:** Un PDF firmado con una estructura PAdES compleja (múltiples `/ByteRange` entries, timestamp tokens, OCSP responses en `/DSS`) podría escapar a la detección si `_contains_pdf_signature` no recorre correctamente la jerarquía del diccionario.

**Evidencia de ausencia:** `pdf_ingest_worker.py:71` — el detector comprueba `"/ByteRange"` en `/V` pero no valida la firma criptográficamente. Los tests de `test_core.py` confirman que las firmas sintéticas son bloqueadas; no hay test de fixture real.

**Limitación reconocida en la especificación:** La especificación del Maker reconoce explícitamente esta limitación ("Las firmas sintéticas no sustituyen pruebas criptográficas reales"). Sin embargo, para un PASS en Checker, se requiere al menos un PDF de fixture PAdES real de acceso público (p.ej. de los repositorios de test de ETSI).

**Remediación requerida:** Añadir a `tests/fixtures/` al menos un PDF firmado con certificado PAdES/CAdES de test (fixtures públicos disponibles en los repositorios de test de DSS/ETSI). Actualizar `test_core.py` para incluir ese fixture.

---

### INC-003 — ALTO: Verificación OCR de texto residual post-redacción ausente

**Severidad:** ALTA  
**Área:** Redacción irreversible  
**Descripción:** Después de `_redact_regions_raster`, la verificación postcondición extrae texto via `pypdfium2` (texto embebido en el PDF). Sin embargo, no hay verificación visual/OCR que confirme que el texto no es legible en la imagen rasterizada. Un PDF con texto renderizado como glifos vectoriales podría tener texto extraíble = vacío pero texto visualmente legible en la imagen.

**Riesgo:** Redacciones sobre PDFs con texto puramente vectorial (SVG embebido, Type3 fonts sin ToUnicode) podrían pasar el test de texto extraíble = "" pero revelar contenido a través de la imagen.

**Remediación requerida:** Añadir un step de verificación que aplique OCR (Tesseract o pytesseract) sobre la región redactada en el PNG de salida y confirme que el texto no es reconocible.

---

### INC-004 — ALTO: Rutas Unicode / espacios en nombre de archivo no testadas

**Severidad:** ALTA  
**Área:** Gestión de archivos  
**Descripción:** No hay test que cubra nombres de archivo con caracteres Unicode (japonés, árabe, caracteres combinados) o rutas con espacios en Windows. El AppContainer worker recibe la ruta del workspace vía argumento de línea de comandos; los tests de CI no incluyen fixtures con nombres no-ASCII.

**Riesgo:** `subprocess.Popen` / `CreateProcess` con rutas que contienen caracteres Unicode puede fallar o interpretar mal el path en Windows 10 con `ANSI codepage ≠ UTF-8`, dejando el worker sin archivo PDF o escribiendo en una ruta inesperada.

**Remediación requerida:** Añadir fixtures con nombres de archivo no-ASCII en `tests/test_windows_pdf_worker_contract.py` y verificar que el worker completa el ingest correctamente.

---

### INC-005 — MEDIO: Metadatos DocumentInfo en rotate/split/merge no eliminados explícitamente

**Severidad:** MEDIA  
**Área:** Privacidad de metadatos  
**Descripción:** Las operaciones `rotate_page`, `split_pdf` y `merge_pdfs` pasan por `_write_pdf` pero no incluyen la lógica de stripping de DocumentInfo que sí tiene `_redact_regions_raster`. PdfWriter hereda automáticamente el DocumentInfo del PdfReader fuente a menos que se llame a `writer.add_metadata({})`.

**Riesgo:** Un split de un PDF con `Author: Confidential Name` produce documentos derivados con el mismo Author en los metadatos, sin que el usuario sea advertido.

**Remediación requerida:** Documentar explícitamente que las operaciones no-destructivas preservan metadatos fuente (comportamiento esperado), o añadir una opción `strip_metadata=True` en `_write_pdf` para operaciones que así lo requieran.

---

### INC-006 — BAJO: Test de guardia PDFium frágil ante cambios de nombre de función

**Severidad:** BAJA  
**Área:** Test coverage  
**Descripción:** `test_all_pypdfium_entry_points_use_one_guard` verifica `fn.__code__.co_names.count("_pdfium_process_lock") == 1`. Este check fallará si se renombra el lock o si se extrae el lock a una función helper (el nombre ya no aparecerá en `co_names`).

**Remediación requerida:** Sustituir la introspección de `co_names` por una verificación de que `fn.__wrapped__` existe y que llamar a `fn` bajo un mock que comprueba si el lock está adquirido confirma serialización.

---

### INC-007 — BAJO: Adjuntos post-import no verificados en CI nativo

**Severidad:** BAJA  
**Área:** Integración GUI nativa  
**Descripción:** El flujo de drag-and-drop de PDF en la GUI nativa (WebView2) está cubierto por screenshots en el CI, pero los adjuntos de tipo imagen embebida en el PDF (PDF con `/EmbeddedFiles` bloqueados correctamente) no tienen test de regresión que confirme el mensaje de error al usuario en lugar de un crash silencioso.

**Remediación requerida:** Añadir un test de regresión que importe un PDF con `/EmbeddedFiles` y verifique que la GUI muestra el mensaje de rechazo correcto.

---

## SECCIÓN D — Análisis de Integración

### D.1 PR #82 (P1/P2 fixes)

**Estado:** INCLUIDO en la cadena de PR #84.  
El HEAD de PR #82 (`aea37e11`) es la BASE de PR #84. Todos los fixes P1/P2 de #82 ya están presentes en el SHA auditado `62ca54bc`. No hay regresión de integración identificada.

### D.2 PR #80

**Estado:** Anterior en la cadena histórica.  
PR #80 se fusionó antes que #82; sus cambios están incluidos en la base de #84 por transitividad. Sin incidentes de integración identificados.

### D.3 PR #88 (Smart Split)

**Estado:** APILADO LIMPIAMENTE sobre #84.  
PR #88 añade funcionalidad de split inteligente. Se apila sobre #84 sin conflictos en `app/core.py`. El guard `_reject_rewrite_of_signed_pdf` en `_write_pdf` cubre también las operaciones de split de #88, ya que todos los escritores de PDF pasan por el mismo sink. Sin incidentes de integración identificados.

### D.4 PR #90 (Docling / Calibre)

**Estado:** POSPONER — Funcionalidades opcionales no críticas para P0.  
PR #90 introduce dependencias opcionales (Docling, Calibre) que no forman parte del flujo P0 de ingreso y edición de PDF nativo en Windows. La integración con #84 no presenta conflictos en el código revisado, pero las dependencias adicionales no han sido auditadas en el contexto del AppContainer y podrían ampliar la superficie de ataque. Recomendación: posponer #90 hasta completar la auditoría de sus dependencias.

---

## SECCIÓN E — Ruta Crítica para Aprobación

Para que LocalPDF pase a estado APPROVED, se requieren las siguientes acciones en orden de prioridad:

### E.1 BLOQUEANTES (deben completarse antes de cualquier release)

1. **[INC-001]** Añadir test de usuario estándar Windows en CI nativo — verificar que `CreateAppContainerProfile` y el flujo completo funcionan sin privilegios de administrador.

2. **[INC-002]** Añadir fixture PAdES real (certificado de test público) y actualizar `test_core.py` — confirmar que `_contains_pdf_signature` detecta la estructura correctamente.

### E.2 REQUERIDOS antes del primer GA release

3. **[INC-003]** Añadir verificación OCR post-redacción — confirmar que el texto no es visualmente reconocible en la región redactada.

4. **[INC-004]** Añadir fixtures de nombre de archivo Unicode/espacios en `test_windows_pdf_worker_contract.py`.

### E.3 MEJORAS recomendadas (no bloqueantes para P0 limitado)

5. **[INC-005]** Documentar comportamiento de metadatos en operaciones no-destructivas.

6. **[INC-006]** Refactorizar test de guardia PDFium para ser robusto ante renombres.

7. **[INC-007]** Añadir test de regresión para EmbeddedFiles en GUI nativa.

---

## SECCIÓN F — Veredicto Final

### Estado global: CHANGES REQUIRED

```
┌─────────────────────────────────────────────────────────────────────┐
│  VEREDICTO FINAL DEL CHECKER INDEPENDIENTE                          │
│                                                                     │
│  SHA:  62ca54bc73b294bc482dd1501dc0cef6808e8e9a                     │
│  PR:   #84 — feature/windows-pdf-ingress-edit-p0-20261018           │
│  CI:   2/2 SUCCESS (source-and-regression + native-windows)         │
│                                                                     │
│  Funcionalidades auditadas:                                         │
│    ✓  Bloqueo de PDFs firmados (estructural)                        │
│    ✓  Redacción irreversible con stripping de metadatos             │
│    ✓  Bloqueo de contenido activo PDF                               │
│    ✓  AppContainer sin capacidades + canarios                       │
│    ✓  Thread-safety PDFium (RLock serializado)                      │
│    ✓  Source binding gate                                           │
│                                                                     │
│  Incidentes críticos abiertos: 2                                    │
│    ✗  INC-001: Usuario estándar Windows no testado                  │
│    ✗  INC-002: Firma PAdES real no verificada                       │
│                                                                     │
│  VEREDICTO:  CHANGES REQUIRED                                       │
│                                                                     │
│  El código es sólido para las rutas testadas. Los dos incidentes    │
│  críticos representan vectores de riesgo no cubiertos por           │
│  evidencia de test independiente. No se puede emitir APPROVED       │
│  hasta que INC-001 e INC-002 tengan tests que pasen en CI.          │
│                                                                     │
│  PR #88 puede integrarse sobre #84 en paralelo.                     │
│  PR #90 debe posponerse hasta auditoría de dependencias.            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Firma del Checker

Este informe fue generado por el Checker independiente en modo READ-ONLY sobre el código de producción del SHA de referencia. No se modificó código, no se fusionaron ramas, no se publicaron releases y no se alteraron las barreras de seguridad. Los resultados PASS de CI son evidencia de las ejecuciones registradas en el run #39204580388; no se simularon resultados ni se heredaron PASS de commits anteriores.

**Fecha de emisión:** 2026-11-05  
**Checker session:** https://claude.ai/code/session_01YZj1Ln1ReW5L8PyYmd4Jxq
