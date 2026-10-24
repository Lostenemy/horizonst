# Migración de VerneMQ 2.2.1

Las recetas mantenidas usan Debian 13 y fijan la imagen oficial por digest. Antes de desplegar, respaldar el broker detenido y acordar la conservación de retenidos/sesiones: 2.2.1 no abre directamente los metadatos de 1.13. Las plantillas usan volúmenes nuevos explícitos para evitar que el binario nuevo escriba en el almacenamiento antiguo. No sustituir esos nombres por los volúmenes viejos.

En producción los tres volúmenes mantenidos son externos y deben crearse vacíos después del respaldo. PostgreSQL conserva su volumen y no requiere recrearse por esta migración. Aplicar exclusivamente el servicio vernemq; el observador solo existe en staging. El arranque limpio requiere autorización expresa para no reinyectar retenidos. No publicar comandos como prueba. Conservar imagen, configuración y volúmenes originales para reversión; no restaurar metadatos antiguos a ciegas ni reproducir comandos archivados.

Validación acreditada en staging: PostgreSQL/bcrypt, ACL positivas/negativas, QoS1, retenidos y sesiones persistentes sintéticos tras reinicio, RPC remoto del observador, tres almacenes de certificados y reconexión de las aplicaciones. Véase docs/vernemq-maintained-staging-20261024.md. Las pruebas de hardware físico no están incluidas.
