# Nordhammer Spel

Statisk spelhubb som ligger på **games.nordhammer.se**. Rena HTML/CSS/JS-filer, inget bygg­steg — Vercel serverar mappen direkt.

## Struktur

```
games-nordhammer/
├── index.html        # Startsida / spelmeny
└── spider/
    └── index.html    # Spindelpatiens (Spider Solitaire)
```

Lägg till ett nytt spel genom att skapa en ny mapp med en `index.html` och länka till den från startsidan (`/spelnamn/`).

## Deploya (GitHub → Vercel)

### 1. Skapa repo och pusha

Med GitHub CLI:

```bash
cd games-nordhammer
git init
git add -A
git commit -m "Nordhammer Spel: startsida + spindelpatiens"
gh repo create games-nordhammer --public --source=. --push
```

Eller manuellt (skapa först ett tomt repo på github.com, utan README):

```bash
cd games-nordhammer
git init
git add -A
git commit -m "Nordhammer Spel: startsida + spindelpatiens"
git branch -M main
git remote add origin git@github.com:<ditt-användarnamn>/games-nordhammer.git
git push -u origin main
```

### 2. Importera i Vercel

1. vercel.com → **Add New… → Project** → importera repot.
2. Framework Preset: **Other** (det är statiska filer, ingen build behövs).
3. Deploy.

### 3. Koppla domänen

I Vercel-projektet: **Settings → Domains → Add** → `games.nordhammer.se`.

Vercel visar då en CNAME-post. Lägg in den i one.coms DNS-panel:

```
Typ:   CNAME
Namn:  games
Värde: cname.vercel-dns.com
```

HTTPS-certifikat sätts upp automatiskt. Klart när DNS hunnit spridas (oftast några minuter, ibland upp till en timme).

## Uppdatera senare

Ändra en fil, `git commit` och `git push` → Vercel deployar om automatiskt.
