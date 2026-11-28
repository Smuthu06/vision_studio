/**
 * Input documentation shown in the Details pane.
 *
 * Texts are plain data so engineers can extend them without touching UI code.
 * Constraint summaries (type, range, allowed values…) are generated from the
 * FieldSpecs, so they can never drift from what the validator enforces.
 */
import { DEFS, EMBEDDED_INFO_TABLE, EMBEDDED_LINE_TABLE, type CNode, type NodeType, type TreeIndex } from "./model";
import { displayValue, isRequired, kindOf, type FieldSpec, type TableSpec } from "./schema";
import { SOURCE_INFO } from "./catalog";

export interface InputDoc {
  doc: string;          // what the input means and how it is used
  example?: string;
  unit?: string;
  tip?: string;         // practical advice / common pitfalls
}

// --------------------------------------------------------------------------
// Node overviews
// --------------------------------------------------------------------------
export const NODE_DOCS: Record<NodeType, string> = {
  project:
    "Root of the configuration file. Holds the identifying metadata of the test-bench project (name, version, author, date) and contains the enabled bench modes and the camera models under test. Every saved file has exactly one project.",
  modes:
    "Container for the operational modes the bench supports in this project. Each mode can appear once. The modes you enable decide which hardware boards each camera needs (Capture Hardware for CaptureMode, Passthrough Hardware for PassthroughMode).",
  mode:
    "One operational routing mode of the bench, plus the optional features (data logging, fault injection) available while running in that mode.",
  cameras:
    "Container for the Device-Under-Test (DUT) camera models. Add one Camera Model per camera variant the bench must handle.",
  camera:
    "Describes one DUT camera: its MIPI CSI-2 packet format, sensor (imager), serializer and calibration EEPROM. Its child nodes describe the bench hardware for each mode, the virtual channels the camera outputs, optional fault injection and optional I2C link-health monitoring.",
  hardware:
    "Mode-specific bench hardware for this camera. Add Capture Hardware when CaptureMode is enabled and Passthrough Hardware when PassthroughMode is enabled. Saved as the camera's \"hw\" array with one entry per mode.",
  hwCapture:
    "The FPGA frame grabber / SerDes interface board used in CaptureMode. The camera's serial link ends in this board's deserializer and the bench receives the video streams itself; no ECU is connected. Saved as { \"CaptureMode\": { … } } inside \"hw\".",
  hwPassthrough:
    "The SerDes interface board used in PassthroughMode. The bench sits inside the camera ↔ ECU link: its deserializer receives the camera, its serializer re-transmits to the ECU, which makes monitoring and fault injection possible. GPIO routing forwards side-band signals across the bench. Saved as { \"passthroughMode\": { … } } inside \"hw\".",
  frames:
    "The MIPI CSI-2 virtual channels (VC0–VC15) that this camera outputs over the SerDes link. Add one Virtual Channel per stream source (for example one per imager on a multi-sensor camera). Saved as \"frameInformation\".",
  vc:
    "One MIPI CSI-2 virtual channel: its index, a friendly name, the acceptable frame-rate window, and the streams (frame outputs) transmitted on it – typically the Image pixel data plus an optional Header of embedded metadata lines.",
  fault:
    "Fault definitions the bench can inject while it routes the link in PassthroughMode: byte corruption inside CSI-2 embedded lines, and interception of I2C control transactions. Requires a project mode with the FaultInjection feature. Saved as \"faultInjection\".",
  monitoring:
    "Continuous link-health telemetry read over I2C while the bench runs: register checks against expected values, error counters and temperature sensors with limits. Saved as \"i2c_monitoring\".",
  tester:
    "Root of a tester configuration: identifies the test bench set-up (name, version, author) and the project configuration it was created for. The project decides which modes and camera models can be chosen. Right-click to add the modes the bench runs in.",
  testerMode:
    "One mode of the selected project in which the bench runs (for example CaptureMode). Right-click to add the camera models tested in this mode. Multiple Display is offered when the project enables EMCfeature.",
  testerCamera:
    "One camera model of the project as connected on this bench: which FPGA device (and resource) it uses, the bit file loaded into the FPGA, the datalogger configuration and the board defaults. Right-click to add the bench channels (SI0–SI7, SO0–SO7) it uses.",
  testerChannel:
    "A bench channel used by the camera model: SI0–SI7 are the deserializer inputs (camera → bench), SO0–SO7 the serializer outputs (bench → ECU). Every channel has an I2C worker; right-click to add the virtual channels it carries.",
  i2cWorker:
    "Reads the I2C traffic of the channel while the bench runs – either monitoring only, or monitoring and checking the values – and pauses between cycles for the given time. Every channel has one.",
  testerVc:
    "A virtual channel of the project camera model carried on this bench channel, with its debayer setting. Every virtual channel has a frame analysis worker.",
  frameAnalysisWorker:
    "Analyses the frames of the virtual channel while the bench runs. Its settings will be added here.",
};

