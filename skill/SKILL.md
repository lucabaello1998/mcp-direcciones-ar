---
name: direcciones-ar
description: Autocompletado y geocodificación inversa de direcciones argentinas (calle, altura, barrio, localidad, código postal y coordenadas) contra Nominatim, a través del MCP mcp-direcciones-ar. Usala cuando haya que completar o validar una dirección en Argentina, ubicar un punto del mapa, o cargar un envío en un formulario de flete, delivery o logística.
license: MIT
---

# Direcciones AR

Esta skill le enseña al agente a usar el MCP **`mcp-direcciones-ar`**, que expone dos herramientas sobre
Nominatim (OpenStreetMap): buscar una dirección por texto y obtener la dirección de un punto.

## Requisito

El servidor MCP tiene que estar conectado:

```json
{
  "mcpServers": {
    "direcciones-ar": {
      "command": "node",
      "args": ["/ruta/a/mcp-direcciones-ar/server.js"]
    }
  }
}
```

Si la herramienta no aparece, el MCP no está conectado: no inventes la dirección ni intentes scrapear
el mapa a mano. Decile al usuario que falta configurar el servidor.

## Cuándo usarla

- El usuario escribe una dirección argentina incompleta y quiere el resto de los datos
  (`"rivadavia 5000 caballito"` → calle, altura, barrio, localidad, CP y coordenadas).
- Hay que validar que una dirección existe antes de guardarla.
- Hay que ubicar un punto en el mapa (lat/lon) para mostrarlo, calcular distancia o guardarlo.
- Hay que completar un formulario de envío, retiro o flete con datos de Argentina.

## Cuándo NO usarla

- Direcciones de otros países: el servidor está atado a Argentina (`countrycodes=ar`). Decilo y no
  fuerces el resultado.
- Geocodificación masiva (miles de direcciones): es el servicio público de Nominatim y tiene un
  límite de una request por segundo. Para volumen hay que usar una instancia propia o un proveedor
  pago; avisá antes de empezar.
- Datos que la persona ya dio completos y correctos: no hace falta "verificar" todo, alcanza con
  normalizar el barrio o las coordenadas si aporta algo.

## Herramientas

### `buscar_direccion`

| Parámetro | Tipo | Obligatorio | Qué es |
|---|---|---|---|
| `consulta` | string | sí | Texto libre: `"calle altura barrio"` o `"calle altura, localidad"` |
| `limite` | integer 1-10 | no | Cuántas opciones devolver (por defecto 5) |

Devuelve una lista con `direccion` (la forma corta), `detalle`, `calle`, `altura`, `barrio`,
`localidad`, `provincia`, `codigoPostal`, `latitud` y `longitud`.

**Una lista vacía significa "no hay coincidencias"**, no que el servicio falló. Un fallo real viene
como `isError: true` con un texto que empieza con "No se pudo buscar".

### `geocodificar_inverso`

| Parámetro | Tipo | Obligatorio | Qué es |
|---|---|---|---|
| `latitud` | number -90..90 | sí | Latitud del punto |
| `longitud` | number -180..180 | sí | Longitud del punto |

Devuelve `direccion` (o `null` si el punto no tiene una dirección asociada: mar, campo, obra) más
`detalle`, `barrio`, `localidad` y `codigoPostal`.

## Cómo trabajarlo

1. **Empezá con lo que escribió el usuario, tal cual.** No traduzcas ni reordenes: Nominatim busca
   texto libre y `"Av. Rivadavia 5000, Caballito"` funciona mejor que `"5000 Rivadavia Av."`.
2. **Si hay varias opciones, mostralas y preguntá.** No elijas la primera en silencio cuando la
   dirección define un envío: un barrio equivocado es un flete perdido.
3. **Usá `direccion` para mostrar y los campos sueltos para guardar.** `direccion` está pensada para
   leer; `calle`, `altura`, `barrio`, `localidad` y `codigoPostal` para estructurar.
4. **Si el punto no tiene dirección**, decilo con esas palabras ("ese punto no tiene una dirección
   asociada") en vez de devolver coordenadas como si fueran una dirección.
5. **No completes datos que no vinieron.** Si el resultado no trae `codigoPostal`, no lo inventes.

## Ejemplos

Buscar:

```json
{ "name": "buscar_direccion", "arguments": { "consulta": "rivadavia 5000 caballito", "limite": 3 } }
```

```json
{
  "consulta": "rivadavia 5000 caballito",
  "total": 2,
  "resultados": [
    {
      "direccion": "Avenida Rivadavia 5000, Caballito",
      "detalle": "Caballito, Buenos Aires, Ciudad Autónoma de Buenos Aires, C1424CER, Argentina",
      "calle": "Avenida Rivadavia",
      "altura": "5000",
      "barrio": "Caballito",
      "localidad": "Buenos Aires",
      "provincia": "Ciudad Autónoma de Buenos Aires",
      "codigoPostal": "C1424CER",
      "latitud": -34.6183831,
      "longitud": -58.4362001
    }
  ]
}
```

Revertir:

```json
{ "name": "geocodificar_inverso", "arguments": { "latitud": -34.6183831, "longitud": -58.4362001 } }
```

```json
{
  "punto": { "latitud": -34.6183831, "longitud": -58.4362001 },
  "direccion": "Avenida Rivadavia 5000, Caballito",
  "detalle": "Caballito, Buenos Aires, Ciudad Autónoma de Buenos Aires, C1424CER, Argentina",
  "barrio": "Caballito",
  "localidad": "Buenos Aires",
  "codigoPostal": "C1424CER"
}
```

## Errores comunes

| Situación | Qué hacer |
|---|---|
| Lista vacía | Decir "no encontré esa dirección en el mapa" y pedir más datos (localidad, barrio, altura exacta) |
| `isError: true` | Es un fallo del servicio, no una dirección inexistente: avisar y ofrecer reintentar |
| Muchos resultados parecidos | Mostrar 2 o 3 con barrio y CP para que el usuario elija |
| `altura` vacía | La calle existe pero esa altura no está mapeada: ofrecer la calle sin altura y avisar |
| Punto sin dirección | Devolver `null` como tal, sin inventar un barrio |

## Límites

- Nominatim busca **texto libre**: una altura que no está cargada en OpenStreetMap devuelve lista
  vacía. No es un error y no se arregla insistiendo.
- Una palabra que contradice al resto (`"corrientes 1234 caballito"`) también puede dar cero.
- El servidor hace una request por segundo y cachea: no repitas la misma consulta seguida.
- La cobertura y la exactitud dependen de OpenStreetMap, no de esta skill.
