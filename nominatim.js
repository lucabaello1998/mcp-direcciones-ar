// Cliente de Nominatim: el mismo contrato que el paquete Dart direcciones_ar
// (misma forma de dirección, misma caché y mismo límite de una request por
// segundo), pero en JS porque un MCP server corre en Node.
//
// La política del servicio público es una sola request por segundo y un
// User-Agent que identifique la app. Si vas a producción con volumen, usá una
// instancia propia: https://operations.osmfoundation.org/policies/nominatim/

const SERVICIO = "https://nominatim.openstreetmap.org";
const AGENTE = "mcp-direcciones-ar/0.1 (+https://github.com/lucabaello1998/mcp-direcciones-ar)";

export class ErrorDeGeocoding extends Error {
  constructor(mensaje, { codigo, causa } = {}) {
    super(mensaje, { cause: causa });
    this.name = "ErrorDeGeocoding";
    this.codigo = codigo;
  }
}

const texto = (valor) => {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio === "" ? null : limpio;
};

const numero = (valor) => {
  const n = typeof valor === "number" ? valor : Number.parseFloat(valor);
  return Number.isFinite(n) ? n : null;
};

/** Arma la dirección con los campos ya separados, como hace el paquete Dart. */
export function desdeNominatim(json = {}) {
  const partes = json.address && typeof json.address === "object" ? json.address : {};

  const calle =
    texto(partes.road) ??
    texto(partes.pedestrian) ??
    texto(partes.footway) ??
    texto(partes.residential) ??
    texto(partes.path);
  const altura = texto(partes.house_number);
  const barrio =
    texto(partes.suburb) ??
    texto(partes.neighbourhood) ??
    texto(partes.quarter) ??
    texto(partes.city_district);
  const localidad =
    texto(partes.city) ?? texto(partes.town) ?? texto(partes.village) ?? texto(partes.municipality) ?? texto(partes.state);

  const latitud = numero(json.lat) ?? 0;
  const longitud = numero(json.lon) ?? 0;
  const etiqueta = texto(json.display_name) ?? "";

  const calleYAltura = calle ? (altura ? `${calle} ${altura}` : calle) : "";
  // El barrio va antes que la localidad: en CABA la localidad es la misma para
  // las 15 comunas, así que no distingue nada.
  const lugar = barrio ?? localidad ?? "";
  // "Calle 123, Barrio": la calle siempre va; el lugar solo si no está ya en el
  // nombre de la vía (si no, saldría "Caballito 100, Caballito").
  const partesCorta = calleYAltura ? [calleYAltura] : [];
  if (lugar && !calleYAltura.toLowerCase().includes(lugar.toLowerCase())) {
    partesCorta.push(lugar);
  }

  const vistos = new Set();
  const detalle = [barrio, localidad, texto(partes.state), texto(partes.postcode), texto(partes.country)]
    .filter((valor) => valor && !vistos.has(valor.toLowerCase()) && vistos.add(valor.toLowerCase()))
    .join(", ");

  return {
    latitud,
    longitud,
    etiqueta,
    calle,
    numero: altura,
    barrio,
    localidad,
    provincia: texto(partes.state),
    codigoPostal: texto(partes.postcode),
    pais: texto(partes.country),
    calleYAltura,
    direccionCorta: partesCorta.join(", "),
    detalle,
    esUbicable: latitud !== 0 && longitud !== 0 && (etiqueta !== "" || Boolean(calle)),
  };
}

export class ClienteNominatim {
  #cacheBusquedas = new Map();
  #cacheReversas = new Map();
  #cola = Promise.resolve();
  #ultimaLlamada = 0;

  constructor({
    fetchImpl = globalThis.fetch,
    servicio = process.env.NOMINATIM_URL || SERVICIO,
    pais = "ar",
    intervaloMs = 1100,
    tiempoMaximoMs = 8000,
    cacheMaximo = 200,
    userAgent = AGENTE,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Este Node no tiene fetch: hace falta Node 18 o superior.");
    }
    this.fetchImpl = fetchImpl;
    this.servicio = servicio;
    this.pais = pais;
    this.intervaloMs = intervaloMs;
    this.tiempoMaximoMs = tiempoMaximoMs;
    this.cacheMaximo = cacheMaximo;
    this.userAgent = userAgent;
  }