// --------------------------------------------------------------------------
// Node fields
// --------------------------------------------------------------------------
const HW_COMMON: Record<string, InputDoc> = {
  manufacture: {
    doc: "Vendor of the bench interface board. Choosing a manufacturer narrows the Board Model list; manufacturers and their models are maintained in File › Settings › Hardware.",
    example: "NationalInstruments",
  },
  model: {
    doc: "Model of the PXIe FPGA frame grabber / SerDes interface board installed in the bench for this mode. Choosing a model narrows the serializer and deserializer lists to the ICs it supports.",
    example: "NI1487",
  },
  deserializer: {
    doc: "Part number of the receiver (deserializer) IC on the interface board. It terminates the camera's serial link, so it must belong to the same SerDes family and support the same link rate as the camera's serializer.",
    example: "DES_IC_PART_B",
    tip: "A mismatch between serializer and deserializer families (for example GMSL vs FPD-Link) prevents link lock.",
  },
};

export const FIELD_DOCS: Record<NodeType, Record<string, InputDoc>> = {
  project: {
    project: {
      doc: "Name of the project. It identifies the configuration in bench software and is suggested as the file name when you save.",
      example: "ADAS_Vision_Project_Sample",
      tip: "Only letters, digits and underscores – no spaces or hyphens – so the name is safe to use as an identifier and in file paths.",
    },
    version: {
      doc: "Version of this configuration file, written V.<major>.<minor>.<patch>.",
      example: "V.1.0.0",
      tip: "Suggested convention: raise major for changes that need different bench hardware, minor for added cameras or channels, patch for corrected values.",
    },
    author: {
      doc: "User identifier of the engineer who created or last revised the configuration.",
      example: "engineer_user",
    },
    emailAddress: {
      doc: "Corporate email address of the author, used as the contact for questions about this configuration.",
      example: "engineer@company.com",
      tip: "Addresses outside the corporate domain are accepted but produce a warning.",
    },
    date: {
      doc: "Creation or last revision date of the configuration. Must be a real calendar date.",
      example: "01-01-2026 or 01/01/2026",
      tip: "Day first: DD-MM-YYYY or DD/MM/YYYY. 31-02-2026 is rejected.",
    },
    schemaVersion: {
      doc: "Version of the JSON schema this file conforms to. Bench software uses it to decide how to read the file.",
      example: "1.0.0",
      tip: "Leave at 1.0.0 unless you are migrating the file to a newer schema.",
    },
  },
  modes: {},
  mode: {
    mode: {
      doc: "Hardware routing mode. CaptureMode: the camera link ends in the bench's frame grabber, which captures the streams directly (no ECU). PassthroughMode: the bench is inserted between camera and ECU, deserializes the link and re-serializes it towards the ECU, so traffic can be observed and manipulated.",
      example: "PassthroughMode",
      tip: "Each mode may appear only once in a project.",
    },
    features: {
      doc: "Optional bench features enabled in this mode. DataLogger records the received frame data to disk. FaultInjection enables the faults defined under each camera's Fault Injection node. EMCfeature enables the EMC parameters of every camera model (imager I2C address, EEPROM length and addresses, hash register and length). The list is maintained in File › Settings › Mode features.",
      example: "DataLogger, FaultInjection",
      tip: "FaultInjection acts on the routed camera ↔ ECU link, so it is only meaningful in PassthroughMode.",
    },
  },
  cameras: {},
  camera: {
    model: {
      doc: "Identifier of the camera model (DUT variant). Must be unique within the project.",
      example: "ADAS_Camera_Model_A",
    },
    packetFormat: {
      doc: "MIPI CSI-2 RAW packet encoding (bits per pixel) the camera transmits. It must match the sensor's output configuration; the Image streams of this camera are expected to use the same format.",
      example: "raw16",
      tip: "A different dataFormat on an \"Image\" frame output raises a warning.",
    },
    imager: {
      doc: "Model of the image sensor IC inside the camera. Pick it from the list maintained in File › Settings › Imagers.",
      example: "SENSOR_MODEL_X",
    },
    operatingVoltage: {
      doc: "Nominal supply voltage of the camera (for example the power-over-coax voltage supplied by the bench).",
      unit: "V",
      example: "12",
      tip: "Check the camera datasheet – an incorrect voltage can damage the DUT.",
    },
    serializer: {
      doc: "Part number of the serializer IC inside the camera that drives the serial link (GMSL, FPD-Link, …). The list is maintained in File › Settings › Camera serializers.",
      example: "SER_IC_PART_A",
      tip: "In PassthroughMode the bench's serializer normally uses the same part, so the ECU sees an identical link.",
    },
    imagerAddress: {
      doc: "I2C slave address of the image sensor on the camera-side control bus. Enter decimal or 0x-hex; it is stored as an integer.",
      example: "0x34 (= 52)",
      tip: "Use 0 when the bench does not need to address the sensor directly.",
    },
    "eeprom.Lenght": {
      doc: "Size of the calibration data to read from the camera's EEPROM, in bytes. 0 means the camera has no EEPROM or it is not used. (The schema spells this key \"Lenght\".)",
      unit: "bytes",
      example: "0",
    },
    "eeprom.Address": {
      doc: "Address list used to access the calibration EEPROM, entered as comma separated decimal or 0x-hex values. How the list is interpreted (device address, memory start address bytes) is defined by the bench software. Leave empty when there is no EEPROM.",
      example: "0x50, 0x00, 0x00",
    },
    eepromHashRegAddress: {
      doc: "Start address of the register / EEPROM location that holds the calibration hash, used to verify the calibration data.",
      example: "0",
    },
    lenghtHash: {
      doc: "Length of the calibration hash in bytes. 0 disables the hash check. (The schema spells this key \"lenghtHash\".)",
      unit: "bytes",
      example: "0",
    },
  },
  hardware: {},
  hwCapture: {
    ...HW_COMMON,
    serializer: {
      doc: "Serializer IC on the board. Optional in CaptureMode because the bench only receives the link; fill it in if your board also has a transmitter.",
      example: "SER_IC_PART_A",
    },
  },
  hwPassthrough: {
    ...HW_COMMON,
    serializer: {
      doc: "Transmitter (serializer) IC on the board that re-serializes the camera data towards the ECU. Mandatory in PassthroughMode.",
      example: "SER_IC_PART_A",
      tip: "Normally identical to the camera's serializer; a different part raises a warning.",
    },
  },
  frames: {},
  vc: {
    virtualChannelNumber: {
      doc: "MIPI CSI-2 virtual channel identifier (VC) carried in every packet header of this stream. Must be unique within the camera.",
      example: "0",
      tip: "CSI-2 v1.x supports VC 0–3; VC 4–15 require the extended virtual channel field of CSI-2 v2.0 or later on both ends.",
    },
    virtualChannelName: {
      doc: "Friendly name shown in the tree and in bench reports.",
      example: "Front, Rear, Left, Right",
    },
    "fps.min": {
      doc: "Lower boundary of the acceptable frame rate. Frame rates below it are reported by the bench.",
      unit: "frames/s",
      example: "29.9",
      tip: "Must not be greater than FPS Max.",
    },
    "fps.max": {
      doc: "Upper boundary of the acceptable frame rate. Frame rates above it are reported by the bench.",
      unit: "frames/s",
      example: "30.1",
    },
  },
  fault: {},
  monitoring: {},
  tester: {
    applicationName: { doc: "Name of the tester application (applicationName). Together with the version it forms the file name <Application Name>_v<version>.json in the tester configuration folder. It is also written as serviceName, which the schema requires.", example: "Nissan_ADAS_8MP_TESTER", tip: "Letters, digits and underscores only." },
    version: { doc: "Version of this tester configuration. Changing it and saving writes a new file and keeps the old one.", example: "V.1.0.0" },
    author: { doc: "User identifier of the engineer who created or last revised the tester configuration.", example: "smuthusa" },
    emailAddress: { doc: "Contact email of the author.", example: "user@valeo.com" },
    date: { doc: "Creation or revision date of the tester configuration.", example: "16/09/2026" },
    project: { doc: "The project configuration (JSON in the project configuration folder) this tester is for. Its modes, camera models, hardware, frame information and I2C monitoring fill the tester; the file stores it as project { name, version }.", example: "sample_v1.0.0.json", tip: "Choosing another project re-checks every mode and camera model against it." },
  },
  testerMode: {
    mode: { doc: "A mode defined in the selected project configuration; the tester schema allows CaptureMode and PassthroughMode. Each mode can be added once. Its features and hardwareInfo are written from the project.", example: "CaptureMode" },
    multipleDisplay: { doc: "Shows the camera streams of this mode on multiple displays (multiple_display). Offered only when the selected project enables EMCfeature.", example: "Enabled" },
  },
  testerCamera: {
    cameraModel: { doc: "Camera model of the selected project. Its imager, packet format, serializer, operating voltage, EMC values and hardware are written into the tester file.", example: "ADAS_Camera_Model_A" },
    name: { doc: "Logical name of this camera model on the bench (name). It is shown in the tree, so several units of the same model can be told apart.", example: "Front_Left" },
    manufacturer: { doc: "Manufacturer of the capture hardware configured for this camera model in the project (Capture Hardware for CaptureMode, Passthrough Hardware for PassthroughMode).", example: "NationalInstruments" },
    deviceModel: { doc: "Capture card model configured for this camera model and manufacturer in the project.", example: "NI1487" },
    deviceMode: { doc: "IO density configuration of the FPGA (deviceMode). Choosing a bit file sets it from the file name (FPGA_8IN_… → 8in, FPGA_4IN4OUT_… → 4in/4out, FPGA_4IN_… → 4in). The list is maintained in File › Settings › Device modes.", example: "4in/4out" },
    deviceResource: { doc: "PXI chassis resource address of the capture card (deviceResource), as shown in NI MAX.", example: "PXI1Slot2" },
    fpgaBitFile: { doc: "FPGA bit file (.lvbitx) loaded into the device. The list shows the files in the fpga_bitfile folder (bitfile_dir in the INI); the file stores the full path.", example: "FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx", tip: "A bit file built for another capture card or IO density gives a warning." },
    dataloggerCommands: { doc: "Datalogger configuration command file. The list shows the JSON files in the datalogger_configuration folder (datalogger_dir in the INI); the file stores the full path.", example: "front_logger.json" },
    fpgaBoardName: { doc: "FPGA board (fpgaBoardName). Its values from File › Settings › FPGA board defaults are written as fpgaDefaults: SI/SO reference clocks, frames on DMA, frame sync window and tolerance and LLP FIFO depth (the routing signals stay in Settings; the schema has no key for them).", example: "board1" },
  },
  testerChannel: {
    channel: { doc: "Bench channel: SI0–SI7 (deserializer inputs) or SO0–SO7 (serializer outputs). In PassthroughMode this is the input (SI). Each channel can be used once per camera model.", example: "SI1" },
    channelName: { doc: "Name of the signal on this channel (channelName); shown in the tree.", example: "CH0_In" },
    pocMode: { doc: "Power over Coax of the channel: Internal, Auxiliary or None.", example: "Internal" },
    streamingMode: { doc: "Streaming mode of the channel: Single or Continuous.", example: "Single" },
    i2cCommands: { doc: "I2C initialisation script written when the channel starts. The list shows the .txt files in the i2c_configuration folder (i2c_dir in the INI); the file stores the full path.", example: "I2CConfig.txt" },
    outputChannel: { doc: "PassthroughMode: the serializer output (SO0–SO7) the input is passed to.", example: "SO0" },
    outputChannelName: { doc: "PassthroughMode: name of the output channel.", example: "CH0_Out" },
    outputPocMode: { doc: "PassthroughMode: Power over Coax of the output.", example: "Auxiliary" },
    outputI2cCommands: { doc: "PassthroughMode: I2C script for the serializer side (.txt from the i2c_configuration folder).", example: "SER.txt" },
    soCsiDataLane: { doc: "PassthroughMode: number of MIPI CSI-2 data lanes of the output.", example: "4 Lane" },
    soCsiDatarate: { doc: "PassthroughMode: CSI-2 data rate of the output in bit/s (SoCsiDatarate).", example: "1300000000" },
    cybersecurityEnable: { doc: "Enables the cybersecurity (authentication) check of the camera on this channel.", example: "Disabled" },
    lvClass: { doc: "LabVIEW class that implements the cybersecurity check; required when it is enabled.", example: "X3F(OVT)" },
  },
  i2cWorker: {
    i2cWorkerMode: { doc: "Monitoring: read and log the I2C values. Monitoring & Checking: also compare them with the expected values. With Monitoring & Checking the panel shows the I2C Checking Config: the register, error-count and temperature monitors of the project's I2C Monitoring of the camera model, saved as i2cCheckingConfig. With Monitoring only, i2cCheckingConfig is saved as null.", example: "Monitoring & Checking" },
    pauseTime: { doc: "Pause between two I2C read cycles, in milliseconds.", example: "100" },
  },
  testerVc: {
    virtualChannel: { doc: "Virtual channel of the camera model as defined in the selected project (Frame Information); written as VC<n> with its frameInfo.", example: "0 – Front" },
    name: { doc: "Name of this virtual channel.", example: "Image" },
    debayer: { doc: "Debayer configuration for the image data of this virtual channel, from File › Settings › Debayer configurations. Written as cameraDebayer (the name) and debayerConfiguration with the schema's keys: imageSize, inputFormat and outputFormat (dataSize, bitDepthPerChannel, useBigEndian) and conversionParams (Conv_Param_1).", example: "RAW_RGGB_to_RGB" },
  },
  frameAnalysisWorker: {
    frameVerification: { doc: "Checks every frame of the virtual channel against its frame information (written as \"Frame Verification\").", example: "Enabled" },
  },
};

