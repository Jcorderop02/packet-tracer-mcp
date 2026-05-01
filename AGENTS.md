# AGENTS.md — guía para LLMs que usan packet-tracer-mcp

Este archivo es para ti, el modelo, cuando un usuario te pida montar
topologías en Cisco Packet Tracer 9 a través de este servidor MCP.
Léelo antes de empezar a llamar tools — te ahorra retrabajos.

## 1. Antes de tocar nada

1. Llama a `pt_bridge_status` para verificar que el bridge ve la
   extensión PT. Si no, pide al usuario el bootstrap.
2. Llama a `pt_query_topology` para ver qué hay ya en el canvas.
3. Si el usuario aporta un diagrama (PDF, imagen, sketch), descríbelo
   con tus palabras antes de crear nada. Identifica:
   - Cuántos routers, switches y endpoints.
   - Qué LANs son **de usuario** (con PCs/servidores).
   - Qué LANs son **de tránsito** entre routers (sólo switch, sin PCs).
   - Qué enlaces son **LAN interna** (Gigabit) y cuáles **WAN exterior**
     (Serial /30 público).
4. Si el diagrama es ambiguo, **pregunta al usuario antes de adivinar**.
   Una topología hecha sobre la suposición equivocada cuesta más tiempo
   de rehacer que la pregunta.

## 2. Convenciones de cableado

Esta es la fuente de errores más común. Lee con atención.

| Tipo de enlace                                  | Cable     | Interfaces                          |
| ----------------------------------------------- | --------- | ----------------------------------- |
| Router ↔ Switch (LAN de oficina)                | straight  | GigabitEthernet ↔ Gigabit/Fast      |
| Switch ↔ PC / Server                            | straight  | Fast/GigabitEthernet                |
| Router ↔ Router por LAN compartida vía switch   | straight  | GigabitEthernet (ambos vía switch)  |
| **Router ↔ Router por WAN exterior pública**    | **serial**| **Serial0/1/0** (requiere HWIC-2T)  |
| Switch ↔ Switch (trunk)                         | cross     | GigabitEthernet                     |

**Regla mnemotécnica:** si en el enunciado aparecen palabras como
"red pública", "ISP", "/30 público", "WAN", "punto a punto público", o
en el diagrama hay líneas rojas entre routers atravesando una nube de
Internet → es **serial**. Si es un segmento dentro de la misma oficina
→ **GigabitEthernet**.

**Importante:** los routers ISR (1941, 2901, 2911, ISR4321, ISR4331)
**no tienen puertos serie por defecto**. Antes de crear un enlace
serial llama a `pt_add_module` con `HWIC-2T` en cada router. Si te
saltas este paso, el `pt_create_link` con `cable="serial"` fallará.

**Slots por chasis (validados por `pt_add_module`):**

| Modelo  | Bays disponibles                | Familia            |
| ------- | ------------------------------- | ------------------ |
| 1841    | `0/0`, `0/1`                    | HWIC / WIC         |
| 2811    | `0/0`, `0/1`, `0/2`, `0/3`      | HWIC / WIC / NM    |
| 1941    | `0/0`, `0/1`                    | EHWIC / HWIC / WIC |
| 2901    | `0/0`, `0/1`, `0/2`, `0/3`      | EHWIC / HWIC / WIC |
| 2911    | `0/0`, `0/1`, `0/2`, `0/3`      | EHWIC / HWIC / WIC |
| ISR4321 | `0/1`, `1/0`                    | NIM / SM-X         |
| ISR4331 | `0/1`, `0/2`, `1/0`             | NIM / SM-X         |

**Aviso ISR4xxx:** la serie 4000 NO usa HWIC sino **NIM** (Network
Interface Module). En Packet Tracer 9 el módulo `HWIC-2T` se acepta
en NIM bays por compatibilidad, pero la práctica académica suele
pedir `NIM-2T`. Comprueba el enunciado: si menciona NIM-2T, instala
ese; si dice HWIC-2T, ambos funcionan en PT.

**Errores típicos al añadir módulos:**
- ❌ Slot `0/0` en un ISR4321/4331 → ese bay es BUILTIN (los GE de
  fábrica), no acepta módulos. Usa `0/1` (o `0/2` en el 4331).
- ❌ Slot `0/2` en un 1941 → sólo tiene 2 bays (`0/0`, `0/1`).
- ❌ `0/3` en un 1841 → mismo motivo, sólo 2 bays.

## 3. LANs de usuario vs LANs de tránsito

Un patrón muy frecuente en prácticas académicas:

