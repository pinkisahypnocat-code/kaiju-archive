# Case Archive

A self-updating lore wiki for a Kaiju Paradise roleplay universe, hosted free on GitHub
Pages. Drop a folder with a `content.txt` file anywhere under `content/`, push, and it
shows up on the site automatically — no rebuilding by hand, no other website to touch.

## How it works

- Every folder under `content/` that contains a `content.txt` becomes a document.
- Folders that contain other folders become categories in the sidebar. Nesting can go
  as deep as you like.
- A GitHub Action (`.github/workflows/build-index.yml`) rebuilds `data/index.json`
  automatically every time you push a change under `content/`, then commits the result.
- The site itself (`index.html` / `assets/`) is plain HTML/CSS/JS — it just reads
  `data/index.json` and renders it. No build step, no npm install, nothing to install
  on your computer.

## One-time setup

1. Create a new GitHub repository and push everything in this folder to it.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick the `main`
   branch and `/ (root)` folder, then save.
4. Wait a minute or two — GitHub will give you a URL like
   `https://your-username.github.io/your-repo-name/`. That's your site.

The included `content/` folder has example files (Factions, Characters, Locations, plus
two sample faction pages) so you can see the format working immediately. Replace or
delete them with your own lore.

## Adding a new document

1. Make a new folder anywhere under `content/`, named after the topic, e.g.
   `content/factions/coast-guard`.
2. Put a `content.txt` file inside it.
3. Start the file with a heading, and optionally a `>` line under it for a short
   one-line description — this becomes the bold name + short description at the top
   of the page:

   ```
   # Coast Guard
   > Patrols the harbor after dark, first to respond to any breach

   Body text goes here. Blank lines start a new paragraph.

   **Status:** Active
   - bullet point
   - another bullet point
   ```

4. Commit and push. Within about a minute the GitHub Action rebuilds the index and the
   new page appears in the sidebar — nobody needs to touch any code.

### Formatting supported in content.txt

Everything below is rendered at build time by `scripts/build_index.py` — the browser
never parses your text, it just displays whatever HTML that script produced.

- `# Heading`, `## Heading`, `### Heading`
- `> short description` — only works directly under the `#` title; becomes the small
  tagline next to the photo
- **Blank line = new paragraph.** A single line break (just pressing enter once) stays
  *inside* the same paragraph as a line break, it doesn't get merged into one long
  flowing sentence. So:
  ```
  Первая строка.
  Вторая строка.
  ```
  renders as two visibly separate lines in the same paragraph block, while an empty
  line between them would start a whole new paragraph instead.
- `- item` = bullet list
- `**bold**` and `*italic*`
- `||hidden text||` = a spoiler, redacted with a black bar (see **Spoilers** below)
- `-i filename.jpg` at the very start of a line = an image (see **Adding images** below)
- `-pron ...` at the very start of a line = a pronoun tag (see **Pronoun tag** below)
- `-# small note` at the very start of a line = small muted text, same as Discord's
  subtext (see **Small text** below)
- **Real HTML tags work too** — write `<u>underlined</u>`, `<span style="color:#ff8800">custom
  color</span>`, `<br>`, whatever you need. It's inserted as-is, and everything above
  (bold, italic, spoilers, tags) still works on top of it. The one thing to watch: since
  raw `<` and `>` are no longer escaped, a stray `<` in normal prose (like "5 < 10")
  could get misread as the start of a tag — if you need a literal `<` or `>`, write
  `&lt;` / `&gt;` instead.

Anything else is shown as plain text, so you can't easily break it.

### Small text

`-#` at the start of a line, same syntax as Discord's subtext:

```
-# это маленькая сноска в стиле дискорда
```

Renders as small, muted, monospace text on its own line — good for out-of-character
notes, footnotes, or GM asides that shouldn't compete with the main lore text.

### Spoilers

Wrap anything in double pipes, same as Discord's syntax, and it renders as a solid
black bar instead of the real text: `The kaiju's true name is ||Xtharion||.` becomes
`The kaiju's true name is ████████.` It's a permanent redaction, not click-to-reveal —
there's no button or interaction, it just stays blacked out on the page. Useful for
things not every character (or player) is supposed to know yet — custom transfur
details, secret identities, plot twists you're saving for later.

To actually reveal something later, edit the file and remove the `||...||` around it,
then push — the bar disappears and the real text shows.

**One real limit worth knowing:** this hides the text from casual reading — someone
looking at the page or viewing page source won't see it. But it's still a public static
site with no login, so the raw text does still travel to every visitor's browser in the
background data (`data/index.json`), it's just never displayed. A friend who
deliberately opens browser dev tools and inspects that network request could still find
it. Treat it as "hidden from casual view," not "secure from someone trying to cheat."

### Adding images

**A profile photo at the top of the page** — two options, whichever is easier:

1. Add an image file named exactly `cover` next to `content.txt` — no tag needed:
   ```
   content/characters/rex/
     content.txt
     cover.jpg
   ```
   Any `cover.png` / `cover.jpg` / `cover.jpeg` / `cover.webp` / `cover.gif` is picked
   up automatically.

