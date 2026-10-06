# Mejoras del fork

La rama `mejora-integracion` implementa el plan aprobado en [plan-de-mejora.md](../../plan-de-mejora.md). Conserva la extensión `.pts` original: las peticiones llevan un identificador dentro del resultado evaluado y no requieren modificar el formato de la extensión.

## Herramientas nuevas

| Herramienta | Uso |
| --- | --- |
| `pt_read_endpoint` | Interfaces reales: dirección, máscara, DHCP y enlace. |
| `pt_configure_wireless_router` / `pt_read_wireless_router` | WRT: WAN DHCP/estática/PPPoE, dirección LAN y activación del DHCP LAN. |
| `pt_configure_dns` / `pt_read_dns` | Servicio DNS y registros A: alta, actualización y eliminación con lectura posterior. |
| `pt_verify_dns` | Resolución desde un cliente, separada del resultado ICMP. |
| `pt_read_server_dhcp` | Pools y consulta opcional de concesiones. |
| `pt_install_wireless_adapter` | WPC300N en notebook, con `replace=true` para reemplazar un módulo ocupado. |
| `pt_read_wireless_client` | Asociación real, AP/MAC, perfil e interfaz. |
| `pt_associate_default_wireless` | Asociación comprobada al AP indicado, abierto y con SSID `Default`; requiere `allowRestart=true`. |
| `pt_checkpoint_pkt` | `.pkt` numerado, tamaño y SHA-256; comparación opcional al reabrir. |
| `pt_latest_checkpoint` | Verificar y recuperar la ruta del último guardado confirmado. |

## Configuración y verificación

Un WRT con dirección WAN estática debe usar `wanMode="static"` (enum nativo **2**), no PPPoE (enum **1**). El modo DHCP usa **0**. Para una red con Server-PT DHCP, configura `dhcpEnabled=false` en el WRT y actualiza el pool persistente `serverPool` del servidor. Packet Tracer puede recrear ese pool al reabrir si se elimina; por eso esta herramienta rechaza su eliminación y detecta rangos superpuestos antes de aplicar cambios.

Ejemplo de configuración WAN:

```json
{"device":"WRT","wanMode":"static","wanIp":"10.10.10.1","wanMask":"255.255.255.0","lanIp":"192.168.50.1","lanMask":"255.255.255.0","dhcpEnabled":false}
```

`pt_set_pc` permite `dns` en modo estático y respeta `port` también en DHCP. Si no se proporciona puerto DHCP, selecciona uno conectado o inalámbrico y excluye Bluetooth. La respuesta `OK:…` significa que se aplicó la operación; la lectura distingue ese estado de una concesión DHCP todavía pendiente. Para gateway/DNS del cliente usa `pt_run_cli` con `ipconfig /all`: esos getters no existen en todos los objetos nativos. Los campos de gateway/DNS del perfil WiFi pueden estar desactualizados.

La CLI devuelve resultados por comando. `pt_run_cli_bulk` conserva el filtrado de encapsulación por modelo, ejecuta en secuencia y se detiene al primer error o timeout. Incluye `enable` explícitamente en el bloque; en `pt_run_cli` se puede usar `mode="enable"` o `mode="global"`. La paginación `--More--` avanza con espacios. `no` sólo se envía cuando está visible la pregunta del asistente inicial. Un timeout del bridge deja el resultado de una escritura incierto: consultar el estado antes de repetirla. Las recetas antiguas que usan el generador síncrono `bulkCliJs` siguen siendo síncronas; para comandos largos o paginados usa las herramientas CLI.

Ping distingue `success`, `loss`, `unreachable`, `dns_error`, `incomplete` y `timeout`. Una respuesta “Destination host unreachable” no cuenta como eco exitoso. Un resultado parcial no se presenta como conectividad comprobada. La resolución DNS puede funcionar aunque ICMP falle.

## WiFi y layout

Instala WPC300N, configura un AP abierto `Default` y consulta su MAC. La asociación Default requiere que el perfil activo del notebook también sea Default. El reinicio sólo ocurre con `allowRestart=true`; la herramienta espera y verifica la asociación con **el AP solicitado**. Si hay otra radio con el mismo SSID, no se da por válida una asociación al AP equivocado. Deshabilitar o cambiar la otra radio debe hacerse explícitamente. Los perfiles de SSID arbitrario siguen requiriendo configuración nativa/verificación: este fork no afirma que un setter de SSID baste para asociarlos.

El snapshot incorpora enlaces WiFi observados por MAC y puerto enlazado. El layout de LANs con cascadas usa un bosque de jerarquías, mantiene las profundidades de los switches/AP/clientes y reserva ancho por subárbol. Las topologías simples conservan la política anterior. En grafos cíclicos o enlaces compartidos pueden quedar cruces; no es un optimizador global de todos los cables.

La API de enlaces cableados de PT sigue siendo opaca. Un `.pkt` cargado antes de iniciar el servidor no aporta automáticamente parejas de puertos al registro en memoria. Por eso el layout depende de los enlaces creados por el MCP o de un registro conocido, además de las asociaciones WiFi observadas.

## Checkpoints y recuperación

Después de cada bloque de trabajo llama a:

```json
{"directory":"/ruta/absoluta/backups","name":"laboratorio","verifyReopen":false}
```

Se generan `laboratorio-0001.pkt`, `laboratorio-0002.pkt`, etc., sin sobrescribir copias. `latest-checkpoint.json` sólo se actualiza después de confirmar archivo estable, tamaño y SHA-256. `pt_latest_checkpoint` verifica esos datos antes de devolver la copia recuperable. Si Packet Tracer deja de responder, reinícialo, reconecta la extensión y abre esa ruta con `pt_open_pkt`. El servidor no cierra procesos automáticamente.

`verifyReopen=true` **reemplaza el lienzo activo** por la copia recién guardada y compara direcciones estáticas, modos WAN, DNS, pools DHCP y SSID. No compara concesiones dinámicas ni estados transitorios de radio/STP. La comprobación requiere que Packet Tracer y MCP compartan el sistema de archivos. Espera la convergencia antes de verificar conectividad. Estos checkpoints son explícitos: no hay un temporizador global de autoguardado.

## Pruebas

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
```

Se agregaron regresiones por funcionalidad y pruebas del registro/llamadas a través del SDK MCP real. Para validación nativa, con un MCP anterior ya conectado a Packet Tracer:

```sh
bun run scripts/verify-integration-live.ts
```

La ejecución por defecto es de sólo lectura. `--fixture` exige un lienzo vacío y construye siete dispositivos sintéticos; guarda copias en `/private/tmp/packet-tracer-mcp-integration-fixture`. `--resume-fixture` sólo acepta los siete nombres sintéticos conocidos. `--verify-connectivity` consulta el notebook de esa fixture. `UPSTREAM_MCP_URL` y `PT_FIXTURE_DIR` permiten cambiar servidor y carpeta.

El script retransmite la expresión correlacionada por el MCP existente, sin reemplazar la extensión ni el servidor instalado. No requiere subir topologías, datos personales o archivos del ejercicio al fork.
