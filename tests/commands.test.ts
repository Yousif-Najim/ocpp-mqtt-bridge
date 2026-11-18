import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { WebSocket } from "ws";
import { MqttClient } from "mqtt";
import { handleCommandMessage, handleChargerResponse, cancelPendingCommandsForCharger } from "../src/commands";

// Fakes instead of a real broker and charger: they only remember what was published and sent
function setup() {
    const publishToMQTT = jest.fn<(topic: string, message: string, options: object) => void>();
    const sendToCharger = jest.fn<(data: string) => void>();
    const mqttClient = { publish: publishToMQTT } as unknown as MqttClient;
    const socket = { readyState: WebSocket.OPEN, send: sendToCharger } as unknown as WebSocket;
    const chargers = new Map<string, WebSocket>([["charger1", socket]]);
    return { publishToMQTT, sendToCharger, mqttClient, chargers };
}

// Sends a Reset command for charger1 and returns the messageId the charger received
function sendResetToCharger1(fakes: ReturnType<typeof setup>): string {
    handleCommandMessage(fakes.mqttClient, fakes.chargers, "chargers/charger1/cmd/Reset", '{"requestId":"r1","payload":{"type":"Soft"}}', false);
    const call = JSON.parse(fakes.sendToCharger.mock.calls[0][0]);
    return call[1];
}

// The last result that was published, turned back into an object
function lastResult(fakes: ReturnType<typeof setup>) {
    const calls = fakes.publishToMQTT.mock.calls;
    return JSON.parse(calls[calls.length - 1][1]);
}

