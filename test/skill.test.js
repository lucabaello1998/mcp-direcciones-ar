import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HERRAMIENTAS, NOMBRE, VERSION } from "../server.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const texto = readFileSync(join(raiz, "skill", "SKILL.md"), "utf8");

/** Frontmatter YAML simple: `clave: valor` entre los dos `---`. */
function frontmatter(md) {
  const coincidencia = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(coincidencia, "el SKILL.md tiene que empezar con un frontmatter ---");
  const campos = {};
  for (const linea of coincidencia[1].split(/\r?\n/)) {
    const par = linea.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (par) campos[par[1]] = par[2].trim();
  }
  return campos;
}

/** Bloques `### \`tool\`` con las filas de la tabla de parámetros que los siguen. */
function seccionesPorHerramienta(md) {
  const secciones = new Map();
  const partes = md.split(/^### /m).slice(1);
  for (const parte of partes) {
    const titulo = parte.match(/^`([a-z_]+)`/);
    if (!titulo) continue;
    const parametros = [];
    for (const linea of parte.split(/\r?\n/)) {
      const fila = linea.match(/^\|\s*`([a-zA-Z_]+)`\s*\|/);
      if (fila) parametros.push(fila[1]);
    }
    secciones.set(titulo[1], parametros);
  }
  return secciones;
}

const HERRAMIENTAS_POR_NOMBRE = new Map(HERRAMIENTAS.map((h) => [h.name, h]));

test("el skill declara nombre, descripción y licencia", () => {
  const campos = frontmatter(texto);
  assert.equal(campos.name, "direcciones-ar");
  assert.equal(campos.license, "MIT");
  assert.ok(campos.description.length >= 80, "la descripción tiene que explicar cuándo usarla");
  assert.ok(campos.description.length <= 1024, "la descripción tiene que entrar en el límite de los agentes");
  assert.match(campos.description, /Argentina/i);
});

test("la descripción dice cuándo usarla, no solo qué hace", () => {
  const { description } = frontmatter(texto);
  assert.match(description, /Usala cuando/i);
});

test("el skill sólo nombra herramientas que existen en el server", () => {
  const secciones = seccionesPorHerramienta(texto);
  assert.ok(secciones.size > 0, "no encontré ninguna sección `### \\`tool\\``");
  for (const nombre of secciones.keys()) {
    assert.ok(HERRAMIENTAS_POR_NOMBRE.has(nombre), `el skill nombra "${nombre}", que no está en HERRAMIENTAS`);
  }
});

test("cada herramienta del server tiene su sección en el skill", () => {
  const secciones = seccionesPorHerramienta(texto);
  for (const { name } of HERRAMIENTAS) {
    assert.ok(secciones.has(name), `falta la sección de "${name}" en el SKILL.md`);
  }
});

test("los parámetros documentados son los del inputSchema", () => {
  for (const [nombre, documentados] of seccionesPorHerramienta(texto)) {
    const herramienta = HERRAMIENTAS_POR_NOMBRE.get(nombre);
    const reales = Object.keys(herramienta.inputSchema.properties);
    assert.deepEqual(
      [...documentados].sort(),
      [...reales].sort(),
      `los parámetros de "${nombre}" no coinciden con el schema`,
    );
    for (const obligatorio of herramienta.inputSchema.required) {
      assert.ok(
        documentados.includes(obligatorio),
        `"${nombre}" no documenta el parámetro obligatorio "${obligatorio}"`,
      );
    }
  }
});

test("el skill dice cómo conectarlo y avisa si el MCP no está", () => {
  assert.match(texto, /mcpServers/);
  assert.match(texto, /server\.js/);
  assert.match(texto, /no inventes|no lo inventes/i);
});

test("el skill documenta los límites del servicio público de Nominatim", () => {
  assert.match(texto, /una request por segundo|1 req\/s|una por segundo/i);
  assert.match(texto, /isError/, "tiene que distinguir una lista vacía de un fallo real");
});

test("el skill nombra el server y la versión del paquete", () => {
  const paquete = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
  assert.equal(paquete.name, NOMBRE);
  assert.equal(paquete.version, VERSION);
});
