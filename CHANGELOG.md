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

## [0.1.2] — 2026-11-18

### Changed

- The same four labs on Packet Tracer 9.0.1.0858 went from 550.5 s to
  235.2 s with 500 ms polling (57% less time) and to 188.6 s with
  continuous polling (66% less time). Compared with the first 0.1.2
  measurement of 422.0 s, the reductions were 44% and 55%, respectively.
  See [timings by lab](https://github.com/Jcorderop02/packet-tracer-mcp/blob/v0.1.2/docs/COVERAGE.md#rendimiento-de-012-en-9010858).
- Deliver queued commands as soon as the bridge has a waiting webview request.
- Batch synchronous CLI commands and keep error detection, pagination and
  polling for incomplete commands. Preserve fresh output when the
  simulated terminal trims its console buffer.
- Check IOS boot prompts together and batch endpoint IP configuration with
  per-device readback.
- Discover native cable endpoints after reopening a `.pkt` and verify all recipe
  links with one snapshot per poll.
- Verify the Wi-Fi recipe with the open `Default` profile, WPC300N and DHCP.

### Added

- Received Syslog events, NTP synchronization checks, simulated FTP
  greeting checks, CDP/LLDP discovery, OSPFv3 route verification, and
  PLC-PT I/O readback.
- Lab verification matrices, Layer 2 diagnostics, reversible failover
  checks, activity instruction and progress readback, and packet event details.
- Server-PT HTTP/TFTP controls, simulated HTTP verification, IPv4 routing
  diagnostics, physical inventory and simulation event inspection.
- WLC-2504, WLC-3504, WLC-PT, 3702i, LAP-PT, PLC-PT and HMI-PT
  placement and port inventory. The device catalog can also query the live
  Packet Tracer palette and identify lightweight APs by their radio MAC.
- Twelve tools for endpoint inspection, WRT, DNS, DHCP readback, limited
  Wi-Fi association and numbered `.pkt` checkpoints.
- A synthetic integration fixture for Packet Tracer 9.0.1.0858. See
  [validation scope](https://github.com/Jcorderop02/packet-tracer-mcp/blob/v0.1.2/docs/integration/validacion.md).

### Fixed

- Correlate bridge responses, discard late replies and preserve Unicode.
- Count only valid echo replies; distinguish incomplete, DNS and unreachable results.
- Use the same CLI runner for tools and recipes. Wait for completion,
  advance pagination and stop on command errors.
- Respect requested DHCP ports and accept `OK:…`; configure static endpoint DNS.
- Preserve Server-PT `serverPool` and reject overlapping/invalid DHCP ranges.
- Keep switch cascades and observed Wi-Fi associations at their actual layout depths.
- Return Wi-Fi association without exposing the profile. Restore the previous
  adapter on failed installation and handle the end of the DHCP lease list.
- Include the MCP agent guide in both the npm package and standalone binary.
  Report the package version in the MCP handshake.
- Sign local macOS executable builds so they run on Apple Silicon.

### Breaking changes

- `pt_run_cli`/`pt_run_cli_bulk` now return per-command JSON
  with errors/timeouts; bulk stops at the first failure. Include `enable`
  explicitly or use `mode` on the single-command tool.
- `pt_set_pc` returns observed interfaces and rejects static
  fields in DHCP mode; its omitted DHCP port is auto-selected.
- deleting `serverPool` is rejected because PT may recreate
  an overlapping pool on reload. Update its range instead.
- partial/DNS-failed ping results now set `isError` instead
  of presenting partial output as completed success. Cascaded layouts change
  category-only row positions to preserve parent depth.


### Known limitations

- WLC-2504 and lightweight AP placement and client radio associations
  were checked in Packet Tracer 9.0.1.0858. The Script Engine does not
  expose a verified controller-side AP registration lookup.
- Simulation can request a known scenario index. The Script Engine
  does not confirm the active scenario or enumerate the selector.


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

[Unreleased]: https://github.com/Jcorderop02/packet-tracer-mcp/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/Jcorderop02/packet-tracer-mcp/compare/v0.1.1...v0.1.2
[0.1.0]: https://github.com/jcorderop02/packet-tracer-mcp/releases/tag/v0.1.0
