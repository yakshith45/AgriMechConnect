function configuredNumber(environmentVariable, fallback) {
    const value = process.env[environmentVariable];
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`${environmentVariable} must be a finite number`);
    }
    return parsed;
}

const SULLIA_CENTER = {
    latitude: configuredNumber("SULLIA_CENTER_LATITUDE", 12.561),
    longitude: configuredNumber("SULLIA_CENTER_LONGITUDE", 75.387)
};
const LOCATION_RADIUS_KM = configuredNumber("FARM_LOCATION_RADIUS_KM", 25);

if (
    SULLIA_CENTER.latitude < -90 ||
    SULLIA_CENTER.latitude > 90 ||
    SULLIA_CENTER.longitude < -180 ||
    SULLIA_CENTER.longitude > 180 ||
    LOCATION_RADIUS_KM <= 0
) {
    throw new Error("Sullia location center and radius configuration are invalid");
}

function distanceFromSulliaKm(latitude, longitude) {
    const radians = value => value * Math.PI / 180;
    const latitudeDelta = radians(latitude - SULLIA_CENTER.latitude);
    const longitudeDelta = radians(longitude - SULLIA_CENTER.longitude);
    const centralAngle = 2 * Math.asin(Math.sqrt(
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(radians(SULLIA_CENTER.latitude)) *
        Math.cos(radians(latitude)) *
        Math.sin(longitudeDelta / 2) ** 2
    ));
    return 6371 * centralAngle;
}

function isWithinLocationRadius(latitude, longitude) {
    return distanceFromSulliaKm(latitude, longitude) <= LOCATION_RADIUS_KM;
}

module.exports = {
    SULLIA_CENTER,
    LOCATION_RADIUS_KM,
    distanceFromSulliaKm,
    isWithinLocationRadius
};
