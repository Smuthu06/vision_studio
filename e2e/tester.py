"""End-to-end: tester configuration against the real exe in web mode.

Bench layout (see README): <bench>/tools/vision_studio/<exe + ini>, <bench>/configurations/
project_configuration/{sample_v1.0.0.json (EMCfeature on), noemc_v1.0.0.json}, <bench>/fpga_bitfile/*.lvbitx,
<bench>/datalogger_configuration/*.json.

Usage: python e2e/tester.py http://127.0.0.1:8766/ /path/to/bench
"""
import json, os, sys
from playwright.sync_api import sync_playwright

URL, BENCH = sys.argv[1], sys.argv[2]
OUT = os.environ.get("SHOTS", "/tmp/e")
TESTER_DIR = f"{BENCH}/configurations/tester_configuration"
errors = []

def field(page, label):
    return page.locator(".form-row", has=page.locator(".form-label", has_text=label)).first.locator("input, select").first

def chosen(sel):
    return sel.evaluate("e => e.options[e.selectedIndex].text")

def has_field(page, label):
    return page.locator(".form-label", has_text=label).count() > 0

def file_menu(page, top, sub):
    page.click("#file-menu-btn")
    page.locator(".menu-item", has_text=top).first.hover()
    page.locator(".menu .menu-label").get_by_text(sub, exact=True).click()

def node_menu(page, row_text, item):
    page.locator(".tree-row", has_text=row_text).first.click(button="right")
    page.locator(".menu-item", has_text=item).click()
    page.wait_for_timeout(250)

def options(sel):
    return [o.strip() for o in sel.locator("option").all_inner_texts()]

