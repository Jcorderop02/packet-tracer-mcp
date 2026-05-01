# Cobertura verificada contra Packet Tracer 9

Este documento resume **qué partes de `packet-tracer-mcp` están comprobadas
contra una instancia real de Cisco Packet Tracer 9.0.0.0810** y cuáles
no. Cada fila enlaza al smoke run que la respalda.

> Los enlaces a `smoke-runs/` apuntan a transcripts internos generados
> por `bun run scripts/smoke.ts`. No se publican (son ruidosos y de
> tamaño desproporcionado para un README), pero las rutas se conservan
> aquí como referencia trazable: si reproduces la suite localmente,
> tendrás los mismos identificadores.

---

## Estados

| Estado | Significado |
|--------|-------------|
| ✅ `verified-pt9` | Probado contra PT 9 real, output capturado en `docs/smoke-runs/`. |
| ☑️ `contract-verified` | Existencia y firma del método confirmadas en PT 9 vía probe API. No garantiza comportamiento end-to-end, solo que el método está expuesto. |
| 🟡 `assumed-ok` | No probado en aislamiento, pero forma parte de una receta que sí pasa end-to-end. |
| ⚠️ `partial` | Funciona en parte; el alcance se indica en la fila. |
| ❌ `broken` | Probado y falla; se documenta el motivo y el workaround. |
| ⛔ `dead-end` | Imposible con la API JS pública de PT 9. Requiere cambios en Cisco. |

Una línea está completa cuando aparece `verified-pt9` con un enlace al
smoke. `contract-verified` es un estado intermedio honesto que evita
prometer de más.

---

## Catálogo de dispositivos

**54 / 54 modelos `verified-pt9`** — colocación, conteo de puertos,
nombres de puertos físicos y eliminación validados contra PT 9.0.0.0810.

| Familia | Modelos | Estado |
|---------|---------|--------|
| Routers G1 (FastEthernet) | `1841`, `2620XM`, `2621XM`, `2811` | ✅ `verified-pt9` |
| Routers G2 (GigabitEthernet) | `1941`, `2901`, `2911` | ✅ `verified-pt9` |
| Routers ISR4xxx / NIM | `ISR4321`, `ISR4331` | ✅ `verified-pt9` |
| Routers branch / industrial | `819HG-4G-IOX`, `819HGW`, `829`, `CGR1240`, `IR1101`, `IR8340` | ✅ `verified-pt9` |
| Routers genéricos PT | `Router-PT`, `Router-PT-Empty` | ✅ `verified-pt9` |
| Switches L2 | `2950-24`, `2950T-24`, `2960-24TT`, `Switch-PT`, `Switch-PT-Empty` | ✅ `verified-pt9` |
| Multilayer L3 | `3560-24PS`, `3650-24PS` | ✅ `verified-pt9` |
| Industrial Ethernet | `IE-2000`, `IE-3400`, `IE-9320` | ✅ `verified-pt9` |
| Firewalls (ASA) | `5505`, `5506-X`, `ISA-3000` | ✅ `verified-pt9` |
| Endpoints | `PC-PT`, `Server-PT`, `Laptop-PT`, `Printer-PT`, `TabletPC-PT`, `SMARTPHONE-PT`, `TV-PT`, `Home-VoIP-PT`, `Analog-Phone-PT`, `7960` | ✅ `verified-pt9` |
| Wireless | `AccessPoint-PT`, `AccessPoint-PT-A/AC/N`, `Linksys-WRT300N`, `HomeRouter-PT-AC` | ✅ `verified-pt9` (ver §Wireless) |
| Otros | `Cloud-PT`, `Cloud-PT-Empty`, `Hub-PT`, `Bridge-PT`, `Repeater-PT`, `Cable-Modem-PT`, `DSL-Modem-PT` | ✅ `verified-pt9` |
| Boot-rommon (excluido del CLI) | `PT8200` | ✅ `verified-pt9` (skip CLI) |

Atributo `cliMode` distingue la personalidad de arranque del CLI:

