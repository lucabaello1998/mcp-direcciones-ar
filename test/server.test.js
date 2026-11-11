import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { ClienteNominatim, desdeNominatim, ErrorDeGeocoding } from "../nominatim.js";
import { crearServidor, ejecutarHerramienta, HERRAMIENTAS, procesar } from "../server.js";

const RESULTADO = {
  lat: "-34.6183831",
  lon: "-58.4362001",
  display_name: "Avenida Rivadavia 5000, Caballito, Buenos Aires, Argentina",
  address: {
    road: "Avenida Rivadavia",
    house_number: "5000",
    suburb: "Caballito",
    city: "Buenos Aires",
    state: "Ciudad Autónoma de Buenos Aires",
    postcode: "C1424CER",
    country: "Argentina",
  },
};

function respuestaJson(cuerpo, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => cuerpo };
}

function clienteDePrueba(handler, opciones = {}) {
  const pedidos = [];
  const fetchImpl = async (url, init) => {
    pedidos.push({ url: String(url), init });
    return handler(String(url));
  };
  return { cliente: new ClienteNominatim({ fetchImpl, intervaloMs: 0, ...opciones }), pedidos };
}

// --- dirección ---------------------------------------------------------------

test("desdeNominatim separa calle, altura, barrio y localidad", () => {
  const d = desdeNominatim(RESULTADO);

  assert.equal(d.calle, "Avenida Rivadavia");
  assert.equal(d.numero, "5000");
  assert.equal(d.barrio, "Caballito");
  assert.equal(d.calleYAltura, "Avenida Rivadavia 5000");
  // El barrio manda: en CABA la localidad es la misma para las 15 comunas.
  assert.equal(d.direccionCorta, "Avenida Rivadavia 5000, Caballito");
  assert.equal(d.esUbicable, true);
});

test("desdeNominatim marca como no ubicable lo que no tiene coordenadas", () => {
  assert.equal(desdeNominatim({ display_name: "Nada" }).esUbicable, false);
});

// --- cliente -----------------------------------------------------------------

test("buscar pega en /search con país, idioma y límite", async () => {
  const { cliente, pedidos } = clienteDePrueba(() => respuestaJson([RESULTADO]));

  const resultados = await cliente.buscar("rivadavia 5000", { limite: 3 });

  assert.equal(resultados.length, 1);
  const url = new URL(pedidos[0].url);
  assert.equal(url.pathname, "/search");
  assert.equal(url.searchParams.get("q"), "rivadavia 5000");
  assert.equal(url.searchParams.get("countrycodes"), "ar");
  assert.equal(url.searchParams.get("limit"), "3");
  assert.match(pedidos[0].init.headers["User-Agent"], /mcp-direcciones-ar/);
});

test("buscar cachea: la segunda consulta no sale a la red", async () => {
  const { cliente, pedidos } = clienteDePrueba(() => respuestaJson([RESULTADO]));

  await cliente.buscar("rivadavia 5000");
  await cliente.buscar("RIVADAVIA 5000");

  assert.equal(pedidos.length, 1);
});

test("un 500 del servicio es ErrorDeGeocoding, no una lista vacía", async () => {
  const { cliente } = clienteDePrueba(() => respuestaJson({}, { ok: false, status: 500 }));

  await assert.rejects(() => cliente.buscar("x"), (error) => error instanceof ErrorDeGeocoding && error.codigo === 500);
});

test("un JSON inválido es ErrorDeGeocoding", async () => {
  const { cliente } = clienteDePrueba(() => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("no es json");
    },
  }));

  await assert.rejects(() => cliente.buscar("x"), ErrorDeGeocoding);
});

test("la reversa devuelve null cuando el punto no tiene dirección", async () => {
  const { cliente } = clienteDePrueba(() => respuestaJson({ error: "Unable to geocode" }));

  assert.equal(await cliente.reversa(-34.6, -58.4), null);
});

