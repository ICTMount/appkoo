import { describe, expect, it } from "vitest";
import { webcalendar } from "../src/domain/webcalendar.js";
import { rozlozPoznamku } from "../src/import/notes.js";

describe("webcalendar", () => {
  it("pozná zakázku z webového kalendáře a přečte vybraný termín", () => {
    const { zaznamy } = rozlozPoznamku(
      "[Dojednávania] 20.10.2026 10:41, Markéta Kraitlová (Vegacom): Zákazník: Dagmar Kynclová (21.10.2026, 12:00 - 13:59)\n" +
        "[Dojednávania] 20.10.2026 8:54, webcalendar: Zákazník: Bára_Kynclová (23.10.2026, 08:00 - 10:00) \n PP ID:26733036 termín co nejdříve",
    );
    const w = webcalendar({ zaznamy });
    expect(w?.termin).toBe("23.10.2026 08:00–10:00");
    expect(webcalendar({ zaznamy: zaznamy.filter((z) => !/webcalendar/.test(z.autor)) })).toBeNull();
  });

  it("pozná i značku WBCS_WEB_CZ (jako autora i v textu záznamu)", () => {
    const autor = rozlozPoznamku("[Dojednávania] 9.11.2026 7:12, WBCS_WEB_CZ: Zákazník: Jan Novák (13.11.2026, 10:00 - 12:00)").zaznamy;
    expect(webcalendar({ zaznamy: autor })?.termin).toBe("13.11.2026 10:00–12:00");
    const vTextu = rozlozPoznamku("[Dojednávania] 9.11.2026 7:12, System: WBCS_WEB_CZ Zákazník: Jan Novák (13.11.2026, 10:00 - 12:00)").zaznamy;
    expect(webcalendar({ zaznamy: vTextu })?.termin).toBe("13.11.2026 10:00–12:00");
    expect(webcalendar({ zaznamy: rozlozPoznamku("[Dojednávania] 9.11.2026 7:12, Jana Hadravová (Vegacom): Zákazník: Jan Novák (13.11.2026, 10:00 - 12:00)").zaznamy })).toBeNull();
  });
});
