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

Los resultados anteriores fueron aportados por el autor del PR y corresponden
a esa topología. El script incluye consultas de solo lectura y un modo
`--fixture` que modifica el canvas.

La validación nativa usa el bridge instalado como retransmisor del código nuevo. No se reemplazó la extensión `.pts` ni se modificó la configuración del servidor MCP original. Los detalles y límites de lo que se verifica están en [mejoras.md](mejoras.md).

## Repetición independiente en 9.0.1.0858

- 405 pruebas automáticas, comprobación de tipos y compilación correctas
  en la rama de revisión.
- El laboratorio sintético completó asociación Wi-Fi abierta, CLI, layout
  y reapertura del checkpoint. La primera consulta DNS tras reabrir falló.
  Tras varios reintentos, `test.example` resolvió y obtuvo 4/4 respuestas ICMP.
- La comprobación al reabrir compara ajustes seleccionados. La asociación,
  la asignación DHCP y la resolución se comprobaron después de converger.
- Comprobaciones adicionales en vivo: eliminación idempotente de un registro A,
  lectura DHCP sin error al terminar la lista de concesiones, instalación de
  HWIC-2T, VLAN nativa en 3650 y recetas campus, NAT, IPv6, VoIP y dos ISP.
  Este último caso verifica configuración BGP/HSRP, DHCP y ping a la puerta
  de enlace virtual.
- El binario compilado y firmado localmente en Apple Silicon arrancó en
  stdio, anunció 69 herramientas y entregó la guía de agentes embebida.
