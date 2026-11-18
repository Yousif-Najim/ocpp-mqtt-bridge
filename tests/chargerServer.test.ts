import { describe, it, expect } from "@jest/globals";
import { parseChargerId } from "../src/chargerServer";

describe("parseChargerId", () => {
    it("takes the charger ID from the URL path", () => {
        expect(parseChargerId("/charger1")).toBe("charger1");
    });

    it("ignores a query string", () => {
        expect(parseChargerId("/charger1?token=abc")).toBe("charger1");
    });

    it("decodes %-encoded characters", () => {
        expect(parseChargerId("/charger%201")).toBe("charger 1");
    });

    it("rejects a missing ID", () => {
        expect(parseChargerId("/")).toBeNull();
        expect(parseChargerId(undefined)).toBeNull();
    });

    it("rejects IDs that would break MQTT topics (/ + #)", () => {
        expect(parseChargerId("/cp/1")).toBeNull();
        expect(parseChargerId("/cp+1")).toBeNull();
        expect(parseChargerId("/cp%231")).toBeNull();
        expect(parseChargerId("/cp%2F1")).toBeNull();
    });

    it("rejects broken %-encoding", () => {
        expect(parseChargerId("/cp%E0%A4%A")).toBeNull();
    });
});
