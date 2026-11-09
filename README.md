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

Kloon de repository als root op de VPS naar `/srv/docker-projects/foodplan` en gebruik branch `main`. Zet in die map een lokaal `.env`-bestand dat alleen root kan lezen (`chmod 600 .env`):

```dotenv
FOODPLAN_HOST=foodplan.nielsaust.nl
ACME_CONTACT_EMAIL=beheer@example.com
```

Gebruik optioneel `FOODPLAN_HOUSEHOLD_NAME` voor de groepsnaam en `FOODPLAN_MEMBER_NAMES` voor drie namen, gescheiden door komma’s. De namen vervangen de drie standaardnamen met behoud van aanwezigheid en portiefactor. De SQLite-database staat op de VPS in het Docker-volume `meals`.

Laat de hostnaam naar de VPS wijzen en controleer of de bestaande nginx-proxy en ACME-companion actief zijn. De standaard Compose-configuratie sluit aan op het externe netwerk `nginx-proxy` en geeft de hostnaam en interne poort door aan de proxy.

Scherm de hostnaam vóór de eerste start af in nginx-proxy, bijvoorbeeld met het hostspecifieke htpasswd-bestand. De app gebruikt één gedeeld huishouden en heeft geen eigen aanmelding. Controleer bij de eerste deploy zowel HTTPS als de toegangscontrole.

```sh
cd /srv/docker-projects/foodplan
sudo install -d -m 0700 -o 1000 -g 1000 /srv/docker-projects/foodplan/.deploy
sudo docker compose up --build -d --wait
```

Bij migratie vanaf lokaal kun je via **Instellingen** een JSON-back-up downloaden en op de VPS terugzetten.

### Automatisch deployen met een GitHub-webhook

De VPS verwerkt alleen ondertekende pushes naar `main` van `nielsaust/foodplan`. Het verzoek zet een seintje klaar. Systemd haalt daarna `main` op, bouwt de container en wacht tot die gezond is.

1. Genereer een aparte sleutel met `openssl rand -hex 32` en zet die in de afgeschermde VPS-`.env` als `DEPLOY_WEBHOOK_SECRET`. Gebruik dezelfde waarde in GitHub bij **Settings → Webhooks → Add webhook**. Houd de sleutel buiten Git.
2. Installeer de twee bestanden `deploy/foodplan-deploy.path` en `deploy/foodplan-deploy.service` in `/etc/systemd/system/`. Houd de checkout en de `.env` onder beheer van root, omdat systemd Docker als root aanroept. Voer `sudo systemctl daemon-reload` en `sudo systemctl enable --now foodplan-deploy.path` uit.
3. Plaats de inhoud van `deploy/foodplan.nielsaust.nl.nginx` in de hostspecifieke configuratie `/etc/nginx/vhost.d/foodplan.nielsaust.nl` van de bestaande proxy. De exacte webhookroute gebruikt de GitHub-handtekening voor authenticatie. De rest van de site blijft onder de toegangscontrole van de proxy vallen. Controleer de proxyconfiguratie met `nginx -t` in de proxycontainer en herlaad die daarna.
4. Start de app opnieuw met `sudo docker compose up --build -d --wait`. Configureer de webhook met payload-URL `https://foodplan.nielsaust.nl/api/deploy`, contenttype `application/json`, SSL-verificatie aan en alleen het **push**-event. Controleer de ping in GitHub en volg de eerste deploy met `sudo journalctl -u foodplan-deploy.service -f`.

Een geldige push krijgt HTTP 202 zodra de deploy klaarstaat. De uitkomst van de deploy staat in het VPS-log. Na een mislukte deploy kun je dezelfde GitHub-delivery opnieuw versturen of `sudo systemctl start foodplan-deploy.service` uitvoeren.

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
