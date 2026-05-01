# Referencia de tools MCP

Este documento es la referencia auto-generada de las 57 tools MCP que expone `packet-tracer-mcp`. El orden coincide con el registro real en `src/tools/index.ts` (la lista `ALL_TOOLS`), agrupado por las secciones que marcan los comentarios de ese fichero.

## Índice

- [Pre-flight planning](#pre-flight-planning)
- [Health + catalog](#health--catalog)
- [Read-only inspection](#read-only-inspection)
- [Per-element authoring](#per-element-authoring)
- [Read-only diagnostics on live devices](#read-only-diagnostics-on-live-devices)
- [Recipe-level authoring](#recipe-level-authoring)
- [Persistence](#persistence)
- [CLI access](#cli-access)
- [Simulation / ops](#simulation--ops)
- [.pkt persistence](#pkt-persistence)
- [Escape hatch](#escape-hatch)

## Pre-flight planning

### `pt_plan_review`

> Validate a topology plan BEFORE touching the canvas. The LLM declares devices, links and LAN roles; the tool returns a structured review with errors (will definitely fail), warnings (likely wrong) and a human-readable summary.

**Parámetros:**
- `devices` (array, requerido) — lista completa de dispositivos planificados con `name`, `role` y `model` opcional.
- `links` (array, requerido) — cables planificados con `a`, `b`, `cable` y `purpose` opcional.
- `lans` (array, opcional) — declaración de cada LAN como `user` o `transit` con sus endpoints.
- `notes` (string, opcional) — contexto libre del brief o intención del usuario.

**Notas:** No toca el canvas ni la bridge. Es validación pura. Obligatoria en topologías con tres o más routers o cuando el usuario aporta un diagrama. La salida está pensada para presentarla literal al usuario antes de seguir con `pt_add_device`.

## Health + catalog

### `pt_bridge_status`

> Report whether the packet-tracer-mcp bridge is currently being polled by Packet Tracer, and emit the bootstrap snippet that activates the polling loop inside PT's webview.

**Parámetros:** ninguno.

**Notas:** No requiere bridge conectada (precisamente sirve para diagnosticarla). Devuelve el snippet de bootstrap que hay que pegar una vez por sesión en el editor de la webview.

### `pt_list_devices`

> Enumerate the device models that packet-tracer-mcp knows how to instantiate, with their port lists and the alias shortcuts accepted by other tools.

**Parámetros:** ninguno.

**Notas:** Catálogo estático del lado servidor. Útil antes de llamar a `pt_add_device` para conocer modelos válidos y los alias que aceptan otras tools.

### `pt_list_modules`

> Enumerate hardware modules. Without `device`: PT's full catalog (filterable). With `device`: the modules physically installed in that chassis right now (slotPath → name).

**Parámetros:**
- `filter` (string, opcional) — substring sin distinguir mayúsculas para el modo catálogo. Se ignora en modo instalado.
- `limit` (number, opcional) — máximo de filas en modo catálogo (1–500, por defecto 50).
- `device` (string, opcional) — si se indica, lista los módulos físicamente presentes en ese chasis.

**Notas:** Dos modos en una misma tool. Requiere bridge conectada (incluso para el catálogo, que se obtiene desde la HardwareFactory de PT).

### `pt_list_recipes`

> Enumerate the topology recipes pt_cook_topology can build, with their parameter shape.

**Parámetros:** ninguno.

**Notas:** Lista las recipes registradas (`chain`, `star`, `branch_office`, etc.) con su `paramHint`. Pensada para preparar la llamada posterior a `pt_cook_topology` o `pt_forecast`.

### `pt_list_snapshots`

> List every persisted canvas snapshot, sorted from newest to oldest.

**Parámetros:** ninguno.

**Notas:** Lee el directorio de snapshots persistidos, no toca PT. Útil antes de `pt_load_snapshot` o `pt_diff_snapshots`.

## Read-only inspection

### `pt_query_topology`

> Snapshot the live topology in Packet Tracer: returns name, model, classname and coordinates for every user-placed device.

**Parámetros:** ninguno.

**Notas:** Solo lectura. Llamada IPC ligera con `listDevicesJs`; no captura puertos ni cables (para eso, `pt_inspect_canvas`).

### `pt_get_device_details`

> Inspect a single device: model, type, power state, and live port-by-port snapshot (IP, mask, connection state).

**Parámetros:**
- `name` (string, requerido) — nombre exacto del dispositivo a inspeccionar.

**Notas:** Solo lectura. Devuelve modelo, tipo, estado de power y la tabla de puertos (IP/máscara/estado de enlace).

### `pt_inspect_canvas`

> Snapshot the live workspace and report duplicate IPs, unaddressed router uplinks, mismatched router-peer subnets, and similar findings. Read-only.

**Parámetros:** ninguno.

**Notas:** Pasa el snapshot por las reglas de `canvas/inspect.ts`. Útil antes de aplicar recipes o tras editar a mano.

### `pt_explain_canvas`

> Render a human-readable narration of the live workspace: inventory counts, per-router subnets, dangling addresses. Read-only.

**Parámetros:** ninguno.

**Notas:** Genera una narración en lenguaje natural a partir del snapshot. Pensada para presentar al usuario el estado actual antes de seguir.

### `pt_forecast`

> Dry-run estimator. Build the blueprint for a recipe and report what it would allocate, without touching the live canvas.

**Parámetros:**
- `recipe` (string, requerido) — clave de la recipe (ver `pt_list_recipes`).
- `params` (record, opcional) — parámetros específicos de la recipe.

**Notas:** No requiere bridge. Construye el blueprint en memoria y reporta dispositivos, cables e IPs que asignaría.

### `pt_generate_configs`

> Offline generator. Builds a recipe blueprint and synthesises the IOS CLI each device would receive — without touching PT or the bridge.

**Parámetros:**
- `recipe` (string, requerido) — clave de la recipe.
- `params` (record, opcional) — parámetros de la recipe.
- `format` (enum, opcional) — `summary` (informe humano), `json` (estructura completa) o `concat` (configs IOS concatenadas, por defecto `summary`).

**Notas:** Útil para documentación, material de aula o para replicar el lab en hardware real. Endpoints (PCs, APs, teléfonos) reciben notas en lenguaje natural en lugar de CLI.

## Per-element authoring

### `pt_add_device`

> Place a single device in the active Logical workspace and rename it to the requested name.

**Parámetros:**
- `name` (string, requerido) — nombre final del dispositivo (p. ej. `R1`).
- `model` (string, requerido) — modelo PT o alias (ver `pt_list_devices`).
- `x` (number, opcional) — coordenada X. Si se omite, se aplica auto-grid por categoría.
- `y` (number, opcional) — coordenada Y. Si se omite, se aplica auto-grid.

**Notas:** Recomendado dejar `x`/`y` en blanco y rematar con `pt_auto_layout`. Las filas por categoría se documentan en la propia descripción (routers arriba, switches en medio, endpoints abajo).

### `pt_add_module`

> Install a hardware module (NIM-2T, HWIC-2T, NIM-ES2-4, ...) into a router slot. Idempotent: if the slot already holds the requested module, returns success without touching the chassis.

**Parámetros:**
- `device` (string, requerido) — nombre del router que recibe el módulo.
- `slot` (string, requerido) — ruta `chassis/bay`, p. ej. `0/1`.
- `module` (string, requerido) — modelo del módulo (`NIM-2T`, `HWIC-2T`, `NIM-ES2-4`, etc.).

**Notas:** Internamente apaga el router, inserta el módulo y reanuda el boot saltándose el wizard. Idempotente: si la bahía ya tiene el módulo pedido, no hace nada. Valida la ruta de bahía contra el catálogo del chasis antes de enviar.

### `pt_create_link`

> Cable two existing devices together. Cable defaults to copper straight-through; use 'cross' for switch trunks, 'serial' for WAN P2P (requires HWIC-2T), 'fiber', 'console' or 'coaxial' as needed.

**Parámetros:**
- `device_a` (string, requerido) — primer extremo.
- `port_a` (string, requerido) — nombre completo de puerto en `device_a`.
- `device_b` (string, requerido) — segundo extremo.
- `port_b` (string, requerido) — nombre completo de puerto en `device_b`.
- `cable` (enum, opcional) — `straight` (por defecto), `cross`, `fiber`, `serial`, `console`, `coaxial`.
- `confirm_internal_lan` (boolean, opcional) — flag obligatorio si se intenta cablear dos routers con `straight`/`cross`.

**Notas:** Por defecto rechaza Ethernet entre dos routers sin confirmación explícita (el error más típico de los LLMs en labs académicos). El cable `console` se rechaza si los puertos no parecen `Console`/`RS-232`. Tras un cable serial recuerda configurar `clock rate` en el lado DCE. Mantiene un registro local en `linkRegistry` porque la API JS de Link en PT 9 es opaca.

### `pt_delete_device`

> Remove a device (and all of its links) from the active workspace. Self-verifies the deletion by re-snapshotting the topology.

**Parámetros:**
- `name` (string, requerido) — nombre exacto a eliminar.

**Notas:** Tras `removeDevice`, vuelve a listar para confirmar. Limpia las entradas asociadas en `linkRegistry`.

### `pt_delete_link`

> Remove the cable attached to one specific device port. Use this when you need to re-cable without deleting either device.

**Parámetros:**
- `device` (string, requerido) — uno de los dos extremos del cable.
- `port` (string, requerido) — puerto de ese dispositivo cuyo cable hay que cortar.

**Notas:** Cualquiera de los dos extremos sirve, PT localiza el cable a partir de uno solo. Limpia la pareja correspondiente en `linkRegistry`.

### `pt_move_device`

> Reposition a device on the logical canvas via Device.moveToLocation(x, y).

**Parámetros:**
- `name` (string, requerido) — dispositivo a mover.
- `x` (number, requerido) — nueva X en el canvas lógico.
- `y` (number, requerido) — nueva Y en el canvas lógico.

**Notas:** Solo cambia coordenadas; no toca cableado ni configuración. Para reorganizar muchos a la vez, usar `pt_auto_layout`.

### `pt_auto_layout`

> Re-grid the entire live canvas into a clean topology-aware layout.

**Parámetros:**
- `dryRun` (boolean, opcional) — si es `true`, devuelve los movimientos planificados sin aplicarlos.

**Notas:** Lee el canvas, clasifica cada dispositivo y asigna coordenadas por fila de categoría más alineamiento de columna con el padre (switches con su router, endpoints con su switch). Idempotente: ejecutarla dos veces sobre el mismo canvas es un no-op.

### `pt_rename_device`

> Rename a device. Refuses if the new name is already taken so you don't accidentally collapse two devices into one.

**Parámetros:**
- `old_name` (string, requerido) — nombre actual.
- `new_name` (string, requerido) — nombre nuevo deseado.

**Notas:** Mantiene el `linkRegistry` actualizado. Si `old_name === new_name` devuelve sin tocar nada.

### `pt_set_pc`

> Configure an endpoint (PC, laptop, server) for static IP or DHCP. In static mode you must pass ip+mask; gateway is optional.

**Parámetros:**
- `device` (string, requerido) — nombre del endpoint.
- `mode` (enum, requerido) — `static` o `dhcp`.
- `port` (string, opcional) — puerto a configurar (por defecto `FastEthernet0`).
- `ip` (string, opcional) — IPv4, obligatorio si `mode='static'`.
- `mask` (string, opcional) — máscara, obligatoria si `mode='static'`.
- `gateway` (string, opcional) — gateway por defecto, solo modo estático.

**Notas:** Solo aplica a endpoints (PC-PT, Laptop-PT, Server-PT); routers se configuran por CLI. En modo estático valida que `ip` y `mask` estén presentes.

### `pt_set_device_power`

> Toggle a device's power switch (Device.setPower). Idempotent: returns 'already' when the requested state is already in effect. After power-on the boot dialog is dismissed via skipBoot.

**Parámetros:**
- `device` (string, requerido) — nombre del dispositivo en el canvas.
- `on` (boolean, requerido) — estado objetivo (`true`=encendido).

**Notas:** Idempotente. Tras encender, salta el wizard de boot automáticamente.

### `pt_add_canvas_annotation`

> Decorate the canvas with a note, line, or circle (LogicalWorkspace.addNote/drawLine/drawCircle). Returns the new annotation's UUID.

**Parámetros:**
- `kind` (enum, requerido) — `note`, `line` o `circle`.
- `x`, `y` (number, requerido) — origen (note/circle) o `x1`,`y1` (line).
- `x2`, `y2` (number, opcional) — segundo punto para `line`.
- `radius` (number, opcional) — radio en píxeles para `circle`.
- `text` (string, opcional) — contenido del `note`.
- `font_size` (int, opcional) — tamaño de fuente del note (6–72, por defecto 12).
- `thickness` (int, opcional) — grosor de stroke para line/circle (1–20, por defecto 2).
- `r`, `g`, `b` (int, opcional) — RGB (0–255, por defecto 0).
- `alpha` (int, opcional) — alfa (0–255, por defecto 255).

**Notas:** Devuelve el UUID asignado por PT para futuras referencias. Cada `kind` exige sus propios campos (ver validaciones en runtime).

### `pt_manage_clusters`

> Inspect and prune logical clusters on the canvas. `list` returns the cluster tree; `remove` deletes a cluster by id; `uncluster` dissolves it while keeping its members.

**Parámetros:**
- `action` (enum, requerido) — `list`, `remove` o `uncluster`.
- `cluster_id` (string, opcional) — ID del cluster para `remove`/`uncluster`.
- `keep_contents` (boolean, opcional) — en `remove`, mantener los hijos en el canvas (por defecto `true`).

**Notas:** Solo lectura y poda. La creación programática de clusters no es alcanzable desde la IPC de PT 9 porque depende de la selección en la UI.

## Read-only diagnostics on live devices

### `pt_inspect_ports`

> Live per-port status: link presence, isPortUp, isProtocolUp, MAC, IP/mask, wireless flag — read directly from the Port objects.

**Parámetros:**
- `device` (string, requerido) — nombre del dispositivo.
- `onlyLinked` (boolean, opcional) — filtrar a puertos con cable (por defecto `false`).

**Notas:** Información más cruda que `pt_get_device_details`: estado L1/L2 puerto a puerto.

### `pt_read_vlans`

> Read the live VLAN database of a switch via VlanManager (id, name, default flag, MAC table size).

**Parámetros:**
- `device` (string, requerido) — nombre del switch.

**Notas:** Si el dispositivo no expone `VlanManager` (no es L2/L3), devuelve un error transparente.

### `pt_read_acl`

> Read the live ACLs of a router via AclProcess: per-ACL canonical commands as PT would render them in 'show running-config | section access-list'.

**Parámetros:**
- `device` (string, requerido) — router (o cualquier dispositivo con `AclProcess`).

**Notas:** No depende de la CLI; lee los objetos ACL nativos. Si el dispositivo no tiene `AclProcess`, error transparente.

### `pt_show_bgp_routes`

> Run `show ip bgp` on a router and parse the BGP table into rows (status, network, next-hop, metric, localpref, weight, path).

**Parámetros:**
- `device` (string, requerido) — router corriendo BGP.
- `vrf` (string, opcional) — nombre de VRF; si no se pone, usa la tabla global.

**Notas:** PT 9 no expone `BgpProcess` por JS, así que esta es la única forma de inspeccionar el estado real de BGP. Detecta `% BGP not active` y errores de parser, con fallback a `runShowRunning` cuando IOS rechaza `terminal length 0`.

### `pt_read_project_metadata`

> Read NetworkFile metadata of the .pkt currently open in PT: description, file version, and the on-disk filename if it has been saved.

**Parámetros:** ninguno.

**Notas:** Solo lectura. Si el fichero no se ha guardado aún, devuelve `(unsaved)`.

## Recipe-level authoring

### `pt_cook_topology`

> Build a recipe's blueprint and apply it to the live workspace: places devices, wires links, addresses ports, configures routing. Idempotent against partial state.

**Parámetros:**
- `recipe` (string, requerido) — clave de la recipe (`chain`, `star`, `branch_office`, etc.).
- `params` (record, opcional) — parámetros de la recipe.

**Notas:** Mutación masiva del canvas. Idempotente frente a estado parcial: si parte de la topología ya existe, completa lo que falta.

### `pt_mend_canvas`

> Inspect the live workspace and apply safe, conservative repairs (e.g. powering on devices that have active links). Reports remaining issues that need a human decision.

**Parámetros:** ninguno.

**Notas:** Solo aplica reparaciones seguras y conservadoras. Lo demás se reporta para que decida un humano.

### `pt_apply_switching`

> Apply L2 switching intents (VLANs, trunks, port-security, EtherChannel) to switches on the live canvas. Each helper groups CLI per device and pushes one bulk per switch.

**Parámetros:**
- `vlans` (array, opcional) — definiciones de VLAN y puertos de acceso por switch.
- `trunks` (array, opcional) — configuración de puertos trunk por switch.
- `portSecurity` (array, opcional) — reglas de port-security por switch.
- `etherChannels` (array, opcional) — grupos EtherChannel (>=2 puertos) por switch.

**Notas:** Cada bloque se agrupa por switch y se envía como un único bulk CLI. EtherChannel acepta `switchModel` para detectar IE-9320 (que dropea `channel-group`) antes de mandar nada a PT. Para trunks usa CLI puro (la API nativa `addTrunkVlans` no emite `switchport trunk allowed vlan` en running-config).

### `pt_apply_services`

> Apply L3 services (ACLs, NAT, DHCP server/relay, NTP, Syslog) to the live canvas. Each block is grouped per device and pushed as one bulk per service.

**Parámetros:**
- `acls` (array, opcional) — ACLs estándar/extendidas, opcionalmente bound a interfaces.
- `nat` (array, opcional) — roles NAT, statics, pools y overload por dispositivo.
- `dhcpPools` (array, opcional) — pools DHCP del router (incluye `tftpServer` para option-150).
- `dhcpRelays` (array, opcional) — `helper-address` por interfaz.
- `ntp` (array, opcional) — servidores NTP por dispositivo.
- `syslog` (array, opcional) — hosts y trap-level por dispositivo.

**Notas:** Cubre también voice VLAN-related cosas indirectamente vía DHCP relay y option-150. NTP y syslog aceptan `routerModel` para fallar rápido en 1941 (PT 9 retiene solo el último `ntp server` y rechaza `logging trap` con número).

### `pt_configure_server_dhcp`

> Configure DHCP service on a Server-PT device using the native IPC API.

**Parámetros:**
- `device` (string, requerido) — nombre del Server-PT (ya colocado en el canvas).
- `port` (string, opcional) — puerto donde corre el servicio (por defecto `FastEthernet0`).
- `enable` (boolean, opcional) — encender/apagar el servicio DHCP.
- `pools` (array, opcional) — pools a crear o actualizar; idempotente por nombre.
- `removePools` (array, opcional) — pools a eliminar primero.
- `exclusions` (array, opcional) — rangos excluidos a nivel de puerto.

**Notas:** Server-PT NO expone setters para TFTP/option-150, dominio ni boot file (limitaciones documentadas en la propia descripción). Si necesitas option-150 (típico para teléfonos IP), usa `pt_apply_services` con `dhcpPools[].tftpServer` y deja que el router haga de DHCP.

### `pt_configure_subinterface`

> Build router-on-a-stick: configure 802.1Q subinterfaces on a router's parent interface (one block per VLAN).

**Parámetros:**
- `device` (string, requerido) — nombre del router.
- `parent` (string, requerido) — interfaz padre completa (p. ej. `GigabitEthernet0/0`).
- `subinterfaces` (array, requerido) — uno o más bloques con `vlan`, `ip`, `mask` y `description` opcional.

**Notas:** Hace `no shutdown` del padre antes de configurar las subinterfaces (las hijas heredan el L1 del padre). Rechaza VLANs duplicadas en el mismo padre. Solo válido para Gi/Fa; serial usa otros encapsulamientos.

### `pt_apply_wireless`

> Apply wireless SSID/security on APs and associate wireless clients through Packet Tracer's native WirelessServer/WirelessClient IPC processes.

**Parámetros:**
- `aps` (array, opcional) — SSID/seguridad por AP (canal, VLAN, PSK, etc.).
- `clients` (array, opcional) — asociaciones de clientes wireless.

**Notas:** Recordar el dead-end documentado en MEMORY: la API JS persiste `setSsid/auth/key` pero nunca dispara la asociación radio en PT 9, así que los clientes pueden no ver APs aunque la config quede grabada.

### `pt_apply_voip`

> Configure CME (telephony-service / ephone-dn / ephone) on a router and voice VLANs on an access switch through IOS CLI.

**Parámetros:**
- `cme` (array, opcional) — bloques `telephony-service` por router.
- `ephoneDns` (array, opcional) — extensiones `ephone-dn`.
- `ephones` (array, opcional) — registros de teléfonos referenciando los `dnTag`.
- `voiceVlans` (array, opcional) — voice/data VLAN por puerto de switch.

**Notas:** En PT 9, los routers arrancan con `ipbasek9`; el comando `telephony-service` no aparece sin `uck9`. Asegúrate de tener la licencia activada antes de aplicar CME.

### `pt_apply_ipv6`

> Configure dual-stack IPv6 on routers (unicast-routing, interface addresses, OSPFv3, static routes) and IPv6 hosts on PCs/laptops/servers.

**Parámetros:**
- `unicastRouting` (boolean, opcional) — emite `ipv6 unicast-routing` (por defecto `true`).
- `interfaces` (array, opcional) — direcciones IPv6 por interfaz, con OSPFv3 opcional.
- `ospf` (array, opcional) — procesos OSPFv3 por router.
- `staticRoutes` (array, opcional) — rutas estáticas IPv6.
- `endpoints` (array, opcional) — host config IPv6 en PCs/Laptops/Servers vía `ipv6config`.

**Notas:** Aplica todo por CLI excepto la configuración de hosts, que va por `ipv6config` del endpoint.

### `pt_apply_advanced_routing`

> Apply advanced routing intents (BGP, HSRP, IGP extras like passive-interface and default-information originate) to routers on the live canvas.

**Parámetros:**
- `bgp` (array, opcional) — bloques `router bgp <asn>` con neighbors/networks/redistribute.
- `hsrp` (array, opcional) — `standby <group> ip <vip>` por interfaz, con priority/preempt.
- `igpExtras` (array, opcional) — directivas extras para procesos OSPF/EIGRP/RIP existentes.

**Notas:** Cada bloque escribe `running` → `startup` por dispositivo. Aplica los IGP extras antes que BGP/HSRP para que las directivas convivan con el proceso ya creado.

## Persistence

### `pt_save_snapshot`

> Capture the current live workspace and persist it to disk under the given name. Useful for diff/audit later.

**Parámetros:**
- `name` (string, requerido) — identificador de snapshot. Solo letras, dígitos, punto, guion y guion bajo.

**Notas:** Persiste en el directorio de snapshots del servidor (no es el `.pkt` de PT, es el modelo del canvas que mantiene packet-tracer-mcp).

### `pt_load_snapshot`

> Load a saved snapshot and diff it against the live workspace.

**Parámetros:**
- `name` (string, requerido) — identificador del snapshot a cargar.

**Notas:** No restaura nada, solo compara. Reporta dispositivos/puertos/cables añadidos, eliminados y cambiados desde la captura.

### `pt_diff_snapshots`

> Compare two snapshots (or one snapshot vs the live canvas) and describe what changed.

**Parámetros:**
- `before` (string, requerido) — nombre de snapshot guardado, o el literal `live`.
- `after` (string, opcional) — nombre o `live` (por defecto `live`).

**Notas:** Si los dos lados son `live`, lo detecta y devuelve un mensaje en lugar de capturar dos veces (que daría diff vacío con ruido).

## CLI access

### `pt_run_cli`

> Send a CLI command to a router or switch and return the slice of console output produced by it.

**Parámetros:**
- `device` (string, requerido) — nombre del router o switch.
- `command` (string, requerido) — comando CLI (p. ej. `show ip interface brief`).
- `mode` (string, opcional) — pista de modo (`""`, `enable`, `global`); cadena vacía auto-detecta.

**Notas:** Para una única línea. Para bloques completos (configuraciones), usa `pt_run_cli_bulk`.

### `pt_run_cli_bulk`

> Push a multi-line CLI block (e.g. an OSPF/EIGRP stanza or a sequence of `ip nat` rules) to a device.

**Parámetros:**
- `device` (string, requerido) — nombre del dispositivo.
- `commands` (string, requerido) — bloque multilínea; las líneas vacías se ignoran.
- `tail_chars` (int, opcional) — tope de caracteres a devolver del transcript (100–20000, por defecto 2000).

**Notas:** Aplica un filtro consciente del modelo: para 2950/2960/3650/IE-3400/IE-9320 elimina automáticamente las líneas `switchport trunk encapsulation` (que esos parsers rechazan). 3560 sí las acepta y no se filtran.

## Simulation / ops

### `pt_ping`

> Run `ping <target>` on a device (PC or router) and return the parsed result.

**Parámetros:**
- `device` (string, requerido) — origen del ping.
- `target` (string, requerido) — IP destino (IPv4 o IPv6).
- `timeout_ms` (int, opcional) — espera máxima (5000–60000, por defecto 25000).

**Notas:** Auto-detecta el formato de salida PC vs router y devuelve sent/received/lost/successRate más el transcript crudo.

### `pt_traceroute`

> Run `traceroute`/`tracert` on a device and return the parsed hop list.

**Parámetros:**
- `device` (string, requerido) — origen.
- `target` (string, requerido) — IP destino.
- `timeout_ms` (int, opcional) — espera máxima (15000–120000, por defecto 60000).

**Notas:** Envía los dos nombres del comando para cubrir PC y router; el parser ignora el que rechaza el dispositivo.

### `pt_show_running`

> Capture `show running-config` (optionally filtered by `| section`) on one or more devices.

**Parámetros:**
- `devices` (array, requerido) — entre 1 y 20 dispositivos a volcar.
- `section` (string, opcional) — patrón para `| section` (p. ej. `ipv6`, `interface GigabitEthernet0/0`).
- `tail_chars` (int, opcional) — tope por dispositivo (1000–20000, por defecto 6000).

**Notas:** Útil para snapshots de estado, diffs entre recipes o confirmar que un applier aterrizó.

### `pt_simulation_mode`

> Toggle PT between Realtime and Simulation modes via the RSSwitch widget.

**Parámetros:**
- `mode` (enum, requerido) — `simulation` o `realtime`.

**Notas:** Lee el estado de vuelta vía `SimulationPanel.isPlaying` para que el caller tenga confirmación verificable. Combinar con `pt_send_pdu` y `pt_simulation_play`.

### `pt_simulation_play`

> Trigger one of the SimulationPanel buttons (play/back/forward/reset).

**Parámetros:**
- `action` (enum, requerido) — `play`, `back`, `forward` o `reset`.

**Notas:** Solo tiene efecto si PT ya está en Simulation mode (llamarlo en Realtime es no-op).

### `pt_send_pdu`

> Originate a Simple PDU (ICMP echo) from one device to another via UserCreatedPDU.addSimplePdu.

**Parámetros:**
- `source` (string, requerido) — dispositivo origen.
- `dest` (string, requerido) — NOMBRE del dispositivo destino (no acepta IPs).
- `fire` (boolean, opcional) — si `true` (por defecto), dispara y luego borra del scenario list para no dejar traza.
- `switch_to_simulation` (boolean, opcional) — si `true` (por defecto), conmuta a Simulation antes de disparar.

**Notas:** PT solo acepta nombres de dispositivo, no IPs, en `addSimplePdu`. Devuelve el índice asignado en el scenario list.

### `pt_screenshot`

> Capture the Logical workspace as a PNG/JPG file via LogicalWorkspace.getWorkspaceImage.

**Parámetros:**
- `format` (enum, opcional) — `PNG` (por defecto) o `JPG`.
- `output_path` (string, opcional) — ruta de salida; si es relativa se resuelve contra `docs/screenshots/`.

**Notas:** PT serializa la imagen en base64, el servidor la decodifica y la escribe en disco. Si `output_path` se omite, el nombre incluye timestamp.

### `pt_clear_canvas`

> Wipe the entire PT canvas (File > New) via AppWindow.fileNew. DESTRUCTIVE: removes every device, link, note and PDU in the active workspace.

**Parámetros:**
- `confirm` (literal `true`, requerido) — flag explícito para evitar wipes accidentales.
- `prompt_user` (boolean, opcional) — si `true`, PT muestra el modal de "guardar antes de nuevo" (por defecto `false`, modo scriptable).

**Notas:** Destructivo. Devuelve la lista de dispositivos que existían antes del wipe y verifica el resultado tras la operación.

## .pkt persistence

### `pt_save_pkt`

> Save the active PT canvas to a .pkt file at an absolute path via AppWindow.fileSaveAsNoPrompt.

**Parámetros:**
- `path` (string, requerido) — ruta absoluta donde escribir el `.pkt`. Crea el padre si falta.
- `overwrite` (boolean, opcional) — si `false` y el fichero existe, falla antes de llamar a PT (por defecto `true`).

**Notas:** El formato `.pkz` no se soporta (PT 9 falla en silencio al escribirlo). Espera a que el tamaño se estabilice antes de devolver, calcula SHA-1 vía PT y comprueba si el filesystem del servidor también ve el fichero.

### `pt_open_pkt`

> Open a .pkt file into the active PT workspace via AppWindow.fileOpen.

**Parámetros:**
- `path` (string, requerido) — ruta absoluta legible por el proceso PT.
- `replace` (boolean, opcional) — si `true` (por defecto), limpia el canvas con `fileNew(false)` antes; si `false`, hace MERGE (comportamiento nativo de `fileOpen`).

**Notas:** PT 9 cifra `.pkt` con derivación de clave por fichero, así que no hay magic bytes que validar; la validez la decide PT con `FileOpenReturnValue=0`. Reporta deviceCount antes/después.

### `pt_save_pkt_to_bytes`

> Save the active PT canvas and return the .pkt as base64 bytes (no permanent file).

**Parámetros:**
- `max_bytes` (int, opcional) — tope de tamaño aceptado (por defecto 5 MB).

**Notas:** PT escribe a un temp dentro de su user folder, el servidor lo lee por chunks vía `SystemFileManager.getFileBinaryContents` y luego PT borra el temp. Útil cuando servidor y PT no comparten filesystem. Cross-checkea SHA-1 entre PT y el buffer reensamblado.

### `pt_open_pkt_from_bytes`

> Open a .pkt provided as base64 bytes (no permanent file required on disk).

**Parámetros:**
- `bytes_base64` (string, requerido) — contenido del `.pkt` en base64.
- `replace` (boolean, opcional) — si `true` (por defecto), wipea el canvas antes; si `false`, MERGE.
- `max_bytes` (int, opcional) — tope decodificado (por defecto 2 MB).

**Notas:** El servidor manda los bytes a un temp PT-side vía `writeBinaryToFile`, dispara `fileOpen` y limpia el temp. Sin magic bytes que validar; la validez se decide por `FileOpenReturnValue=0`.

## Escape hatch

### `pt_send_raw`

> Escape hatch: ship arbitrary JS to PT's Script Engine. Useful when no specialised tool covers what you need yet.

**Parámetros:**
- `code` (string, requerido) — expresión JS a evaluar dentro del Script Engine de PT (envuelta implícitamente, así que se puede usar `return ...`).
- `wait` (boolean, opcional) — si `true` (por defecto), espera el resultado; si `false`, fire-and-forget.
- `timeout_ms` (int, opcional) — timeout en ms (máx. 60000).

**Notas:** Cuando exista una tool tipada que cubra el caso, preferirla a `pt_send_raw`. Etiqueta cada llamada con un fragmento del código para facilitar el debug en logs.