test("la reversa valida las coordenadas antes de salir a la red", async () => {
  const { cliente, pedidos } = clienteDePrueba(() => respuestaJson(RESULTADO));

  await assert.rejects(() => cliente.reversa(-120, 10), ErrorDeGeocoding);
  await assert.rejects(() => cliente.reversa("abc", 10), ErrorDeGeocoding);
  assert.equal(pedidos.length, 0);
});

test("espacia las llamadas para no comerse el rate limit", async () => {
  const { cliente, pedidos } = clienteDePrueba(() => respuestaJson([RESULTADO]), { intervaloMs: 60 });

  const inicio = Date.now();
  await cliente.buscar("uno");
  await cliente.buscar("dos");
  const transcurrido = Date.now() - inicio;

  assert.equal(pedidos.length, 2);
  assert.ok(transcurrido >= 55, `esperaba al menos 60 ms entre llamadas, pasaron ${transcurrido}`);
});

// --- protocolo ---------------------------------------------------------------

test("initialize responde la versión pedida y las capacidades", async () => {
  const r = await procesar({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });

  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.deepEqual(r.result.capabilities, { tools: {} });
  assert.equal(r.result.serverInfo.name, "mcp-direcciones-ar");
});

test("tools/list publica las dos herramientas con su schema", async () => {
  const r = await procesar({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  assert.deepEqual(
    r.result.tools.map((t) => t.name),
    ["buscar_direccion", "geocodificar_inverso"],
  );
  for (const herramienta of r.result.tools) {
    assert.equal(herramienta.inputSchema.type, "object");
  }
  assert.equal(HERRAMIENTAS.length, 2);
});

test("las notificaciones no llevan respuesta", async () => {
  assert.equal(await procesar({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("un método desconocido devuelve -32601", async () => {
  const r = await procesar({ jsonrpc: "2.0", id: 3, method: "resources/list" });

  assert.equal(r.error.code, -32601);
});

test("buscar_direccion devuelve direcciones legibles", async () => {
  const cliente = { buscar: async () => [desdeNominatim(RESULTADO)] };

  const r = await ejecutarHerramienta("buscar_direccion", { consulta: "rivadavia 5000" }, cliente);
  const cuerpo = JSON.parse(r.content[0].text);

  assert.equal(r.isError, false);
  assert.equal(cuerpo.total, 1);
  assert.equal(cuerpo.resultados[0].direccion, "Avenida Rivadavia 5000, Caballito");
  assert.equal(cuerpo.resultados[0].barrio, "Caballito");
});

test("buscar_direccion sin resultados lo dice, no falla", async () => {
  const cliente = { buscar: async () => [] };

  const r = await ejecutarHerramienta("buscar_direccion", { consulta: "calle que no existe" }, cliente);

  assert.equal(r.isError, false);
  assert.match(r.content[0].text, /no hay direcciones/i);
});

test("sin consulta es un error de la herramienta", async () => {
  const r = await ejecutarHerramienta("buscar_direccion", {}, { buscar: async () => [] });

  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /consulta/);
});

test("geocodificar_inverso con un punto sin dirección devuelve null", async () => {
  const r = await ejecutarHerramienta("geocodificar_inverso", { latitud: -34.6, longitud: -58.4 }, {
    reversa: async () => null,
  });

  assert.equal(r.isError, false);
  assert.equal(JSON.parse(r.content[0].text).direccion, null);
});

test("el transporte contesta por stdout y no escribe logs ahí", async () => {
  const entrada = new PassThrough();
  const salida = new PassThrough();
  const cliente = { buscar: async () => [], reversa: async () => null };

  crearServidor({ entrada, salida, cliente });

  const recibido = new Promise((listo) => {
    salida.once("data", (datos) => listo(datos.toString().trim()));
  });

  entrada.write(`${JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" })}\n`);
  const linea = await recibido;
  const mensaje = JSON.parse(linea);

  assert.equal(mensaje.id, 9);
  assert.deepEqual(mensaje.result, {});
  assert.equal(linea.split("\n").length, 1);
});