- `"ios"` — prompt `Router>`/`Switch>` directo (default).
- `"rommon"` — arranca en ROM Monitor; comandos IOS no aplican. Único:
  `PT8200`. Las herramientas que dependen del CLI lo skipean.
- `"pnp"` — IOS XE 17.x con `Enter enable secret:` mandatorio en boot.
  Modelos: `IR1101`, `IR8340`, `IE-9320`. El runner inyecta una password
  fuerte automáticamente para desbloquear el prompt.

CLI por modelo verificado con la batería `(empty) → enable → show
version | include IOS → show ip interface brief → configure terminal →
hostname __SMK_PROBE → end → show running-config | include hostname`:
**27 PASS / 1 SKIP (rommon)**.

---

## Operaciones de canvas (IPC)

Primitivas que generan los builders de `src/ipc/generator.ts`. Estas son
las piezas que toda receta y toda tool MCP usa por debajo.

| Pieza | Estado | Evidencia |
|-------|--------|-----------|
| Crear dispositivo (`addDevice` + `setName`) | ✅ `verified-pt9` | smoke 2026-04-28_201321 |
| Eliminar dispositivo (`removeDevice`) | ✅ `verified-pt9` | smoke 2026-04-28_201321 |
| Crear link (`createLink` + verificación `port.getLink()` + `isPortUp`/`isProtocolUp`) | ✅ `verified-pt9` | smoke 2026-04-28_205159 (RCP-EDGE-NAT) |
| Eliminar link (`deleteLink`) | ✅ `verified-pt9` | cleanup transitivo en cada smoke |
| Mover dispositivo (`moveToLocation`) | ☑️ `contract-verified` | probe API |
| Renombrar dispositivo (`setName`) | ☑️ `contract-verified` | probe API |
| Enviar comando CLI (`enterCommand`, firma 1-arg en PT 9) | ✅ `verified-pt9` | smoke 2026-04-28_201321 |
| Bulk CLI multi-línea | ✅ `verified-pt9` | smoke 2026-04-28_201321 |
| Auto-conectar dos dispositivos (`autoConnectDevices`) | ✅ `verified-pt9` | probe-autoconnect 2026-04-28 (4 pares: R↔S, S↔S, PC↔S, R↔R) |
| Listar dispositivos del canvas | ✅ `verified-pt9` | smoke 2026-04-28_201321 |
| Inspeccionar puertos / módulos | ✅ `verified-pt9` | smoke 2026-04-28_201321 |
| IP estática en endpoint (`HostPort.setIpSubnetMask` + `setDefaultGateway`) | ✅ `verified-pt9` | RCP-EDGE-NAT, RCP-IPV6-LAB |
| DHCP en endpoint (`Pc.setDhcpFlag` + `HostPort.setDhcpClientFlag` + `ipconfig /renew`) | ✅ `verified-pt9` | smoke 2026-04-28_205159 (RCP-EDGE-NAT) |
| Insertar módulo (`Module.addModuleAt(name, bay)` con descenso por chassis) | ✅ `verified-pt9` (1941) | smoke 2026-04-29_092326 |

**Detalle clave sobre inserción de módulos**: la API real es
`Module.addModuleAt(name, bay)` llamada sobre el módulo padre correcto,
alcanzado por descenso `getModuleAt(idx)` desde `getRootModule()`.
`Device.addModule(...)` retorna `false` uniformemente en todos los
modelos probados — las herramientas MCP usan el descenso correcto. Hay
7 patrones de chassis distintos (HWIC chassis-sub, NM root-direct,
mixto, NIM con BUILTIN, slot directo, chassis fijo, multi-root); 5 de
ellos son `verified-pt9` y los modelos análogos están marcados como
soportados en el catálogo.

---

## L2 — Switching

Receta `campus_vlan` (router-on-a-stick) `verified-pt9` end-to-end con
ping inter-VLAN en [smoke RCP-CAMPUS-VLAN](smoke-runs/2026-04-28_210016.md).

