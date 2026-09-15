# Körkortsfrågor

Övningsprov inför det svenska teoriprovet för B-körkort:
**<https://korkort.eliasf.se>**

1865 frågor med förklaring till varje svar, bildfrågor och videofrågor.
Statisk sida utan backend — nginx serverar `site/`, all logik ligger i
webbläsaren, och inget sparas någon annanstans än i din egen `localStorage`.

<p align="center">
  <img src="site/icons/screenshot-mobil.png" alt="Frågevy i mobilen" width="280">
</p>

## Funktioner

- **Provet** — 65 frågor, 52 rätt för godkänt, rättas först på slutet, precis
  som Trafikverkets prov. **Snabbtest** — 25 blandade frågor som rättas direkt.
- **Öva på ett område** — nio kategorier, från Vägmärken till Mörker & Halka.
- **Repetera misstag** — frågor du svarat fel på sparas och kan köras om.
- Genomgång efter provet med förklaring, bild och ditt svar per fråga.
- Tangentbord: `1`–`9` svarar, `Enter` går vidare.
- **Installerbar app (PWA)** med offlineläge — appskalet och hela frågebanken
  cachas, media sparas efter hand som du ser den.

## Frågebanken

`site/data/questions.json` är den sammanslagna banken: två insamlade källor i
ett gemensamt format.

| Källa | Frågor | Media |
|---|---:|---|
| ikorkort.nu (fria övningsbanken) | 1435 | 1173 bilder, 55 videoklipp |
| Ta Körkort-appens exam-databas | 430 | 330 bilder |

```json
{
  "id": "ikorkort-1",
  "source": "ikorkort",
  "category": "Miljö",
  "tags": ["sparsam-korning"],
  "question": "Vilket av följande påståenden om sparsam körning är korrekt?",
  "options": ["...", "...", "...", "..."],
  "answer": 3,
  "image": "images/bil36_b.jpg",
  "video": null,
  "explanation": ["stycke", "stycke"]
}
```

`image`/`video` är relativa till `site/media/`. `answer` pekar in i `options`,
som blandas både vid bygget och vid varje omgång i webbläsaren.

Kategorierna är ikorkort.nu:s åtta (Bilen, Stadskörning, Landsvägskörning,
Olyckor, Mörker & Halka, Människan, Miljö, Vägmärken). Ta Körkorts kapitel
mappas dit de motsvarar varandra (Fordonskännedom → Bilen, Personliga
förutsättningar → Människan, Miljö → Miljö); resten, mest kapitlet "Quiz",
hamnar i **Blandat**.

Bortvalt vid sammanslagningen: Ta Körkorts 50 videofrågor (klippen ligger på
privata Vimeo-id:n som inte går att spela upp, vilket gör frågorna
obesvarbara) och 3 dubbletter.

## Bygga

Råmaterialet ligger under `sources/`. Skripten är fristående `uv`-skript utan
projektberoenden.

```bash
./build.py           # sources/ -> site/data/questions.json
./fetch_media.py     # hämtar bilder och videoklipp till site/media/
./make_icons.py      # ritar om PWA-ikoner och delningsbild
```

Media (drygt 750 MB) ligger **inte** i git — `fetch_media.py` hämtar det från
källornas ursprungliga URL:er. Utan det fungerar sidan, men bildfrågorna
saknar bild.

## Drift

```bash
docker compose up -d          # nginx:alpine med site/ monterad read-only
```

Traefik-router `korkort` på `korkort.eliasf.se`, publik. Hälsokoll: `/health`.

## Om materialet

Frågorna är upphovsrättsskyddat material från ikorkort.nu respektive Ta
Körkort, insamlat för eget bruk — sidan är inte en officiell källa och har
ingen koppling till Trafikverket. Trafikverkets riktiga prov innehåller 65
räknade frågor där 52 rätt krävs för godkänt, vilket "Provet" härmar.