def new_tester(page, project):
    file_menu(page, "New", "Tester")
    page.wait_for_selector(".pick-project")
    if page.locator(".modal h3", has_text="Unsaved changes").count():
        page.locator(".modal .btn", has_text="Don't save").click()
    page.select_option("#pick-project", project)  # plain <select>: values are the file names
    page.locator(".pick-project .btn-primary").click()
    page.wait_for_selector(".tree-row:has-text('New_Tester')")
    page.wait_for_timeout(400)  # project + folder lists load

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.add_init_script("localStorage.clear()")
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector(".tree-row")

    # Cancel ends the request: still the new project
    file_menu(page, "New", "Tester")
    page.wait_for_selector(".pick-project")
    assert sorted(options(page.locator("#pick-project"))) == ["noemc_v1.0.0.json", "sample_v1.0.0.json"]
    page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/tester_pick.png")
    page.locator(".pick-project .btn", has_text="Cancel").click()
    assert page.locator(".pick-project").count() == 0
    assert page.locator(".tree-row").first.inner_text().strip() == "New_Project"

    new_tester(page, "sample_v1.0.0.json")
    assert chosen(field(page, "Project Configuration")) == "sample_v1.0.0.json"
    field(page, "Tester Name").fill("HIL_Bench")
    field(page, "Author").fill("engineer")
    field(page, "Email Address").fill("engineer@company.com")
    page.keyboard.press("Tab")

    # right-click tester → Add Mode; modes come from the project, Multiple Display because of EMCfeature
    node_menu(page, "HIL_Bench", "Add Mode")
    page.locator(".tree-row", has_text="CaptureMode").click()
    assert options(field(page, "Mode")) == ["CaptureMode", "PassthroughMode"], options(field(page, "Mode"))
    assert has_field(page, "Multiple Display")
    page.locator(".form-row", has=page.locator(".form-label", has_text="Multiple Display")).locator(".switch").click()

    # right-click mode → Add Camera Model
    node_menu(page, "CaptureMode", "Add Camera Model")
    page.locator(".tree-row", has_text="ADAS_Camera_Model_A").click()
    assert options(field(page, "Camera Model")) == ["ADAS_Camera_Model_A"]
    assert chosen(field(page, "Device Manufacturer")) == "NationalInstruments"
    assert options(field(page, "Device Model")) == ["NI1487"]
    assert "PXIe-1487 – Kintex UltraScale KU11P" in options(field(page, "FPGA Device"))
    bits = options(field(page, "Bit File"))
    assert sorted(b for b in bits if b.endswith(".lvbitx")) == sorted(os.listdir(f"{BENCH}/fpga_bitfile")), bits
    assert "front_logger.json" in options(field(page, "Datalogger Configuration"))
    field(page, "Camera Model Name").fill("Front_Left")
    field(page, "FPGA Device").select_option(label="PXIe-1487 – Kintex UltraScale KU11P")
    field(page, "Device Resources").fill("RIO0")
    field(page, "Bit File").select_option(label="FPGA_8IN_NI1486_capture_v10.0.0.lvbitx")
    field(page, "Datalogger Configuration").select_option(label="front_logger.json")
    page.keyboard.press("Tab")
    assert page.locator(".tree-row", has_text="Front_Left").count() == 1, "custom name is shown in the tree"

    # channels SI0–SI7 / SO0–SO7
    add = page.locator(".btn", has_text="Add Channel").first
    add.click(); add.click()
    sel0 = page.locator("#c-channels-0-channel")
    chans = options(sel0)
    assert chans[:16] == [f"SI{i}" for i in range(8)] + [f"SO{i}" for i in range(8)], chans
    page.fill("#c-channels-0-name", "Front")
    page.select_option("#c-channels-1-channel", label="SO1")
    page.fill("#c-channels-1-name", "ECU")
    page.keyboard.press("Tab")

    # wrong bit file for the device → warning after Validate
    page.keyboard.press("F5")
    page.wait_for_timeout(300)
    probs = page.locator(".bottom").inner_text() if page.locator(".bottom").count() else page.content()
    assert "built for NI1486, not for PXIe-1487" in probs, probs[:2000]
    field(page, "Bit File").select_option(label="FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx")
    page.keyboard.press("Tab")
    page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/tester_camera.png")

    # Save: <tester>_v<version>.json in the tester folder, no name prompt
    page.keyboard.press("Control+s")
    page.wait_for_timeout(400)
    if page.locator(".modal h3", has_text="Configuration has errors").count():
        page.screenshot(path=f"{OUT}/tester_errors.png")
        raise SystemExit("unexpected validation errors: " + page.locator(".bottom").inner_text())
    page.wait_for_selector(".toast-success")
    assert os.listdir(TESTER_DIR) == ["HIL_Bench_v1.0.0.json"], os.listdir(TESTER_DIR)
    data = json.load(open(f"{TESTER_DIR}/HIL_Bench_v1.0.0.json"))
    t = data["tester"]
    assert t["project"] == "sample_v1.0.0.json" and t["testerName"] == "HIL_Bench"
    m = t["modes"][0]
    assert m["mode"] == "CaptureMode" and m["multipleDisplay"] is True
    cam = m["cameraModels"][0]
    assert cam == {
        "cameraModel": "ADAS_Camera_Model_A", "name": "Front_Left", "deviceManufacturer": "NationalInstruments", "deviceModel": "NI1487",
        "fpgaDevice": "PXIe-1487", "deviceResources": "RIO0", "bitFile": "FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx",
        "dataloggerConfiguration": "front_logger.json", "fpgaBoardDefaults": "Default",
        "channels": [{"channel": "SI0", "name": "Front"}, {"channel": "SO1", "name": "ECU"}],
    }, cam

    # Open › Tester lists the tester folder
    file_menu(page, "Open", "Tester…")
    page.wait_for_selector(".open-dialog")
    assert page.locator(".open-dialog h3").inner_text() == "Open tester configuration"
    assert page.locator(".open-name").all_inner_texts() == ["HIL_Bench_v1.0.0.json"]
    page.locator(".open-row").first.dblclick()
    page.wait_for_selector(".tree-row:has-text('Front_Left')")

    # a project without EMCfeature: no Multiple Display
    new_tester(page, "noemc_v1.0.0.json")
    node_menu(page, "New_Tester", "Add Mode")
    page.locator(".tree-row", has_text="CaptureMode").click()
    assert not has_field(page, "Multiple Display")
    page.screenshot(path=f"{OUT}/tester_noemc.png")
    b.close()

print("tester e2e ok; console errors:", errors)
sys.exit(1 if errors else 0)
