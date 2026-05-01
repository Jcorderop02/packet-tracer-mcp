# Política de seguridad

## Versiones soportadas

| Versión | Soportada |
|---------|-----------|
| 0.1.x   | Sí (rama actual, experimental) |
| < 0.1   | No |

`packet-tracer-mcp` está marcado como **experimental**
([WIP](https://www.repostatus.org/#wip)). Hasta que haya una release
1.0 estable, sólo la rama actual recibe fixes.

## Modelo de amenaza

El servidor está pensado para correr **en tu propia máquina**, junto a
una instancia local de Cisco Packet Tracer 9. Por defecto:

- El transporte MCP escucha en `127.0.0.1:39001` (loopback).
- El bridge HTTP a la webview de PT escucha en `127.0.0.1:54321`.
- No se hacen conexiones salientes a Internet. Todo el JS que se
  ejecuta en el Script Engine de PT viene del propio repositorio.
- No hay telemetría, analytics ni phone-home.

Si configuras `PACKETTRACER_MCP_HOST=0.0.0.0` para acceso desde la LAN,
la responsabilidad de proteger ese puerto pasa a ti (firewall,
segmentación de red, autenticación a nivel de red). El servidor en sí
**no implementa autenticación ni autorización** porque asume entorno
local de confianza.

## Reportar una vulnerabilidad

Si encuentras una vulnerabilidad, por favor **no abras un issue
público**. Escribe a:

**jcorderop@hotmail.es**

con:

- Descripción del problema y su impacto.
- Pasos para reproducirlo.
- Versión afectada (`0.1.x` o commit hash).
- Si tienes una propuesta de fix, mejor.

Compromiso de respuesta:

- **Acuse de recibo**: en menos de 7 días naturales.
- **Triaje y plan**: en menos de 14 días naturales desde el reporte.
- **Fix o mitigación documentada**: depende de la severidad y de mi
  disponibilidad (proyecto mantenido en ratos libres). Para
  vulnerabilidades críticas, prioridad sobre cualquier otra cosa.

Una vez publicado el fix, te mencionaré en el commit y en el
`CHANGELOG.md` salvo que prefieras lo contrario.

## Fuera de alcance

- Vulnerabilidades en Cisco Packet Tracer en sí (esas van a Cisco).
- Vulnerabilidades en dependencias de terceros sin demostrar impacto
  concreto sobre `packet-tracer-mcp` (úsalas a través del feed de
  GitHub Security Advisories).
- "Issues" derivadas de exponer el puerto MCP a Internet sin firewall:
  el modelo de amenaza es local.
