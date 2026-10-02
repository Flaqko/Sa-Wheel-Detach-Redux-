// Wheel Detach Redux v1.0
// Original Wheel Detach by Junior_Djjr / Valdir da Costa Junior (MIT)
// CLEO Redux port/remaster by Flaqko
// Target: GTA San Andreas Classic 1.0 US + CLEO Redux x86
//
// v1.0 stability design:
// - NO full vehicle-pool scan.
// - Automatic processing is limited to CJ's current Automobile/Quad.
// - Proven SpawnFlyingComponent + wheel-hide pipeline from v0.2 retained.
// - Original collision/landing thresholds restored.
// - WDET diagnostic cheat retained as a manual fallback.

const FUNC_FIND_PLAYER_VEHICLE = 0x56E0D0;
const FUNC_SPAWN_FLYING_COMPONENT = 0x6A8580;

const ADDR_GAME_TIME_MS = 0xB7CB84;

const MODEL_RHINO = 432;
const VEHICLE_AUTOMOBILE = 0;
const VEHICLE_QUAD = 2;

// Verified GTA SA 1.0 structure offsets (plugin-sdk).
const OFF_MODEL_INDEX = 0x22;
const OFF_MOVE_SPEED_Z = 0x4C;
const OFF_DAMAGE_INTENSITY = 0xD8;
const OFF_LAST_COLLISION_POS = 0xEC;
const OFF_HANDLING_PTR = 0x384;
const OFF_HEALTH = 0x4C0;
const OFF_VEHICLE_SUBCLASS = 0x594;
const OFF_DAMAGE_MANAGER = 0x5A0;
const OFF_WHEEL_STATUS = OFF_DAMAGE_MANAGER + 0x5;
const OFF_CAR_NODES = 0x648;
const OFF_SUSPENSION_PREV = 0x7E4;
const OFF_NUM_CONTACT_WHEELS = 0x960;

const OFF_HANDLING_COLLISION_MULT = 0xC8;
const OFF_HANDLING_MODEL_FLAGS = 0xCC;
const MODELFLAG_DOUBLE_REAR_WHEELS = 0x20000000;

// RenderWare SA 32-bit RwFrame offsets.
const OFF_FRAME_LTM_POS = 0x80;
const OFF_FRAME_OBJECT_LIST = 0x90;
const OFF_FRAME_CHILD = 0x98;
const OFF_FRAME_NEXT = 0x9C;

// CVehicle::BurstTyre virtual slot in SA 1.0.
const VTABLE_BURST_TYRE = 44;

const WHEELS = [
    { id: 0, node: 5, rear: false, name: "LF" },
    { id: 1, node: 7, rear: true,  name: "LB" },
    { id: 2, node: 2, rear: false, name: "RF" },
    { id: 3, node: 4, rear: true,  name: "RB" },
];

// Original source scans nodes 2..7. We intentionally only consider the four
// actual wheel nodes, avoiding the original's possible wheelId=-1 path.
const COLLISION_WHEELS = [
    { id: 2, node: 2, rear: false, name: "RF" },
    { id: 3, node: 4, rear: true,  name: "RB" },
    { id: 0, node: 5, rear: false, name: "LF" },
    { id: 1, node: 7, rear: true,  name: "LB" },
];

const INI_PATH = __dirname + "\\WheelDetachRedux.ini";

function iniInt(section, key, fallback) {
    try {
        const v = IniFile.ReadInt(INI_PATH, section, key);
        return v === undefined ? fallback : v;
    } catch (e) { return fallback; }
}

function iniFloat(section, key, fallback) {
    try {
        const v = IniFile.ReadFloat(INI_PATH, section, key);
        return v === undefined ? fallback : v;
    } catch (e) { return fallback; }
}

function iniString(section, key, fallback) {
    try {
        const v = IniFile.ReadString(INI_PATH, section, key);
        return (!v || v.length === 0) ? fallback : v;
    } catch (e) { return fallback; }
}

