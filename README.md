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
- Si el formulari també pregunta **amb qui no vol coincidir**, les columnes de separació
  («Separar 1», «Separar 2», «Amb qui NO vols treballar?»...) es detecten per la
  capçalera i es poden assignar a mà. No cal que n'hi hagi cap, i tampoc cal que tothom
  les respongui.
- El full pot dur també **dades de composició del grup** que l'aplicació reparteix entre
  els equips: el **grup d'origen** (lletres o paraules d'un conjunt curt: «aire»,
  «terra», «aigua»...), el **sexe** i les **necessitats educatives** (normalment una
  «S»; les caselles buides o amb un «no» no marquen ningú). Es reconeixen per la
  capçalera i, com totes les altres, **el docent pot dir quina columna conté cada
  variable** —o cap— al pas de les columnes. Cada dada es pot activar o desactivar abans
  de generar la proposta.
- I una columna de **competència** amb un valor numèric (una nota, un nivell
  d'assoliment...). El docent en confirma el **mínim i el màxim** de l'escala —per
  defecte, els que s'hagin detectat al full— i aquests dos extrems es converteixen en el
  0 i el 10 del **nivell de competència del panell d'equips**, que s'omple tot sol en
  carregar la proposta. Amb l'opció activada, els equips es formen **igualant-ne el
  nivell mitjà**, que és el que fa els grups heterogenis.
- **Identifica els noms** encara que estiguin escrits a mitges, sense accents, en
  minúscules o amb els cognoms al davant. El que no es pot identificar amb seguretat
  s'informa en comptes d'endevinar-ho.
- Si els alumnes del full **no són els de la classe carregada**, avisa i pregunta què
  fer: afegir només els nous, substituir la llista, treballar només amb els que
  coincideixen o obrir una **configuració nova** sense tocar la classe actual.
- El docent tria **quants equips** vol (o quants alumnes per equip) i **què fer amb els
  sobrants**: equips desiguals (±1), un equip a part o deixar-los sense equip.
- Proposa el repartiment que **acompleix més preferències** i, alhora, **separa qui ho ha
  demanat**: una petició de separació pesa més que qualsevol tria, i els conjunts
  d'ajuntar i separar que el docent hagi escrit a mà encara manen per sobre de totes
  dues. Si algú apareix a les dues columnes, mana la separació. Es pot **regenerar
  tantes vegades com calgui** i recuperar la millor proposta generada.
- El **criteri d'èxit** es pot canviar abans de generar la proposta:
  - **Acomplir el màxim de preferències** (per defecte): cada alumne coincideix amb
    tanta gent de la seva llista com es pugui.
  - **Una preferència per alumne**: es minimitza que ningú coincideixi amb més d'una de
    les seves tries. L'escenari ideal és exactament una, i **quedar-se a zero no és una
    alternativa acceptable**: qui ha respost i no tindria ningú de la seva llista pesa
    més que qualsevol desequilibri de composició —només una petició de separació o un
    conjunt del docent hi passen al davant—, i entre dues propostes sempre mana la que
    deixa menys gent sense ningú. Si amb aquelles mides d'equip i aquelles restriccions
    no hi ha manera, es diu **qui ha quedat fora** i es marca el seu nom.
    Amb aquest criteri, el percentatge de preferències acomplertes deixa de mostrar-se
    —acomplir-ne més no seria millor—: al seu lloc es compten els alumnes que en tenen
    just una, tant al resum com a cada equip.
- Un cop carregada la proposta, el botó **Formar equips** del panell segueix respectant
  tot el que es va definir en importar el full (tries, separacions, composició, criteri
  d'èxit) i **hi suma el que s'hi hagi afegit després**: els conjunts d'ajuntar i
  separar, els nivells de competència i els equips o alumnes amb cadenat.
- Amb les dades de composició carregades, els equips es formen **equilibrant el grup
  d'origen, el sexe i les necessitats educatives**: repartir cada valor entre tots els
  equips és exactament minimitzar les parelles que el comparteixen dins d'un mateix
  equip, i és el que fa el repartidor.
- Les separacions es poden **desactivar** abans de generar la proposta; els indicadors
  segueixen dient quantes se n'estan deixant passar.
- La proposta es pot **retocar a mà** abans de carregar-la: arrossega un nom cap a un
  altre equip per moure'l, o a sobre d'un company per intercanviar-los (en pantalla
  tàctil, toca el nom i després el destí). Els percentatges es refan a cada canvi i la
  millor versió sempre es pot recuperar.
- Mostra el **percentatge global**, el de cada equip i el de cada alumne
  (`2/3`, amb color i amb el detall de qui té a prop i qui li falta). Els indicadors es
  queden al panell d'Equips, al llenç i a les exportacions.
- Dóna el **grau d'assoliment de cada criteri** amb la seva barra: preferències
  acomplertes (o alumnes amb una sola tria acomplerta, segons el criteri triat),
  separacions respectades i equilibri de cada dada de composició i del nivell mitjà. Surten a la proposta i al **menú lateral del llenç**, on es
  refan **en temps real** a cada canvi d'equip, i cada targeta d'equip diu com ha quedat
  composta («Grup aire 2 · terra 2 · Sexe D 2 · H 2»).
- Compta les **separacions respectades** i, quan amb aquelles mides d'equip no n'hi ha
  prou per a totes, marca l'alumne i l'equip i **diu quines parelles han quedat juntes**.
- **Tornar a proposar** repeteix el repartiment amb les respostes ja carregades, sense
  haver de tornar a importar el full.
- L'aplicació recorda la **millor formació carregada** i, si després de fer proves el
  repartiment d'ara n'acompleix menys, ofereix **recuperar-la** amb un botó que en diu el
  percentatge —sempre el del criteri triat— i, quan guanya sense guanyar-hi en
  percentatge, **en què guanya** (ningú sense tria, separacions respectades, equips més
  equilibrats). La memòria es manté mentre es treballa amb les mateixes respostes i amb
  el mateix criteri: si es canvia el criteri, els percentatges deixen de ser comparables
  i es comença de nou.
- Formar equips d'una classe sencera dura un moment: mentre hi treballa, el botó que
  s'ha premut queda **en espera**, amb el seu indicador, i no s'hi pot tornar a clicar.

- En **exportar els equips** es tria el format: **text** (la llista per llegir o
  imprimir, amb el grau de cada criteri i la composició de cada equip) o **CSV** (una
  fila per alumne amb l'equip, el nivell si n'hi ha, el grup d'origen, el sexe, les
  necessitats i el recompte de tries i separacions).

A `exemples/` hi ha fulls de respostes de prova amb alumnes inventats:
`preferencies-30-alumnes-complet.xlsx` i el mateix full en `.csv` (30 alumnes amb totes
les columnes: marca de temps, nom, grup d'origen, sexe, necessitats educatives,
competència d'1 a 10, tres preferències i una separació), `preferencies-60-alumnes.csv` (60 alumnes, amb columnes
buides, una resposta repetida i un nom de fora del grup) i
`preferencies-28-alumnes-separacions.csv` (28 alumnes amb una columna de separació:
peticions recíproques i d'una sola banda, algú que només respon la separació, un nom
escrit amb el cognom al davant i un altre de fora del grup).

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
  preferences.css           Assistent de preferències i separacions, i indicadors de cada criteri
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
  preferences.js            Full de preferències, separacions i composició del grup;
                            repartiment òptim, criteri d'èxit i indicadors
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
                        (`preferences`: qui ha triat qui (`prefs`), qui vol estar
                        separat de qui (`avoid`), el grup d'origen, el sexe i les
                        necessitats de cadascú (`attributes`), la competència del
                        full i la seva escala (`levels`, `levelRange`), quines
                        d'aquestes dades s'equilibren (`balance`), el criteri
                        d'èxit (`criterion`), l'origen del full i els noms que no
                        s'han pogut identificar)
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
