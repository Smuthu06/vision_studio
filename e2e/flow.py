"""End-to-end: build a configuration step by step from an empty project, then save it."""
import json, sys, os
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/shots"
os.makedirs(OUT, exist_ok=True)
errors = []

def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png")

def row(page, label):
    return page.locator(".tree-row", has=page.locator(".tree-label", has_text=label)).first

def ctx_add(page, node_label, item):
    row(page, node_label).click(button="right")
    page.locator(".menu-item", has_text=item).first.click()

def field(page, label):
    return page.locator(".form-row", has=page.locator(".form-label", has_text=label)).first.locator("input, select").first

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    page.add_init_script("delete window.showSaveFilePicker; delete window.showOpenFilePicker; localStorage.clear()")
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector(".tree-row")
    assert page.locator(".tree-row").count() == 1, "new window must only contain the project"
    # gentle validation: a fresh project is not shown in red
    assert page.locator(".banner, .banner-mini, .tree-count, .inp.has-error").count() == 0
    shot(page, "01_new_project")

    field(page, "Author").fill("engineer_user")
    field(page, "Email Address").fill("engineer@company")
    shot(page, "02_inline_validation")
    field(page, "Email Address").fill("engineer@company.com")
    field(page, "Project Name").fill("ADAS_Front_Camera")

    row(page, "ADAS_Front_Camera").click(button="right")
    page.wait_for_selector(".menu")
    shot(page, "03_context_menu")
    page.locator(".menu-item", has_text="Add Project Modes").click()
    ctx_add(page, "Project Modes", "Add CaptureMode")
    # no add/delete buttons in the toolbar – only the node's right-click menu
    assert page.locator(".toolbar", has_text="Add Node").count() == 0
    assert page.locator('.toolbar [aria-label="Delete"]').count() == 0
    # right-clicking a leaf (CaptureMode) also offers its parent's additions
    ctx_add(page, "CaptureMode", "Add PassthroughMode")
    page.locator(".chip", has_text="FaultInjection").click()

    ctx_add(page, "ADAS_Front_Camera", "Add Camera Models")
    ctx_add(page, "Camera Models", "Add Camera Model")
    field(page, "Model").fill("ADAS_Camera_Model_A")
    field(page, "Imager").fill("SENSOR_MODEL_X")
    field(page, "Serializer IC").fill("SER_IC_PART_A")
    field(page, "Imager I2C Address").fill("0x34")
    field(page, "Imager I2C Address").focus()
    fc = page.locator(".focus-card")
    assert "Imager I2C Address" in fc.inner_text() and "52" in fc.inner_text(), fc.inner_text()
    assert "project.cameraModels[0].imagerAddress" in fc.inner_text()
    shot(page, "04_camera_details")

    # build-guide step opens the right node's context menu
    page.locator(".step", has_text="Hardware").click()
    page.wait_for_selector(".menu")
    page.locator(".menu-item", has_text="Add Hardware").click()
    ctx_add(page, "Hardware", "Add Capture Hardware")
    field(page, "Deserializer IC").fill("DES_IC_PART_B")
    ctx_add(page, "Hardware", "Add Passthrough Hardware")
    field(page, "Deserializer IC").fill("DES_IC_PART_B")
    page.locator("button", has_text="Auto 1:1").click()
    shot(page, "05_gpio_routing")

    ctx_add(page, "ADAS_Camera_Model_A", "Add Frame Information")
    ctx_add(page, "Frame Information", "Add Virtual Channel")
    # edit a cell with an invalid value, check highlight, then fix
    w = page.locator("#c-frameOutput-0-xSize")
    w.fill("0")
    assert "has-error" in w.get_attribute("class")
    assert "Width" in page.locator(".focus-card").inner_text()
    assert "must be between 1 and 16384" in page.locator(".focus-card").inner_text()
    shot(page, "06a_cell_details")
    w.fill("1824")
    page.locator("#c-frameOutput-0-ySize").fill("1536")
    page.locator(".table-card", has_text="Frame Outputs").locator(".btn-primary", has_text="Add Output").click()
    page.locator(".table-card", has_text="Embedded Lines").first.locator(".btn-primary", has_text="Add Line").click()
    page.locator(".table-card", has_text="Fields").last.locator(".btn-primary", has_text="Add Field").click()
    page.locator('[id$="-0-name"]').last.fill("Frame Counter")
    shot(page, "06_virtual_channel")

    ctx_add(page, "ADAS_Camera_Model_A", "Add Fault Injection")
    page.locator(".btn-primary", has_text="Add Fault").click()
    # wide table: secondary settings live in the row drawer
    assert page.locator(".row-drawer #c-embeddedLine-0-crcAlgorithm").count() == 1
    page.locator(".tab", has_text="I2C Injection").click()
    page.locator(".btn-primary", has_text="Add Fault").click()
    shot(page, "07_fault_injection")

    # keyboard: Shift+F10 on the tree opens the node menu, Delete removes via the menu
    row(page, "I2C Monitoring").count() == 0
    page.locator(".tree").focus()
    page.keyboard.press("Shift+F10")
    page.wait_for_selector(".menu")
    shot(page, "07b_node_menu")
    page.keyboard.press("Escape")
    page.keyboard.press("F5")
    page.wait_for_selector(".problems")
    shot(page, "08_validated")
    errs = page.locator(".status-btn").inner_text()
    print("status:", errs.replace("\n", " "))

    # undo / redo
    page.keyboard.press("Control+z"); page.keyboard.press("Control+y")

    with page.expect_download() as dl:
        page.keyboard.press("Control+s")
    path = dl.value.path()
    data = json.load(open(path))
    pr = data["project"]
    assert list(pr)[:5] == ["author", "emailAddress", "version", "date", "project"], list(pr)
    cam = pr["cameraModels"][0]
    assert [list(h)[0] for h in cam["hw"]] == ["CaptureMode", "passthroughMode"]
    assert len(cam["hw"][1]["passthroughMode"]["gpioRouting"]) == 12
    assert cam["imagerAddress"] == 52
    assert cam["frameInformation"][0]["frameOutput"][0]["xSize"] == 1824
    assert pr["projectModes"][1] == {"mode": "PassthroughMode", "features": ["DataLogger", "FaultInjection"]}
    json.dump(data, open(f"{OUT}/built.json", "w"), indent=2)
    print("download:", dl.value.suggested_filename, "keys:", list(cam))

    # light theme + sample project + problem navigation
    page.locator(".theme-seg button", has_text="Light").click()
    page.click("#file-menu-btn")
    page.locator(".menu-item", has_text="Open sample project").click()
    page.locator(".modal .btn", has_text="Don't save").click() if page.locator(".modal").count() else None
    row(page, "VC0 (Front)").click()
    shot(page, "09_light_vc_sample")
    row(page, "I2C Monitoring").click()
    page.locator(".tab", has_text="Temperature Monitor").click()
    shot(page, "10_light_monitoring")
    page.locator(".tab", has_text="JSON Preview").click()
    row(page, "Fault Injection").click()
    shot(page, "11_json_preview")
    b.close()

print("console errors:", errors)
sys.exit(1 if errors else 0)