const cfg = {
    enabled: iniInt("Module", "Enabled", 1) !== 0,
    debug: iniInt("Module", "Debug", 0) !== 0,
    autoCollision: iniInt("Module", "AutomaticCollision", 1) !== 0,
    autoLanding: iniInt("Module", "AutomaticLanding", 1) !== 0,
    minIntensity: iniFloat("Limits", "MinIntensity", 300.0),
    maxHealth: iniFloat("Limits", "MaxHealth", 700.0),
    radius: iniFloat("Limits", "Radius", 1.3),
    randomChanceToBurst: iniInt("Limits", "RandomChanceToBurst", 10),
    minFallSpeed: iniFloat("Limits", "MinFallSpeed", 0.5),
    suspCompressBurst: iniFloat("Limits", "SuspCompressBurst", 0.1),
    suspCompressDetach: iniFloat("Limits", "SuspCompressDetach", 0.01),
    testCheat: iniString("Diagnostic", "TestCheat", "WDET"),
};

cfg.radius = Math.max(0.05, Math.min(cfg.radius, 3.0));
cfg.randomChanceToBurst = Math.max(0, Math.min(cfg.randomChanceToBurst, 100));
cfg.minFallSpeed = Math.max(0.0, cfg.minFallSpeed);

function dlog(...args) {
    if (cfg.debug) log("[WheelDetachRedux v1.0]", ...args);
}

function hex(v) {
    return "0x" + Memory.ToU32(v).toString(16).toUpperCase();
}

function readPtr(addr) {
    return Memory.ReadU32(addr, false);
}

function gameTimeMs() {
    return Memory.ReadU32(ADDR_GAME_TIME_MS, false);
}

function getPlayerVehicle() {
    return Memory.Fn.CdeclU32(FUNC_FIND_PLAYER_VEHICLE)(0, 0);
}

function getNodeFrame(vehicle, node) {
    return readPtr(vehicle + OFF_CAR_NODES + node * 4);
}

function getWheelStatus(vehicle, id) {
    return Memory.ReadU8(vehicle + OFF_WHEEL_STATUS + id, false);
}

function setWheelStatus(vehicle, id, status) {
    Memory.WriteU8(vehicle + OFF_WHEEL_STATUS + id, status, false);
}

function isNotLastWheel(vehicle, wheelId) {
    for (let i = 0; i < 4; i++) {
        if (i !== wheelId && getWheelStatus(vehicle, i) !== 2) return true;
    }
    return false;
}

function hasDoubleRearWheels(vehicle) {
    const handling = readPtr(vehicle + OFF_HANDLING_PTR);
    if (!handling) return false;
    const flags = Memory.ReadU32(handling + OFF_HANDLING_MODEL_FLAGS, false);
    return (flags & MODELFLAG_DOUBLE_REAR_WHEELS) !== 0;
}

function burstTyre(vehicle, wheelId, reason) {
    const vtable = readPtr(vehicle);
    if (!vtable) return false;
    const fn = readPtr(vtable + VTABLE_BURST_TYRE * 4);
    if (!fn) return false;

    dlog("BURST call", reason, "wheelId=" + wheelId, "fn=" + hex(fn));
    const result = Memory.CallMethodReturn(fn, vehicle, 2, 0, wheelId, 1);
    dlog("BURST result", "wheelId=" + wheelId, "result=" + result);
    return result !== 0;
}

function hideFrameAtomics(frame) {
    if (!frame) return;
    const terminator = frame + OFF_FRAME_OBJECT_LIST;
    let link = readPtr(terminator);
    let guard = 0;

    while (link && link !== terminator && guard++ < 32) {
        const object = link - 0x8;
        const flagsAddr = object + 0x2;
        const flags = Memory.ReadU8(flagsAddr, false);
        Memory.WriteU8(flagsAddr, flags & ~0x4, false);
        link = readPtr(link);
    }
}

function hideNodesRecursive(frame, depth, budget) {
    depth = depth || 0;
    budget = budget || { count: 0 };
    if (!frame || depth > 24 || budget.count++ > 96) return;

    hideFrameAtomics(frame);
    const child = readPtr(frame + OFF_FRAME_CHILD);
    if (child) hideNodesRecursive(child, depth + 1, budget);
    const next = readPtr(frame + OFF_FRAME_NEXT);
    if (next) hideNodesRecursive(next, depth, budget);
}

function wheelWorldPos(vehicle, node) {
    const frame = getNodeFrame(vehicle, node);
    if (!frame) return null;
    return {
        x: Memory.ReadFloat(frame + OFF_FRAME_LTM_POS, false),
        y: Memory.ReadFloat(frame + OFF_FRAME_LTM_POS + 4, false),
        z: Memory.ReadFloat(frame + OFF_FRAME_LTM_POS + 8, false),
    };
}

function distanceSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

function detachWheel(vehicle, wheel, recursiveChildren, reason, state) {
    const frame = getNodeFrame(vehicle, wheel.node);
    if (!frame) return false;
    if (getWheelStatus(vehicle, wheel.id) === 2) return false;
    if (!isNotLastWheel(vehicle, wheel.id)) return false;
    if (state && state.detached[wheel.id]) return false;

    dlog("DETACH", reason, wheel.name, "vehicle=" + hex(vehicle),
         "status=" + getWheelStatus(vehicle, wheel.id));

    // Match Junior_Djjr: rear wheel status remains untouched on double-rear-wheel vehicles.
    if (!wheel.rear || !hasDoubleRearWheels(vehicle)) {
        setWheelStatus(vehicle, wheel.id, 2);
    }

    const flyingObject = Memory.CallMethodReturn(
        FUNC_SPAWN_FLYING_COMPONENT,
        vehicle,
        2,
        0,
        wheel.node,
        1
    );
    dlog("SpawnFlyingComponent OK", wheel.name, "object=" + hex(flyingObject));

    hideFrameAtomics(frame);
    if (recursiveChildren) {
        const child = readPtr(frame + OFF_FRAME_CHILD);
        if (child) hideNodesRecursive(child, 0, { count: 0 });
    }

    if (state) state.detached[wheel.id] = true;
    dlog("DETACH OK", wheel.name);
    return true;
}

function validPlayerCar(vehicle) {
    if (!vehicle) return false;
    const subtype = Memory.ReadI32(vehicle + OFF_VEHICLE_SUBCLASS, false);
    if (subtype !== VEHICLE_AUTOMOBILE && subtype !== VEHICLE_QUAD) return false;
    if (Memory.ReadU16(vehicle + OFF_MODEL_INDEX, false) === MODEL_RHINO) return false;
    return true;
}

function findCollisionWheel(vehicle, collisionPos) {
    const radiusSq = cfg.radius * cfg.radius;
    let best = null;
    let bestDistSq = 1e30;

    for (let i = 0; i < COLLISION_WHEELS.length; i++) {
        const wheel = COLLISION_WHEELS[i];
        if (getWheelStatus(vehicle, wheel.id) === 2) continue;
        const pos = wheelWorldPos(vehicle, wheel.node);
        if (!pos) continue;
        const d2 = distanceSq(pos, collisionPos);
        if (d2 < bestDistSq) {
            bestDistSq = d2;
            best = wheel;
        }
    }

    if (!best || bestDistSq >= radiusSq) return null;
    return { wheel: best, distance: Math.sqrt(bestDistSq) };
}

function processCollision(vehicle, state, now) {
    if (!cfg.autoCollision) return;

    const health = Memory.ReadFloat(vehicle + OFF_HEALTH, false);
    if (!(health > 0.0) || !(health < cfg.maxHealth)) return;

    const handling = readPtr(vehicle + OFF_HANDLING_PTR);
    if (!handling) return;

    const collisionMultiplier = Memory.ReadFloat(handling + OFF_HANDLING_COLLISION_MULT, false);
    if (!(collisionMultiplier > 0.001) || collisionMultiplier > 20.0) return;

    const threshold = cfg.minIntensity * (health / cfg.maxHealth) / collisionMultiplier;
    const intensity = Memory.ReadFloat(vehicle + OFF_DAMAGE_INTENSITY, false);
    if (!(intensity > threshold)) return;

    // Prevent the same persisted damage-intensity sample from firing every frame.
    const signature = Math.floor(intensity * 10.0);
    if (state.lastCollisionSignature === signature && ((now - state.lastCollisionTime) >>> 0) < 250) return;
    state.lastCollisionSignature = signature;
    state.lastCollisionTime = now;

    const collisionPos = {
        x: Memory.ReadFloat(vehicle + OFF_LAST_COLLISION_POS, false),
        y: Memory.ReadFloat(vehicle + OFF_LAST_COLLISION_POS + 4, false),
        z: Memory.ReadFloat(vehicle + OFF_LAST_COLLISION_POS + 8, false),
    };

    const hit = findCollisionWheel(vehicle, collisionPos);
    if (!hit) {
        dlog("impact no wheel", "health=" + health.toFixed(1),
             "intensity=" + intensity.toFixed(1), "threshold=" + threshold.toFixed(1));
        return;
    }

    const wheel = hit.wheel;
    dlog("wheel impact", wheel.name,
         "distance=" + hit.distance.toFixed(3),
         "health=" + health.toFixed(1),
         "intensity=" + intensity.toFixed(1),
         "threshold=" + threshold.toFixed(1));

    if (!isNotLastWheel(vehicle, wheel.id)) {
        dlog("protected last wheel", wheel.name);
        return;
    }

    if ((Math.random() * 100.0) < cfg.randomChanceToBurst) {
        if (burstTyre(vehicle, wheel.id, "collision")) {
            dlog("collision burst OK", wheel.name);
        }
        return;
    }

    detachWheel(vehicle, wheel, true, "collision", state);
}

