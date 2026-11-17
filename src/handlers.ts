import { WebSocket } from "ws";
import { Call, buildCallResult, buildCallError } from "./frames";
import { MqttClient } from "mqtt";

const VALID_STATUSES = [
    "Available", "Preparing", "Charging", "SuspendedEV",
    "SuspendedEVSE", "Finishing", "Faulted", "Unavailable",
];

const lastStatuses = new Map<string, { status: string; errorCode: string }>();

export function handleCall(chargerID: string, call: Call, socket: WebSocket, mqttClient: MqttClient) {
    switch (call.action) {
        case "BootNotification": {
            const vendor = call.payload.chargePointVendor;
            const model = call.payload.chargePointModel;

            if (typeof vendor !== "string" || typeof model !== "string") {
                socket.send(buildCallError(call.messageId, "FormationViolation", "chargePointVendor and chargePointModel must be strings", {}));
                return;
            }

            socket.send(buildCallResult(call.messageId, {
                status: "Accepted",
                currentTime: new Date().toISOString(),
                interval: 300,
            }));

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

        default:
            socket.send(buildCallError(call.messageId, "NotImplemented", `Action ${call.action} is not implemented`, {}));
            return;
    }
}
