import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HERRAMIENTAS, NOMBRE, VERSION } from "../server.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const paquete = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
const server = JSON.parse(readFileSync(join(raiz, "server.json"), "utf8"));

test("server.json apunta al schema vigente", () => {
  assert.equal(server.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
});

test("el nombre del registro coincide con mcpName del paquete", () => {
  assert.match(server.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.equal(server.name, paquete.mcpName);
  assert.equal(server.name, `io.github.lucabaello1998/${paquete.name}`);
});

test("la versión del registro es la del paquete y es exacta", () => {
  assert.equal(server.version, paquete.version);
  assert.equal(server.version, VERSION);
  assert.match(server.version, /^\d+\.\d+\.\d+$/);
  const npm = server.packages?.[0];
  assert.equal(npm.version, paquete.version);
});

test("el paquete npm del registro es el publicado y es stdio", () => {
  const npm = server.packages?.[0];
  assert.equal(npm.registryType, "npm");
  assert.equal(npm.identifier, paquete.name);
  assert.deepEqual(npm.transport, { type: "stdio" });
});

test("la descripción entra en el límite de 100 caracteres del registro", () => {
  assert.ok(server.description.length > 20, "tiene que explicar qué hace");
  assert.ok(server.description.length <= 100, `tiene ${server.description.length} caracteres`);
});

test("las variables de entorno son las que lee el server", () => {
  const env = server.packages[0].environmentVariables ?? [];
  assert.deepEqual(env.map((e) => e.name), ["NOMINATIM_URL"]);
  for (const variable of env) {
    assert.equal(typeof variable.isRequired, "boolean");
    assert.equal(typeof variable.isSecret, "boolean");
  }
});

test("server.json viaja en el paquete npm", () => {
  assert.ok(paquete.files.includes("server.json"));
  assert.ok(paquete.files.includes("skill/SKILL.md"));
});

test("el server expone las mismas herramientas que documenta el registro", () => {
  assert.equal(NOMBRE, paquete.name);
  assert.ok(HERRAMIENTAS.length >= 2);
});
