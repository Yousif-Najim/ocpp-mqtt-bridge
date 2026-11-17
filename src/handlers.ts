import { WebSocket } from "ws";
import { Call, buildCallResult, buildCallError } from "./frames";
import { MqttClient } from "mqtt";

export function handleCall(chargerID: string, call: Call, socket: WebSocket, mqttClient: MqttClient) {
    switch (call.action) {
        case "Heartbeat":
            socket.send(buildCallResult(call.messageId, { currentTime: new Date().toISOString() }));
            return;

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
        
        default:
            socket.send(buildCallError(call.messageId, "NotImplemented", `Action ${call.action} is not implemented`, {}));
            return;
    }
}
