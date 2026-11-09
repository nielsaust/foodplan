# Aan tafel

Een Nederlandstalige weekplanner voor het avondeten. De eerste keer dat je de app start, plant hij vanaf vandaag drie vegetarische, glutenvrije gerechten voor drie voorbeeldpersonen. De recepten zijn gebaseerd op de aangeleverde curry, linzenbolognese en tofu-edamame-roerbak.

## Lokaal starten met Docker

```sh
docker compose -f compose.local.yaml up --build -d
```

Open [Aan tafel](http://localhost:8787). Hernoem de voorbeeldpersonen via **Huisgenoten**. Gebruik in de weekplanning de personenknop bij een dag om aan te geven wie mee-eet. Klik op een geplande maaltijd voor het geschaalde recept. Houd de titel ingedrukt en sleep naar een vrije dag, of kies een datum via het dagmenu. Via **Recepten** kun je gerechten toevoegen, aanpassen en meerdere kenmerken tegelijk filteren. De recepteditor gebruikt de gedeelde ingrediëntenlijst. Via **Boodschappen** kun je de lijst met instelbare opmaak als tekst kopiëren.

```sh
docker compose -f compose.local.yaml logs -f app
docker compose -f compose.local.yaml down
```

Het volume `meals` bewaart de SQLite-database bij stoppen en opnieuw bouwen. De lokale poort bindt standaard aan loopback. Voor toegang op het LAN kun je `BIND_ADDRESS` instellen.

## VPS met nginx-proxy en Let's Encrypt

Kloon de repository op de VPS naar `/opt/foodplan` en gebruik branch `main`. Zet in die map een lokaal `.env`-bestand:

```dotenv
FOODPLAN_HOST=foodplan.example.com
ACME_CONTACT_EMAIL=beheer@example.com
```

Laat de hostnaam naar de VPS wijzen en controleer of de bestaande nginx-proxy en ACME-companion actief zijn. De standaard Compose-configuratie sluit aan op het externe netwerk `nginx-proxy` en geeft de hostnaam en interne poort door aan de proxy.

Scherm de hostnaam vóór de eerste start af in nginx-proxy, bijvoorbeeld met het hostspecifieke htpasswd-bestand. De app gebruikt één gedeeld huishouden en heeft geen eigen aanmelding. Controleer bij de eerste deploy zowel HTTPS als de toegangscontrole.

```sh
cd /opt/foodplan
docker compose up --build -d --wait
```

Bij migratie vanaf lokaal kun je via **Instellingen** een JSON-back-up downloaden en op de VPS terugzetten.

De workflow **Deploy naar VPS** werkt de checkout op de VPS bij na een push naar `main` en wacht tot de container gezond is. Voor de eerste deploy via GitHub Actions:

- Geef de VPS-deploygebruiker toegang tot `/opt/foodplan` en Docker. Bij een privérepository heeft de checkout ook leesrechten op GitHub nodig.
- Stel de Actions-variabelen `VPS_HOST`, `VPS_USER` en zo nodig `VPS_PORT` in. De standaardpoort is 22.
- Stel `VPS_SSH_KEY` en `VPS_KNOWN_HOSTS` in als Actions-secrets. Gebruik een aparte SSH-sleutel voor de workflow en verifieer de host key via de VPS-console.
- Zet na de handmatige controle `VPS_DEPLOY_ENABLED` op `true`. Start de workflow handmatig om de verbinding te testen.

## Ontwikkelen zonder Docker

Gebruik Node.js 22.13 of nieuwer.

```sh
npm ci
npm start
```

Start in een tweede terminal `npm run dev` en open de URL die Vite toont. Vite stuurt API-verzoeken door naar poort 8787. Voor een productiebuild buiten Docker gebruik je `npm run build` en open je na `npm start` de app op poort 8787. De standaarddatabase staat in `data/aan-tafel.sqlite`. Je kunt die locatie instellen met `DATABASE_PATH`.

## Opzet

- `domain/catalog.ts` bevat ingrediënten met vaste IDs en recepten met hoeveelheden voor één persoon. Een verwijzing zoals `{tofu}` of `{oil:0.5}` toont de geschaalde hoeveelheid van het ingrediënt in de bereidingsstap.
- `domain/planning.ts` bevat de datum-, portie- en boodschappenlogica, los van React.
- `server/` bevat een kleine HTTP-API met SQLite. Wijzigingen worden per actie atomair opgeslagen. Geopende apparaten die dezelfde server gebruiken, halen ongeveer elke vier seconden de actuele stand op.
- `src/` bevat de React-webinterface.

Huisgenoten hebben een handmatig instelbare portiefactor. De boodschappenlijst telt hoeveelheden uit geplande recepten samen voor de gekozen periode, vermeldt de gebruiksdatums en markeert indicatief wanneer je kort houdbare ingrediënten beter later kunt kopen. Losse boodschappen zijn gedeeld over alle periodes. Vinkjes voor receptingrediënten blijven gekoppeld aan dezelfde gebruiksdatums en hoeveelheden.

Caloriegestuurde porties, accountbeheer, offline synchronisatie en receptenimport vallen buiten deze eerste versie.
