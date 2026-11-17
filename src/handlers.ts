import { WebSocket } from "ws";
import { Call, buildCallResult, buildCallError } from "./frames";
import { MqttClient } from "mqtt";
import { parseMeterValues } from "./meterValues";

// The status values allowed by the case
const VALID_STATUSES = [
    "Available", "Preparing", "Charging", "SuspendedEV",
    "SuspendedEVSE", "Finishing", "Faulted", "Unavailable",
];

// Last status per connector. Lives outside handleCall so it is remembered between messages.
// Key = charger + connector, because every charger has a connector 1
const lastStatuses = new Map<string, { status: string; errorCode: string }>();

export function handleCall(chargerID: string, call: Call, socket: WebSocket, mqttClient: MqttClient) {
    switch (call.action) {
        case "BootNotification": {
            const vendor = call.payload.chargePointVendor;
            const model = call.payload.chargePointModel;

            // Case: known action with an invalid payload: FormationViolation, publish nothing.
            // No defaults here: a missing field is an error
            if (typeof vendor !== "string" || typeof model !== "string") {
                socket.send(buildCallError(call.messageId, "FormationViolation", "chargePointVendor and chargePointModel must be strings", {}));
                return;
            }

            socket.send(buildCallResult(call.messageId, {
                status: "Accepted",
                currentTime: new Date().toISOString(),
                interval: 300,
            }));

            // Retained so services that start later still see the info; QoS 1: must not get lost, a duplicate is harmless
            mqttClient.publish(
                `chargers/${chargerID}/info`,
                JSON.stringify({ vendor, model }),
                { retain: true, qos: 1 }
            );
            return;            
        }

        case "Heartbeat":
            socket.send(buildCallResult(call.messageId, { currentTime: new Date().toISOString() }));
            return;
        
        case "StatusNotification": {
            const connectorId = call.payload.connectorId;
            const status = call.payload.status;
            const errorCode = call.payload.errorCode;

            if (typeof connectorId !== "number" ||
                !Number.isInteger(connectorId) || 
                connectorId < 0 ||
                typeof status !== "string" ||
                !VALID_STATUSES.includes(status) ||
                typeof errorCode !== "string") {
                socket.send(buildCallError(call.messageId, "FormationViolation", "Invalid payload for StatusNotification", {}));
                return;
            }

            socket.send(buildCallResult(call.messageId, {}));

            const key = `${chargerID}-${connectorId}`;
            const last = lastStatuses.get(key);

            // Case: only publish when status or errorCode changed
            if (last && last.status === status && last.errorCode === errorCode) {
                console.log(`No status change for ${key}, not publishing to MQTT.`);
                return;
            }

            lastStatuses.set(key, { status, errorCode });

            mqttClient.publish(
                `chargers/${chargerID}/connectors/${connectorId}/status`,
                JSON.stringify({ status, errorCode, timestamp: new Date().toISOString() }),
                { retain: true, qos: 1 }
            );
            return;
        }

        case "MeterValues": {
            const meterValuesResult = parseMeterValues(chargerID, call.payload);
            if (!meterValuesResult) {
                socket.send(buildCallError(call.messageId, "FormationViolation", "Invalid payload for MeterValues", {}));
                return;
            }

            socket.send(buildCallResult(call.messageId, {}));

            // Case: one MQTT message per meterValue entry. Not retained: a reading is an event, not a state
            for (const reading of meterValuesResult.readings) {
                mqttClient.publish(
                    `chargers/${chargerID}/connectors/${meterValuesResult.connectorId}/meter`,
                    JSON.stringify(reading),
                    { retain: false, qos: 1 }
                );
            }

            return;
        }

        // Case: unknown action: NotImplemented
        default:
            socket.send(buildCallError(call.messageId, "NotImplemented", `Action ${call.action} is not implemented`, {}));
            return;
    }
}
