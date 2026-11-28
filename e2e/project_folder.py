"""End-to-end against the real exe in web mode: Save writes <project>_v<version>.json into
[app] project_dir without asking for a name; File > Open lists that folder.

Usage: python e2e/project_folder.py http://127.0.0.1:8765/ /path/to/project_configuration
"""
import os, sys
from playwright.sync_api import sync_playwright

URL, DIR = sys.argv[1], sys.argv[2]
OUT = os.environ.get("SHOTS", "/tmp/e")
errors = []

def field(page, label):
    return page.locator(".form-row", has=page.locator(".form-label", has_text=label)).first.locator("input, select").first

def save(page, expect_modal=None):
    page.keyboard.press("Escape")
    page.keyboard.press("Control+s")
    page.wait_for_timeout(300)
    if page.locator(".modal h3", has_text="Configuration has errors").count():
        page.locator(".modal .btn", has_text="Save anyway").click()
        page.wait_for_timeout(300)
    if expect_modal:
        page.wait_for_selector(f".modal h3:has-text('{expect_modal}')")

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.add_init_script("localStorage.clear()")
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("response", lambda r: r.status >= 400 and print("HTTP", r.status, r.request.method, r.url))
    page.goto(URL)
    page.wait_for_selector(".tree-row")
    page.wait_for_selector(".status-path")
    assert DIR in page.locator(".status-path").inner_text(), page.locator(".statusbar").inner_text()
    field(page, "Project Name").fill("sample")
    page.keyboard.press("Tab")
    assert page.locator(".file-chip").inner_text().strip() == "sample_v1.0.0.json"
    save(page)
    page.wait_for_selector(".toast-success")
    assert os.listdir(DIR) == ["sample_v1.0.0.json"], os.listdir(DIR)
    m1 = os.path.getmtime(f"{DIR}/sample_v1.0.0.json")

    # saving the open file again replaces it without a question
    field(page, "Author").fill("engineer")
    page.wait_for_timeout(1100)
    save(page)
    page.wait_for_timeout(500)
    assert page.locator(".modal").count() == 0
    assert os.path.getmtime(f"{DIR}/sample_v1.0.0.json") > m1
    assert '"author": "engineer"' in open(f"{DIR}/sample_v1.0.0.json").read()

    # a new version is a new file; the chip shows old → new first
    field(page, "Version").fill("V.1.0.1")
    page.keyboard.press("Tab")
    chip = page.locator(".file-chip").inner_text()
    assert "sample_v1.0.0.json" in chip and "sample_v1.0.1.json" in chip, chip
    page.screenshot(path=f"{OUT}/pf_renamed_chip.png")
    save(page)
    page.wait_for_timeout(500)
    assert sorted(os.listdir(DIR)) == ["sample_v1.0.0.json", "sample_v1.0.1.json"], os.listdir(DIR)

    # a different document with the same project + version must ask before replacing
    page.click("#file-menu-btn"); page.locator(".menu-item", has_text="New").first.hover()
    page.locator(".menu .menu-label").get_by_text("Project", exact=True).click()
    field(page, "Project Name").fill("sample")
    page.keyboard.press("Tab")
    save(page, expect_modal="Replace sample_v1.0.0.json?")
    page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/pf_replace.png")
    page.locator(".modal .btn", has_text="Cancel").click()
    assert '"author": "engineer"' in open(f"{DIR}/sample_v1.0.0.json").read(), "cancel must keep the file"

    # File > Open lists the folder
    page.keyboard.press("Control+o")
    if page.locator(".modal h3", has_text="Unsaved changes").count():
        page.locator(".modal .btn", has_text="Don't save").click()
    page.wait_for_selector(".open-dialog")
    names = page.locator(".open-name").all_inner_texts()
    assert sorted(names) == ["sample_v1.0.0.json", "sample_v1.0.1.json"], names
    assert DIR in page.locator(".open-dir").inner_text()
    page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/pf_open.png")
    page.locator(".open-row", has_text="sample_v1.0.0.json").dblclick()
    page.wait_for_selector(".toast:has-text('Opened sample_v1.0.0.json')")
    assert field(page, "Author").input_value() == "engineer"
    assert field(page, "Version").input_value() == "V.1.0.0"
    assert page.locator(".file-chip").inner_text().strip() == "sample_v1.0.0.json"
    b.close()

print("console errors:", errors)
sys.exit(1 if errors else 0)
