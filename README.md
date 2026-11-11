# mcp-direcciones-ar

<p align="center">
  <a href="https://github.com/lucabaello1998/mcp-direcciones-ar/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/lucabaello1998/mcp-direcciones-ar?label=release"></a>
</p>

**MCP server para direcciones argentinas.** Le da a Claude Code, OpenCode, Cursor o cualquier cliente
MCP dos herramientas: buscar una dirección por texto y obtener la dirección más cercana a un punto.
Envuelve el mismo contrato que el paquete Dart [direcciones_ar](https://github.com/lucabaello1998/direcciones_ar)
sobre Nominatim (OpenStreetMap): sin API key, con caché y con el límite de una request por segundo que
pide el servicio público.

Sin dependencias. Un solo `node server.js`.

```json
{ "direccion": "Avenida Rivadavia 5000, Caballito", "barrio": "Caballito", "latitud": -34.6183831, "longitud": -58.4362001 }
```

## Herramientas

| Herramienta | Para qué | Devuelve |
|---|---|---|
| `buscar_direccion` | Autocompletar un campo de dirección (`"rivadavia 5000 caballito"`) | Hasta 10 direcciones con calle, altura, barrio, localidad, CP y coordenadas |
| `geocodificar_inverso` | Saber qué hay en un punto del mapa | La dirección más cercana, o `null` si el punto no tiene una |

Una lista vacía significa **"no hay coincidencias"**; un fallo del servicio es un error aparte. Esa
distinción es la que permite decir "esa dirección no existe" en vez de "revisá tu conexión".

## Instalar en un cliente MCP

Claude Code (`~/.claude.json` o `.mcp.json` del proyecto):

```json
{
  "mcpServers": {
    "direcciones-ar": {
      "command": "node",
      "args": ["C:/ruta/a/mcp-direcciones-ar/server.js"]
    }
  }
}
```

OpenCode (`opencode.json`):

```json
{
  "mcp": {
    "direcciones-ar": {
      "type": "local",
      "command": ["node", "C:/ruta/a/mcp-direcciones-ar/server.js"]
    }
  }
}
```

También se puede instalar como global y usar el binario:

```bash
npm install -g .
# y después "command": "mcp-direcciones-ar"
```

Variables de entorno:

| Variable | Para qué | Default |
|---|---|---|
| `NOMINATIM_URL` | Apuntar a una instancia propia de Nominatim | `https://nominatim.openstreetmap.org` |

## Skill para agentes

El server solo no alcanza: un agente necesita saber **cuándo** conviene usarlo. Eso es un skill — un
`SKILL.md` con las instrucciones — y está en [`skill/SKILL.md`](skill/SKILL.md). Le dice al agente
que lo use para autocompletar o validar una dirección argentina, qué hacer con una lista vacía, y
cuándo no usarlo (otros países, geocodificación masiva).

Instalarlo en Claude Code, Cursor u otro agente que lea `~/.claude/skills/`:

```bash
mkdir -p ~/.claude/skills/direcciones-ar
cp skill/SKILL.md ~/.claude/skills/direcciones-ar/SKILL.md
```

En OpenCode va en `~/.config/opencode/skills/direcciones-ar/SKILL.md`. El skill **no** conecta el
MCP: primero tiene que estar configurado como en la sección anterior, si no el agente no va a
encontrar las herramientas.

## Probar sin cliente

El servidor habla JSON-RPC 2.0 por stdin/stdout, un mensaje por línea. Se puede probar a mano:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"buscar_direccion","arguments":{"consulta":"rivadavia 5000 caballito","limite":2}}}' \
  | node server.js
```

En Windows, con PowerShell:

```powershell
@(
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}',
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"buscar_direccion","arguments":{"consulta":"rivadavia 5000 caballito"}}}'
) | node server.js
```

## Cómo está armado

```
server.js     protocolo MCP (initialize, tools/list, tools/call) sobre stdio
nominatim.js  cliente de Nominatim: caché LRU, cola de 1 req/s, parseo de la dirección
skill/        SKILL.md: cuándo y cómo usar las herramientas
test/         26 tests con fetch inyectado (no tocan la red)
```

Decisiones que importan:

- **El barrio va antes que la localidad** en `direccionCorta`. En CABA la localidad es "Ciudad
  Autónoma de Buenos Aires" para las 15 comunas, así que mostrarla no distingue nada; el barrio sí.
- **Nada de logs por stdout**: stdout es el canal del protocolo y un `console.log` lo rompe. Los
  diagnósticos van a stderr.
- **La cola serializa las llamadas**: dos herramientas pidiendo direcciones a la vez no pueden
  comerse el rate limit del servicio público.
- Las coordenadas se validan antes de salir a la red: un `-120` de latitud es un error de quien llama,
  no una request al servidor.

## Tests

```bash
npm test          # node --test, 26 tests
```

Los tests usan un `fetch` inyectado: verifican los parámetros que se mandan, la caché, el
espaciamiento entre llamadas, los errores (500, JSON inválido, coordenadas fuera de rango) y el
protocolo (initialize, tools/list, notificaciones sin respuesta, método desconocido). Ninguno sale a
la red.

Además hay 8 tests del skill: que el frontmatter tenga nombre, descripción y licencia; que sólo
nombre herramientas que existen en `server.js`; y que los parámetros documentados sean exactamente
los del `inputSchema`. Si alguien renombra una herramienta o agrega un parámetro y se olvida del
skill, el CI falla.

## Límites

- Es el **servicio público** de Nominatim: una request por segundo y uso moderado. Si vas a producción,
  levantá una instancia propia y apuntá `NOMINATIM_URL`.
- Nominatim busca texto libre: una altura que no existe en OSM devuelve lista vacía. Ver el README de
  [direcciones_ar](https://github.com/lucabaello1998/direcciones_ar#usar) para el detalle.
- Sólo Argentina (`countrycodes=ar`) por defecto.

## Publicar en npm y en el registro de MCP

Todavía no está publicado: se instala desde el repo. Cuando toque publicarlo, son dos pasos y ya está
todo preparado:

1. **npm** (el paquete incluye `server.js`, `nominatim.js`, `skill/SKILL.md` y `server.json`):

   ```bash
   npm login
   npm publish --access public
   ```

   `package.json` ya declara `"mcpName": "io.github.lucabaello1998/mcp-direcciones-ar"`, que es lo que el
   registro oficial verifica contra el paquete publicado.

2. **Registro oficial de MCP** ([`server.json`](server.json), schema `2025-12-11`). Requiere que el
   paquete exista en npm (el registro sólo guarda metadatos y no acepta repos de GitHub):

   ```bash
   # binario de github.com/modelcontextprotocol/registry/releases
   mcp-publisher validate
   mcp-publisher login github     # namespace io.github.lucabaello1998/*
   mcp-publisher publish
   ```

3. Verificar y, recién ahí, cambiar el install del README a cero fricción:

   ```json
   { "mcpServers": { "direcciones-ar": { "command": "npx", "args": ["-y", "mcp-direcciones-ar"] } } }
   ```

   ```bash
   curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=mcp-direcciones-ar"
   ```

## Licencia

MIT. Ver [`LICENSE`](LICENSE).
