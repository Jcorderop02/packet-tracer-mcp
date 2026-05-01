# Bootstrap

Para que `packet-tracer-mcp` pueda tocar Packet Tracer 9.0, primero
tiene que haber un pequeño bucle de polling corriendo *dentro* de PT.
Ese bucle hace dos cosas: pedir la siguiente expresión JS al bridge
(`http://127.0.0.1:54321/next`) y pasársela al Script Engine vía
`$se('runCode', …)`.

Toda esa ingeniería va dentro de la extensión `mcp-bridge.pts`. Al
abrir su ventana, el polling arranca solo. En uso normal no hace falta
pegar código a mano en ningún sitio.

## Instalación (uso normal)

1. Descarga `mcp-bridge.pts` desde este repositorio
   (`extension/dist/mcp-bridge.pts`).
2. En Packet Tracer 9.0:
   `Extensions > Scripting > Configure PT Script Modules > Add` y
   selecciona el `.pts` descargado.
3. Marca la extensión como activa. PT la copia al directorio de
   extensiones del usuario y la deja disponible en el menú
   `Extensions > MCP Bridge`.
4. Abre la ventana desde ese menú una vez por sesión de PT. El polling
   contra el bridge arranca solo en cuanto la ventana se carga.

Verifica que está conectado:

```
> pt_bridge_status
```

Debe responder `connected: true` en menos de un segundo. Si la ventana
muestra el indicador en amarillo (`conectando`) o rojo (`sin bridge`),
asegúrate de que el servidor MCP está corriendo (`bun run start`) en
el puerto configurado.

Una vez conectado, hay 57 tools disponibles. Para una sanity-check
rápida sin tocar el canvas:

```
> pt_read_project_metadata     # descripción/versión/filename del .pkt
> pt_manage_clusters action=list   # cluster raíz siempre presente
> pt_list_modules              # catálogo de módulos PT (~199)
```

Y para diagnóstico contra dispositivos ya colocados:

```
> pt_inspect_ports device=R1
> pt_read_vlans device=SW1
> pt_read_acl device=EDGE
> pt_show_bgp_routes device=EDGE1
```

La ventana también incluye un panel de logs con métricas y un panel
"Probe manual" para enviar JS suelto al Script Engine (útil para
verificar IDs de IPC durante desarrollo, ver
`docs/COVERAGE.md`).

## Para desarrolladores

Esta sección solo aplica si vas a modificar la propia extensión o
construir una alternativa. **No es necesaria para usar el MCP.**

### Cómo funciona el polling por dentro

La extensión inyecta este snippet al cargar `interface/index.html`:

```javascript
/* packet-tracer-mcp bridge */ window.webview.evaluateJavaScriptAsync("setInterval(function(){var x=new XMLHttpRequest();x.open('GET','http://127.0.0.1:54321/next',true);x.onload=function(){if(x.status===200&&x.responseText){$se('runCode',x.responseText)}};x.onerror=function(){};x.send()},500)");
```

| Fragmento                                  | Por qué está ahí                                  |
|--------------------------------------------|---------------------------------------------------|
| `window.webview.evaluateJavaScriptAsync`   | Salta del editor a la página que lo aloja — solo ese scope expone `XMLHttpRequest`. |
| `setInterval(..., 500)`                    | Cadencia del polling. 500 ms es la cota inferior donde ráfagas de `addDevice` siguen renderizando. |
| `XMLHttpRequest` a `/next`                 | Recoge la siguiente expresión JS encolada por el bridge. |
| `$se('runCode', x.responseText)`           | Ejecuta la expresión *dentro* del Script Engine, donde vive `ipc.*`. |
| `x.onerror = function(){}`                 | Traga errores transitorios para que el bucle sobreviva si PT pasa a segundo plano. |

PT 9 estándar **no** trae un editor con `window.webview` accesible al
que pegar este snippet a mano: la única forma de ejecutarlo es desde
una extensión instalada (la nuestra u otra con UI propia).

## Lo que el bridge NO hace

- No carga JS de terceros. Cada byte que ejecuta el Script Engine
  viene de este repositorio, generado por el servidor MCP corriendo
  en tu máquina.
- No persiste entre sesiones de PT. Al cerrar PT desaparece; en el
  siguiente arranque hay que reabrir la ventana de la extensión.
- No modifica nada del canvas por sí mismo — es un puro bucle de
  fetch-execute. Todas las ediciones las disparan las herramientas
  que invocas desde tu cliente MCP.