| Capacidad | Modelo verificado | Estado | Notas |
|-----------|-------------------|--------|-------|
| VLANs (`vlan N / name X`) | 2960-24TT | ✅ `verified-pt9` | F2-VLAN-BASIC |
| Access port (`switchport mode access` + `access vlan`) | 2960-24TT | ✅ `verified-pt9` | F2-VLAN-BASIC |
| Trunk dot1q (`switchport mode trunk` + `allowed vlan` + `native vlan`) | 2960-24TT | ✅ `verified-pt9` | F2-TRUNK-DOT1Q |
| `switchport trunk encapsulation dot1q` literal | 2960-24TT | ❌ `broken` | El 2960 real (y PT 9) lo rechaza; el builder ya omite la línea para 2960/3650. |
| Subinterfaces dot1Q (`Gi0/0.10 / encapsulation dot1Q 10 / ip address …`) | 1941 | ✅ `verified-pt9` | desbloquea `campus_vlan` |
| Port-security (`maximum`, `mac-address sticky`, `violation`) | 2960-24TT | ✅ `verified-pt9` | F2-L2-EXTRAS |
| `interface range Fa0/1,Fa0/2,Fa0/3` (con comas) | 2960-24TT | ✅ `verified-pt9` | F2-L2-EXTRAS |
| EtherChannel (`channel-group N mode on`) | 2960-24TT | ✅ `verified-pt9` | Port-channel1 visible en `show etherchannel summary` |

API nativa de `SwitchPort` (alternativa al CLI): `setAccessPort`,
`setAccessVlan`, `addTrunkVlans`, `setNativeVlanId`, `setVoipVlanId`,
`setAdminOpMode`. Aplicada y verificada por re-lectura del modelo.

---

## L3 — Servicios

Receta `edge_nat` (DHCP + NAT overload + ACL) `verified-pt9` end-to-end
con DHCP, ping ISP y NAT translation en
[smoke RCP-EDGE-NAT](smoke-runs/2026-04-28_205159.md).

| Capacidad | Modelo verificado | Estado | Notas |
|-----------|-------------------|--------|-------|
| ACL numerada estándar (`access-list 1 permit …`) | 1941 | ✅ `verified-pt9` | F3-ACL-NUMBERED |
| ACL numerada extendida (`access-list 100 permit tcp …`) | 1941 | ✅ `verified-pt9` | PT renderiza `eq 80` → `eq www` (alias estándar Cisco) |
| ACL nombrada estándar / extendida | 1941 | ✅ `verified-pt9` | sub-modos `(config-std-nacl)` / `(config-ext-nacl)` |
| `ip access-group … in/out` en interfaz | 1941 | ✅ `verified-pt9` | F3-ACL-NUMBERED |
| `no access-list NAME` (reemplazo) | 1941 | ✅ `verified-pt9` | F3-L3-EXTRAS |
| NAT inside / outside (`ip nat inside` / `outside`) | 1941 | ✅ `verified-pt9` | F3-NAT-PAT |
| NAT static 1:1 + port-forward (TCP) | 1941 | ✅ `verified-pt9` | F3-L3-EXTRAS |
| NAT pool + overload | 1941 | ✅ `verified-pt9` | F3-L3-EXTRAS |
| PAT con `interface Gi0/0 overload` | 1941 | ✅ `verified-pt9` | RCP-EDGE-NAT, ICMP translation visible |
| DHCP pool (`network`, `default-router`, `dns-server`) | 1941 | ✅ `verified-pt9` | F3-DHCP-POOL |
| DHCP cliente en PC-PT desde pool | PC-PT | ✅ `verified-pt9` | RCP-EDGE-NAT (192.168.0.7/24 + gateway) |
| DHCP relay (`ip helper-address`) | 1941 | ✅ `verified-pt9` (CLI) | end-to-end multi-router pendiente de smoke |
| DHCP server en Server-PT (API IPC nativa, `pt_configure_server_dhcp`) | Server-PT | ✅ `verified-pt9` | smoke 2026-04-29_141114 (F12-DHCP-SERVER). Setters confirmados: `addPool`, `setNetworkMask(network,mask)`, `setDefaultRouter`, `setStartIp`, `setEndIp`, `setDnsServerIp`, `setMaxUsers`, `addExcludedAddress`. Trampa: `setNetworkMask` requiere 2 args (network, mask), no 1. |
| DHCP option-150 / TFTP en Server-PT | Server-PT | ⛔ `dead-end` | `DhcpPool` carece de `setTftpAddress` / `setOption*` / `setBootFile` (24 métodos enumerados). Para option-150 mover el DHCP al router (CLI `option 150 ip <ip>` vía `pt_apply_services` con `tftpServer`). Si el escenario fuerza Server-PT, el campo "TFTP Server" hay que rellenarlo a mano en GUI. |
| DHCP option-150 en pool de router (`option 150 ip <ip>`) | 1941/2811 | ✅ `verified-pt9` (CLI) | `pt_apply_services` con `dhcpPools[].tftpServer`. |
| `ntp server X` | 1941 | ⚠️ `partial` | PT 9 retiene un único NTP server a la vez (el segundo sobreescribe) |
| `logging host X` | 1941 | ✅ `verified-pt9` | PT renderiza `logging host A.B.C.D` → `logging A.B.C.D` (forma legacy) |
| `logging trap [level]` | 1941 | ❌ `broken` | PT 9 no implementa `logging trap` con argumento; emite todo en debug. Confirmado por hilos Cisco Community. |

