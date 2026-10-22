# Corrección de aislamiento de pruebas — 22 de octubre de 2026

Estado: correcciones de pruebas implementadas y validadas en Windows Node 22.23.4; validación Docker/Linux pendiente.

- Rama local: `codex/test-isolation-node22`, desde `2d61b3358fd63181778330b23104aff4d1e8b303`.
- Evidencias originales fuera del checkout: `../test-evidence-20261022/` (no modificar).
- Los 32 archivos de pruebas Backend y los 43 de Horneo de las imágenes coinciden con la transpilación de las fuentes actuales; los `dist/` locales preexistentes están atrasados y deben conservarse.
- Los manifiestos anterior/nuevo son idénticos por servicio. El commit completo de las imágenes no está acreditado.
- No usar bases compartidas, MQTT, correo ni hardware reales. No modificar código operativo para obtener un aprobado.
- Inventario: 71 fallos históricos distintos, todos clasificados, en `security-tests-node22-inventory.json`.
- Backend: 290 aprobadas, 0 fallidas, 6 integraciones omitidas; Horneo: 199 aprobadas, 0 fallidas, 4 integraciones omitidas.
- Contratos: 4/4; caso temporal corregido: 20/20 procesos nuevos consecutivos; typecheck/build de ambos servicios correctos.
- Evidencia final: `C:/Users/User/AppData/Local/Temp/horizonst-tests-evidence-XN40J9/summary.json`.
- La línea base original pasó localmente con recursos presentes; causa precisa de intermitencia histórica no reproducida. No atribuirla a Node ni afirmar acceso PostgreSQL demostrado.
- Pendiente: construcción limpia de imagen dedicada y reproducción Linux; no hay daemon Docker local. No se ejecutaron integraciones PostgreSQL.
- Próxima acción: revisión del diff propio y ejecución opcional del contenedor de pruebas por el operador. No hay commit, push ni despliegue autorizado en esta continuación.

Los resultados históricos no son resultados de la corrección. No hacer push, merge ni despliegue.
