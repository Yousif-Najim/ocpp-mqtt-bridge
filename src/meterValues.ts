import { isObject } from "./frames";

const ENERGY = "Energy.Active.Import.Register";
const POWER = "Power.Active.Import";
const CURRENT = "Current.Import";

export type MeterValue = {
    timestamp: string;
    transactionId?: number;
    powerW?: number;
    energyWh?: number;
    currentA?: Record<string, number>;
};

export type MeterValuesResult = {
    connectorId: number;
    readings: MeterValue[];
};

export function parseNumber(value: unknown): number | null {
    if (typeof value !== "string" || value.trim() === "") {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function parseMeterValue(
    chargerID: string,
    timestamp: string,
    transactionID: number | undefined,
    sampledValues: unknown[]
): MeterValue {
    const reading: MeterValue = { timestamp };
    
    if (transactionID !== undefined) {
        reading.transactionId = transactionID;
    }

    for (const sampledValue of sampledValues) {
        if (!isObject(sampledValue)) {
            console.warn(`Invalid sampled value for charger ${chargerID}:`, sampledValue);
            continue;
        }

        const value = parseNumber(sampledValue.value);
        if (value === null) {
            console.warn(`Invalid numeric value in sampled value for charger ${chargerID}:`, sampledValue.value);
            continue;
        }

        const measurand = sampledValue.measurand ?? ENERGY;

        switch (measurand) {
            case ENERGY: {
                const unit = sampledValue.unit ?? "Wh";
                if (unit === "Wh") {
                    reading.energyWh = value;
                } else if (unit === "kWh") {
                    reading.energyWh = value * 1000;
                } else {
                    console.warn(`Unsupported unit for energy in charger ${chargerID}:`, unit);
                }
                break;
            }
            case POWER: {
                const unit = sampledValue.unit ?? "W";
                if (unit === "W") {
                    reading.powerW = value;
                } else if (unit === "kW") {
                    reading.powerW = value * 1000;
                } else {
                    console.warn(`Unsupported unit for power in charger ${chargerID}:`, unit);
                }
                break;
            }
            case CURRENT: {
                const unit = sampledValue.unit ?? "A";
                const phase = sampledValue.phase;
                if (unit !== "A") {
                    console.warn(`Unsupported unit for current in charger ${chargerID}:`, unit);
                } else if (typeof phase !== "string") {
                    console.warn(`Phase is missing or invalid for current in charger ${chargerID}:`, phase);
                } else {
                    if (reading.currentA === undefined) {
                        reading.currentA = {};
                    }
                    reading.currentA[phase] = value;
                }
                break;
            }
        }
    }
    return reading;
}

export function parseMeterValues(
    chargerID: string,
    payload: Record<string, unknown>
): MeterValuesResult | null {
    const connectorId = payload.connectorId;
    if (typeof connectorId !== "number" || !Number.isInteger(connectorId) || connectorId < 0) {
        console.error(`Invalid connectorId in meter values for charger ${chargerID}:`, connectorId);
        return null;
    }

    const transactionId = payload.transactionId;
    if (transactionId !== undefined && (typeof transactionId !== "number" || !Number.isInteger(transactionId) || transactionId < 0)) {
        console.error(`Invalid transactionId in meter values for charger ${chargerID}:`, transactionId);
        return null;
    }

    const meterValue = payload.meterValue;
    if (!Array.isArray(meterValue) || meterValue.length === 0) {
        console.error(`Invalid meterValue in meter values for charger ${chargerID}:`, meterValue);
        return null;
    }
    
    const entries: unknown[] = meterValue;
    const readings: MeterValue[] = [];

    for (const entry of entries) {
        if (!isObject(entry) || typeof entry.timestamp !== "string" || !Array.isArray(entry.sampledValue)) {
            console.error(`Invalid sampled value entry in meter values for charger ${chargerID}:`, entry);
            return null;
        }
        const reading = parseMeterValue(chargerID, entry.timestamp, transactionId, entry.sampledValue);
        readings.push(reading);
    }

    return { connectorId, readings };
}
