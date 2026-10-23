const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("alerta", {
  alMostrar: (f) => ipcRenderer.on("mostrar", (_e, d) => f(d)),
  responder: (boton) => ipcRenderer.send("alerta-respuesta", boton),
  alto: (px) => ipcRenderer.send("alerta-alto", px),
});
