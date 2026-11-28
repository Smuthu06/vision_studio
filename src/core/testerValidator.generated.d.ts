import type { ErrorObject } from "ajv";
/** Standalone validator for tester_configuration.schema.json (see scripts/gen-tester-validator.mjs). */
declare const validate: ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
export default validate;
export { validate };
