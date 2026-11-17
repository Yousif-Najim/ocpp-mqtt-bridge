import { WebSocket } from "ws";
import { Call, buildCallResult, buildCallError } from "./frames";

export function handleCall(chargerID: string, call: Call, socket: WebSocket) {
    switch (call.action) {
        case "Heartbeat":
            socket.send(buildCallResult(call.messageId, { currentTime: new Date().toISOString() }));
            return;

        default:
            socket.send(buildCallError(call.messageId, "NotImplemented", `Action ${call.action} is not implemented`, {}));
            return;
    }
}
