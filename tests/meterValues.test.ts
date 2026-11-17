import { describe, it, expect } from "@jest/globals";
import { parseNumber } from "../src/meterValues";

describe("parseNumber", () => {

    it("turns text into a number", () => {
        expect(parseNumber("7360")).toBe(7360);
    });

    it("rejects text that is not a number", () => {
        expect(parseNumber("abc")).toBeNull();
    });

    it("rejects empty text instead of turning it into 0", () => {
        expect(parseNumber("")).toBeNull();
        expect(parseNumber("   ")).toBeNull();
    });

    it("rejects values that are not text", () => {
        expect(parseNumber(null)).toBeNull();
        expect(parseNumber(true)).toBeNull();
        expect(parseNumber(7360)).toBeNull();
    });

    it("handles decimal numbers", () => {
        expect(parseNumber("123.45")).toBe(123.45);
        expect(parseNumber("0.001")).toBe(0.001);
        expect(parseNumber("-987.65")).toBe(-987.65);
    });

    it("handles numbers with leading and trailing whitespace", () => {
        expect(parseNumber("  42  ")).toBe(42);
        expect(parseNumber("\n\t-3.14\t\n")).toBe(-3.14);
    });

    it("rejects numbers with invalid formatting", () => {
        expect(parseNumber("1,000")).toBeNull();
        expect(parseNumber("12.34.56")).toBeNull();
        expect(parseNumber("abc123")).toBeNull();
    });

    it("rejects special numeric values", () => {
        expect(parseNumber("NaN")).toBeNull();
        expect(parseNumber("Infinity")).toBeNull();
        expect(parseNumber("-Infinity")).toBeNull();
    });

    it("accepts numbers with leading zeros", () => {
        expect(parseNumber("0123")).toBe(123);
        expect(parseNumber("000")).toBe(0);
        expect(parseNumber("0")).toBe(0);
    });

});
