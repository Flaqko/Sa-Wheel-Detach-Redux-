# Wheel Detach Redux v1.0

CLEO Redux port/remaster of **Wheel Detach** by Junior_Djjr (Valdir da Costa Junior).

Target: **GTA San Andreas Classic 1.0 US + CLEO Redux x86**.

## Features

- Wheels can physically detach from CJ's current automobile or quad after sufficiently strong impacts near a wheel.
- Uses GTA San Andreas' native `CAutomobile::SpawnFlyingComponent` path, so detached wheels are real flying vehicle components rather than replacement props.
- Hard landings and suspension compression can burst or detach wheels.
- Original-style scaling based on collision intensity, vehicle health, and handling resistance.
- Random tyre-burst chance before full detachment.
- Protects the final remaining wheel.
- Supports double rear wheels.
- Rhino is excluded, matching the original mod.
- Optional `WDET` manual detach cheat remains available for troubleshooting.
- Stable CLEO Redux implementation avoids the unsafe global vehicle-pool scan used during early testing.

## Install

Copy the folder:

`WheelDetachRedux[fs][mem]`

into your GTA San Andreas `CLEO` folder.

The `[fs][mem]` permissions are required because the mod reads its INI file and uses GTA SA memory/native calls for real wheel detachment.

## Configuration

Edit `WheelDetachRedux.ini`.

Default release configuration:

```ini
[Module]
Enabled=1
Debug=0
AutomaticCollision=1
AutomaticLanding=1
```

The remaining values preserve the original Wheel Detach defaults used by the Redux port.

## Notes

This v1.0 release intentionally processes **CJ's current vehicle** rather than walking the entire GTA vehicle pool. Early global-pool testing caused instability, while the player-vehicle implementation was verified stable in gameplay.

## Credits

- Original Wheel Detach: **Junior_Djjr / Valdir da Costa Junior**
- CLEO Redux port/remaster: **Flaqko**

Released under the MIT License, matching the original project.
