module.exports = {
    testEnvironment: "node",
    // Hide the bridge's expected warnings during tests; run "npx jest --silent=false" to see them
    silent: true,
    transform: {
        "^.+\\.ts$": "@swc/jest",
    },
};
