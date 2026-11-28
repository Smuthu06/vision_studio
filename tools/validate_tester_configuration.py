import os
import sys
import json
import glob
import argparse
from typing import List, Tuple, Dict, Any

try:
    import jsonschema
    from jsonschema import Draft7Validator
except ImportError:
    print("Error: 'jsonschema' package is required.")
    print("Install it using: pip install jsonschema")
    sys.exit(1)


DEFAULT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SCHEMA_PATH = os.path.join(DEFAULT_DIR, "tester_configuration.schema.json")


def load_schema(schema_path: str) -> Dict[str, Any]:
    """Load and validate the JSON schema itself."""
    if not os.path.exists(schema_path):
        # Try fallback locations
        alt_paths = [
            os.path.join(r"C:\VVS_Test_Tool\gitreps\Tools\cb907_Camera_Test_Platform_Tools\configurations\tester_configurations", "tester_configuration.schema.json"),
            os.path.join(r"C:\Users\Smuthusa", "tester_configuration.schema.json"),
        ]
        for alt in alt_paths:
            if os.path.exists(alt):
                schema_path = alt
                break
        else:
            raise FileNotFoundError(f"Schema file not found at: {schema_path}")

    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)

    # Check schema syntax
    Draft7Validator.check_schema(schema)
    return schema


def format_error(error: jsonschema.ValidationError) -> str:
    """Format a jsonschema ValidationError with path and context."""
    path = " -> ".join([str(p) for p in error.path]) if error.path else "root"
    msg = error.message
    # If error is a oneOf / anyOf mismatch, find the best sub-error
    if error.context:
        sub_errors = []
        for sub_err in error.context:
            sub_path = " -> ".join([str(p) for p in sub_err.path]) if sub_err.path else "root"
            sub_errors.append(f"    - at [{sub_path}]: {sub_err.message}")
        if sub_errors:
            msg += "\n" + "\n".join(sub_errors[:5])
    return f"[{path}]: {msg}"


def validate_file(file_path: str, validator: Draft7Validator) -> Tuple[bool, str]:
    """Validate a single JSON configuration file.
    
    Returns (is_valid, message).
    """
    if not os.path.exists(file_path):
        return False, f"File does not exist: {file_path}"

    file_size = os.path.getsize(file_path)
    if file_size == 0:
        return False, "File is completely empty (0 bytes)."

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return False, f"JSON Syntax Error: {e}"
    except Exception as e:
        return False, f"Failed to read file: {e}"

    errors = sorted(validator.iter_errors(data), key=lambda e: e.path)
    if not errors:
        return True, "Valid"

    error_msgs = [format_error(e) for e in errors]
    return False, "\n  ".join(error_msgs)


def main():
    parser = argparse.ArgumentParser(
        description="Validate tester configuration JSON files against the CTP JSON Schema."
    )
    parser.add_argument(
        "files",
        nargs="*",
        help="One or more JSON files to validate."
    )
    parser.add_argument(
        "--dir", "-d",
        default=None,
        help="Directory containing JSON files to validate."
    )
    parser.add_argument(
        "--schema", "-s",
        default=DEFAULT_SCHEMA_PATH,
        help="Path to the JSON Schema file."
    )
    parser.add_argument(
        "--all", "-a",
        action="store_true",
        help="Validate all JSON files in the script's directory."
    )
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Only display files with errors."
    )

    args = parser.parse_args()

    # Load Schema
    try:
        schema = load_schema(args.schema)
        validator = Draft7Validator(schema)
    except Exception as e:
        print(f"[FATAL] Failed to load schema: {e}", file=sys.stderr)
        sys.exit(2)

    # Determine files to validate
    target_files = []
    if args.files:
        for f in args.files:
            if os.path.isfile(f):
                target_files.append(f)
            else:
                matches = glob.glob(f)
                if matches:
                    target_files.extend(matches)
                else:
                    print(f"[WARNING] File not found: {f}", file=sys.stderr)
    elif args.dir:
        target_files = sorted(glob.glob(os.path.join(args.dir, "*.json")))
    else:
        # Default or --all: scan directory of script / current directory
        search_dir = DEFAULT_DIR if args.all or not args.files else os.getcwd()
        target_files = sorted(glob.glob(os.path.join(search_dir, "*.json")))

    # Exclude schema file itself if present in scan
    target_files = [
        f for f in target_files
        if not os.path.basename(f).endswith(".schema.json")
    ]

    if not target_files:
        print("No JSON configuration files found to validate.")
        sys.exit(0)

    print(f"Loaded Schema: {args.schema}")
    print(f"Validating {len(target_files)} file(s)...\n" + "-" * 70)

    passed_count = 0
    failed_count = 0
    empty_count = 0

    for file_path in target_files:
        rel_name = os.path.basename(file_path)
        is_valid, msg = validate_file(file_path, validator)

        if is_valid:
            passed_count += 1
            if not args.quiet:
                print(f" [PASS] {rel_name}")
        else:
            if "0 bytes" in msg:
                empty_count += 1
                print(f" [EMPTY] {rel_name} -> {msg}")
            else:
                failed_count += 1
                print(f" [FAIL] {rel_name}")
                print(f"        {msg}\n")

    print("-" * 70)
    print(f"Summary: {passed_count} Passed, {failed_count} Failed, {empty_count} Empty (Total: {len(target_files)})")

    if failed_count > 0 or empty_count > 0:
        sys.exit(1)
    else:
        print("All tested files are valid!")
        sys.exit(0)


if __name__ == "__main__":
    main()
