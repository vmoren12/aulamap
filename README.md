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
- En crear una **configuració nova** es pot triar d'on surt l'alumnat: començar sense ningú
  o heretar la llista de qualsevol configuració, del mateix grup o d'un altre. Se'n copien
  els noms, els nivells de competència i les preferències; la distribució, les relacions i
  els equips comencen de zero.
- Desar i carregar la configuració activa en un fitxer `.json`.
- Desfer i refer (`Ctrl+Z` / `Ctrl+Y`) sobre qualsevol canvi.

### Alumnes
- Alta individual, alta massiva (una línia per nom) i importació des d'un altre perfil.
- **Importació i exportació en CSV** (`nom;nivell`), compatible amb qualsevol full de
  càlcul: també s'exporten la distribució de l'aula i els equips.
- Cerca ràpida i arrossegament directe cap als pupitres.

### Relacions: **ajuntar** i **separar**
- Es defineixen com a **conjunts** d'alumnes, no només parelles:
  - **Ajuntar** — els membres del conjunt han de seure junts formant un bloc de pupitres veïns.
  - **Separar** — cap parella del conjunt pot seure en pupitres veïns.
- Cada conjunt es pot omplir **alumne per alumne o triant-ne diversos de cop**.
- L'estat de cada conjunt es mostra en temps real (complert / incomplert / pendent),
  amb línies i indicadors sobre el mapa de l'aula i un percentatge global.
- Quan un conjunt no es compleix, s'explica **per què** (no hi ha cap bloc de pupitres
  veïns lliure, hi ha algú fixat amb cadenat, les separacions són contradictòries, no hi
  caben tants alumnes separats...) i un botó porta directament als pupitres implicats.

### Distribució de l'aula
- Plantilles: files, parelles, forma d'U, illes de 4, illes de 6, cercle i distribució lliure.
- Files, columnes i espaiat configurables; pupitres moguts a mà, afegits o eliminats.
- Taula del professorat a dalt o a baix, zoom, enquadrament i desplaçament del llenç.
- Selecció múltiple a Aula i Equips: arrossega el fons per seleccionar amb un rectangle, o fes Majúscules/Ctrl (Cmd a Mac) + clic per afegir o treure taules. Arrossega una taula seleccionada o el seu control de moviment per moure el conjunt. Esc o un clic al fons desmarca la selecció.
- **Eliminar seleccionats** o **Supr/Retrocés** elimina tots els pupitres seleccionats en una sola acció de desfer, després de confirmar-ho i dient quants alumnes es queden sense lloc. Els alumnes es conserven. A Equips només elimina la representació; **Organitzar** torna a mostrar els membres que falten.
- Desplaçament del llenç amb espai sostingut + arrossegament del ratolí; en pantalles tàctils, arrossega el fons amb un dit. Els moviments de taules es poden desfer i refer.
- Un clic al llenç hi trasllada el focus: l'espai no torna a activar l'últim botó premut.
- Un pupitre ocupat es pot **reassignar**: substituir l'alumne per un que no tingui lloc,
  intercanviar-lo amb el d'un altre pupitre o arrossegar-ne el nom fins al pupitre de destí.
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
- La pestanya **Equips** de la barra lateral (o de la navegació inferior en mòbil) activa un esquema amb contorns taronja subtils, independent dels pupitres i seients d'Aula; qualsevol altra pestanya torna a la vista d'aula. Es comparteix el llenç visual, però formar, carregar o moure equips no modifica la distribució del grup classe.
- Cada formació desada per a un treball o matèria conserva els membres i la seva distribució pròpia. **Organitzar** ordena només la formació activa.
- Mou els pupitres seleccionats amb el seu control de moviment, o un equip sencer amb el de la capçalera. Per canviar diversos alumnes de grup, selecciona'ls amb rectangle o Majúscules/Ctrl + clic i arrossega un dels noms sobre un pupitre o la capçalera del destí. També pots usar **Moure alumnes a…**. Els cadenats es respecten i tot el trasllat es desfà en una sola acció.
- Equips desats amb nom i data, exportació a text o CSV i exportació de l'aula a PDF.

### Equips per preferències de l'alumnat (sociograma)
Passa un formulari on cada alumne escriu el seu nom i amb qui voldria treballar, i
**Equips → Importar full de preferències** fa la resta:

- Llegeix el full de respostes en **CSV**, **TSV** o **Excel** (`.xlsx`), o enganxat
  directament des del full de càlcul. Tolera columnes buides, capçaleres de Google Forms
  (marca de temps, correu...), respostes incompletes, files sense nom i alumnes que
  responen dues vegades (es queda la resposta més nova).
- **Identifica els noms** encara que estiguin escrits a mitges, sense accents, en
  minúscules o amb els cognoms al davant. El que no es pot identificar amb seguretat
  s'informa en comptes d'endevinar-ho.
- Si els alumnes del full **no són els de la classe carregada**, avisa i pregunta què
  fer: afegir només els nous, substituir la llista, treballar només amb els que
  coincideixen o obrir una **configuració nova** sense tocar la classe actual.
