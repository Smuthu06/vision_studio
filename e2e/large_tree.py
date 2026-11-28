"""End-to-end: the virtualized tree on a large tester (≈1300 rows; written by `perf/perf.ts --write`).

Only the rows in view are in the DOM, so this checks that keyboard navigation, jumping to a
problem, right-click menus and collapsing still reach every row.

Usage: python e2e/large_tree.py http://127.0.0.1:18794/
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1]
errors = []

def in_view(page, rid):
    return page.evaluate("""id => { const t = document.querySelector('.tree'), r = document.querySelector(`.tree-row[data-id="${id}"]`);
      if (!r) return false; const a = t.getBoundingClientRect(), b = r.getBoundingClientRect();
      return b.top >= a.top - 1 && b.bottom <= a.bottom + 1; }""", rid)

def selected(page):
    return page.locator(".tree-row.selected")

def settle(page):
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL); page.wait_for_selector(".tree-row")
    page.click("#file-menu-btn")
    page.locator(".menu-item", has_text="Open").first.hover()
    page.locator(".menu .menu-label").get_by_text("Tester…", exact=True).click()
    page.wait_for_selector(".open-dialog")
    page.locator(".open-row", has_text="PERF_BENCH").first.dblclick()
    page.wait_for_function("() => +document.querySelector('.tree')?.dataset.rows > 1000", timeout=30000)
    total = int(page.locator(".tree").get_attribute("data-rows"))
    in_dom = page.locator(".tree-row").count()
    assert in_dom < 80, f"virtualized: {in_dom} rows in the DOM for {total}"

    # keyboard: End → last row selected and scrolled into view; Home back to the tester
    page.locator(".tree-row").first.click()
    page.locator(".tree").press("End"); settle(page)
    rid = selected(page).get_attribute("data-id")
    assert rid and in_view(page, rid), "End shows the last row"
    assert "Frame Analysis Worker" in selected(page).inner_text()
    page.locator(".tree").press("PageUp"); settle(page)
    assert in_view(page, selected(page).get_attribute("data-id"))
    for _ in range(5): page.locator(".tree").press("ArrowUp")
    settle(page); assert in_view(page, selected(page).get_attribute("data-id"))
    page.locator(".tree").press("Home"); settle(page)
    assert "PERF_BENCH" in selected(page).inner_text() and page.locator(".tree").evaluate("t => t.scrollTop") == 0

    # the editor follows the selection deep in the tree
    page.locator(".tree").press("End"); settle(page)
    page.wait_for_timeout(200)
    assert "Frame Verification" in page.locator(".editor-scroll").inner_text()

    # Problems: jump to an issue on a node far down → selected and in view
    page.click("button:has-text('Validate')")   # opens the Problems panel
    page.wait_for_timeout(300)
    if not page.locator(".problem").count(): page.locator("button", has_text="Problems").first.click()
    page.wait_for_selector(".problem")
    probs = page.locator(".problem")
    assert probs.count() > 10, probs.count()
    page.locator(".tree").press("Home"); settle(page)
    probs.nth(probs.count() - 1).click(); page.wait_for_timeout(300)
    rid = selected(page).get_attribute("data-id")
    assert rid and in_view(page, rid), "the problem's node is shown"

    # right-click a row in the middle → its menu
    page.locator(".tree").evaluate("t => t.scrollTop = 300 * 27"); settle(page)
    row = page.locator(".tree-row", has_text="SI5").first
    row.click(button="right")
    page.wait_for_selector(".menu")
    assert page.locator(".menu-item", has_text="Add Virtual Channel").count() == 1
    page.keyboard.press("Escape")

    # collapse the first mode: rows drop, tree stays usable
    page.locator(".tree").evaluate("t => t.scrollTop = 0"); settle(page)
    page.locator(".tree-row", has_text="CaptureMode").first.locator(".twisty").dispatch_event("mousedown")
    settle(page)
    after = int(page.locator(".tree").get_attribute("data-rows"))
    assert after < total / 2 + 5, (total, after)

    # typing in a field still updates the tree label
    page.locator(".tree-row", has_text="PassthroughMode").first.click()
    page.locator(".tree").press("ArrowDown"); settle(page)
    cam = selected(page)
    name = page.locator(".form-row", has=page.locator(".form-label", has_text="Camera Model Name")).first.locator("input").first
    name.fill("Renamed_Cam"); settle(page)
    assert "Renamed_Cam" in selected(page).inner_text(), selected(page).inner_text()
    b.close()

print("rows:", total, "in DOM:", in_dom)
print("console errors:", errors)
assert not errors
print("large tree e2e ok")
