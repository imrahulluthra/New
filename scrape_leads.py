"""Collect public team contacts from VC / family-office websites listed in firms.csv.

Usage:
    python scrape_leads.py                  # all firms
    python scrape_leads.py --region UK      # one region
    python scrape_leads.py --limit 3        # quick test

Writes leads.csv (one row per person) and firms_status.csv (one row per firm).
Re-running skips firms already in firms_status.csv, so it can resume after limits.
Only data published on the firm's own website is kept; phone numbers are never collected.
"""
import argparse
import csv
import os
import re
import time
from datetime import date
from urllib.parse import urljoin, urlparse

from playwright.sync_api import sync_playwright
from pydantic import BaseModel
from scrapegraphai.graphs import SmartScraperGraph

TEAM_WORDS = ("team", "people", "about", "who-we-are", "partners", "our-team", "contact")
LEAD_FIELDS = ["region", "country", "firm", "firm_type", "stage", "website", "name", "role",
               "email", "linkedin", "focus_sectors", "general_email", "source_page", "scraped_on"]
STATUS_FIELDS = ["firm", "region", "status", "people_found", "note"]
GEMINI_PAUSE = 7  # seconds between LLM calls, keeps under the free-tier per-minute limit


class Person(BaseModel):
    name: str
    role: str = ""
    email: str = ""
    linkedin: str = ""


class FirmInfo(BaseModel):
    people: list[Person] = []
    focus_sectors: str = ""
    general_email: str = ""


PROMPT = (
    "This text comes from an investment firm's website. List every investment team member "
    "(partners, principals, associates, founders of the fund) with their role, plus their email "
    "and LinkedIn URL ONLY if they appear in the text. Also give the firm's investment focus "
    "sectors as a short comma-separated list, and the firm's general contact email if shown. "
    "Never invent emails or URLs. Do not include phone numbers."
)


def browser_options():
    opts = {}
    # Claude cloud sessions ship their own Chromium and route traffic through a proxy.
    if os.path.exists("/opt/pw-browsers/chromium"):
        opts["executable_path"] = "/opt/pw-browsers/chromium"
    if os.environ.get("HTTPS_PROXY"):
        opts["proxy"] = {"server": os.environ["HTTPS_PROXY"]}
    return opts