```
LAN1, LAN2  → de oficina A, con PCs colgando del switch
LAN3        → segmento de tránsito entre R1 y R2 (mismo edificio,
               sólo el switch que une los dos routers, SIN PCs)
LAN4        → segmento de tránsito entre R3 y R4 (oficina B, SIN PCs)
LAN5, LAN6  → de oficina B, con PCs colgando del switch
```

La frase "todas las LANs con misma capacidad de direccionamiento"
**se refiere al prefijo** (todas /23, todas /24…), no a que todas
tengan endpoints de usuario. Si una LAN aparece sólo entre dos routers
de la misma oficina y no se mencionan ordenadores en ella, es de
tránsito: pon switch + cable a los dos routers, y nada más.

## 4. Flujo recomendado para topologías de varios routers

```
1. pt_clear_canvas             (si vas a empezar de cero)
2. pt_add_device  × N          (crea TODOS los devices SIN x/y)
3. pt_add_module  × M          (HWIC-2T donde haga falta serial)
4. pt_create_link × K          (cablea siguiendo convenciones de §2)
5. pt_auto_layout              (re-rejilla todo el canvas)
6. pt_run_cli_bulk             (configuración IP / hostname)
7. pt_apply_advanced_routing   (EIGRP/OSPF/BGP)
8. pt_save_pkt                 (persistir el resultado)
```

**No inventes coordenadas a mano.** El layout topology-aware de
`pt_auto_layout` produce un canvas ordenado: routers en una banda,
switches debajo de su router padre, endpoints debajo de su switch,
nubes/clouds compartidas centradas entre los routers que las
comparten. Inventar X/Y suele acabar en el típico canvas alargado y
desalineado donde nada se ve.

## 5. Errores típicos a evitar

- ❌ **Cablear R1↔Internet con GigabitEthernet** cuando el enunciado
  habla de red pública /30. Es serial, no gigabit.
- ❌ **Añadir PCs a la LAN de tránsito** entre dos routers de la misma
  oficina. Esa LAN normalmente no tiene usuarios.
- ❌ **Inventar coordenadas X/Y secuenciales** (100, 250, 400, 550…) en
  lugar de dejar que `pt_add_device` o `pt_auto_layout` decidan.
- ❌ **No esperar al diálogo de configuración inicial** del ISR. Tras
  añadir un router, espera ~3 s antes de mandarle CLI, o envía `no`
  primero para salir del wizard (`Continue with configuration dialog?`).
- ❌ **Mezclar configuración IP con hostname en el mismo bulk** sin
  pasar antes por `enable`. `pt_run_cli_bulk` ya entra en modo
  privilegiado; úsalo.
- ⚠️ **`switchport trunk encapsulation dot1q` depende del modelo de
  switch — no es genérico:**
  - **2950 / 2960**: el parser NO reconoce el subcomando (sólo
    soportan 802.1Q implícito). Si lo emites, IOS responde `% Invalid
    input` y puede envenenar el resto del bulk. `pt_run_cli_bulk`
    detecta el modelo y lo filtra automáticamente en estos chasis.
  - **3560 / 3650 / IE-3400 / IE-9320 (multilayer)**: el parser SÍ
    requiere el subcomando — Cisco IOS expone la elección porque
    estos chasis soportan también ISL. La práctica P2 de Voz/QoS lo
    pide explícitamente sobre el 3560-24PS con la nota *"Cuidado con
    el modelo de switch"*. NO filtrar.
  - **Router (2811, 1941, etc.) con subinterfaces**: la sintaxis es
    distinta — `encapsulation dot1Q <vlan>` BAJO la subinterfaz. No
    confundir con `switchport trunk encapsulation`. El filtro NO toca
    esa línea.
- ❌ **Olvidar `clock rate` en el lado DCE** de un enlace serial. En
  PT, uno de los dos extremos es DCE (provee reloj) y el otro DTE.
  Sin `clock rate 64000` (u otro válido) en el DCE, la línea queda
  `down/down`. Tras `pt_create_link cable="serial"` la tool te lo
  recuerda. Para saber qué lado es DCE: `show controllers <iface>`.
- ❌ **Cable consola para datos**. `cable="console"` (rollover RS-232↔
  RJ45) sólo conecta un PC al puerto Console de un router/switch
  para gestión CLI. No transmite datos IP. Para LAN usa `straight`.

## 6. Cuando algo falla

- `pt_query_topology` para ver el estado actual.
- `pt_inspect_canvas` para ver qué puertos están conectados.
- `pt_get_device_details` para ver módulos e interfaces de un router
  concreto (útil para confirmar si el HWIC-2T se añadió bien).
- `pt_screenshot` para una vista visual; compárala con la imagen del
  enunciado si la práctica es académica.
