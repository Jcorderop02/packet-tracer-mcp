# Cómo contribuir a packet-tracer-mcp

Gracias por interesarte por el proyecto. Es un experimento hecho en
ratos libres y todavía sin release estable, así que las contribuciones
y los reportes de issues son muy bienvenidos.

> Idiomas: este documento (español) · [English](./CONTRIBUTING.en.md)

---

## Antes de abrir nada

- Lee el [`README.md`](./README.md) hasta el final. La sección de
  estado deja claro qué se considera "verificado contra PT 9 real" y
  qué está marcado como `partial` o `dead-end`.
- Echa un ojo a [`docs/COVERAGE.md`](./docs/COVERAGE.md). Si una pieza
  está como `dead-end` significa que la API JS pública de PT 9 no la
  soporta — abrir un PR para reactivarla suele requerir hablar con
  Cisco, no con este repo.
- Confirma que el bug se reproduce contra **Cisco Packet Tracer
  9.0.0.0810** exactamente. Versiones más nuevas o builds firmados de
  otra manera pueden cambiar la API IPC nativa sin avisar.

## Reportar un bug

Abre un issue con:

1. Versión de PT exacta (`Help > About` en PT).
2. Sistema operativo + versión de Bun (`bun --version`).
3. Comando MCP que disparó el problema, con sus parámetros.
4. Output del bridge: si `pt_bridge_status` responde `connected: true`
   y aún así falla, adjúntalo. Si la ventana de la extensión muestra
   amarillo o rojo, dilo.
5. Lo que esperabas vs. lo que pasó. Una captura del canvas vale más
   que un párrafo describiendo qué se ve mal.

## Proponer una feature

Antes de escribir código, abre un issue describiendo el caso de uso.
El proyecto sigue una filosofía *canvas-first* (no hay plan en memoria,
todo se valida contra el canvas vivo) y romperla por accidente es
fácil. Hablarlo antes ahorra reescrituras.

---

## Setup local

```bash
git clone https://github.com/jcorderop02/packet-tracer-mcp.git
cd packet-tracer-mcp
bun install
bun test                 # 348 tests, no necesita PT corriendo
bun run start            # arranca el servidor MCP en :39001
```

Para tests end-to-end contra PT real:

1. Abre Packet Tracer 9 e instala `extension/dist/mcp-bridge.pts`
   (instrucciones en [`docs/BOOTSTRAP.md`](./docs/BOOTSTRAP.md)).
2. Marca la extensión como activa y abre la ventana
   `Extensions > MCP Bridge`.
3. Lanza `bun run start` en una terminal.
4. Comprueba con `pt_bridge_status` que el indicador está en verde.
5. Lanza el smoke (privado) o ejecuta tu receta a mano vía cliente MCP.

---

## Convenciones

### Estructura de carpetas

- `src/tools/` — un fichero por tool MCP. La tool exporta su esquema
  Zod, su builder JS y su decoder. `src/tools/index.ts` las agrega en
  `ALL_TOOLS`.
- `src/recipes/` — orquestación de alto nivel. Las recetas leen un
  snapshot del canvas, deciden qué falta y emiten operaciones IPC.
- `src/canvas/` — snapshot, inspección, diff, aritmética de subnetting.
  Es la fuente de verdad de "qué hay en PT ahora mismo".
- `src/ipc/` — generadores puros string-in/string-out de JS para el
  Script Engine de PT. Sin side-effects.
- `src/bridge/` — bridge HTTP local que sondea la webview de PT.

### Estilo

- TypeScript estricto. No hay `any` salvo en límites con la API IPC,
  y aun ahí va comentado.
- Cero comentarios decorativos. Si una línea necesita comentario es
  porque la API de PT 9 hace algo no obvio: escribe el *por qué*, no
  el *qué*.
- Funciones puras siempre que se pueda. Las tools y recetas son
  funciones que reciben `BridgeClient` y devuelven `Result`.

### Tests

- Si añades una tool, mete sus tests en `tests/tools/` antes de tocar
  `src/tools/index.ts`. La suite es `bun test` y no debe necesitar
  PT corriendo.
- Si tu cambio solo se puede verificar contra PT real, abre el PR pero
  marca la pieza correspondiente en `docs/COVERAGE.md` como
  `contract-verified` (no `verified-pt9`) hasta que tengas un smoke run
  que lo respalde.
- No bajes la cobertura de tests. La suite actual es 348 tests; los PRs
  que quiten tests sin sustituirlos por otros mejores serán rechazados.

### Commits

- Mensajes en imperativo, presente, en inglés (consistente con la
  historia del repo): `add pt_apply_voip recipe`, no `added` ni `adds`.
- Un commit = un cambio coherente. Si tu PR mezcla refactor + feature,
  pártelo.

### Pull requests

- El PR describe **qué cambia y por qué**. Los `qué` se ven en el diff;
  el `por qué` no.
- Si añades una tool, actualiza:
  - `src/tools/index.ts` (registro)
  - `README.md` § Capacidades (recuento + grupo)
  - `docs/ARCHITECTURE.md` § Tools MCP
  - `docs/COVERAGE.md` (estado y evidencia)
- Si rompes la compatibilidad de una tool existente, dilo en el PR
  *expresamente*. v0.1.0 es experimental, pero rompimientos silenciosos
  no.

---

## Lo que NO va a entrar (al menos por ahora)

- Soporte para PT < 9. La capa IPC nativa cambió de raíz; mantener dos
  caminos no compensa.
- Fallbacks que ocultan errores. Si una operación falla, falla
  visiblemente.
- Wrappers sobre librerías de terceros para hablar con PT. Lo único que
  hay entre el servidor y PT es el bridge HTTP propio + el Script
  Engine nativo.
- Telemetría, analytics, ningún tipo de phone-home. El servidor corre
  en local y se queda en local.

---

## Licencia

Al contribuir aceptas que tu código se publique bajo la
[licencia MIT](./LICENSE) del proyecto.

## Código de conducta

Las interacciones en issues, PRs y discusiones están sujetas al
[Código de Conducta](./CODE_OF_CONDUCT.md). Léelo antes de participar.
