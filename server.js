#!/usr/bin/env node
// MCP server (stdio) para direcciones argentinas.
//
// Habla JSON-RPC 2.0 por stdin/stdout, un mensaje por línea, como pide el
// transporte stdio de MCP. Nada de logs por stdout: stdout es el canal del
// protocolo y un console.log lo rompe. Los diagnósticos van a stderr.

import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { ClienteNominatim } from "./nominatim.js";

export const NOMBRE = "mcp-direcciones-ar";
export const VERSION = "0.1.0";
const PROTOCOLO_POR_DEFECTO = "2024-11-05";

export const HERRAMIENTAS = [
  {
    name: "buscar_direccion",
    description:
      "Busca direcciones argentinas por texto libre y devuelve calle, altura, barrio, localidad y coordenadas. " +
      "Sirve para autocompletar un campo de dirección. Una lista vacía significa que no hay coincidencias.",
    inputSchema: {
      type: "object",
      properties: {
        consulta: {
          type: "string",
          description: 'Texto a buscar, por ejemplo "rivadavia 5000 caballito".',
          minLength: 1,
        },
        limite: {
          type: "integer",
          description: "Cuántos resultados devolver (1 a 10, por defecto 5).",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["consulta"],
      additionalProperties: false,
    },
  },
  {
    name: "geocodificar_inverso",
    description:
      "Devuelve la dirección argentina más cercana a un punto (latitud, longitud). " +
      "Si el punto no tiene una dirección asociada, devuelve null.",
    inputSchema: {
      type: "object",
      properties: {
        latitud: { type: "number", minimum: -90, maximum: 90 },
        longitud: { type: "number", minimum: -180, maximum: 180 },
      },
      required: ["latitud", "longitud"],
      additionalProperties: false,
    },
  },
];

/** Respuesta de una herramienta: el contenido va como texto JSON, legible por el modelo. */
export function respuesta(contenido, { error = false } = {}) {
  return {
    content: [{ type: "text", text: typeof contenido === "string" ? contenido : JSON.stringify(contenido, null, 2) }],
    isError: error,
  };
}

/**
 * Ejecuta una herramienta. Se exporta aparte del transporte para poder testearla
 * sin levantar el servidor.
 */
export async function ejecutarHerramienta(nombre, argumentos = {}, cliente) {
  if (nombre === "buscar_direccion") {
    const consulta = argumentos.consulta;
    if (typeof consulta !== "string" || !consulta.trim()) {
      return respuesta("Falta el parámetro 'consulta'.", { error: true });
    }
    const limite = Number.isInteger(argumentos.limite) ? Math.min(Math.max(argumentos.limite, 1), 10) : 5;

    try {
      const resultados = await cliente.buscar(consulta, { limite });
      if (resultados.length === 0) {
        return respuesta({ consulta, resultados: [], mensaje: "No hay direcciones que coincidan." });
      }
      return respuesta({
        consulta,
        total: resultados.length,
        resultados: resultados.map((d) => ({
          direccion: d.direccionCorta,
          detalle: d.detalle,
          calle: d.calle,
          altura: d.numero,
          barrio: d.barrio,
          localidad: d.localidad,
          provincia: d.provincia,
          codigoPostal: d.codigoPostal,
          latitud: d.latitud,
          longitud: d.longitud,
        })),
      });
    } catch (error) {
      return respuesta(`No se pudo buscar: ${error.message}`, { error: true });
    }
  }

  if (nombre === "geocodificar_inverso") {
    const { latitud, longitud } = argumentos;
    if (typeof latitud !== "number" || typeof longitud !== "number") {
      return respuesta("Hacen falta 'latitud' y 'longitud' numéricas.", { error: true });
    }

    try {
      const direccion = await cliente.reversa(latitud, longitud);
      if (!direccion) {
        return respuesta({ punto: { latitud, longitud }, direccion: null, mensaje: "Ese punto no tiene una dirección asociada." });
      }
      return respuesta({
        punto: { latitud, longitud },
        direccion: direccion.direccionCorta,
        detalle: direccion.detalle,
        barrio: direccion.barrio,
        localidad: direccion.localidad,
        codigoPostal: direccion.codigoPostal,
      });
    } catch (error) {
      return respuesta(`No se pudo geocodificar: ${error.message}`, { error: true });
    }
  }

  return respuesta(`Herramienta desconocida: ${nombre}`, { error: true });
}

/** Procesa un mensaje JSON-RPC y devuelve la respuesta (o null si es una notificación). */
export async function procesar(mensaje, cliente) {
  const { id, method, params } = mensaje ?? {};

  const esNotificacion = id === undefined || id === null;
  const ok = (result) => (esNotificacion ? null : { jsonrpc: "2.0", id, result });
  const fallo = (code, message) => (esNotificacion ? null : { jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize": {
      // Se responde con la versión que pidió el cliente si la conocemos; si no,
      // con la que implementamos.
      const pedida = params?.protocolVersion;
      const version = typeof pedida === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pedida) ? pedida : PROTOCOLO_POR_DEFECTO;
      return ok({
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: NOMBRE, version: VERSION },
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return ok({});

    case "tools/list":
      return ok({ tools: HERRAMIENTAS });

    case "tools/call": {
      const nombre = params?.name;
      if (typeof nombre !== "string") return fallo(-32602, "Falta el nombre de la herramienta.");
      const resultado = await ejecutarHerramienta(nombre, params?.arguments ?? {}, cliente);
      return ok(resultado);
    }

    default:
      return fallo(-32601, `Método no soportado: ${method}`);
  }
}

export function crearServidor({ entrada = process.stdin, salida = process.stdout, cliente } = {}) {
  const nominatim = cliente ?? new ClienteNominatim();

  const enviar = (objeto) => {
    salida.write(`${JSON.stringify(objeto)}\n`);
  };

  const lineas = createInterface({ input: entrada, crlfDelay: Infinity });

  lineas.on("line", (linea) => {
    const limpia = linea.trim();
    if (!limpia) return;

    let mensaje;
    try {
      mensaje = JSON.parse(limpia);
    } catch {
      enviar({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido." } });
      return;
    }

    procesar(mensaje, nominatim)
      .then((respuestaMensaje) => {
        if (respuestaMensaje) enviar(respuestaMensaje);
      })
      .catch((error) => {
        // Nunca dejar al cliente esperando: todo error se contesta.
        console.error(`[${NOMBRE}] error inesperado:`, error);
        if (mensaje?.id !== undefined && mensaje?.id !== null) {
          enviar({ jsonrpc: "2.0", id: mensaje.id, error: { code: -32603, message: "Error interno del servidor." } });
        }
      });
  });

  return { nominatim, cerrar: () => lineas.close() };
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (esPrincipal) {
  crearServidor();
  console.error(`[${NOMBRE}] v${VERSION} escuchando por stdio`);
}
