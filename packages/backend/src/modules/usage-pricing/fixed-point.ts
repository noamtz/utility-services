export const USD_SCALE = 18 as const;
export const ATTO_USD_PER_USD = 10n ** 18n;
export const BINARY_GIB_BYTES = 2n ** 30n;
export const DYNAMODB_NUMBER_MAX_DIGITS = 38 as const;

const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/u;
const UNSIGNED_DECIMAL = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/u;

export function assertDynamoInteger(value: bigint): bigint {
  if (value < 0n || value.toString().length > DYNAMODB_NUMBER_MAX_DIGITS) {
    throw new RangeError("Value exceeds the supported DynamoDB unsigned integer range");
  }
  return value;
}

export function parseUnsignedInteger(value: string): bigint {
  if (!UNSIGNED_INTEGER.test(value)) throw new TypeError("Expected an unsigned integer string");
  return assertDynamoInteger(BigInt(value));
}

export function parseUnsignedDecimalToAtoms(value: string, scale: number): bigint {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > DYNAMODB_NUMBER_MAX_DIGITS) {
    throw new RangeError("Invalid fixed-point scale");
  }
  const match = UNSIGNED_DECIMAL.exec(value);
  if (!match) throw new TypeError("Expected an unsigned decimal string");
  const fraction = match[1] ?? "";
  if (fraction.length > scale) throw new RangeError("Decimal exceeds the configured scale");
  const [whole = "0"] = value.split(".");
  const atoms =
    BigInt(whole) * 10n ** BigInt(scale) +
    BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
  return assertDynamoInteger(atoms);
}

export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new RangeError(
      "Half-up division requires a non-negative numerator and positive denominator",
    );
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

export function multiplyDivideHalfUp(left: bigint, right: bigint, denominator: bigint): bigint {
  if (left < 0n || right < 0n) throw new RangeError("Fixed-point factors must be non-negative");
  return assertDynamoInteger(divideHalfUp(left * right, denominator));
}

export function addDynamoIntegers(...values: bigint[]): bigint {
  return assertDynamoInteger(
    values.reduce((total, value) => total + assertDynamoInteger(value), 0n),
  );
}

export function formatScaledUnsigned(value: bigint, scale: number): string {
  assertDynamoInteger(value);
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > DYNAMODB_NUMBER_MAX_DIGITS) {
    throw new RangeError("Invalid fixed-point scale");
  }
  if (scale === 0) return value.toString();
  const digits = value.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/u, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

export function formatAttoUsd(value: bigint): string {
  return formatScaledUnsigned(value, USD_SCALE);
}

export function wrapDynamoInteger(value: string): bigint {
  return parseUnsignedInteger(value);
}

export const USAGE_DOCUMENT_CLIENT_OPTIONS = Object.freeze({
  marshallOptions: { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: wrapDynamoInteger },
});
