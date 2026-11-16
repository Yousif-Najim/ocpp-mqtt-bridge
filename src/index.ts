import { startChargerServer } from "./chargerServer";
import { connectToMQTTBroker } from "./mqttClient";

console.log("Bridge starting...");

connectToMQTTBroker("mqtt://127.0.0.1:1883");
startChargerServer(9000);