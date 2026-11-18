import { startChargerServer } from "./chargerServer";
import { connectToMQTTBroker } from "./mqttClient";
import { startCommandListener } from "./commands";

console.log("Bridge starting...");

// Settings from outside (environment variables), with defaults so "npm start" works with no setup.
// Using 127.0.0.1 instead of localhost: localhost gave an empty error message when the broker was down
const port = Number(process.env.PORT ?? "9000");
const mqttUrl = process.env.MQTT_URL ?? "mqtt://127.0.0.1:1883";

const mqttClient = connectToMQTTBroker(mqttUrl);
// Part 1 of the case: chargers connect here (charger to MQTT)
const chargers = startChargerServer(port, mqttClient);
// Part 2 of the case: commands from MQTT to chargers. Needs the phone book to find each charger
startCommandListener(mqttClient, chargers);