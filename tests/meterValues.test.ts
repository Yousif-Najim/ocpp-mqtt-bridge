import { describe, it, expect } from "@jest/globals";
import { parseNumber, parseMeterValue, parseMeterValues } from "../src/meterValues";

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

describe("parseMeterValue", () => {
    it("translates the case's example", () => {
        const result = parseMeterValue("charger1", "2026-11-13T10:15:00Z", 42, [
            { value: "7360", measurand: "Power.Active.Import", unit: "W" },
            { value: "12.5", measurand: "Energy.Active.Import.Register", unit: "kWh" },
            { value: "16.0", measurand: "Current.Import", phase: "L1", unit: "A" },
            { value: "16.1", measurand: "Current.Import", phase: "L2", unit: "A" },
            { value: "15.9", measurand: "Current.Import", phase: "L3", unit: "A" },
        ]);

        expect(result).toStrictEqual({
            timestamp: "2026-11-13T10:15:00Z",
            transactionId: 42,
            powerW: 7360,
            energyWh: 12500,
            currentA: { L1: 16, L2: 16.1, L3: 15.9 },
        });
    });

    it("uses the defaults and leaves out what is missing", () => {
        const result = parseMeterValue("charger1", "2026-11-13T10:15:00Z", undefined, [
            { value: "500" },
        ]);
        expect(result).toStrictEqual({ timestamp: "2026-11-13T10:15:00Z", energyWh: 500 });
    });

    it("converts kW to W", () => {
        const result = parseMeterValue("charger1", "2026-11-13T10:15:00Z", undefined, [
            { value: "7.4", measurand: "Power.Active.Import", unit: "kW" },
        ]);
        expect(result).toStrictEqual({ timestamp: "2026-11-13T10:15:00Z", powerW: 7400 });
    });

    it("skips a bad value but keeps the rest", () => {
        const result = parseMeterValue("charger1", "2026-11-13T10:15:00Z", undefined, [
            "garbage",
            { value: "abc", measurand: "Power.Active.Import" },
            { value: "12600" },
        ]);
        expect(result).toStrictEqual({ timestamp: "2026-11-13T10:15:00Z", energyWh: 12600 });
    });

    it("ignores other measurands, unknown units and current without a phase", () => {
        const result = parseMeterValue("charger1", "2026-11-13T10:15:00Z", undefined, [
            { value: "230", measurand: "Voltage", unit: "V" },
            { value: "3", unit: "MJ" },
            { value: "7", measurand: "Power.Active.Import", unit: "hp" },
            { value: "16", measurand: "Current.Import", unit: "mA", phase: "L1" },
            { value: "16", measurand: "Current.Import" },
        ]);
        expect(result).toStrictEqual({ timestamp: "2026-11-13T10:15:00Z" });
    });

    it("defaults power to W when the unit is missing", () => {
        const result = parseMeterValue("charger1", "2026-11-13T10:15:00Z", undefined, [
            { value: "7360", measurand: "Power.Active.Import" },
        ]);
        expect(result).toStrictEqual({ timestamp: "2026-11-13T10:15:00Z", powerW: 7360 });
    });

});

describe("parseMeterValues", () => {
    it("translates every entry and returns the connector", () => {
        const result = parseMeterValues("charger1", {
            connectorId: 1,
            transactionId: 42,
            meterValue: [
                { timestamp: "2026-11-13T10:17:00Z", sampledValue: [{ value: "100" }] },
                { timestamp: "2026-11-13T10:18:00Z", sampledValue: [{ value: "200" }] },
            ],
        });
        expect(result).toStrictEqual({
            connectorId: 1,
            readings: [
                { timestamp: "2026-11-13T10:17:00Z", transactionId: 42, energyWh: 100 },
                { timestamp: "2026-11-13T10:18:00Z", transactionId: 42, energyWh: 200 },
            ],
        });
    });

    it("rejects a bad connectorId", () => {
        const meterValue = [{ timestamp: "2026-11-13T10:17:00Z", sampledValue: [] }];
        expect(parseMeterValues("charger1", { meterValue })).toBeNull();
        expect(parseMeterValues("charger1", { connectorId: "1", meterValue })).toBeNull();
        expect(parseMeterValues("charger1", { connectorId: -1, meterValue })).toBeNull();
        expect(parseMeterValues("charger1", { connectorId: 1.5, meterValue })).toBeNull();
    });

    it("rejects a bad transactionId", () => {
        const meterValue = [{ timestamp: "2026-11-13T10:17:00Z", sampledValue: [] }];
        expect(parseMeterValues("charger1", { connectorId: 1, transactionId: "42", meterValue })).toBeNull();
        expect(parseMeterValues("charger1", { connectorId: 1, transactionId: 4.2, meterValue })).toBeNull();
    });

    it("rejects a missing or empty meterValue list", () => {
        expect(parseMeterValues("charger1", { connectorId: 1 })).toBeNull();
        expect(parseMeterValues("charger1", { connectorId: 1, meterValue: [] })).toBeNull();
        expect(parseMeterValues("charger1", { connectorId: 1, meterValue: "hello" })).toBeNull();
    });

    it("rejects the whole payload if one entry is broken", () => {
        const good = { timestamp: "2026-11-13T10:17:00Z", sampledValue: [{ value: "100" }] };
        expect(parseMeterValues("charger1", { connectorId: 1, meterValue: [good, { sampledValue: [] }] })).toBeNull();
        expect(parseMeterValues("charger1", { connectorId: 1, meterValue: [good, { timestamp: "2026-11-13T10:18:00Z", sampledValue: "oops" }] })).toBeNull();
        expect(parseMeterValues("charger1", { connectorId: 1, meterValue: [good, "garbage"] })).toBeNull();
    });
});
