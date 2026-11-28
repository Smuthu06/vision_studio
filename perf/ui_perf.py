"""Browser benchmark against the real binary in web mode (Chromium + CDP metrics).

Opens the large tester written by `perf/perf.ts --write <bench>` (≈650 nodes), then measures:
open time, typing in a field (per keystroke, with and without the JSON preview open), selecting
nodes, JS heap, DOM node count and CPU while idle.

Usage: python perf/ui_perf.py http://127.0.0.1:18800/ [--json out.json]
"""
import json, statistics, sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1]
OUT = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
res = {}

def metrics(cdp):
    return {m["name"]: m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}

def file_menu(page, top, sub):
    page.click("#file-menu-btn")
    page.locator(".menu-item", has_text=top).first.hover()
    page.locator(".menu .menu-label").get_by_text(sub, exact=True).click()

def field(page, label):
    return page.locator(".form-row", has=page.locator(".form-label", has_text=label)).first.locator("input, select").first

def type_cost(page, cdp, inp, text):
    """ms of main-thread work per keystroke, and wall ms per keystroke until the UI settled."""
    inp.click(); inp.press("End")
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    m0 = metrics(cdp); t0 = time.perf_counter()
    for ch in text:
        inp.press(ch if ch != " " else "Space")
        page.evaluate("() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))")  # wait for the commit
    wall = (time.perf_counter() - t0) * 1000 / len(text)
    m1 = metrics(cdp)
    return round((m1["TaskDuration"] - m0["TaskDuration"]) * 1000 / len(text), 2), round(wall, 2)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--enable-precise-memory-info", "--js-flags=--expose-gc"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    cdp = page.context.new_cdp_session(page)
    cdp.send("Performance.enable")
    page.goto(URL); page.wait_for_selector(".tree-row")

    # open the big tester
    t0 = time.perf_counter()
    file_menu(page, "Open", "Tester…")
    page.wait_for_selector(".open-dialog")
    page.locator(".open-row", has_text="PERF_BENCH").first.dblclick()
    page.wait_for_selector(".tree-row:has-text('PERF_BENCH')")
    page.wait_for_function("() => +(document.querySelector('.tree')?.dataset.rows ?? document.querySelectorAll('.tree-row').length) > 100", timeout=60000)
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    res["open ms"] = round((time.perf_counter() - t0) * 1000)
    res["tree rows"] = int(page.locator(".tree").get_attribute("data-rows") or page.locator(".tree-row").count())
    res["tree rows in DOM"] = page.locator(".tree-row").count()

    # select nodes all over the tree (scroll there, click the first row in view)
    rows = page.locator(".tree-row")
    sel = []
    for i in [5, 40, 120, 300, 500]:
        rid = page.evaluate("""i => { const t = document.querySelector('.tree'); t.scrollTop = i * 27;
          return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
            const top = t.getBoundingClientRect().top;
            const row = [...t.querySelectorAll('.tree-row')].find(e => e.getBoundingClientRect().top >= top);
            r(row.dataset.id); }))); }""", i)
        t = time.perf_counter(); page.locator(f'.tree-row[data-id="{rid}"]').click()
        page.evaluate("() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))")
        sel.append((time.perf_counter() - t) * 1000)
    res["select node ms"] = round(statistics.median(sel), 1)

    # type in the tester's Application Name (the root: label changes in the tree + file name)
    page.locator(".tree").evaluate("t => t.scrollTop = 0"); page.wait_for_timeout(100)
    rows.first.click()
    res["type (root) task ms/key"], res["type (root) wall ms/key"] = type_cost(page, cdp, field(page, "Application Name"), "abcdefghijklmnop")
    # type in a channel name deep in the tree
    page.locator(".tree").evaluate("t => t.scrollTop = 200 * 27"); page.wait_for_timeout(150)
    page.locator(".tree-row", has_text="SI3").first.click()
    res["type (channel) task ms/key"], res["type (channel) wall ms/key"] = type_cost(page, cdp, field(page, "Channel Name"), "abcdefghijklmnop")
    # with the JSON preview of the whole document open
    page.locator("button", has_text="JSON Preview").first.click()
    page.wait_for_timeout(300)
    scope = page.locator("button", has_text="Whole document")
    if scope.count(): scope.first.click(); page.wait_for_timeout(300)
    res["type (json preview open) task ms/key"], res["type (json preview open) wall ms/key"] = type_cost(page, cdp, field(page, "Channel Name"), "abcdefghij")
    page.locator("button", has_text="JSON Preview").first.click()

    # memory + DOM after a settle
    page.wait_for_timeout(1500)
    page.evaluate("() => window.gc && window.gc()")
    m = metrics(cdp)
    res["JS heap MB"] = round(m["JSHeapUsedSize"] / 1048576, 1)
    res["DOM nodes"] = int(m["Nodes"])
    res["listeners"] = int(m["JSEventListeners"])
    # idle CPU: main-thread busy time during 5 s of nothing
    m0 = metrics(cdp); page.wait_for_timeout(5000); m1 = metrics(cdp)
    res["idle busy ms / 5 s"] = round((m1["TaskDuration"] - m0["TaskDuration"]) * 1000, 1)
    res["page errors"] = len(errors)
    b.close()

print(json.dumps(res, indent=2))
if OUT: json.dump(res, open(OUT, "w"), indent=2)
