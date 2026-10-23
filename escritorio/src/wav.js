// Escritor de WAV PCM 16 bits mono a 16 kHz (lo que necesita Whisper): cabecera al inicio, tamaños al cerrar.
const fs = require("fs");

class EscritorWav {
  constructor(ruta, frecuencia = 16000) {
    this.ruta = ruta; this.frecuencia = frecuencia; this.bytes = 0; this.primero = 0;
    this.fd = fs.openSync(ruta, "w");
    fs.writeSync(this.fd, this.cabecera(0));
  }
  cabecera(datos) {
    const b = Buffer.alloc(44);
    b.write("RIFF", 0); b.writeUInt32LE(36 + datos, 4); b.write("WAVE", 8);
    b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(this.frecuencia, 24); b.writeUInt32LE(this.frecuencia * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
    b.write("data", 36); b.writeUInt32LE(datos, 40);
    return b;
  }
  escribir(buf) {
    if (this.fd == null || !buf.length) return;
    if (!this.primero) this.primero = Date.now() / 1000;
    fs.writeSync(this.fd, buf);
    this.bytes += buf.length;
  }
  cerrar() {
    if (this.fd == null) return;
    fs.writeSync(this.fd, this.cabecera(this.bytes), 0, 44, 0);
    fs.closeSync(this.fd);
    this.fd = null;
  }
}

module.exports = { EscritorWav };
