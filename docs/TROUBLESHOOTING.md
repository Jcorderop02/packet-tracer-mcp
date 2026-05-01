# Troubleshooting

Lista de síntomas reales que me he encontrado yo o usuarios early. Cada
entrada va con causa probable y un fix concreto. Si te pasa algo que no
está aquí, abre un issue.

> [!NOTE]
> El servidor MCP escucha en `127.0.0.1:39001` y el bridge HTTP hacia
> Packet Tracer en `127.0.0.1:54321`. Casi todos los problemas terminan
> siendo uno de esos dos puertos.

---

## Índice

- [El cliente MCP no conecta](#el-cliente-mcp-no-conecta)
- [`pt_bridge_status` devuelve `connected: false`](#pt_bridge_status-devuelve-connected-false)
- [El canvas de Packet Tracer no se mueve](#el-canvas-de-packet-tracer-no-se-mueve)
- [`pt_cook_topology` se cuelga o tarda mucho](#pt_cook_topology-se-cuelga-o-tarda-mucho)
- [`pt_run_cli` devuelve salida vacía o truncada](#pt_run_cli-devuelve-salida-vacía-o-truncada)
- [`bun install` falla](#bun-install-falla)
- [`bun test` falla en mi máquina pero pasa en CI](#bun-test-falla-en-mi-máquina-pero-pasa-en-ci)
- [La extensión no aparece en el menú Extensions de PT](#la-extensión-no-aparece-en-el-menú-extensions-de-pt)
- [Acceso desde otra máquina de la LAN](#acceso-desde-otra-máquina-de-la-lan)
- [Errores típicos en el wizard de Cisco](#errores-típicos-en-el-wizard-de-cisco)

---

## El cliente MCP no conecta

**Síntoma:** Claude Code / Cursor / VS Code dice "no se puede conectar"
o "MCP server failed to start".

**Causa probable:**
1. El servidor no está corriendo.
2. El puerto está ocupado por otra instancia.
3. El cliente apunta a la URL incorrecta.

**Fix:**

```bash
# 1. Comprueba si hay algo escuchando en :39001
lsof -i :39001

# 2. Si no hay nada, arranca el servidor
bun run src/index.ts

# 3. Verifica que responde
curl -s http://127.0.0.1:39001/mcp -X POST \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

Si la respuesta tiene `"result"`, el servidor está bien y el problema
es la configuración del cliente — revisa que la URL en
`.vscode/mcp.json` o `claude_desktop_config.json` sea
`http://127.0.0.1:39001/mcp` exacta.

---

## `pt_bridge_status` devuelve `connected: false`

**Síntoma:** Llamas a `pt_bridge_status` y devuelve algo como
`{ connected: false, lastSeen: null }`.

**Causa probable:** Packet Tracer no está corriendo, o la extensión
`packettracer-mcp` no está cargada en su Script Engine, o el bootstrap
no se ha ejecutado.

**Fix:**

1. Abre Packet Tracer 9 y comprueba que la extensión está activa
   (Extensions → Manage Extensions). Si no aparece, copia
   `extension/` al directorio de extensiones de PT y reinicia.
2. Abre el editor de scripts (Extensions → Scripting) y pega el
   bootstrap del `README.md`. Pulsa **Run**.
3. La consola del editor debería mostrar `[mcp-bridge] polling…` cada
   ~500 ms.
4. Vuelve a llamar a `pt_bridge_status`.

Si el bootstrap se ejecuta sin error pero `connected` sigue en `false`,
mira en `lsof -i :54321` para confirmar que el puerto del bridge está
abierto.

---

## El canvas de Packet Tracer no se mueve

**Síntoma:** Las llamadas a `pt_add_device`, `pt_create_link`, etc. no
fallan, pero el canvas de PT está vacío.

**Causa probable:** El polling del bridge está parado (el bootstrap se
detiene si cierras el editor de scripts), o estás trabajando contra una
instancia distinta de PT.

**Fix:**

- Vuelve a pegar el bootstrap y pulsa **Run** de nuevo. El polling
  necesita estar vivo en todo momento; si cierras la pestaña del
  editor, se para.
- Si tienes dos PT abiertos, cierra uno. El bridge no distingue entre
  instancias; gana la primera que enganche.

---

## `pt_cook_topology` se cuelga o tarda mucho

**Síntoma:** Una receta tarda mucho más de lo esperado o nunca devuelve
respuesta.

**Causa probable:**
- Receta grande (`chain` con 8+ routers o `campus_vlan` con 16 VLANs)
  saturando el wizard del IOS.
- Algún device anterior dejó CLI a medio confirmar y los siguientes
  comandos se acumulan.

**Fix:**

1. Llama a `pt_clear_canvas` y vuelve a empezar.
2. Reduce parámetros: `routers: 3-5`, `vlans: 4-8`.
3. Si reproduces el cuelgue de forma fiable, abre un issue con el
   `pt_inspect_canvas` justo antes y los parámetros exactos.

> [!TIP]
> Para topologías grandes, llama primero a `pt_plan_review` con la
> intención. Te dice si el plan es viable y cuántos comandos va a
> emitir.

---

## `pt_run_cli` devuelve salida vacía o truncada

**Síntoma:** Ejecutas `show running-config` y vuelve `""` o un trozo.

**Causa probable:** El paginador de IOS está activo o el comando aún no
ha terminado cuando el bridge lee la salida.

**Fix:**

- El servidor inyecta `terminal length 0` automáticamente al entrar al
  modo privilegiado. Si lo ves cortado, probablemente la sesión es
  recién creada y aún no se ha aplicado — repite la llamada una vez
  más.
- Para `show` muy largos, considera `pt_show_running` (paginación
  manejada) o `pt_run_cli_bulk` con `commands: ["show running-config"]`
  en lugar de uno suelto.

---

## `bun install` falla

**Síntoma:**
- `error: lockfile had changes, but lockfile is frozen`
- `error: failed to install dependencies`

**Fix:**

```bash
# Asegúrate de Bun >= 1.2
bun --version

# Si la versión es vieja
curl -fsSL https://bun.sh/install | bash

# Reinstala desde cero
rm -rf node_modules bun.lock
bun install
```

---

## `bun test` falla en mi máquina pero pasa en CI

Las suites de tests no necesitan PT corriendo (todo es unit). Si fallan
en local pero pasan en CI:

- Comprueba que estás en `main` o has hecho `git pull`.
- `bun --version` >= 1.2.
- Borra `node_modules` y reinstala.
- Si hay un test que necesita filesystem (snapshots), comprueba que la
  ruta `docs/smoke-runs/` existe.

---

## La extensión no aparece en el menú Extensions de PT

**Causa probable:** PT no ha cargado el directorio porque el JSON
manifesto está mal o porque PT está en modo "no extensiones de
terceros".

**Fix:**

1. Comprueba la ruta en la que PT busca extensiones (varía por OS).
   Mira el manual de PT: `Help → Documentation`.
2. Copia la carpeta `extension/` completa, no solo los archivos.
3. Reinicia PT.
4. Si después de eso sigue sin aparecer, abre la consola de PT (View →
   Show Console) y busca errores que mencionen `packet-tracer-mcp`.

---

## Acceso desde otra máquina de la LAN

Por defecto el MCP escucha solo en loopback. Para exponerlo a la LAN:

```bash
PACKETTRACER_MCP_HOST=0.0.0.0 bun run src/index.ts
```

> [!WARNING]
> Eso abre el puerto al resto de la red. El servidor **no implementa
> autenticación**. Asume entorno local de confianza. Si lo expones,
> mete un firewall o restringe el acceso por IP.

---

## Errores típicos en el wizard de Cisco

PT lanza un wizard la primera vez que entras a `enable` en algunos
modelos. El servidor lo neutraliza con `enable` + `terminal length 0` +
`configure terminal` + `no ip domain-lookup`. Si ves el wizard saliendo
en CLI:

- Llama a `pt_run_cli` con `command: "no"` para abortarlo.
- Vuelve a intentar el comando original.

Esto se trataba en versiones antiguas de PT, en 9.0.0.0810 está
estable, pero si ves comportamiento raro reporta el modelo exacto del
device.