---

## Routing dinámico

| Protocolo | Estado | Notas |
|-----------|--------|-------|
| OSPF v2 | ✅ `verified-pt9` | API nativa `OspfProcess` + setters por interfaz (`ipv6 ospf <pid> area 0` para v3). |
| OSPF v3 (IPv6) | ✅ `verified-pt9` | Receta `ipv6_lab`. |
| EIGRP | 🟡 `assumed-ok` | API nativa `EigrpProcess` documentada; cubierto vía `dual_isp`. |
| RIP | 🟡 `assumed-ok` | API nativa `RipProcess` documentada. |
| BGP | ✅ `verified-pt9` (CLI) | No hay `BgpProcess` en la API JS de PT 9 — implementado por CLI clásico (`router bgp`). |
| HSRP | ✅ `verified-pt9` (CLI) | No hay `HsrpProcess` — implementado por CLI clásico (`standby N ip …`). |

Receta `dual_isp` `verified-pt9` (BGP + HSRP combinados).

---

## IPv6

Receta `ipv6_lab` `verified-pt9` en
[smoke RCP-IPV6-LAB](smoke-runs/2026-04-29_072834.md).

| Capacidad | Estado | Notas |
|-----------|--------|-------|
| `ipv6 unicast-routing` global | ✅ `verified-pt9` | router 2911 |
| `ipv6 address 2001:DB8::1/64` + `ipv6 enable` por interfaz | ✅ `verified-pt9` | global + link-local FE80:: |
| OSPFv3 (`ipv6 router ospf <pid>` + `router-id` + `ipv6 ospf <pid> area 0`) | ✅ `verified-pt9` | dual-stack con IPv4 estática |
| `ipv6config <addr>/<prefix> <gateway>` en PC-PT | ✅ `verified-pt9` | shell de PC |
| Validador rechaza `2001::DB8::1/64` (dos `::`), prefijos > 128, hex inválido, IPv4 en next-hop v6 | ✅ `verified-pt9` | tests unitarios + receta |

API nativa IPv6 disponible en `HostPort` (verified contract):
`setIpv6Enabled`, `addIpv6Address`, `setIpv6LinkLocal`, `setv6DefaultGateway`,
`setIpv6AddressAutoConfig`, `isSetToDhcpv6`.

---

## Wireless (parcial — limitación de la API)

