// Puente entre la interfaz web y el proceso principal. La interfaz (pieza «host-ui») llama window.minutaEscritorio.enviar({accion, datos})
// (igual que webkit.messageHandlers.minuta en Mac); el principal responde ejecutando window.Minuta.<función>(json).
const { contextBridge, ipcRenderer } = require("electron");

const panel = process.argv.includes("--minuta-panel");
contextBridge.exposeInMainWorld("MINUTA_HOST", process.platform === "win32" ? "windows" : "linux");
if (panel) contextBridge.exposeInMainWorld("MINUTA_PANEL", true);
contextBridge.exposeInMainWorld("minutaEscritorio", {
  enviar: (msg) => ipcRenderer.send("minuta", JSON.parse(JSON.stringify(msg))),
});
