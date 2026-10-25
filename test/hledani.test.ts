import { describe, expect, it } from "vitest";
import { sediText, vzdalenost } from "../src/domain/hledani.js";

describe("hledání jména s přehozeným pořadím a překlepem", () => {
  const pole = ["O-8555864483", "1-DDWV6LB", "Šimková, Lucie", "Nádražní 799, Žamberk", "56401"];
  it("pořadí slov a diakritika nehrají roli", () => {
    expect(sediText(pole, "Šimková Lucie")).toBe(true);
    expect(sediText(pole, "lucie simkova")).toBe(true);
    expect(sediText(pole, "simkova")).toBe(true);
    expect(sediText(pole, "zamberk nadrazni")).toBe(true);
  });
  it("malý překlep nebo useknutý konec projde, jiné jméno ne", () => {
    expect(sediText(pole, "šimková luci")).toBe(true);
    expect(sediText(pole, "simkva lucie")).toBe(true);
    expect(sediText(pole, "simkova lucue")).toBe(true);
    expect(sediText(pole, "novak lucie")).toBe(false);
    expect(sediText(pole, "simkova petr")).toBe(false);
    expect(sediText(pole, "O-8555864483")).toBe(true);
    expect(sediText(pole, "O-8555864484")).toBe(false); // ID se neopravují
  });
  it("vzdálenost s mezí", () => {
    expect(vzdalenost("simkova", "simkva", 1)).toBe(1);
    expect(vzdalenost("simkova", "novakova", 1)).toBe(2);
  });
});