- `pt_inspect_ports`, `pt_read_vlans`, `pt_read_acl`, `pt_show_bgp_routes`
  para diagnóstico específico por dispositivo.

## 7. Verificación de fallo silencioso

PT 9 acepta muchas operaciones sin error visible aunque internamente
no surtan efecto. **Verifica siempre**:

- Tras `pt_add_device`: `pt_query_topology` debe listarlo.
- Tras `pt_add_module`: `pt_get_device_details` debe mostrar el módulo
  y los puertos nuevos (Serial0/1/0, Serial0/1/1) en la lista de
  interfaces. Si no aparecen, el slot estaba ocupado o el módulo no
  encaja en ese chasis.
- Tras `pt_create_link`: `pt_inspect_canvas` debe mostrar AMBOS
  extremos como "connected". Si sólo aparece uno, el link está roto.
- Tras CLI: usa `pt_show_running` o `pt_run_cli` con `show ip int br`
  para confirmar que los comandos calaron. Errores típicos:
  * `enable` no aplicado (estás en modo usuario, casi todo se rechaza).
  * `configure terminal` enviado a un switch IOS antiguo (parser bug:
    intenta `figure terminal` como workaround documentado).
  * `no shutdown` olvidado en una interfaz física → status admin-down.

## 8. Patrones que el LLM **no** debe inventar

- ❌ **No inventes coordenadas X/Y**. Deja que `pt_add_device` las
  asigne (grid por categoría) y, al final, llama a `pt_auto_layout`.
- ❌ **No fuerces nombres de puerto** que no existan en el modelo. Si
  no estás seguro: `pt_get_device_details` lista los puertos reales.
- ❌ **No mezcles configuración IP y hostname** en un mismo
  `pt_run_cli_bulk` sin tener en cuenta el modo. La tool ya entra a
  privileged mode, pero si emites comandos en orden incorrecto te
  quedas en config sin salir.
- ❌ **No uses `pt_send_raw` como atajo** para evitar
  `pt_create_link`. Saltarse la validación de `confirm_internal_lan`
  reproduce el error clásico de cablear WAN con Gigabit.
- ❌ **No asumas que un fallo sin error es éxito.** Si una herramienta
  responde "OK" sin texto adicional, sigue verificando con
  `pt_query_topology` antes de continuar.

## 9. Escape hatches (último recurso)

Cuando una operación legítima no la cubre ninguna tool específica:

- `pt_send_raw` ejecuta JS arbitrario en el Script Engine de PT. Útil
  para descubrir APIs nuevas, pero **frágil** y sin validación. Si
  acabas usándolo más de una vez para lo mismo, abre un issue: hace
  falta una tool dedicada.
- `pt_run_cli` para una sola línea CLI; `pt_run_cli_bulk` para varias.
  Ambos entran en `enable` automáticamente.
- `pt_load_snapshot` / `pt_save_snapshot` para checkpointing
  rápido del canvas durante experimentos. NO sustituye a `pt_save_pkt`
  para persistencia real.

## 10. Cosas que actualmente **no son posibles** (limitaciones PT 9)

- **Asociación radio cliente ↔ AP**: la API JS persiste SSID/auth/key
  pero nunca dispara la asociación. El cliente no detecta APs (count=0).
- **Eventos reactivos**: `registerObjectEvent` es stub; acepta
  cualquier nombre y nunca entrega callbacks. Toda detección de
  cambios va por polling.
- **DHCP option-150** en Server-PT: `DhcpPool` no expone setTftp /
  setOption / setBoot. Para VoIP con TFTP, mueve el DHCP al router
  (CLI) o pídele al usuario que configure la opción 150 en GUI.
- **Undo/redo**: no expuesto en la API JS. Usa
  `pt_save_snapshot` antes de operaciones grandes y
  `pt_load_snapshot` para revertir.
- **CME / `telephony-service`** sólo aparece en routers ISR si activas
  la licencia: `license boot module c2900 technology-package uck9` +
  reload. Sin eso, el parser CLI rechaza los comandos VoIP.

## 11. Checklist rápido antes de marcar el trabajo como hecho

1. `pt_query_topology` — ¿están todos los devices que esperabas?
2. `pt_inspect_canvas` — ¿los enlaces están conectados por ambos
   extremos y con el cable correcto?
3. `pt_show_running` en cada router — ¿hostname, interfaces y
   `no shutdown` aplicados? ¿IPs correctas?
4. `pt_ping` (o `pt_run_cli` con `ping x.x.x.x`) — ¿hay conectividad
   end-to-end entre PCs/servidores de oficinas distintas?
5. `pt_screenshot` — comparativa visual contra la imagen del
   enunciado si es práctica académica.
6. `pt_save_pkt` — persistencia final.
