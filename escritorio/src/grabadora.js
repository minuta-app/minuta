// Grabadora: getUserMedia (micrófono) y getDisplayMedia con audio "loopback" (sistema, Windows).
// En Linux el audio del sistema lo graba el proceso principal con parec (monitor de PulseAudio/PipeWire).
const puente = window.grabadora;
let ctx = null;
const pistas = {};

async function capturar(pista, stream) {
  const fuente = ctx.createMediaStreamSource(stream);
  const nodo = new AudioWorkletNode(ctx, "pcm", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: "explicit" });
  nodo.port.onmessage = (e) => {
    const f = e.data, pcm = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
    puente.bloque(pista, pcm.buffer);
  };
  fuente.connect(nodo);
  pistas[pista] = { stream, fuente, nodo };
}

puente.alEmpezar(async ({ sistema }) => {
  const errores = {};
  try {
    ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule("pcm.js");
    if (ctx.state !== "running") await ctx.resume();
  } catch (e) {
    puente.listo({ yo: false, ellos: false, errores: { yo: String(e) } });
    return;
  }
  try {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
    await capturar("yo", mic);
  } catch (e) { errores.yo = e.name === "NotAllowedError" ? "permiso" : String(e.message || e); }
  if (sistema) {
    try {
      // El proceso principal responde con la pantalla + audio "loopback" (todo lo que suena en el equipo).
      const s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      s.getVideoTracks().forEach((t) => t.stop());
      if (!s.getAudioTracks().length) throw new Error("sin pista de audio");
      await capturar("ellos", new MediaStream(s.getAudioTracks()));
    } catch (e) { errores.ellos = String(e.message || e); }
  }
  puente.listo({ yo: !!pistas.yo, ellos: !!pistas.ellos, errores, estado: ctx.state });
});

puente.alDetener(async () => {
  for (const p of Object.values(pistas)) {
    try { p.fuente.disconnect(); p.nodo.port.onmessage = null; } catch {}
    p.stream.getTracks().forEach((t) => t.stop());
  }
  for (const k of Object.keys(pistas)) delete pistas[k];
  try { await ctx?.close(); } catch {}
  ctx = null;
  puente.detenida();
});
