// Coach en vivo: con el volumen de cada pista (sin transcribir) estima tu % de habla, cuánto llevas hablando
// de corrido y cuántas veces le quitas la palabra a alguien. Misma lógica que Vivo.swift.
class CoachVivo {
  constructor() { this.alActualizar = () => {}; this.alMonologoLargo = () => {}; this.activo = false; this.reloj = null; }

  /** Bloque PCM 16 bits de una pista ("yo" o "ellos"). */
  nivel(yo, pcm) {
    if (!this.activo || !pcm.length) return;
    let suma = 0;
    for (let i = 0; i < pcm.length; i += 2) { const v = pcm[i] / 32768; suma += v * v; }
    const db = 10 * Math.log10(Math.max(1e-9, suma / Math.ceil(pcm.length / 2)));
    if (yo) this.nivelYo = Math.max(db, this.nivelYo * 0.6 + db * 0.4);
    else this.nivelOtros = Math.max(db, this.nivelOtros * 0.6 + db * 0.4);
  }

  empezar() {
    Object.assign(this, { activo: true, tYo: 0, tOtros: 0, racha: 0, silencioYo: 0, rachaMax: 0, otrosHace: 99, interrupciones: 0, yoAntes: false,
      avisoMonologo: false, otrosRacha: 0, candidato: null, candidatoYo: 0, nivelYo: -90, nivelOtros: -90, pisoYo: -60, pisoOtros: -70, ultimaInterrupcion: 0 });
    clearInterval(this.reloj);
    this.reloj = setInterval(() => this.paso(0.25), 250);
  }

  detener() { this.activo = false; clearInterval(this.reloj); this.reloj = null; }

  paso(dt) {
    if (!this.activo) return;
    const y = this.nivelYo, o = this.nivelOtros;
    this.nivelYo -= 6; this.nivelOtros -= 6;
    this.pisoYo = y < this.pisoYo ? y : this.pisoYo + 0.02;
    this.pisoOtros = o < this.pisoOtros ? o : this.pisoOtros + 0.02;
    const otros = o > Math.max(this.pisoOtros + 12, -55);
    // Sin audífonos el micrófono también capta a los demás: si ellos hablan, exige más volumen para contarte a ti.
    const yo = y > Math.max(this.pisoYo + (otros ? 22 : 12), -50);
    if (otros) { this.tOtros += dt; this.otrosHace = 0; this.otrosRacha += dt; } else { this.otrosHace += dt; if (this.otrosHace > 0.6) this.otrosRacha = 0; }
    // Interrupción = entras mientras alguien habla (llevaba ≥1 s), sigues ≥1,5 s y la otra persona se calla.
    if (yo && !this.yoAntes && this.candidato == null && this.otrosHace < 0.3 && this.otrosRacha >= 1) { this.candidato = 0; this.candidatoYo = 0; }
    if (this.candidato != null) {
      const t = this.candidato + dt;
      this.candidato = t;
      if (yo) this.candidatoYo += dt;
      if (this.candidatoYo >= 1.5 && this.otrosHace >= 0.6 && Date.now() - this.ultimaInterrupcion > 6000) {
        this.interrupciones++; this.ultimaInterrupcion = Date.now(); this.candidato = null;
      } else if (t > 4 || (!yo && this.candidatoYo < 1.5 && this.silencioYo > 0.8)) this.candidato = null;
    }
    if (yo) { this.tYo += dt; this.racha += dt; this.silencioYo = 0; this.rachaMax = Math.max(this.rachaMax, this.racha); }
    else { this.silencioYo += dt; if (this.silencioYo > 1.5) { this.racha = 0; this.avisoMonologo = false; } }
    this.yoAntes = yo;
    if (this.racha >= 90 && !this.avisoMonologo) { this.avisoMonologo = true; this.alMonologoLargo(Math.floor(this.racha)); }
    const total = this.tYo + this.tOtros;
    this.alActualizar({ pct: total > 20 ? Math.round((this.tYo / total) * 100) : -1, racha: Math.floor(this.racha), rachaMax: Math.floor(this.rachaMax),
      interrupciones: this.interrupciones, hablandoAhora: yo, otrosAhora: otros });
  }
}

module.exports = { CoachVivo };
