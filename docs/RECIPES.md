# Recetas

Una **receta** es una topología parametrizada. Le pasas dos o tres
números (cuántos routers, cuántos PCs, qué protocolo de routing) y el
servidor monta el escenario entero en Packet Tracer: añade devices,
cablea, configura IPs y deja routing/DHCP/VLANs funcionando. La idea
es que en una llamada tengas un lab listo para hacer `pt_ping` o
`pt_show_running`.

El listado vive en `src/recipes/index.ts`. En runtime lo puedes pedir
con `pt_list_recipes`.

> [!TIP]
> Si vas a montar algo con 3 o más routers, antes pasa por
> `pt_plan_review`. Te dice si lo que has pedido tiene sentido,
> cuántos comandos va a emitir y avisa de gotchas conocidos (la
> encapsulación de trunks en IE-9320, el NTP-multi que está roto en
> todos los routers de PT 9, ese tipo de cosas).

---

## Índice

- [Chain](#chain)
- [Star](#star)
- [Branch office](#branch_office)
- [Campus vlan](#campus_vlan)
- [Edge nat](#edge_nat)
- [Wifi lan](#wifi_lan)
- [Voip lab](#voip_lab)
- [Ipv6 lab](#ipv6_lab)
- [Dual isp](#dual_isp)

---

## chain

> N routers en serie; cada uno con un switch y M PCs.

**Parámetros:**
- `routers` (int, requerido, ≥2) — número de routers en cadena.
- `pcsPerLan` (int, requerido, ≥0) — PCs colgando del switch de cada router.
- `routerModel` (string, opcional) — modelo de router (default 1941).
- `switchModel` (string, opcional) — modelo de switch.
- `pcModel` (string, opcional) — modelo de PC.
- `routing` (`none|static|ospf|rip|eigrp`, opcional) — protocolo en los enlaces inter-router.
- `dhcp` (bool, opcional) — si es `true`, los PCs reciben IP por DHCP del router local.

**Ejemplo:**

```json
{ "recipe": "chain", "routers": 3, "pcsPerLan": 2, "routing": "ospf", "dhcp": true }
```

**Resultado esperado:** R1—R2—R3 conectados por enlaces /30, cada uno
con un switch y 2 PCs en LAN /24, OSPF en area 0 y DHCP local.

**Limitaciones:** A partir de 6 routers el wizard del IOS empieza a
encolarse; mejor partir en dos llamadas o subir a recipes con switching
intermedio.

---

## star

> Hub router con N spoke routers; cada spoke posee una LAN.

**Parámetros:**
- `spokes` (int, requerido, ≥1) — número de routers spoke.
- `pcsPerSpoke` (int, requerido, ≥0).
- `hubModel`, `spokeModel`, `switchModel`, `pcModel` (string, opcional).
- `routing` (string, opcional).
- `dhcp` (bool, opcional).

**Ejemplo:**

```json
{ "recipe": "star", "spokes": 4, "pcsPerSpoke": 1, "routing": "ospf" }
```

**Resultado esperado:** Hub central con 4 enlaces /30 hacia spokes;
cada spoke con su LAN. Hub anuncia ruta default a los spokes si
`routing: static`; OSPF area 0 si `routing: ospf`.

---

## branch_office

> HQ con una o dos LANs + sucursal remota con su propia LAN.

**Parámetros:**
- `pcsPerLan` (int, requerido, ≥0).
- `hqLans` (1 o 2, opcional, default 1).
- `hqModel`, `branchModel`, `switchModel`, `pcModel` (string, opcional).
- `routing` (string, opcional).
- `dhcp` (bool, opcional).

**Ejemplo:**

```json
{ "recipe": "branch_office", "hqLans": 2, "pcsPerLan": 2, "routing": "ospf", "dhcp": true }
```

**Resultado esperado:** HQ con 2 LANs cada una en su switch + WAN /30
contra BRANCH, que tiene su propia LAN. OSPF entre los dos.

---

## campus_vlan

> Router-on-a-stick: un router + un switch de acceso con N VLANs y M PCs por VLAN.

**Parámetros:**
- `vlans` (int, requerido, 1..16) — número de VLANs.
- `pcsPerVlan` (int, requerido, ≥0).
- `startVlanId` (int, opcional, 2..4094, default 10).
- `vlanStep` (int, opcional, ≥1, default 10).
- `routerModel`, `switchModel`, `pcModel` (string, opcional).
- `lanPool` (string, opcional) — ej. `"192.168.0.0/16"`.
- `routing` (string, opcional).

**Ejemplo:**

```json
{ "recipe": "campus_vlan", "vlans": 4, "pcsPerVlan": 2 }
```

**Resultado esperado:** Router con subinterfaces `Gi0/0.10`, `.20`,
`.30`, `.40`. Switch con esas VLANs creadas, PCs en puertos access. El
trunk router-switch lleva todas las VLANs.

**Limitaciones:**
- IE-9320 no acepta `switchport trunk encapsulation`. Si usas ese
  switch, la receta usa CLI puro para el trunk (configurado en
  `services/cli.ts`).
- 1941 con muchas subinterfaces consume memoria; para 16 VLANs sube a
  2911.

---

## edge_nat

> Router edge con PAT hacia el ISP + LAN interna con DHCP, ACL y NTP/Syslog opcional.

**Parámetros:**
- `pcs` (int, requerido, 1..22).
- `edgeModel`, `ispModel`, `switchModel`, `pcModel` (string, opcional).
- `lanPool` (string, opcional, default `192.168.0.0/16`).
- `transitPool` (string, opcional, default `10.0.0.0/16`).
- `withTelemetry` (bool, opcional) — añade NTP + Syslog.

**Ejemplo:**

```json
{ "recipe": "edge_nat", "pcs": 5, "withTelemetry": true }
```

**Resultado esperado:** EDGE—ISP por /30, EDGE hace `ip nat inside`/
`outside` con overload (PAT). Pool DHCP en EDGE para los PCs, ACL
permitiendo tráfico LAN al ISP, ruta default por el ISP. Si
`withTelemetry`, configuración de NTP server y syslog hacia el ISP.

---

## wifi_lan

> Router + AccessPoint-PT + clientes Laptop-PT inalámbricos con SSID/WPA2 y DHCP.

**Parámetros:**
- `clients` (int, requerido, 1..12).
- `ssid` (string, opcional).
- `security` (`open|wpa2-psk`, opcional, default `wpa2-psk`).
- `psk` (string, opcional).
- `channel` (int, opcional, 1..11).
- `routerModel`, `apModel`, `clientModel` (string, opcional).
- `lanPool` (string, opcional).

**Ejemplo:**

```json
{ "recipe": "wifi_lan", "clients": 3, "ssid": "Lab", "security": "wpa2-psk", "psk": "cisco12345" }
```

**Resultado esperado:** Router con DHCP en la LAN cableada hacia el AP.
AP con SSID configurado. Clientes Laptop-PT con módulo wireless.

> [!WARNING]
> En PT 9 los clientes Laptop-PT raramente se asocian solos al AP por
> simulador (problema conocido en su radio JS API). El SSID/PSK quedan
> persistidos en el cliente, pero la asociación necesita intervención
> manual en muchos escenarios. Es una limitación de PT, no del MCP.

---

## voip_lab

> Router CME + switch + N IP Phones (7960). Provisiona telephony-service, ephone-dn, voice VLAN trunking y DHCP option-150.

**Parámetros:**
- `phones` (int, requerido, 1..6).
- `routerModel`, `switchModel` (string, opcional).
- `lanPool` (string, opcional).
- `voiceVlanId` (int, opcional, 1..4094, default 100).
- `dataVlanId` (int, opcional, 1..4094, default 10).
- `startingExtension` (int, opcional, default 1001).
- `sourcePort` (int, opcional, 1..65535).

**Ejemplo:**

```json
{ "recipe": "voip_lab", "phones": 3 }
```

**Resultado esperado:** Router con `telephony-service` activo,
`ephone-dn` y `ephone` para cada teléfono, voice VLAN trunking en el
switch, DHCP option-150 apuntando al CME. Los teléfonos se registran
con extensiones consecutivas a partir de `startingExtension`.

**Limitaciones:**
- Requiere `uck9` activado en el router (la receta lo activa
  automáticamente y hace `reload` virtual).
- `Server-PT` no expone option-150 por API; por eso el DHCP va en el
  router, no en un servidor.

---

## ipv6_lab

> Lab IPv6 dual-stack: 2 routers en cadena + 1 PC por LAN, OSPFv3 en el transit, link-local activado.

**Parámetros:**
- `routerModel`, `switchModel`, `pcModel` (string, opcional).
- `lanPool` (string, opcional) — prefijo IPv6 base.
- `ospfPid` (int, opcional, 1..65535, default 1).
- `enableOspf` (bool, opcional, default `true`).

**Ejemplo:**

```json
{ "recipe": "ipv6_lab" }
```

**Resultado esperado:** R1—R2 con `ipv6 unicast-routing`, OSPFv3
process activo, prefijos IPv6 globales en cada LAN, link-local en el
transit /64.

---

## dual_isp

> Dos edge routers eBGP con un ISP compartido y HSRP en la LAN interna; PCs por DHCP desde EDGE1.

**Parámetros:**
- `pcs` (int, requerido, 1..6).
- `edgeModel`, `ispModel`, `switchModel`, `pcModel` (string, opcional).
- `lanPool` (string, opcional).
- `transitPool` (string, opcional).

**Ejemplo:**

```json
{ "recipe": "dual_isp", "pcs": 3 }
```

**Resultado esperado:** EDGE1 + EDGE2 — ISP. Cada EDGE peer eBGP con
ISP usando AS distintos. HSRP en la LAN interna (`virtual IP` como
gateway). DHCP en EDGE1 sirviendo el virtual IP como gateway. PCs
hacen ping al exterior por uno de los dos edges, con failover si baja
el active.

**Limitaciones:** El failover BGP en PT tiene latencia de varios
segundos. Para verificarlo, llama a `pt_run_cli` con
`shutdown` en la WAN del active y vuelve a hacer `pt_ping` desde un
PC.

---

## Cómo lanzar una receta

Una llamada típica desde un cliente MCP:

```json
{
  "name": "pt_cook_topology",
  "arguments": {
    "recipe": "chain",
    "params": { "routers": 3, "pcsPerLan": 2, "routing": "ospf" },
    "dryRun": false
  }
}
```

Si pones `dryRun: true` te devuelve el blueprint completo sin tocar el
canvas. Útil para revisar lo que se va a hacer antes de aplicarlo, o
para pegárselo a un compañero y discutirlo.

---

## Las que parecen recetas pero no lo son

Hay otras tools que también orquestan a alto nivel pero que **operan
sobre una topología que ya existe** en lugar de crearla desde cero:
`pt_apply_switching`, `pt_apply_services`, `pt_apply_voip`,
`pt_apply_wireless`, `pt_apply_ipv6`, `pt_apply_advanced_routing`,
`pt_configure_server_dhcp`, `pt_configure_subinterface`.

Las recetas de este documento son las que montan el canvas. Las
`apply_*` se aplican encima de él.
