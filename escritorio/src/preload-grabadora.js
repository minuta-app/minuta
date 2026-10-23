const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grabadora", {
  alEmpezar: (f) => ipcRenderer.on("empezar", (_e, d) => f(d)),
  alDetener: (f) => ipcRenderer.on("detener", () => f()),
  bloque: (pista, buffer) => ipcRenderer.send("grabadora-bloque", pista, Buffer.from(buffer)),
  listo: (d) => ipcRenderer.send("grabadora-listo", d),
  detenida: () => ipcRenderer.send("grabadora-detenida"),
});
