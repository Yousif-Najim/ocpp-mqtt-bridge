import { startChargerServer } from "./chargerServer";
import { connectToMQTTBroker } from "./mqttClient";
import { startCommandListener } from "./commands";

console.log("Bridge starting...");

// 127.0.0.1 instead of localhost: localhost gave an empty error message when the broker was down
const mqttClient = connectToMQTTBroker("mqtt://127.0.0.1:1883");
// Part 1 of the case: chargers connect here (charger to MQTT)
const chargers = startChargerServer(9000, mqttClient);
// Part 2 of the case: commands from MQTT to chargers. Needs the phone book to find each charger
startCommandListener(mqttClient, chargers);