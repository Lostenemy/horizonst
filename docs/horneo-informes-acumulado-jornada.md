# Informes Horneo: acumulado por jornada

El botón «Ver acumulado por jornada» de Informes consulta los filtros **actuales**
de Desde, Hasta y DNI al pulsarlo, igual que PDF y Excel. La lista usa el endpoint
autenticado `GET /reports/inspection/daily`. Los tres requieren uno de los roles
`supervisor`, `administrador` o `superadministrador`. Si cambian los filtros, la
lista anterior se invalida; un resultado tardío de la petición previa no se
muestra como si correspondiera al rango nuevo. Ningún error borra los filtros.

## Regla compartida

- La jornada es el día natural de `Europe/Madrid`, de medianoche a medianoche.
  Sus límites UTC son de 23, 24 o 25 horas según el cambio horario.
- Se registra al trabajador desde su primera detección de la jornada, aunque
  todavía tenga cero segundos de exposición o ya haya salido.
- Para sesiones cerradas por timeout, el fin computable procede de la duración
  de exposición guardada al cierre (última detección válida), no de `ended_at`,
  que representa la confirmación operativa de salida. Las salidas explícitas
  conservan su hora de fin; las sesiones abiertas se cortan en la última
  presencia válida de las gateways pertinentes, nunca más allá del instante
  de lectura. Es la misma expresión SQL de exposición que el panel existente.
- Se parte cada intervalo en medianoches locales y se unen los intervalos
  superpuestos o duplicados del **mismo trabajador** en una misma jornada,
  incluso si proceden de varias gateways. El tiempo transcurrido entre última
  detección y confirmación de salida no suma. El límite de seis horas se
  muestra solo como contexto del panel existente: esta función no dispara
  alarmas, bloqueos ni órdenes físicas.

## Filtros y límites del rango

`from` y `to` son fechas `AAAA-MM-DD` en Europe/Madrid; `to` incluye el día
completo. Sin fechas se consulta todo el histórico. Si solo hay un límite,
el otro lado queda abierto. El DNI es búsqueda parcial literal, sin que `%`,
`_` o `\` actúen como comodines SQL. Un rango inválido recibe HTTP 400.

El **detalle** y el resumen de inspección incluyen cualquier sesión cuya
exposición solape el rango, aunque la entrada haya ocurrido el día anterior.
El detalle conserva la entrada, fin de exposición, confirmación de salida y
**duración íntegra de esa sesión**; no elimina ni altera sesiones históricas.
El **acumulado** atribuye solo los segundos dentro de las jornadas incluidas
por el filtro, repartiendo las sesiones que cruzan medianoche. Por ejemplo,
una sesión de 23:30 a 00:30 aparece en ambos rangos de un día, pero su
acumulado aporta 30 minutos a cada jornada. No se suma dos veces si coincide
con otra sesión del trabajador.

Excel conserva la hoja «Inspección» con todo el detalle paginado y añade
«Acumulado por jornada»; PDF conserva la tabla de sesiones y añade una sección
paginada del mismo nombre. La lista, la hoja y la sección usan
`loadInspectionDailyTotals` y el acumulador compartido con el panel.
Las lecturas de cada informe se realizan bajo una transacción `REPEATABLE READ
READ ONLY` con lotes de 1000 filas; no existe límite lógico de sesiones.

## Comprobación y despliegue

Desde `cold-compliance-service`: `npm run typecheck`, `npm run build`, `npm test`
y `node --check web/app.js`. Las pruebas de la nueva API y los documentos usan
consulta PostgreSQL simulada, autenticación simulada y transporte HTTP
únicamente en loopback. La prueba PostgreSQL 15 aislada opcional del módulo de
informes sigue condicionada a un entorno desechable expresamente configurado;
no se ejecuta sobre staging ni producción por este cambio. No hay migración.
Antes de desplegar, verificar en un entorno aislado los filtros sobre sesiones
reales que empiecen antes de `from` y crucen `to`, y comparar los tres formatos.

Validación local de esta entrega: typecheck, build y sintaxis web correctos;
suite completa **154 pruebas: 152 aprobadas, 0 fallidas, 2 omitidas** por requerir
PostgreSQL aislado. Las nuevas regresiones ejecutables cubren la API HTTP,
Excel real, PDF real, lista simulada, filtros, más de 2.000 sesiones paginadas
y cambios horarios.