// --------------------------------------------------------------------------
// Tables
// --------------------------------------------------------------------------
export const TABLE_DOCS: Record<string, { doc: string; columns: Record<string, InputDoc> }> = {
  testerChannels: {
    doc: "Bench channels used by this camera model and the name of the signal on each. SI0–SI7 are the deserializer inputs (camera → bench), SO0–SO7 the serializer outputs (bench → ECU). Each channel can be used once per camera model.",
    columns: {
      channel: { doc: "Bench channel: SI0–SI7 (inputs) or SO0–SO7 (outputs).", example: "SI0" },
      name: { doc: "Name of the signal on this channel.", example: "Front" },
    },
  },
  gpio: {
    doc: "Routes general-purpose I/O signals across the bench while it is in the link (for example frame-sync from ECU to camera, or interrupt/error lines from camera to ECU). Each row forwards one FPGA source pin to one destination pin on one serial channel. Auto 1:1 adds GPIO n → GPIO n for every unrouted pin.",
    columns: {
      direction: { doc: "Direction in which the signal is forwarded. \"SO to SI\" = Serializer Output to Serializer Input; \"SI to SO\" is the reverse path.", example: "SO to SI" },
      serialChannel: { doc: "Serial link channel the route belongs to (link / GPIO tunnel 0–3).", example: "0" },
      source: { doc: "FPGA pin the signal is taken from (GPIO 0–11).", example: "GPIO 0", tip: "A source pin can be routed only once per channel and direction." },
      destination: { doc: "FPGA pin the signal is driven onto (GPIO 0–11).", example: "GPIO 0", tip: "Two routes driving the same destination raise a warning." },
    },
  },
  frameOutput: {
    doc: "Streams transmitted on this virtual channel, each identified by its CSI-2 data type. A typical camera sends the Image (pixel data) and a Header containing embedded metadata lines.",
    columns: {
      name: { doc: "Stream name: Image (pixel data), Header (embedded data lines before/after the image) or Metadata. Other names are allowed.", example: "Image" },
      dataIdentifier: {
        doc: "MIPI CSI-2 Data Type (DT) of the stream's packets, as hex (0x00–0x3F).",
        example: "0x2A",
        tip: "Standard CSI-2 data types: 0x12 embedded 8-bit data, 0x2A RAW8, 0x2B RAW10, 0x2C RAW12, 0x2D RAW14, 0x2E RAW16. Use the value your camera actually transmits.",
      },
      dataFormat: { doc: "Pixel bit depth of the stream's payload.", example: "raw16" },
      xSize: { doc: "Horizontal size: pixels per line.", unit: "pixels", example: "1824" },
      ySize: { doc: "Vertical size: lines per frame. For a Header stream this is the number of embedded lines.", unit: "lines", example: "1536" },
    },
  },
  embeddedLine: {
    doc: "Embedded metadata line definitions of the selected frame output (optional, typically for the Header stream). Select a line to define the fields decoded from it.",
    columns: {
      lineNumber: { doc: "Index of the embedded line within the stream, starting at 0.", example: "0" },
      tag_included: { doc: "Whether the line uses a tagged format, i.e. each data byte is accompanied by tag/marker bytes that must be skipped when decoding.", example: "false" },
      byte_order: { doc: "Byte order of multi-byte fields in this line. The schema spells the values \"Little Indian\" / \"Big Indian\" (little / big endian); the spelling is kept for compatibility.", example: "Little Indian" },
    },
  },
  embeddedInfo: {
    doc: "Fields decoded from the selected embedded line, such as frame counters, exposure or sensor temperature.",
    columns: {
      name: { doc: "Name of the decoded field.", example: "Frame Counter" },
      offset: { doc: "Byte offset of the field within the line.", unit: "bytes", example: "60" },
      length: { doc: "Field length.", unit: "bytes", example: "8" },
      Formula: { doc: "Optional conversion applied to the raw value, written with x as the raw value. Leave empty to use the raw value.", example: "x - 50" },
    },
  },
  elFault: {
    doc: "Corrupts bytes inside CSI-2 embedded lines while the bench routes the link – for example to fake an over-temperature status and check that the ECU reacts.",
    columns: {
      faultName: { doc: "Unique, descriptive name of the fault, shown in bench test sequences.", example: "Over-Temperature CH0" },
      description: { doc: "Free-text notes on what the fault simulates.", example: "Insert Fault in EL" },
      virtualChannel: { doc: "Virtual channel whose embedded lines are corrupted. It should exist under Frame Information.", example: "0" },
      dataIdentifier: { doc: "Data type of the embedded-line packets to corrupt (decimal or 0x-hex).", example: "13", tip: "Embedded 8-bit data is CSI-2 data type 0x12 (18)." },
      lineNumber: { doc: "Index of the embedded line to corrupt.", example: "0" },
      position: { doc: "Index of the first byte to corrupt within the line.", unit: "bytes", example: "6" },
      length: { doc: "Number of bytes to corrupt.", unit: "bytes", example: "1" },
      mode: { doc: "How the fault value is applied: 0 None (disabled), 1 Bitwise (the value is applied bit by bit to the original bytes), 2 Fixed (the bytes are overwritten with the value). The exact bitwise operation is defined by the bench firmware.", example: "2 – Fixed" },
      faultValues: { doc: "Payload written by the fault, as hex bytes.", example: "80" },
      crcAlgorithm: { doc: "Checksum of the embedded line to recompute after corruption, so the corrupted data still looks valid to the ECU. None leaves the original checksum, which then no longer matches.", example: "0 – None" },
      crcPosition: { doc: "Byte position of that checksum within the line.", unit: "bytes", example: "0" },
      enableMipiCrcFault: { doc: "Also corrupt the CSI-2 packet CRC, so the receiver detects a packet checksum error.", example: "false" },
      operation: { doc: "Single Mode applies the fault once; Continuous keeps applying it.", example: "0 – Single Mode" },
      frameQuantity: { doc: "Number of frames the fault is applied to. 0 = indefinitely.", unit: "frames", example: "0" },
    },
  },
  i2cFault: {
    doc: "Intercepts I2C control transactions on the SerDes / sensor control channel and manipulates them – for example to corrupt a value during serializer initialisation.",
    columns: {
      faultName: { doc: "Unique, descriptive name of the fault.", example: "CRC-Corruption_SerDesInit_1" },
      description: { doc: "Free-text notes on what the fault simulates.", example: "Corrupts CRC value during serializer initialization" },
      slaveAdress: { doc: "I2C slave address of the device whose transactions are intercepted (7-bit or 8-bit form, as used by your bench). Schema key spelled \"slaveAdress\".", example: "0x11 (= 17)" },
      i2cMode: { doc: "Register address width of the target device: 8-bit or 16-bit registers.", example: "1 – 16-bit registers" },
      registerAdress: { doc: "Register address to intercept, as hex. Up to 2 digits for 8-bit and 4 digits for 16-bit registers. Schema key spelled \"registerAdress\".", example: "3180" },
      commandType: { doc: "Transaction type to intercept: Write or Read.", example: "0 – Write" },
      interceptAttempt: { doc: "Which matching transaction triggers the fault (count). 255 = every matching transaction.", example: "255" },
      faultValues: { doc: "Data byte(s) substituted into the intercepted transaction, as hex.", example: "CC" },
      setAckNack: { doc: "Override the I2C acknowledge: None keeps the device's response, Force ACK always acknowledges, Force NACK forces a not-acknowledge.", example: "0 – None" },
    },
  },
  registerMonitor: {
    doc: "Registers polled continuously over I2C. The value read is masked and compared with the expectation; a mismatch is reported with the error string (for example a lost link lock).",
    columns: {
      Mode: { doc: "Access type used for monitoring (normally Read).", example: "Read" },
      "Slave Address": { doc: "I2C address of the device to read (decimal or 0x-hex).", example: "0x51 (= 81)" },
      "Register(s)": { doc: "Register address bytes, most significant first. A 16-bit register is entered as two bytes.", example: "0x00, 0x13" },
      Mask: { doc: "Bit mask applied to the value read before comparing.", example: "0x08" },
      Expectation: { doc: "Expected value after masking. Any other value is reported as an error.", example: "0x08" },
      "Error String": { doc: "Message reported when the check fails.", example: "DES LINK LOCK STATUS ERR for Link A 0x0013[3]" },
      "Link Options": { doc: "Serial link the check applies to.", example: "Link A" },
      "Bit Mode": { doc: "Register address width: 8-Bit expects one register byte, 16-Bit expects two.", example: "16-Bit" },
      "Read Bytes": { doc: "Number of bytes read from the register.", unit: "bytes", example: "1" },
    },
  },
  errorCount: {
    doc: "Error counter registers polled over I2C (for example disparity or CRC error counters). Increases are reported with the description.",
    columns: {
      Mode: { doc: "Access type used for monitoring (normally Read).", example: "Read" },
      "Slave Address": { doc: "I2C address of the device that holds the counter.", example: "0x51 (= 81)" },
      "Register(s)": { doc: "Register address bytes of the counter, most significant first.", example: "0x00, 0x22" },
      Mask: { doc: "Bit mask applied to the counter value, as interpreted by the bench software (the sample uses 0).", example: "0x00" },
      "Error Description": { doc: "Message reported when the counter increases.", example: "DES DISPARITY ERRORS detected at Link A 0x22[7-0]" },
      "Link Options": { doc: "Serial link the counter belongs to.", example: "Link A" },
    },
  },
  temperatureMonitor: {
    doc: "Temperature sensors read over I2C and checked against limits – for example the imager's on-chip temperature sensor.",
    columns: {
      Mode: { doc: "Access type used for monitoring (normally Read).", example: "Read" },
      "Slave Address": { doc: "I2C address of the device with the temperature sensor.", example: "0x35 (= 53)" },
      "Register(s)_IntegerBit": { doc: "Register address bytes holding the integer part of the temperature.", example: "0x1F, 0x40" },
      "Register(s)_FractionBit": { doc: "Register address bytes holding the fractional part of the temperature.", example: "0x1F, 0x41" },
      "Min Limit": { doc: "Lowest acceptable temperature; lower readings are reported.", unit: "°C", example: "-40" },
      "Max Limit": { doc: "Highest acceptable temperature; higher readings are reported. Must be above Min Limit.", unit: "°C", example: "122" },
      Value: { doc: "Reference / initial value used by the bench software (the sample uses 0).", unit: "°C", example: "0" },
      Description: { doc: "Message reported when the temperature is outside the limits.", example: "IMAGER SENSOR TEMP degC LinkA FAULT" },
      "Link Options": { doc: "Serial link the sensor is reached through.", example: "Link A" },
    },
  },
};