describe("commands", () => {
    // A fake clock, so 30 seconds can pass instantly. Afterwards, ring any leftover timers
    // so no ticket stays on the board for the next test
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it("posts Offline when the charger is not connected", () => {
        const { publishToMQTT, mqttClient, chargers } = setup();

        handleCommandMessage(mqttClient, chargers, "chargers/charger2/cmd/Reset", '{"requestId":"r1","payload":{}}', false);

        expect(publishToMQTT).toHaveBeenCalledTimes(1);
        const [topic, message] = publishToMQTT.mock.calls[0];
        expect(topic).toBe("chargers/charger2/cmd/Reset/result");
        expect(JSON.parse(message)).toStrictEqual({
            requestId: "r1",
            ok: false,
            error: { code: "Offline", description: "Charger charger2 is not connected" },
        });
    });

    it("sends a CALL with a new messageId and posts ok: true when the charger answers", () => {
        const { publishToMQTT, sendToCharger, mqttClient, chargers } = setup();

        handleCommandMessage(mqttClient, chargers, "chargers/charger1/cmd/Reset", '{"requestId":"r1","payload":{"type":"Soft"}}', false);

        // The charger received [2, messageId, "Reset", payload], with a messageId we generated
        expect(sendToCharger).toHaveBeenCalledTimes(1);
        const [kind, messageId, action, payload] = JSON.parse(sendToCharger.mock.calls[0][0]);
        expect(kind).toBe(2);
        expect(action).toBe("Reset");
        expect(payload).toStrictEqual({ type: "Soft" });

        // The charger answers "yes, done" with the same messageId
        handleChargerResponse(mqttClient, "charger1", { type: "CALLRESULT", messageId, payload: { status: "Accepted" } });

        expect(publishToMQTT).toHaveBeenCalledTimes(1);
        const [topic, message] = publishToMQTT.mock.calls[0];
        expect(topic).toBe("chargers/charger1/cmd/Reset/result");
        expect(JSON.parse(message)).toStrictEqual({ requestId: "r1", ok: true, payload: { status: "Accepted" } });
    });

    it("posts ok: false with the charger's own error when it answers with CALLERROR", () => {
        const fakes = setup();
        const messageId = sendResetToCharger1(fakes);

        handleChargerResponse(fakes.mqttClient, "charger1", {
            type: "CALLERROR", messageId, errorCode: "InternalError", errorDescription: "Busy", errorDetails: {},
        });

        expect(fakes.publishToMQTT).toHaveBeenCalledTimes(1);
        expect(lastResult(fakes)).toStrictEqual({
            requestId: "r1",
            ok: false,
            error: { code: "InternalError", description: "Busy" },
        });
    });

    it("posts Timeout when the charger does not answer within 30 seconds", () => {
        const fakes = setup();
        sendResetToCharger1(fakes);

        jest.advanceTimersByTime(29_999);
        expect(fakes.publishToMQTT).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(fakes.publishToMQTT).toHaveBeenCalledTimes(1);
        expect(lastResult(fakes)).toStrictEqual({
            requestId: "r1",
            ok: false,
            error: { code: "Timeout", description: "Command Reset timed out after 30000 ms" },
        });
    });

    it("ignores an answer that arrives after the timeout, so there is exactly one result", () => {
        const fakes = setup();
        const messageId = sendResetToCharger1(fakes);

        jest.advanceTimersByTime(30_000);
        handleChargerResponse(fakes.mqttClient, "charger1", { type: "CALLRESULT", messageId, payload: {} });

        expect(fakes.publishToMQTT).toHaveBeenCalledTimes(1);
        expect(lastResult(fakes).error.code).toBe("Timeout");
    });

    it("stops the timer when the charger answers, so no Timeout follows", () => {
        const fakes = setup();
        const messageId = sendResetToCharger1(fakes);

        handleChargerResponse(fakes.mqttClient, "charger1", { type: "CALLRESULT", messageId, payload: {} });
        jest.advanceTimersByTime(30_000);

        expect(fakes.publishToMQTT).toHaveBeenCalledTimes(1);
        expect(lastResult(fakes).ok).toBe(true);
    });

    it("posts Offline for every open command when the charger disconnects", () => {
        const fakes = setup();
        handleCommandMessage(fakes.mqttClient, fakes.chargers, "chargers/charger1/cmd/Reset", '{"requestId":"r1","payload":{}}', false);
        handleCommandMessage(fakes.mqttClient, fakes.chargers, "chargers/charger1/cmd/UnlockConnector", '{"requestId":"r2","payload":{}}', false);

        cancelPendingCommandsForCharger(fakes.mqttClient, "charger1");

        expect(fakes.publishToMQTT).toHaveBeenCalledTimes(2);
        const [topic1, message1] = fakes.publishToMQTT.mock.calls[0];
        expect(topic1).toBe("chargers/charger1/cmd/Reset/result");
        expect(JSON.parse(message1)).toStrictEqual({
            requestId: "r1",
            ok: false,
            error: { code: "Offline", description: "Charger charger1 disconnected before responding to command Reset" },
        });
        const [topic2, message2] = fakes.publishToMQTT.mock.calls[1];
        expect(topic2).toBe("chargers/charger1/cmd/UnlockConnector/result");
        expect(JSON.parse(message2).error.code).toBe("Offline");

        // The timers were stopped, so no Timeout follows
        jest.advanceTimersByTime(30_000);
        expect(fakes.publishToMQTT).toHaveBeenCalledTimes(2);
    });

    it("leaves other chargers' commands alone when one charger disconnects", () => {
        const fakes = setup();
        const charger2 = { readyState: WebSocket.OPEN, send: jest.fn() } as unknown as WebSocket;
        fakes.chargers.set("charger2", charger2);
        handleCommandMessage(fakes.mqttClient, fakes.chargers, "chargers/charger2/cmd/Reset", '{"requestId":"r2","payload":{}}', false);

        cancelPendingCommandsForCharger(fakes.mqttClient, "charger1");
        expect(fakes.publishToMQTT).not.toHaveBeenCalled();

        // charger2's command is still waiting, and times out normally on charger2's own topic
        jest.advanceTimersByTime(30_000);
        expect(fakes.publishToMQTT).toHaveBeenCalledTimes(1);
        const [topic] = fakes.publishToMQTT.mock.calls[0];
        expect(topic).toBe("chargers/charger2/cmd/Reset/result");
        expect(lastResult(fakes).error.code).toBe("Timeout");
    });

    it("ignores a retained command: nothing is sent and no result is posted", () => {
        const fakes = setup();

        handleCommandMessage(fakes.mqttClient, fakes.chargers, "chargers/charger1/cmd/Reset", '{"requestId":"r1","payload":{}}', true);

        expect(fakes.sendToCharger).not.toHaveBeenCalled();
        expect(fakes.publishToMQTT).not.toHaveBeenCalled();
    });

    it("drops an invalid command: nothing is sent and no result is posted", () => {
        const fakes = setup();
        const topic = "chargers/charger1/cmd/Reset";

        handleCommandMessage(fakes.mqttClient, fakes.chargers, topic, "hello", false);
        handleCommandMessage(fakes.mqttClient, fakes.chargers, topic, '{"payload":{}}', false);
        handleCommandMessage(fakes.mqttClient, fakes.chargers, topic, '{"requestId":"r1","payload":"oops"}', false);

        expect(fakes.sendToCharger).not.toHaveBeenCalled();
        expect(fakes.publishToMQTT).not.toHaveBeenCalled();
    });

    it("ignores topics that are not exactly chargers/{id}/cmd/{action}, like our own results", () => {
        const fakes = setup();

        handleCommandMessage(fakes.mqttClient, fakes.chargers, "chargers/charger1/cmd/Reset/result", '{"requestId":"r1","payload":{}}', false);

        expect(fakes.sendToCharger).not.toHaveBeenCalled();
        expect(fakes.publishToMQTT).not.toHaveBeenCalled();
    });

});
