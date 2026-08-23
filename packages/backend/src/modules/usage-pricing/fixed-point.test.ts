import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { describe, expect, it } from "vitest";

import {
  ATTO_USD_PER_USD,
  BINARY_GIB_BYTES,
  USAGE_DOCUMENT_CLIENT_OPTIONS,
  addDynamoIntegers,
  assertDynamoInteger,
  divideHalfUp,
  formatAttoUsd,
  formatScaledUnsigned,
  multiplyDivideHalfUp,
  parseUnsignedDecimalToAtoms,
  parseUnsignedInteger,
} from "./fixed-point.js";

describe("usage fixed-point arithmetic", () => {
  it("parses exact bounded integers and decimals without binary floating point", () => {
    expect(parseUnsignedInteger("12345678901234567890123456789012345678")).toBe(
      12345678901234567890123456789012345678n,
    );
    expect(parseUnsignedDecimalToAtoms("0.1", 18)).toBe(100000000000000000n);
    expect(parseUnsignedDecimalToAtoms("0.2", 18)).toBe(200000000000000000n);
    expect(parseUnsignedDecimalToAtoms("1", 18)).toBe(ATTO_USD_PER_USD);
    expect(BINARY_GIB_BYTES).toBe(1073741824n);
  });

  it("rejects signs, exponent notation, excessive fractions, and overflow", () => {
    for (const value of ["-1", "+1", "01", "1e3", "1.2.3", ""]) {
      expect(() => parseUnsignedDecimalToAtoms(value, 18)).toThrow();
    }
    expect(() => parseUnsignedDecimalToAtoms("0.0001", 3)).toThrow();
    expect(() => assertDynamoInteger(-1n)).toThrow();
    expect(() => assertDynamoInteger(10n ** 38n)).toThrow();
    expect(() => addDynamoIntegers(10n ** 38n - 1n, 1n)).toThrow();
  });

  it("rounds exact half-up ties once", () => {
    expect(divideHalfUp(4n, 3n)).toBe(1n);
    expect(divideHalfUp(5n, 3n)).toBe(2n);
    expect(divideHalfUp(1n, 2n)).toBe(1n);
    expect(divideHalfUp(0n, 7n)).toBe(0n);
    expect(multiplyDivideHalfUp(5n, 1n, 2n)).toBe(3n);
    expect(() => divideHalfUp(1n, 0n)).toThrow();
  });

  it("formats canonical decimal and atto-USD strings without exponent notation", () => {
    expect(formatAttoUsd(0n)).toBe("0");
    expect(formatAttoUsd(1n)).toBe("0.000000000000000001");
    expect(formatAttoUsd(1234000000000000000n)).toBe("1.234");
    expect(formatScaledUnsigned(1200n, 3)).toBe("1.2");
  });

  it("round-trips bigint DynamoDB numbers through the repository converter", () => {
    const value = 12345678901234567890123456789012345678n;
    const stored = marshall(
      { quantityAtoms: value },
      USAGE_DOCUMENT_CLIENT_OPTIONS.marshallOptions,
    );
    expect(stored["quantityAtoms"]).toEqual({ N: value.toString() });
    expect(unmarshall(stored, USAGE_DOCUMENT_CLIENT_OPTIONS.unmarshallOptions)).toEqual({
      quantityAtoms: value,
    });
  });
});
