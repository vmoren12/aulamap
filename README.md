# AulaMap

**Planificador de distribució d'aula i formació d'equips de treball.**

AulaMap és una aplicació web per al professorat que permet dibuixar la distribució
dels pupitres d'una aula, col·locar-hi l'alumnat tenint en compte quins alumnes han
de seure junts o separats, i formar equips de treball equilibrats.

Funciona íntegrament al navegador: **no cal servidor ni registre** i **les dades no
surten mai del dispositiu** (es desen a l'emmagatzematge local del navegador).

👉 **[Obrir l'aplicació](https://vmoren12.github.io/aulamap/)**

---

## Funcionalitats

### Perfils i configuracions
- Diversos **grups** (perfils) independents, cadascun amb les seves **configuracions** d'aula.
- Desar i carregar la configuració activa en un fitxer `.json`.
- Desfer i refer (`Ctrl+Z` / `Ctrl+Y`) sobre qualsevol canvi.

### Alumnes
- Alta individual, alta massiva (una línia per nom) i importació des d'un altre perfil.
- Cerca ràpida i arrossegament directe cap als pupitres.

### Relacions: **ajuntar** i **separar**
- Es defineixen com a **conjunts** d'alumnes, no només parelles:
  - **Ajuntar** — els membres del conjunt han de seure junts formant un bloc de pupitres veïns.
  - **Separar** — cap parella del conjunt pot seure en pupitres veïns.
- Cada conjunt es pot omplir **alumne per alumne o triant-ne diversos de cop**.
- L'estat de cada conjunt es mostra en temps real (complert / incomplert / pendent),
  amb línies i indicadors sobre el mapa de l'aula i un percentatge global.

### Distribució de l'aula
- Plantilles: files, parelles, forma d'U, illes de 4, illes de 6, cercle i distribució lliure.
- Files, columnes i espaiat configurables; pupitres moguts a mà, afegits o eliminats.
- Taula del professorat a dalt o a baix, zoom, enquadrament i desplaçament del llenç.
- Selecció múltiple a Aula i Equips: arrossega el fons per seleccionar amb un rectangle, o fes Majúscules/Ctrl (Cmd a Mac) + clic per afegir o treure taules. Arrossega una taula seleccionada o el seu control de moviment per moure el conjunt. Esc o un clic al fons desmarca la selecció.
- **Eliminar seleccionats** o **Supr/Retrocés** elimina tots els pupitres seleccionats en una sola acció de desfer, conservant els alumnes. A Equips només elimina la representació; **Organitzar taules** torna a mostrar els membres que falten.
- Desplaçament del llenç amb espai sostingut + arrossegament del ratolí; en pantalles tàctils, arrossega el fons amb un dit. Els moviments de taules es poden desfer i refer.
- Un clic al llenç hi trasllada el focus: l'espai no torna a activar l'últim botó premut.
- Alumnes **fixats** amb cadenat: no es mouen en tornar a assignar.

### Assignació automàtica
Optimitza la col·locació amb **recuita simulada** i un refinament final per intercanvis:
respecta els alumnes fixats, pot deixar pupitres buits enmig per separar alumnes i
informa del percentatge de relacions acomplides.

### Equips de treball
- Mida d'equip configurable, amb dues maneres de tractar els alumnes sobrants
  (**equip nou** o **repartir-los** entre els equips).
- Restriccions pròpies d'**ajuntar** i **separar** (importables del panell Relacions).
- **Nivell de competència** opcional (0–10) i opció d'**equips heterogenis**.
- Equips i alumnes bloquejables entre repartiments.
- El menú **Equips** activa un esquema amb contorns taronja subtils, independent dels pupitres i seients d'Aula. Es comparteix el llenç visual, però formar, carregar o moure equips no modifica la distribució del grup classe.
- Cada formació desada per a un treball o matèria conserva els membres i la seva distribució pròpia. **Organitzar taules** ordena només la formació activa.
- Mou els pupitres seleccionats amb el seu control de moviment, o un equip sencer amb el de la capçalera. Per canviar diversos alumnes de grup, selecciona'ls amb rectangle o Majúscules/Ctrl + clic i arrossega un dels noms sobre un pupitre o la capçalera del destí. També pots usar **Moure alumnes a…**. Els cadenats es respecten i tot el trasllat es desfà en una sola acció.
- Equips desats amb nom i data, exportació a text i exportació de l'aula a PDF.

---

## Ús local

No cal cap instal·lació ni cap procés de compilació:

```bash
git clone https://github.com/vmoren12/aulamap.git
cd aulamap
# obre index.html amb el navegador, o serveix la carpeta:
python -m http.server 8000   # → http://localhost:8000
```

> L'exportació a PDF i les tipografies es carreguen des d'un CDN, de manera que
> necessiten connexió. La resta de funcionalitats funcionen sense connexió.

## Publicació a GitHub Pages

El repositori ja està preparat: a **Settings → Pages**, tria
*Deploy from a branch* amb la branca `main` i la carpeta `/ (root)`.
L'aplicació queda publicada a `https://<usuari>.github.io/aulamap/`.

---

## Estructura del projecte

```
index.html                  Estructura de la interfície
assets/css/
  tokens.css                Variables de color, tipografia i mides
  base.css                  Capçalera, botons, modals i notificacions
  sidebar.css               Barra lateral, llistes i conjunts d'alumnes
  canvas.css                Llenç de l'aula, pupitres i controls
  teams.css                 Panell i taules d'equips
  responsive.css            Navegació mòbil i adaptació a pantalles petites
assets/js/
  core.js                   Constants, utilitats, modals i selector d'alumnes
  state.js                  Model de dades, persistència, migracions i desfer/refer
  profiles.js               Grups (perfils) i configuracions
  students.js               Gestió de l'alumnat
  relations.js              Veïnatge entre pupitres i relacions ajuntar/separar
  seating.js                Plantilles, pupitres i assignació manual
  autoassign.js             Assignació automàtica optimitzada
  teams.js                  Formació d'equips, restriccions i equips desats
  teamscanvas.js            Taules d'equip al llenç
  exports.js                Fitxers .json i exportació a PDF
  ui.js                     Pestanyes, zoom, desplaçament i repintat global
  app.js                    Arrencada
```

### Model de dades

Tot es desa sota la clau `aulamap_v5` de `localStorage`, amb aquesta forma:

```
state
└── configs[grup].configurations[i].data
    ├── centreName, curs, nivell, aula
    ├── students[]      { id, name, color }
    ├── relations[]     { id, type: 'together' | 'separate', students: [id] }
    ├── desks[], assignments{}, lockedDesks{}
    ├── layoutType, layoutRows, layoutCols, layoutSpacing, teacherAtBottom
    └── teams           mides, competències, restriccions, equips i equips desats
```

Les dades de versions anteriors (`aulamap_v4`, `aulamap_equips_v1`) es migren
automàticament la primera vegada que s'obre l'aplicació: les parelles compatibles i
incompatibles passen a ser conjunts d'**ajuntar** i **separar**, i les dades d'equips
—que abans eren compartides entre tots els perfils— s'assignen a la configuració activa.

---

## Crèdits i llicència

Aplicació desenvolupada per **Víctor Mariano Moreno de la Torre** amb IA.

Distribuïda sota llicència
[Creative Commons Reconeixement-CompartirIgual 4.0 Internacional (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/deed.ca).