2. Or put `-i filename.jpg` as the very first line of the body — it becomes the header
   photo the same way:
   ```
   # Rex Calder
   -i photo.jpg

   Body text starts here...
   ```
   Either way, you still need the actual picture file sitting in that same folder —
   writing the filename in text doesn't create the image itself, it just tells the page
   which file to load.

**Custom images anywhere in the body** — put `-i filename.jpg` at the start of its own
line, anywhere after the header. This must be the very start of the line (not partway
through a sentence):

```
-i stage-two.jpg
```

By default it's shown centered at natural size. To control size and position, add a
file with the same name but a `.cfg` extension, next to the image:

```
content/subjects/transfurs/S-02/
  content.txt
  outbreak.jpg
  outbreak.cfg
```

```ini
[IMG_CFG]
pos=left
size=200x200
```

- `pos` — `left`, `right`, or `middle` (default). `left`/`right` float the image with
  text wrapping around it; `middle` centers it on its own line.
- `size` — `WIDTHxHEIGHT` in pixels (e.g. `200x200`), or just a width (e.g. `200`) for
  auto height. Leave the `.cfg` file out entirely to use the image's natural size.

### Pronoun tag

`-pron` at the start of a line auto-generates the colored "Местоимения: …" line you've
been typing by hand:

```
-pron Она/Её
```

renders as **Местоимения: Она/Её** in the accent color. Quotes are optional:
`-pron "Она/Её"` works the same way. If you need normal text to continue right after it
on the same line, separate it with a pipe:

```
-pron She/Her | остальной текст продолжается здесь
```

Everything after the `|` renders as ordinary text right after the tag.

### Browsing — swipe, buttons, or arrow keys

Documents that sit in the same category can be flipped through without going back to
the sidebar:
- **Touch:** swipe left/right on the document
- **Keyboard:** ← / → arrow keys
- **Mouse:** Previous / Next buttons at the bottom of the page

Every document slides in from the right with a soft synthesized sound effect (a real
`.ogg` file under `assets/sfx/`, not a copied clip) — toggleable with the SFX button in
the top right.

### Sub-categories

Nesting folders nests categories. For example:

```
content/
  factions/
    content.txt          <- "Factions" category page
    hunters/
      content.txt         <- a document under Factions
    kaiju/
      content.txt          <- a document under Factions
      subject-07/
        content.txt          <- nested under Kaiju
```

A folder doesn't need its own `content.txt` to act as a category — if it only holds
sub-folders, it just becomes a plain listing page in the sidebar.

## Mail / in-character mailboxes

Any folder anywhere under `content/` can also become a mailbox — separate from
whether it has a `content.txt` document page or not.

1. Add an `account.cfg` file to the folder:

   ```
   content/workers/scientists/Pink/
     content.txt
     cover.jpg
     account.cfg
   ```

   ```ini
   [ACCOUNT]
   name = Пинк
   email = pink@laminax.co
   ```

   A `cover.*` image in that same folder (already used for the document header
   photo) is reused as the mailbox avatar. No `content.txt` is required — a
   folder can be mail-only if you want.

2. Add a `_mail/` subfolder next to `account.cfg`, with one `.txt` file per
   email. Each one is parsed through the **exact same** `# Title` / `> tagline`
   / body pipeline as a document — subject = `#` title, `> tagline` becomes
   the inbox preview line, everything else (bold, spoilers, images, etc.)
   works the same way it does in `content.txt`:

   ```
   content/workers/scientists/Pink/_mail/
     01_welcome.txt
     02_reminder.txt
   ```

   ```
   # Инструктаж для новых сотрудников
   > Ознакомительное письмо перед первым допуском на объект

   Body text goes here, same syntax as any document.
   ```

   Files are read in filename order (`01_`, `02_`, ...) and shown newest-first
   in the inbox, so prefix them with numbers to control order.

3. Optionally add a `.cfg` file with the same name as the `.txt` (e.g.
   `02_reminder.cfg`) to set a display date and whether it starts unread:

   ```ini
   [MAIL]
   date = сегодня
   unread = true
   ```

   Leave the `.cfg` out entirely to just get no date shown and a read message.

4. Commit and push — the build script picks up every `account.cfg` it finds
   and writes `data/mail.json` alongside `data/index.json`.

On the site, the **Documents / Mail** switch in the top-right masthead swaps
the sidebar between the category tree and a Gmail-style inbox. The hamburger
(☰) in the mail topbar switches between mailboxes if there's more than one.
Read/unread state lives only in the browser tab (nothing is written back), so
it resets on reload — this is meant as in-character flavor, not persistence.

## Running the index build locally (optional)

If you want to preview `data/index.json` after editing files, without waiting for
GitHub Actions:

```bash
python3 scripts/build_index.py
```

Then open `index.html` in a browser (or run any local static server, e.g.
`python3 -m http.server`) to preview.

## Project structure

```
content/                  your lore lives here
  content.txt               root/home page
  factions/
  characters/
  locations/
data/index.json           auto-generated — do not edit by hand
scripts/build_index.py    the script that generates data/index.json
.github/workflows/        the GitHub Action that runs the script automatically
index.html, assets/       the site itself
```
