# Nordhammer Spel

Statisk spelhubb som ligger på **games.nordhammer.se**. Rena HTML/CSS/JS-filer, inget bygg­steg — Vercel serverar mappen direkt.

## Struktur

```
games-nordhammer/
├── index.html        # Startsida / spelmeny
└── spider/
    └── index.html    # Spindelpatiens (Spider Solitaire)
```

Lägg till ett nytt spel: skapa en ny mapp med en `index.html` och länka till den från startsidan (`/spelnamn/`).

## Deploya (GitHub → Vercel)

Mappen är **redan git-initierad** med en commit på branchen `main`. Du behöver alltså inte köra `git init`.

### 1. Pusha till GitHub

Enklast, med GitHub CLI (skapar repot och pushar i ett steg):

```bash
cd games-nordhammer
gh repo create games-nordhammer --public --source=. --push
```

Eller manuellt — skapa först ett tomt repo på github.com (utan README), sedan:

```bash
cd games-nordhammer
git remote add origin git@github.com:<ditt-användarnamn>/games-nordhammer.git
git push -u origin main
```

### 2. Importera i Vercel

1. vercel.com → **Add New… → Project** → importera repot.
2. Framework Preset: **Other** (statiska filer, ingen build behövs).
3. Deploy.

### 3. Koppla domänen

I Vercel-projektet: **Settings → Domains → Add** → `games.nordhammer.se`.

Lägg sedan in CNAME-posten hos one.com:

```
Typ:   CNAME
Namn:  games
Värde: cname.vercel-dns.com
```

HTTPS sätts upp automatiskt. Klart när DNS spridits (oftast några minuter).

## Uppdatera senare

Ändra en fil → `git commit` → `git push`. Vercel deployar om automatiskt.
