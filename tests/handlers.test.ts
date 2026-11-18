import { describe, it, expect, jest } from "@jest/globals";
import { WebSocket } from "ws";
import { MqttClient } from "mqtt";
import { handleCall } from "../src/handlers";
import { Call } from "../src/frames";

// Fakes instead of a real charger and broker: they only remember what was sent and published
function setup() {
    const sendToCharger = jest.fn<(data: string) => void>();
    const publishToMQTT = jest.fn<(topic: string, message: string, options: object) => void>();
    const socket = { send: sendToCharger } as unknown as WebSocket;
    const mqttClient = { publish: publishToMQTT } as unknown as MqttClient;
    return { sendToCharger, publishToMQTT, socket, mqttClient };
}

// Builds a CALL from the charger, as parseFrame would hand it over
function call(action: string, payload: Record<string, unknown>): Call {
    return { type: "CALL", messageId: "m1", action, payload };
}

// The reply the charger got, turned back into an array
function reply(fakes: ReturnType<typeof setup>) {
    return JSON.parse(fakes.sendToCharger.mock.calls[0][0]);
}

describe("handleCall", () => {
    it("BootNotification: replies Accepted and publishes the info, retained", () => {
        const fakes = setup();

        handleCall("boot1", call("BootNotification", { chargePointVendor: "ABB", chargePointModel: "Terra AC" }), fakes.socket, fakes.mqttClient);

        const [kind, messageId, payload] = reply(fakes);
        expect(kind).toBe(3);
        expect(messageId).toBe("m1");
        expect(payload.status).toBe("Accepted");
        expect(payload.interval).toBe(300);
        expect(typeof payload.currentTime).toBe("string");

        expect(fakes.publishToMQTT).toHaveBeenCalledTimes(1);
        const [topic, message, options] = fakes.publishToMQTT.mock.calls[0];
        expect(topic).toBe("chargers/boot1/info");
        expect(JSON.parse(message)).toStrictEqual({ vendor: "ABB", model: "Terra AC" });
        expect(options).toStrictEqual({ retain: true, qos: 1 });
    });

    it("BootNotification with a missing field: FormationViolation, nothing published", () => {
        const fakes = setup();

        handleCall("boot2", call("BootNotification", { chargePointVendor: "ABB" }), fakes.socket, fakes.mqttClient);

        const [kind, messageId, errorCode] = reply(fakes);
        expect(kind).toBe(4);
        expect(messageId).toBe("m1");
        expect(errorCode).toBe("FormationViolation");
        expect(fakes.publishToMQTT).not.toHaveBeenCalled();
    });

    it("Heartbeat: replies with the current time, publishes nothing", () => {
        const fakes = setup();

        handleCall("hb1", call("Heartbeat", {}), fakes.socket, fakes.mqttClient);

        const [kind, , payload] = reply(fakes);
        expect(kind).toBe(3);
        expect(typeof payload.currentTime).toBe("string");
        expect(fakes.publishToMQTT).not.toHaveBeenCalled();
    });

    it("StatusNotification: publishes only when status or errorCode changed", () => {
        const fakes = setup();
        const status = (s: string, e: string) => call("StatusNotification", { connectorId: 1, status: s, errorCode: e });

        handleCall("status1", status("Available", "NoError"), fakes.socket, fakes.mqttClient);
        handleCall("status1", status("Available", "NoError"), fakes.socket, fakes.mqttClient);
        handleCall("status1", status("Available", "GroundFailure"), fakes.socket, fakes.mqttClient);

        // The charger always gets a reply, but only two of the three are new
        expect(fakes.sendToCharger).toHaveBeenCalledTimes(3);
        expect(fakes.publishToMQTT).toHaveBeenCalledTimes(2);
        const [topic, message, options] = fakes.publishToMQTT.mock.calls[1];
        expect(topic).toBe("chargers/status1/connectors/1/status");
        expect(JSON.parse(message).errorCode).toBe("GroundFailure");
        expect(options).toStrictEqual({ retain: true, qos: 1 });
    });

    it("StatusNotification with an unknown status: FormationViolation, nothing published", () => {
        const fakes = setup();

        handleCall("status2", call("StatusNotification", { connectorId: 1, status: "Dancing", errorCode: "NoError" }), fakes.socket, fakes.mqttClient);

        expect(reply(fakes)[2]).toBe("FormationViolation");
        expect(fakes.publishToMQTT).not.toHaveBeenCalled();
    });

    it("MeterValues: one message per entry, not retained", () => {
        const fakes = setup();

        handleCall("meter1", call("MeterValues", {
            connectorId: 1,
            meterValue: [
                { timestamp: "2026-11-13T10:17:00Z", sampledValue: [{ value: "100" }] },
                { timestamp: "2026-11-13T10:18:00Z", sampledValue: [{ value: "200" }] },
            ],
        }), fakes.socket, fakes.mqttClient);

        expect(reply(fakes)).toStrictEqual([3, "m1", {}]);
        expect(fakes.publishToMQTT).toHaveBeenCalledTimes(2);
        const [topic, message, options] = fakes.publishToMQTT.mock.calls[1];
        expect(topic).toBe("chargers/meter1/connectors/1/meter");
        expect(JSON.parse(message)).toStrictEqual({ timestamp: "2026-11-13T10:18:00Z", energyWh: 200 });
        expect(options).toStrictEqual({ retain: false, qos: 1 });
    });

    it("MeterValues with a broken structure: FormationViolation, nothing published", () => {
        const fakes = setup();

        handleCall("meter2", call("MeterValues", { connectorId: 1 }), fakes.socket, fakes.mqttClient);

        expect(reply(fakes)[2]).toBe("FormationViolation");
        expect(fakes.publishToMQTT).not.toHaveBeenCalled();
    });

    it("unknown action: NotImplemented, nothing published", () => {
        const fakes = setup();

        handleCall("x1", call("Dance", {}), fakes.socket, fakes.mqttClient);

        expect(reply(fakes)[2]).toBe("NotImplemented");
        expect(fakes.publishToMQTT).not.toHaveBeenCalled();
    });
});
