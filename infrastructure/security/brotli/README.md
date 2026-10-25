# Protección Brotli en reconstrucciones
CVE-2026-111497. Los mínimos hacen fallar el build si el parche no está disponible.

- Backend, Horneo, Tienda y MQTT UI API: Node 22.23.4 por digest, certificados >=20261020-r0 y brotli-libs>=1.2.1-r0 en cada etapa Node.
- Broker/observador mantenidos Debian 13: libbrotli1>=1.1.0-2+deb13u1.
- Portal/MQTT UI Alpine 3.21: brotli-libs>=1.1.1-r0 (backport del proveedor).
- Alpine.Dockerfile y Debian.Dockerfile protegen una imagen construida sin cambiar fuentes; preservan usuario y bundle CA. APPLICATION_IMAGE debe ser digest o etiqueta local cuyo ID se haya verificado. BuildKit no interpreta un ID sha256 desnudo como referencia a una imagen local.
- El wrapper Debian solo admite bookworm/trixie; no instala paquetes Debian en Ubuntu.

## Validación aislada
Preparar un directorio con candidates.json: cada elemento admite label, target, parent opcional y client.
parent exige conservar Config para wrappers; omitirlo para reconstrucciones desde fuentes y justificar los cambios de configuración aparte.
client=node verifica versión/indicador del parche de Node y HTTP Brotli con fetch. El modo por defecto usa curl --compressed.
Ambos exigen marcador nativo; el mínimo del paquete lo impone el build.
El verificador crea red --internal y un emisor sintético sin puertos/secretos, elimina solo sus IDs y escribe candidate-validation.json.

    python3 infrastructure/security/brotli/verify-candidates.py /ruta/a/evidencia
    node --test scripts/security-build-recipes.test.cjs

No ejecuta exploits ni acredita negocio. No usar configuración ni volúmenes de las aplicaciones activas en estos fixtures.
Conservar imágenes activas y una reversión segura; no ejecutar prune automático.
El host Ubuntu sigue su propio ciclo de parches; estas recetas acreditan únicamente las imágenes.
No volver al broker legacy 1.13 ni a su almacenamiento.

## Referencias
- https://nodejs.org/en/blog/release/v22.23.4
- https://github.com/google/brotli/releases/tag/v1.2.1
- https://security-tracker.debian.org/tracker/CVE-2026-111497