Receta `wifi_lan` marcada **`dead-end`** en su forma actual. La API JS
pública de PT 9 persiste configuración (`setSsid`, `setEncryptType`,
`getWpaProcess().setKey(…)`) pero **no dispara la asociación radio**:
`WirelessClientProcess.getCurrentNetworkCount()` siempre devuelve `0`,
con o sin perfiles, en cualquier variante probada (siete estrategias
distintas, ver memoria interna).

| Pieza | Estado | Notas |
|-------|--------|-------|
| `pt_apply_wireless` configura SSID + WPA2-PSK en `AccessPoint-PT` | ⚠️ `partial` | setters retornan OK pero el efecto sobre la radio no es observable. |
| Asociación cliente `Laptop-PT` ↔ AP | ⛔ `dead-end` | la simulación radio vive en el sub-IPC C++ no expuesto. |
| DHCP del cliente wireless tras asociación | ⛔ `dead-end` | bloqueado por la asociación. |

**Reabrir si**: Cisco pública una API JS documentada para asociación
radio o se libera un canal IPC firmado para terceros.

---

## VoIP

Receta `voip_lab` `verified-pt9`. El router 1941 / 2911 arranca con
`ipbasek9`; hay que activar el feature-set `uck9` con
`license boot module c2900 technology-package uck9` + `reload` para que
`telephony-service` aparezca en el parser CLI. La receta lo hace
automáticamente.

| Capacidad | Estado | Notas |
|-----------|--------|-------|
| `license boot module … technology-package uck9` + reload | ✅ `verified-pt9` | sin esto, `telephony-service` no existe |
| `telephony-service` + `max-ephones` + `max-dn` + `ip source-address` | ✅ `verified-pt9` | RCP-VOIP-LAB |
| `ephone-dn N` + `number …` | ✅ `verified-pt9` | RCP-VOIP-LAB |
| Teléfono 7960: typeId=12, ptType="7960", único puerto cableable es `Port 0` | ✅ `verified-pt9` | otros nombres responden a `getPort` pero `createLink` falla |
| `option 150 ip <ip>` en DHCP pool (TFTP del CME) | ✅ `verified-pt9` | RCP-VOIP-LAB |

---

## Simulación y operaciones

Smoke `RCP-SIM-OPS` `verified-pt9` en
[smoke 2026-04-29_080146](smoke-runs/2026-04-29_080146.md). Pieza
verificada con `scripts/probe-fase8b.ts` antes del smoke.

| Capacidad | Estado | Notas |
|-----------|--------|-------|
| `pt_ping` desde PC y desde router IOS | ✅ `verified-pt9` | parser cubre ambos formatos |
| `pt_traceroute` (`traceroute` IOS, `tracert` PC) | ✅ `verified-pt9` | parser idéntico a ping |
| `pt_show_running` con `\| section` opcional | ✅ `verified-pt9` | indispensable: PT 9 usa `\| section` no `interface <name>` |
| `pt_simulation_mode` toggle Realtime ↔ Simulation | ✅ `verified-pt9` | vía `RSSwitch.showSimulationMode/showRealtimeMode` |
| `pt_simulation_play` play / back / forward / reset | ✅ `verified-pt9` | vía `SimulationPanel` |
| `pt_send_pdu` originar Simple PDU PC→PC | ✅ `verified-pt9` | `addSimplePdu(name, name)`. IPs como destino devuelven 30 (no aceptadas). |
| `pt_screenshot` PNG/JPG | ✅ `verified-pt9` | `LogicalWorkspace.getWorkspaceImage` con magic bytes verificados |
| `pt_clear_canvas` (`fileNew(false)`) con `confirm:true` literal | ✅ `verified-pt9` | exige flag explícito como guard contra wipes accidentales |

**Sobre reactividad**: `registerObjectEvent` existe en la API JS pero
acepta cualquier nombre sin validar y nunca entrega callbacks
(verificado en 4 rondas de probe con 12 firmas distintas). El MCP usa
polling sobre el bridge HTTP (~500 ms), que para verificar `link up`
post-`createLink` baja a <1 s con `linkUpStatusJs` (un único IPC call
con `port.getLink() + isPortUp() + isProtocolUp()`).

