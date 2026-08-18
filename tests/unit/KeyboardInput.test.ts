import { describe, expect, it } from "vitest";
import { KeyboardInput, type EventTargetLike } from "../../src/input/KeyboardInput.js";

/** Minimal fake event target — no DOM needed (Vitest runs in Node here). */
class FakeEventTarget implements EventTargetLike {
  private readonly listeners: Record<string, Array<(e: KeyboardEvent) => void>> = {};

  addEventListener(type: string, fn: (e: KeyboardEvent) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: (e: KeyboardEvent) => void): void {
    const list = this.listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  keydown(code: string): void {
    for (const fn of [...(this.listeners["keydown"] ?? [])]) fn({ code } as KeyboardEvent);
  }

  keyup(code: string): void {
    for (const fn of [...(this.listeners["keyup"] ?? [])]) fn({ code } as KeyboardEvent);
  }
}

describe("KeyboardInput", () => {
  it("keydown W sets throttle axis to 1; keyup returns it to 0", () => {
    const target = new FakeEventTarget();
    const input = new KeyboardInput(target);
    input.attach();
    expect(input.axis("throttle")).toBe(0);
    target.keydown("KeyW");
    expect(input.axis("throttle")).toBe(1);
    target.keyup("KeyW");
    expect(input.axis("throttle")).toBe(0);
  });

  it("S sets throttle to -1 and ArrowUp/ArrowDown work too", () => {
    const target = new FakeEventTarget();
    const input = new KeyboardInput(target);
    input.attach();
    target.keydown("KeyS");
    expect(input.axis("throttle")).toBe(-1);
    target.keyup("KeyS");
    target.keydown("ArrowUp");
    expect(input.axis("throttle")).toBe(1);
    target.keydown("ArrowDown"); // both held -> 0
    expect(input.axis("throttle")).toBe(0);
  });

  it("A/D set steer axis to -1/+1 respectively (arrows too)", () => {
    const target = new FakeEventTarget();
    const input = new KeyboardInput(target);
    input.attach();
    target.keydown("KeyA");
    expect(input.axis("steer")).toBe(-1);
    target.keyup("KeyA");
    target.keydown("KeyD");
    expect(input.axis("steer")).toBe(1);
    target.keyup("KeyD");
    target.keydown("ArrowRight");
    target.keydown("ArrowLeft"); // both held -> 0
    expect(input.axis("steer")).toBe(0);
    target.keyup("ArrowRight");
    expect(input.axis("steer")).toBe(-1);
  });

  it("Space held reports drift button true, false after keyup", () => {
    const target = new FakeEventTarget();
    const input = new KeyboardInput(target);
    input.attach();
    expect(input.button("drift")).toBe(false);
    target.keydown("Space");
    expect(input.button("drift")).toBe(true);
    target.keyup("Space");
    expect(input.button("drift")).toBe(false);
  });

  it("E justPressed is true for exactly one logic step, then false after endLogicStep()", () => {
    const target = new FakeEventTarget();
    const input = new KeyboardInput(target);
    input.attach();
    expect(input.justPressed("item")).toBe(false);
    target.keydown("KeyE");
    expect(input.justPressed("item")).toBe(true);
    // A step may query twice — still true within the same logic step.
    expect(input.justPressed("item")).toBe(true);
    input.endLogicStep();
    expect(input.justPressed("item")).toBe(false);
  });

  it("Enter also triggers item justPressed", () => {
    const target = new FakeEventTarget();
    const input = new KeyboardInput(target);
    input.attach();
    target.keydown("Enter");
    expect(input.justPressed("item")).toBe(true);
  });

  it("Escape pause edge: justPressed('pause') true once, cleared by endLogicStep()", () => {
    const target = new FakeEventTarget();
    const input = new KeyboardInput(target);
    input.attach();
    target.keydown("Escape");
    expect(input.justPressed("pause")).toBe(true);
    input.endLogicStep();
    expect(input.justPressed("pause")).toBe(false);
  });

  it("holding Escape keeps button('pause') true across logic steps", () => {
    const target = new FakeEventTarget();
    const input = new KeyboardInput(target);
    input.attach();
    target.keydown("Escape");
    expect(input.button("pause")).toBe(true);
    input.endLogicStep();
    expect(input.justPressed("pause")).toBe(false); // edge consumed...
    expect(input.button("pause")).toBe(true); // ...but still held
  });

  it("OS key-repeat does not re-trigger justPressed", () => {
    const target = new FakeEventTarget();
    const input = new KeyboardInput(target);
    input.attach();
    target.keydown("KeyE");
    input.endLogicStep(); // consume the real press
    target.keydown("KeyE"); // OS auto-repeat of the same held key
    expect(input.justPressed("item")).toBe(false);
  });
});
