"""End-to-end: tester configuration against the real exe in web mode.

Bench layout (see README): <bench>/tools/vision_studio/<exe + ini>, <bench>/configurations/
project_configuration/{sample_v1.0.0.json (EMCfeature on), noemc_v1.0.0.json}, <bench>/fpga_bitfile/*.lvbitx,
<bench>/datalogger_configuration/*.json, <bench>/configurations/i2c_configuration/*.txt.

Usage: python e2e/tester.py http://127.0.0.1:8766/ /path/to/bench
"""
import json, os, re, subprocess, sys
from playwright.sync_api import sync_playwright

URL, BENCH = sys.argv[1], sys.argv[2]
OUT = os.environ.get("SHOTS", "/tmp/e")
TESTER_DIR = f"{BENCH}/configurations/tester_configuration"
errors = []

def lab(label):  # whole label: "Device Mode" must not match "Device Model"
    return re.compile(rf"^\s*{re.escape(label)}(?![A-Za-z])")

def field(page, label):
    return page.locator(".form-row", has=page.locator(".form-label", has_text=lab(label))).first.locator("input, select").first

def chosen(sel):
    return sel.evaluate("e => e.options[e.selectedIndex].text")

def has_field(page, label):
    return page.locator(".form-label", has_text=lab(label)).count() > 0

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
    field(page, "Application Name").fill("HIL_Bench")
    field(page, "Author").fill("engineer")
    field(page, "Email Address").fill("engineer@company.com")
    assert re.match(r"^\d{2}[/-]\d{2}[/-]\d{4}$", field(page, "Date").input_value())
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
    assert [o.split(" – ")[0] for o in options(field(page, "Device Mode"))][:3] == ["8in", "4in/4out", "4in"]
    bits = options(field(page, "Bit File"))
    assert sorted(b for b in bits if b.endswith(".lvbitx")) == sorted(os.listdir(f"{BENCH}/fpga_bitfile")), bits
    assert "front_logger.json" in options(field(page, "Datalogger Configuration"))
    field(page, "Camera Model Name").fill("Front_Left")
    field(page, "Device Resource").fill("PXI1Slot2")
    field(page, "Bit File").select_option(label="FPGA_8IN_NI1486_capture_v10.0.0.lvbitx")
    assert chosen(field(page, "Device Mode")).startswith("8in"), "device mode follows the bit file"
    field(page, "Datalogger Configuration").select_option(label="front_logger.json")
    page.keyboard.press("Tab")
    assert page.locator(".tree-row", has_text="Front_Left").count() == 1, "custom name is shown in the tree"

    # right-click camera › Add Channel: a channel node with its I2C worker
    node_menu(page, "Front_Left", "Add Channel")
    page.wait_for_selector(".tree-row:has-text('I2C Worker')")
    page.locator(".tree-row", has_text="SI0").first.click()
    chans = options(field(page, "Channel"))
    assert chans == [f"SI{i}" for i in range(8)] + [f"SO{i}" for i in range(8)], chans
    assert not has_field(page, "Output Channel"), "output only in PassthroughMode"
    field(page, "Channel Name").fill("Front")
    assert options(field(page, "PoC Mode")) == ["Internal", "Auxiliary", "None"]
    assert options(field(page, "Streaming Mode")) == ["Single", "Continuous"]
    field(page, "Streaming Mode").select_option(label="Continuous")
    assert "front_init.txt" in options(field(page, "I2C Commands File"))
    field(page, "I2C Commands File").select_option(label="front_init.txt")
    page.keyboard.press("Tab")
    assert page.locator(".tree-row", has_text="SI0 – Front").count() == 1

    # I2C worker: mode + pause time
    page.locator(".tree-row", has_text="I2C Worker").first.click()
    assert options(field(page, "I2C Worker Mode")) == ["Monitoring", "Monitoring & Checking"]
    field(page, "I2C Worker Mode").select_option(label="Monitoring & Checking")
    field(page, "Pause Time").fill("250")
    page.keyboard.press("Tab")

    # right-click channel › Add Virtual Channel: VC from the project, with its frame analysis worker
    node_menu(page, "SI0 – Front", "Add Virtual Channel")
    page.wait_for_selector(".tree-row:has-text('Frame Analysis Worker')")
    page.locator(".tree-row", has_text="VC0").first.click()
    assert options(field(page, "Virtual Channel")) == ["0 – Front"], options(field(page, "Virtual Channel"))
    deb = options(field(page, "Debayer Configuration"))
    assert "YUV422_YUYV_to_RGB – 1920×1080 YUV 422_YUYV → RGB BGRA" in deb, deb
    field(page, "Debayer Configuration").select_option(label="YUV422_YUYV_to_RGB – 1920×1080 YUV 422_YUYV → RGB BGRA")
    field(page, "Name").fill("Image")
    page.keyboard.press("Tab")
    page.screenshot(path=f"{OUT}/tester_vc.png")

    # PassthroughMode: channel pairs with an output card
    node_menu(page, "HIL_Bench", "Add Mode")
    node_menu(page, "PassthroughMode", "Add Camera Model")
    page.locator(".tree-row", has_text="PassthroughMode").first.click()
    rows = page.locator(".tree-row", has_text="ADAS_Camera_Model_A")
    rows.last.click(button="right")
    page.locator(".menu-item", has_text="Add Channel Pair").click()
    page.wait_for_timeout(250)
    page.locator(".tree-row", has_text="SI0").last.click()
    assert options(field(page, "Output Channel")) == [f"SO{i}" for i in range(8)]
    field(page, "Channel Name").fill("CH0_In")
    field(page, "Output Channel Name").fill("CH0_Out")
    assert options(field(page, "SO CSI Data Lanes")) == ["2 Lane", "4 Lane"]
    page.locator(".form-row", has=page.locator(".form-label", has_text="Cybersecurity")).locator(".switch").click()
    page.keyboard.press("F5")
    page.wait_for_timeout(300)
    assert "LV Class is required when cybersecurity is enabled" in page.locator(".bottom").inner_text()
    page.locator(".tree-row", has_text="SI0 – CH0_In").first.click()
    field(page, "LV Class").fill("X3F(OVT)")
    page.keyboard.press("Tab")
    page.screenshot(path=f"{OUT}/tester_passthrough.png")
    rows.last.click()
    field(page, "Device Resource").fill("PXI1Slot8")
    field(page, "Bit File").select_option(label="FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx")
    page.keyboard.press("Tab")

    # wrong bit file for the device → warnings after Validate; then the matching one
    page.locator(".tree-row", has_text="Front_Left").first.click()
    probs = page.locator(".bottom").inner_text()
    assert "built for NI1486, not for NI1487" in probs, probs[:2000]
    field(page, "Bit File").select_option(label="FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx")
    assert chosen(field(page, "Device Mode")).startswith("4in/4out")
    page.keyboard.press("Tab")
    page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/tester_camera.png")

    # Save: <application>_v<version>.json in the tester folder, no name prompt
    page.keyboard.press("Control+s")
    page.wait_for_timeout(400)
    if page.locator(".modal h3", has_text="Configuration has errors").count():
        page.screenshot(path=f"{OUT}/tester_errors.png")
        raise SystemExit("unexpected validation errors: " + page.locator(".bottom").inner_text())
    page.wait_for_selector(".toast-success")
    assert os.listdir(TESTER_DIR) == ["HIL_Bench_v1.0.0.json"], os.listdir(TESTER_DIR)
    saved = f"{TESTER_DIR}/HIL_Bench_v1.0.0.json"
    t = json.load(open(saved))["cameraTester"]
    assert t["applicationName"] == t["serviceName"] == "HIL_Bench" and t["project"] == {"name": "sample", "version": "V.1.0.0"}
    m = t["testModes"][0]
    assert m["mode"] == "CaptureMode" and m["multiple_display"] is True and m["features"] == ["DataLogger", "EMCFeatures"], m
    cam = m["cameraModels"][0]
    bitdir = os.path.realpath(f"{BENCH}/fpga_bitfile")
    assert cam["fpgaBitFile"] == f"{bitdir}/FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx", cam["fpgaBitFile"]
    assert cam["deviceMode"] == "4in/4out" and cam["deviceResource"] == "PXI1Slot2" and cam["fpgaDefaults"]["Frames_on_DMA_Buffer"] == 20
    ch = cam["channelConfiguration"][0]
    assert ch["streamingMode"] == "Continuous" and ch["i2cCommands"].endswith("/configurations/i2c_configuration/front_init.txt")
    assert ch["i2cWorker"]["i2cWorkerMode"] == "Monitoring & Checking" and ch["i2cWorker"]["pauseTime"] == 250
    vc = ch["vcConfiguration"][0]
    assert vc["virtualChannel"] == "VC0" and vc["cameraDebayer"] == "YUV422_YUYV_to_RGB" and vc["frameAnalysisWorker"] == ["Frame Verification"]
    pt = t["testModes"][1]["cameraModels"][0]
    assert pt["channelInfo"] == [{"inputChannel": "SI0", "outputChannel": "SO0", "name": "CH0_In"}], pt["channelInfo"]
    assert pt["channelConfiguration"][0]["cybersecurity"] == {"enable": True, "lvClass": "X3F(OVT)"}

    # the user's validator accepts the file
    here = os.path.dirname(os.path.abspath(__file__))
    r = subprocess.run([sys.executable, os.path.join(here, "../tools/validate_tester_configuration.py"), saved,
                        "--schema", os.path.join(here, "../tools/tester_configuration.schema.json")], capture_output=True, text=True)
    print(r.stdout.strip().splitlines()[-1])
    assert r.returncode == 0, r.stdout + r.stderr

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