---

## Inspección read-only (Fase 11)

Tools añadidas en 2026-04-29 que cubren huecos del API JS de PT 9 sin
romper la filosofía canvas-first (todas leen estado vivo, no plan).
Las 8 verificadas pasan smoke directo contra PT 9.0.0.0810 en
[`smoke-runs/2026-04-29_125057.md`](smoke-runs/2026-04-29_125057.md).

| Capacidad | Tool | Estado | Evidencia |
|-----------|------|--------|-----------|
| `Device.setPower(bool)` con readback | `pt_set_device_power` | ✅ `verified-pt9` | F11-POWER PASS 5985 ms — off → on → on (already=true). |
| `VlanManager.getVlanAt` por switch | `pt_read_vlans` | ✅ `verified-pt9` | F11-VLAN-READ PASS 11006 ms — default `vlan 1` + VLAN 42 custom tras CLI. |
| `Port.isPortUp/isProtocolUp/getMacAddress/IP` | `pt_inspect_ports` | ✅ `verified-pt9` | F11-PORTS PASS 10497 ms — `link=1` + IP `10.99.0.1` en par cableado. |
| `AclProcess.getAclAt/getCommandAt` | `pt_read_acl` | ✅ `verified-pt9` | F11-ACL PASS 5502 ms — `access-list 10 permit` configurada por CLI y leída de vuelta. |
| `show ip bgp` parseado | `pt_show_bgp_routes` | ⚠️ `partial` | Parser tolerante a filas heterogéneas. Sin `BgpProcess` JS, esta es la única ruta. Verificado transitivamente con `dual_isp`. |
| `Device.getRootModule` per-device | `pt_list_modules` (modo `device`) | ✅ `verified-pt9` | F11-MODULES-LIVE PASS 5000 ms — header `ROOT\|...` + conteo de slots del 1941. |
| `LogicalWorkspace.getRootCluster` + `removeCluster`/`unCluster` | `pt_manage_clusters` | ✅ `verified-pt9` | F11-CLUSTERS PASS 493 ms. **Limitación**: `addCluster()` requiere selección UI no programable; sólo se expone read + remove. **Trampa**: `Cluster.getXCoordinate/getYCoordinate` sobre el root crashea PT nativamente (EXC_BAD_ACCESS, no atrapable desde JS); el walker salta coords cuando `parentId === ""`. |
| `LogicalWorkspace.addNote/drawLine/drawCircle` | `pt_add_canvas_annotation` | ✅ `verified-pt9` | F11-ANNOTATIONS PASS 1501 ms. **Trampa**: `drawCircle` toma 7 args `(x, y, radius, r, g, b, a)` — sin `thickness`, a diferencia de `drawLine` (9 args). |
| `NetworkFile.getNetworkDescription/getVersion/getSavedFilename` | `pt_read_project_metadata` | ✅ `verified-pt9` | F11-PROJECT-META PASS 507 ms. **Trampa**: el `NetworkFile` se obtiene con `appWindow().getActiveFile()`; `Workspace.getNetworkFile()` no existe. |

---

## Persistencia `.pkt`

| Capacidad | Estado | Evidencia |
|-----------|--------|-----------|
| `pt_save_pkt(path)` (filesystem compartido) | ✅ `verified-pt9` | [smoke RCP-PKT-IO](smoke-runs/2026-04-29_084209.md) PASS 8.9 s |
| `pt_open_pkt(path, replace=true)` | ✅ `verified-pt9` | mismo smoke; `FileOpenReturnValue=0` es la única señal autoritativa de validez |
| `pt_save_pkt_to_bytes(max_bytes)` (transporte in-memory) | ✅ `verified-pt9` | [smoke RCP-PKT-BYTES](smoke-runs/2026-04-29_084243.md) PASS 20.9 s |
| `pt_open_pkt_from_bytes(b64, replace=true, max_bytes)` | ✅ `verified-pt9` | mismo smoke; SHA-1 cross-check + cleanup de temps |
| Formato `.pkz` (comprimido) | ⛔ `dead-end` | `fileSaveAsPkzAsync` despacha pero el archivo nunca llega a disco. PT 9 no produce bytes válidos. |

