// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pieza «host-escritorio»: el único puente entre la interfaz (ui/) y el proceso principal. Con contextIsolation y sandbox: la
// página no ve Node ni ipcRenderer, solo `window.<id>Escritorio.enviar({accion, datos})` y `window.<ID>_HOST` (lo que espera la
// pieza «host-ui»). El id llega del host como argumento (--pieza-host=<id>), nunca de la página.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const arg = (process.argv || []).find((x) => typeof x === "string" && x.startsWith("--pieza-host="));
const id = arg ? arg.slice("--pieza-host=".length) : "";
if (/^[a-z][a-z0-9]{0,30}$/.test(id)) {
  contextBridge.exposeInMainWorld(`${id.toUpperCase()}_HOST`, process.platform === "win32" ? "windows" : "linux");
  contextBridge.exposeInMainWorld(`${id}Escritorio`, {
    // Copia JSON: a la app nunca llega un objeto de la página (ni funciones ni prototipos).
    enviar: (msg) => { try { ipcRenderer.send(id, JSON.parse(JSON.stringify(msg))); } catch {} },
  });
}
