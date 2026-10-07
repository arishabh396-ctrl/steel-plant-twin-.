"""Build a standalone website folder (site/) from the dashboard page.

The dashboard page is written without <html>/<head>/<body>; this wraps it in a
full document so it can be hosted anywhere (Cloudflare Pages, Netlify, your own server).
Run: python3 interior-studio/build_site.py
"""
import pathlib, shutil

here = pathlib.Path(__file__).parent
out = here / "site"
out.mkdir(exist_ok=True)

page = (here / "studio-ledger.html").read_text(encoding="utf-8")
icon = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
        "%3Crect width='32' height='32' rx='6' fill='%231B2420'/%3E"
        "%3Cpath d='M9 23V9h8a5 5 0 0 1 0 10h-8' fill='none' stroke='%23D9AE57' stroke-width='3'/%3E%3C/svg%3E")
head = f"""<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="{icon}">
<style>:root {{ color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }}
body {{ margin: 0; }} img {{ max-width: 100%; }} [hidden] {{ display: none !important; }}</style>
"""
# The page starts with <title>, <meta>, <link> and <style>, which belong in <head>.
split = page.index('<div class="wrap">')
doc = head + page[:split] + "</head>\n<body>\n" + page[split:] + "\n</body>\n</html>\n"
(out / "index.html").write_text(doc, encoding="utf-8")
shutil.copy(here / "engine.js", out / "engine.js")
(out / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
print("Built", out)