**Detalles importantes**:

- Los `.pkt` están **cifrados** con derivación de clave per-file
  (Twofish-style). Los primeros bytes varían entre saves del mismo
  canvas — no hay magic estable, la única validación autoritativa es el
  `FileOpenReturnValue=0` que devuelve PT tras `fileOpen`.
- Las herramientas exigen **path absoluto**.
- Detección de fin-de-save por polling de `getFileSize` con ventana
  estable de 800 ms y tick de 200 ms (porque `fileSaveDone` no se puede
  capturar desde el Script Engine).
- `replace=true` (default) ejecuta `fileNew(false)` antes de abrir, sin
  modal de confirmación. `replace=false` preserva el merge nativo de PT.
- Defaults para tools de bytes: 5 MB para save, 2 MB para open. Para
  canvases grandes, usar las variantes con `path`.

---

## Recetas de topología

| Receta | Estado | Notas |
|--------|--------|-------|
| `chain` | 🟡 `assumed-ok` | base; cubierto transitivamente por otras recetas |
| `star` | 🟡 `assumed-ok` | igual |
| `branch_office` | 🟡 `assumed-ok` | igual |
| `campus_vlan` | ✅ `verified-pt9` | RCP-CAMPUS-VLAN PASS, ping inter-VLAN OK |
| `edge_nat` | ✅ `verified-pt9` | RCP-EDGE-NAT PASS, DHCP + NAT translation OK |
| `dual_isp` | ✅ `verified-pt9` | RCP-DUAL-ISP PASS (BGP + HSRP) |
| `voip_lab` | ✅ `verified-pt9` | RCP-VOIP-LAB PASS (uck9 + telephony-service + ephone-dn) |
| `ipv6_lab` | ✅ `verified-pt9` | RCP-IPV6-LAB PASS 49.4 s, dual-stack + OSPFv3 |
| `wifi_lan` | ⛔ `dead-end` | bloqueada por la asociación radio (ver §Wireless) |

---

## Limitaciones conocidas de PT 9

Las que afectan a usuarios — no son bugs del MCP, son comportamiento
del simulador. Documentadas para que la sorpresa nunca caiga del lado
del cliente.

1. **Ningún router trae puertos seriales por defecto.** Serial requiere
   un módulo HWIC (`HWIC-2T` típicamente) en un slot compatible.
2. **`switchport trunk encapsulation dot1q` rechazado en 2960/3650.** Es
   Cisco estándar, no bug de PT. El builder lo omite para esos modelos
   y lo conserva para 3560/3750.
3. **`logging trap [level]` no funciona en PT 9.** Tampoco
   `logging console <level>` ni `logging buffered <level>`. Solo
   `logging host <ip>` funciona. PT 9 emite todo en severity `debug`
   sin filtrado. Confirmado por hilos Cisco Community.
4. **Un único `ntp server` retenido a la vez.** El segundo sobreescribe
   al primero. En IOS real se admiten múltiples — cuando el target es
   PT 9, declara solo uno.
5. **`logging host A.B.C.D` se renderiza como `logging A.B.C.D`** en
   running-config (forma legacy, ambas válidas en IOS real).
6. **`terminal length 0` rechazado en 1941.** Para evitar el pager
   `--More--` en outputs largos, usar `| include` o `| section`.
7. **Switches IOS clásico (2950/2960/3560/3650) usan `--More--`** y
   consumen los primeros chars del siguiente comando como keystrokes
   del pager. El MCP drena `--More--` antes de mandar el siguiente.
8. **IOS XE 17.x exige `enable secret` fuerte en el primer boot**
   (modelos `IR1101`, `IR8340`, `IE-9320`). El MCP inyecta una password
   válida automáticamente. Sin ese bootstrap el CLI queda bloqueado en
   `Enter enable secret:`.
