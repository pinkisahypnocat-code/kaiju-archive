#!/usr/bin/env python3
"""
Walks the content/ directory looking for folders that contain a content.txt file.
Each such folder becomes a "document" node. Folders that contain other folders
become categories, nested to any depth.

This script also fully renders each content.txt into final HTML (paragraphs, line
breaks, images, spoilers, pronoun tags — see the syntax guide in README.md) so the
website itself just injects ready-made HTML instead of parsing markdown in the
browser. The result is written to data/index.json, which the website reads at load
time.

Run manually with: python3 scripts/build_index.py
The GitHub Action runs this automatically on every push.
"""

import os
import re
import json
import configparser

ROOT = "content"
OUTPUT = "data/index.json"
OUTPUT_MAIL = "data/mail.json"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
ACCOUNT_CFG = "account.cfg"
MAIL_DIR = "_mail"


# ============================================================================
# Small helpers
# ============================================================================

def make_title(name):
    """Turn a folder name like 'old-harbor_district' into 'Old Harbor District'."""
    name = re.sub(r"[-_]+", " ", name)
    return name.strip().title()


def escape_html(text):
    return (text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;"))


def escape_attr(text):
    return escape_html(text).replace('"', "&quot;")


# ============================================================================
# Header extraction: "# Title" and optional "> tagline" at the top of the file
# ============================================================================

def split_header(text, fallback_title):
    """Pulls the '# Title' line and an optional '> short description' line off the
    top of a content.txt. Returns (title, tagline, remaining_body). The title and
    tagline lines are removed from the body so they aren't shown twice."""
    lines = text.replace("\r\n", "\n").split("\n")
    i = 0
    title = None
    tagline = None

    while i < len(lines) and lines[i].strip() == "":
        i += 1

    if i < len(lines) and lines[i].strip().startswith("# "):
        title = lines[i].strip()[2:].strip()
        i += 1
        while i < len(lines) and lines[i].strip() == "":
            i += 1
        if i < len(lines) and lines[i].strip().startswith(">"):
            tagline = lines[i].strip().lstrip(">").strip()
            i += 1

    remaining = "\n".join(lines[i:]).lstrip("\n")
    return title or fallback_title, tagline, remaining


# ============================================================================
# Cover image detection
# ============================================================================

IMG_TAG_RE = re.compile(r"^-i\s+(\S+)$")
PRON_TAG_RE = re.compile(r"^-pron\s+(.+)$", re.IGNORECASE)
SUBTEXT_RE = re.compile(r"^-#\s*(.*)$")
HEADING_RE = re.compile(r"^(#{1,3})\s+(.*)$")
LIST_RE = re.compile(r"^[-*]\s+(.*)$")
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
ITALIC_RE = re.compile(r"(^|[^*])\*(?!\*)(.+?)\*(?!\*)")
SPOILER_RE = re.compile(r"\|\|(.+?)\|\|")


def find_cover_image(dir_path, rel_path):
    """Looks for a file literally named 'cover.png' / 'cover.jpg' / etc in a
    document's folder and returns its site-root-relative path, or None."""
    try:
        entries = os.listdir(dir_path)
    except FileNotFoundError:
        return None
    for entry in entries:
        name, ext = os.path.splitext(entry)
        if name.lower() == "cover" and ext.lower() in IMAGE_EXTS:
            prefix = f"{ROOT}/{rel_path}" if rel_path else ROOT
            return f"{prefix}/{entry}"
    return None


def extract_leading_cover_tag(body, rel_path):
    """If the first non-blank line of the body is a '-i filename' tag, treat it as
    the header photo and strip that line from the body. Only used when no literal
    cover.* file was found."""
    lines = body.split("\n")
    i = 0
    while i < len(lines) and lines[i].strip() == "":
        i += 1
    if i < len(lines):
        m = IMG_TAG_RE.match(lines[i].strip())
        if m:
            image = resolve_path(m.group(1), rel_path)
            remaining = "\n".join(lines[:i] + lines[i + 1:]).lstrip("\n")
            return image, remaining
    return None, body


def resolve_path(filename, rel_path):
    if re.match(r"^https?://", filename, re.IGNORECASE) or filename.startswith("/"):
        return filename
    prefix = f"{ROOT}/{rel_path}" if rel_path else ROOT
    return f"{prefix}/{filename}"


# ============================================================================
# Inline formatting: **bold**, *italic*, ||spoiler||
# ============================================================================

def render_spoiler(match):
    hidden = escape_html(match.group(1))
    n = max(4, len(hidden))
    # a real ogg-style black bar made of block characters — a zero-width space
    # is inserted every 12 characters so long spoilers can still wrap onto a
    # second line instead of overflowing the page
    chars = []
    for i in range(n):
        chars.append("\u2588")  # █
        if (i + 1) % 12 == 0:
            chars.append("\u200b")  # zero-width space, a guaranteed break point
    bar = "".join(chars)
    return f'<span class="spoiler" aria-label="скрытый текст">{bar}</span>'


def inline(text):
    # Raw HTML in content.txt is passed straight through untouched — you can write
    # real tags like <u>, <span style="...">, <br>, etc. directly. The shorthand
    # syntax below still works on top of that, it just adds more HTML around
    # whatever you wrote; it doesn't require escaping first.
    out = text
    out = BOLD_RE.sub(r"<strong>\1</strong>", out)
    out = ITALIC_RE.sub(lambda m: f"{m.group(1)}<em>{m.group(2)}</em>", out)
    out = SPOILER_RE.sub(render_spoiler, out)
    return out


# ============================================================================
# "-pron X" and "-pron X | continuing text" tags
# ============================================================================

def render_pron_tag(raw, rel_path):
    raw = raw.strip()
    extra = None
    if "|" in raw:
        value_part, extra_part = raw.split("|", 1)
        raw = value_part.strip()
        extra = extra_part.strip()

    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        raw = raw[1:-1]

    html = f'<span class="pron-tag">Местоимения: {inline(raw)}</span>'
    if extra:
        html += f" {inline(extra)}"
    return html


# ============================================================================
# "-i filename.jpg" tags, with optional filename.cfg for position/size
# ============================================================================

def read_img_cfg(cfg_path):
    pos = "middle"
    size = None
    if os.path.isfile(cfg_path):
        parser = configparser.ConfigParser()
        try:
            parser.read(cfg_path, encoding="utf-8")
            section = None
            if parser.has_section("IMG_CFG"):
                section = parser["IMG_CFG"]
            elif parser.sections():
                section = parser[parser.sections()[0]]
            if section is not None:
                pos = section.get("pos", fallback="middle").strip().lower()
                size = (section.get("size", fallback="") or "").strip() or None
        except configparser.Error as e:
            print(f"WARNING: could not read {cfg_path}: {e}")
    if pos not in ("left", "right", "middle"):
        pos = "middle"
    return pos, size


def size_to_style(size):
    if not size:
        return ""
    size = size.strip().lower()
    parts = []
    if "x" in size:
        w, h = size.split("x", 1)
        w, h = w.strip(), h.strip()
        if w:
            parts.append(f"width:{w}px")
        if h:
            parts.append(f"height:{h}px")
    elif size:
        parts.append(f"width:{size}px")
    return f' style="{";".join(parts)}"' if parts else ""


def render_image_tag(filename, dir_path, rel_path):
    stem = os.path.splitext(filename)[0]
    cfg_path = os.path.join(dir_path, f"{stem}.cfg")
    pos, size = read_img_cfg(cfg_path)

    img_disk_path = os.path.join(dir_path, filename)
    if not os.path.isfile(img_disk_path):
        print(f"WARNING: image not found: {img_disk_path} (referenced with -i)")

    src = resolve_path(filename, rel_path)
    style_attr = size_to_style(size)
    return (f'<figure class="doc-figure doc-figure-{pos}"{style_attr}>'
            f'<img src="{escape_attr(src)}" alt="" loading="lazy"></figure>')


# ============================================================================
# Full body renderer
# ============================================================================

def render_body_html(body, dir_path, rel_path):
    lines = body.replace("\r\n", "\n").split("\n")
    html_parts = []
    para_lines = []
    list_items = []

    def flush_para():
        if para_lines:
            html_parts.append(f"<p>{'<br>'.join(para_lines)}</p>")
            para_lines.clear()

    def flush_list():
        if list_items:
            items = "".join(f"<li>{li}</li>" for li in list_items)
            html_parts.append(f"<ul>{items}</ul>")
            list_items.clear()

    for raw_line in lines:
        line = raw_line.strip()

        if line == "":
            flush_para()
            flush_list()
            continue

        m_img = IMG_TAG_RE.match(line)
        if m_img:
            flush_para()
            flush_list()
            html_parts.append(render_image_tag(m_img.group(1), dir_path, rel_path))
            continue

        m_sub = SUBTEXT_RE.match(line)
        if m_sub:
            flush_para()
            flush_list()
            html_parts.append(f'<p class="subtext">{inline(m_sub.group(1))}</p>')
            continue

        m_pron = PRON_TAG_RE.match(line)
        if m_pron:
            para_lines.append(render_pron_tag(m_pron.group(1), rel_path))
            continue

        m_h = HEADING_RE.match(line)
        if m_h:
            flush_para()
            flush_list()
            level = len(m_h.group(1))
            html_parts.append(f"<h{level}>{inline(m_h.group(2))}</h{level}>")
            continue

        m_li = LIST_RE.match(line)
        if m_li:
            flush_para()
            list_items.append(inline(m_li.group(1)))
            continue

        flush_list()
        para_lines.append(inline(line))

    flush_para()
    flush_list()

    return "".join(html_parts) if html_parts else "<p><em>(пусто)</em></p>"


# ============================================================================
# Tree walk
# ============================================================================

def build_tree(dir_path, rel_path=""):
    name = os.path.basename(dir_path) if rel_path else "Home"
    node = {
        "name": name,
        "title": make_title(name) if rel_path else "Home",
        "path": rel_path,
        "hasContent": False,
        "html": None,
        "tagline": None,
        "image": None,
        "children": [],
    }

    content_file = os.path.join(dir_path, "content.txt")
    if os.path.isfile(content_file):
        with open(content_file, "r", encoding="utf-8") as f:
            raw = f.read()
        title, tagline, body = split_header(raw, node["title"])
        node["hasContent"] = True
        node["title"] = title
        node["tagline"] = tagline

        node["image"] = find_cover_image(dir_path, rel_path)
        if not node["image"]:
            auto_image, body = extract_leading_cover_tag(body, rel_path)
            if auto_image:
                node["image"] = auto_image

        node["html"] = render_body_html(body, dir_path, rel_path)

    try:
        entries = sorted(os.listdir(dir_path))
    except FileNotFoundError:
        entries = []

    for entry in entries:
        full = os.path.join(dir_path, entry)
        if os.path.isdir(full) and not entry.startswith("."):
            child_rel = f"{rel_path}/{entry}" if rel_path else entry
            child_node = build_tree(full, child_rel)
            if child_node["hasContent"] or child_node["children"]:
                node["children"].append(child_node)

    return node


def read_account_cfg(cfg_path):
    """Reads account.cfg's [ACCOUNT] section (name=, email=)."""
    name, email = None, None
    parser = configparser.ConfigParser()
    try:
        parser.read(cfg_path, encoding="utf-8")
        section = None
        if parser.has_section("ACCOUNT"):
            section = parser["ACCOUNT"]
        elif parser.sections():
            section = parser[parser.sections()[0]]
        if section is not None:
            name = (section.get("name", fallback="") or "").strip() or None
            email = (section.get("email", fallback="") or "").strip() or None
    except configparser.Error as e:
        print(f"WARNING: could not read {cfg_path}: {e}")
    return name, email


def read_mail_cfg(cfg_path):
    """Reads an optional per-message .cfg (same stem as the .txt) for a [MAIL]
    section: date=, unread=true/false. Everything is optional."""
    date, unread = None, False
    if os.path.isfile(cfg_path):
        parser = configparser.ConfigParser()
        try:
            parser.read(cfg_path, encoding="utf-8")
            section = None
            if parser.has_section("MAIL"):
                section = parser["MAIL"]
            elif parser.sections():
                section = parser[parser.sections()[0]]
            if section is not None:
                date = (section.get("date", fallback="") or "").strip() or None
                unread = section.getboolean("unread", fallback=False)
        except (configparser.Error, ValueError) as e:
            print(f"WARNING: could not read {cfg_path}: {e}")
    return date, unread


def read_mail_folder(mail_dir, mail_rel):
    """Reads every .txt in a _mail/ folder through the same header/body pipeline
    as documents, pairing each with an optional same-stem .cfg for date/unread.
    Returns a list of message dicts, sorted by filename."""
    messages = []
    if not os.path.isdir(mail_dir):
        return messages

    try:
        entries = sorted(os.listdir(mail_dir))
    except FileNotFoundError:
        entries = []

    for entry in entries:
        if not entry.lower().endswith(".txt"):
            continue
        msg_path = os.path.join(mail_dir, entry)
        stem = os.path.splitext(entry)[0]
        with open(msg_path, "r", encoding="utf-8") as f:
            raw = f.read()

        subject, tagline, body = split_header(raw, make_title(stem))
        image = find_cover_image(mail_dir, mail_rel)  # rarely used, but stays consistent
        html = render_body_html(body, mail_dir, mail_rel)

        cfg_stem_path = os.path.join(mail_dir, f"{stem}.cfg")
        date, unread = read_mail_cfg(cfg_stem_path)

        messages.append({
            "id": stem,
            "subject": subject,
            "preview": tagline,
            "date": date,
            "unread": unread,
            "image": image,
            "html": html,
        })

    return messages


def build_mail_account(dir_path, rel_path, global_messages):
    """Builds one mailbox for a folder containing account.cfg. Its inbox is the
    global content/_mail/ messages (shared by every account, so they don't need
    to be copy-pasted into each mailbox) plus any messages in its own sibling
    _mail/ folder, merged and sorted together by filename."""
    cfg_path = os.path.join(dir_path, ACCOUNT_CFG)
    name, email = read_account_cfg(cfg_path)
    account_id = rel_path or os.path.basename(dir_path)

    mail_dir = os.path.join(dir_path, MAIL_DIR)
    mail_rel = f"{rel_path}/{MAIL_DIR}" if rel_path else MAIL_DIR
    local_messages = read_mail_folder(mail_dir, mail_rel)

    merged = sorted(global_messages + local_messages, key=lambda m: m["id"])

    return {
        "id": account_id,
        "name": name or make_title(os.path.basename(dir_path)),
        "email": email or "",
        "avatar": find_cover_image(dir_path, rel_path),
        "messages": merged,
    }


def scan_mail_accounts(root):
    """Walks the whole content tree looking for account.cfg files — a folder can
    hold a normal content.txt document AND be a mailbox at the same time. A
    _mail/ folder directly under content/ (not tied to any single account) is
    global: its messages are merged into every mailbox found."""
    global_mail_dir = os.path.join(root, MAIL_DIR)
    global_messages = read_mail_folder(global_mail_dir, MAIL_DIR)

    accounts = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in sorted(dirnames) if not d.startswith(".")]
        if dirpath == root:
            # don't descend into content/_mail/ as if it were a regular folder
            dirnames[:] = [d for d in dirnames if d != MAIL_DIR]
        if ACCOUNT_CFG in filenames:
            rel_path = os.path.relpath(dirpath, root)
            rel_path = "" if rel_path == "." else rel_path.replace(os.sep, "/")
            accounts.append(build_mail_account(dirpath, rel_path, global_messages))
    return accounts


def main():
    if not os.path.isdir(ROOT):
        os.makedirs(ROOT, exist_ok=True)
        print(f"Created empty '{ROOT}/' directory — add folders with content.txt files.")

    tree = build_tree(ROOT)

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(tree, f, indent=2, ensure_ascii=False)
    print(f"Wrote {OUTPUT}")

    accounts = scan_mail_accounts(ROOT)
    os.makedirs(os.path.dirname(OUTPUT_MAIL), exist_ok=True)
    with open(OUTPUT_MAIL, "w", encoding="utf-8") as f:
        json.dump({"accounts": accounts}, f, indent=2, ensure_ascii=False)
    print(f"Wrote {OUTPUT_MAIL} ({len(accounts)} account{'s' if len(accounts) != 1 else ''})")


if __name__ == "__main__":
    main()
