// AudioWorklet: junta muestras (ya a 16 kHz, el AudioContext remuestrea) y las manda en bloques de ~100 ms.
class Pcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1600);
    this.n = 0;
  }
  process(entradas) {
    const canales = entradas[0];
    if (!canales || !canales.length) return true;
    const largo = canales[0].length;
    for (let i = 0; i < largo; i++) {
      let s = 0;
      for (let c = 0; c < canales.length; c++) s += canales[c][i];
      this.buf[this.n++] = s / canales.length;
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.slice(0));
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm", Pcm);
