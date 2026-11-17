import { describe, it, expect } from "@jest/globals";
import { parseFrame, buildCallResult, buildCallError } from "../src/frames";

describe("parseFrame", () => {
    it("turns a valid CALL into a typed package", () => {
        expect(parseFrame('[2,"1","Heartbeat",{}]')).toStrictEqual({
            type: "CALL",
            messageId: "1",
            action: "Heartbeat",
            payload: {},
        });
    });

    it("rejects broken JSON", () => {
        expect(parseFrame('[2,"1","Heartbeat",{}]]')).toBeNull();
    });

    it("rejects a CALL with missing fields", () => {
        expect(parseFrame('[2,"1","Heartbeat"]')).toBeNull();
    });

    it("rejects a CALL with wrong types", () => {
        expect(parseFrame('[2,1,"Heartbeat",{}]')).toBeNull();
        expect(parseFrame('[2,"1",{},{}]')).toBeNull();
        expect(parseFrame('[2,"1","Heartbeat",[]]')).toBeNull();
    });

    it("turns a valid CALLRESULT into a typed package", () => {
        expect(parseFrame('[3,"1",{"currentTime":"2024-06-01T12:00:00Z"}]')).toStrictEqual({
            type: "CALLRESULT",
            messageId: "1",
            payload: { currentTime: "2024-06-01T12:00:00Z" },
        });
    });

    it("turns a valid CALLERROR into a typed package", () => {
        expect(parseFrame('[4,"1","InternalError","An error occurred",{}]')).toStrictEqual({
            type: "CALLERROR",
            messageId: "1",
            errorCode: "InternalError",
            errorDescription: "An error occurred",
            errorDetails: {},
        });
    });

    it("rejects a CALLERROR with missing fields", () => {
        expect(parseFrame('[4,"1","InternalError","An error occurred"]')).toBeNull();
    });

    it("rejects a CALLERROR with wrong types", () => {
        expect(parseFrame('[4,1,"InternalError","An error occurred",{}]')).toBeNull();
        expect(parseFrame('[4,"1",{},"An error occurred",{}]')).toBeNull();
        expect(parseFrame('[4,"1","InternalError",{},{}]')).toBeNull();
    });

    it("rejects a CALLRESULT with wrong types", () => {
        expect(parseFrame('[3,1,{"currentTime":"2024-06-01T12:00:00Z"}]')).toBeNull();
        expect(parseFrame('[3,"1",[]]')).toBeNull();
    });

    it("rejects the kind as text instead of a number", () => {
        expect(parseFrame('["2","1","Heartbeat",{}]')).toBeNull();
    });

    it("rejects a CALL with extra parts", () => {
        expect(parseFrame('[2,"1","Heartbeat",{},"junk"]')).toBeNull();
    });

    it("rejects a CALL with only 3 parts, even though 3 fits a CALLRESULT", () => {
        expect(parseFrame('[2,"1",{}]')).toBeNull();
    });

    it("rejects things that are not a list or have an unknown kind", () => {
        expect(parseFrame('{"a":1}')).toBeNull();
        expect(parseFrame('[5,"1",{}]')).toBeNull();
        expect(parseFrame("hello")).toBeNull();
    });
});

describe("building replies", () => {
    it("builds a CALLRESULT", () => {
        expect(buildCallResult("1", { status: "Accepted" })).toBe('[3,"1",{"status":"Accepted"}]');
    });

    it("builds a CALLERROR", () => {
        expect(buildCallError("2", "NotImplemented", "Unknown action", {})).toBe('[4,"2","NotImplemented","Unknown action",{}]');
    });
});
