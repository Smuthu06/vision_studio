"""Settings › FPGA board defaults / Debayer configurations, saved into ui_config.json.

Usage: python e2e/bench_settings.py http://localhost:1421/ /path/to/ui_config.json
(run against a server with the Vision Studio API, e.g. VS_INI=… npm run dev)
"""
import json, os, sys
from playwright.sync_api import sync_playwright

URL, UI_CONFIG = sys.argv[1], sys.argv[2]
OUT = os.environ.get("SHOTS", "/tmp/e")
errors = []

def bf(page, label):
    return page.locator(".bench-field", has=page.locator(".bench-label", has_text=label)).first.locator("input, select").first

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.add_init_script("localStorage.clear()")
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector(".tree-row")
    page.keyboard.press("Control+,")
    page.wait_for_selector(".settings")

    # ---- FPGA board defaults
    page.locator(".settings-tab", has_text="FPGA board defaults").click()
    assert bf(page, "Board Name").input_value() == "board1"
    assert bf(page, "SI Reference Clock Frequency").input_value() == "25000000"
    assert page.locator(".route-row:not(.route-head)").count() == 2
    bf(page, "Board Name").fill("bench_A")
    bf(page, "SI Reference Clock Frequency").fill("2.5E+7")
    bf(page, "Frame Sync Tolerance").fill("700")
    bf(page, "LLP FIFO Depth").fill("abc")
    assert page.locator(".bench-field .row-err", has_text="Enter a number").count() == 1
    assert page.locator(".settings-foot .btn-primary").is_disabled()
    bf(page, "LLP FIFO Depth").fill("100000000")
    page.locator(".btn", has_text="Add route").click()
    page.fill('[aria-label="Route 3 source"]', "PXI_Trig2")
    page.fill('[aria-label="Route 3 destination"]', "BackPlane_CAM_Trig")
    page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/settings_board.png")

    # ---- Debayer configurations
    page.locator(".settings-tab", has_text="Debayer configurations").click()
    page.locator(".bench-row", has_text="RAW_RGGB_to_RGB").click()
    assert bf(page, "Image Width").input_value() == "1632"
    inp = page.locator(".bench-group", has_text="Input Format")
    params = [o.strip() for o in inp.locator('[aria-label="Input Format image format parameter"] option').all_inner_texts()]
    assert params == ["0 – RAWIO_BAYER_MASK_BGGR", "1 – RAWIO_BAYER_MASK_GBRG", "2 – RAWIO_BAYER_MASK_GRBG", "3 – RAWIO_BAYER_MASK_RGGB"], params
    page.select_option('[aria-label="Input Format data size"]', "1")
    page.fill('[aria-label="Input Format bit depth per channel"]', "12")
    assert page.locator(".row-err", has_text="Bit depth 12 does not fit in 1 byte(s) (max 8)").count() == 1
    page.select_option('[aria-label="Input Format data size"]', "2")
    page.select_option('[aria-label="Input Format image format"]', "IMAGE_FORMAT_YUV")
    yuv = [o.strip() for o in page.locator('[aria-label="Input Format image format parameter"] option').all_inner_texts()]
    assert yuv[3] == "3 – YUV_FORMAT_422_YUYV", yuv
    assert page.locator('[aria-label="Input Format data size"]').input_value() == "1"   # YUV is uint8
    page.select_option('[aria-label="Input Format image format parameter"]', "3")
    page.fill('[aria-label="Input Format bit depth per channel"]', "8")
    page.select_option('[aria-label="Output Format image format"]', "IMAGE_FORMAT_RGB")
    out = [o.strip() for o in page.locator('[aria-label="Output Format image format parameter"] option').all_inner_texts()]
    assert out == ["0 – RGB_CHANNEL_ORDER_RGB (without alpha)", "1 – RGB_CHANNEL_ORDER_RGBA (alpha last)", "2 – RGB_CHANNEL_ORDER_ARGB (alpha first)", "3 – RGB_CHANNEL_ORDER_BGRA"], out
    page.select_option('[aria-label="Conversion Parameter"]', "2")
    page.select_option('[aria-label="Device Alternative"]', "DEVICE_TYPE_GPU")
    page.select_option('[aria-label="Image Type"]', "6")
    bf(page, "Name").fill("Front_YUV")
    page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/settings_debayer.png")

    # ---- Apply → ui_config.json
    page.locator(".settings-foot .btn-primary", has_text="Apply").click()
    page.wait_for_selector(".settings", state="detached")
    page.wait_for_timeout(500)
    cfg = json.load(open(UI_CONFIG))
    board = cfg["boardDefaults"][0]
    assert board == {"boardName": "bench_A", "siReferenceClockHz": 25000000, "soReferenceClockHz": 25000000, "framesOnDma": 20,
                     "frameSyncWindow": 30, "frameSyncToleranceUs": 700, "llpFifoDepth": 100000000,
                     "routingSignals": [{"source": "PXI_Trig1", "destination": "Start_Trig"}, {"source": "PXI_Trig4", "destination": "BackPlane_CAM_Trig"},
                                        {"source": "PXI_Trig2", "destination": "BackPlane_CAM_Trig"}]}, board
    deb = next(d for d in cfg["debayerConfigs"] if d["name"] == "Front_YUV")
    assert deb == {"name": "Front_YUV", "imageWidth": 1632, "imageHeight": 1290,
                   "inputFormat": {"dataSize": 1, "bitDepthPerChannel": 8, "useBigEndian": 1, "imageFormat": "IMAGE_FORMAT_YUV", "formatParameter": 3},
                   "outputFormat": {"dataSize": 1, "bitDepthPerChannel": 8, "useBigEndian": 0, "imageFormat": "IMAGE_FORMAT_RGB", "formatParameter": 3},
                   "conversionParameter": 2, "devicePreferred": "DEVICE_TYPE_GPU", "deviceAlternative": "DEVICE_TYPE_GPU", "imageType": 6}, deb
    b.close()

print("bench settings e2e ok; console errors:", errors)
sys.exit(1 if errors else 0)