def read_page(page, url):
    """Return (visible text, list of (anchor text, href)) for a URL."""
    page.goto(url, timeout=45000, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    text = page.inner_text("body")
    links = page.eval_on_selector_all(
        "a[href]", "els => els.map(e => [e.innerText.trim(), e.href])")
    return text, links


def team_pages(links, base):
    host = urlparse(base).netloc.removeprefix("www.")
    found = []
    for _, href in links:
        u = urlparse(href)
        if u.netloc.removeprefix("www.") != host:
            continue
        if any(w in u.path.lower() for w in TEAM_WORDS):
            clean = urljoin(href, u.path)
            if clean not in found:
                found.append(clean)
    # Prefer team/people pages over about/contact.
    found.sort(key=lambda h: 0 if re.search(r"team|people|partners", h, re.I) else 1)
    return found[:2]


def page_bundle(text, links):
    contact_links = [f"{t or '(no text)'} -> {h}" for t, h in links
                     if "linkedin.com/in/" in h or h.startswith("mailto:")]
    return text[:30000] + "\n\nLINKS:\n" + "\n".join(dict.fromkeys(contact_links))


def extract(bundle, llm_config):
    graph = SmartScraperGraph(prompt=PROMPT, source=bundle, config={"llm": llm_config},
                              schema=FirmInfo)
    for attempt in range(3):
        try:
            result = graph.run()
            if not isinstance(result, dict) or "error" in result:
                raise RuntimeError(f"bad LLM answer: {str(result)[:100]}")
            return result
        except Exception as e:  # Gemini "high demand" / rate-limit errors are temporary
            if attempt == 2:
                raise
            wait = 30 * (attempt + 1)
            print(f"    LLM error ({str(e)[:80]}), retrying in {wait}s")
            time.sleep(wait)


def verified(value, source):
    """Keep an email/URL only if it really appears on the page (guards against made-up data)."""
    value = (value or "").strip()
    if not value:
        return ""
    v = value.lower().removeprefix("mailto:").rstrip("/")
    return value if v in source.lower() else ""


def load_done(path):
    if not os.path.exists(path):
        return set()
    with open(path, newline="") as f:
        return {row["firm"] for row in csv.DictReader(f)}


def append_row(path, fields, row):
    new = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        if new:
            w.writeheader()
        w.writerow(row)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--firms", default="firms.csv")
    ap.add_argument("--out", default="leads.csv")
    ap.add_argument("--status", default="firms_status.csv")
    ap.add_argument("--region")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    llm_config = {"model": "google_genai/gemini-flash-latest",
                  "api_key": os.environ["GOOGLE_API_KEY"], "temperature": 0}

    with open(args.firms, newline="") as f:
        firms = list(csv.DictReader(f))
    if args.region:
        firms = [x for x in firms if x["region"].lower() == args.region.lower()]
    done = load_done(args.status)
    firms = [x for x in firms if x["firm"] not in done][: args.limit]
    print(f"{len(firms)} firms to process ({len(done)} already done)")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, **browser_options())
        page = browser.new_page()
        for i, firm in enumerate(firms, 1):
            name, site = firm["firm"], firm["website"]
            print(f"[{i}/{len(firms)}] {name} - {site}")
            status = {"firm": name, "region": firm["region"], "people_found": 0, "note": ""}
            try:
                home_text, home_links = read_page(page, site)
                pages = [(site, home_text, home_links)]
                for url in team_pages(home_links, site):
                    try:
                        pages.append((url, *read_page(page, url)))
                    except Exception as e:
                        status["note"] += f"skipped {url}: {str(e)[:60]}; "

                bundle = "\n\n".join(f"PAGE {u}\n{page_bundle(t, l)}" for u, t, l in pages)
                info = extract(bundle, llm_config) or {}
                time.sleep(GEMINI_PAUSE)

                source_page = pages[1][0] if len(pages) > 1 else site
                general = verified(info.get("general_email", ""), bundle)
                people = info.get("people") or []
                for person in people:
                    if not person.get("name") or person["name"].lower() not in bundle.lower():
                        continue
                    append_row(args.out, LEAD_FIELDS, {
                        "region": firm["region"], "country": firm["country"], "firm": name,
                        "firm_type": firm["type"], "stage": firm["stage"], "website": site,
                        "name": person["name"].strip(), "role": person.get("role", "").strip(),
                        "email": verified(person.get("email"), bundle),
                        "linkedin": verified(person.get("linkedin"), bundle),
                        "focus_sectors": info.get("focus_sectors") or firm["sectors_hint"],
                        "general_email": general, "source_page": source_page,
                        "scraped_on": date.today().isoformat(),
                    })
                    status["people_found"] += 1
                if not status["people_found"]:
                    # Still record the firm so its general email and sectors aren't lost.
                    append_row(args.out, LEAD_FIELDS, {
                        "region": firm["region"], "country": firm["country"], "firm": name,
                        "firm_type": firm["type"], "stage": firm["stage"], "website": site,
                        "focus_sectors": info.get("focus_sectors") or firm["sectors_hint"],
                        "general_email": general, "source_page": source_page,
                        "scraped_on": date.today().isoformat(),
                    })
                status["status"] = "ok" if status["people_found"] else "no_people_listed"
            except Exception as e:
                status["status"] = "error"
                status["note"] += str(e).splitlines()[0][:150]
            print(f"    -> {status['status']}, {status['people_found']} people")
            append_row(args.status, STATUS_FIELDS, status)
        browser.close()


if __name__ == "__main__":
    main()
