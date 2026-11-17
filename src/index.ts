import { startChargerServer } from "./chargerServer";
import { connectToMQTTBroker } from "./mqttClient";
import { startCommandListener } from "./commands";

console.log("Bridge starting...");

const mqttClient = connectToMQTTBroker("mqtt://127.0.0.1:1883");
const chargers = startChargerServer(9000, mqttClient);
startCommandListener(mqttClient, chargers);