// Alerta flotante (arriba a la derecha): reunión detectada, ¿terminó?, notas listas y recompensas.
const $ = (id) => document.getElementById(id);
const ICONOS = { reunion: "🎙️", fin: "⏹️", listo: "📝", logro: "🏆" };
let reloj = null;

const luminancia = (hex) => {
  const v = parseInt(String(hex || "").replace("#", "").slice(0, 6), 16);
  if (Number.isNaN(v)) return 0;
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
};

window.alerta.alMostrar((d) => {
  const e = d.estilo, r = document.documentElement.style;
  if (e) {
    r.setProperty("--fondo", e.fondo); r.setProperty("--panel", e.panel); r.setProperty("--texto", e.texto); r.setProperty("--suave", e.suave);
    r.setProperty("--linea", e.linea); r.setProperty("--acento", e.acento);
    r.setProperty("--acento-texto", luminancia(e.acento) > 0.55 ? "#111" : "#fff");
    r.setProperty("--radio", `${Math.min(Math.max(e.radio || 16, 6), 20)}px`);
  }
  $("etiqueta").textContent = d.cabecera;
  $("titulo").textContent = d.titulo;
  $("detalle").textContent = d.detalle;
  $("principal").textContent = d.principal;
  $("secundario").textContent = d.secundario;
  $("ico").textContent = d.emoji || ICONOS[d.tipo] || "✨";
  $("icono").classList.toggle("emoji", !!d.emoji);
  clearInterval(reloj);
  $("reloj").textContent = "";
  if (d.desde) {
    const pintar = () => { const s = Math.max(0, Math.floor((Date.now() - d.desde) / 1000)); $("reloj").textContent = `· ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
    pintar(); reloj = setInterval(pintar, 1000);
  }
  const t = $("t");
  t.classList.remove("visible");
  requestAnimationFrame(() => {
    window.alerta.alto(Math.ceil(t.getBoundingClientRect().height + 16));
    requestAnimationFrame(() => t.classList.add("visible"));
  });
});

$("principal").onclick = () => window.alerta.responder("principal");
$("secundario").onclick = () => window.alerta.responder("secundario");
$("cerrar").onclick = () => window.alerta.responder("cerrar");
