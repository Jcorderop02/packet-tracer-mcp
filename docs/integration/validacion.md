# Resultado de validación

Validado localmente el 6 de octubre de 2026 (UTC), con Cisco Packet Tracer 9.0.1, Bun 1.4.2 y una topología sintética. No se incorporaron datos personales ni archivos del ejercicio original.

- Línea de base: 348 pruebas aprobadas y comprobación de tipos sin errores.
- Resultado final: 400 pruebas aprobadas, comprobación de tipos y compilación del ejecutable sin errores.
- Transporte nativo: identificador correlacionado, comillas, barras invertidas, saltos de línea, español y caracteres CJK preservados.
- WRT: modo WAN estático correcto, WAN/LAN leídas, DHCP LAN deshabilitado.
- Server-PT: direcciones estáticas y DNS configurados; registro A creado y actualizado; pool `serverPool` configurado con rango y opciones coherentes.
- Notebook: reemplazo autorizado por WPC300N, asociación al AP Default comprobada por MAC, DHCP en Wireless0 y consulta de estado.
- CLI: bloque de switch y `ipconfig /all` completos; paginación y corte por error/timeout cubiertos con regresiones automáticas.
- Layout: cascada WRT → switch → switch → AP → notebook; regresiones de varias sedes y comprobación de idempotencia.
- Persistencia: guardados numerados con SHA-256; reapertura y comparación de configuración completadas. Consulta del último checkpoint confirmada.
- Tras convergencia, `test.example` resolvió a `10.10.10.33` y obtuvo cuatro respuestas ICMP de cuatro (100%).

La validación nativa usa el bridge instalado como retransmisor del código nuevo. No se reemplazó la extensión `.pts` ni se modificó la configuración del servidor MCP original. Los detalles y límites de lo que se verifica están en [mejoras.md](mejoras.md).