  async buscar(consulta, { limite = 5 } = {}) {
    const textoConsulta = String(consulta ?? "").trim();
    if (!textoConsulta) return [];

    const clave = `${textoConsulta.toLowerCase()}|${limite}|${this.pais}`;
    const cacheada = this.#leerCache(this.#cacheBusquedas, clave);
    if (cacheada) return cacheada;

    const url = new URL("/search", this.servicio);
    url.searchParams.set("q", textoConsulta);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", String(limite));
    url.searchParams.set("accept-language", "es");
    url.searchParams.set("dedupe", "1");
    if (this.pais) url.searchParams.set("countrycodes", this.pais);

    const cuerpo = await this.#pedir(url);
    if (!Array.isArray(cuerpo)) {
      throw new ErrorDeGeocoding("El buscador devolvió una respuesta inesperada.");
    }

    const resultados = cuerpo.map(desdeNominatim).filter((direccion) => direccion.esUbicable);
    this.#guardar(this.#cacheBusquedas, clave, resultados);
    return resultados;
  }

  async reversa(latitud, longitud) {
    const lat = Number(latitud);
    const lng = Number(longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new ErrorDeGeocoding("La latitud y la longitud tienen que ser números.");
    }
    if (lat < -90 || lat > 90) throw new ErrorDeGeocoding("La latitud tiene que estar entre -90 y 90.");
    if (lng < -180 || lng > 180) throw new ErrorDeGeocoding("La longitud tiene que estar entre -180 y 180.");

    const clave = `${lat.toFixed(5)},${lng.toFixed(5)}|${this.pais}`;
    if (this.#cacheReversas.has(clave)) {
      return this.#leerCache(this.#cacheReversas, clave);
    }

    const url = new URL("/reverse", this.servicio);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "18");
    url.searchParams.set("accept-language", "es");

    const cuerpo = await this.#pedir(url);
    if (!cuerpo || typeof cuerpo !== "object") {
      throw new ErrorDeGeocoding("El buscador devolvió una respuesta inesperada.");
    }

    // Nominatim contesta 200 con {"error": "Unable to geocode"} cuando el punto
    // cae en el mar o no tiene dirección: eso es "no hay", no un fallo.
    const resultado = cuerpo.error ? null : desdeNominatim(cuerpo);
    const limpio = resultado?.esUbicable && resultado.direccionCorta ? resultado : null;
    this.#guardar(this.#cacheReversas, clave, limpio);
    return limpio;
  }

  #leerCache(cache, clave) {
    if (!cache.has(clave)) return undefined;
    const valor = cache.get(clave);
    // LRU: al usarse se renueva.
    cache.delete(clave);
    cache.set(clave, valor);
    return valor;
  }

  #guardar(cache, clave, valor) {
    cache.set(clave, valor);
    while (cache.size > this.cacheMaximo) {
      cache.delete(cache.keys().next().value);
    }
  }

  async #pedir(url) {
    // Una llamada por vez, con la espera mínima entre requests reales: dos
    // herramientas pidiendo direcciones a la vez no pueden comerse el rate limit.
    const turno = this.#cola.then(async () => {
      const desdeLaUltima = Date.now() - this.#ultimaLlamada;
      if (desdeLaUltima < this.intervaloMs) {
        await new Promise((listo) => setTimeout(listo, this.intervaloMs - desdeLaUltima));
      }
      this.#ultimaLlamada = Date.now();
    });
    this.#cola = turno.catch(() => {});
    await turno;

    let respuesta;
    try {
      respuesta = await this.fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": this.userAgent },
        signal: AbortSignal.timeout(this.tiempoMaximoMs),
      });
    } catch (causa) {
      throw new ErrorDeGeocoding("No se pudo consultar el buscador.", { causa });
    }

    if (!respuesta.ok) {
      throw new ErrorDeGeocoding("El buscador respondió con un error.", { codigo: respuesta.status });
    }

    try {
      return await respuesta.json();
    } catch (causa) {
      throw new ErrorDeGeocoding("La respuesta del buscador no es JSON válido.", { causa });
    }
  }
}
