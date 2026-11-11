import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { ejecutarHerramienta } from "../server.js";

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));

/** Cliente falso: registra lo que le piden y devuelve vacío. */
function clienteFalso() {
  const llamadas = [];
  return {
    llamadas,
    async buscar(consulta, opciones) {
      llamadas.push({ tipo: "buscar", consulta, opciones });
      return [];
    },
    async reversa(latitud, longitud) {
      llamadas.push({ tipo: "reversa", latitud, longitud });
      return null;
    },
  };
}

test("buscar rechaza consultas de más de 300 caracteres", async () => {
  const cliente = clienteFalso();
  const r = await ejecutarHerramienta("buscar_direccion", { consulta: "a".repeat(301) }, cliente);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /300/);
  assert.equal(cliente.llamadas.length, 0, "no debería llegar a Nominatim");
});

test("buscar acepta una consulta normal", async () => {
  const cliente = clienteFalso();
  const r = await ejecutarHerramienta("buscar_direccion", { consulta: "rivadavia 5000" }, cliente);
  assert.notEqual(r.isError, true);
  assert.equal(cliente.llamadas.length, 1);
});

test("buscar recorta el límite al rango 1-10", async () => {
  const cliente = clienteFalso();
  await ejecutarHerramienta("buscar_direccion", { consulta: "rivadavia 5000", limite: 99 }, cliente);
  await ejecutarHerramienta("buscar_direccion", { consulta: "rivadavia 5000", limite: -3 }, cliente);
  assert.equal(cliente.llamadas[0].opciones.limite, 10);
  assert.equal(cliente.llamadas[1].opciones.limite, 1);
});

test("la reversa rechaza coordenadas fuera de rango", async () => {
  const cliente = clienteFalso();
  const casos = [
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ];
  for (const [lat, lng] of casos) {
    const r = await ejecutarHerramienta("geocodificar_inverso", { latitud: lat, longitud: lng }, cliente);
    assert.equal(r.isError, true, `debería rechazar ${lat},${lng}`);
  }
  assert.equal(cliente.llamadas.length, 0);
});

test("la reversa acepta los bordes del rango", async () => {
  const cliente = clienteFalso();
  const casos = [
    [-90, -180],
    [90, 180],
    [0, 0],
  ];
  for (const [lat, lng] of casos) {
    const r = await ejecutarHerramienta("geocodificar_inverso", { latitud: lat, longitud: lng }, cliente);
    assert.notEqual(r.isError, true, `debería aceptar ${lat},${lng}`);
  }
});

test("una herramienta desconocida devuelve error", async () => {
  const r = await ejecutarHerramienta("borrar_todo", {}, clienteFalso());
  assert.equal(r.isError, true);
});

// --- protocolo por stdio -----------------------------------------------------

function lanzar() {
  const proceso = spawn(process.execPath, ["server.js"], { cwd: raiz, stdio: ["pipe", "pipe", "pipe"] });
  const lineas = [];
  let buffer = "";
  proceso.stdout.on("data", (trozo) => {
    buffer += trozo.toString();
    let corte;
    while ((corte = buffer.indexOf("\n")) >= 0) {
      const linea = buffer.slice(0, corte);
      buffer = buffer.slice(corte + 1);
      if (linea.trim()) lineas.push(JSON.parse(linea));
    }
  });
  return { proceso, lineas };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test("el protocolo responde -32700 a un JSON inválido y no se cae", async () => {
  const { proceso, lineas } = lanzar();
  proceso.stdin.write("{ esto no es json\n");
  proceso.stdin.write('{"jsonrpc":"2.0","id":9,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}\n');
  await esperar(500);
  proceso.kill();

  assert.ok(lineas.find((l) => l.error?.code === -32700), "tiene que devolver -32700");
  assert.ok(lineas.find((l) => l.id === 9)?.result?.serverInfo, "después del error sigue respondiendo");
});

test("el protocolo responde -32601 a un método desconocido", async () => {
  const { proceso, lineas } = lanzar();
  proceso.stdin.write('{"jsonrpc":"2.0","id":3,"method":"no/existe"}\n');
  await esperar(400);
  proceso.kill();
  assert.equal(lineas.find((l) => l.id === 3)?.error?.code, -32601);
});

test("el protocolo aguanta una línea enorme sin caerse", async () => {
  const { proceso, lineas } = lanzar();
  const enorme = JSON.stringify({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "buscar_direccion", arguments: { consulta: "x".repeat(200_000) } },
  });
  proceso.stdin.write(enorme + "\n");
  proceso.stdin.write('{"jsonrpc":"2.0","id":6,"method":"tools/list"}\n');
  await esperar(900);
  const vivo = proceso.exitCode === null;
  proceso.kill();
  assert.ok(vivo, "el proceso tiene que seguir vivo");
  assert.ok(lineas.find((l) => l.id === 6)?.result, "tiene que seguir contestando");
});
