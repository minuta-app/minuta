# Cambios · Changelog

Lo que cambia para quien usa Minuta, en palabras simples. Las versiones anteriores a este archivo están en
[Releases](https://github.com/minuta-app/minuta/releases).
*What changes for people using Minuta, in plain words. Earlier versions are listed in Releases.*

## 0.4.0 · 2026-11-02
- Con el panel de la barra de menú cerrado, Minuta ya no repinta el reloj cada segundo ni el panel cada minuto mientras graba:
  menos trabajo de fondo en reuniones largas. Al abrirlo, todo aparece al día. · *With the menu bar panel closed, Minuta no longer
  redraws the clock every second or the panel every minute while recording: less background work in long meetings. When you open
  it, everything is up to date.*
- Buscar y cambiar de reunión responde más rápido cuando tienes muchas reuniones: los logros ya no se recalculan en cada tecla.
  *Searching and switching meetings is snappier when you have many meetings: achievements are no longer recalculated on every keystroke.*
- **Lo que le preguntas a tus reuniones (⌘K) ya no queda a la vista de otros programas:** antes la pregunta iba como argumento
  del proceso; ahora va en un archivo privado. · *What you ask your meetings (⌘K) is no longer visible to other programs: the question
  used to travel as a process argument; now it goes in a private file.*
- **Nada se queda colgado:** preguntar, el Gimnasio, probar tu IA y el catálogo tienen un tiempo máximo y, al cerrar Minuta, se
  detiene lo que siga corriendo. · *Nothing hangs: asking, the Gym, testing your AI and the catalog have a time limit, and closing
  Minuta stops whatever is still running.*
- **En Windows y Linux, el dictado del Gimnasio entiende igual que tus notas:** usa el mismo modelo, idioma y vocabulario, y ya no
  escribe frases que whisper inventa en los silencios. · *On Windows and Linux, Gym dictation understands you like your notes do: it
  uses the same model, language and vocabulary, and no longer writes phrases whisper makes up in silences.*
- Actualizar sigue igual de simple y ahora usa el mismo actualizador probado de las apps de la familia Pieza; tus notas, cuentas
  conectadas, permisos e idioma no cambian. · *Updating is just as simple and now uses the same proven updater as the Pieza family
  of apps; your notes, connected accounts, permissions and language stay the same.*
- **Ya no se pierde un «Gracias» de verdad:** antes, la transcripción borraba siempre «Gracias», «Thank you» y frases parecidas
  (whisper las inventa en los silencios), aunque alguien las hubiera dicho. Ahora solo se quitan si caen en silencio.
  · *A real «Thank you» is no longer lost: transcription used to always drop «Gracias», «Thank you» and similar phrases (whisper
  makes them up in silences), even when someone said them. Now they're only removed if they fall in silence.*
- Sin conexión, la galería de universos muestra la lista de la última vez en vez de quedar vacía (descargar sigue pidiendo
  conexión). · *Offline, the universe gallery shows the list from last time instead of staying empty (downloading still needs a
  connection).*
- **Universos e idiomas más seguros:** antes de guardar un universo o un idioma del catálogo, Minuta revisa que sea exactamente el
  publicado (su huella SHA-256); si llega cambiado o dañado, no lo instala y te lo dice. Lo que ya descargaste sigue donde estaba.
  · *Safer universes and languages: before saving a universe or a language from the catalog, Minuta checks it is exactly the one
  published (its SHA-256 fingerprint); if it arrives changed or damaged, it isn't installed and Minuta tells you. What you already
  downloaded stays where it was.*
- **Por dentro, la transcripción es la pieza compartida «transcribir»:** igual que antes, en tu computador y con tu vocabulario en
  un archivo privado (nunca a la vista de otros programas); ahora también descarta las marcas como [Música]. Tus modelos siguen en
  la misma carpeta. · *Under the hood, transcription is the shared «transcribir» piece: same as before, on your computer and with
  your vocabulary in a private file (never visible to other programs); it now also drops marks like [Music]. Your models stay in
  the same folder.*
- Al abrir «¿Borrar esta reunión?» con el teclado (⌘⌫), el foco ya no queda en «Borrar»: un Enter apurado no borra nada. Las
  tarjetas vuelven a tener su sombra suave. · *When you open «Delete this meeting?» with the keyboard (⌘⌫), the focus no longer
  lands on «Delete»: a hasty Enter deletes nothing. Cards have their soft shadow again.*
- Con el teclado, cada ventana (galería, corregir, preguntar, gimnasio…) se queda con el foco mientras está abierta, Esc la cierra
  (también «Corregir la nota con tu IA») y al cerrarla vuelves a donde estabas. Si llegan varios avisos juntos, salen uno tras otro
  en vez de taparse. · *With the keyboard, each window (gallery, fix, ask, gym…) keeps the focus while it's open, Esc closes it (also
  «Fix the note with your AI») and closing it takes you back where you were. Several notices in a row now show one after another
  instead of covering each other.*
- **Por dentro, piezas de Pieza:** tu IA ahora usa la pieza compartida de la familia (`ia`, con `nucleo`). Al probar tu IA en la
  bienvenida, corre con las mismas protecciones que al escribir tus notas: sin herramientas, sin tu memoria y en una carpeta
  temporal. Tus notas y tus datos siguen en el mismo lugar. · *Under the hood, Pieza pieces: your AI now uses the family's shared
  piece (`ia`, with `nucleo`). When you test your AI during setup, it runs with the same protections as when writing your notes:
  no tools, no memory and in a temporary folder. Your notes and data stay where they were.*
- **Nueva licencia:** desde esta versión, Minuta es AGPL-3.0, como sus apps hermanas. Sigue siendo gratis y abierta; si alguien la
  modifica y la ofrece a otras personas, tiene que compartir su código. Las versiones hasta la 0.3.1 siguen bajo MIT. · *New license:
  starting with this version, Minuta is AGPL-3.0, like its sister apps. It's still free and open; anyone who modifies it and offers it
  to others has to share their code. Versions up to 0.3.1 remain under MIT.*
- Más seguridad: si tu IA está desactualizada y no permite correr sin herramientas, Minuta ya no la usa sin esa protección
  y te pide actualizarla. La IA tampoco recibe tu memoria ni las variables de la app, y lo que le pides nunca va a la vista
  de otros programas. Las versiones nuevas solo se bajan desde los Releases de Minuta, y la app solo atiende pedidos de su
  propia ventana.
  *More security: if your AI is outdated and can't run without tools, Minuta no longer uses it without that protection and
  asks you to update it. The AI no longer gets your memory or the app's variables, and what you ask it is never visible to
  other programs. Updates are only downloaded from Minuta's Releases, and the app only listens to its own window.*
- En Windows y Linux, tu vocabulario (los nombres y palabras que le enseñas a Minuta para transcribir) ya no queda a la vista
  de otros programas mientras se transcribe: va en un archivo privado que se borra al terminar, como ya pasaba en Mac.
  *On Windows and Linux, your vocabulary (the names and words you teach Minuta for transcription) is no longer visible to
  other programs while transcribing: it goes in a private file that is deleted afterwards, as it already did on Mac.*