- El docent tria **quants equips** vol (o quants alumnes per equip) i **què fer amb els
  sobrants**: equips desiguals (±1), un equip a part o deixar-los sense equip.
- Proposa el repartiment que **acompleix més preferències**, respectant els conjunts
  d'ajuntar i separar. Es pot **regenerar tantes vegades com calgui** i recuperar la
  millor proposta generada.
- La proposta es pot **retocar a mà** abans de carregar-la: arrossega un nom cap a un
  altre equip per moure'l, o a sobre d'un company per intercanviar-los (en pantalla
  tàctil, toca el nom i després el destí). Els percentatges es refan a cada canvi i la
  millor versió sempre es pot recuperar.
- Mostra el **percentatge global**, el de cada equip i el de cada alumne
  (`2/3`, amb color i amb el detall de qui té a prop i qui li falta). Els indicadors es
  queden al panell d'Equips, al llenç i a les exportacions.
- **Tornar a proposar** repeteix el repartiment amb les respostes ja carregades, sense
  haver de tornar a importar el full.
- L'aplicació recorda la **millor formació carregada** i, si després de fer proves el
  repartiment d'ara n'acompleix menys, ofereix **recuperar-la** amb un botó que en diu el
  percentatge. La memòria es manté mentre es treballa amb les mateixes respostes.

A `exemples/preferencies-60-alumnes.csv` hi ha un full de respostes de prova amb 60
alumnes inventats (amb columnes buides, una resposta repetida i un nom de fora del grup).

### Interfície
- **Mode clar i mode fosc** (menú de la capçalera), pensat per projectar sobre paret blanca.
- Barra lateral redimensionable, navegació inferior en pantalles petites i modals adaptats.

---

## Ús local

No cal cap instal·lació ni cap procés de compilació:

```bash
git clone https://github.com/vmoren12/aulamap.git
cd aulamap
# obre index.html amb el navegador, o serveix la carpeta:
python -m http.server 8000   # → http://localhost:8000
```

Les proves de lògica (veïnatge i relacions, selecció i moviment al llenç, esquemes
d'equips, accions declarades, CSV, pupitres i tot el circuit de les preferències) es
passen amb Node, sense cap dependència:

```bash
node --test tests/
```

`tests/browser-canvas.cjs` és una prova de navegador completa (necessita Puppeteer).

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
  preferences.css           Assistent de preferències i indicadors d'acompliment
  responsive.css            Navegació mòbil i adaptació a pantalles petites
assets/js/
  core.js                   Constants, utilitats, modals, selector d'alumnes i registre d'accions
  state.js                  Model de dades, persistència, migracions i desfer/refer
  profiles.js               Grups (perfils) i configuracions
  students.js               Gestió de l'alumnat
  relations.js              Veïnatge entre pupitres i relacions ajuntar/separar
  seating.js                Plantilles, pupitres i assignació manual
  autoassign.js             Assignació automàtica optimitzada
  teams.js                  Formació d'equips, restriccions i equips desats
  teamscanvas.js            Esquema d'equips sobre el llenç
  preferences.js            Full de preferències, repartiment òptim i indicadors
  exports.js                Fitxers .json, CSV i exportació a PDF
  ui.js                     Pestanyes, tema, zoom, desplaçament i repintat global
  canvasselection.js        Selecció múltiple i moviment de pupitres
  app.js                    Arrencada
tests/                      Proves de lògica (node --test tests/)
exemples/                   Fulls de respostes de prova
```

### Organització del codi

Tot el codi viu dins de l'espai de noms `window.AulaMap`: cada fitxer és una funció
anònima que hi registra el que ha de ser visible des de fora, de manera que no hi ha
funcions globals que puguin xocar entre elles.

La interfície no crida funcions des d'atributs `onclick`: els elements es marquen amb
`data-action` (clic), `data-change`, `data-input`, `data-dblclick`, `data-keydown` o
`data-press`, i un únic gestor per tipus d'esdeveniment resol l'acció registrada. Els
paràmetres viatgen en altres atributs `data-*` (`data-did`, `data-sid`, `data-idx`...).

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
    └── teams           mides, competències, restriccions, equips, esquema propi
                        (`layout`), equips desats i preferències de l'alumnat
                        (`preferences`: qui ha triat qui, l'origen del full i els
                        noms que no s'han pogut identificar)
```

Les dades de versions anteriors (`aulamap_v4`, `aulamap_equips_v1`) es migren
automàticament la primera vegada que s'obre l'aplicació: les parelles compatibles i
incompatibles passen a ser conjunts d'**ajuntar** i **separar**, i les dades d'equips
—que abans eren compartides entre tots els perfils— s'assignen a la configuració activa.

---

## Crèdits i llicència

© 2026 **Víctor Moreno de la Torre** — psicòleg i orientador educatiu.
Aplicació desenvolupada amb IA.

- **Codi** (HTML, CSS i JavaScript): [MIT](https://opensource.org/licenses/MIT).
- **Continguts** (textos, documentació i materials): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ca).