// --------------------------------------------------------------------------
// Lookups
// --------------------------------------------------------------------------
export const fieldDoc = (type: NodeType, key: string): InputDoc | undefined => FIELD_DOCS[type]?.[key];
export const tableDoc = (spec: TableSpec) => (spec.docId ? TABLE_DOCS[spec.docId] : undefined);
export const columnDoc = (spec: TableSpec, key: string): InputDoc | undefined => tableDoc(spec)?.columns[key];

/** Find the TableSpec behind an issue/table id such as "frameOutput[1].embeddedLine[0].info". */
export function resolveTable(node: CNode, tableId: string): TableSpec | undefined {
  const own = DEFS[node.type].tables?.find((t) => t.key === tableId);
  if (own) return own;
  if (node.type === "vc") {
    if (/\.info$/.test(tableId)) return EMBEDDED_INFO_TABLE;
    if (/\.embeddedLine$/.test(tableId)) return EMBEDDED_LINE_TABLE;
  }
  return undefined;
}

/** Human readable constraint rows generated from a FieldSpec. */
export function constraintRows(spec: FieldSpec): Array<[string, string]> {
  const k = kindOf(spec);
  const rows: Array<[string, string]> = [];
  const typeName: Record<string, string> = {
    str: "Text", int: spec.hex ? "Integer (decimal or 0x-hex, shown as hex)" : "Integer (decimal or 0x-hex)",
    float: "Number", enum: "Choice", intenum: "Choice (stored as number)", bool: "Yes / no (true / false)",
    multi: "Set of options", hexstr: "Hexadecimal text", intlist: "List of integers (comma separated)",
  };
  rows.push(["Type", typeName[k]]);
  rows.push(["Required", isRequired(spec) ? "Yes" : "No"]);
  if (spec.min !== undefined || spec.max !== undefined) {
    const f = (v: number) => (spec.hex && Number.isInteger(v) ? `${v} (0x${v.toString(16).toUpperCase()})` : String(v));
    rows.push(["Range", spec.min !== undefined && spec.max !== undefined ? `${f(spec.min)} – ${f(spec.max)}`
      : spec.min !== undefined ? `≥ ${f(spec.min)}` : `≤ ${f(spec.max!)}`]);
  }
  if (spec.pattern) rows.push(["Format", spec.hint?.replace(/^must (be |have the form )?/, "") ?? spec.pattern.source]);
  if (spec.requiresFeature) rows.push(["Requires", `${spec.requiresFeature} enabled in a project mode (otherwise read-only and not checked)`]);
  if (spec.source) rows.push(["Values from", `${SOURCE_INFO[spec.source].section ? "Settings › " : ""}${SOURCE_INFO[spec.source].label}${spec.strict ? "" : " (other values give a warning)"}`]);
  if (spec.showIf) rows.push(["Shown when", `the project enables ${spec.showIf}`]);
  if (k === "enum" || k === "multi") {
    const opts = spec.options ?? [];
    rows.push(["Allowed", opts.length ? opts.map((o) => spec.optionLabels?.[o] ?? o).join(", ") : "— list is empty —"]);
  }
  if (k === "intenum") rows.push(["Allowed", (spec.intOptions ?? []).map(([v, l]) => `${v} = ${l}`).join(", ")]);
  if (k === "hexstr" && spec.min === undefined) rows.push(["Format", "hex digits, optional 0x, several bytes separated by spaces"]);
  if (spec.default !== undefined && spec.default !== null && spec.default !== "")
    rows.push(["Default", displayValue(spec, spec.default)]);
  return rows;
}

