"""End-to-end: the Settings window drives the editor's dropdowns."""
import sys, os
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/shots"
SCHEME = sys.argv[3] if len(sys.argv) > 3 else "light"
os.makedirs(OUT, exist_ok=True)
errors = []

def row(page, label):
    return page.locator(".tree-row", has=page.locator(".tree-label", has_text=label)).first

def field(page, label):
    return page.locator(".form-row", has=page.locator(".form-label", has_text=label)).first.locator("input, select").first

def options(sel):
    return [o.strip() for o in sel.locator("option").all_inner_texts()]

def open_settings(page):
    page.click("#file-menu-btn")
    page.locator(".menu-item", has_text="Settings").click()
    page.wait_for_selector(".settings")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, color_scheme=SCHEME)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and "404" not in m.text and errors.append(m.text))
    page.goto(URL); page.evaluate("localStorage.clear()"); page.reload()
    page.wait_for_selector(".tree-row")
    page.click("#file-menu-btn"); page.locator(".menu-item", has_text="Open sample project").click()

    # --- Imagers: add one, rename the one the sample uses, apply, propagate
    open_settings(page)
    page.locator(".settings-tab", has_text="Imagers").click()
    page.locator(".list-add .inp").fill("IMX490"); page.keyboard.press("Enter")
    page.locator('.list-row input[aria-label="Imager"]').first.fill("IMX623")
    assert "was SENSOR_MODEL_X" in page.locator(".settings-main").inner_text()
    page.screenshot(path=f"{OUT}/s1_imagers_{SCHEME}.png")
    page.locator(".settings-foot .btn-primary", has_text="Apply").click()
    page.wait_for_selector(".modal")
    assert "SENSOR_MODEL_X" in page.locator(".modal").inner_text()
    page.locator(".modal .btn-primary", has_text="Update values").click()
    row(page, "ADAS_Camera_Model_A").click()
    imager = field(page, "Imager")
    assert imager.locator("option:checked").inner_text() == "IMX623", imager.locator("option:checked").inner_text()
    assert "IMX490" in options(imager)

    # --- Hardware: Manufacturer → Model → ICs, then cascade in the editor
    open_settings(page)
    page.locator(".settings-tab", has_text="Hardware").click()
    cols = page.locator(".pick-list")
    cols.nth(0).locator(".list-add .inp").fill("Acme"); page.keyboard.press("Enter")
    cols.nth(1).locator(".list-add .inp").fill("AC-1"); page.keyboard.press("Enter")
    ics = page.locator(".hw-ics .list-editor")
    ics.nth(0).locator(".list-add .inp").fill("SER_AC"); page.keyboard.press("Enter")
    ics.nth(1).locator(".list-add .inp").fill("DES_AC"); page.keyboard.press("Enter")
    page.screenshot(path=f"{OUT}/s2_hardware_{SCHEME}.png")
    page.locator(".settings-foot .btn-primary", has_text="Apply").click()
    row(page, "Capture Hardware").click()
    field(page, "Manufacturer").select_option(label="Acme")
    page.wait_for_timeout(200)
    assert field(page, "Board Model").locator("option:checked").inner_text() == "AC-1"
    assert field(page, "Deserializer IC").locator("option:checked").inner_text() == "DES_AC"
    assert options(field(page, "Board Model")) == ["AC-1", "⚙ Edit list in Settings…"], options(field(page, "Board Model"))

    # --- "Edit list in Settings…" opens the right section
    row(page, "ADAS_Camera_Model_A").click()
    field(page, "Imager").select_option(label="⚙ Edit list in Settings…")
    page.wait_for_selector(".settings")
    assert "on" in page.locator(".settings-tab", has_text="Imagers").get_attribute("class")
    # --- Features: remove FaultInjection → the passthrough mode is flagged
    page.locator(".settings-tab", has_text="Mode features").click()
    page.locator(".list-row", has=page.locator('input[value="FaultInjection"]')).locator('button[title^="Remove"]').click()
    page.locator(".settings-foot .btn-primary", has_text="Apply").click()
    row(page, "PassthroughMode").click()
    page.wait_for_timeout(200)
    msg = page.locator(".form-msg.msg-error").first.inner_text()
    assert "Settings › Mode features" in msg, msg
    page.wait_for_timeout(2800)
    page.screenshot(path=f"{OUT}/s3_feature_flagged_{SCHEME}.png")

    # --- persisted across reloads
    page.reload(); page.wait_for_selector(".tree-row")
    page.click("#file-menu-btn"); page.locator(".menu-item", has_text="Open sample project").click()
    row(page, "ADAS_Camera_Model_A").click()
    assert "IMX490" in options(field(page, "Imager"))
    print("settings e2e ok")
    b.close()

print("console errors:", errors)
sys.exit(1 if errors else 0)
