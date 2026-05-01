# Changelog

Todos los cambios relevantes de este proyecto se documentan en este
archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
y el versionado sigue [SemVer](https://semver.org/spec/v2.0.0.html).

> Los tipos posibles de entrada son: **Added** (nuevo),
> **Changed** (cambio que no rompe nada), **Deprecated** (algo que va
> a salir), **Removed** (eliminado), **Fixed** (bug fix),
> **Security** (vulnerabilidades).

---

## [Unreleased]

Cambios en `main` que aún no han salido en una release etiquetada.

---

## [0.1.0] — 2026-05-01

Primera release pública. Proyecto experimental verificado contra
**Cisco Packet Tracer 9.0.0.0810**.

### Added

- **Servidor MCP** sobre Bun + TypeScript con transporte
  StreamableHTTP en `:39001` y modo `--stdio` para clientes que lo
  prefieran.
- **57 tools MCP** agrupadas por dominio: bridge y diagnóstico,
  catálogo y descubrimiento, inspección read-only del workspace,
  edición primitiva del canvas, recetas de orquestación, persistencia
  por snapshots, persistencia `.pkt` nativa, CLI de routers/switches,
  y simulación.
- **9 recetas integradas** (`chain`, `star`, `branch_office`,
  `campus_vlan`, `edge_nat`, `dual_isp`, `voip_lab`, `ipv6_lab`,
  `wifi_lan`). 8 verificadas end-to-end contra PT real.
- **Extensión `.pts` propia** (`extension/dist/mcp-bridge.pts`) que se
  instala desde el menú Extensions de PT y arranca el bucle de
  polling contra el bridge HTTP local.
- **Bridge HTTP local** en `:54321` con cola + long-poll, sondeado por
  la webview de PT cada 500 ms.
- **Catálogo de 54 modelos PT** (routers, switches, multilayer,
  firewalls, endpoints, wireless, otros) con conteo y nombres de
  puertos verificados contra PT 9.
- **Snapshots y diff** del canvas (`pt_save_snapshot`,
  `pt_load_snapshot`, `pt_diff_snapshots`). Cargar un snapshot nunca
  sobreescribe en silencio: enseña la diferencia.
- **Persistencia `.pkt` nativa** vía `systemFileManager`
  (`pt_save_pkt`, `pt_open_pkt`, `pt_save_pkt_to_bytes`,
  `pt_open_pkt_from_bytes`).
- **Auto-layout** en rejilla por capas con detección de routers de
  tránsito (`pt_auto_layout`).
- **Configuraciones avanzadas**: VLANs y trunks (incluido
  router-on-a-stick), DHCP server-side, NAT/PAT + ACLs, OSPF + BGP +
  HSRP + EIGRP, IPv6 dual-stack con OSPFv3, VoIP CME con ephone-dn y
  voice VLAN.
- **Smoke suite privada** (`scripts/smoke.ts`) que verifica cada
  pieza contra PT real. Los transcripts se referencian desde
  `docs/COVERAGE.md`.
- **Documentación**:
  [`README.md`](./README.md)/[`README.en.md`](./README.en.md),
  [`AGENTS.md`](./AGENTS.md) (guía operativa para LLMs),
  [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md),
  [`docs/BOOTSTRAP.md`](./docs/BOOTSTRAP.md),
  [`docs/COVERAGE.md`](./docs/COVERAGE.md).

### Known limitations

- **`wifi_lan`**: la API JS pública de PT 9 acepta `setSsid` /
  `setAuthMode` / `setKey` pero nunca dispara la asociación radio. Los
  laptops nunca detectan APs (`getCurrentSsid()` siempre vacío). No
  es un bug del MCP; documentado en `docs/COVERAGE.md`.
- **DHCP option-150 en Server-PT**: `DhcpPool` no expone `setTftp` /
  `setOption` / `setBoot`. Para option-150 hay que mover el DHCP al
  router (vía CLI) o configurarlo a mano en la GUI.
- **Formato `.pkz` comprimido**: la API JS expone los métodos pero los
  bytes que devuelve no son válidos en PT 9.0.0.0810. Solo `.pkt`
  funciona.
- **Eventos reactivos**: `registerObjectEvent` está expuesto pero es
  un stub — acepta cualquier nombre sin validar y no entrega eventos.
  Mantenemos polling contra el bridge.
- **Canal IPC nativo de PT**: el handshake de PT 9 exige `.pta`
  firmados con ECDSA por Cisco. Inviable para apps de terceros open
  source. Por eso el servidor habla con la webview, no con el IPC
  nativo de Cisco.

### Notes

- Versión `0.1.0` es **experimental**. Estado de mantenimiento:
  [WIP](https://www.repostatus.org/#wip).
- Probado solo contra Packet Tracer **9.0.0.0810**. Builds más nuevos
  pueden cambiar la API IPC sin avisar.

---

[Unreleased]: https://github.com/jcorderop02/packet-tracer-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jcorderop02/packet-tracer-mcp/releases/tag/v0.1.0