function processLanding(vehicle, state, now) {
    if (!cfg.autoLanding) return;

    const contacts = Memory.ReadU8(vehicle + OFF_NUM_CONTACT_WHEELS, false);
    const moveZ = Memory.ReadFloat(vehicle + OFF_MOVE_SPEED_Z, false);

    if (contacts === 0 && moveZ < -cfg.minFallSpeed) {
        state.lastTimeFalling = now;
        if (!state.isFalling) {
            state.isFalling = true;
            dlog("falling", "moveZ=" + moveZ.toFixed(3));
        }
        return;
    }

    if (state.isFalling) {
        for (let i = 0; i < WHEELS.length; i++) {
            const wheel = WHEELS[i];
            if (getWheelStatus(vehicle, wheel.id) === 2) continue;

            const susp = Memory.ReadFloat(vehicle + OFF_SUSPENSION_PREV + wheel.id * 4, false);
            if (!(susp >= -1.0 && susp <= 2.0)) continue;

            if (susp < cfg.suspCompressBurst) {
                dlog("landing compression", wheel.name, "susp=" + susp.toFixed(4));
                if (susp < cfg.suspCompressDetach) {
                    detachWheel(vehicle, wheel, false, "landing", state);
                } else {
                    burstTyre(vehicle, wheel.id, "landing");
                }
            }
        }
    }

    if (state.isFalling && ((now - state.lastTimeFalling) >>> 0) > 50) {
        state.isFalling = false;
        state.lastTimeFalling = 0;
        dlog("landing window closed");
    }
}

function newState(vehicle) {
    return {
        vehicle: vehicle,
        isFalling: false,
        lastTimeFalling: 0,
        lastCollisionSignature: -1,
        lastCollisionTime: 0,
        detached: [false, false, false, false],
    };
}

function manualDetach(vehicle, state) {
    if (!validPlayerCar(vehicle)) {
        dlog("WDET STOP: player is not driving a supported car/quad");
        return;
    }

    for (let i = 0; i < WHEELS.length; i++) {
        const w = WHEELS[i];
        if (getNodeFrame(vehicle, w.node) && getWheelStatus(vehicle, w.id) !== 2 && !state.detached[w.id]) {
            detachWheel(vehicle, w, false, "WDET", state);
            return;
        }
    }
    dlog("WDET STOP: no detachable wheel found");
}

if (!cfg.enabled) {
    log("[WheelDetachRedux v1.0] Disabled in INI.");
    exit();
}

log("[WheelDetachRedux v1.0] loaded. Original: Junior_Djjr.");
dlog("settings",
     "AutoCollision=" + (cfg.autoCollision ? 1 : 0),
     "AutoLanding=" + (cfg.autoLanding ? 1 : 0),
     "MinIntensity=" + cfg.minIntensity,
     "MaxHealth=" + cfg.maxHealth,
     "Radius=" + cfg.radius,
     "BurstChance=" + cfg.randomChanceToBurst,
     "WDET=" + cfg.testCheat);

let state = newState(0);

while (true) {
    const vehicle = getPlayerVehicle();

    if (vehicle !== state.vehicle) {
        state = newState(vehicle);
        if (vehicle && validPlayerCar(vehicle)) {
            dlog("tracking player vehicle", hex(vehicle),
                 "model=" + Memory.ReadU16(vehicle + OFF_MODEL_INDEX, false));
        }
    }

    if (Pad.TestCheat(cfg.testCheat)) {
        manualDetach(vehicle, state);
    }

    if (validPlayerCar(vehicle)) {
        const now = gameTimeMs();
        processLanding(vehicle, state, now);
        processCollision(vehicle, state, now);
    }

    wait(0);
}