9. **PT8200 arranca en ROM Monitor**, no en IOS. Comandos IOS devuelven
   `monitor: command "X" not found`. El catálogo lo marca con
   `cliMode: "rommon"` y las tools que dependen de IOS lo skipean.
10. **DHCP en PC-PT requiere flag a tres niveles**: `Pc.setDhcpFlag(true)`
    + `HostPort.setDhcpClientFlag(true)` + `ipconfig /renew`. Sin los
    tres, el cliente puede quedarse en `0.0.0.0`. El MCP lo hace por ti.
11. **`HostPort.getIpAddress()` puede quedarse stale tras DHCP** en
    PC-PT. Para validar DHCP en endpoints, leer también el buffer CLI
    de `ipconfig`.
12. **`createLink` no es síncrono ni suficiente**. Hay que esperar a
    que `port.getLink() + isPortUp() + isProtocolUp()` devuelvan `up`
    antes de direccionar la interfaz. El MCP lo hace por ti.

---

## Cómo se verifica algo

```bash
# 1. Abrir Packet Tracer 9 con la extensión MCP Bridge activa
#    (ver docs/BOOTSTRAP.md).
# 2. Asegurarse de que ningún MCP server esté corriendo (el bridge libre).
bun run scripts/smoke.ts                     # suite completa
bun run scripts/smoke.ts --case campus_vlan  # un solo caso
```

El runner:

- Arranca un `Bridge` en `:54321`.
- Espera al menos un `GET /next` del webview (= bootstrap activo).
- Ejecuta cada caso registrado.
- Guarda el transcript completo en `docs/smoke-runs/YYYY-MM-DD_HHMMSS.md`
  con cada test marcado PASS / FAIL / TIMEOUT.
- Sale con código != 0 si algo falla.

Para validación manual sin smoke runner:

1. PT abierto + bridge activo + `bun run start` corriendo.
2. Desde el cliente MCP: `pt_cook_topology recipe=campus_vlan params={"vlans":2,"pcsPerVlan":1}`.
3. `pt_run_cli SW "show vlan brief"` → VLAN 10 y 20 con un puerto cada una.
4. `pt_run_cli GW "show running-config | section interface GigabitEthernet0/0"` → parent + 2 subinterfaces.
5. `pt_run_cli PC_V10_1 "ping 192.168.1.1"` → debería contestar.

---

## Cobertura por números

- **54 / 54** modelos del catálogo `verified-pt9`.
- **27 / 27 + 1 SKIP** modelos en la batería CLI por-modelo (`PT8200`
  rommon excluido por diseño).
- **57 tools MCP** entregadas, todas con tests unitarios y la mayoría
  con cobertura de smoke directa o transitiva. Las 9 últimas (Fase 11:
  `pt_set_device_power`, `pt_read_vlans`, `pt_inspect_ports`,
  `pt_read_acl`, `pt_show_bgp_routes`, `pt_list_modules` per-device,
  `pt_manage_clusters`, `pt_add_canvas_annotation`,
  `pt_read_project_metadata`) cubren inspección read-only y
  primitivas atómicas que antes estaban implícitas en `pt_mend_canvas`
  o `pt_send_raw`. 8 de las 9 son `verified-pt9` directo
  ([smoke 2026-04-29_125057](smoke-runs/2026-04-29_125057.md));
  `pt_show_bgp_routes` queda en `partial` por falta de `BgpProcess` JS,
  verificado transitivamente vía `dual_isp`.
- **9 recetas de topología**: 5 `verified-pt9` end-to-end, 3
  `assumed-ok` (cubiertas transitivamente), 1 `dead-end` (`wifi_lan`,
  por limitación de la API de PT).
- **Fases verificadas end-to-end**: L2 switching, L3 servicios (NAT +
  ACL + DHCP), routing dinámico (OSPF/BGP/HSRP/EIGRP), IPv6, VoIP,
  simulación y operaciones, persistencia `.pkt`.

---

*Última actualización: 2026-05-01.*