/** JSON location of a node in the saved file, e.g. project.cameraModels[0].hw[1].passthroughMode */
const passthroughBelow = (n: CNode, idx: TreeIndex) => /^passthrough/i.test(String(idx.ancestor(n, "testerMode")?.params.mode ?? ""));

/** Key in the written tester file of an editor field, relative to its node (the editor uses its own names for a few). */
export function fieldJsonKey(node: CNode, key: string, idx: TreeIndex): string {
  const pass = passthroughBelow(node, idx);
  const map: Record<string, Record<string, string>> = {
    tester: { project: "project.{name, version}" },
    testerMode: { multipleDisplay: "multiple_display" },
    testerChannel: {
      channel: pass ? "input.channel" : "channel", channelName: pass ? "input.channelName" : "channelName",
      pocMode: pass ? "input.pocMode" : "pocMode", streamingMode: pass ? "input.streamingMode" : "streamingMode",
      i2cCommands: pass ? "input.i2cCommands" : "i2cCommands", outputChannel: "output.channel", outputChannelName: "output.channelName",
      outputPocMode: "output.pocMode", outputI2cCommands: "output.i2cCommands", soCsiDataLane: "output.soCsiDataLane",
      soCsiDatarate: "output.SoCsiDatarate", cybersecurityEnable: "cybersecurity.enable", lvClass: "cybersecurity.lvClass",
    },
    testerVc: { virtualChannel: "virtualChannel (\"VC<n>\")", debayer: "cameraDebayer (+ debayerConfiguration)" },
    frameAnalysisWorker: { frameVerification: "[\"Frame Verification\"]" },
  };
  return map[node.type]?.[key] ?? key;
}

export function jsonPathOf(node: CNode, idx: TreeIndex): string {
  const parent = idx.parentOf(node);
  const indexIn = (p: CNode) => p.children.filter((c) => c.type === node.type).indexOf(node);
  switch (node.type) {
    case "project": return "project";
    case "modes": return "project.projectModes";
    case "cameras": return "project.cameraModels";
    case "mode": case "camera": case "vc": return `${jsonPathOf(parent!, idx)}[${indexIn(parent!)}]`;
    case "hardware": return `${jsonPathOf(parent!, idx)}.hw`;
    case "hwCapture": case "hwPassthrough":
      return `${jsonPathOf(parent!, idx)}[${parent!.children.indexOf(node)}].${node.jsonKey ?? (node.type === "hwCapture" ? "CaptureMode" : "passthroughMode")}`;
    case "frames": return `${jsonPathOf(parent!, idx)}.frameInformation`;
    case "fault": return `${jsonPathOf(parent!, idx)}.faultInjection`;
    case "monitoring": return `${jsonPathOf(parent!, idx)}.i2c_monitoring`;
    case "tester": return "cameraTester";
    case "testerMode": return `cameraTester.testModes[${indexIn(parent!)}]`;
    case "testerCamera": return `${jsonPathOf(parent!, idx)}.cameraModels[${indexIn(parent!)}]`;
    case "testerChannel": return `${jsonPathOf(parent!, idx)}.channelConfiguration[${indexIn(parent!)}]`;
    case "i2cWorker": return `${jsonPathOf(parent!, idx)}${passthroughBelow(node, idx) ? ".input" : ""}.i2cWorker`;
    case "testerVc": return `${jsonPathOf(parent!, idx)}${passthroughBelow(node, idx) ? ".input" : ""}.vcConfiguration[${indexIn(parent!)}]`;
    case "frameAnalysisWorker": return `${jsonPathOf(parent!, idx)}.frameAnalysisWorker`;
  }
}

/** Child types a node can contain (for the "Can contain" list). */
export function containsList(node: CNode): NodeType[] {
  const t = DEFS[node.type].childTypes ?? [];
  return node.type === "modes" ? ["mode"] : t;
}
